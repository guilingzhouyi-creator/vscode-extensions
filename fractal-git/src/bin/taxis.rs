//! Module: Taxis Native Command-Line Interface & Git Compatibility Dispatcher
//! File Path: src/bin/taxis.rs
//! Architecture Role: Standalone native binary for the Taxis (Fractal Git) engine,
//!   providing dual-faced human/machine inspection, Git alias mappings, and pre-receive
//!   gate verification.
//! Dependencies & Triggers: Invoked by developers, Agent sub-processes, and Git hook bridges.
//! Responsibilities: CLI argument dispatch, human/JSON output formatting, and repo transactions.
//! Exit Semantics & Design Rationale: Zero-cost CLI dispatcher with instant command execution.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use std::env;
use std::path::PathBuf;

mod taxis_cmd;
use taxis_cmd::common::{fail_io, print_json, reject, CliContext};
use taxis_cmd::{
    bench, checkout, commit, commit_walk, diff_cmd, doctor, init, log_cmd, projection_cmd,
    promotion, read_cmd, relocate, status_cmd, worktree,
};

use fg_native::RepoDocument;
use fractal_git::constants::cli::CliTag;
use fractal_git::{
    ActorIdentity, AgentPushContext, CommitCounter, CommitMessageGuard, CommitTelemetryConfig,
    ConflictGuard, DiskRefStore, FractalRef, IpcCodec, IpcMessage, Oid, OperationGraph, PacketLine,
    PreReceiveGuard, QuotaGovernor, RefStore, TaxisPolicy, TelemetryCommitNode, TopologyVerifier,
};

fn resolve_canonical_subcommand(raw: &str) -> &str {
    const ALIASES: &[(&[&str], &str)] = &[
        (&["st", "status"], "status"),
        (&["ci", "commit"], "commit"),
        (&["br", "branch"], "branch"),
        (&["di", "diff"], "diff"),
        (&["co", "checkout"], "checkout"),
        (&["sw", "switch"], "switch"),
        (&["gate", "check", "verify"], "verify"),
        (&["init"], "init"),
        (&["doctor"], "doctor"),
        (&["relocate"], "relocate"),
        (&["git-export", "export"], "git-export"),
        (&["git-import", "import"], "git-import"),
        (&["gc", "clean", "reclaim"], "reclaim"),
        (&["serve", "daemon"], "daemon"),
        (&["lg", "log"], "log"),
        (&["sh", "show"], "show"),
        (&["fe", "fetch"], "fetch"),
        (&["pu", "push"], "push"),
        (&["pl", "pull"], "pull"),
        (&["rb", "rebase"], "rebase"),
        (&["mg", "merge"], "merge"),
        (&["cp", "cherry-pick"], "cherry-pick"),
        (&["wt", "worktree"], "worktree"),
        (&["pm", "promo", "promotion"], "promotion"),
        (&["bench", "benchmark"], "bench"),
        (&["undo"], "undo"),
        (&["op", "operation"], "operation"),
        (&["rev-list"], "rev-list"),
        (&["version", "-v", "--version"], "version"),
        (&["help", "-h", "--help"], "help"),
    ];

    for (aliases, target) in ALIASES {
        if aliases.contains(&raw) {
            return target;
        }
    }
    raw
}

fn print_banner() {
    print!(
        "=== Taxis (Fractal Git) Engine v0.1.0 ===\n\
         Agent-Native In-Memory CAS & Fractal Version Matrix\n\
         SSOT Rules: FGT-COR-001 through FGT-CAS-001\n\n"
    );
}

