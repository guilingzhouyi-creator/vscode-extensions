//! Module: fg-storage — In-Place Bundle Consumer
//! File Path: crates/fg-storage/src/in_place/bundle_consumer.rs
//! Architecture Role: Ingests Git Bundle v2 files into the repository object database while
//!   leaving the source bundle intact by default and truncating it only after the embedded pack
//!   trailer has been verified against its own data.
//! Dependencies & Triggers: Consumed by `taxis bundle unbundle` and `taxis unarchive` bundle mode.
//! Responsibilities: Bundle header parsing, pack/idx publication, SHA-1 trailer verification,
//!   compare-and-swap reference publication, and optional tail truncation.
//! Exit Semantics & Design Rationale: A failed ingest leaves every existing reference untouched,
//!   and the source bundle is only ever truncated after all object and reference work succeeded.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-TRN-001, FGT-COR-001.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;

use crate::backends::idx_writer::IdxWriter;
use crate::backends::pack_file::{DeltaBaseSource, PackFile};
use crate::bundle::BundleEngine;
use crate::in_place::tail_truncator::TailTruncator;

/// Bytes copied per streaming read while materializing the embedded packfile.
const PACK_COPY_CHUNK_LEN: usize = 64 * 1024;

/// Maximum symbolic-reference hops followed before declaring a corrupt reference chain.
const MAX_SYMBOLIC_HOPS: usize = 8;

/// Suffix Git uses for the exclusive lock file guarding a reference update.
const REF_LOCK_SUFFIX: &str = ".lock";

/// Monotonic counter keeping staging file names unique within one process.
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Resolver refusing external bases for standalone bundles.
struct BundleNoBase;

impl DeltaBaseSource for BundleNoBase {
    fn read_base(&self, _oid: &Oid) -> FractalResult<(fg_core::models::ObjectKind, Vec<u8>)> {
        Err(FractalError::CorruptStore(
            "External delta base not found in standalone bundle pack".into(),
        ))
    }
}

/// Options selecting whether a consumed bundle may be truncated after a verified ingest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BundleConsumeOptions {
    /// Truncate the source bundle to zero bytes once every verification step has passed.
    ///
    /// The default keeps the caller's bundle byte-for-byte intact so an ingest stays auditable
    /// and retryable; only callers that own the transfer file opt in explicitly.
    pub truncate_source: bool,
}

/// Report from consuming a Git Bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleConsumeReport {
    /// OID checksum of the ingested packfile.
    pub pack_oid: Oid,
    /// Number of objects extracted and indexed.
    pub object_count: u32,
    /// References advanced in the target repository.
    pub references_advanced: Vec<(String, Oid)>,
    /// Bytes actually released by truncating the source bundle.
    pub bundle_bytes_reclaimed: u64,
    /// Whether the source bundle was truncated after a verified ingest.
    pub source_truncated: bool,
    /// Bytes of the source bundle left in place for the caller.
    pub source_retained_bytes: u64,
}

/// In-place consumer for Git Bundle v2 files.
pub struct InPlaceBundleConsumer;

