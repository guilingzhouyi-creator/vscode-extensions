//! Module: fg-storage — Projection Roundtrip Test Suite
//! File Path: crates/fg-storage/src/projection/tests.rs
//! Architecture Role: Verifies lossless bidirectional conversion between `.taxis/` TAXC
//!   containers and `.git/` loose objects, refs, and DIRC v2 index files.
//! Dependencies & Triggers: Internal `#[cfg(test)]` submodule of `fg-storage::projection`.
//! Responsibilities: Exercise `export_native_to_git` and `import_git_to_native` end-to-end.
//! Exit Semantics & Design Rationale: Uses isolated process/counter temp sandboxes cleaned on drop.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-OBJ-001.

use super::import::setup_native_scaffold;
use super::*;
use crate::cas_backend::CasBackend;
use crate::loose::LooseOdb;
use fg_core::models::{FileMode, IndexStage, ObjectKind};
use fg_core::traits::OdbStore;
use fg_index::GitIndex;
use fg_native::sections::head::HeadState;
use fg_native::sections::indx::{IndexEntry as NativeIndexEntry, StatCache};
use fg_native::sections::meta::{LayoutMode, MetaSection};
use fg_native::sections::refs::RefRecord;
use fg_native::RepoDocument;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(prefix: &str) -> Self {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let count = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let base = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        let path = base.join(format!("fg_proj_{}_{}_{}", prefix, pid, count));
        std::fs::create_dir_all(&path).expect("Failed to create test directory");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn test_export_and_import_roundtrip() {
    let sandbox = TestDir::new("roundtrip");
    let native_dir = sandbox.path().join(".taxis");
    let git_dir = sandbox.path().join(".git");

    // 1. Setup native repository
    setup_native_scaffold(&native_dir, false).expect("setup native scaffold");
    let cas = CasBackend::new(&native_dir);

    let blob_payload = b"hello world\n";
    let blob_oid = cas
        .put_block(ObjectKind::Blob, blob_payload)
        .expect("put blob");

    let repo_id = [0x55u8; 16];
    let meta = MetaSection::new(repo_id, 1000, LayoutMode::Dev);
    let head = HeadState::Symbolic {
        target: "refs/heads/main".to_string(),
    };
    let mut doc = RepoDocument::new(meta, head);

    doc.refs
        .upsert(RefRecord {
            name: "refs/heads/main".to_string(),
            oid: blob_oid,
            peeled: None,
        })
        .expect("upsert ref");

    doc.indx
        .upsert(NativeIndexEntry {
            path: "hello.txt".to_string(),
            mode: FileMode::RegularFile,
            oid: blob_oid,
            stage: IndexStage::Normal,
            flags: 0,
            stat: StatCache {
                size: blob_payload.len() as u64,
                mtime_secs: 1000,
                mtime_nanos: 0,
                ctime_secs: 1000,
                ctime_nanos: 0,
                dev: 0,
                ino: 0,
                uid: 0,
                gid: 0,
            },
        })
        .expect("upsert index");

    doc.save_atomic(&fg_native::container_path(&native_dir))
        .expect("save doc");

    // 2. Export native -> git
    let export_report = export_native_to_git(&native_dir, &git_dir, false).expect("export");
    assert_eq!(export_report.objects_exported, 1);
    assert_eq!(export_report.refs_exported, 1);
    assert_eq!(export_report.index_entries_exported, 1);

    // Verify git projection artifacts
    assert!(git_dir.join("HEAD").is_file());
    assert!(git_dir.join("config").is_file());
    assert!(git_dir.join("refs/heads/main").is_file());
    assert!(git_dir.join("index").is_file());

    let loose_odb = LooseOdb::new(&git_dir);
    assert!(loose_odb.has_object(&blob_oid));

    let loaded_index = GitIndex::load(git_dir.join("index")).expect("load git index");
    assert_eq!(loaded_index.len(), 1);
    assert_eq!(loaded_index.entries()[0].path, "hello.txt");
    assert_eq!(loaded_index.entries()[0].oid, blob_oid);

    // 3. Import git -> new native
    let new_native_dir = sandbox.path().join(".taxis_imported");
    let import_report =
        import_git_to_native(&git_dir, &new_native_dir, LayoutMode::Dev, false).expect("import");
    assert_eq!(import_report.objects_imported, 1);
    assert_eq!(import_report.refs_imported, 1);
    assert_eq!(import_report.index_entries_imported, 1);

    let new_cas = CasBackend::new(&new_native_dir);
    assert!(new_cas.has_block(&blob_oid));
    let (kind, recovered) = new_cas.get_block_with_kind(&blob_oid).expect("get block");
    assert_eq!(kind, ObjectKind::Blob);
    assert_eq!(recovered, blob_payload);

    let new_doc =
        RepoDocument::load(&fg_native::container_path(&new_native_dir)).expect("load new doc");
    assert_eq!(new_doc.refs.len(), 1);
    assert_eq!(new_doc.refs.get("refs/heads/main").unwrap().oid, blob_oid);
    assert_eq!(new_doc.indx.len(), 1);
    assert_eq!(new_doc.indx.entries()[0].path, "hello.txt");
}
