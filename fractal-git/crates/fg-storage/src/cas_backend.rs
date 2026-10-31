//! Module: fg-storage — Content-Addressed Block Storage (CAS)
//! File Path: crates/fg-storage/src/cas_backend.rs
//! Architecture Role: Pure immutable content-addressed storage backend for LayerVFS chunks,
//!   enabling deduplicated block persistence and cryptographic integrity validation.
//! Dependencies & Triggers: Consumed by the LayerVFS materializer bridge, the projection layer, and
//!   every command that reads a stored object back.
//! Responsibilities: Store and retrieve blocks keyed by canonical Git object id, apply prefix-delta
//!   compression against an optional base, and verify integrity on every read.
//! Exit Semantics & Design Rationale:
//!   - The block key is `sha1("<type> <len>\0" || payload)`, the same id Git computes, not
//!     `sha1(payload)`. A payload-only hash forces the projection layer to carry a full id mapping
//!     table, and the table is the thing that goes stale first.
//!   - The object type is a required parameter rather than a defaulted `Blob`. Defaulting would let
//!     a tree be stored under a blob's id, and the corruption would only surface when a reader
//!     verified the id against the wrong type.
//!   - Verification on read recomputes the id from the recovered bytes, so a block whose delta
//!     chain reconstructs different content is reported rather than returned.
//!   - Physical encoding (raw block or `.pfx` delta) is native; only the identifier is aligned with
//!     Git.
//!
//! Domain Governance Rules: FGT-STO-001 (storage integrity), FGT-COR-001, FGT-PRF-001.

use crate::delta_codec::{decode_block_payload, select_block_encoding, EncodedBlock};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{compute_object_oid, ObjectKind, Oid};
use fg_core::write_file_atomic;
use fg_pools::ByteLruCache;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Default in-memory block cache capacity for CasBackend (64 MiB).
pub const DEFAULT_CAS_CACHE_BYTES: usize = 64 * 1024 * 1024;

/// Leading tag byte identifying a prefix-delta block file.
const PFX_TAG: u8 = 0x03;

/// Width of a prefix-delta block header: tag (1) + kind (1) + base id (20) + depth (1).
const PFX_HEADER_LEN: usize = 23;

/// Splits a stored full block into its recorded kind and payload.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when the file is empty or the kind byte is not one of the
/// four object kinds. An unknown kind means the block was written by a build this one cannot read,
/// and guessing would verify the id against the wrong type.
fn split_full_block<'a>(oid: &Oid, stored: &'a [u8]) -> FractalResult<(ObjectKind, &'a [u8])> {
    let (kind_byte, payload) = stored
        .split_first()
        .ok_or_else(|| FractalError::ObjectCodec(format!("CAS block {} is empty", oid.to_hex())))?;
    let kind = ObjectKind::from_u8(*kind_byte).ok_or_else(|| {
        FractalError::ObjectCodec(format!(
            "CAS block {} carries unknown object kind {}",
            oid.to_hex(),
            kind_byte
        ))
    })?;
    Ok((kind, payload))
}

/// Disk-backed Content-Addressed Block Store with integrated byte-budgeted LRU cache.
pub struct CasBackend {
    root_dir: PathBuf,
    cache: Option<ByteLruCache<Oid, Arc<[u8]>>>,
}

impl CasBackend {
    /// Opens or initializes a CAS store at target directory with default 64 MiB cache.
    pub fn new(root_dir: impl Into<PathBuf>) -> Self {
        Self::with_cache_budget(root_dir, DEFAULT_CAS_CACHE_BYTES)
    }

    /// Opens or initializes a CAS store with a custom byte-budgeted LRU cache.
    pub fn with_cache_budget(root_dir: impl Into<PathBuf>, max_bytes: usize) -> Self {
        Self {
            root_dir: root_dir.into(),
            cache: if max_bytes > 0 {
                Some(ByteLruCache::new(max_bytes))
            } else {
                None
            },
        }
    }

    /// Opens or initializes a CAS store without in-memory caching.
    pub fn without_cache(root_dir: impl Into<PathBuf>) -> Self {
        Self {
            root_dir: root_dir.into(),
            cache: None,
        }
    }

    /// Returns the current memory usage of the cache in bytes.
    pub fn cache_bytes(&self) -> usize {
        self.cache
            .as_ref()
            .map(|block_cache| block_cache.current_bytes())
            .unwrap_or(0)
    }

    /// Returns the number of cached blocks.
    pub fn cache_len(&self) -> usize {
        self.cache
            .as_ref()
            .map(|block_cache| block_cache.len())
            .unwrap_or(0)
    }

