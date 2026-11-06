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

use fg_core::models::{current_unix_seconds, AuthoritySecret, FileMode, IndexStage, Oid};
use fg_gate::authority::resolve_authority_secret;
use fg_native::sections::head::HeadState as NativeHeadState;
use fg_native::RepoDocument;
use fg_object::borrowed::GitCommitRef;
use fg_storage::commit_materializer::{
    write_commit_objects_with_parents, write_index_commit_objects_with_parents, IndexCommitRequest,
};
use fractal_git::constants::cli::CliTag;
use fractal_git::RefStore;
use fractal_git::{
    ActorIdentity, AgentPushContext, CommitMaterializationRequest, CommitMessageGuard,
    DiskRefStore, FractalRef, GitSignature, LooseOdb, PolicyFloor, PreReceiveGuard, TaxisPolicy,
    ValidatedCommitWitness,
};

pub(crate) use super::commit_ops::verify_project_lease_authorization;
use super::commit_ops::*;
use super::common::{fail_io, find_all_arg_values, find_arg_value, reject, CliContext};

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

    let (git_native_default, target_ref, mut policy) =
        resolve_commit_target_and_policy(ctx, cell_id);
    let actor = authorize_commit_actor(
        ctx,
        (git_native_default, cell_id, agent_id),
        (&target_ref, &mut policy),
    );

    let message = resolve_commit_message(&ctx.args, card_id);
    let staged_files = collect_staged_files(ctx);
    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    fg_core::diag_debug!(
        "commit",
        "policy={} tier={} staged={} target={} native={}",
        policy.name,
        policy.enforcement_tier(),
        staged_files.len(),
        target_ref.to_git_ref(),
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
    let wal = open_and_begin_commit_wal(&ctx.git_dir, &tx_id);

    let materialized = materialize_staged_files(
        ctx,
        &staged_files,
        &final_message,
        human_author.as_deref(),
        agent_id,
        cell_id,
        &target_ref,
    );

    sync_committed_index_and_container(
        ctx,
        (&tx_id, wal.as_ref(), &target_ref),
        (
            &staged_files,
            materialized.commit_oid,
            &materialized.blob_oids,
            &materialized.modes,
        ),
    );
    advance_head_after_commit(&ctx.git_dir, &target_ref, &materialized.commit_oid);

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

/// Resolves default/explicit commit target reference and enforces policy floor invariants.
fn resolve_commit_target_and_policy(
    ctx: &CliContext,
    cell_id: &str,
) -> (bool, FractalRef, TaxisPolicy) {
    let git_native_default = !fg_native::container_path(&ctx.git_dir).is_file()
        && !has_taxis_governance_flags(&ctx.args);
    let policy_name = find_arg_value(&ctx.args, &["--policy"]).unwrap_or(if git_native_default {
        "git-native"
    } else {
        "workspace-strict"
    });
    let explicit_target = find_arg_value(&ctx.args, &["--target"]);
    let active_head = resolve_active_head_ref(&ctx.git_dir);
    let target_ref_str = match explicit_target {
        Some(t) => t.to_string(),
        None => {
            let head_ref =
                active_head.unwrap_or_else(|| "refs/fractal/cell/cell-default/main".to_string());
            engineering_default_target(head_ref, cell_id, !git_native_default)
        }
    };

    let policy = resolve_commit_policy(policy_name);
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
            reject(
                CliTag::COMMIT_GOVERNANCE_FAIL,
                floor_error.user_display(is_diag),
            );
        }
        reject_bypass_without_reason(&ctx.args);
    }

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

    (git_native_default, target_ref, policy)
}

/// Resolves the committing actor identity and verifies pre-receive target authorization.
fn authorize_commit_actor(
    ctx: &CliContext,
    actor_meta: (bool, &str, &str),
    target_and_policy: (&FractalRef, &mut TaxisPolicy),
) -> ActorIdentity {
    let (git_native_default, cell_id, agent_id) = actor_meta;
    let (target_ref, policy) = target_and_policy;
    let human_author = find_arg_value(&ctx.args, &["--human"]).map(String::from);
    let auth_token = find_arg_value(&ctx.args, &["--token"]).map(String::from);

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

    if let Err(auth_err) = PreReceiveGuard::assert_actor_authorized(target_ref, &actor, policy) {
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
    actor
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
    if !taxis_governed || !is_trunk || edition != fg_core::constants::Edition::Engineering {
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
    eprintln!("      Committing to sandbox '{sandbox_ref}' instead (engineering edition default).");
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

/// Collects every path the caller declares as part of this commit, or reads changed paths from index.
pub(crate) fn collect_staged_files(ctx: &CliContext) -> Vec<String> {
    let declared = find_all_arg_values(&ctx.args, &["--file", "--add"]);
    let work_root = super::repo_view::resolve_work_root(&ctx.git_dir);
    let mut files = std::collections::BTreeSet::new();
    let mut index_entries: std::collections::BTreeMap<String, (Oid, FileMode)> =
        std::collections::BTreeMap::new();

    let index_file = ctx.git_dir.join("index");
    if let Ok(git_index) = fg_index::GitIndex::load(&index_file) {
        for e in git_index.entries() {
            if work_root.join(&e.path).exists() {
                files.insert(e.path.clone());
                index_entries.insert(e.path.clone(), (e.oid, e.mode));
            }
        }
    }

    let container_path = fg_native::container_path(&ctx.git_dir);
    if let Ok(doc) = RepoDocument::load(&container_path) {
        for e in doc.indx.entries() {
            if work_root.join(&e.path).exists() {
                files.insert(e.path.clone());
                index_entries
                    .entry(e.path.clone())
                    .or_insert((e.oid, e.mode));
            }
        }
    }

    if !declared.is_empty() {
        for path in declared {
            files.insert(path.to_string());
        }
        return files.into_iter().collect();
    }

    if !index_entries.is_empty() {
        if let Ok(view) = super::repo_view::RepoView::open(ctx) {
            if let Ok(Some((_, head_oid))) = view.effective_head_commit() {
                if let Ok(head_tree) = super::tree_view::flatten_commit_tree(&view, &head_oid) {
                    let changed: Vec<String> = index_entries
                        .iter()
                        .filter_map(|(path, (oid, mode))| match head_tree.get(path) {
                            Some(te) if te.oid == *oid && te.mode == *mode => None,
                            _ => Some(path.clone()),
                        })
                        .collect();
                    if !changed.is_empty() {
                        return changed;
                    }
                }
            }
        }
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
        for symbol in
            fg_gate::commit_guard::declaration::extract_candidate_symbols_from_lines(&lines)
        {
            if !candidates.iter().any(
                |existing: &fg_gate::commit_guard::declaration::CandidateSymbol| {
                    existing.name == symbol.name
                },
            ) {
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
    if target_ref_name.starts_with("refs/fractal/cell/")
        && ref_store.get_ref(&target_ref_name).ok().flatten().is_none()
    {
        if let Some(ref head_ref) = active_head {
            if let Ok(Some(trunk_oid)) = ref_store.get_ref(head_ref) {
                let _ = ref_store.update_ref(&target_ref_name, &trunk_oid, None);
            }
        }
    }
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
fn read_merge_heads(git_dir: &Path) -> Vec<Oid> {
    super::commit_ops::read_merge_heads(git_dir)
}

/// Removes the merge bookkeeping files once a merge commit is final.
fn clear_merge_state(git_dir: &Path, had_merge_head: bool) {
    super::commit_ops::clear_merge_state(git_dir, had_merge_head);
}
