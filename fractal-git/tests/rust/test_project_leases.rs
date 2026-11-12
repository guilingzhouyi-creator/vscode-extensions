//! Module: tests::test_project_leases — Controlled Project Leases & Hierarchical TTL
//! File Path: tests/rust/test_project_leases.rs
//! Architecture Role: Integration suite validating controlled project lease lifecycles,
//!   hierarchical TTL clamping, status transitions (Active -> Frozen -> Evicted), and lockdown.
//! Dependencies & Triggers: Runs under `cargo test --test test_project_leases`.
//! Responsibilities: Validate failure-closed authorization enforcement when leases expire.
//! Exit Semantics & Design Rationale:
//!   - Expired or frozen project leases strictly block commit authorization.
//!   - Dormant cycles past the eviction threshold cleanly purge project state from cache.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Gate and violation boundary isolation guard

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use fg_core::error::FractalError;
use fg_core::models::{
    FractalSubLease, LeaseStatus, ProjectLease, ProjectLeaseCache, RegistrationOrigin,
    SubAuthorizationZone, DEFAULT_EVICTION_DORMANT_CYCLE_THRESHOLD,
};
use fg_topology::project_store::DiskProjectStore;

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
        let base = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        let path = base.join(format!(
            "taxis_project_lease_test_{}_{}_{}",
            prefix, pid, count
        ));
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

#[test]
fn test_project_lease_lifecycle_active_frozen_evicted() {
    let now = 10_000_u64;
    let mut lease = ProjectLease::new(
        "cell-game-ai",
        "games/cell-game-ai",
        100, // 100 seconds TTL
        RegistrationOrigin::CommandInteractive,
        now,
    );

    assert_eq!(lease.status, LeaseStatus::Active);
    assert!(!lease.is_expired(now));
    assert_eq!(lease.remaining_ttl_seconds(now), 100);
    assert_eq!(lease.commit_counter, 0);

    // Touch increments commit counter and refreshes activity
    lease.touch(now + 20);
    assert_eq!(lease.commit_counter, 1);
    assert_eq!(lease.last_activity_at, now + 20);
    assert_eq!(lease.remaining_ttl_seconds(now + 20), 100);

    // Time elapses past TTL
    let expired_now = now + 150;
    assert!(lease.is_expired(expired_now));
    assert_eq!(lease.remaining_ttl_seconds(expired_now), 0);

    // Register into cache and sweep
    let mut cache = ProjectLeaseCache::new();
    cache.register(lease);

    // First sweep: transitions Active to Frozen (dormant_cycles = 1)
    let evicted_first =
        cache.sweep_and_evict(expired_now, DEFAULT_EVICTION_DORMANT_CYCLE_THRESHOLD);
    assert!(evicted_first.is_empty());
    let frozen_lease = cache.get("cell-game-ai").expect("must exist in cache");
    assert_eq!(frozen_lease.status, LeaseStatus::Frozen);
    assert_eq!(frozen_lease.dormant_cycles, 1);

    // Second sweep: dormant_cycles = 2
    let evicted_second =
        cache.sweep_and_evict(expired_now, DEFAULT_EVICTION_DORMANT_CYCLE_THRESHOLD);
    assert!(evicted_second.is_empty());
    assert_eq!(cache.get("cell-game-ai").unwrap().dormant_cycles, 2);

    // Third sweep: reaches threshold 3 -> evicted and purged from cache
    let evicted_third =
        cache.sweep_and_evict(expired_now, DEFAULT_EVICTION_DORMANT_CYCLE_THRESHOLD);
    assert_eq!(evicted_third, vec!["cell-game-ai".to_string()]);
    assert!(cache.get("cell-game-ai").is_none());
}

#[test]
fn test_hierarchical_sublease_inheritance_and_clamping() {
    let now = 5_000_u64;
    let master_ttl = 3600_u64; // 1 hour
    let mut project = ProjectLease::new(
        "auto-refactor",
        "auto-refactor",
        master_ttl,
        RegistrationOrigin::AutoDiscovered,
        now,
    );

    // Requested sub-lease of 7200s exceeds master remaining TTL (3600s) -> clamped to 3600s
    let sub_lease = FractalSubLease::derive(
        &project,
        "agent-coder-01",
        "card-ast-042",
        Some("core".to_string()),
        7200,
        now,
    )
    .expect("should derive sub-lease");

    assert_eq!(sub_lease.sub_ttl_seconds, 3600);
    assert!(!sub_lease.is_expired(now + 1800, &project));
    assert!(sub_lease.is_expired(now + 3601, &project));

    // When master project is explicitly frozen, deriving new sub-leases is refused
    project.freeze();
    let derive_err =
        FractalSubLease::derive(&project, "agent-coder-02", "card-ast-043", None, 1800, now);

    match derive_err {
        Err(FractalError::CommitLockedTtlExpired { project_id, reason }) => {
            assert_eq!(project_id, "auto-refactor");
            assert!(reason.contains("parent project lease is frozen"));
        }
        other => panic!("expected CommitLockedTtlExpired, got {:?}", other),
    }

    // Existing sub-lease is immediately expired when master project is frozen
    assert!(sub_lease.is_expired(now, &project));
}

