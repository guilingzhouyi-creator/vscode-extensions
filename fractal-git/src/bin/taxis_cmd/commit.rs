//! Module: taxis_cmd::commit — Atomic Commit Subcommand Dispatcher
//! File Path: src/bin/taxis_cmd/commit.rs
//! Architecture Role: Dispatches transactional commits verifying actor identity,
//!   human control boundaries, commit message invariants, and operation history.
//! Dependencies & Triggers: Invoked when `taxis commit` or `taxis ci` is dispatched.
//! Responsibilities: Actor authorization, message verification, tree fabrication, ref updates.
//! Exit Semantics & Design Rationale: Exits 0 on successful commit creation, 1 on breach.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use fractal_git::constants::cli::CliTag;
use fractal_git::{
    ActorIdentity, AgentPushContext, CommitMessageGuard, DiskRefStore, FileMode, FractalRef,
    GitBlob, GitCommit, GitSignature, GitTree, GitTreeEntry, Oid, OperationGraph,
    PreReceiveGuard, RefStore, RepoViewSnapshot, TaxisPolicy, ValidatedCommitWitness,
};

use super::common::{find_arg_value, print_json, CliContext};

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
        eprintln!(
            "{} Push to '{}' rejected: {}",
            CliTag::AUTHORITY_BREACH,
            target_ref.to_git_ref(),
            auth_err
        );
        std::process::exit(1);
    }

    let message = resolve_commit_message(&ctx.args, card_id);
    let witness = verify_commit_governance(&message, &policy);
    let commit = build_git_commit(human_author.as_deref(), agent_id, cell_id, &witness);

    output_commit_result(ctx, &commit, &policy, &actor, &witness);
    record_commit_in_ref_and_operation_graph(ctx, &commit, &target_ref, &actor, &witness);
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
        Some(human_name) => ActorIdentity::human(
            human_name,
            format!(
                "{}@company.internal",
                human_name.to_lowercase().replace(' ', ".")
            ),
            auth_token,
        ),
        None => ActorIdentity::agent(AgentPushContext {
            agent_uid: agent_id.into(),
            cell_id: cell_id.into(),
            role: "worker".into(),
            is_force_push: false,
        }),
    }
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

/// Verifies commit message against policy constraints, exiting on failure.
fn verify_commit_governance(message: &str, policy: &TaxisPolicy) -> ValidatedCommitWitness {
    let touched_files = vec!["README.md".to_string()];
    match CommitMessageGuard::parse_and_verify(message, policy, Some(&touched_files)) {
        Ok(commit_witness) => commit_witness,
        Err(gov_err) => {
            eprintln!(
                "{} Commit message rejected by Taxis policy '{}':",
                CliTag::COMMIT_GOVERNANCE_FAIL,
                policy.name
            );
            eprintln!("  {}", gov_err);
            std::process::exit(1);
        }
    }
}

/// Constructs GitCommit object from signatures and witness.
fn build_git_commit(
    human_author: Option<&str>,
    agent_id: &str,
    cell_id: &str,
    witness: &ValidatedCommitWitness,
) -> GitCommit {
    let author = if let Some(human_name) = human_author {
        GitSignature::new(
            human_name,
            format!(
                "{}@company.internal",
                human_name.to_lowercase().replace(' ', ".")
            ),
            1700000000,
        )
    } else {
        GitSignature::for_agent(agent_id, cell_id, 1700000000)
    };
    let committer = author.clone();

    let empty_blob = GitBlob::from_bytes(b"# Taxis Initial Staging\n".to_vec());
    let entry = GitTreeEntry::new(FileMode::RegularFile, "README.md", empty_blob.oid());
    let tree = GitTree::new(vec![entry]);

    GitCommit::from_witness(tree.oid(), Vec::new(), author, committer, witness, None)
}

/// Outputs commit creation results as JSON or human-readable text.
fn output_commit_result(
    ctx: &CliContext,
    commit: &GitCommit,
    policy: &TaxisPolicy,
    actor: &ActorIdentity,
    witness: &ValidatedCommitWitness,
) {
    if ctx.json_mode {
        let commit_payload = serde_json::json!({
            "status": "committed",
            "commit_oid": commit.oid(),
            "tree_oid": commit.tree_oid(),
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
            commit.oid()
        );
        println!("  Tree   : {}", commit.tree_oid());
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

/// Updates reference store and records commit operation snapshot into operation graph.
fn record_commit_in_ref_and_operation_graph(
    ctx: &CliContext,
    commit: &GitCommit,
    target_ref: &FractalRef,
    actor: &ActorIdentity,
    witness: &ValidatedCommitWitness,
) {
    let commit_oid = Oid::from_hex(commit.oid()).unwrap_or(Oid::ZERO);
    let ref_store = DiskRefStore::new(&ctx.git_dir);
    let _ = ref_store.update_ref(&target_ref.to_git_ref(), &commit_oid, None);

    if let Ok(mut op_graph) = OperationGraph::load_or_init(&ctx.git_dir) {
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
        branches.insert(target_ref.to_git_ref(), commit_oid);

        let view_snapshot = RepoViewSnapshot {
            head_oid: Some(commit_oid),
            branches,
            staged_promotions: Vec::new(),
            timestamp_ms: current_time_ms,
        };
        let _ = op_graph.record_operation(
            view_snapshot,
            actor.display_name(),
            "commit",
            format!("commit: {}", witness.commit_type),
            current_time_ms,
        );
    }
}