impl InPlaceBundleConsumer {
    /// Ingests an embedded packfile from a bundle into `git_dir/objects/pack/`.
    ///
    /// The embedded pack stream is copied into the repository pack directory, indexed, verified
    /// against the bundle trailer checksum, and its references are published with compare-and-swap
    /// semantics. The source bundle is truncated only when `options.truncate_source` is set,
    /// and only after the pack, the references and the checksum all succeeded.
    pub fn consume_bundle<P: AsRef<Path>, G: AsRef<Path>>(
        bundle_path: P,
        git_dir: G,
        options: &BundleConsumeOptions,
    ) -> FractalResult<BundleConsumeReport> {
        let source_path = bundle_path.as_ref();
        let resolved_git_dir = git_dir.as_ref();
        let pack_dir = resolved_git_dir.join("objects").join("pack");
        fs::create_dir_all(&pack_dir).map_err(FractalError::Io)?;

        let mut source = BundleSourceHandle::open(source_path, options.truncate_source)?;
        let original_bundle_len = source.len();
        let header = BundleEngine::read_header(source.file_mut())?;

        // Snapshot the expected reference values up front: every write below is compare-and-swap,
        // so a concurrent writer between this snapshot and the write turns into a hard conflict.
        let (planned_ref_updates, references_advanced) =
            plan_reference_updates(resolved_git_dir, &header.references)?;

        let process_id = std::process::id();
        let staging_sequence = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let staging_pack_path = pack_dir.join(format!(
            "staging_bundle_{process_id}_{staging_sequence}.pack"
        ));
        let staging_idx_path = pack_dir.join(format!(
            "staging_bundle_{process_id}_{staging_sequence}.idx"
        ));

        stage_embedded_pack(source.file_mut(), header.pack_offset, &staging_pack_path)?;

        let loaded_pack = PackFile::load(&staging_pack_path)?;
        let object_count = loaded_pack.object_count();
        let (pack_checksum, entry_metas) = loaded_pack.index_objects(&BundleNoBase)?;
        drop(loaded_pack);

        let checksum_hex = pack_checksum.to_hex();
        let final_pack_path = pack_dir.join(format!("pack-{checksum_hex}.pack"));
        let final_idx_path = pack_dir.join(format!("pack-{checksum_hex}.idx"));
        let pack_preexisted = final_pack_path.exists();
        let idx_preexisted = final_idx_path.exists();

        let staging_idx = File::create(&staging_idx_path).map_err(FractalError::Io)?;
        IdxWriter::write_idx(entry_metas, &pack_checksum, &staging_idx)?;
        staging_idx.sync_all().map_err(FractalError::Io)?;
        drop(staging_idx);

        fs::rename(&staging_pack_path, &final_pack_path).map_err(FractalError::Io)?;
        fs::rename(&staging_idx_path, &final_idx_path).map_err(FractalError::Io)?;

        // Recompute the trailer hash over the bundle's own pack bytes and reject any mismatch
        // before a single reference can move.
        let verified_checksum =
            match BundleEngine::verify_pack_checksum(source.file_mut(), header.pack_offset) {
                Ok(checksum) => checksum,
                Err(verification_error) => {
                    discard_published_pack(
                        &final_pack_path,
                        &final_idx_path,
                        pack_preexisted,
                        idx_preexisted,
                    );
                    return Err(verification_error);
                }
            };
        if verified_checksum != pack_checksum {
            discard_published_pack(
                &final_pack_path,
                &final_idx_path,
                pack_preexisted,
                idx_preexisted,
            );
            return Err(FractalError::CorruptStore(format!(
                "bundle pack trailer {verified} does not match the indexed pack checksum {pack_checksum}",
                verified = verified_checksum.to_hex(),
                pack_checksum = checksum_hex,
            )));
        }

        for planned_ref_update in &planned_ref_updates {
            cas_write_ref(resolved_git_dir, planned_ref_update)?;
        }

        let bundle_bytes_reclaimed = if options.truncate_source {
            source.truncate_to_zero()?
        } else {
            0
        };
        let source_retained_bytes = if options.truncate_source {
            0
        } else {
            original_bundle_len
        };

        Ok(BundleConsumeReport {
            pack_oid: pack_checksum,
            object_count,
            references_advanced,
            bundle_bytes_reclaimed,
            source_truncated: options.truncate_source,
            source_retained_bytes,
        })
    }

    /// Ingests a bundle and truncates it in place, preserving the historical destructive entry point.
    pub fn consume_bundle_in_place<P: AsRef<Path>, G: AsRef<Path>>(
        bundle_path: P,
        git_dir: G,
    ) -> FractalResult<BundleConsumeReport> {
        Self::consume_bundle(
            bundle_path,
            git_dir,
            &BundleConsumeOptions {
                truncate_source: true,
            },
        )
    }
}

/// Source bundle handle that opens read-only unless tail truncation was requested.
enum BundleSourceHandle {
    /// Read-only source bundle with its observed length.
    ReadOnly { file: File, len: u64 },
    /// Read-write source bundle able to release its consumed tail.
    InPlace(TailTruncator),
}

