//! Module: tests::test_remote_transport — Remote Transport & Loopback Protocol Tests
//! File Path: tests/rust/test_remote_transport.rs
//! Architecture Role: Integration tests verifying remote configuration persistence,
//!   LoopbackTransport reference advertisement, atomic CAS push validation, and mock transport recording.
//! Dependencies & Triggers: Runs under `cargo test --test test_remote_transport`.
//! Responsibilities: Validate zero-network in-process synchronization and configuration lifecycle.
//! Exit Semantics & Design Rationale:
//!   - Atomic CAS pushes must reject non-fast-forward updates when expected OID does not match.
//!   - Loopback and mock transports must deliver 100% deterministic behaviour without socket I/O.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TRN-001`: Transport abstraction and deterministic loopback parity

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use fg_core::models::Oid;
use fg_index::config::{read_config, set_value, unset_value, ConfigKey, ConfigWriteMode};
use fg_transport::remote::{LoopbackTransport, MockTransport, RemoteRef, RemoteTransport};

static TEST_DIR_LOCK: Mutex<()> = Mutex::new(());

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(prefix: &str) -> Self {
        let _guard = TEST_DIR_LOCK.lock().unwrap();
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let count = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let base = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        let path = base.join(format!("taxis_remote_test_{}_{}_{}", prefix, pid, count));
        let _ = std::fs::remove_dir_all(&path);
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

fn dummy_oid(byte: u8) -> Oid {
    let mut bytes = [0u8; 20];
    bytes[0] = byte;
    Oid::from_bytes(bytes)
}

#[test]
fn test_remote_config_persistence_and_removal() {
    let test_dir = TestDir::new("remote_config");
    let config_file = test_dir.path().join("config");

    let origin_key = ConfigKey::new("remote", Some("origin"), "url").expect("origin key");
    let backup_key = ConfigKey::new("remote", Some("backup"), "url").expect("backup key");

    set_value(
        &config_file,
        &origin_key,
        "https://github.com/praxis/taxis.git",
        ConfigWriteMode::Replace,
    )
    .expect("set origin");

    set_value(
        &config_file,
        &backup_key,
        "file:///local/storage/backup.git",
        ConfigWriteMode::Replace,
    )
    .expect("set backup");

    let entries = read_config(&config_file).expect("read config");
    let mut loaded_remotes = Vec::new();
    for entry in entries {
        let key = entry.key();
        if key.section() == "remote" && key.name() == "url" {
            loaded_remotes.push((
                key.subsection().unwrap_or("").to_string(),
                entry.value().unwrap_or("").to_string(),
            ));
        }
    }

    assert_eq!(loaded_remotes.len(), 2);
    assert!(loaded_remotes.contains(&(
        "origin".to_string(),
        "https://github.com/praxis/taxis.git".to_string()
    )));
    assert!(loaded_remotes.contains(&(
        "backup".to_string(),
        "file:///local/storage/backup.git".to_string()
    )));

    // Unset backup
    let removed = unset_value(&config_file, &backup_key, None).expect("unset backup");
    assert_eq!(removed, 1);

    let entries_after = read_config(&config_file).expect("read config after unset");
    let remotes_after: Vec<String> = entries_after
        .iter()
        .filter(|entry| entry.key().section() == "remote" && entry.key().name() == "url")
        .map(|entry| entry.key().subsection().unwrap_or("").to_string())
        .collect();

    assert_eq!(remotes_after, vec!["origin".to_string()]);
}

#[test]
fn test_loopback_transport_ref_advertisement_and_push() {
    let mut loopback = LoopbackTransport::new("loopback://node-alpha");
    assert_eq!(loopback.url(), "loopback://node-alpha");

    let oid_a = dummy_oid(0xAA);
    let oid_b = dummy_oid(0xBB);
    let oid_c = dummy_oid(0xCC);

    loopback.set_ref("refs/heads/main", oid_a);
    loopback.set_ref("refs/heads/feature", oid_b);

    let refs = loopback.list_refs().expect("list refs");
    assert_eq!(refs.len(), 2);
    assert_eq!(
        refs[0],
        RemoteRef {
            name: "refs/heads/feature".to_string(),
            target: oid_b,
        }
    );
    assert_eq!(
        refs[1],
        RemoteRef {
            name: "refs/heads/main".to_string(),
            target: oid_a,
        }
    );

    // Atomic CAS push: update main expecting oid_a
    let valid_update = vec![("refs/heads/main".to_string(), oid_c, Some(oid_a))];
    let results = loopback.push(&valid_update, None).expect("push valid");
    assert_eq!(results.len(), 1);
    assert!(results[0].1.is_ok());
    assert_eq!(loopback.get_ref("refs/heads/main"), Some(oid_c));

    // Stale CAS push: update main expecting old oid_a when current is oid_c -> reject
    let stale_update = vec![("refs/heads/main".to_string(), oid_b, Some(oid_a))];
    let stale_results = loopback.push(&stale_update, None).expect("push stale");
    assert_eq!(stale_results.len(), 1);
    assert!(stale_results[0].1.is_err());
    // Ref unchanged
    assert_eq!(loopback.get_ref("refs/heads/main"), Some(oid_c));
}

#[test]
fn test_loopback_transport_pack_payload_roundtrip() {
    let mut loopback = LoopbackTransport::new("loopback://payload-test");
    let test_payload = b"PACK\x00\x00\x00\x02SAMPLE_PACK_PAYLOAD_TEST";

    let updates = vec![("refs/heads/trunk".to_string(), dummy_oid(0x11), None)];
    let push_outcome = loopback
        .push(&updates, Some(test_payload))
        .expect("push with pack");
    assert_eq!(push_outcome.len(), 1);
    assert!(push_outcome[0].1.is_ok());

    let fetched_payload = loopback.fetch(&[], &[]).expect("fetch pack");
    assert_eq!(fetched_payload.as_slice(), test_payload);
}

#[test]
fn test_mock_transport_negotiation_recording() {
    let mut mock = MockTransport::new("mock://peer-1")
        .with_refs(vec![RemoteRef {
            name: "refs/heads/dev".to_string(),
            target: dummy_oid(0x77),
        }])
        .with_fetch_payload(b"MOCK_PACK".to_vec());

    assert_eq!(mock.url(), "mock://peer-1");
    let refs = mock.list_refs().expect("mock list refs");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].name, "refs/heads/dev");

    let push_ops = vec![("refs/heads/dev".to_string(), dummy_oid(0x88), None)];
    let push_status = mock.push(&push_ops, None).expect("mock push");
    assert!(push_status[0].1.is_ok());
    assert_eq!(mock.recorded_pushes.len(), 1);
    assert_eq!(mock.recorded_pushes[0].0, "refs/heads/dev");

    let fetched = mock.fetch(&[], &[]).expect("mock fetch");
    assert_eq!(fetched, b"MOCK_PACK");
}
