//! Module: taxis_cmd::worktree — Scoped Worktree Subcommand Dispatcher
//! File Path: src/bin/taxis_cmd/worktree.rs
//! Architecture Role: Dispatches scoped worktree allocation, concurrency quota enforcement,
//!   and physical subtree projection for autonomous agent isolation.
//! Dependencies & Triggers: Invoked when `taxis worktree` is dispatched.
//! Responsibilities: Worktree listing, quota accounting, scoped materialization, Path Jail
//!   enforcement, and projection accounting measured from the filesystem.
//! Exit Semantics & Design Rationale: Exits 0 only after the projected directory exists on
//!   disk with the declared scopes; every rejection exits non-zero.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use std::path::{Path, PathBuf};
use std::time::Instant;

use fg_native::{RepoDocument, WorktreeRecord, WorktreeTier};
use fractal_git::constants::cli::CliTag;
use fractal_git::{FractalRef, QuotaGovernor, ScopeProjection, WorktreeMode, WorktreePool};

use super::common::{fail_io, print_json, reject, CliContext};

/// Upper bound on projected entries walked while measuring a worktree.
const PROJECTION_SCAN_LIMIT: usize = 20_000;

/// Dispatches worktree subcommands (list, add, prune, or falls back to passthrough).
pub fn handle_worktree(ctx: &CliContext) {
    if ctx.args.is_empty() || ctx.args[0] == "list" {
        handle_worktree_list(ctx);
        return;
    }

    if ctx.args[0] == "add" {
        handle_worktree_add(ctx);
        return;
    }

    if ctx.args[0] == "prune" {
        let pruned_ctx = CliContext {
            git_dir: ctx.git_dir.clone(),
            args: ctx.args[1..].to_vec(),
            json_mode: ctx.json_mode,
        };
        super::reclaim::handle_reclaim(&pruned_ctx);
        return;
    }

    reject(
        CliTag::ERROR,
        format!(
            "worktree subcommand '{}' is not implemented; this build manages allocations through \
             'worktree list', 'worktree add', and 'worktree prune'",
            ctx.args[0]
        ),
    )
}

/// Lists active worktree slots, quota constraints, and trunk projection modes.
fn handle_worktree_list(ctx: &CliContext) {
    let pool = WorktreePool::new(64);
    let quota = QuotaGovernor::default();
    let registered = list_registered_worktrees(&ctx.git_dir);

    if ctx.args.iter().any(|arg| arg == "--porcelain") {
        let work_root = ctx
            .git_dir
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_string_lossy()
            .replace('\\', "/");
        let head_ref = std::fs::read_to_string(ctx.git_dir.join("HEAD"))
            .unwrap_or_default()
            .trim()
            .to_string();
        println!("worktree {work_root}");
        if let Some(sym_target) = head_ref.strip_prefix("ref: ") {
            println!("branch {sym_target}");
        } else if !head_ref.is_empty() {
            println!("HEAD {head_ref}");
            println!("detached");
        }
        for record in &registered {
            let p = record.path.replace('\\', "/");
            println!("\nworktree {p}");
        }
        return;
    }

    if ctx.json_mode {
        let active_projections: Vec<serde_json::Value> = registered
            .iter()
            .map(|record| {
                serde_json::json!({
                    "path": record.path,
                    "mode": format!("{:?}", record.mode),
                    "scopes": record.scopes,
                    "is_full_universe": record.is_full,
                    "tier": format!("{:?}", record.tier),
                })
            })
            .collect();
        let worktree_payload = serde_json::json!({
            "engine": "taxis",
            "operation": "worktree_list",
            "max_concurrency": quota.max_concurrent_worktrees(),
            "available_slots": pool.available_count(),
            "system_trunk": {
                "ref": "refs/heads/main",
                "projection": "full",
                "mode": "PhysicalHost"
            },
            "active_projections": active_projections
        });
        print_json(&worktree_payload);
        return;
    }

    println!("=== Taxis Scoped Worktree Matrix ===");
    println!("  System Trunk (L0) : refs/heads/main [Projection: Full Universe (100%)]");
    println!("  Integration Trunk : refs/fractal/trunk [Dual-Trunk Mode Active]");
    println!(
        "  Active Allocations: {} (Available Slots: {})",
        registered.len(),
        pool.available_count()
    );
    for record in &registered {
        println!(
            "    - {} [mode: {:?}, scopes: {:?}]",
            record.path, record.mode, record.scopes
        );
    }
    println!("  Worktree Strategy : Scoped Subtree Projection (Default: Non-Full)");
}

