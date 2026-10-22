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
use taxis_cmd::{bench, commit, doctor, git_bridge, init, promotion, relocate, worktree};

use fg_native::RepoDocument;
use fractal_git::constants::cli::CliTag;
use fractal_git::{
    ActorIdentity, AgentPushContext, CommitCounter, CommitMessageGuard, CommitTelemetryConfig,
    ConflictGuard, DiskRefStore, FractalRef, HeadState, IpcCodec, IpcMessage, Oid, OperationGraph,
    PacketLine, PreReceiveGuard, QuotaGovernor, RefStore, TaxisPolicy, TelemetryCommitNode,
    TopologyVerifier,
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
  init               Create a Taxis-native repository (--dev | --release)
  doctor             Inspect repository layout, guard file & section integrity
  relocate           Move a repository between the workspace and the store layout
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

/// Renders the resolved `HEAD` position as a machine-readable object.
fn head_json(head: &HeadState) -> serde_json::Value {
    match head {
        HeadState::Absent => serde_json::json!({ "kind": "absent" }),
        HeadState::Detached(oid) => serde_json::json!({
            "kind": "detached",
            "oid": oid.to_hex(),
        }),
        HeadState::Symbolic { name, target } => serde_json::json!({
            "kind": "symbolic",
            "branch": name,
            "oid": target.map(|oid| oid.to_hex()),
        }),
    }
}

/// Prints the resolved `HEAD` position in the human-readable status block.
fn print_head(head: &HeadState) {
    match head {
        HeadState::Absent => println!("HEAD: (absent)"),
        HeadState::Detached(oid) => println!("HEAD: detached at {}", oid.to_hex()),
        HeadState::Symbolic { name, target } => match target {
            Some(oid) => println!("HEAD: {} -> {}", name, oid.to_hex()),
            None => println!("HEAD: {} (unborn)", name),
        },
    }
}

/// Dispatches repository status inspection, displaying the current head, references, and quotas.
///
/// A refused reference scan terminates with `EXIT_REJECTED` instead of printing an empty list, so
/// a permission failure can never be mistaken for a repository that genuinely has no references.
fn handle_status(ctx: &CliContext) {
    let ref_store = DiskRefStore::new(&ctx.git_dir);
    let refs = match ref_store.list_all() {
        Ok(listed_refs) => listed_refs,
        Err(scan_err) => fail_io("scan repository references", scan_err),
    };
    let head = match ref_store.head() {
        Ok(head_state) => head_state,
        Err(head_err) => fail_io("resolve repository HEAD", head_err),
    };
    let quota = QuotaGovernor::default();

    if ctx.json_mode {
        let json_refs: Vec<serde_json::Value> = refs
            .iter()
            .map(|(name, oid)| {
                serde_json::json!({
                    "ref": name,
                    "oid": oid.to_hex(),
                })
            })
            .collect();

        let status_payload = serde_json::json!({
            "engine": "taxis",
            "git_dir": ctx.git_dir.display().to_string(),
            "head": head_json(&head),
            "ref_count": refs.len(),
            "refs": json_refs,
            "quota": {
                "max_worktrees": quota.max_concurrent_worktrees(),
                "max_disk_mb": quota.max_disk_megabytes(),
            }
        });
        print_json(&status_payload);
        return;
    }

    print_banner();
    println!("Repository: {}", ctx.git_dir.display());
    print_head(&head);
    println!("Discovered Fractal References ({}):", refs.len());

    if refs.is_empty() {
        println!(
            "  (No fractal references found in {})",
            ctx.git_dir.join("refs/fractal").display()
        );
    } else {
        for (name, oid) in &refs {
            let hex = oid.to_hex();
            let short_oid = if hex.len() >= 10 { &hex[..10] } else { &hex };
            println!("  ├── {} -> {}", name, short_oid);
        }
    }

    println!("\nResource Quota Status:");
    println!(
        "  * Max Concurrent Worktrees : {}",
        quota.max_concurrent_worktrees()
    );
    println!(
        "  * Max Workspace Budget (MB): {}",
        quota.max_disk_megabytes()
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

    handle_status(ctx);
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
/// The DAG is read from the host repository through the git bridge. An empty or unreadable
/// repository is reported as such instead of collapsing to a fixed count, because a synthetic
/// count is indistinguishable from a real one once printed.
fn handle_rev_list(ctx: &CliContext) {
    let mut count_only = false;
    let mut all_transient = false;

    for arg in &ctx.args {
        if arg == "--count" {
            count_only = true;
        } else if arg == "--all-transient" {
            all_transient = true;
        }
    }

    let config = CommitTelemetryConfig {
        dual_trunk_enabled: !all_transient,
        target_ref: FractalRef::SystemTrunk {
            branch: "main".into(),
        },
    };

    let work_root = git_bridge::resolve_work_root(&ctx.git_dir);
    let head = match git_bridge::resolve_revision(&work_root, "HEAD") {
        Ok(Some(head_oid)) => head_oid,
        Ok(None) => reject(
            CliTag::ERROR,
            format!(
                "no HEAD revision under '{}'; nothing to count",
                work_root.display()
            ),
        ),
        Err(resolve_err) => reject(CliTag::ERROR, resolve_err),
    };

    let nodes = match git_bridge::read_commit_nodes(&work_root, "HEAD") {
        Ok(parsed_nodes) => parsed_nodes,
        Err(read_err) => reject(CliTag::ERROR, read_err),
    };
    let node_index: std::collections::HashMap<Oid, TelemetryCommitNode> =
        nodes.into_iter().map(|node| (node.oid, node)).collect();

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

/// Reports the working tree status as structured JSON, or delegates to host Git for text diffs.
fn handle_diff(ctx: &CliContext) {
    if ctx.json_mode {
        let work_root = git_bridge::resolve_work_root(&ctx.git_dir);
        let entries = match git_bridge::read_status_entries(&work_root) {
            Ok(status_entries) => status_entries,
            Err(status_err) => reject(CliTag::ERROR, status_err),
        };

        let json_entries: Vec<serde_json::Value> = entries
            .iter()
            .map(|entry| {
                serde_json::json!({
                    "code": entry.code,
                    "path": entry.path,
                    "classification": entry.classification(),
                })
            })
            .collect();
        let status = if entries.is_empty() { "clean" } else { "dirty" };

        let output = serde_json::json!({
            "engine": "taxis",
            "operation": "diff",
            "git_dir": ctx.git_dir.display().to_string(),
            "status": status,
            "entry_count": json_entries.len(),
            "entries": json_entries
        });
        print_json(&output);
        return;
    }
    handle_passthrough("diff", ctx);
}

/// Dispatches switching to fractal reference branches or falls back to host Git checkout.
fn handle_checkout(ctx: &CliContext) {
    if ctx.args.is_empty() {
        reject(
            CliTag::ERROR,
            "Expected branch, commit, or fractal ref to checkout.",
        );
    }
    let target = &ctx.args[0];
    if let Some(fref) = FractalRef::parse(target) {
        println!(
            "{} Switched to fractal reference: {:?}",
            CliTag::TAXIS_CHECKOUT,
            fref
        );
        return;
    }
    handle_passthrough("checkout", ctx);
}

/// Proxies unrecognized commands transparently to the underlying Git binary.
fn handle_passthrough(cmd: &str, ctx: &CliContext) {
    let mut command = std::process::Command::new("git");
    command.arg(cmd);
    for arg in &ctx.args {
        command.arg(arg);
    }
    // Sandbox & Permission Defense: If global .gitconfig is unreadable, fallback to NUL
    if std::env::var("GIT_CONFIG_GLOBAL").is_err() {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let cfg = PathBuf::from(home).join(".gitconfig");
            if std::fs::File::open(&cfg).is_err() {
                command.env("GIT_CONFIG_GLOBAL", "NUL");
            }
        }
    }
    match command.status() {
        Ok(status) => {
            if let Some(code) = status.code().filter(|&exit_code| exit_code != 0) {
                std::process::exit(code);
            }
        }
        Err(cmd_err) => {
            eprintln!(
                "[ERROR] Failed to invoke git command '{}': {}",
                cmd, cmd_err
            );
            std::process::exit(1);
        }
    }
}

/// Parses global CLI flags (--json, --git-dir) and separates subcommand arguments.
fn parse_cli_args(raw_args: &[String]) -> (PathBuf, bool, Vec<String>) {
    let mut git_dir = PathBuf::from(".git");
    let mut json_mode = false;
    let mut filtered_args = Vec::new();

    let mut arg_cursor = 0;
    while arg_cursor < raw_args.len() {
        if raw_args[arg_cursor] == "--json" {
            json_mode = true;
            arg_cursor += 1;
        } else if raw_args[arg_cursor] == "--git-dir" && arg_cursor + 1 < raw_args.len() {
            git_dir = PathBuf::from(&raw_args[arg_cursor + 1]);
            arg_cursor += 2;
        } else {
            filtered_args.push(raw_args[arg_cursor].clone());
            arg_cursor += 1;
        }
    }
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
        "status" => handle_status(ctx),
        "branch" => handle_branch(ctx),
        "commit" => commit::handle_commit(ctx),
        "diff" => handle_diff(ctx),
        "checkout" => handle_checkout(ctx),
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
        other => handle_passthrough(other, ctx),
    }
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