    /// Computes the disk path for a CAS block by its OID.
    pub fn block_path(&self, oid: &Oid) -> PathBuf {
        let hex = oid.to_hex();
        let (dir, file) = hex.split_at(2);
        let mut path = self.root_dir.clone();
        path.push("blocks");
        path.push(dir);
        path.push(file);
        path
    }

    /// Computes the disk path for a prefix-delta compressed CAS block.
    pub fn pfx_block_path(&self, oid: &Oid) -> PathBuf {
        self.block_path(oid).with_extension("pfx")
    }

    /// Stores a raw binary block of `kind` into CAS and returns its Git object id.
    pub fn put_block(&self, kind: ObjectKind, payload_bytes: &[u8]) -> FractalResult<Oid> {
        self.put_block_with_base(kind, payload_bytes, None)
    }

    fn resolve_candidate_base(&self, base_oid: Option<&Oid>) -> Option<(Oid, Vec<u8>)> {
        let candidate_base_oid = base_oid?;
        let base_bytes = self.get_block(candidate_base_oid).ok()?;
        Some((*candidate_base_oid, base_bytes))
    }

    fn write_encoded_block(
        kind: ObjectKind,
        encoding: EncodedBlock,
        path: &Path,
        pfx_path: &Path,
        payload_bytes: &[u8],
    ) -> FractalResult<()> {
        match encoding {
            EncodedBlock::PrefixDelta {
                base_oid: admitted_base_oid,
                depth,
                delta_payload,
            } => {
                let mut encoded_buffer = Vec::with_capacity(2 + 20 + 1 + delta_payload.len());
                encoded_buffer.push(PFX_TAG);
                encoded_buffer.push(kind.as_u8());
                encoded_buffer.extend_from_slice(admitted_base_oid.as_bytes());
                encoded_buffer.push(depth as u8);
                encoded_buffer.extend_from_slice(&delta_payload);

                write_file_atomic(pfx_path, &encoded_buffer, false)?;
            }
            EncodedBlock::Full { .. } => {
                let mut full_buffer = Vec::with_capacity(1 + payload_bytes.len());
                full_buffer.push(kind.as_u8());
                full_buffer.extend_from_slice(payload_bytes);

                write_file_atomic(path, &full_buffer, false)?;
            }
        }
        Ok(())
    }

