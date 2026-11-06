//! Module: taxis_cmd::commit_ops — Post-Commit Operations and Index Synchronization
//! File Path: src/bin/taxis_cmd/commit_ops.rs
//! Architecture Role: Handles write-ahead logging (WAL), index synchronization, block-level
//!   provenance recording, project lease updates, and console result reporting.
//! Dependencies & Triggers: Dispatched by `taxis_cmd::commit` upon successful materialization.
//! Responsibilities: WAL transaction completion, container updates, and lease tracking.
//! Exit Semantics & Design Rationale:
//!   - Isolates file and state mutations following object writing away from commit dispatching.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-GAT-001`: Gate and authority validation guard

use std::fs;
use std::path::Path;

use fg_core::models::{
    current_unix_seconds, FileMode, IndexStage, LeaseStatus, Oid,
};
use fg_index::{write_dirc_v2, IndexEntry};
use fg_native::sections::indx::{IndexEntry as NativeIndexEntry, StatCache};
use fg_native::sections::refs::RefRecord;
use fg_native::RepoDocument;
use fg_topology::project_store::DiskProjectStore;
use fractal_git::constants::cli::CliTag;
use fractal_git::{
    ActorIdentity, BlockProvenanceEntry, BlockProvenanceParams, DiskProvenanceStore,
    DiskRefStore, FractalRef, TaxisPolicy, ValidatedCommitWitness, WalJournal, WalRecord,
};

use super::checkout::worktree_stat;
use super::common::{find_all_arg_values, print_json, reject, CliContext};
use super::operation::{record_head_operation, HeadOperationSpec};

/// Path handed to the tree builder when the caller supplies no `--file` flag.
pub(crate) const DEFAULT_COMMIT_FILE: &str = "README.md";

/// Opens the commit WAL journal and appends a `BeginTx` entry if available.
pub(crate) fn open_and_begin_commit_wal(git_dir: &Path, tx_id: &str) -> Option<WalJournal> {
    let wal = WalJournal::open(git_dir.join("journal/commit.wal")).ok();
    if let Some(ref w) = wal {
        let _ = w.append(&WalRecord::BeginTx {
            tx_id: tx_id.to_string(),
            timestamp_ms: current_unix_seconds() as i64 * 1000,
        });
    }
    wal
}

/// Synchronizes `.taxis/index`, native container `doc.indx`/`doc.refs`, and WAL records.
pub(crate) fn sync_committed_index_and_container(
    ctx: &CliContext,
    tx: (&str, Option<&WalJournal>, &FractalRef),
    materialized: (&[String], Oid, &[Oid], &[FileMode]),
) {
    let (tx_id, wal, target_ref) = tx;
    let (staged_files, commit_oid, blob_oids, modes) = materialized;
    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    let declared_files = find_all_arg_values(&ctx.args, &["--file", "--add"]);
    let index_file = ctx.git_dir.join("index");
    let used_direct_index = declared_files.is_empty() && index_file.is_file();

    let mut index_entry_map = std::collections::BTreeMap::new();
    if let Ok(existing_index) = fg_index::GitIndex::load(&index_file) {
        for entry in existing_index.entries() {
            index_entry_map.insert(entry.path.clone(), entry.clone());
        }
    }

    let container_path = fg_native::container_path(&ctx.git_dir);
    let native_doc = if container_path.is_file() {
        RepoDocument::load(&container_path).ok()
    } else {
        None
    };
    let mut native_indx = native_doc
        .as_ref()
        .map(|d| d.indx.clone())
        .unwrap_or_else(fg_native::IndxSection::new);

    if !used_direct_index {
        upsert_staged_entries_after_commit(
            (&work_root, tx_id, wal),
            (staged_files, blob_oids, modes),
            (&mut index_entry_map, &mut native_indx),
        );
        let final_index_entries: Vec<IndexEntry> = index_entry_map.into_values().collect();
        let _ = write_dirc_v2(&index_file, &final_index_entries);
    }

    if let Some(w) = wal {
        let _ = w.append(&WalRecord::UpdateRef {
            tx_id: tx_id.to_string(),
            git_ref: target_ref.to_git_ref(),
            new_oid: commit_oid,
        });
    }

    if let Some(mut doc) = native_doc {
        let _ = doc.refs.upsert(RefRecord {
            name: target_ref.to_git_ref(),
            oid: commit_oid,
            peeled: None,
        });
        doc.indx = native_indx;
        let _ = doc.save_atomic(&container_path);
    }

    if let Some(w) = wal {
        let _ = w.append(&WalRecord::CommitTx {
            tx_id: tx_id.to_string(),
            commit_oid,
        });
        let _ = w.checkpoint();
    }
}