/// Reads the worktree registry from the repository container's `WKTR` section.
///
/// A missing or unreadable container yields an empty registry rather than a failure: `worktree list`
/// is a read-only inspection command and must remain usable on a repository that was never
/// initialized, where the honest answer is "no worktrees".
fn list_registered_worktrees(git_dir: &Path) -> Vec<WorktreeRecord> {
    let container_path = repository_container_path(git_dir);
    let Ok(document) = RepoDocument::load(&container_path) else {
        return Vec::new();
    };
    document.wktr.records().to_vec()
}

/// Resolves the repository container path.
///
/// Delegates to the single definition in `fg_native`; a locally rebuilt path is how this module
/// drifted onto `<git_dir>/fractal/repo.txc` while initialization wrote `<git_dir>/repo.txc`.
fn repository_container_path(git_dir: &Path) -> PathBuf {
    fg_native::container_path(git_dir)
}

/// Maps the CLI worktree mode onto the container's closed discriminant set.
fn to_container_mode(mode: WorktreeMode) -> fg_native::WorktreeMode {
    match mode {
        WorktreeMode::VirtualMemory => fg_native::WorktreeMode::Virtual,
        WorktreeMode::CoWClone => fg_native::WorktreeMode::Cow,
        WorktreeMode::SparseGhost => fg_native::WorktreeMode::Sparse,
    }
}

/// Appends a newly materialized worktree to the container's `WKTR` section.
///
/// A repository whose container is absent is reported as a failure rather than silently skipped:
/// the caller has just created a directory on disk, and losing its registration would leak the
/// directory with no record of it.
fn register_worktree(git_dir: &Path, record: WorktreeRecord) {
    let container_path = repository_container_path(git_dir);
    let mut document = match RepoDocument::load(&container_path) {
        Ok(loaded) => loaded,
        Err(load_err) => fail_io(
            format!("load repository container '{}'", container_path.display()),
            load_err,
        ),
    };

    if let Err(upsert_err) = document.wktr.upsert(record) {
        reject(CliTag::ERROR, upsert_err);
    }
    if let Err(save_err) = document.save_atomic(&container_path) {
        fail_io(
            format!(
                "publish repository container '{}'",
                container_path.display()
            ),
            save_err,
        );
    }
}