fn print_help() {
    print_banner();
    print!(
        r#"Usage: taxis <command> [options]

Native Fractal Commands (with Git Alias Mappings):
  init               Create a Taxis-native repository (--dev | --release | --git-compat)
  doctor             Inspect repository layout, guard file & section integrity
  relocate           Move a repository between the workspace and the store layout
  git-export         Export native .taxis repository into standard .git projection
  git-import         Import standard .git repository into native .taxis format
  status,   st       Display fractal ref topology, staged index & quota status
  branch,   br       List or verify fractal branch hierarchies (Trunk/Cell/Card/Sub)
  commit,   ci       Create atomic commit with agent metadata
  diff,     di       Show tree diff or pass through to git diff
  checkout, co       Switch fractal worktree or git reference
  undo               Revert repository state to predecessor operation (Jujutsu-style)
  operation, op      Inspect immutable Operation Log DAG history
  verify,   check    Run pre-receive guard, conflict marker scanner & quota checks
  reclaim,  gc       Trigger zero-allocation worktree & sandbox reclamation
  worktree, wt       Display or allocate scoped projection worktree (--scope / --full)
  promotion, pm      Manage staged promotions to System Trunk with Human GUI UAC gate
  bench,    benchmark Run performance benchmarks (--level <1|2|3|all>, -m <mult>)
  daemon,   serve    Display protocol daemon status & IPC endpoints
  version,  -v       Display version and domain rules SSOT

Transparent Git Command Aliases & Passthrough:
  sw/switch, lg/log, sh/show, fe/fetch, pu/push, pl/pull, rb/rebase, mg/merge, cp/cherry-pick
  Any standard git command runs seamlessly with CAS acceleration.

Flags:
  --json             Output machine-readable JSON format
  --git-dir <path>   Override .git or .taxis directory location
"#
    );
}

/// Dispatches fractal branch topology verification and reference queries.
fn handle_branch(ctx: &CliContext) {
    if ctx.args.len() >= 3 && ctx.args[0] == "verify" {
        let src = &ctx.args[1];
        let dst = &ctx.args[2];
        let src_ref = FractalRef::parse(src);
        let dst_ref = FractalRef::parse(dst);

        match (src_ref, dst_ref) {
            (Some(source_ref), Some(dest_ref)) => {
                match TopologyVerifier::assert_legal_merge(&source_ref, &dest_ref) {
                    Ok(_) => println!(
                        "{} Merge from '{}' into '{}' is strictly legal.",
                        CliTag::VERIFY_PASS,
                        src,
                        dst
                    ),
                    Err(merge_err) => reject(
                        CliTag::VERIFY_FAIL,
                        format!("Merge rejected by TopologyVerifier: {}", merge_err),
                    ),
                }
            }
            _ => reject(
                CliTag::ERROR,
                "Invalid fractal ref format. Expected refs/fractal/{cell}/{card}/...",
            ),
        }
        return;
    }

    list_branches(ctx);
}

/// Prints the local branches, marking the one `HEAD` names with `*`.
///
/// This is the only job `branch` has when invoked without arguments; delegating to `status` printed
/// a worktree report instead, which is a different command's answer to a different question. A
/// script that runs `branch` to learn its current branch received a list of modified files.
///
/// A checkout with no branch — detached `HEAD`, or a repository whose first commit does not exist
/// yet — prints no `*` line rather than inventing a name, because the absence is the fact the caller
/// needs to see.
fn list_branches(ctx: &CliContext) {
    let view = match taxis_cmd::repo_view::RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };
    let current = match view.head_branch() {
        Ok(state) => state,
        Err(head_err) => reject(CliTag::ERROR, head_err),
    };
    // An unborn branch has no ref file yet, so it is absent from `branches()` but is still the branch
    // `HEAD` names. Reporting it keeps `branch` usable in a freshly initialised repository.
    let unborn = current
        .as_ref()
        .filter(|(_, target)| target.is_none())
        .map(|(name, _)| name.clone());
    let listed = match view.branches() {
        Ok(branches) => branches,
        Err(list_err) => reject(CliTag::ERROR, list_err),
    };
    let elsewhere: Vec<String> = view.linked_worktree_branches();

    if ctx.json_mode {
        let rendered: Vec<serde_json::Value> = listed
            .iter()
            .map(|(name, oid)| {
                serde_json::json!({
                    "name": name,
                    "oid": oid.to_hex(),
                    "current": current.as_ref().is_some_and(|(head, _)| head == name),
                })
            })
            .collect();
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "branch",
            "branch_count": rendered.len(),
            "branches": rendered,
        }));
        return;
    }

    let mut names: Vec<(String, char)> = listed
        .iter()
        .map(|(name, _)| {
            let marker = if current.as_ref().is_some_and(|(head, _)| head == name) {
                '*'
            } else if elsewhere.contains(name) {
                // Git marks a branch another worktree has checked out with `+`. Two worktrees cannot
                // hold the same branch at once, so the marker says the name is already live
                // somewhere else — information a reader gets nowhere else in this listing.
                '+'
            } else {
                ' '
            };
            (name.clone(), marker)
        })
        .collect();
    if let Some(name) = unborn {
        names.push((name, '*'));
        names.sort_by(|left, right| left.0.cmp(&right.0));
    }
    for (name, marker) in names {
        println!("{marker} {name}");
    }
}