impl BundleSourceHandle {
    /// Opens the source bundle for the requested consumption mode.
    fn open(path: &Path, truncate_source: bool) -> FractalResult<Self> {
        if truncate_source {
            return Ok(Self::InPlace(TailTruncator::open_read_write(path)?));
        }
        let file = File::open(path).map_err(FractalError::Io)?;
        let len = file.metadata().map_err(FractalError::Io)?.len();
        Ok(Self::ReadOnly { file, len })
    }

    /// Returns the source bundle length observed when the handle was opened.
    fn len(&self) -> u64 {
        match self {
            Self::ReadOnly { len, .. } => *len,
            Self::InPlace(truncator) => truncator.current_len(),
        }
    }

    /// Returns the underlying file for header parsing, streaming and verification.
    fn file_mut(&mut self) -> &mut File {
        match self {
            Self::ReadOnly { file, .. } => file,
            Self::InPlace(truncator) => truncator.file_mut(),
        }
    }

    /// Truncates the source bundle to zero bytes and returns the bytes actually released.
    fn truncate_to_zero(&mut self) -> FractalResult<u64> {
        match self {
            Self::InPlace(truncator) => truncator.truncate_to(0),
            Self::ReadOnly { .. } => Err(FractalError::PolicyViolation(
                "read-only bundle consumption cannot truncate the source bundle".into(),
            )),
        }
    }
}

/// Planned compare-and-swap write for one reference target.
struct BundleRefUpdate {
    /// Reference file to write (either a `refs/` name or the literal `HEAD`).
    target: String,
    /// Reference value observed before the ingest started.
    expected_old: Option<Oid>,
    /// Object id the bundle advances the reference to.
    new_oid: Oid,
}

/// Observed state of the repository HEAD.
enum HeadState {
    /// HEAD file is missing, for example in a repository that was never initialized.
    Absent,
    /// HEAD names a branch through a symbolic reference.
    Symbolic(String),
    /// HEAD points directly at an object id.
    Detached(Oid),
}

/// Copies the embedded pack stream from `pack_offset` to the end of the bundle into a staging file.
fn stage_embedded_pack(
    source: &mut File,
    pack_offset: u64,
    staging_pack_path: &Path,
) -> FractalResult<()> {
    source
        .seek(SeekFrom::Start(pack_offset))
        .map_err(FractalError::Io)?;
    let mut staging_pack = File::create(staging_pack_path).map_err(FractalError::Io)?;
    let mut buffer = vec![0u8; PACK_COPY_CHUNK_LEN];
    loop {
        let bytes_read = source.read(&mut buffer).map_err(FractalError::Io)?;
        if bytes_read == 0 {
            break;
        }
        staging_pack
            .write_all(&buffer[..bytes_read])
            .map_err(FractalError::Io)?;
    }
    staging_pack.sync_all().map_err(FractalError::Io)
}

/// Removes freshly published pack files after a trailer rejection, leaving pre-existing ones alone.
fn discard_published_pack(
    pack_path: &Path,
    idx_path: &Path,
    pack_preexisted: bool,
    idx_preexisted: bool,
) {
    // Best-effort cleanup: the checksum error is the diagnosis, and a stray pack file stays inert
    // for as long as no reference points at it.
    if !pack_preexisted {
        let _ = fs::remove_file(pack_path);
    }
    if !idx_preexisted {
        let _ = fs::remove_file(idx_path);
    }
}

/// Compare-and-swap plan paired with the public projection of the references it advances.
type BundleReferencePlan = (Vec<BundleRefUpdate>, Vec<(String, Oid)>);