    /// Stores a binary block into CAS with an optional historical base candidate for
    /// delta compression.
    ///
    /// The object kind is recorded in the block header so a later read can re-derive the id from
    /// the recovered bytes without the caller having to remember what was stored.
    pub fn put_block_with_base(
        &self,
        kind: ObjectKind,
        payload_bytes: &[u8],
        base_oid: Option<&Oid>,
    ) -> FractalResult<Oid> {
        let oid = compute_object_oid(kind, payload_bytes);

        let path = self.block_path(&oid);
        let pfx_path = self.pfx_block_path(&oid);

        if path.exists() || pfx_path.exists() {
            if let Some(ref cache) = self.cache {
                cache.insert(oid, Arc::<[u8]>::from(payload_bytes), payload_bytes.len());
            }
            return Ok(oid); // Deduplicated immutable block
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let candidate_base = self.resolve_candidate_base(base_oid);
        let encoding = match candidate_base {
            Some((ref target_base_oid, ref target_base_bytes)) => {
                select_block_encoding(Some((target_base_oid, target_base_bytes, 0)), payload_bytes)?
            }
            None => EncodedBlock::Full {
                data: payload_bytes.to_vec(),
            },
        };

        Self::write_encoded_block(kind, encoding, &path, &pfx_path, payload_bytes)?;

        if let Some(ref cache) = self.cache {
            cache.insert(oid, Arc::<[u8]>::from(payload_bytes), payload_bytes.len());
        }

        Ok(oid)
    }

    /// Reads a block from CAS and verifies it against its recorded object id.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] when the block is absent, its header is truncated or
    /// carries an unknown kind, or the recovered bytes do not hash to the requested id.
    pub fn get_block(&self, oid: &Oid) -> FractalResult<Vec<u8>> {
        if let Some(ref cache) = self.cache {
            if let Some(cached) = cache.get(oid) {
                return Ok(cached.as_ref().to_vec());
            }
        }
        self.get_block_with_kind(oid).map(|(_, payload)| payload)
    }

    /// Reads a block from CAS, returning its recorded object kind and payload.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] when the block is absent, its header is truncated or
    /// carries an unknown kind, or the recovered bytes do not hash to the requested id.
    pub fn get_block_with_kind(&self, oid: &Oid) -> FractalResult<(ObjectKind, Vec<u8>)> {
        let path = self.block_path(oid);
        let pfx_path = self.pfx_block_path(oid);

        let (kind, block_bytes) = match fs::read(&path) {
            Ok(stored) => {
                let (recorded_kind, payload) = split_full_block(oid, &stored)?;
                (recorded_kind, payload.to_vec())
            }
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => {
                if pfx_path.exists() {
                    self.read_delta_block(oid, &pfx_path)?
                } else {
                    return Err(FractalError::ObjectCodec(format!(
                        "CAS block not found: {}",
                        oid.to_hex()
                    )));
                }
            }
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };

        let computed = compute_object_oid(kind, &block_bytes);
        if &computed != oid {
            return Err(FractalError::ObjectCodec(format!(
                "CAS block corruption detected: expected {}, got {}",
                oid.to_hex(),
                computed.to_hex()
            )));
        }

        if let Some(ref cache) = self.cache {
            cache.insert(
                *oid,
                Arc::<[u8]>::from(block_bytes.as_slice()),
                block_bytes.len(),
            );
        }

        Ok((kind, block_bytes))
    }

    /// Reconstructs a delta-compressed block and returns the kind it was stored as.
    fn read_delta_block(&self, oid: &Oid, pfx_path: &Path) -> FractalResult<(ObjectKind, Vec<u8>)> {
        let pfx_bytes = fs::read(pfx_path)?;
        if pfx_bytes.len() < PFX_HEADER_LEN || pfx_bytes[0] != PFX_TAG {
            return Err(FractalError::ObjectCodec(format!(
                "Corrupted prefix block header for {}",
                oid.to_hex()
            )));
        }

        let kind = ObjectKind::from_u8(pfx_bytes[1]).ok_or_else(|| {
            FractalError::ObjectCodec(format!(
                "Prefix block {} carries unknown object kind {}",
                oid.to_hex(),
                pfx_bytes[1]
            ))
        })?;

        let mut base_hash = [0u8; 20];
        base_hash.copy_from_slice(&pfx_bytes[2..22]);
        let base_oid = Oid::from_bytes(base_hash);
        let depth = pfx_bytes[22] as usize;
        let delta_payload = pfx_bytes[PFX_HEADER_LEN..].to_vec();

        let encoded = EncodedBlock::PrefixDelta {
            base_oid,
            depth,
            delta_payload,
        };
        let block_bytes = decode_block_payload(&encoded, |required_base_oid| {
            self.get_block(required_base_oid)
        })?;

        Ok((kind, block_bytes))
    }

    /// Checks if target block exists without reading full bytes.
    pub fn has_block(&self, oid: &Oid) -> bool {
        if let Some(ref cache) = self.cache {
            if cache.contains(oid) {
                return true;
            }
        }
        self.block_path(oid).exists() || self.pfx_block_path(oid).exists()
    }

    /// Lists all object ids stored in this CAS instance.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] on filesystem read errors.
    pub fn list_all_oids(&self) -> FractalResult<Vec<Oid>> {
        let blocks_dir = if self.root_dir.join("blocks").is_dir() {
            self.root_dir.join("blocks")
        } else if self.root_dir.join("objects/blocks").is_dir() {
            self.root_dir.join("objects/blocks")
        } else {
            return Ok(Vec::new());
        };

        let mut oids = Vec::new();
        for dir_entry in fs::read_dir(&blocks_dir)? {
            let dir_entry = dir_entry?;
            if !dir_entry.file_type()?.is_dir() {
                continue;
            }
            let dir_name = dir_entry.file_name();
            let dir_str = dir_name.to_string_lossy();
            if dir_str.len() != 2 {
                continue;
            }
            Self::collect_fanout_oids(&dir_entry.path(), &dir_str, &mut oids)?;
        }
        oids.sort();
        oids.dedup();
        Ok(oids)
    }

    /// Gathers OIDs from a single 2-character fanout directory.
    fn collect_fanout_oids(
        fanout_dir: &Path,
        prefix: &str,
        oids: &mut Vec<Oid>,
    ) -> FractalResult<()> {
        for file_entry in fs::read_dir(fanout_dir)? {
            let file_entry = file_entry?;
            let file_name = file_entry.file_name();
            let mut file_str = file_name.to_string_lossy().into_owned();
            if file_str.ends_with(".pfx") {
                file_str.truncate(file_str.len() - 4);
            }
            if file_str.len() == 38 {
                let full_hex = format!("{prefix}{file_str}");
                if let Ok(oid) = Oid::from_hex(&full_hex) {
                    oids.push(oid);
                }
            }
        }
        Ok(())
    }
}
