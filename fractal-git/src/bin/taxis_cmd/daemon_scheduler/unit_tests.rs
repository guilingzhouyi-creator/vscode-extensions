//! Module: taxis_cmd::daemon_scheduler — Scheduler & WAL Recovery Unit Tests
//! File Path: src/bin/taxis_cmd/daemon_scheduler/unit_tests.rs
//! Architecture Role: Verifies burst coalescing, idle snapshot deduplication, forced re-audit,
//!   torn-tail WAL crash recovery, and pure-comment ELOC diff immunity.
//! Dependencies & Triggers: Exercises `loop_batch`, `cycle`, `materialize`, `hydration`, and `eloc_diff`.
//! Responsibilities: Validate deterministic scheduler behavior inside isolated temp repositories.
//! Exit Semantics & Design Rationale: Zero global environment dependencies.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use fg_core::constants::git::{OBJ_BLOB, OBJ_COMMIT};
use fg_core::models::FileMode;
use fg_index::InMemoryIndexTree;
use fg_topology::refs::DiskRefStore;
use fg_core::traits::{OdbStore, RefStore};
use fractal_git::LooseOdb;

use super::cycle::load_committed_ref_snapshot;
use super::eloc_diff::diff_file_semantic_eloc;
use super::hydration::bootstrap_scheduler_telemetry;
use super::loop_batch::drain_burst_triggers;
use super::materialize::{materialize_cloned_snapshot, MaterializeArgs};
use super::*;
use crate::taxis_cmd::daemon::daemon_transport::resolve_taxis_runtime_dir;

fn write_test_commit(
    odb: &LooseOdb,
    git_dir: &Path,
    ref_name: &str,
    files: &[(&str, &[u8])],
) -> Oid {
    let mut tree = InMemoryIndexTree::new();
    for (rel_path, bytes) in files {
        let blob_oid = odb.write_object(OBJ_BLOB, bytes).expect("write blob");
        tree.stage_oid(rel_path, FileMode::RegularFile, blob_oid)
            .expect("stage blob");
    }
    let tree_oid = tree
        .write_tree_with_payload_persister(|payload| {
            odb.write_object(fg_core::constants::git::OBJ_TREE, payload)
        })
        .expect("write tree");
    let commit_payload = format!(
        "tree {}\nauthor Tester <test@local> 1790000000 +0000\ncommitter Tester <test@local> 1790000000 +0000\n\ntest commit\n",
        tree_oid.to_hex()
    );
    let commit_oid = odb
        .write_object(OBJ_COMMIT, commit_payload.as_bytes())
        .expect("write commit");
    DiskRefStore::new(git_dir)
        .update_ref(ref_name, &commit_oid, None)
        .expect("update ref");
    commit_oid
}

#[test]
fn burst_triggers_preserve_distinct_refs_and_coalesce_duplicates() {
    let (sender, receiver) = mpsc::sync_channel::<AuditTrigger>(SCHEDULER_QUEUE_BOUND);
    let queued = Arc::new(AtomicUsize::new(3));
    let first = AuditTrigger {
        target_ref: Some(String::from("refs/fractal/cell/c1/main")),
        force: false,
    };
    sender
        .try_send(AuditTrigger {
            target_ref: Some(String::from("refs/fractal/cell/c2/main")),
            force: false,
        })
        .expect("send c2");
    sender
        .try_send(AuditTrigger {
            target_ref: Some(String::from("refs/fractal/cell/c1/main")),
            force: true,
        })
        .expect("send dup c1");

    let batch = drain_burst_triggers(&receiver, first, &queued, 300);
    assert_eq!(queued.load(Ordering::Relaxed), 1);
    assert_eq!(batch.len(), 2);
    assert_eq!(
        batch[0].target_ref.as_deref(),
        Some("refs/fractal/cell/c1/main")
    );
    assert!(batch[0].force);
    assert_eq!(
        batch[1].target_ref.as_deref(),
        Some("refs/fractal/cell/c2/main")
    );
}

#[test]
fn scheduler_dedupes_idle_tree_and_hydrates_wal_after_restart() {
    let dir = tempfile::tempdir().expect("tempdir");
    let git_dir = dir.path().join(".git");
    std::fs::create_dir_all(git_dir.join("objects")).expect("mkdir objects");
    std::fs::create_dir_all(git_dir.join("refs/heads")).expect("mkdir refs");
    std::fs::write(git_dir.join("HEAD"), b"ref: refs/heads/main\n").expect("write HEAD");

    let odb = LooseOdb::new(&git_dir);
    write_test_commit(
        &odb,
        &git_dir,
        "refs/heads/main",
        &[(
            "src/lib.rs",
            b"/// Clean doc.\npub fn ok_val() -> i32 {\n    7\n}\n",
        )],
    );

    let telemetry = Arc::new(Mutex::new(SchedulerTelemetry::default()));
    let first_audit = execute_ref_audit_cycle(
        &git_dir,
        "refs/heads/main",
        &telemetry,
        ProjectArchetype::Library,
    )
    .expect("first audit");
    assert!(first_audit.is_some());

    let dup_snapshot = load_committed_ref_snapshot(&git_dir, "refs/heads/main")
        .expect("load snap")
        .expect("commit present");
    let skipped_idle = materialize_cloned_snapshot(MaterializeArgs {
        git_dir: &git_dir,
        telemetry: &telemetry,
        source_ref: Some("refs/heads/main"),
        archetype: ProjectArchetype::Library,
        force: false,
        cloned: dup_snapshot,
    })
    .expect("idle dedup check");
    assert!(skipped_idle.is_none());

    let forced_snapshot = load_committed_ref_snapshot(&git_dir, "refs/heads/main")
        .expect("reload snap")
        .expect("commit present");
    let forced_audit = materialize_cloned_snapshot(MaterializeArgs {
        git_dir: &git_dir,
        telemetry: &telemetry,
        source_ref: Some("refs/heads/main"),
        archetype: ProjectArchetype::Library,
        force: true,
        cloned: forced_snapshot,
    })
    .expect("forced re-audit");
    assert!(forced_audit.is_some());

    let wal_path = resolve_taxis_runtime_dir(&git_dir).join(AUDIT_WAL_FILENAME);
    std::fs::write(&wal_path, b"TAXW\x10\x00\x00\x00trunc").expect("write torn wal");
    let hydrated = bootstrap_scheduler_telemetry(&git_dir);
    assert!(!wal_path.exists());
    assert_eq!(hydrated.score_history.len(), 2);
    assert!(hydrated.last_evidence_digest.is_some());
    assert!(hydrated
        .audited_baselines
        .contains_key("refs/fractal/audit/trunk"));
}

#[test]
fn semantic_diff_ignores_pure_comments_and_tracks_changed_lines() {
    let baseline = b"pub fn alpha() -> i32 {\n    1\n}\n";
    let comment_only = b"// added note\npub fn alpha() -> i32 {\n    // inner note\n    1\n}\n";
    let semantic_edit = b"pub fn alpha() -> i32 {\n    let x = 2;\n    x\n}\n";

    assert_eq!(diff_file_semantic_eloc(baseline, comment_only), 0);
    assert_eq!(diff_file_semantic_eloc(baseline, semantic_edit), 2);
}