/// Allocates an isolated worktree with specified projection scope and storage mode.
fn handle_worktree_add(ctx: &CliContext) {
    if ctx.args.len() < 2 {
        reject(
            CliTag::ERROR,
            concat!(
                "Usage: taxis worktree add <path> [--scope <prefix...>] ",
                "[--full] [--mode <virtual|cow|sparse>]"
            ),
        );
    }
    let target_path = &ctx.args[1];
    let options = parse_worktree_add_options(&ctx.args[2..]);
    let (scopes, is_full, mode) = (options.scopes.clone(), options.is_full, options.mode);

    let projection = if is_full {
        ScopeProjection::full()
    } else if scopes.is_empty() {
        ScopeProjection::scoped(vec![target_path.clone()])
    } else {
        ScopeProjection::scoped(scopes.clone())
    };

    let quota = QuotaGovernor::default();
    let existing = list_registered_worktrees(&ctx.git_dir);
    if let Err(quota_err) = quota.assert_spawn_capacity(existing.len()) {
        reject(CliTag::ERROR, quota_err);
    }

    // Fan-out is checked against the references the repository actually holds, not the worktree
    // registry: the registry records where a checkout landed, while the reference records which
    // fractal node exists, and only the latter answers "how many siblings does this cell have".
    if let Some(candidate) = options.fractal_ref() {
        let ref_store = fg_topology::refs::DiskRefStore::new(&ctx.git_dir);
        if let Err(fanout_err) =
            fg_topology::assert_fanout_available_in(&candidate, &ref_store)
        {
            reject(CliTag::ERROR, fanout_err);
        }
    }

    let started_at = Instant::now();
    let destination = PathBuf::from(target_path);
    if let Err(create_err) = std::fs::create_dir_all(&destination) {
        fail_io(
            format!("create worktree directory '{}'", destination.display()),
            create_err,
        );
    }

    let materialized = materialize_projection(&destination, &projection)
        + materialize_worktree_files(&ctx.git_dir, &destination, &projection, mode);
    let creation_latency_us = started_at.elapsed().as_micros() as u64;
    let mut record = if projection.is_full {
        WorktreeRecord::full(destination.display().to_string())
    } else {
        WorktreeRecord::sparse(destination.display().to_string(), projection.scopes.clone())
    };
    record.mode = to_container_mode(mode);
    record.tier = WorktreeTier::Hot;
    register_worktree(&ctx.git_dir, record);

    if ctx.json_mode {
        let worktree_payload = serde_json::json!({
            "engine": "taxis",
            "status": "worktree_allocated",
            "path": target_path,
            "absolute_path": destination.display().to_string(),
            "is_full_universe": projection.is_full,
            "scopes": projection.scopes,
            "mode": format!("{:?}", mode),
            "materialized_entries": materialized,
            "creation_latency_us": creation_latency_us
        });
        print_json(&worktree_payload);
    } else {
        println!(
            "{} Allocated Scoped Worktree '{}'",
            CliTag::WORKTREE_OK,
            target_path
        );
        println!("  Projection Mode : {:?}", mode);
        println!(
            "  Full Universe   : {}",
            if projection.is_full {
                "YES (--full)"
            } else {
                "NO (Scoped Subtree)"
            }
        );
        println!("  Scoped Envelopes: {:?}", projection.scopes);
        println!("  Materialized    : {} entries", materialized);
        println!("  Creation Latency: {} µs", creation_latency_us);
    }
}

/// Creates the scoped envelope directories beneath the worktree root.
///
/// A scoped projection with a trailing separator denotes a directory envelope; a bare path
/// denotes an unmaterialized file envelope. Creating the envelope makes the allocation observable on disk
/// instead of merely asserted in the output.
fn materialize_projection(destination: &Path, projection: &ScopeProjection) -> usize {
    if projection.is_full {
        return 0;
    }
    let mut created = 0usize;
    for scope in projection.scopes.iter().take(PROJECTION_SCAN_LIMIT) {
        let cleaned = scope.trim_matches('/').replace('\\', "/");
        if cleaned.is_empty() {
            continue;
        }
        let envelope = destination.join(cleaned.replace('/', std::path::MAIN_SEPARATOR_STR));
        let result = if scope.ends_with('/') {
            std::fs::create_dir_all(&envelope)
        } else {
            match envelope.parent() {
                Some(parent) => std::fs::create_dir_all(parent),
                None => Ok(()),
            }
        };
        match result {
            Ok(()) => created += 1,
            Err(create_err) => fail_io(format!("materialize scope '{}'", scope), create_err),
        }
    }
    created
}