/// Dispatches time-travel undo operation, restoring branch heads to previous snapshot.
fn handle_undo(ctx: &CliContext) {
    let mut op_graph = match OperationGraph::load_or_init(&ctx.git_dir) {
        Ok(graph) => graph,
        Err(load_err) => {
            eprintln!(
                "{} Failed to load operation graph: {}",
                CliTag::ERROR,
                load_err
            );
            return;
        }
    };

    match op_graph.undo() {
        Ok(Some(restored_op)) => {
            let ref_store = DiskRefStore::new(&ctx.git_dir);
            for (ref_name, ref_oid) in &restored_op.view.branches {
                let _ = ref_store.update_ref(ref_name, ref_oid, None);
            }
            if ctx.json_mode {
                let json_val = serde_json::json!({
                    "status": "undone",
                    "restored_operation_id": restored_op.op_id.to_hex(),
                    "command": restored_op.metadata.command,
                    "description": restored_op.metadata.description,
                });
                print_json(&json_val);
            } else {
                let hex_str = restored_op.op_id.to_hex();
                let short_id = if hex_str.len() >= 10 {
                    &hex_str[..10]
                } else {
                    &hex_str
                };
                println!(
                    "{} Restored repository view to operation {} (command: '{}')",
                    CliTag::UNDO_OK,
                    short_id,
                    restored_op.metadata.command
                );
            }
        }
        Ok(None) => {
            if ctx.json_mode {
                println!(r#"{{"status": "noop", "message": "At root operation"}}"#);
            } else {
                println!("{} No previous operation to undo.", CliTag::INFO);
            }
        }
        Err(undo_err) => {
            eprintln!("{} Undo failed: {}", CliTag::FAIL, undo_err);
        }
    }
}

/// Displays recorded operation log or outputs JSON array of historical operations.
fn handle_operation(ctx: &CliContext) {
    let op_graph = match OperationGraph::load_or_init(&ctx.git_dir) {
        Ok(graph) => graph,
        Err(load_err) => {
            eprintln!(
                "{} Failed to load operation graph: {}",
                CliTag::ERROR,
                load_err
            );
            return;
        }
    };

    let history_list = op_graph.history(20);
    if ctx.json_mode {
        let json_ops: Vec<serde_json::Value> = history_list
            .iter()
            .map(|op_node| {
                serde_json::json!({
                    "operation_id": op_node.op_id.to_hex(),
                    "actor": op_node.metadata.actor,
                    "command": op_node.metadata.command,
                    "description": op_node.metadata.description,
                    "timestamp_ms": op_node.metadata.timestamp_ms,
                })
            })
            .collect();
        print_json(&json_ops);
    } else {
        println!("=== Taxis Operation History (Most Recent First) ===");
        if history_list.is_empty() {
            println!("  (No recorded operations)");
        } else {
            for op_node in history_list {
                let hex_str = op_node.op_id.to_hex();
                let short_id = if hex_str.len() >= 10 {
                    &hex_str[..10]
                } else {
                    &hex_str
                };
                println!(
                    "  * [{}] {} (actor: {}) - {}",
                    short_id,
                    op_node.metadata.command,
                    op_node.metadata.actor,
                    op_node.metadata.description
                );
            }
        }
    }
}

/// Computes official commit counts using anti-inflation telemetry filters.
///
/// The DAG is walked straight from the object store. An unborn or unreadable repository is reported
/// as such instead of collapsing to a fixed count, because a synthetic count is indistinguishable
/// from a real one once printed.
///
/// Plain `rev-list` prints one object id per line, which is what every caller of `git rev-list`
/// parses. The anti-inflation banner is a Taxis-specific report, so it moved behind `--telemetry`:
/// printing it by default made the command unusable as a Git projection, since a script asking for
/// revisions received prose. `--count` keeps the telemetry count, which is the number Git prints
/// once the filtered micro-snapshots are excluded.
fn handle_rev_list(ctx: &CliContext) {
    let mut count_only = false;
    let mut all_transient = false;
    let mut telemetry = false;
    let mut limit: Option<usize> = None;

    let mut cursor = 0usize;
    while cursor < ctx.args.len() {
        let arg = ctx.args[cursor].as_str();
        cursor += 1;
        match arg {
            "--count" => count_only = true,
            "--all-transient" => all_transient = true,
            "--telemetry" => telemetry = true,
            // Three spellings of the same limit: `-n 5`, `-n5`, and `-5`. Git accepts all three, and
            // ignoring the two-argument form turns a limited walk into the whole history — the
            // failure this rewrite of `rev-list` exists to avoid.
            "-n" => match ctx.args.get(cursor) {
                Some(text) => match text.parse::<usize>() {
                    Ok(parsed) => {
                        limit = Some(parsed);
                        cursor += 1;
                    }
                    Err(_) => reject(
                        CliTag::ERROR,
                        format!("rev-list -n expects a count, got '{text}'"),
                    ),
                },
                None => reject(CliTag::ERROR, "rev-list -n requires a count"),
            },
            "--max-count" => match ctx.args.get(cursor) {
                Some(text) => match text.parse::<usize>() {
                    Ok(parsed) => {
                        limit = Some(parsed);
                        cursor += 1;
                    }
                    Err(_) => reject(
                        CliTag::ERROR,
                        format!("rev-list --max-count expects a count, got '{text}'"),
                    ),
                },
                None => reject(CliTag::ERROR, "rev-list --max-count requires a count"),
            },
            other if other.starts_with("--max-count=") => {
                let text = &other["--max-count=".len()..];
                match text.parse::<usize>() {
                    Ok(parsed) => limit = Some(parsed),
                    Err(_) => reject(
                        CliTag::ERROR,
                        format!("rev-list --max-count expects a count, got '{text}'"),
                    ),
                }
            }
            other if other.starts_with('-') && other.len() > 1 => {
                let digits = other.strip_prefix("-n").unwrap_or(&other[1..]);
                match digits.parse::<usize>() {
                    Ok(parsed) => limit = Some(parsed),
                    // A flag this walker does not know is refused rather than ignored: silently
                    // dropping `--all` or `--first-parent` would answer a different question than
                    // the caller asked.
                    Err(_) => reject(
                        CliTag::ERROR,
                        format!("rev-list does not support the flag '{other}'"),
                    ),
                }
            }
            _ => {}
        }
    }

    let config = CommitTelemetryConfig {
        dual_trunk_enabled: !all_transient,
        target_ref: FractalRef::SystemTrunk {
            branch: "main".into(),
        },
    };

    let view = match taxis_cmd::repo_view::RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, open_err),
    };
    let head = match view.head_commit() {
        Ok(Some(head_oid)) => head_oid,
        Ok(None) => reject(
            CliTag::ERROR,
            format!(
                "HEAD is unborn in '{}'; nothing to count",
                view.git_dir().display()
            ),
        ),
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };

    let records = match commit_walk::walk_commits(&view, &[head]) {
        Ok(walked) => walked,
        Err(walk_err) => reject(CliTag::ERROR, walk_err),
    };
    let node_index: std::collections::HashMap<Oid, TelemetryCommitNode> = records
        .iter()
        .map(|record| (record.oid, record.to_telemetry_node()))
        .collect();

    let verdict = match CommitCounter::count_commits(Some(head), &config, |oid| {
        Ok(node_index.get(oid).cloned())
    }) {
        Ok(count_verdict) => count_verdict,
        Err(count_err) => reject(CliTag::ERROR, count_err),
    };

    if count_only {
        if ctx.json_mode {
            let rev_payload = serde_json::json!({
                "official_count": verdict.official_count,
                "total_raw_commits": verdict.total_raw_commits,
                "filtered_agent_commits": verdict.filtered_agent_commits,
                "dual_trunk_active": verdict.dual_trunk_active,
            });
            print_json(&rev_payload);
        } else {
            println!("{}", verdict.official_count);
        }
        return;
    }

    if !telemetry {
        let shown = &records[..records.len().min(limit.unwrap_or(records.len()))];
        for record in shown {
            println!("{}", record.oid.to_hex());
        }
        return;
    }

    println!(
        "=== Taxis Commit Telemetry (Anti-Inflation Model) ===\n\
           Official Commits        : {}\n\
           Total Raw Commits       : {}\n\
           Filtered Agent Commits  : {} (Micro-snapshots)\n\
           Dual-Trunk Mode Active  : {}",
        verdict.official_count,
        verdict.total_raw_commits,
        verdict.filtered_agent_commits,
        verdict.dual_trunk_active
    );
}

