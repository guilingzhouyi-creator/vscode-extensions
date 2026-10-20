//! Module: fg-storage — Content-Addressed Block Storage (CAS)
//! File Path: crates/fg-storage/src/cas_backend.rs
//! Architecture Role: Pure immutable content-addressed storage backend for LayerVFS chunks,
//!   enabling deduplicated block persistence and cryptographic integrity validation.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fg_pools::ByteLruCache;
use sha1::{Digest, Sha1};
use std::fs;
use std::path::PathBuf;

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
        self.root_dir.join("blocks").join(dir).join(file)
    }

    /// Stores a raw binary block into CAS. Returns computed Oid.
    pub fn put_block(&self, payload_bytes: &[u8]) -> FractalResult<Oid> {
        let mut hasher = Sha1::new();
        hasher.update(payload_bytes);
        let hash: [u8; 20] = hasher.finalize().into();
        let oid = Oid::from_bytes(hash);

        let path = self.block_path(&oid);
        if path.exists() {
            if let Some(ref cache) = self.cache {
                cache.insert(oid, payload_bytes.to_vec(), payload_bytes.len());
            }
            return Ok(oid); // Deduplicated immutable block
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let staging_path = path.with_extension("tmp");
        fs::write(&staging_path, payload_bytes)?;
        fs::rename(&staging_path, &path)?;

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
        if !path.exists() {
            return Err(FractalError::ObjectCodec(format!(
                "CAS block not found: {}",
                oid.to_hex()
            )));
        }

        let block_bytes = fs::read(&path)?;
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
        self.block_path(oid).exists()
    }
}