/// Builds compare-and-swap plans for every reference carried by the bundle header.
fn plan_reference_updates(
    git_dir: &Path,
    references: &[(Oid, String)],
) -> FractalResult<BundleReferencePlan> {
    let head_state = read_head_state(git_dir)?;
    let mut planned: Vec<BundleRefUpdate> = Vec::new();
    let mut advanced: Vec<(String, Oid)> = Vec::new();

    for (oid, bundle_name) in references {
        let mut targets: Vec<(String, Option<Oid>)> = Vec::new();
        if bundle_name == "HEAD" {
            match &head_state {
                HeadState::Symbolic(target_name) => {
                    targets.push((target_name.clone(), read_ref_oid(git_dir, target_name)?));
                }
                HeadState::Detached(current_oid) => {
                    targets.push(("HEAD".to_string(), Some(*current_oid)));
                }
                HeadState::Absent => targets.push(("HEAD".to_string(), None)),
            }
        } else {
            validate_ref_name(bundle_name)?;
            targets.push((bundle_name.clone(), read_ref_oid(git_dir, bundle_name)?));
        }

        for (target, expected_old) in targets {
            match planned.iter().find(|update| update.target == target) {
                Some(existing) if existing.new_oid != *oid => {
                    return Err(FractalError::CorruptStore(format!(
                        "bundle advances reference '{target}' to two different objects"
                    )));
                }
                Some(_) => {}
                None => planned.push(BundleRefUpdate {
                    target,
                    expected_old,
                    new_oid: *oid,
                }),
            }
        }
        advanced.push((bundle_name.clone(), *oid));
    }

    Ok((planned, advanced))
}

/// Reads the repository HEAD into a typed state.
fn read_head_state(git_dir: &Path) -> FractalResult<HeadState> {
    let head_path = git_dir.join("HEAD");
    match fs::read_to_string(&head_path) {
        Ok(body) => {
            let trimmed = body.trim();
            if let Some(target) = trimmed.strip_prefix("ref:") {
                let target_name = target.trim();
                validate_ref_name(target_name)?;
                return Ok(HeadState::Symbolic(target_name.to_string()));
            }
            let oid = Oid::from_hex(trimmed).map_err(|_| {
                FractalError::CorruptStore(format!(
                    "HEAD does not contain a valid object id: '{trimmed}'"
                ))
            })?;
            Ok(HeadState::Detached(oid))
        }
        Err(read_error) if read_error.kind() == std::io::ErrorKind::NotFound => {
            Ok(HeadState::Absent)
        }
        Err(read_error) => Err(FractalError::Io(read_error)),
    }
}

/// Resolves a reference to its object id, preferring loose refs over `packed-refs`.
fn read_ref_oid(git_dir: &Path, name: &str) -> FractalResult<Option<Oid>> {
    validate_ref_name_like(name)?;
    let mut current_name = name.to_string();
    for _ in 0..MAX_SYMBOLIC_HOPS {
        let loose_path = ref_path_inside(git_dir, &current_name)?;
        match fs::read_to_string(&loose_path) {
            Ok(body) => {
                let trimmed = body.trim();
                if let Some(target) = trimmed.strip_prefix("ref:") {
                    let target_name = target.trim();
                    validate_ref_name_like(target_name)?;
                    current_name = target_name.to_string();
                    continue;
                }
                let oid = Oid::from_hex(trimmed).map_err(|_| {
                    FractalError::CorruptStore(format!(
                        "reference '{current_name}' does not contain a valid object id: '{trimmed}'"
                    ))
                })?;
                return Ok(Some(oid));
            }
            Err(read_error) if read_error.kind() == std::io::ErrorKind::NotFound => {
                return read_packed_ref_oid(git_dir, &current_name);
            }
            Err(read_error) => return Err(FractalError::Io(read_error)),
        }
    }
    Err(FractalError::CorruptStore(format!(
        "symbolic reference '{name}' exceeds {MAX_SYMBOLIC_HOPS} hops"
    )))
}

/// Scans `packed-refs` for one exact reference name.
fn read_packed_ref_oid(git_dir: &Path, name: &str) -> FractalResult<Option<Oid>> {
    let packed_path = git_dir.join("packed-refs");
    let body = match fs::read_to_string(&packed_path) {
        Ok(packed_body) => packed_body,
        Err(read_error) if read_error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(read_error) => return Err(FractalError::Io(read_error)),
    };
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('^') {
            continue;
        }
        if let Some((oid_hex, ref_name)) = trimmed.split_once(' ') {
            if ref_name.trim() == name {
                let oid = Oid::from_hex(oid_hex).map_err(|_| {
                    FractalError::CorruptStore(format!(
                        "packed reference '{name}' does not contain a valid object id: '{oid_hex}'"
                    ))
                })?;
                return Ok(Some(oid));
            }
        }
    }
    Ok(None)
}

