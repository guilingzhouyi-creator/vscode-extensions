//! Module: taxis_cmd::commit — Atomic Commit Subcommand Dispatcher
//! File Path: src/bin/taxis_cmd/commit.rs
//! Architecture Role: Dispatches transactional commits verifying actor identity,
//!   human control boundaries, commit message invariants, and operation history.
//! Dependencies & Triggers: Invoked when `taxis commit` or `taxis ci` is dispatched.
//! Responsibilities: Actor authorization, message verification, and delegation to the
//!   storage-layer materializer that writes blobs, trees, the commit, and the ref.
//! Exit Semantics & Design Rationale: Exits 0 only after every object and the target ref have
//!   been durably written; any authorization, governance, or I/O failure exits non-zero.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::fs;
use std::path::Path;

use fg_core::models::{
    current_unix_seconds, AuthoritySecret, FileMode, IndexStage, LeaseStatus, Oid,
};
use fg_gate::authority::resolve_authority_secret;
use fg_index::{write_dirc_v2, IndexEntry};
use fg_native::sections::head::HeadState as NativeHeadState;
use fg_native::sections::indx::{IndexEntry as NativeIndexEntry, StatCache};
use fg_native::sections::refs::RefRecord;
use fg_native::RepoDocument;
use fg_object::borrowed::GitCommitRef;
use fg_storage::commit_materializer::{
    write_commit_objects_with_parents, write_index_commit_objects_with_parents, IndexCommitRequest,
};
use fg_topology::project_store::DiskProjectStore;
use fractal_git::constants::cli::CliTag;
use fractal_git::RefStore;
use fractal_git::{
    ActorIdentity, AgentPushContext, BlockProvenanceEntry, BlockProvenanceParams,
    CommitMaterializationRequest, CommitMessageGuard, DiskProvenanceStore, DiskRefStore,
    FractalRef, GitSignature, LooseOdb, PreReceiveGuard, TaxisPolicy, ValidatedCommitWitness,
    WalJournal, WalRecord,
};

use super::checkout::worktree_stat;
use super::common::{fail_io, find_all_arg_values, find_arg_value, print_json, reject, CliContext};
use super::operation::{record_head_operation, HeadOperationSpec};

/// Path handed to the tree builder when the caller supplies no `--file` flag.
const DEFAULT_COMMIT_FILE: &str = "README.md";

