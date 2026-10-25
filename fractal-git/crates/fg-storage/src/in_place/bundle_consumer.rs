//! Module: fg-storage — In-Place Bundle Consumer
//! File Path: crates/fg-storage/src/in_place/bundle_consumer.rs
//! Architecture Role: Consumes Git Bundle v2 files into repository ODB in-place,
//!   reclaiming disk space from the bundle file as pack objects are committed.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-TRN-001, FGT-COR-001.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;

use crate::backends::idx_writer::IdxWriter;
use crate::backends::pack_file::{DeltaBaseSource, PackFile};
use crate::bundle::BundleEngine;
use crate::in_place::tail_truncator::TailTruncator;

/// Resolver refusing external bases for standalone bundles.
struct BundleNoBase;

impl DeltaBaseSource for BundleNoBase {
    fn read_base(&self, _oid: &Oid) -> FractalResult<(fg_core::models::ObjectKind, Vec<u8>)> {
        Err(FractalError::CorruptStore(
            "External delta base not found in standalone bundle pack".into(),
        ))
    }
}

/// Report from consuming an in-place Git Bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleConsumeReport {
    /// OID checksum of the ingested packfile.
    pub pack_oid: Oid,
    /// Number of objects extracted and indexed.
    pub object_count: u32,
    /// References advanced in the target repository.
    pub references_advanced: Vec<(String, Oid)>,
    /// Bytes reclaimed by in-place truncation of the bundle.
    pub bundle_bytes_reclaimed: u64,
}

/// In-place consumer for Git Bundle v2 files.
pub struct InPlaceBundleConsumer;

impl InPlaceBundleConsumer {
    /// Ingests an embedded packfile from a bundle into `git_dir/objects/pack/` in-place.
    ///
    /// Copies the embedded pack stream into the repository pack directory, computes its
    /// canonical index, verifies the pack, and truncates the source bundle to release space.
    pub fn consume_bundle_in_place<P: AsRef<Path>, G: AsRef<Path>>(
        bundle_path: P,
        git_dir: G,
    ) -> FractalResult<BundleConsumeReport> {
        let resolved_bundle_path = bundle_path.as_ref();
        let resolved_git_dir = git_dir.as_ref();
        let pack_dir = resolved_git_dir.join("objects").join("pack");
        fs::create_dir_all(&pack_dir).map_err(FractalError::Io)?;

        // 1. Open truncator on bundle
        let mut truncator = TailTruncator::open_read_write(resolved_bundle_path)?;
        let original_bundle_len = truncator.current_len();

        // 2. Read and verify header
        let header = BundleEngine::read_header(truncator.file_mut())?;

        // 3. Prepare staging pack path in repository
        let process_id = std::process::id();
        let staging_pack_path = pack_dir.join(format!("staging_bundle_{process_id}.pack"));
        let mut staging_pack = File::create(&staging_pack_path).map_err(FractalError::Io)?;

        // 4. Stream embedded packfile from bundle into staging pack
        truncator
            .file_mut()
            .seek(SeekFrom::Start(header.pack_offset))
            .map_err(FractalError::Io)?;

        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let bytes_read = truncator
                .file_mut()
                .read(&mut buffer)
                .map_err(FractalError::Io)?;
            if bytes_read == 0 {
                break;
            }
            staging_pack
                .write_all(&buffer[..bytes_read])
                .map_err(FractalError::Io)?;
        }
        staging_pack.sync_all().map_err(FractalError::Io)?;
        drop(staging_pack);

        // 5. Load and index the packfile
        let loaded_pack = PackFile::load(&staging_pack_path)?;
        let object_count = loaded_pack.object_count();
        let (pack_checksum, entry_metas) = loaded_pack.index_objects(&BundleNoBase)?;

        // 6. Generate canonical Index v2 file
        let pack_checksum_hex = pack_checksum.to_hex();
        let final_pack_path = pack_dir.join(format!("pack-{pack_checksum_hex}.pack"));
        let final_idx_path = pack_dir.join(format!("pack-{pack_checksum_hex}.idx"));
        let staging_idx_path = pack_dir.join(format!("staging_bundle_{process_id}.idx"));

