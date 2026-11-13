//! Module: taxis_cmd::blackboard — SubAgent Intent Blackboard CLI Dispatcher
//! File Path: src/bin/taxis_cmd/blackboard.rs
//! Architecture Role: Dispatches cooperative intent lease operations (claim, check, release, list)
//!   for concurrent SubAgents sharing a parent Card worktree.
//! Dependencies & Triggers: Invoked when `taxis blackboard` or `taxis bb` is called.
//! Responsibilities: CLI argument parsing, collision detection, and JSON/human reporting.
//! Exit Semantics & Design Rationale:
//!   - Collision rejection terminates with non-zero exit code so agent scripts immediately halt.
//!   - Human and JSON modes provide dual-faced clarity.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::time::{SystemTime, UNIX_EPOCH};

use fg_core::models::SymbolClaim;
use fractal_git::constants::cli::CliTag;
use fractal_git::DiskBlackboardStore;

use super::common::{fail_io, find_arg_value, print_json, reject, CliContext};

/// Returns the current host time in milliseconds since UNIX epoch.
fn current_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Dispatches intent blackboard subcommands (claim, check, release, list).
pub fn handle_blackboard(ctx: &CliContext) {
    let action = ctx.args.first().map(|a| a.as_str()).unwrap_or("list");

    let floor = fg_gate::BranchGovernanceFloor::resolve(&ctx.git_dir);
    let coords = match super::fractal_context::ActiveFractalCoordinates::resolve(
        &ctx.git_dir,
        &ctx.args,
        &floor,
    ) {
        Ok(resolved) => resolved,
        Err(coord_err) => reject(CliTag::VERIFY_FAIL, coord_err),
    };
    let card_id_owned = coords
        .card_id
        .unwrap_or_else(|| fg_core::constants::policy::DEFAULT_CARD_ID.to_owned());
    let card_id = card_id_owned.as_str();
    let cell_id = coords.cell_id.as_str();
    let store = DiskBlackboardStore::new(&ctx.git_dir);
    let now_ms = current_now_ms();

    match action {
        "claim" => handle_claim(ctx, &store, card_id, cell_id, now_ms),
        "check" => handle_check(ctx, &store, card_id, cell_id, now_ms),
        "release" => handle_release(ctx, &store, card_id, cell_id, now_ms),
        "list" | "show" => handle_list(ctx, &store, card_id, cell_id, now_ms),
        other => reject(
            CliTag::ERROR,
            format!(
                "unknown blackboard action '{other}'. Valid actions: claim, check, release, list"
            ),
        ),
    }
}

fn handle_claim(
    ctx: &CliContext,
    store: &DiskBlackboardStore,
    card_id: &str,
    cell_id: &str,
    now_ms: i64,
) {
    let agent = match find_arg_value(&ctx.args, &["--agent"]) {
        Some(a) => a,
        None => reject(CliTag::ERROR, "missing required flag: --agent <agent_uid>"),
    };
    let file = match find_arg_value(&ctx.args, &["--file"]) {
        Some(f) => f,
        None => reject(CliTag::ERROR, "missing required flag: --file <path>"),
    };
    let scope = find_arg_value(&ctx.args, &["--scope"]).unwrap_or("*");
    let symbol = find_arg_value(&ctx.args, &["--symbol"]);
    let symbol_kind = find_arg_value(&ctx.args, &["--symbol-kind"]);
    let ttl_sec: u64 = find_arg_value(&ctx.args, &["--ttl"])
        .and_then(|v| v.parse().ok())
        .unwrap_or(300);

    let mut board = match store.load_or_create(card_id, cell_id) {
        Ok(b) => b,
        Err(err) => fail_io("load blackboard", err),
    };

    let mut claim = SymbolClaim::new(agent, file, scope, ttl_sec, now_ms);
    if let Some(name) = symbol {
        claim = claim.with_symbol(name, symbol_kind);
    }

    match board.claim_symbol(claim) {
        Ok(lease) => {
            if let Err(err) = store.save(&board) {
                fail_io("save blackboard", err);
            }
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "status": "claimed",
                    "lease": lease,
                }));
            } else {
                println!(
                    "{} Lease '{}' claimed by agent '{}' for '{}' (scope: '{}', ttl: {}s)",
                    CliTag::VERIFY_PASS,
                    lease.lease_id,
                    lease.agent_uid,
                    lease.file_path,
                    lease.scope_id,
                    lease.ttl_seconds
                );
            }
        }
        Err(collision) => {
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "status": "conflict",
                    "collision": collision,
                }));
            }
            reject(
                CliTag::VERIFY_FAIL,
                format!(
                    "Intent conflict detected: scope '{}' in '{}' is already claimed by agent '{}' (lease: {}, remaining TTL: {}s)",
                    collision.scope_id,
                    collision.file_path,
                    collision.conflicting_agent,
                    collision.conflicting_lease_id,
                    collision.remaining_ttl_seconds
                ),
            );
        }
    }
}

