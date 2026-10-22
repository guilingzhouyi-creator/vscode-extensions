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

use fractal_git::constants::cli::CliTag;
use fractal_git::{
    materialize_commit, ActorIdentity, AgentPushContext, CommitMaterializationRequest,
    CommitMessageGuard, DiskRefStore, FractalRef, GitSignature, LooseOdb, OperationGraph,
    PreReceiveGuard, RepoViewSnapshot, TaxisPolicy, ValidatedCommitWitness,
};

use super::common::{fail_io, find_all_arg_values, find_arg_value, print_json, reject, CliContext};

/// Path handed to the tree builder when the caller supplies no `--file` flag.
const DEFAULT_COMMIT_FILE: &str = "README.md";

/// Dispatches atomic commit creation with governance and identity checks.
pub fn handle_commit(ctx: &CliContext) {
    let cell_id = find_arg_value(&ctx.args, &["--cell"]).unwrap_or("cell-default");
    let card_id = find_arg_value(&ctx.args, &["--card"]).unwrap_or("card-000");
    let agent_id = find_arg_value(&ctx.args, &["--agent"]).unwrap_or("agent-primary");
    let human_author = find_arg_value(&ctx.args, &["--human"]).map(String::from);
    let auth_token = find_arg_value(&ctx.args, &["--token"]).map(String::from);
    let policy_name = find_arg_value(&ctx.args, &["--policy"]).unwrap_or("rust-strict");
    let target_ref_str =
        find_arg_value(&ctx.args, &["--target"]).unwrap_or("refs/fractal/cell/cell-default/main");

    let policy = resolve_commit_policy(policy_name);
    let actor = resolve_actor_identity(human_author.as_deref(), auth_token, agent_id, cell_id);
    let target_ref = FractalRef::parse(target_ref_str).unwrap_or(FractalRef::CellMain {
        cell_id: cell_id.into(),
    });

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

    let materialized = materialize_staged_files(
        ctx,
        &staged_files,
        &message,
        human_author.as_deref(),
        agent_id,
        cell_id,
        &target_ref,
    );

    record_commit_in_operation_graph(ctx, &materialized.commit_oid, &target_ref, &actor, &witness);

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
        _ => TaxisPolicy::rust_strict(),
    }
}

/// Constructs actor identity differentiating human authority from agent sub-processes.
fn resolve_actor_identity(
    human_author: Option<&str>,
    auth_token: Option<String>,
    agent_id: &str,
    cell_id: &str,
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
            ActorIdentity::human(human_name, human_email(human_name), token)
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
    find_arg_value(args, &["-m"])
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

/// Collects every path the caller declares as part of this commit.
fn collect_staged_files(ctx: &CliContext) -> Vec<String> {
    let declared = find_all_arg_values(&ctx.args, &["--file", "--add"]);
    if declared.is_empty() {
        return vec![DEFAULT_COMMIT_FILE.to_string()];
    }
    declared.into_iter().map(String::from).collect()
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
    let author = match human_author {
        Some(human_name) => GitSignature::new(human_name, human_email(human_name), timestamp_sec),
        None => GitSignature::for_agent(agent_id, cell_id, timestamp_sec),
    };

    let request = CommitMaterializationRequest {
        files: staged_files.to_vec(),
        work_root: super::git_bridge::resolve_work_root(&ctx.git_dir),
        message: message.to_string(),
        author,
        target_ref: target_ref.to_git_ref(),
    };

    let odb = LooseOdb::new(&ctx.git_dir);
    let ref_store = DiskRefStore::new(&ctx.git_dir);
    match materialize_commit(&odb, &ref_store, &request) {
        Ok(materialized) => materialized,
        Err(materialize_err) => fail_io("materialize commit", materialize_err),
    }
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
    let ref_store = DiskRefStore::new(&ctx.git_dir);
    let mut op_graph = match OperationGraph::load_or_init(&ctx.git_dir) {
        Ok(graph) => graph,
        Err(graph_err) => fail_io("open operation graph", graph_err),
    };
    let current_time_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or(0);

    let mut branches = std::collections::BTreeMap::new();
    if let Ok(all_refs) = ref_store.list_all() {
        for (name, oid) in all_refs {
            branches.insert(name, oid);
        }
    }
    branches.insert(target_ref.to_git_ref(), *commit_oid);

    let view_snapshot = RepoViewSnapshot {
        head_oid: Some(*commit_oid),
        branches,
        staged_promotions: Vec::new(),
        timestamp_ms: current_time_ms,
    };
    if let Err(record_err) = op_graph.record_operation(
        view_snapshot,
        actor.display_name(),
        "commit",
        format!("commit: {}", witness.commit_type),
        current_time_ms,
    ) {
        fail_io("record commit operation", record_err);
    }
}