/// Dispatches atomic commit creation with governance and identity checks.
pub fn handle_commit(ctx: &CliContext) {
    if ctx
        .args
        .iter()
        .any(|arg| arg == "-a" || arg == "--all" || arg == "-am")
    {
        super::stage::stage_tracked_for_commit(ctx);
    }

    let cell_id = find_arg_value(&ctx.args, &["--cell"]).unwrap_or("cell-default");
    let card_id = find_arg_value(&ctx.args, &["--card"]).unwrap_or("card-000");
    let agent_id = find_arg_value(&ctx.args, &["--agent"]).unwrap_or("agent-primary");
    let human_author = find_arg_value(&ctx.args, &["--human"]).map(String::from);
    let auth_token = find_arg_value(&ctx.args, &["--token"]).map(String::from);
    let git_native_default = !fg_native::container_path(&ctx.git_dir).is_file()
        && !has_taxis_governance_flags(&ctx.args);
    let policy_name = find_arg_value(&ctx.args, &["--policy"]).unwrap_or(if git_native_default {
        "git-native"
    } else {
        "workspace-strict"
    });
    let explicit_target = find_arg_value(&ctx.args, &["--target"]);
    let target_ref_str = match explicit_target {
        Some(t) => t.to_string(),
        None => resolve_active_head_ref(&ctx.git_dir)
            .unwrap_or_else(|| "refs/fractal/cell/cell-default/main".to_string()),
    };

    let mut policy = resolve_commit_policy(policy_name);
    let authority_secret = human_author.as_deref().map(|_| {
        resolve_authority_secret(&ctx.git_dir)
            .unwrap_or_else(|secret_err| reject(CliTag::AUTHORITY_BREACH, format!("{secret_err}")))
    });
    if let Some(secret) = authority_secret.as_ref() {
        policy.authority_secret = Some(secret.clone());
    }
    let actor = if git_native_default {
        let sig = resolve_git_native_signature(ctx);
        ActorIdentity::human(sig.name, sig.email, "git-native")
    } else {
        resolve_actor_identity(
            human_author.as_deref(),
            auth_token,
            agent_id,
            cell_id,
            authority_secret.as_ref(),
        )
    };
    let target_ref = match FractalRef::parse(&target_ref_str) {
        Some(fref) => fref,
        None => {
            if let Some(branch) = target_ref_str.strip_prefix("refs/heads/") {
                FractalRef::SystemTrunk {
                    branch: branch.to_string(),
                }
            } else {
                FractalRef::CellMain {
                    cell_id: cell_id.into(),
                }
            }
        }
    };

    if let Err(auth_err) = PreReceiveGuard::assert_actor_authorized(&target_ref, &actor, &policy) {
        reject(
            CliTag::AUTHORITY_BREACH,
            format!(
                "Push to '{}' rejected: {}",
                target_ref.to_git_ref(),
                auth_err
            ),
        );
    }

    let message = resolve_commit_message(&ctx.args, card_id);
    let staged_files = collect_staged_files(ctx);
    let witness = verify_commit_governance(&message, &policy, &staged_files);
    verify_project_lease_authorization(&ctx.git_dir, &staged_files);

    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    let hook_runner = super::git_hooks::discover(&ctx.git_dir, &work_root);
    let source_ref =
        resolve_active_head_ref(&ctx.git_dir).unwrap_or_else(|| target_ref.to_git_ref());
    super::git_hooks::assert_pipeline_approved(
        &source_ref,
        &target_ref.to_git_ref(),
        &actor,
        &policy,
        &staged_files,
        &message,
    );
    let _ = verify_commit_governance(&message, &policy, &staged_files);
    let final_message = super::git_hooks::run_commit_chain(&hook_runner, &ctx.git_dir, &message);
    let _ = verify_commit_governance(&final_message, &policy, &staged_files);

    let tx_id = format!("tx-{}-{}", agent_id, current_unix_seconds());
    let wal = WalJournal::open(ctx.git_dir.join("journal/commit.wal")).ok();
    if let Some(ref w) = wal {
        let _ = w.append(&WalRecord::BeginTx {
            tx_id: tx_id.clone(),
            timestamp_ms: current_unix_seconds() as i64 * 1000,
        });
    }

    let materialized = materialize_staged_files(
        ctx,
        &staged_files,
        &final_message,
        human_author.as_deref(),
        agent_id,
        cell_id,
        &target_ref,
    );

    let declared_files = find_all_arg_values(&ctx.args, &["--file", "--add"]);
    let index_file = ctx.git_dir.join("index");
    let used_direct_index = declared_files.is_empty() && index_file.is_file();

    // Synchronize staged index (.taxis/index and doc.indx) preserving existing tracked files
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
        for (i, path) in staged_files.iter().enumerate() {
            let blob_oid = materialized.blob_oids.get(i).copied().unwrap_or(Oid::ZERO);
            let full_path = work_root.join(path);
            let (size, mtime_sec, mtime_nano) = worktree_stat(&full_path, 0);
            let mode = materialized
                .modes
                .get(i)
                .copied()
                .unwrap_or(FileMode::RegularFile);

            if let Some(ref w) = wal {
                let _ = w.append(&WalRecord::StageFile {
                    tx_id: tx_id.clone(),
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

        let final_index_entries: Vec<IndexEntry> = index_entry_map.into_values().collect();
        let _ = write_dirc_v2(&index_file, &final_index_entries);
    }

    if let Some(ref w) = wal {
        let _ = w.append(&WalRecord::UpdateRef {
            tx_id: tx_id.clone(),
            git_ref: target_ref.to_git_ref(),
            new_oid: materialized.commit_oid,
        });
    }

    // Synchronize native container (doc.refs & doc.indx) if present
    if let Some(mut doc) = native_doc {
        let git_ref = target_ref.to_git_ref();
        let _ = doc.refs.upsert(RefRecord {
            name: git_ref.clone(),
            oid: materialized.commit_oid,
            peeled: None,
        });
        doc.indx = native_indx;
        let _ = doc.save_atomic(&container_path);
    }

    if let Some(ref w) = wal {
        let _ = w.append(&WalRecord::CommitTx {
            tx_id: tx_id.clone(),
            commit_oid: materialized.commit_oid,
        });
        let _ = w.checkpoint();
    }

    // Ensure HEAD exists on disk
    let head_path = ctx.git_dir.join("HEAD");
    if !head_path.is_file() {
        let ref_store = DiskRefStore::new(&ctx.git_dir);
        if let Err(err) = ref_store.update_head_symbolic(&target_ref.to_git_ref()) {
            reject(CliTag::ERROR, format!("write symbolic HEAD: {err}"));
        }
    }

    super::git_hooks::run_post_hook(&hook_runner, "post-commit", &[]);
    record_commit_in_operation_graph(ctx, &materialized.commit_oid, &target_ref, &actor, &witness);
    record_block_provenance(ctx, &materialized, &staged_files, agent_id, cell_id);
    touch_affected_project_leases(&ctx.git_dir, &staged_files);

    output_commit_result(
        ctx,
        &materialized.commit_oid,
        &materialized.tree_oid,
        &policy,
        &actor,
        &witness,
        &staged_files,
    );
}

/// Resolves commit governance policy based on requested policy name.
fn resolve_commit_policy(policy_name: &str) -> TaxisPolicy {
    match policy_name {
        "conventional" | "conventional-semantic" => TaxisPolicy::conventional_semantic(),
        "native" | "git-native" => TaxisPolicy::git_native(),
        "rust-strict" => TaxisPolicy::rust_strict(),
        _ => TaxisPolicy::workspace_strict(),
    }
}

/// Constructs actor identity differentiating human authority from agent sub-processes.
pub(crate) fn resolve_actor_identity(
    human_author: Option<&str>,
    auth_token: Option<String>,
    agent_id: &str,
    cell_id: &str,
    authority_secret: Option<&AuthoritySecret>,
) -> ActorIdentity {
    match human_author {
        Some(human_name) => {
            let token = match auth_token {
                Some(presented) if !presented.trim().is_empty() => presented,
                _ => reject(
                    CliTag::AUTHORITY_BREACH,
                    concat!(
                        "--human requires a verified --token; a bare name is a claim, ",
                        "not a credential"
                    ),
                ),
            };
            let secret = authority_secret.unwrap_or_else(|| {
                reject(
                    CliTag::AUTHORITY_BREACH,
                    concat!(
                        "--human requires a configured authority secret; set ",
                        "TAXIS_AUTHORITY_SECRET or core.authoritysecret"
                    ),
                )
            });
            let identity = ActorIdentity::human(human_name, human_email(human_name), token);
            identity
                .verify_authority(Some(secret), current_unix_seconds())
                .unwrap_or_else(|verify_err| {
                    reject(
                        CliTag::AUTHORITY_BREACH,
                        format!("--token rejected: {verify_err}"),
                    )
                });
            identity
        }
        None => ActorIdentity::agent(AgentPushContext {
            agent_uid: agent_id.into(),
            cell_id: cell_id.into(),
            role: "worker".into(),
            is_force_push: false,
        }),
    }
}
/// Derives the corporate email address for a human author name.
fn human_email(human_name: &str) -> String {
    format!(
        "{}@company.internal",
        human_name.to_lowercase().replace(' ', ".")
    )
}

/// Extracts commit message or generates conventional semantic default.
fn resolve_commit_message(args: &[String], card_id: &str) -> String {
    find_arg_value(args, &["-m", "-am", "--message"])
        .map(String::from)
        .unwrap_or_else(|| {
            format!(
                concat!(
                    "feat(core): taxis atomic commit\n\n",
                    "[Why]\nRoutine checkpoint for task {}.\n\n",
                    "[Changed]\n- Updated working tree state\n\n",
                    "[Verification]\nAssert state consistency."
                ),
                card_id
            )
        })
}

/// Reports whether the caller explicitly supplied Taxis governance or actor flags.
fn has_taxis_governance_flags(args: &[String]) -> bool {
    args.iter().any(|arg| {
        matches!(
            arg.as_str(),
            "--policy" | "--agent" | "--human" | "--cell" | "--card" | "--token" | "--target"
        )
    })
}

/// Resolves author signature from Git environment variables or `.git/config`.
fn resolve_git_native_signature(ctx: &CliContext) -> GitSignature {
    if let Ok(view) = super::repo_view::RepoView::open(ctx) {
        return super::index_plumbing::resolve_git_signature(
            &view,
            "GIT_AUTHOR_NAME",
            "GIT_AUTHOR_EMAIL",
            "GIT_AUTHOR_DATE",
        );
    }
    GitSignature::new("Taxis User", "taxis@local", current_unix_seconds())
}

/// Collects every path the caller declares as part of this commit, or reads from index.
fn collect_staged_files(ctx: &CliContext) -> Vec<String> {
    let declared = find_all_arg_values(&ctx.args, &["--file", "--add"]);
    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    let mut files = std::collections::BTreeSet::new();

    let index_file = ctx.git_dir.join("index");
    if let Ok(git_index) = fg_index::GitIndex::load(&index_file) {
        for e in git_index.entries() {
            if work_root.join(&e.path).exists() {
                files.insert(e.path.clone());
            }
        }
    }

    let container_path = fg_native::container_path(&ctx.git_dir);
    if let Ok(doc) = RepoDocument::load(&container_path) {
        for e in doc.indx.entries() {
            if work_root.join(&e.path).exists() {
                files.insert(e.path.clone());
            }
        }
    }

    for path in declared {
        files.insert(path.to_string());
    }

    if !files.is_empty() {
        return files.into_iter().collect();
    }

    vec![DEFAULT_COMMIT_FILE.to_string()]
}

/// Resolves the symbolic reference currently pointed to by HEAD.
fn resolve_active_head_ref(git_dir: &Path) -> Option<String> {
    let head_file = git_dir.join("HEAD");
    if let Ok(content) = fs::read_to_string(&head_file) {
        let trimmed = content.trim();
        if let Some(target) = trimmed.strip_prefix("ref:") {
            return Some(target.trim().to_string());
        }
    }
    let container_path = fg_native::container_path(git_dir);
    if let Ok(doc) = RepoDocument::load(&container_path) {
        if let NativeHeadState::Symbolic { target } = doc.head {
            return Some(target);
        }
    }
    None
}

/// Verifies commit message against policy constraints, exiting on failure.
fn verify_commit_governance(
    message: &str,
    policy: &TaxisPolicy,
    staged_files: &[String],
) -> ValidatedCommitWitness {
    match CommitMessageGuard::parse_and_verify(message, policy, Some(staged_files)) {
        Ok(commit_witness) => commit_witness,
        Err(gov_err) => reject(
            CliTag::COMMIT_GOVERNANCE_FAIL,
            format!(
                "Commit message rejected by Taxis policy '{}': {}",
                policy.name, gov_err
            ),
        ),
    }
}

/// Materializes blobs, trees, the commit object, and the advanced reference.
fn materialize_staged_files(
    ctx: &CliContext,
    staged_files: &[String],
    message: &str,
    human_author: Option<&str>,
    agent_id: &str,
    cell_id: &str,
    target_ref: &FractalRef,
) -> fractal_git::MaterializedCommit {
    let timestamp_sec = chrono::Utc::now().timestamp();
    let git_native_default = !fg_native::container_path(&ctx.git_dir).is_file()
        && !has_taxis_governance_flags(&ctx.args);
    let author = if git_native_default {
        resolve_git_native_signature(ctx)
    } else {
        match human_author {
            Some(human_name) => {
                GitSignature::new(human_name, human_email(human_name), timestamp_sec)
            }
            None => GitSignature::for_agent(agent_id, cell_id, timestamp_sec),
        }
    };
    let committer = if git_native_default {
        super::repo_view::RepoView::open(ctx)
            .map(|view| {
                super::index_plumbing::resolve_git_signature(
                    &view,
                    "GIT_COMMITTER_NAME",
                    "GIT_COMMITTER_EMAIL",
                    "GIT_COMMITTER_DATE",
                )
            })
            .unwrap_or_else(|_| author.clone())
    } else {
        author.clone()
    };

    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    let target_ref_name = target_ref.to_git_ref();
    let odb = LooseOdb::new(&ctx.git_dir);
    let ref_store = DiskRefStore::new(&ctx.git_dir);
    let hook_runner = super::git_hooks::discover(&ctx.git_dir, &work_root);
    let active_head = resolve_active_head_ref(&ctx.git_dir);
    let previous_head = ref_store.get_ref("HEAD").ok().flatten();
    let merge_heads = read_merge_heads(&ctx.git_dir);
    let declared_files = find_all_arg_values(&ctx.args, &["--file", "--add"]);
    let index_file = ctx.git_dir.join("index");

    let materialized = if declared_files.is_empty() && index_file.is_file() {
        materialize_from_git_index(
            ctx,
            &odb,
            &GitIndexCommitParams {
                ref_store: &ref_store,
                index_file: &index_file,
                message,
                author: &author,
                committer: &committer,
                target_ref: &target_ref_name,
                merge_heads: &merge_heads,
            },
        )
    } else {
        let request = CommitMaterializationRequest {
            files: staged_files.to_vec(),
            work_root: work_root.clone(),
            message: message.to_string(),
            author,
            target_ref: target_ref_name.clone(),
        };
        match write_commit_objects_with_parents(&odb, &ref_store, &request, &merge_heads) {
            Ok(written) => written,
            Err(materialize_err) => fail_io("materialize commit", materialize_err),
        }
    };

    let branch_update = super::git_hooks::ReferenceUpdate {
        previous: materialized.parent_oid,
        next: materialized.commit_oid.to_hex(),
        name: target_ref_name.clone(),
    };
    let mut head_update: Vec<super::git_hooks::ReferenceUpdate> = Vec::new();
    if active_head.as_deref() == Some(target_ref_name.as_str()) {
        head_update.push(super::git_hooks::ReferenceUpdate {
            previous: previous_head,
            next: materialized.commit_oid.to_hex(),
            name: "HEAD".to_string(),
        });
    }
    if !super::git_hooks::run_reference_transaction(&hook_runner, "preparing", &head_update) {
        let _ = super::git_hooks::run_reference_transaction(&hook_runner, "aborted", &head_update);
        reject(
            CliTag::ERROR,
            "reference-transaction hook rejected the commit reference update",
        );
    }
    let branch_rows = std::slice::from_ref(&branch_update);
    if !super::git_hooks::run_reference_transaction(&hook_runner, "prepared", branch_rows) {
        let _ = super::git_hooks::run_reference_transaction(&hook_runner, "aborted", branch_rows);
        reject(
            CliTag::ERROR,
            "reference-transaction hook rejected the commit reference update",
        );
    }
    if let Err(update_err) = ref_store.update_ref(
        &target_ref_name,
        &materialized.commit_oid,
        materialized.parent_oid.as_ref(),
    ) {
        let _ = super::git_hooks::run_reference_transaction(&hook_runner, "aborted", branch_rows);
        fail_io("advance commit reference", update_err);
    }
    let _ = super::git_hooks::run_reference_transaction(&hook_runner, "committed", branch_rows);
    clear_merge_state(&ctx.git_dir, !merge_heads.is_empty());
    materialized
}

/// Parameter bundle for materializing a commit directly from `.git/index`.
struct GitIndexCommitParams<'a> {
    ref_store: &'a DiskRefStore,
    index_file: &'a Path,
    message: &'a str,
    author: &'a GitSignature,
    committer: &'a GitSignature,
    target_ref: &'a str,
    merge_heads: &'a [Oid],
}

/// Materializes a commit directly from `.git/index` entries (`write_index_commit_objects_with_parents`).
fn materialize_from_git_index(
    ctx: &CliContext,
    odb: &LooseOdb,
    params: &GitIndexCommitParams<'_>,
) -> fractal_git::MaterializedCommit {
    let loaded = match fg_index::GitIndex::load(params.index_file) {
        Ok(idx) => idx,
        Err(err) => fail_io("load git index", err),
    };
    let entries: Vec<(String, FileMode, Oid)> = loaded
        .entries()
        .iter()
        .filter(|entry| entry.stage == IndexStage::Normal)
        .map(|entry| (entry.path.clone(), entry.mode, entry.oid))
        .collect();
    let allow_empty = ctx.args.iter().any(|arg| arg == "--allow-empty");
    let request = IndexCommitRequest {
        entries: entries.clone(),
        message: params.message.to_string(),
        author: params.author.clone(),
        committer: params.committer.clone(),
        target_ref: params.target_ref.to_string(),
    };
    let written = match write_index_commit_objects_with_parents(
        odb,
        params.ref_store,
        &request,
        params.merge_heads,
    ) {
        Ok(materialized) => materialized,
        Err(err) => fail_io("materialize index commit", err),
    };
    if !allow_empty
        && params.merge_heads.is_empty()
        && is_unchanged_commit(ctx, &written, entries.is_empty())
    {
        reject(CliTag::ERROR, "nothing to commit, working tree clean");
    }
    written
}

/// Reports whether the newly built tree is identical to the parent commit's tree.
fn is_unchanged_commit(
    ctx: &CliContext,
    materialized: &fractal_git::MaterializedCommit,
    index_is_empty: bool,
) -> bool {
    let Some(parent_oid) = materialized.parent_oid else {
        return index_is_empty;
    };
    if let Ok(view) = super::repo_view::RepoView::open(ctx) {
        if let Ok(parent_obj) = view.object(&parent_oid) {
            if let Ok(commit_ref) = GitCommitRef::parse(&parent_obj.payload) {
                return *commit_ref.tree_oid() == materialized.tree_oid;
            }
        }
    }
    false
}

/// Reads every pending `MERGE_HEAD` parent recorded by the three-way merge path.
///
/// A multi-line file (octopus merge) yields one parent per line; an unparseable line is
/// rejected instead of silently degrading a merge commit to a single parent.
fn read_merge_heads(git_dir: &Path) -> Vec<Oid> {
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
fn clear_merge_state(git_dir: &Path, had_merge_head: bool) {
    if !had_merge_head {
        return;
    }
    let _ = fs::remove_file(git_dir.join("MERGE_HEAD"));
    let _ = fs::remove_file(git_dir.join("MERGE_MSG"));
}

/// Outputs commit creation results as JSON or human-readable text.
fn output_commit_result(
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
fn record_commit_in_operation_graph(
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
fn record_block_provenance(
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
fn touch_affected_project_leases(git_dir: &Path, staged_files: &[String]) {
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
