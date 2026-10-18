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

/// On-disk loose object database backend.
pub struct LooseOdb {
    git_dir: PathBuf,
}

impl LooseOdb {
    /// Creates a loose object database handle for target `.git` repository directory.
    pub fn new(git_dir: impl Into<PathBuf>) -> Self {
        Self {
            git_dir: git_dir.into(),
        }
    }

    /// Computes the disk path for a loose object by its OID.
    pub fn object_path(git_dir: &Path, oid: &Oid) -> PathBuf {
        let hex = oid.to_hex();
        let (dir_name, file_name) = hex.split_at(2);
        git_dir.join("objects").join(dir_name).join(file_name)
    }

    /// Directly writes a raw loose object payload atomically.
    pub fn write_loose_object_raw(git_dir: &Path, oid: &Oid, raw_payload: &[u8]) -> FractalResult<()> {
        let obj_path = Self::object_path(git_dir, oid);
        if obj_path.exists() {
            return Ok(()); // Object is immutable and already present
        }

        if let Some(parent) = obj_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Compress raw object payload with zlib default compression
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(raw_payload)?;
        let compressed = encoder.finish()?;

        // Write to temporary sibling file and atomically rename to avoid partial writes
        let temp_path = obj_path.with_extension("tmp");
        {
            let mut file = File::create(&temp_path)?;
            file.write_all(&compressed)?;
            file.sync_all()?;
        }

        fs::rename(&temp_path, &obj_path)?;
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
        let path = Self::object_path(&self.git_dir, oid);
        if !path.exists() {
            return Err(FractalError::ObjectCodec(format!(
                "Object not found: {}",
                oid.to_hex()
            )));
        }

        let compressed_data = fs::read(&path)?;
        let mut decoder = ZlibDecoder::new(&compressed_data[..]);
        let mut uncompressed = Vec::new();
        decoder.read_to_end(&mut uncompressed)?;

        Ok(uncompressed)
    }

    fn write_object(&self, object_type: &str, payload: &[u8]) -> FractalResult<Oid> {
        let header = format!("{} {}\0", object_type, payload.len());
        let mut raw = Vec::with_capacity(header.len() + payload.len());
        raw.extend_from_slice(header.as_bytes());
        raw.extend_from_slice(payload);

        let mut hasher = Sha1::new();
        hasher.update(&raw);
        let hash: [u8; 20] = hasher.finalize().into();
        let oid = Oid::from_bytes(hash);

        Self::write_loose_object_raw(&self.git_dir, &oid, &raw)?;
        Ok(oid)
    }

    fn has_object(&self, oid: &Oid) -> bool {
        Self::object_path(&self.git_dir, oid).exists()
    }
}