/// Inserts newly materialized staged files into the DIRC map and native index section.
pub(crate) fn upsert_staged_entries_after_commit(
    env_ctx: (&Path, &str, Option<&WalJournal>),
    staged_data: (&[String], &[Oid], &[FileMode]),
    targets: (
        &mut std::collections::BTreeMap<String, IndexEntry>,
        &mut fg_native::IndxSection,
    ),
) {
    let (work_root, tx_id, wal) = env_ctx;
    let (staged_files, blob_oids, modes) = staged_data;
    let (index_entry_map, native_indx) = targets;

    for (i, path) in staged_files.iter().enumerate() {
        let blob_oid = blob_oids.get(i).copied().unwrap_or(Oid::ZERO);
        let full_path = work_root.join(path);
        let (size, mtime_sec, mtime_nano) = worktree_stat(&full_path, 0);
        let mode = modes.get(i).copied().unwrap_or(FileMode::RegularFile);

        if let Some(w) = wal {
            let _ = w.append(&WalRecord::StageFile {
                tx_id: tx_id.to_string(),
                path: path.clone(),
                oid: blob_oid,
            });
        }

        index_entry_map.insert(
            path.clone(),
            IndexEntry {
                path: path.clone(),
                mode,
                oid: blob_oid,
                stage: IndexStage::Normal,
                size,
                mtime_seconds: mtime_sec,
                mtime_nanos: mtime_nano,
                assume_valid: false,
                skip_worktree: false,
                intent_to_add: false,
            },
        );
        let _ = native_indx.upsert(NativeIndexEntry {
            path: path.clone(),
            mode,
            oid: blob_oid,
            stage: IndexStage::Normal,
            stat: StatCache {
                size: u64::from(size),
                mtime_secs: i64::from(mtime_sec),
                mtime_nanos: mtime_nano,
                ctime_secs: i64::from(mtime_sec),
                ctime_nanos: mtime_nano,
                dev: 0,
                ino: 0,
                uid: 0,
                gid: 0,
            },
            flags: 0,
        });
    }
}

/// Ensures `HEAD` exists on disk if absent, or advances commit OID when detached.
pub(crate) fn advance_head_after_commit(git_dir: &Path, target_ref: &FractalRef, commit_oid: &Oid) {
    let ref_store = DiskRefStore::new(git_dir);
    match ref_store.head() {
        Ok(fg_topology::HeadState::Absent) => {
            let _ = ref_store.update_head_symbolic(&target_ref.to_git_ref());
        }
        Ok(fg_topology::HeadState::Detached(_)) => {
            let _ = ref_store.update_head_detached(commit_oid);
        }
        _ => {}
    }
}

/// Reads every pending `MERGE_HEAD` parent recorded by the three-way merge path.
pub(crate) fn read_merge_heads(git_dir: &Path) -> Vec<Oid> {
    let contents = match fs::read_to_string(git_dir.join("MERGE_HEAD")) {
        Ok(contents) => contents,
        Err(_) => return Vec::new(),
    };
    let mut heads = Vec::new();
    for line in contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        match Oid::from_hex(line) {
            Ok(oid) => heads.push(oid),
            Err(_) => reject(
                CliTag::ERROR,
                format!("MERGE_HEAD contains an invalid object id '{line}'"),
            ),
        }
    }
    heads
}

/// Removes the merge bookkeeping files once a merge commit is final.
pub(crate) fn clear_merge_state(git_dir: &Path, had_merge_head: bool) {
    if !had_merge_head {
        return;
    }
    let _ = fs::remove_file(git_dir.join("MERGE_HEAD"));
    let _ = fs::remove_file(git_dir.join("MERGE_MSG"));
}

/// Outputs commit creation results as JSON or human-readable text.
pub(crate) fn output_commit_result(
    ctx: &CliContext,
    commit_oid: &fractal_git::Oid,
    tree_oid: &fractal_git::Oid,
    policy: &TaxisPolicy,
    actor: &ActorIdentity,
    witness: &ValidatedCommitWitness,
    staged_files: &[String],
) {
    if ctx.json_mode {
        let commit_payload = serde_json::json!({
            "status": "committed",
            "commit_oid": commit_oid.to_hex(),
            "tree_oid": tree_oid.to_hex(),
            "files": staged_files,
            "policy": policy.name,
            "commit_type": witness.commit_type,
            "scope": witness.scope,
            "is_human": actor.is_human(),
            "actor": actor.display_name(),
        });
        print_json(&commit_payload);
    } else {
        println!(
            "{} Created atomic commit {}",
            CliTag::COMMIT_OK,
            commit_oid.to_hex()
        );
        println!("  Tree   : {}", tree_oid.to_hex());
        println!("  Files  : {:?}", staged_files);
        println!("  Policy : {} (Rust-Grade Strict)", policy.name);
        println!(
            "  Actor  : {} (Human: {})",
            actor.display_name(),
            actor.is_human()
        );
        println!(
            "  Type   : {}{}",
            witness.commit_type,
            witness
                .scope
                .as_ref()
                .map(|scope_val| format!("({})", scope_val))
                .unwrap_or_default()
        );
    }
}

