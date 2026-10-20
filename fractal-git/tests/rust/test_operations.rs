//! Unit Test: fg-topology Operation DAG & Time-Travel Undo
//! File Path: tests/rust/test_operations.rs

use fractal_git::core::models::Oid;
use fractal_git::fractal::operation::{OperationGraph, RepoViewSnapshot};
use std::collections::BTreeMap;
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
        let path = base.join(format!("fg_test_op_{}_{}_{}", prefix, pid, count));
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
fn test_operation_graph_creation_and_hash_id() {
    let mut graph = OperationGraph::in_memory();
    assert!(graph.current_head.is_none());

    let mut branches_one = BTreeMap::new();
    let oid_one = Oid::from_bytes([1u8; 20]);
    branches_one.insert("refs/heads/main".to_string(), oid_one);

    let view_one = RepoViewSnapshot {
        head_oid: Some(oid_one),
        branches: branches_one,
        staged_promotions: Vec::new(),
        timestamp_ms: 1000,
    };

    let op_one_id = graph
        .record_operation(
            view_one,
            "Agent-Architect",
            "commit",
            "Initial root commit",
            1000,
        )
        .expect("Record op succeeds");

    assert_eq!(graph.current_head, Some(op_one_id));
    let op_one = graph.operations.get(&op_one_id).expect("Op 1 exists");
    assert!(op_one.parent_ids.is_empty());
    assert_eq!(op_one.metadata.command, "commit");

    // Record second operation
    let mut branches_two = BTreeMap::new();
    let oid_two = Oid::from_bytes([2u8; 20]);
    branches_two.insert("refs/heads/main".to_string(), oid_two);

    let view_two = RepoViewSnapshot {
        head_oid: Some(oid_two),
        branches: branches_two,
        staged_promotions: Vec::new(),
        timestamp_ms: 2000,
    };

    let op_two_id = graph
        .record_operation(
            view_two,
            "SubAgent-01",
            "merge",
            "Merge feature branch into main",
            2000,
        )
        .expect("Record op succeeds");

    assert_eq!(graph.current_head, Some(op_two_id));
    let op_two = graph.operations.get(&op_two_id).expect("Op 2 exists");
    assert_eq!(op_two.parent_ids, vec![op_one_id]);
}

#[test]
fn test_operation_graph_time_travel_undo() {
    let mut graph = OperationGraph::in_memory();

    let oid_initial = Oid::from_bytes([10u8; 20]);
    let oid_second = Oid::from_bytes([20u8; 20]);

    let mut branches_init = BTreeMap::new();
    branches_init.insert("refs/heads/main".to_string(), oid_initial);
    let view_init = RepoViewSnapshot {
        head_oid: Some(oid_initial),
        branches: branches_init,
        staged_promotions: Vec::new(),
        timestamp_ms: 1000,
    };

    let op_init_id = graph
        .record_operation(view_init, "Human", "commit", "Baseline", 1000)
        .unwrap();

    let mut branches_sec = BTreeMap::new();
    branches_sec.insert("refs/heads/main".to_string(), oid_second);
    let view_sec = RepoViewSnapshot {
        head_oid: Some(oid_second),
        branches: branches_sec,
        staged_promotions: Vec::new(),
        timestamp_ms: 2000,
    };

    let _op_sec_id = graph
        .record_operation(view_sec, "SubAgent", "refactor", "Accidental change", 2000)
        .unwrap();

    // Perform time-travel undo
    let restored_op = graph.undo().expect("Undo succeeds").expect("Has parent");
    assert_eq!(graph.current_head, Some(op_init_id));
    assert_eq!(restored_op.operation_id, op_init_id);
    assert_eq!(restored_op.view.head_oid, Some(oid_initial));

    // Second undo at root should return None
    let root_undo = graph.undo().expect("Undo at root succeeds");
    assert!(root_undo.is_none());
    assert_eq!(graph.current_head, Some(op_init_id));
}

#[test]
fn test_operation_graph_disk_persistence_roundtrip() {
    let dir = TestDir::new("persist");
    let git_dir = dir.path().join(".git");

    let op_id = {
        let mut graph = OperationGraph::load_or_init(&git_dir).expect("Init graph");
        let view = RepoViewSnapshot {
            head_oid: Some(Oid::from_bytes([5u8; 20])),
            branches: BTreeMap::new(),
            staged_promotions: vec!["prop-001".to_string()],
            timestamp_ms: 12345,
        };
        graph
            .record_operation(view, "Agent", "stage-promotion", "UAC proposal", 12345)
            .expect("Record succeeds")
    };

    // Reload from disk
    let reloaded = OperationGraph::load_or_init(&git_dir).expect("Reload graph");
    assert_eq!(reloaded.current_head, Some(op_id));
    let op = reloaded.operations.get(&op_id).expect("Op persists");
    assert_eq!(op.metadata.command, "stage-promotion");
    assert_eq!(op.view.staged_promotions, vec!["prop-001".to_string()]);
}
