//! Module: fg-storage — Loose Git Object Database Store
//! File Path: crates/fg-storage/src/loose.rs
//! Architecture Role: Implements `OdbStore` for standard on-disk Git loose object storage
//!   (`.git/objects/xx/yyyy...`) with zlib compression, pooled staging buffers, and atomic writes.
//! Dependencies & Triggers: Consumed by commit materialization, CAS bridge, projection, and CLI reads.
//! Responsibilities: Persist canonical `<type> <len>\0<payload>` loose objects atomically with zlib
//!   level-1 framing, decompress loose objects through thread-cached `PageBufferPool` guards without
//!   draining pool capacity, and serve hot reads from an `Arc<[u8]>` byte-budgeted LRU cache.
//! Exit Semantics & Design Rationale:
//!   - `ByteLruCache` stores `Arc<[u8]>` so cache lookups bump an atomic reference count under the
//!     mutex instead of cloning multi-megabyte buffers while holding the shard lock (`FGT-PRF-001`).
//!   - `PooledBuffer` is borrowed as `&[u8]` rather than `take()`n so buffers return to the pool warm.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-PRF-001`: Zero transient heap allocation guard in hot paths
//! - `FGT-POL-001`: Memory pool capacity retention guard

use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use sha1::{Digest, Sha1};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fg_core::traits::OdbStore;
use fg_core::write_file_atomic;
use fg_pools::{BufferSizeClass, ByteLruCache, PageBufferPool};

/// Default in-memory object cache capacity for LooseOdb (32 MiB).
pub const DEFAULT_ODB_CACHE_BYTES: usize = 32 * 1024 * 1024;

/// On-disk loose object database backend with integrated byte-budgeted LRU cache.
pub struct LooseOdb {
    git_dir: PathBuf,
    cache: Option<ByteLruCache<Oid, Arc<[u8]>>>,
    pool: PageBufferPool,
}

impl LooseOdb {
    /// Creates a loose object database handle for target `.git` repository directory
    /// with default 32 MiB cache.
    pub fn new(git_dir: impl Into<PathBuf>) -> Self {
        Self::with_cache_budget(git_dir, DEFAULT_ODB_CACHE_BYTES)
    }

    /// Creates a loose object database handle with a custom byte-budgeted LRU cache.
    pub fn with_cache_budget(git_dir: impl Into<PathBuf>, max_bytes: usize) -> Self {
        Self {
            git_dir: git_dir.into(),
            cache: if max_bytes > 0 {
                Some(ByteLruCache::new(max_bytes))
            } else {
                None
            },
            pool: PageBufferPool::default(),
        }
    }

    /// Creates a loose object database handle without in-memory caching.
    pub fn without_cache(git_dir: impl Into<PathBuf>) -> Self {
        Self {
            git_dir: git_dir.into(),
            cache: None,
            pool: PageBufferPool::default(),
        }
    }

    /// Returns the current memory usage of the cache in bytes.
    pub fn cache_bytes(&self) -> usize {
        self.cache
            .as_ref()
            .map(|object_cache| object_cache.current_bytes())
            .unwrap_or(0)
    }

    /// Returns the number of cached objects.
    pub fn cache_len(&self) -> usize {
        self.cache
            .as_ref()
            .map(|object_cache| object_cache.len())
            .unwrap_or(0)
    }

    /// Computes the disk path for a loose object by its OID.
    pub fn object_path(git_dir: &Path, oid: &Oid) -> PathBuf {
        let hex = oid.to_hex();
        let (dir_name, file_name) = hex.split_at(2);
        let mut path = git_dir.to_path_buf();
        path.push("objects");
        path.push(dir_name);
        path.push(file_name);
        path
    }

    /// Directly writes a raw loose object payload atomically.
    pub fn write_loose_object_raw(
        git_dir: &Path,
        oid: &Oid,
        raw_payload: &[u8],
    ) -> FractalResult<()> {
        let obj_path = Self::object_path(git_dir, oid);
        if obj_path.exists() {
            return Ok(()); // Object is immutable and already present
        }

        if let Some(parent) = obj_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Compress with zlib level 1: Git writes loose objects at Z_BEST_SPEED. The level is matched
        // for speed and usual stream parity, but the emitted bytes are still implementation-defined
        // (flate2 uses miniz_oxide, Git links zlib), so object identity must never depend on them.
        let initial_comp_cap = (raw_payload.len() / 2 + 64).max(256);
        let mut encoder =
            ZlibEncoder::new(Vec::with_capacity(initial_comp_cap), Compression::new(1));
        encoder.write_all(raw_payload)?;
        let compressed = encoder.finish()?;

        write_file_atomic(&obj_path, &compressed, true)?;
        Ok(())
    }
}

/// Convenience function to write a loose Git object from hex OID.
pub fn write_loose_object(git_dir: &Path, oid_hex: &str, raw_payload: &[u8]) -> FractalResult<()> {
    let oid = Oid::from_hex(oid_hex)?;
    LooseOdb::write_loose_object_raw(git_dir, &oid, raw_payload)
}

impl OdbStore for LooseOdb {
    fn read_object(&self, oid: &Oid) -> FractalResult<Vec<u8>> {
        if let Some(ref cache) = self.cache {
            if let Some(cached) = cache.get(oid) {
                return Ok(cached.as_ref().to_vec());
            }
        }

        let path = Self::object_path(&self.git_dir, oid);
        let compressed_bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => {
                return Err(FractalError::ObjectCodec(format!(
                    "Object not found: {}",
                    oid.to_hex()
                )));
            }
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };

        let mut decoder = ZlibDecoder::new(&compressed_bytes[..]);
        let mut pooled_buffer = self.pool.acquire_guard_sized(BufferSizeClass::Page);
        pooled_buffer.clear();
        decoder.read_to_end(&mut pooled_buffer)?;

        // Build the shared owner once, from the pooled buffer, and hand the same bytes to both the
        // cache and the caller. The previous form copied inflate -> pooled -> Vec -> Arc and then
        // copied again on every cache hit, which cost roughly three full memcpys per object and
        // made the pool pointless: its buffer was written and immediately abandoned.
        let shared: Arc<[u8]> = Arc::from(pooled_buffer.as_slice());
        if let Some(ref cache) = self.cache {
            cache.insert(*oid, Arc::clone(&shared), shared.len());
        }

        Ok(shared.as_ref().to_vec())
    }

    fn write_object(&self, object_type: &str, payload: &[u8]) -> FractalResult<Oid> {
        let mut pooled_buffer = self.pool.acquire_guard_sized(BufferSizeClass::Page);
        pooled_buffer.clear();
        write!(pooled_buffer, "{} {}\0", object_type, payload.len())?;
        pooled_buffer.extend_from_slice(payload);

        let mut hasher = Sha1::new();
        hasher.update(&pooled_buffer);
        let hash: [u8; 20] = hasher.finalize().into();
        let oid = Oid::from_bytes(hash);

        Self::write_loose_object_raw(&self.git_dir, &oid, &pooled_buffer)?;

        if let Some(ref cache) = self.cache {
            let size = pooled_buffer.len();
            cache.insert(oid, Arc::<[u8]>::from(pooled_buffer.as_slice()), size);
        }

        Ok(oid)
    }

    fn has_object(&self, oid: &Oid) -> bool {
        if let Some(ref cache) = self.cache {
            if cache.contains(oid) {
                return true;
            }
        }
        Self::object_path(&self.git_dir, oid).exists()
    }
}
