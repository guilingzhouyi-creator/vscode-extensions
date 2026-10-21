//! Module: fg-storage — Loose Git Object Database Store
//! File Path: crates/fg-storage/src/loose.rs
//! Architecture Role: Implements OdbStore trait for standard on-disk Git loose object storage
//!   (`.git/objects/xx/yyyy...`) with zlib compression and atomic temporary file renames.

use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use sha1::{Digest, Sha1};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fg_core::traits::OdbStore;
use fg_pools::{BufferSizeClass, ByteLruCache, PageBufferPool};

/// Default in-memory object cache capacity for LooseOdb (32 MiB).
pub const DEFAULT_ODB_CACHE_BYTES: usize = 32 * 1024 * 1024;

/// On-disk loose object database backend with integrated byte-budgeted LRU cache.
pub struct LooseOdb {
    git_dir: PathBuf,
    cache: Option<ByteLruCache<Oid, Vec<u8>>>,
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

        // Compress raw object payload with zlib default compression
        let initial_comp_cap = (raw_payload.len() / 2 + 64).max(256);
        let mut encoder =
            ZlibEncoder::new(Vec::with_capacity(initial_comp_cap), Compression::default());
        encoder.write_all(raw_payload)?;
        let compressed = encoder.finish()?;

        // Write to temporary sibling file and atomically rename to avoid partial writes
        let staging_path = obj_path.with_extension("tmp");
        {
            let mut file = File::create(&staging_path)?;
            file.write_all(&compressed)?;
            file.sync_all()?;
        }

        fs::rename(&staging_path, &obj_path)?;
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
                return Ok(cached);
            }
        }

        let path = Self::object_path(&self.git_dir, oid);
        if !path.exists() {
            return Err(FractalError::ObjectCodec(format!(
                "Object not found: {}",
                oid.to_hex()
            )));
        }

        let compressed_bytes = fs::read(&path)?;
        let mut decoder = ZlibDecoder::new(&compressed_bytes[..]);
        let mut pooled_buffer = self.pool.acquire_guard_sized(BufferSizeClass::Page);
        pooled_buffer.clear();
        decoder.read_to_end(&mut pooled_buffer)?;
        let uncompressed = pooled_buffer.take();

        if let Some(ref cache) = self.cache {
            let size = uncompressed.len();
            cache.insert(*oid, uncompressed.clone(), size);
        }

        Ok(uncompressed)
    }

    fn write_object(&self, object_type: &str, payload: &[u8]) -> FractalResult<Oid> {
        let mut pooled_buffer = self.pool.acquire_guard_sized(BufferSizeClass::Page);
        pooled_buffer.clear();
        use std::io::Write;
        write!(pooled_buffer, "{} {}\0", object_type, payload.len())?;
        pooled_buffer.extend_from_slice(payload);

        let mut hasher = Sha1::new();
        hasher.update(&pooled_buffer);
        let hash: [u8; 20] = hasher.finalize().into();
        let oid = Oid::from_bytes(hash);

        Self::write_loose_object_raw(&self.git_dir, &oid, &pooled_buffer)?;

        if let Some(ref cache) = self.cache {
            let size = pooled_buffer.len();
            cache.insert(oid, pooled_buffer.take(), size);
        }

        Ok(oid)
    }

    fn has_object(&self, oid: &Oid) -> bool {
        if let Some(ref cache) = self.cache {
            if cache.get(oid).is_some() {
                return true;
            }
        }
        Self::object_path(&self.git_dir, oid).exists()
    }
}
