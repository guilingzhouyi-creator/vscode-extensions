//! Module: fg-storage — Git Object Database Router
//! File Path: crates/fg-storage/src/backends/odb_router.rs
//! Architecture Role: The single object-reading entry point for a Git repository. Resolves an id
//!   through loose objects, then the multi-pack index, then each pack index in turn, and returns
//!   `(kind, payload)` for every backend.
//! Dependencies & Triggers: Built by `Repo::open` and by every read command (`cat-file`,
//!   `ls-tree`, `rev-list`, `status`); replaces decentralized per-command object access.
//! Responsibilities: Backend selection, delta base resolution across packs, and a bounded object
//!   cache keyed by id.
//! Exit Semantics & Design Rationale:
//!   - Lookup order is loose → midx → each idx. Loose is one `stat`; the midx covers all packs in one
//!     binary search; the per-pack scan exists only for a repository whose midx is stale or absent.
//!   - `REF_DELTA` bases may live in a different pack than the delta that names them. The router is
//!     therefore the [`DeltaBaseSource`] for every pack it owns; letting a pack resolve its own bases
//!     alone would fail exactly on the objects that were packed together across a repack boundary.
//!   - A missing id returns `Ok(None)`. An unreadable directory or a corrupt pack returns `Err`. The
//!     two are not interchangeable: reporting absence for a permission failure tells an operator the
//!     object does not exist when it does.
//!   - `read_object` returns the payload *without* the `"<type> <len>\0"` header. Callers that need
//!     the id re-derive it with [`fg_core::models::compute_object_oid`], which is the only definition
//!     of an object id in this build.
//!
//! Domain Governance Rules: FGT-STO-001 (storage hierarchy), FGT-PRF-001.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use flate2::read::ZlibDecoder;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{compute_object_oid, parse_loose_header, ObjectKind, Oid};
use fg_pools::ByteLruCache;

use crate::backends::idx_file::PackIndex;
use crate::backends::midx_file::MultiPackIndex;
use crate::backends::pack_bitmap::PackBitmap;
use crate::backends::pack_file::{DeltaBaseSource, PackFile, PackedObject};

/// Default in-memory object cache capacity for the router (64 MiB).
pub const DEFAULT_ROUTER_CACHE_BYTES: usize = 64 * 1024 * 1024;

/// Suffix of a pack index file.
const IDX_SUFFIX: &str = ".idx";

/// Suffix of a packfile.
const PACK_SUFFIX: &str = ".pack";

/// Suffix of a pack bitmap file.
const BITMAP_SUFFIX: &str = ".bitmap";

/// Name of the multi-pack index inside `objects/pack`.
const MIDX_NAME: &str = "multi-pack-index";

/// Reads Git objects from a repository's object store.
pub struct OdbRouter {
    objects_dir: PathBuf,
    midx: Option<MultiPackIndex>,
    packs: Vec<LoadedPack>,
    cache: Option<ByteLruCache<Oid, CachedObject>>,
}

/// One packfile together with its index.
struct LoadedPack {
    name: String,
    index: PackIndex,
    pack: PackFile,
    bitmap: Option<PackBitmap>,
}

/// A cached object: kind plus reference-counted immutable payload (`FGT-PRF-001`).
#[derive(Debug, Clone, PartialEq, Eq)]
struct CachedObject {
    kind: ObjectKind,
    payload: Arc<[u8]>,
}

impl OdbRouter {
    /// Opens the object store rooted at `objects_dir`.
    ///
    /// A missing `pack` directory is a normal state: it means everything is loose. A `pack`
    /// directory that exists but cannot be read is an error, because that hides real damage.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] when `objects/pack` cannot be listed, and
    /// [`FractalError::CorruptStore`] when an index or pack is structurally invalid.
    pub fn open(objects_dir: impl Into<PathBuf>) -> FractalResult<Self> {
        Self::with_cache_budget(objects_dir, DEFAULT_ROUTER_CACHE_BYTES)
    }

