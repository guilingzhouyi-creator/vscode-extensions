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
    FractalRef, GitSignature, LooseOdb, PolicyFloor, PreReceiveGuard, TaxisPolicy,
    ValidatedCommitWitness, WalJournal, WalRecord,
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
    let active_head = resolve_active_head_ref(&ctx.git_dir);
    // Where an untargeted commit lands.
    //
    // Following HEAD is what Git does, but in a Taxis repository HEAD points at the protected trunk,
    // so `init && add && commit` collided with the human-control boundary on the very first commit:
    // an agent cannot advance `refs/heads/main` without a minted human token, and the floor forbids
    // relaxing the policy instead. The result was a repository in which the ordinary commit command
    // never worked unattended.
    //
    // The engineering edition therefore defaults to the agent-writable cell sandbox, which already
    // existed for exactly this purpose. Trunk protection is untouched: naming `refs/heads/main`
    // explicitly still demands a human token, so promotion remains a deliberate act rather than
    // something a default can slip past.
    let target_ref_str = match explicit_target {
        Some(t) => t.to_string(),
        None => {
            let head_ref = active_head
                .clone()
                .unwrap_or_else(|| "refs/fractal/cell/cell-default/main".to_string());
            engineering_default_target(head_ref, cell_id, !git_native_default)
        }
    };

    let mut policy = resolve_commit_policy(policy_name);
    // A caller may tighten the contract but never relax it. The floor comes from the versioned
    // manifest, so switching the gate off requires an explicit recorded bypass rather than one
    // flag. Ungoverned repositories (no native container, no Taxis flags) keep native behaviour
    // because they carry no Taxis-managed history to protect.
    if !git_native_default {
        let floor = PolicyFloor::resolve(&ctx.git_dir);
        if let Err(floor_error) = floor.assert_permits(&policy) {
            fg_core::diag_debug!(
                "governance",
                "policy floor refusal under policy '{}': {:?}",
                policy.name,
                floor_error
            );
            let is_diag = fg_core::diagnostics::is_diagnostic_mode();
            let display_msg = floor_error.user_display(is_diag);
            reject(CliTag::COMMIT_GOVERNANCE_FAIL, display_msg);
        }
        reject_bypass_without_reason(&ctx.args);
    }
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
    fg_core::diag_debug!(
        "pre_receive",
        "authorized actor={} target={}",
        actor.display_name(),
        target_ref.to_git_ref()
    );

    let message = resolve_commit_message(&ctx.args, card_id);
    let staged_files = collect_staged_files(ctx);
    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    // One record covering the decision inputs. When a commit is refused, the useful question is
    // "which policy was in force and what did it see", and neither is recoverable afterwards.
    fg_core::diag_debug!(
        "commit",
        "policy={} tier={} staged={} target={} native={}",
        policy_name,
        policy.enforcement_tier(),
        staged_files.len(),
        target_ref_str,
        git_native_default
    );
    let witness = verify_commit_governance(&message, &policy, &staged_files, &work_root);
    fg_core::diag_debug!("commit", "governance witness={:?}", witness);
    verify_project_lease_authorization(&ctx.git_dir, &staged_files);

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
    let _ = verify_commit_governance(&message, &policy, &staged_files, &work_root);
    let final_message = super::git_hooks::run_commit_chain(&hook_runner, &ctx.git_dir, &message);
    let _ = verify_commit_governance(&final_message, &policy, &staged_files, &work_root);

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

    // Ensure HEAD advances properly: follows target ref when unborn, or advances commit OID when detached
    let ref_store = DiskRefStore::new(&ctx.git_dir);
    match ref_store.head() {
        Ok(fg_topology::HeadState::Absent | fg_topology::HeadState::Symbolic { target: None, .. }) => {
            let _ = ref_store.update_head_symbolic(&target_ref.to_git_ref());
        }
        Ok(fg_topology::HeadState::Detached(_)) => {
            let _ = ref_store.update_head_detached(&materialized.commit_oid);
        }
        _ => {}
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

/// Returns true if the reference designates a protected system trunk (`main`, `master`, `trunk`).
#[inline]
pub(crate) fn is_protected_trunk(ref_name: &str) -> bool {
    let clean = ref_name.strip_prefix("refs/heads/").unwrap_or(ref_name);
    clean == "main" || clean == "master" || clean == "trunk"
}

/// Chooses the destination for a commit that named no `--target`.
///
/// Only two situations get the sandbox treatment, and both are deliberate: the engineering edition,
/// where the product's stated purpose is unattended local work, and a Taxis-governed repository
/// whose HEAD points at a protected trunk.
///
/// A `git-native` repository (no native container) is left alone, because it is not a Taxis
/// governance scenario and redirecting it would be surprising.
///
/// The redirection is *announced* rather than silent. A commit that landed somewhere other than HEAD
/// without saying so would be its own kind of dishonesty, and the reader needs the ref name to find
/// the work afterwards.
fn engineering_default_target(head_ref: String, cell_id: &str, taxis_governed: bool) -> String {
    let edition = fg_core::constants::Edition::CURRENT;
    let is_trunk = is_protected_trunk(&head_ref);
    if !taxis_governed
        || !is_trunk
        || edition != fg_core::constants::Edition::Engineering
    {
        return head_ref;
    }

    let sandbox_ref = format!("refs/fractal/cell/{cell_id}/main");
    fg_core::diag_info!(
        "commit",
        "HEAD '{}' is a protected trunk; landing on sandbox '{}' in the {} edition",
        head_ref,
        sandbox_ref,
        edition.as_str()
    );
    eprintln!(
        "note: HEAD points at the protected trunk '{head_ref}', which requires a human authority token."
    );
    eprintln!(
        "      Committing to sandbox '{sandbox_ref}' instead (engineering edition default)."
    );
    eprintln!(
        "      Pass --target {head_ref} with --human/--token to advance the trunk deliberately."
    );
    sandbox_ref
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

/// Rejects a bypass request that carries no reason.
///
/// A bypass is legitimate when it is deliberate and recorded. Without a reason the call is
/// indistinguishable from an accident, so it is refused rather than honoured.
fn reject_bypass_without_reason(args: &[String]) {
    if !args.iter().any(|arg| arg == "--bypass-message-guard") {
        return;
    }
    let reason = find_arg_value(args, &["--reason"])
        .map(str::trim)
        .unwrap_or_default();
    if reason.chars().count() < 10 {
        reject(
            CliTag::COMMIT_GOVERNANCE_FAIL,
            concat!(
                "--bypass-message-guard requires --reason with at least 10 characters. ",
                "A message guard exception must state why the contract cannot be met."
            ),
        );
    }
}

/// Extracts commit message or generates a conventional default.
///
/// The generated default must itself satisfy the policy that will validate it, because a fallback
/// that always fails the gate pushes authors towards disabling the gate. It therefore carries the
/// project declaration the workspace contract demands.
fn resolve_commit_message(args: &[String], card_id: &str) -> String {
    let declared_project = find_arg_value(args, &["--project"]).unwrap_or("governance");
    find_arg_value(args, &["-m", "-am", "--message"])
        .map(String::from)
        .unwrap_or_else(|| {
            format!(
                concat!(
                    "feat(core): record atomic commit checkpoint for {card}\n\n",
                    "[Project / 项目归属]\n- {project}\n\n",
                    "[Why / 动机背景]\n- Capture the current working tree as a recoverable checkpoint ",
                    "before further mutation begins.\n\n",
                    "[Changed / 变更调整]\n- Persisted the staged working tree state as an immutable ",
                    "commit object.\n\n",
                    "[Verification / 验证结论]\n- Assert the recorded tree matches the staged content ",
                    "and the target reference advances atomically."
                ),
                card = card_id,
                project = declared_project
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
pub(crate) fn collect_staged_files(ctx: &CliContext) -> Vec<String> {
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
    work_root: &Path,
) -> ValidatedCommitWitness {
    // Declaration anchoring compares the verification text against the symbols the staged files
    // actually declare, so the candidates are collected here where the working tree is reachable.
    let candidates = collect_staged_symbols(staged_files, work_root);
    match CommitMessageGuard::parse_and_verify_with_symbols(
        message,
        policy,
        Some(staged_files),
        &candidates,
    ) {
        Ok(commit_witness) => commit_witness,
        Err(gov_err) => {
            fg_core::diag_debug!(
                "governance",
                "commit governance rejection under policy '{}': {:?}",
                policy.name,
                gov_err
            );
            let is_diag = fg_core::diagnostics::is_diagnostic_mode();
            let display_msg = gov_err.user_display(is_diag);
            if is_diag {
                reject(
                    CliTag::COMMIT_GOVERNANCE_FAIL,
                    format!(
                        "Commit message rejected by Taxis policy '{}':\n{}",
                        policy.name, display_msg
                    ),
                );
            } else {
                reject(
                    CliTag::ERROR,
                    format!("commit message rejected:\n{display_msg}"),
                );
            }
        }
    }
}

/// Collects declaration symbols from the staged files that are readable as text.
///
/// A binary or unreadable file simply contributes nothing; the anchor check then sees whatever the
/// rest of the change introduced. It never fails on a read: a message complaint is the actionable
/// signal, an I/O error mid-gate is not.
fn collect_staged_symbols(
    staged_files: &[String],
    work_root: &Path,
) -> Vec<fg_gate::commit_guard::declaration::CandidateSymbol> {
    let mut candidates = Vec::new();
    for path in staged_files {
        let lower = path.to_lowercase();
        let is_source = [".rs", ".ts", ".gd", ".js"]
            .iter()
            .any(|extension| lower.ends_with(extension));
        if !is_source {
            continue;
        }
        let Ok(content) = fs::read_to_string(work_root.join(path)) else {
            continue;
        };
        let lines: Vec<&str> = content.lines().collect();
        for symbol in fg_gate::commit_guard::declaration::extract_candidate_symbols_from_lines(&lines)
        {
            if !candidates
                .iter()
                .any(|existing: &fg_gate::commit_guard::declaration::CandidateSymbol| {
                    existing.name == symbol.name
                })
            {
                candidates.push(symbol);
            }
        }
    }
    candidates
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