/// Records the commit operation snapshot into the operation graph.
pub(crate) fn record_commit_in_operation_graph(
    ctx: &CliContext,
    commit_oid: &fractal_git::Oid,
    target_ref: &FractalRef,
    actor: &ActorIdentity,
    witness: &ValidatedCommitWitness,
) {
    let git_ref = target_ref.to_git_ref();
    let actor_name = actor.display_name();
    record_head_operation(HeadOperationSpec {
        git_dir: &ctx.git_dir,
        head_oid: *commit_oid,
        branch_or_ref: Some(&git_ref),
        actor: &actor_name,
        command: "commit",
        description: format!("commit: {}", witness.commit_type),
    });
}

/// Records mechanical block-level provenance with host nanosecond physical timestamps.
pub(crate) fn record_block_provenance(
    ctx: &CliContext,
    materialized: &fractal_git::MaterializedCommit,
    staged_files: &[String],
    agent_id: &str,
    cell_id: &str,
) {
    let physical_timestamp_ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_nanos() as u64)
        .unwrap_or(0);

    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    let mut entries = Vec::with_capacity(staged_files.len());
    let base_commit = materialized.parent_oid.unwrap_or(Oid::ZERO);

    for (i, file_path) in staged_files.iter().enumerate() {
        let blob_oid = materialized.blob_oids.get(i).copied().unwrap_or(Oid::ZERO);
        let full_path = work_root.join(file_path);
        let line_count = if let Ok(content) = fs::read_to_string(&full_path) {
            content.lines().count().max(1) as u32
        } else {
            1
        };

        entries.push(BlockProvenanceEntry::new(BlockProvenanceParams {
            file_path: file_path.clone(),
            block_id: format!("{file_path}:root"),
            line_span: (1, line_count),
            block_hash: blob_oid,
            physical_timestamp_ns,
            ccd_generation: 1,
            agent_uid: agent_id.to_string(),
            cell_id: cell_id.to_string(),
            base_commit,
        }));
    }

    let store = DiskProvenanceStore::new(&ctx.git_dir);
    let _ = store.record_batch(entries);
}

/// Asserts that all staged files belong to active controlled projects and no TTL lease has expired.
pub(crate) fn verify_project_lease_authorization(git_dir: &Path, staged_files: &[String]) {
    let now_secs = current_unix_seconds() as u64;
    let store = DiskProjectStore::new(git_dir);
    let work_root = git_dir.parent().unwrap_or_else(|| Path::new("."));

    let cache = match store.load_or_discover(Some(work_root), now_secs) {
        Ok(loaded_cache) => loaded_cache,
        Err(_) => return,
    };

    let files_to_check: Vec<&str> = if staged_files.is_empty() {
        vec![DEFAULT_COMMIT_FILE]
    } else {
        staged_files.iter().map(|path| path.as_str()).collect()
    };

    let affected_projects = store.resolve_affected_projects(&cache, &files_to_check);
    for project_id in &affected_projects {
        if let Some(lease) = cache.get(project_id) {
            if lease.status == LeaseStatus::Frozen || lease.is_expired(now_secs) {
                reject(
                    CliTag::AUTHORITY_BREACH,
                    format!(
                        "Commit authorization locked: TTL lease expired for project '{}'. All human and agent commits are frozen. Run 'taxis project renew {}' to unfreeze.",
                        project_id, project_id
                    ),
                );
            }
        }
    }
}

/// Touches affected project leases to record commit activity and reset dormant counter.
pub(crate) fn touch_affected_project_leases(git_dir: &Path, staged_files: &[String]) {
    let now_secs = current_unix_seconds() as u64;
    let store = DiskProjectStore::new(git_dir);
    let work_root = git_dir.parent().unwrap_or_else(|| Path::new("."));

    let cache = match store.load_or_discover(Some(work_root), now_secs) {
        Ok(loaded_cache) => loaded_cache,
        Err(_) => return,
    };

    let files_to_check: Vec<&str> = if staged_files.is_empty() {
        vec![DEFAULT_COMMIT_FILE]
    } else {
        staged_files.iter().map(|path| path.as_str()).collect()
    };

    let affected_projects = store.resolve_affected_projects(&cache, &files_to_check);
    for project_id in affected_projects {
        let _ = store.touch_project(&project_id, now_secs);
    }
}