    /// Opens the object store with an explicit cache budget; zero disables caching.
    ///
    /// # Errors
    ///
    /// Same conditions as [`Self::open`].
    pub fn with_cache_budget(
        objects_dir: impl Into<PathBuf>,
        max_cache_bytes: usize,
    ) -> FractalResult<Self> {
        let objects_dir = objects_dir.into();
        let pack_dir = objects_dir.join("pack");
        let mut packs = Vec::new();
        let mut midx = None;

        match fs::metadata(&pack_dir) {
            Ok(meta) if meta.is_dir() => {
                let midx_path = pack_dir.join(MIDX_NAME);
                if midx_path.is_file() {
                    midx = Some(MultiPackIndex::load(&midx_path)?);
                }
                packs = Self::load_packs(&pack_dir)?;
            }
            Ok(_) => {
                return Err(FractalError::CorruptStore(format!(
                    "object store '{}' holds a `pack` entry that is not a directory",
                    objects_dir.display()
                )))
            }
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => {}
            Err(io_err) => return Err(FractalError::Io(io_err)),
        }

        Ok(Self {
            objects_dir,
            midx,
            packs,
            cache: if max_cache_bytes > 0 {
                Some(ByteLruCache::new(max_cache_bytes))
            } else {
                None
            },
        })
    }

    /// Loads every `*.idx` that has a matching `*.pack`.
    ///
    /// An index without its pack is ignored rather than reported: a half-written repack can leave
    /// one behind, and the objects it describes are still reachable while the repack finishes.
    fn load_packs(pack_dir: &Path) -> FractalResult<Vec<LoadedPack>> {
        let mut names: Vec<String> = Vec::new();
        for entry in fs::read_dir(pack_dir)? {
            let entry = entry?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !file_name.ends_with(IDX_SUFFIX) {
                continue;
            }
            let stem = &file_name[..file_name.len() - IDX_SUFFIX.len()];
            if pack_dir.join(format!("{stem}{PACK_SUFFIX}")).is_file() {
                names.push(stem.to_string());
            }
        }
        names.sort();

        let mut packs = Vec::with_capacity(names.len());
        for stem in names {
            let index = PackIndex::load(pack_dir.join(format!("{stem}{IDX_SUFFIX}")))?;
            let pack = PackFile::load(pack_dir.join(format!("{stem}{PACK_SUFFIX}")))?;
            let bitmap_path = pack_dir.join(format!("{stem}{BITMAP_SUFFIX}"));
            let bitmap = if bitmap_path.is_file() {
                PackBitmap::open(&bitmap_path).ok()
            } else {
                None
            };
            packs.push(LoadedPack {
                name: format!("{stem}{PACK_SUFFIX}"),
                index,
                pack,
                bitmap,
            });
        }
        Ok(packs)
    }

    /// Directory this router reads from.
    pub fn objects_dir(&self) -> &Path {
        &self.objects_dir
    }

    /// Number of packs currently open.
    pub fn pack_count(&self) -> usize {
        self.packs.len()
    }

    /// Returns the pack bitmap for the given open pack, if present.
    pub fn pack_bitmap(&self, pack_index: usize) -> Option<&PackBitmap> {
        self.packs
            .get(pack_index)
            .and_then(|pack| pack.bitmap.as_ref())
    }

    /// Total number of objects the loaded indexes list.
    pub fn indexed_object_count(&self) -> usize {
        self.packs
            .iter()
            .map(|pack| pack.index.object_count())
            .sum()
    }

    /// Number of objects the multi-pack index lists, when one is loaded.
    pub fn midx_object_count(&self) -> Option<usize> {
        self.midx.as_ref().map(MultiPackIndex::object_count)
    }

    /// Number of objects in the store as Git's *approximate* count defines it.
    ///
    /// Git's `odb_source_files_count_objects` skips the loose source entirely under
    /// `ODB_COUNT_OBJECTS_APPROXIMATE`, which is the flag the abbreviation-width heuristic passes.
    /// Counting loose objects as well would shift the width by one on a repository that has not
    /// been repacked recently, and the width is visible in every `index` and `log` line.
    ///
    /// The multi-pack index is preferred when present because it already spans every pack; falling
    /// back to summing the individual indexes covers a store whose midx is stale or absent.
    pub fn approximate_object_count(&self) -> usize {
        match self.midx_object_count() {
            Some(count) => count,
            None => self.indexed_object_count(),
        }
    }

    /// Returns every object id listed in the loaded pack indexes and loose objects directory.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] on read failure.
    pub fn all_oids(&self) -> FractalResult<Vec<Oid>> {
        let mut oids = Vec::with_capacity(self.approximate_object_count());
        for pack in &self.packs {
            for i in 0..pack.index.object_count() {
                if let Some(oid) = pack.index.oid_at(i) {
                    oids.push(oid);
                }
            }
        }
        if self.objects_dir.is_dir() {
            Self::collect_loose_oids(&self.objects_dir, &mut oids)?;
        }
        oids.sort();
        oids.dedup();
        Ok(oids)
    }