#[test]
fn test_sub_authorization_zones_matching() {
    let zone_core = SubAuthorizationZone::new(
        "core",
        vec!["src/core/**".to_string(), "src/algorithms/**".to_string()],
        vec!["src/core/contracts.ts".to_string()],
        2,
    );

    assert!(zone_core.matches_path("src/core/ast/parser.ts"));
    assert!(zone_core.matches_path("src/algorithms/myers.rs"));
    assert!(!zone_core.matches_path("src/core/contracts.ts")); // excluded
    assert!(!zone_core.matches_path("src/views/panel.vue")); // not included
}

#[test]
fn test_disk_project_store_persistence_and_renew() {
    let temp_root = TestDir::new("persistence");
    let git_dir = temp_root.path().join(".git");
    fs::create_dir_all(&git_dir).unwrap();

    let store = DiskProjectStore::new(&git_dir);
    let now = 1_000_u64;

    let mut cache = store.load_or_discover(None, now).unwrap();
    assert!(cache.leases.is_empty());

    // Register two projects
    cache.register(ProjectLease::new(
        "proj-a",
        "packages/proj-a",
        3600,
        RegistrationOrigin::CommandInteractive,
        now,
    ));
    cache.register(ProjectLease::new(
        "proj-b",
        "packages/proj-b",
        1800,
        RegistrationOrigin::CommandInteractive,
        now,
    ));

    store.save(&cache).unwrap();

    // Reload from store
    let loaded = store.load_or_discover(None, now).unwrap();
    assert_eq!(loaded.leases.len(), 2);
    assert_eq!(loaded.get("proj-a").unwrap().root_path, "packages/proj-a");

    // Touch proj-a
    store.touch_project("proj-a", now + 500).unwrap();
    let touched = store.load_or_discover(None, now + 500).unwrap();
    assert_eq!(touched.get("proj-a").unwrap().commit_counter, 1);
    assert_eq!(touched.get("proj-a").unwrap().last_activity_at, now + 500);

    // Renew proj-b with extended TTL
    store
        .renew_project("proj-b", now + 600, Some(7200))
        .unwrap();
    let renewed = store.load_or_discover(None, now + 600).unwrap();
    assert_eq!(renewed.get("proj-b").unwrap().master_ttl_seconds, 7200);

    // Unregister proj-a
    let removed = store.unregister_project("proj-a", now + 700).unwrap();
    assert!(removed);
    let after_unreg = store.load_or_discover(None, now + 700).unwrap();
    assert_eq!(after_unreg.leases.len(), 1);
    assert!(after_unreg.get("proj-a").is_none());
}

#[test]
fn test_opportunistic_sniff_workspace_projects() {
    let temp_root = TestDir::new("sniff");
    let root = temp_root.path();

    // Create project directories with marker files
    let rust_crate = root.join("my-rust-crate");
    fs::create_dir_all(&rust_crate).unwrap();
    fs::write(
        rust_crate.join("Cargo.toml"),
        "[package]\nname = \"my-rust-crate\"\n",
    )
    .unwrap();

    let node_pkg = root.join("my-node-app");
    fs::create_dir_all(&node_pkg).unwrap();
    fs::write(node_pkg.join("package.json"), "{\"name\": \"my-node-app\"}").unwrap();

    let godot_game = root.join("my-godot-game");
    fs::create_dir_all(&godot_game).unwrap();
    fs::write(
        godot_game.join("project.godot"),
        "; Engine configuration file",
    )
    .unwrap();

    let scripts_dir = root.join("scripts");
    fs::create_dir_all(&scripts_dir).unwrap();

    let git_dir = root.join(".git");
    fs::create_dir_all(&git_dir).unwrap();

    let store = DiskProjectStore::new(&git_dir);
    let now = 20_000_u64;

    let discovered = store.sniff_workspace_projects(root, now);
    let ids: Vec<&str> = discovered.iter().map(|lease| lease.id.as_str()).collect();

    assert!(ids.contains(&"my-rust-crate"));
    assert!(ids.contains(&"my-node-app"));
    assert!(ids.contains(&"my-godot-game"));
    assert!(ids.contains(&"governance"));

    // Verify resolve_affected_projects mapping
    let mut cache = ProjectLeaseCache::new();
    for lease in discovered {
        cache.register(lease);
    }

    let affected = store.resolve_affected_projects(
        &cache,
        &[
            "my-rust-crate/src/main.rs",
            "my-node-app/index.js",
            "scripts/common/test.js",
        ],
    );

    assert!(affected.contains(&"my-rust-crate".to_string()));
    assert!(affected.contains(&"my-node-app".to_string()));
    assert!(affected.contains(&"governance".to_string()));
    assert!(!affected.contains(&"my-godot-game".to_string()));
}