        let idx_file = File::create(&staging_idx_path).map_err(FractalError::Io)?;
        IdxWriter::write_idx(entry_metas, &pack_checksum, &idx_file)?;
        idx_file.sync_all().map_err(FractalError::Io)?;

        // Publish pack and idx atomically
        fs::rename(&staging_pack_path, &final_pack_path).map_err(FractalError::Io)?;
        fs::rename(&staging_idx_path, &final_idx_path).map_err(FractalError::Io)?;

        // 7. Update references in target repository
        let mut references_advanced = Vec::new();
        for (oid, ref_name) in &header.references {
            let oid_hex = oid.to_hex();
            if ref_name.starts_with("refs/") {
                let ref_path = resolved_git_dir.join(ref_name);
                if let Some(parent) = ref_path.parent() {
                    fs::create_dir_all(parent).map_err(FractalError::Io)?;
                }
                fs::write(&ref_path, format!("{oid_hex}\n")).map_err(FractalError::Io)?;
                references_advanced.push((ref_name.clone(), *oid));
            } else if ref_name == "HEAD" {
                let head_path = resolved_git_dir.join("HEAD");
                if let Ok(head_content) = fs::read_to_string(&head_path) {
                    let trimmed = head_content.trim();
                    if let Some(target_ref) = trimmed.strip_prefix("ref:") {
                        let target_path = resolved_git_dir.join(target_ref.trim());
                        if let Some(parent) = target_path.parent() {
                            fs::create_dir_all(parent).map_err(FractalError::Io)?;
                        }
                        fs::write(&target_path, format!("{oid_hex}\n"))
                            .map_err(FractalError::Io)?;
                    } else {
                        fs::write(&head_path, format!("{oid_hex}\n")).map_err(FractalError::Io)?;
                    }
                } else {
                    fs::write(&head_path, format!("{oid_hex}\n")).map_err(FractalError::Io)?;
                }
                references_advanced.push((ref_name.clone(), *oid));
            }
        }

        // 8. In-place truncate source bundle file to 0 bytes
        truncator.truncate_to(0)?;

        Ok(BundleConsumeReport {
            pack_oid: pack_checksum,
            object_count,
            references_advanced,
            bundle_bytes_reclaimed: original_bundle_len,
        })
    }
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

    #[test]
    fn test_consume_bundle_in_place_lifecycle() {
        let dir = test_temp_dir("bnd_consume_");
        let bundle_path = dir.path().join("source.bundle");
        let git_dir = dir.path().join("repo.git");
        fs::create_dir_all(&git_dir).expect("create repo git");

        // 1. Create a synthetic bundle with 1 object and 1 reference
        let oid1 = Oid::from_bytes([1u8; 20]);
        let data1 = b"Sample blob inside bundle";
        let item = PackDeltaItem::new(oid1, ObjectKind::Blob, data1.to_vec(), None);
        let chains = fg_algorithms::pack::find_pack_deltas(vec![item], 10, 50);

        let mut bundle_file = File::create(&bundle_path).expect("create bundle");
        let references = vec![(oid1, "refs/heads/main".to_string())];
        BundleEngine::write_bundle(&mut bundle_file, &[], &references, &chains)
            .expect("write bundle");
        bundle_file.flush().expect("flush");

        let initial_bundle_size = bundle_file.metadata().expect("meta").len();
        assert!(initial_bundle_size > 0);
        drop(bundle_file);

        // 2. Consume bundle in-place into repository
        let report = InPlaceBundleConsumer::consume_bundle_in_place(&bundle_path, &git_dir)
            .expect("consume in place");

        assert_eq!(report.object_count, 1);
        assert_eq!(report.references_advanced.len(), 1);
        assert_eq!(report.bundle_bytes_reclaimed, initial_bundle_size);

        // 3. Verify bundle file was truncated to 0
        let truncated_len = fs::metadata(&bundle_path).expect("bundle meta").len();
        assert_eq!(truncated_len, 0);

        // 4. Verify reference was written
        let ref_content = fs::read_to_string(git_dir.join("refs/heads/main")).expect("read ref");
        assert!(ref_content.contains(&oid1.to_hex()));
    }
}