    /// Scans 2-character fanout directories for loose Git objects.
    fn collect_loose_oids(objects_dir: &Path, oids: &mut Vec<Oid>) -> FractalResult<()> {
        for entry in fs::read_dir(objects_dir)? {
            let entry = entry?;
            let dir_name = entry.file_name();
            let dir_str = dir_name.to_string_lossy();
            if dir_str.len() != 2 || dir_str == "in" || dir_str == "pa" {
                continue;
            }
            if !entry.file_type()?.is_dir() {
                continue;
            }
            for file_entry in fs::read_dir(entry.path())? {
                let file_entry = file_entry?;
                let file_name = file_entry.file_name();
                let file_str = file_name.to_string_lossy();
                if file_str.len() == 38 {
                    let full_hex = format!("{dir_str}{file_str}");
                    if let Ok(oid) = Oid::from_hex(&full_hex) {
                        oids.push(oid);
                    }
                }
            }
        }
        Ok(())
    }

    /// Returns `(kind, payload)` for `oid`, or `None` when the object is absent.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when a pack that should contain the object cannot be
    /// decoded, and [`FractalError::Io`] when the loose object cannot be read.
    pub fn read(&self, oid: &Oid) -> FractalResult<Option<PackedObject>> {
        if let Some(cached) = self.cached(oid) {
            return Ok(Some(cached));
        }
        if let Some(found) = self.read_loose(oid)? {
            self.remember(oid, &found);
            return Ok(Some(found));
        }
        if let Some(found) = self.read_packed(oid)? {
            self.remember(oid, &found);
            return Ok(Some(found));
        }
        Ok(None)
    }

    /// Reads a loose object, distinguishing absence from failure.
    ///
    /// The loose path is computed here from `objects_dir` rather than delegated to `LooseOdb`:
    /// `LooseOdb` anchors its own paths at a *git directory* and appends `objects/` itself, so
    /// handing it the objects directory would make it read `<objects>/objects/<xx>/<rest>`. That
    /// path never exists, and the router would report every loose object as absent while packed
    /// objects still resolved — a partial failure that looks like a repository with gaps.
    fn read_loose(&self, oid: &Oid) -> FractalResult<Option<PackedObject>> {
        let path = self.loose_object_path(oid);
        let raw = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };
        let mut decoder = ZlibDecoder::new(&raw[..]);
        let mut inflated = Vec::new();
        decoder.read_to_end(&mut inflated).map_err(|io_err| {
            FractalError::CorruptStore(format!(
                "loose object '{}' failed to inflate: {io_err}",
                path.display()
            ))
        })?;
        let (kind, payload) = split_object_header(&inflated, oid)?;
        Ok(Some(PackedObject { kind, payload }))
    }

    /// Reads an object through the multi-pack index, then through each pack index.
    fn read_packed(&self, oid: &Oid) -> FractalResult<Option<PackedObject>> {
        if let Some(midx) = self.midx.as_ref() {
            if let Some(location) = midx.lookup(oid) {
                let position = location.pack_id as usize;
                if let Some(pack) = self.packs.get(position) {
                    return pack.pack.read_at(location.offset, self).map(Some);
                }
            }
        }
        for pack in &self.packs {
            if let Some(offset) = pack.index.lookup(oid) {
                return pack.pack.read_at(offset, self).map(Some);
            }
        }
        Ok(None)
    }

    /// Path of the loose object file for `oid`, matching Git's two-level fan-out.
    fn loose_object_path(&self, oid: &Oid) -> PathBuf {
        let hex = oid.to_hex();
        self.objects_dir.join(&hex[..2]).join(&hex[2..])
    }

    /// Returns the cached entry for `oid`, if present.
    fn cached(&self, oid: &Oid) -> Option<PackedObject> {
        let cache = self.cache.as_ref()?;
        let hit = cache.get(oid)?;
        Some(PackedObject {
            kind: hit.kind,
            payload: hit.payload.as_ref().to_vec(),
        })
    }

    /// Stores `object` in the cache under `oid`.
    fn remember(&self, oid: &Oid, object: &PackedObject) {
        if let Some(cache) = self.cache.as_ref() {
            let size = object.payload.len();
            let entry = CachedObject {
                kind: object.kind,
                payload: Arc::<[u8]>::from(object.payload.as_slice()),
            };
            cache.insert(*oid, entry, size);
        }
    }

    /// Pack file names currently open, in the order `OOFF` pack positions refer to.
    pub fn pack_names(&self) -> Vec<String> {
        self.packs.iter().map(|pack| pack.name.clone()).collect()
    }

    /// Resolves an object id, requiring it to exist.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] when the id is absent, carrying the id itself so the
    /// caller can report which lookup failed.
    pub fn read_required(&self, oid: &Oid) -> FractalResult<PackedObject> {
        match self.read(oid)? {
            Some(object) => Ok(object),
            None => Err(FractalError::ObjectCodec(format!(
                "object {} is not present in '{}'",
                oid.to_hex(),
                self.objects_dir.display()
            ))),
        }
    }

    /// Verifies that an object's bytes still hash to its id.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::HashMismatch`] when the recomputed id differs.
    pub fn verify(&self, oid: &Oid) -> FractalResult<()> {
        let object = self.read_required(oid)?;
        let actual = compute_object_oid(object.kind, &object.payload);
        if actual == *oid {
            return Ok(());
        }
        Err(FractalError::HashMismatch {
            expected: oid.to_hex(),
            actual: actual.to_hex(),
        })
    }
}

