//! Unit Test: fg-storage (LooseOdb, CasBackend, WalJournal, CasToGitMaterializer)
//! File Path: tests/rust/test_storage.rs

use fractal_git::core::models::{GitSignature, Oid};
use fractal_git::core::traits::OdbStore;
use fractal_git::object::FileMode;
use fractal_git::storage::cas_backend::CasBackend;
use fractal_git::storage::cas_bridge::{
    CasFileDescriptor, CasToGitMaterializer, MaterializeRequest,
};
use fractal_git::storage::loose::LooseOdb;
use fractal_git::storage::wal_journal::{WalJournal, WalRecord};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

static DIR_LOCK: Mutex<()> = Mutex::new(());

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(prefix: &str) -> Self {
        let _guard = DIR_LOCK.lock().unwrap();
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let count = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let base = if cfg!(windows) {
            let low = std::env::temp_dir().join("Low");
            let _ = std::fs::create_dir_all(&low);
            if low.exists() {
                low
            } else {
                std::env::temp_dir()
            }
        } else {
            std::env::temp_dir()
        };
        let path = base.join(format!("fg_test_{}_{}_{}", prefix, pid, count));
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
fn test_loose_odb_roundtrip() {
    let dir = TestDir::new("loose_odb");
    let git_dir = dir.path();
    let odb = LooseOdb::new(git_dir);

    let payload = b"content for loose storage test";
    let oid = odb
        .write_object("blob", payload)
        .expect("Failed to write loose object");
    assert!(odb.has_object(&oid));
    assert!(odb.cache_len() >= 1);
    assert!(odb.cache_bytes() > 0);

    let read_back = odb.read_object(&oid).expect("Failed to read loose object");
    assert!(read_back.starts_with(b"blob 30\0"));
    assert!(read_back.ends_with(payload));

    // Verify cache hit even if disk file is removed
    let disk_file = LooseOdb::object_path(git_dir, &oid);
    std::fs::remove_file(&disk_file).expect("Remove loose file from disk");
    assert!(!disk_file.exists());

    // Reading from cache still succeeds!
    let cached_read = odb
        .read_object(&oid)
        .expect("Cache hit should return object even if disk file deleted");
    assert_eq!(cached_read, read_back);
}

#[test]
fn test_cas_backend_block_roundtrip() {
    let dir = TestDir::new("cas_backend");
    let cas = CasBackend::new(dir.path());

    let block = b"immutable chunk bytes from layervfs";
    let oid = cas.put_block(block).expect("Put block should succeed");
    assert!(cas.has_block(&oid));
    assert_eq!(cas.cache_len(), 1);
    assert_eq!(cas.cache_bytes(), block.len());

    let fetched = cas.get_block(&oid).expect("Get block should succeed");
    assert_eq!(&fetched, block);

    // Verify cache hit even if block file is deleted from disk
    let disk_block = cas.block_path(&oid);
    std::fs::remove_file(&disk_block).expect("Remove block file from disk");
    assert!(!disk_block.exists());

    let cached_block = cas
        .get_block(&oid)
        .expect("Get block from cache should succeed");
    assert_eq!(&cached_block, block);
}

#[test]
fn test_wal_journal_append_read_checkpoint() {
    let dir = TestDir::new("wal_journal");
    let journal_file = dir.path().join("wal.ndjson");
    let wal = WalJournal::open(&journal_file).expect("Open WAL should succeed");

    let record1 = WalRecord::BeginTx {
        tx_id: "tx-001".to_string(),
        timestamp_ms: 1700000000000,
    };
    let record2 = WalRecord::StageFile {
        tx_id: "tx-001".to_string(),
        path: "src/lib.rs".to_string(),
        oid: Oid::from_bytes([5u8; 20]),
    };

    wal.append(&record1).expect("Append record 1");
    wal.append(&record2).expect("Append record 2");

    let read_records = wal.read_all().expect("Read WAL records");
    assert_eq!(read_records.len(), 2);
    assert_eq!(read_records[0], record1);
    assert_eq!(read_records[1], record2);

    wal.checkpoint().expect("Checkpoint WAL");
    let empty_records = wal.read_all().expect("Read after checkpoint");
    assert!(empty_records.is_empty());
}

#[test]
fn test_cas_materializer_integration() {
    let dir = TestDir::new("cas_materializer");
    let git_dir = dir.path();

    let author = GitSignature::for_agent("agent-test", "cell-1", 1700000000);
    let committer = author.clone();

    let request = MaterializeRequest {
        parent_commit_oids: vec![],
        files: vec![
            CasFileDescriptor {
                path: "src/main.rs".to_string(),
                mode: FileMode::RegularFile,
                payload: b"fn main() {}\n".to_vec(),
            },
            CasFileDescriptor {
                path: "README.md".to_string(),
                mode: FileMode::RegularFile,
                payload: b"# Hello Fractal\n".to_vec(),
            },
        ],
        message: "feat(init): materialized commit from LayerVFS".to_string(),
        author,
        committer,
        agent_meta: None,
    };

    let commit_oid = CasToGitMaterializer::materialize(git_dir, request)
        .expect("Materialization should succeed");

    let odb = LooseOdb::new(git_dir);
    assert!(odb.has_object(&commit_oid));
}