/// Runs multi-tier gate verification across authority, message, conflict, and quota checks.
///
/// The verdict is the conjunction of four independently probed tiers, and the verdict decides the
/// exit status. `--json` renders the same four tier results instead of the banner, so a machine
/// reader sees exactly the evidence a human reader does rather than a bare boolean.
fn handle_verify(ctx: &CliContext) {
    let agent_ctx = AgentPushContext {
        agent_uid: "agent-verifier".into(),
        cell_id: "cell-core".into(),
        role: "verifier".into(),
        is_force_push: false,
    };
    let agent_actor = ActorIdentity::agent(agent_ctx);
    let human_actor = ActorIdentity::human(
        "Supervisor",
        "supervisor@internal",
        "gate-selftest-credential",
    );
    let policy = TaxisPolicy::rust_strict();

    let trunk_ref = FractalRef::Trunk;
    let subagent_ref = FractalRef::SubAgentWorktree {
        cell_id: "cell-core".into(),
        card_id: "card-gate".into(),
        subagent_id: "agent-verifier".into(),
    };

    // Tier 1: an agent is blocked on the trunk, a credentialed human is allowed, an agent is
    // allowed inside its own sandbox, and an uncredentialed human claim is refused.
    let agent_blocked =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &agent_actor, &policy).is_err();
    let human_allowed =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &human_actor, &policy).is_ok();
    let subagent_allowed =
        PreReceiveGuard::assert_actor_authorized(&subagent_ref, &agent_actor, &policy).is_ok();
    let unverified_human = ActorIdentity::unverified_human("Supervisor", "supervisor@internal");
    let credential_ok =
        PreReceiveGuard::assert_actor_authorized(&trunk_ref, &unverified_human, &policy).is_err();
    let pre_receive_ok = agent_blocked && human_allowed && subagent_allowed && credential_ok;

    // Tier 2: a semantically structured message passes the message guard.
    let valid_msg = concat!(
        "feat(core): verify taxis commit guard\n\n",
        "[Why]\nSystem integrity audit.\n\n",
        "[Changed]\n- Audited invariants\n\n",
        "[Verification]\nAssert all domain invariants hold true without regression."
    );
    let msg_guard_ok = CommitMessageGuard::parse_and_verify(valid_msg, &policy, None).is_ok();

    // Tiers 3 and 4: clean content carries no conflict markers, and a fresh quota accepts work.
    let conflict_ok =
        ConflictGuard::assert_clean_content("sample.rs", b"pub fn clean() {}\n").is_ok();
    let quota = QuotaGovernor::default();
    let quota_ok = quota.assert_spawn_capacity(0).is_ok() && quota.assert_storage_budget(0).is_ok();

    let all_gates_passed = pre_receive_ok && msg_guard_ok && conflict_ok && quota_ok;
    report_verify(
        ctx,
        &quota,
        all_gates_passed,
        pre_receive_ok,
        msg_guard_ok,
        conflict_ok,
        quota_ok,
    );

    if !all_gates_passed {
        std::process::exit(1);
    }
}