impl DeltaBaseSource for OdbRouter {
    fn read_base(&self, oid: &Oid) -> FractalResult<(ObjectKind, Vec<u8>)> {
        let object = self.read_required(oid)?;
        Ok((object.kind, object.payload))
    }
}

/// Splits `"<type> <len>\0"` from a loose object's uncompressed bytes.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when the header is absent, names an unknown type, declares a
/// length that disagrees with the payload, or is not NUL-terminated.
fn split_object_header(raw: &[u8], oid: &Oid) -> FractalResult<(ObjectKind, Vec<u8>)> {
    let (kind, payload) = parse_loose_header(raw).map_err(|err| {
        FractalError::ObjectCodec(format!("loose object {}: {err}", oid.to_hex()))
    })?;
    Ok((kind, payload.to_vec()))
}

/// Maps a header type name to its kind.
#[cfg(test)]
fn parse_object_kind(name: &str) -> Option<ObjectKind> {
    ObjectKind::from_header_name(name)
}

#[cfg(test)]
mod tests {
    use super::{parse_object_kind, split_object_header, OdbRouter};
    use fg_core::models::{ObjectKind, Oid};
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(label: &str) -> PathBuf {
        let base = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("target")
            .join("test_tmp")
            .join("fg-odb-router");
        let _ = fs::create_dir_all(&base);
        let path = base.join(format!("{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create scratch");
        path
    }

    #[test]
    fn splits_a_blob_header() {
        let raw = b"blob 5\0hello";
        let (kind, payload) = split_object_header(raw, &Oid::ZERO).expect("split");
        assert_eq!(kind, ObjectKind::Blob);
        assert_eq!(payload, b"hello");
    }

    #[test]
    fn rejects_a_header_without_a_nul() {
        assert!(split_object_header(b"blob 5", &Oid::ZERO).is_err());
    }

    #[test]
    fn rejects_an_unknown_type_name() {
        assert!(split_object_header(b"widget 1\0x", &Oid::ZERO).is_err());
    }

    #[test]
    fn rejects_a_length_that_disagrees_with_the_payload() {
        assert!(split_object_header(b"blob 9\0hello", &Oid::ZERO).is_err());
    }

    #[test]
    fn maps_every_known_type_name() {
        assert_eq!(parse_object_kind("blob"), Some(ObjectKind::Blob));
        assert_eq!(parse_object_kind("tree"), Some(ObjectKind::Tree));
        assert_eq!(parse_object_kind("commit"), Some(ObjectKind::Commit));
        assert_eq!(parse_object_kind("tag"), Some(ObjectKind::Tag));
        assert_eq!(parse_object_kind("BLOB"), None);
    }

    #[test]
    fn an_empty_object_store_reports_no_packs() {
        let dir = scratch_dir("empty");
        let router = OdbRouter::open(&dir).expect("open");
        assert_eq!(router.pack_count(), 0);
        assert_eq!(router.midx_object_count(), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_object_reads_as_absence_not_failure() {
        let dir = scratch_dir("absent");
        let router = OdbRouter::open(&dir).expect("open");
        let missing = Oid::from_bytes([0x7f; 20]);
        assert!(matches!(router.read(&missing), Ok(None)));
        assert!(router.read_required(&missing).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