/// Validates a loose reference name that the bundle would create or update.
fn validate_ref_name(name: &str) -> FractalResult<()> {
    let invalid_component = name
        .split('/')
        .any(|component| component.is_empty() || component.starts_with('.'));
    let invalid = name.is_empty()
        || !name.starts_with("refs/")
        || name.ends_with('/')
        || name.ends_with('.')
        || name.contains("..")
        || name.contains("//")
        || name.contains("@{")
        || name.contains('\\')
        || name
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
        || invalid_component
        || name
            .split('/')
            .any(|component| component.ends_with(REF_LOCK_SUFFIX));
    if invalid {
        return Err(FractalError::PolicyViolation(format!(
            "bundle reference name '{name}' is not a valid loose reference"
        )));
    }
    Ok(())
}

/// Validates a reference-shaped name when following symbolic references, allowing `HEAD` itself.
fn validate_ref_name_like(name: &str) -> FractalResult<()> {
    if name == "HEAD" {
        return Ok(());
    }
    validate_ref_name(name)
}

/// Joins a reference name onto the git directory while refusing path escapes.
fn ref_path_inside(git_dir: &Path, name: &str) -> FractalResult<PathBuf> {
    let joined = git_dir.join(name);
    if !joined.starts_with(git_dir) {
        return Err(FractalError::PolicyViolation(format!(
            "reference path '{name}' escapes the git directory"
        )));
    }
    Ok(joined)
}

/// Publishes one reference update with compare-and-swap semantics under a `<name>.lock` file.
fn cas_write_ref(git_dir: &Path, update: &BundleRefUpdate) -> FractalResult<()> {
    let name = update.target.as_str();
    let lock_path = ref_path_inside(git_dir, &format!("{name}{REF_LOCK_SUFFIX}"))?;
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent).map_err(FractalError::Io)?;
    }

    let mut lock_file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
    {
        Ok(file) => file,
        Err(open_error) if open_error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(FractalError::RefConflict(format!(
                "reference '{name}' is locked by another writer at '{}'",
                lock_path.display()
            )));
        }
        Err(open_error) => return Err(FractalError::Io(open_error)),
    };

    if let Err(write_error) = write_locked_ref(git_dir, update, &mut lock_file) {
        drop(lock_file);
        let _ = fs::remove_file(&lock_path);
        return Err(write_error);
    }
    drop(lock_file);

    let target_path = ref_path_inside(git_dir, name)?;
    if let Err(rename_error) = fs::rename(&lock_path, &target_path) {
        let _ = fs::remove_file(&lock_path);
        return Err(FractalError::Io(rename_error));
    }
    Ok(())
}

/// Verifies the expected old value under the lock and writes the new object id into the lock file.
fn write_locked_ref(
    git_dir: &Path,
    update: &BundleRefUpdate,
    lock_file: &mut File,
) -> FractalResult<()> {
    let name = update.target.as_str();
    let current = current_target_oid(git_dir, name)?;
    if current != update.expected_old {
        return Err(FractalError::RefConflict(format!(
            "CAS ref update conflict on {name}: expected {:?}, got {:?}",
            update.expected_old.map(|oid| oid.to_hex()),
            current.map(|oid| oid.to_hex()),
        )));
    }
    lock_file
        .write_all(format!("{}\n", update.new_oid.to_hex()).as_bytes())
        .map_err(FractalError::Io)?;
    lock_file.sync_all().map_err(FractalError::Io)
}