#[test]
fn test_commit_authorization_lockdown_blocks_expired_project() {
    let temp_root = TestDir::new("lockdown");
    let git_dir = temp_root.path().join(".git");
    fs::create_dir_all(&git_dir).unwrap();

    let store = DiskProjectStore::new(&git_dir);
    let now = 10_000_u64;

    let mut cache = ProjectLeaseCache::new();
    let mut frozen_lease = ProjectLease::new(
        "locked-cell",
        "packages/locked-cell",
        100, // expired relative to now + 500
        RegistrationOrigin::CommandInteractive,
        now,
    );
    frozen_lease.freeze();
    cache.register(frozen_lease);

    let active_lease = ProjectLease::new(
        "active-cell",
        "packages/active-cell",
        3600,
        RegistrationOrigin::CommandInteractive,
        now,
    );
    cache.register(active_lease);
    store.save(&cache).unwrap();

    // Verify affected projects
    let staged_in_locked = vec!["packages/locked-cell/src/lib.rs"];
    let affected = store.resolve_affected_projects(&cache, &staged_in_locked);
    assert_eq!(affected, vec!["locked-cell".to_string()]);

    let owning_lease = cache.get("locked-cell").unwrap();
    assert_eq!(owning_lease.status, LeaseStatus::Frozen);
    assert!(owning_lease.status == LeaseStatus::Frozen || owning_lease.is_expired(now + 500));

    // After human renews the project, it becomes active and unlocked
    store
        .renew_project("locked-cell", now + 500, Some(7200))
        .unwrap();
    let renewed_cache = store.load_or_discover(None, now + 500).unwrap();
    let unfrozen = renewed_cache.get("locked-cell").unwrap();
    assert_eq!(unfrozen.status, LeaseStatus::Active);
    assert!(!unfrozen.is_expired(now + 500));
}

#[test]
fn test_disk_blackboard_store_write_guard() {
    let test_dir = TestDir::new("bb_guard");
    let git_dir = test_dir.path().join(".git");
    std::fs::create_dir_all(&git_dir).unwrap();

    let store = fg_topology::DiskBlackboardStore::new(&git_dir);
    let now_ms = 1_700_000_000_000_i64;

    // 1. Fresh repository has no leases: write is permitted
    let check1 = store
        .assert_write_permitted("src/lib.rs", Some("agent-b"), Some("cell-b"), now_ms)
        .unwrap();
    assert_eq!(check1, None);

    // 2. Register intent lease from agent-a in cell-a on src/core/
    let mut board = store.load_or_create("card-1", "cell-a").unwrap();
    let claim = fg_core::models::SymbolClaim::new("agent-a", "src/core/", "*", 300, now_ms);
    board.claim_symbol(claim).expect("claim succeeds");
    store.save(&board).unwrap();

    // 3. Different cell & agent trying to write under src/core/ is blocked
    let conflict = store
        .assert_write_permitted(
            "src/core/parser.rs",
            Some("agent-b"),
            Some("cell-b"),
            now_ms,
        )
        .unwrap();
    assert!(conflict.is_some());
    let collision = conflict.unwrap();
    assert_eq!(collision.conflicting_agent, "agent-a");
    assert_eq!(collision.file_path, "src/core/parser.rs");

    // 4. Different path outside scope is permitted
    let outside = store
        .assert_write_permitted(
            "src/utils/log.rs",
            Some("agent-b"),
            Some("cell-b"),
            now_ms,
        )
        .unwrap();
    assert_eq!(outside, None);

    // 5. Same cell is permitted
    let same_cell = store
        .assert_write_permitted(
            "src/core/parser.rs",
            Some("agent-peer"),
            Some("cell-a"),
            now_ms,
        )
        .unwrap();
    assert_eq!(same_cell, None);

    // 6. Same agent is permitted
    let same_agent = store
        .assert_write_permitted(
            "src/core/parser.rs",
            Some("agent-a"),
            Some("cell-other"),
            now_ms,
        )
        .unwrap();
    assert_eq!(same_agent, None);

    // 7. Expired lease is permitted
    let expired_check = store
        .assert_write_permitted(
            "src/core/parser.rs",
            Some("agent-b"),
            Some("cell-b"),
            now_ms + 400_000,
        )
        .unwrap();
    assert_eq!(expired_check, None);
}