fn handle_check(
    ctx: &CliContext,
    store: &DiskBlackboardStore,
    card_id: &str,
    cell_id: &str,
    now_ms: i64,
) {
    let file = match find_arg_value(&ctx.args, &["--file"]) {
        Some(f) => f,
        None => reject(CliTag::ERROR, "missing required flag: --file <path>"),
    };
    let scope = find_arg_value(&ctx.args, &["--scope"]).unwrap_or("*");
    let symbol = find_arg_value(&ctx.args, &["--symbol"]);

    let board = match store.load_or_create(card_id, cell_id) {
        Ok(b) => b,
        Err(err) => fail_io("load blackboard", err),
    };

    if let Some(collision) = board.check_collision_symbol(file, scope, symbol, now_ms) {
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "status": "conflict",
                "collision": collision,
            }));
        }
        reject(
            CliTag::VERIFY_FAIL,
            format!(
                "Scope collision: '{}' in '{}' is claimed by agent '{}' (remaining TTL: {}s)",
                collision.scope_id,
                collision.file_path,
                collision.conflicting_agent,
                collision.remaining_ttl_seconds
            ),
        );
    } else {
        if ctx.json_mode {
            print_json(&serde_json::json!({
                "status": "clear",
                "file": file,
                "scope": scope,
            }));
        } else {
            println!(
                "{} Scope '{}' in '{}' is clear for modification.",
                CliTag::VERIFY_PASS,
                scope,
                file
            );
        }
    }
}

fn handle_release(
    ctx: &CliContext,
    store: &DiskBlackboardStore,
    card_id: &str,
    cell_id: &str,
    _now_ms: i64,
) {
    let mut board = match store.load_or_create(card_id, cell_id) {
        Ok(b) => b,
        Err(err) => fail_io("load blackboard", err),
    };

    let maybe_lease = find_arg_value(&ctx.args, &["--lease"]);
    let maybe_agent = find_arg_value(&ctx.args, &["--agent"]);

    let mut released_count = 0;
    if let Some(lease_id) = maybe_lease {
        if board.release(lease_id) {
            released_count += 1;
        }
    } else if let Some(agent) = maybe_agent {
        released_count += board.release_agent(agent);
    } else {
        reject(
            CliTag::ERROR,
            "must specify either --lease <id> or --agent <uid> to release",
        );
    }

    if let Err(err) = store.save(&board) {
        fail_io("save blackboard", err);
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "released",
            "released_count": released_count,
        }));
    } else {
        println!(
            "{} Released {} intent lease(s).",
            CliTag::VERIFY_PASS,
            released_count
        );
    }
}

fn handle_list(
    ctx: &CliContext,
    store: &DiskBlackboardStore,
    card_id: &str,
    cell_id: &str,
    now_ms: i64,
) {
    let mut board = match store.load_or_create(card_id, cell_id) {
        Ok(b) => b,
        Err(err) => fail_io("load blackboard", err),
    };

    let pruned = board.prune_expired(now_ms);
    if pruned > 0 {
        let _ = store.save(&board);
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "card_id": board.card_id,
            "cell_id": board.cell_id,
            "leases": board.active_leases,
        }));
    } else {
        println!(
            "=== Active Intent Blackboard: Card '{}' (Cell: '{}') ===",
            board.card_id, board.cell_id
        );
        if board.active_leases.is_empty() {
            println!("  (no active leases held)");
        } else {
            for lease in &board.active_leases {
                let expiry_ms = lease.acquired_at_ms + (lease.ttl_seconds as i64 * 1000);
                let remaining = ((expiry_ms - now_ms).max(0) / 1000) as u64;
                println!(
                    "  - [{}] Agent: '{}' -> '{}' | scope: '{}' (remaining: {}s)",
                    lease.lease_id, lease.agent_uid, lease.file_path, lease.scope_id, remaining
                );
            }
        }
    }
}