/// Re-reads the current value of a planned write target.
fn current_target_oid(git_dir: &Path, target_name: &str) -> FractalResult<Option<Oid>> {
    if target_name == "HEAD" {
        return match read_head_state(git_dir)? {
            HeadState::Detached(current_oid) => Ok(Some(current_oid)),
            HeadState::Absent => Ok(None),
            HeadState::Symbolic(_) => Err(FractalError::RefConflict(
                "HEAD became symbolic while the bundle ingest held its lock".into(),
            )),
        };
    }
    read_ref_oid(git_dir, target_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fg_algorithms::pack::PackDeltaItem;
    use fg_core::models::ObjectKind;

    fn test_temp_dir(prefix: &str) -> tempfile::TempDir {
        let base = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        tempfile::Builder::new()
            .prefix(prefix)
            .tempdir_in(&base)
            .or_else(|_| tempfile::tempdir())
            .expect("create test tempdir")
    }

    /// Writes a one-object bundle and returns its on-disk length.
    fn write_synthetic_bundle(bundle_path: &Path, oid: Oid, ref_name: &str) -> u64 {
        let item = PackDeltaItem::new(
            oid,
            ObjectKind::Blob,
            b"Sample blob inside bundle".to_vec(),
            None,
        );
        let chains = fg_algorithms::pack::find_pack_deltas(vec![item], 10, 50);
        let mut bundle_file = File::create(bundle_path).expect("create bundle");
        let references = vec![(oid, ref_name.to_string())];
        BundleEngine::write_bundle(&mut bundle_file, &[], &references, &chains)
            .expect("write bundle");
        bundle_file.flush().expect("flush");
        let bundle_len = bundle_file.metadata().expect("meta").len();
        drop(bundle_file);
        bundle_len
    }

    #[test]
    fn test_consume_bundle_in_place_lifecycle() {
        let dir = test_temp_dir("bnd_consume_");
        let bundle_path = dir.path().join("source.bundle");
        let git_dir = dir.path().join("repo.git");
        fs::create_dir_all(&git_dir).expect("create repo git");

        // 1. Create a synthetic bundle with 1 object and 1 reference
        let oid1 = Oid::from_bytes([1u8; 20]);
        let initial_bundle_size = write_synthetic_bundle(&bundle_path, oid1, "refs/heads/main");
        assert!(initial_bundle_size > 0);

        // 2. Consume bundle in-place into repository
        let report = InPlaceBundleConsumer::consume_bundle_in_place(&bundle_path, &git_dir)
            .expect("consume in place");

        assert_eq!(report.object_count, 1);
        assert_eq!(report.references_advanced.len(), 1);
        assert_eq!(report.bundle_bytes_reclaimed, initial_bundle_size);
        assert!(report.source_truncated);
        assert_eq!(report.source_retained_bytes, 0);

        // 3. Verify bundle file was truncated to 0
        let truncated_len = fs::metadata(&bundle_path).expect("bundle meta").len();
        assert_eq!(truncated_len, 0);

        // 4. Verify reference was written
        let ref_content = fs::read_to_string(git_dir.join("refs/heads/main")).expect("read ref");
        assert!(ref_content.contains(&oid1.to_hex()));
    }

    #[test]
    fn test_consume_bundle_default_retains_source() {
        let dir = test_temp_dir("bnd_retain_");
        let bundle_path = dir.path().join("source.bundle");
        let git_dir = dir.path().join("repo.git");
        fs::create_dir_all(&git_dir).expect("create repo git");

        let oid = Oid::from_bytes([4u8; 20]);
        write_synthetic_bundle(&bundle_path, oid, "refs/heads/main");
        let original_bytes = fs::read(&bundle_path).expect("read bundle");

        let report = InPlaceBundleConsumer::consume_bundle(
            &bundle_path,
            &git_dir,
            &BundleConsumeOptions::default(),
        )
        .expect("consume bundle without truncation");

        assert!(!report.source_truncated);
        assert_eq!(report.source_retained_bytes, original_bytes.len() as u64);
        assert_eq!(report.bundle_bytes_reclaimed, 0);
        assert_eq!(
            fs::read(&bundle_path).expect("reread bundle"),
            original_bytes,
            "default consumption must leave the source bundle byte-for-byte intact"
        );
        let ref_content = fs::read_to_string(git_dir.join("refs/heads/main")).expect("read ref");
        assert_eq!(ref_content.trim(), oid.to_hex());
    }

    #[test]
    fn test_consume_bundle_rejects_corrupted_trailer_without_side_effects() {
        let dir = test_temp_dir("bnd_corrupt_");
        let bundle_path = dir.path().join("source.bundle");
        let git_dir = dir.path().join("repo.git");
        fs::create_dir_all(&git_dir).expect("create repo git");

        let oid = Oid::from_bytes([2u8; 20]);
        write_synthetic_bundle(&bundle_path, oid, "refs/heads/main");
        let mut corrupted_bytes = fs::read(&bundle_path).expect("read bundle");
        let trailer_byte = corrupted_bytes.last_mut().expect("bundle has a trailer");
        *trailer_byte ^= 0xFF;
        fs::write(&bundle_path, &corrupted_bytes).expect("write corrupted bundle");

        let result = InPlaceBundleConsumer::consume_bundle(
            &bundle_path,
            &git_dir,
            &BundleConsumeOptions::default(),
        );
        assert!(result.is_err(), "corrupted pack trailer must be rejected");
        assert_eq!(
            fs::read(&bundle_path).expect("reread bundle"),
            corrupted_bytes,
            "a rejected bundle must keep its exact bytes"
        );
        assert!(
            !git_dir.join("refs/heads/main").exists(),
            "no reference may advance when the trailer checksum fails"
        );
    }

    #[test]
    fn test_consume_bundle_rejects_locked_reference() {
        let dir = test_temp_dir("bnd_locked_");
        let bundle_path = dir.path().join("source.bundle");
        let git_dir = dir.path().join("repo.git");
        fs::create_dir_all(git_dir.join("refs/heads")).expect("create refs dir");

        let bundle_oid = Oid::from_bytes([3u8; 20]);
        write_synthetic_bundle(&bundle_path, bundle_oid, "refs/heads/main");
        let original_bytes = fs::read(&bundle_path).expect("read bundle");

        fs::write(
            git_dir.join("refs/heads/main.lock"),
            "held by another writer\n",
        )
        .expect("seed reference lock");

        let result = InPlaceBundleConsumer::consume_bundle(
            &bundle_path,
            &git_dir,
            &BundleConsumeOptions::default(),
        );
        assert!(
            matches!(result, Err(FractalError::RefConflict(_))),
            "an already locked reference must be refused, got {result:?}"
        );
        assert!(
            !git_dir.join("refs/heads/main").exists(),
            "a refused ingest must not create the reference"
        );
        assert_eq!(
            fs::read(&bundle_path).expect("reread bundle"),
            original_bytes,
            "a refused ingest must keep the source bundle byte-for-byte intact"
        );
    }

    #[test]
    fn test_cas_write_ref_rejects_mismatched_expected_old() {
        let dir = test_temp_dir("bnd_cas_");
        let git_dir = dir.path().join("repo.git");
        fs::create_dir_all(git_dir.join("refs/heads")).expect("create refs dir");

        let existing_oid = Oid::from_bytes([9u8; 20]);
        let ref_path = git_dir.join("refs/heads/main");
        fs::write(&ref_path, format!("{}\n", existing_oid.to_hex())).expect("seed existing ref");

        let stale_update = BundleRefUpdate {
            target: "refs/heads/main".to_string(),
            expected_old: Some(Oid::from_bytes([7u8; 20])),
            new_oid: Oid::from_bytes([8u8; 20]),
        };
        let result = cas_write_ref(&git_dir, &stale_update);
        assert!(
            matches!(result, Err(FractalError::RefConflict(_))),
            "a stale expected value must be refused, got {result:?}"
        );
        let ref_content = fs::read_to_string(&ref_path).expect("read ref");
        assert_eq!(ref_content.trim(), existing_oid.to_hex());
        assert!(
            !git_dir.join("refs/heads/main.lock").exists(),
            "a refused compare-and-swap must release its lock file"
        );
    }
}
