//! Module: fg-storage — Content-Addressed Block Storage (CAS)
//! File Path: crates/fg-storage/src/cas_backend.rs
//! Architecture Role: Pure immutable content-addressed storage backend for LayerVFS chunks,
//!   enabling deduplicated block persistence and cryptographic integrity validation.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use sha1::{Digest, Sha1};
use std::fs;
use std::path::PathBuf;

/// Disk-backed Content-Addressed Block Store.
pub struct CasBackend {
    root_dir: PathBuf,
}

impl CasBackend {
    /// Opens or initializes a CAS store at target directory.
    pub fn new(root_dir: impl Into<PathBuf>) -> Self {
        let root = root_dir.into();
        Self { root_dir: root }
    }

    /// Computes the disk path for a CAS block by its OID.
    pub fn block_path(&self, oid: &Oid) -> PathBuf {
        let hex = oid.to_hex();
        let (dir, file) = hex.split_at(2);
        self.root_dir.join("blocks").join(dir).join(file)
    }

    /// Stores a raw binary block into CAS. Returns computed Oid.
    pub fn put_block(&self, data: &[u8]) -> FractalResult<Oid> {
        let mut hasher = Sha1::new();
        hasher.update(data);
        let hash: [u8; 20] = hasher.finalize().into();
        let oid = Oid::from_bytes(hash);

        let path = self.block_path(&oid);
        if path.exists() {
            return Ok(oid); // Deduplicated immutable block
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let temp_path = path.with_extension("tmp");
        fs::write(&temp_path, data)?;
        fs::rename(&temp_path, &path)?;
        Ok(oid)
    }

    /// Reads a block from CAS with strict cryptographic hash verification.
    pub fn get_block(&self, oid: &Oid) -> FractalResult<Vec<u8>> {
        let path = self.block_path(oid);
        if !path.exists() {
            return Err(FractalError::ObjectCodec(format!(
                "CAS block not found: {}",
                oid.to_hex()
            )));
        }

        let data = fs::read(&path)?;
        let mut hasher = Sha1::new();
        hasher.update(&data);
        let computed: [u8; 20] = hasher.finalize().into();

        if &computed != oid.as_bytes() {
            return Err(FractalError::ObjectCodec(format!(
                "CAS block corruption detected: expected {}, got {}",
                oid.to_hex(),
                Oid::from_bytes(computed).to_hex()
            )));
        }

        Ok(data)
    }

    /// Checks if target block exists without reading full bytes.
    pub fn has_block(&self, oid: &Oid) -> bool {
        self.block_path(oid).exists()
    }
}