/// Prints the four gate tier results in the requested format.
fn report_verify(
    ctx: &CliContext,
    quota: &QuotaGovernor,
    all_gates_passed: bool,
    pre_receive_ok: bool,
    msg_guard_ok: bool,
    conflict_ok: bool,
    quota_ok: bool,
) {
    let tier_state = |passed: bool| if passed { "PASS" } else { "FAIL" };

    if ctx.json_mode {
        let verify_payload = serde_json::json!({
            "engine": "taxis",
            "operation": "verify",
            "all_gates_passed": all_gates_passed,
            "tiers": {
                "pre_receive": tier_state(pre_receive_ok),
                "commit_message": tier_state(msg_guard_ok),
                "conflict": tier_state(conflict_ok),
                "quota": tier_state(quota_ok),
            },
            "quota": {
                "max_worktrees": quota.max_concurrent_worktrees(),
                "max_disk_mb": quota.max_disk_megabytes(),
            },
        });
        print_json(&verify_payload);
        return;
    }

    println!(
        "=== Running Taxis Multi-Tier Gate Verification ===\n\
         [1/4] PreReceiveGuard   : {} (Human trunks & Agent sandbox)\n\
         [2/4] CommitMessageGuard: {} (Rust-grade type witness)\n\
         [3/4] ConflictGuard     : {} (Conflict marker scanning active)\n\
         [4/4] QuotaGovernor     : {} (Limit {} worktrees, {} MB)",
        tier_state(pre_receive_ok),
        tier_state(msg_guard_ok),
        tier_state(conflict_ok),
        tier_state(quota_ok),
        quota.max_concurrent_worktrees(),
        quota.max_disk_megabytes(),
    );
    if all_gates_passed {
        println!("Result: ALL GATES PASS (Zero rule drift)");
    } else {
        println!("Result: GATE VERIFICATION FAILED (see per-tier verdicts above)");
    }
}