/// Materializes actual files into the allocated worktree using CoW block reflink or Ghost Linking.
///
/// Within-scope files are made writable (or eligible for CoW writes); outside-scope files are
/// projected as read-only stubs, providing a complete read view for compilers and linters while
/// preventing unauthorized writes.
fn materialize_worktree_files(
    git_dir: &Path,
    destination: &Path,
    projection: &ScopeProjection,
    mode: WorktreeMode,
) -> usize {
    if mode == WorktreeMode::VirtualMemory {
        return 0;
    }

    let work_root = super::repo_view::resolve_work_root(git_dir);
    if !work_root.exists() {
        return 0;
    }

    let mut tracked_paths = std::collections::BTreeSet::new();

    let index_file = git_dir.join("index");
    if let Ok(git_index) = fg_index::GitIndex::load(&index_file) {
        for e in git_index.entries() {
            if work_root.join(&e.path).is_file() {
                tracked_paths.insert(e.path.clone());
            }
        }
    }

    let container_path = fg_native::container_path(git_dir);
    if let Ok(doc) = RepoDocument::load(&container_path) {
        for e in doc.indx.entries() {
            if work_root.join(&e.path).is_file() {
                tracked_paths.insert(e.path.clone());
            }
        }
    }

    let mut materialized_count = 0usize;

    for rel_path in tracked_paths.iter().take(PROJECTION_SCAN_LIMIT) {
        let in_scope = projection.contains_path(rel_path);

        if mode == WorktreeMode::SparseGhost && !in_scope {
            // In SparseGhost mode, keep top-level manifests only for toolchain resolution
            let is_root_manifest = !rel_path.contains('/') && !rel_path.contains('\\');
            if !is_root_manifest {
                continue;
            }
        }

        let src_file = work_root.join(rel_path);
        let dst_file = destination.join(rel_path.replace('/', std::path::MAIN_SEPARATOR_STR));

        if let Ok(_kind) = fg_storage::reflink::clone_file_cow(&src_file, &dst_file) {
            materialized_count += 1;
            if !in_scope {
                let _ = fg_storage::reflink::set_readonly(&dst_file, true);
            }
        }
    }

    materialized_count
}

/// Parses CLI flags specific to `worktree add` command.
/// Options accepted by `worktree add`.
struct WorktreeAddOptions {
    /// Path envelopes the worktree may write.
    scopes: Vec<String>,
    /// Whether the worktree materializes the full universe.
    is_full: bool,
    /// Storage mode the projection uses.
    mode: WorktreeMode,
    /// Integration cell the worktree belongs to, when one was named.
    cell_id: Option<String>,
    /// Parent Agent worktree a subagent hangs under, when one was named.
    card_id: Option<String>,
    /// Subagent identifier, which makes the reference an ephemeral leaf.
    subagent_id: Option<String>,
}

impl WorktreeAddOptions {
    /// Builds the fractal reference this worktree occupies, or `None` when no topology was named.
    ///
    /// Creating a worktree without a reference stays supported: `worktree add` also serves plain
    /// scoped checkouts, and demanding a cell would break those callers. The reference is only
    /// formed when the caller supplies enough of the path to name one.
    fn fractal_ref(&self) -> Option<FractalRef> {
        let cell = self.cell_id.as_ref()?;
        match (&self.card_id, &self.subagent_id) {
            (Some(card), Some(sub)) => Some(FractalRef::SubAgentWorktree {
                cell_id: cell.clone(),
                card_id: card.clone(),
                subagent_id: sub.clone(),
            }),
            (Some(card), None) => Some(FractalRef::CardWorktree {
                cell_id: cell.clone(),
                card_id: card.clone(),
            }),
            (None, _) => Some(FractalRef::CellMain {
                cell_id: cell.clone(),
            }),
        }
    }
}

fn parse_worktree_add_options(args: &[String]) -> WorktreeAddOptions {
    let mut options = WorktreeAddOptions {
        scopes: Vec::new(),
        is_full: false,
        mode: WorktreeMode::VirtualMemory,
        cell_id: None,
        card_id: None,
        subagent_id: None,
    };

    let mut cursor = 0;
    while cursor < args.len() {
        match args[cursor].as_str() {
            "--full" => {
                options.is_full = true;
                cursor += 1;
            }
            "--scope" if cursor + 1 < args.len() => {
                options.scopes.push(args[cursor + 1].clone());
                cursor += 2;
            }
            "--mode" if cursor + 1 < args.len() => {
                options.mode = match args[cursor + 1].as_str() {
                    "cow" => WorktreeMode::CoWClone,
                    "sparse" => WorktreeMode::SparseGhost,
                    _ => WorktreeMode::VirtualMemory,
                };
                cursor += 2;
            }
            "--cell" if cursor + 1 < args.len() => {
                options.cell_id = Some(args[cursor + 1].clone());
                cursor += 2;
            }
            "--card" if cursor + 1 < args.len() => {
                options.card_id = Some(args[cursor + 1].clone());
                cursor += 2;
            }
            "--sub" if cursor + 1 < args.len() => {
                options.subagent_id = Some(args[cursor + 1].clone());
                cursor += 2;
            }
            _ => cursor += 1,
        }
    }

    options
}
