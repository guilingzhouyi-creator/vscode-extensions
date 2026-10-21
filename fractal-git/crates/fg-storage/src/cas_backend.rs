//! Module: fg-storage — Content-Addressed Block Storage (CAS)
//! File Path: crates/fg-storage/src/cas_backend.rs
//! Architecture Role: Pure immutable content-addressed storage backend for LayerVFS chunks,
//!   enabling deduplicated block persistence and cryptographic integrity validation.

use crate::delta_codec::{decode_block_payload, select_block_encoding, EncodedBlock};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fg_pools::ByteLruCache;
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};

/// Default in-memory block cache capacity for CasBackend (64 MiB).
pub const DEFAULT_CAS_CACHE_BYTES: usize = 64 * 1024 * 1024;

/// Disk-backed Content-Addressed Block Store with integrated byte-budgeted LRU cache.
pub struct CasBackend {
    root_dir: PathBuf,
    cache: Option<ByteLruCache<Oid, Vec<u8>>>,
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

    /// Stores a raw binary block into CAS. Returns computed Oid.
    pub fn put_block(&self, payload_bytes: &[u8]) -> FractalResult<Oid> {
        self.put_block_with_base(payload_bytes, None)
    }

    fn resolve_candidate_base(&self, base_oid: Option<&Oid>) -> Option<(Oid, Vec<u8>)> {
        let candidate_base_oid = base_oid?;
        let base_bytes = self.get_block(candidate_base_oid).ok()?;
        Some((*candidate_base_oid, base_bytes))
    }

    fn write_encoded_block(
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
                let mut encoded_buffer = Vec::with_capacity(1 + 20 + 1 + delta_payload.len());
                encoded_buffer.push(0x03);
                encoded_buffer.extend_from_slice(admitted_base_oid.as_bytes());
                encoded_buffer.push(depth as u8);
                encoded_buffer.extend_from_slice(&delta_payload);

                let staging_path = pfx_path.with_extension("tmp");
                fs::write(&staging_path, &encoded_buffer)?;
                fs::rename(&staging_path, pfx_path)?;
            }
            EncodedBlock::Full { .. } => {
                let staging_path = path.with_extension("tmp");
                fs::write(&staging_path, payload_bytes)?;
                fs::rename(&staging_path, path)?;
            }
        }
        Ok(())
    }

    /// Stores a binary block into CAS with an optional historical base candidate for
    /// delta compression.
    pub fn put_block_with_base(
        &self,
        payload_bytes: &[u8],
        base_oid: Option<&Oid>,
    ) -> FractalResult<Oid> {
        let mut hasher = Sha1::new();
        hasher.update(payload_bytes);
        let hash: [u8; 20] = hasher.finalize().into();
        let oid = Oid::from_bytes(hash);

        let path = self.block_path(&oid);
        let pfx_path = self.pfx_block_path(&oid);

        if path.exists() || pfx_path.exists() {
            if let Some(ref cache) = self.cache {
                cache.insert(oid, payload_bytes.to_vec(), payload_bytes.len());
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

        Self::write_encoded_block(encoding, &path, &pfx_path, payload_bytes)?;

        if let Some(ref cache) = self.cache {
            cache.insert(oid, payload_bytes.to_vec(), payload_bytes.len());
        }

        Ok(oid)
    }

    /// Reads a block from CAS with strict cryptographic hash verification.
    pub fn get_block(&self, oid: &Oid) -> FractalResult<Vec<u8>> {
        if let Some(ref cache) = self.cache {
            if let Some(cached) = cache.get(oid) {
                return Ok(cached);
            }
        }

        let path = self.block_path(oid);
        let pfx_path = self.pfx_block_path(oid);

        let block_bytes = if path.exists() {
            fs::read(&path)?
        } else if pfx_path.exists() {
            let pfx_bytes = fs::read(&pfx_path)?;
            if pfx_bytes.len() < 22 || pfx_bytes[0] != 0x03 {
                return Err(FractalError::ObjectCodec(format!(
                    "Corrupted prefix block header for {}",
                    oid.to_hex()
                )));
            }
            let mut base_hash = [0u8; 20];
            base_hash.copy_from_slice(&pfx_bytes[1..21]);
            let base_oid = Oid::from_bytes(base_hash);
            let depth = pfx_bytes[21] as usize;
            let delta_payload = pfx_bytes[22..].to_vec();

            let encoded = EncodedBlock::PrefixDelta {
                base_oid,
                depth,
                delta_payload,
            };

            decode_block_payload(&encoded, |required_base_oid| {
                self.get_block(required_base_oid)
            })?
        } else {
            return Err(FractalError::ObjectCodec(format!(
                "CAS block not found: {}",
                oid.to_hex()
            )));
        };

        let mut hasher = Sha1::new();
        hasher.update(&block_bytes);
        let computed: [u8; 20] = hasher.finalize().into();

        if &computed != oid.as_bytes() {
            return Err(FractalError::ObjectCodec(format!(
                "CAS block corruption detected: expected {}, got {}",
                oid.to_hex(),
                Oid::from_bytes(computed).to_hex()
            )));
        }

        if let Some(ref cache) = self.cache {
            cache.insert(*oid, block_bytes.clone(), block_bytes.len());
        }

        Ok(block_bytes)
    }

    /// Checks if target block exists without reading full bytes.
    pub fn has_block(&self, oid: &Oid) -> bool {
        if let Some(ref cache) = self.cache {
            if cache.get(oid).is_some() {
                return true;
            }
        }
        self.block_path(oid).exists() || self.pfx_block_path(oid).exists()
    }
}