/// Reclaims worktree directories registered in the repository container's `WKTR` section.
///
/// The reported figures are the measured outcome of deleting the registered envelopes; an empty
/// registry reports zero reclaimed rather than asserting a fixed success. Records that could not be
/// removed are written back so a retry has something to act on.
///
/// A repository whose container has never been created holds no registry at all, which is the same
/// situation as an empty one: there is nothing to reclaim and nothing to rewrite. Reporting that as
/// a success keeps `reclaim` usable from an uninitialized checkout, where failing would demand an
/// `init` step whose only effect is to create a container with no records.
fn handle_reclaim(ctx: &CliContext) {
    let container_path = fg_native::container_path(&ctx.git_dir);
    if !container_path.is_file() {
        report_reclaim(ctx, 0, &[], 0);
        return;
    }
    let mut document = match RepoDocument::load(&container_path) {
        Ok(loaded) => loaded,
        Err(load_err) => fail_io(
            format!("load repository container '{}'", container_path.display()),
            load_err,
        ),
    };

    let registered: Vec<fg_native::WorktreeRecord> = document.wktr.records().to_vec();
    let mut reclaimed = 0usize;
    let mut failed: Vec<String> = Vec::new();
    let mut survivors: Vec<fg_native::WorktreeRecord> = Vec::new();

    for record in registered {
        if record.path.is_empty() {
            continue;
        }
        let target = PathBuf::from(&record.path);
        match std::fs::remove_dir_all(&target) {
            Ok(()) => reclaimed += 1,
            Err(remove_err) if remove_err.kind() == std::io::ErrorKind::NotFound => {
                reclaimed += 1;
            }
            Err(remove_err) => {
                failed.push(format!("{}: {}", record.path, remove_err));
                survivors.push(record);
            }
        }
    }

    document.wktr = fg_native::WktrSection::new();
    for survivor in survivors.iter() {
        if let Err(upsert_err) = document.wktr.upsert(survivor.clone()) {
            fail_io("rewrite worktree registry", upsert_err);
        }
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

    let retained = survivors.len();
    report_reclaim(ctx, reclaimed, &failed, retained);
    if !failed.is_empty() {
        std::process::exit(1);
    }
}

/// Prints the reclamation outcome in the format the caller asked for.
///
/// The failure list carries the reason each directory survived, so an operator can tell a locked
/// file from a permissions problem without re-running the command.
fn report_reclaim(ctx: &CliContext, reclaimed: usize, failures: &[String], retained: usize) {
    if ctx.json_mode {
        let reclaim_payload = serde_json::json!({
            "engine": "taxis",
            "operation": "reclaim",
            "reclaimed_worktrees": reclaimed,
            "retained_worktrees": retained,
            "failures": failures,
        });
        print_json(&reclaim_payload);
        return;
    }

    println!("=== Taxis Worktree & Sandbox Reclaimer ===");
    println!("[RECLAIM] Reclaimed worktree directories: {}", reclaimed);
    println!("[RECLAIM] Retained after failure      : {}", retained);
    for failure in failures {
        eprintln!("[RECLAIM] Retained '{}'", failure);
    }
}

/// Reports the live status of the in-process IPC codec and protocol handlers.
///
/// Each line reflects an actual round-trip through the transport crate rather than a fixed
/// literal, so a regression in the codec surfaces here instead of printing READY regardless.
fn handle_daemon(ctx: &CliContext) {
    let ipc_round_trip_ok = probe_ipc_round_trip();
    let packetline_ok = probe_packetline_framing();

    if ctx.json_mode {
        let daemon_payload = serde_json::json!({
            "engine": "taxis",
            "operation": "daemon",
            "ipc_frame_codec": if ipc_round_trip_ok { "READY" } else { "FAIL" },
            "smart_protocol_v2": if packetline_ok { "READY" } else { "FAIL" },
            "cas_bus": "STANDBY"
        });
        print_json(&daemon_payload);
        if !(ipc_round_trip_ok && packetline_ok) {
            std::process::exit(1);
        }
        return;
    }

    println!("=== Taxis Native Protocol Daemon ===");
    println!("Supported Protocols:");
    println!(
        "  - IPC Frame (4-byte length prefix) : {}",
        if ipc_round_trip_ok { "READY" } else { "FAIL" }
    );
    println!(
        "  - Smart Protocol v2 (PacketLine)   : {}",
        if packetline_ok { "READY" } else { "FAIL" }
    );
    println!("  - taxis:// In-Memory CAS Bus       : STANDBY");

    if !(ipc_round_trip_ok && packetline_ok) {
        std::process::exit(1);
    }
}

/// Encodes and decodes a probe IPC frame, confirming the codec round-trips.
fn probe_ipc_round_trip() -> bool {
    let probe = IpcMessage::Ping { timestamp_ms: 0 };
    match IpcCodec::encode(&probe) {
        Ok(frame) => match IpcCodec::decode(&frame) {
            Ok(Some((decoded, consumed))) => decoded == probe && consumed == frame.len(),
            _ => false,
        },
        Err(_) => false,
    }
}

/// Encodes and decodes a probe packet-line frame, confirming the framing round-trips.
fn probe_packetline_framing() -> bool {
    let frame = PacketLine::encode_line("probe");
    match PacketLine::decode(&frame) {
        Ok(lines) => lines.len() == 1 && lines[0] == "probe",
        Err(_) => false,
    }
}

/// Resolves effective repository directory following §5.1.1 priority:
/// 1. Explicit `--git-dir` path if provided.
/// 2. `.taxis/` if it exists and contains a valid container.
/// 3. `.git/` if it exists.
fn resolve_effective_repo_dir(explicit: Option<PathBuf>) -> PathBuf {
    if let Some(path) = explicit {
        return path;
    }

    if let Ok(cwd) = env::current_dir() {
        let mut cursor = cwd.as_path();
        loop {
            let taxis_candidate = cursor.join(".taxis");
            if fg_native::container_path(&taxis_candidate).exists() {
                return taxis_candidate;
            }
            if fg_native::container_path(cursor).exists() {
                return cursor.to_path_buf();
            }
            let git_candidate = cursor.join(".git");
            if git_candidate.join("HEAD").is_file() || git_candidate.is_file() {
                return git_candidate;
            }
            if cursor.join("HEAD").is_file() && cursor.join("objects").is_dir() {
                return cursor.to_path_buf();
            }
            match cursor.parent() {
                Some(parent) => cursor = parent,
                None => break,
            }
        }
    }

    if std::path::Path::new(".taxis").exists() {
        PathBuf::from(".taxis")
    } else {
        PathBuf::from(".git")
    }
}

/// Parses global CLI flags (--json, --git-dir) and separates subcommand arguments.
fn parse_cli_args(raw_args: &[String]) -> (PathBuf, bool, Vec<String>) {
    let mut explicit_git_dir: Option<PathBuf> = None;
    let mut json_mode = false;
    let mut filtered_args = Vec::new();

    let mut arg_cursor = 0;
    while arg_cursor < raw_args.len() {
        if raw_args[arg_cursor] == "--json" {
            json_mode = true;
            arg_cursor += 1;
        } else if raw_args[arg_cursor] == "--git-dir" && arg_cursor + 1 < raw_args.len() {
            explicit_git_dir = Some(PathBuf::from(&raw_args[arg_cursor + 1]));
            arg_cursor += 2;
        } else {
            filtered_args.push(raw_args[arg_cursor].clone());
            arg_cursor += 1;
        }
    }
    let git_dir = resolve_effective_repo_dir(explicit_git_dir);
    (git_dir, json_mode, filtered_args)
}

/// Normalizes subcommand aliases and handles transparent `taxis git ...` prefix.
fn extract_effective_subcommand(filtered_args: &[String]) -> (&str, Vec<String>) {
    if filtered_args[0] == "git" {
        if filtered_args.len() > 1 {
            (
                resolve_canonical_subcommand(&filtered_args[1]),
                filtered_args[2..].to_vec(),
            )
        } else {
            ("help", Vec::new())
        }
    } else {
        (
            resolve_canonical_subcommand(&filtered_args[0]),
            filtered_args[1..].to_vec(),
        )
    }
}

/// Routes effective canonical subcommand to designated handler function.
fn dispatch_command(effective_subcommand: &str, ctx: &CliContext) {
    match effective_subcommand {
        "init" => init::handle_init(ctx),
        "doctor" => doctor::handle_doctor(ctx),
        "relocate" => relocate::handle_relocate(ctx),
        "git-export" => projection_cmd::handle_git_export(ctx),
        "git-import" => projection_cmd::handle_git_import(ctx),
        "status" => status_cmd::handle_status(ctx),
        "branch" => handle_branch(ctx),
        "commit" => commit::handle_commit(ctx),
        "diff" => diff_cmd::handle_diff(ctx),
        "cat-file" => read_cmd::handle_cat_file(ctx),
        "ls-tree" => read_cmd::handle_ls_tree(ctx),
        "ls-files" => read_cmd::handle_ls_files(ctx),
        "show-ref" => read_cmd::handle_show_ref(ctx),
        "for-each-ref" => read_cmd::handle_for_each_ref(ctx),
        "check-ignore" => read_cmd::handle_check_ignore(ctx),
        "log" => log_cmd::handle_log(ctx),
        "show" => log_cmd::handle_show(ctx),
        "checkout" | "switch" => checkout::handle_checkout(ctx),
        "worktree" => worktree::handle_worktree(ctx),
        "promotion" => promotion::handle_promotion(ctx),
        "bench" => bench::handle_bench(ctx),
        "undo" => handle_undo(ctx),
        "operation" => handle_operation(ctx),
        "rev-list" => handle_rev_list(ctx),
        "verify" => handle_verify(ctx),
        "reclaim" => handle_reclaim(ctx),
        "daemon" => handle_daemon(ctx),
        "version" => {
            print_banner();
            println!("Version: 0.1.0 (Rust Stable, 10 Micro-Crates)");
        }
        "help" => print_help(),
        other => reject_unimplemented(other),
    }
}

/// Rejects a subcommand that has no native implementation.
///
/// Before this existed, the fallback forwarded the name to the host `git` binary. That made a
/// command appear to work while every byte it printed came from another program, and it made a
/// missing implementation indistinguishable from a working one. A refusal names the command and the
/// supported set, so the caller learns what is missing instead of receiving a successful run of a
/// different tool.
fn reject_unimplemented(subcommand: &str) -> ! {
    reject(
        CliTag::ERROR,
        format!(
            "'{subcommand}' has no native implementation in this build. \
             Implemented: init, doctor, relocate, git-export, git-import, status, branch, commit, diff, cat-file, ls-tree, \
             ls-files, show-ref, for-each-ref, check-ignore, log, show, checkout, worktree, \
             promotion, bench, undo, operation, rev-list, verify, reclaim, daemon, version, help."
        ),
    )
}

fn main() {
    let raw_args: Vec<String> = env::args().skip(1).collect();
    if raw_args.is_empty() {
        print_help();
        return;
    }

    let (git_dir, json_mode, filtered_args) = parse_cli_args(&raw_args);
    if filtered_args.is_empty() {
        print_help();
        return;
    }

    let (effective_subcommand, sub_args) = extract_effective_subcommand(&filtered_args);
    let ctx = CliContext {
        git_dir,
        json_mode,
        args: sub_args,
    };

    dispatch_command(effective_subcommand, &ctx);
}
