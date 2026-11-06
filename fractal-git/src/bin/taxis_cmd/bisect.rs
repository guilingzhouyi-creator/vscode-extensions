//! Module: taxis_cmd::bisect — Topological Centroid Bisect Command Dispatcher
//! File Path: src/bin/taxis_cmd/bisect.rs
//! Architecture Role: Dispatches `taxis bisect`, orchestrating binary search across the commit DAG
//!   to isolate bug origins using topological centroid midpoint selection and automated run loops.
//! Dependencies & Triggers: Dispatched by `taxis bisect`.
//! Responsibilities: CLI option parsing, bisect session lifecycle (start, good, bad, skip,
//!   reset, run), DAG ancestor exploration, and automated regression verification.
//! Exit Semantics & Design Rationale:
//!   - Supports human-readable Git-compatible porcelain and machine-readable JSON outputs.
//!   - Automated `run` loop supports test scripts (0=good, 125=skip, 1..124=bad).

use std::collections::HashMap;
use std::process::Command;

use fg_core::models::Oid;
use fg_topology::bisect::{BisectEngine, BisectState, BisectStep};
use fractal_git::constants::cli::CliTag;

use super::checkout::handle_checkout;
use super::commit_walk::parse_commit_record;
use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;

const HEAD_REV: &str = "HEAD";
const SUB_START: &str = "start";
const SUB_BAD: &str = "bad";
const SUB_GOOD: &str = "good";
const SUB_SKIP: &str = "skip";
const SUB_RESET: &str = "reset";
const SUB_RUN: &str = "run";
const SUB_STATUS: &str = "status";
const SUB_LOG: &str = "log";
const SUB_HELP: &str = "help";
const OPT_HELP_SHORT: &str = "-h";
const OPT_HELP_LONG: &str = "--help";
const LABEL_REVISION: &str = "revision";
const HEX_SHORT_LEN: usize = 8;
const EXIT_CODE_SKIP: i32 = 125;

fn is_bisect_help_command(sub: &str) -> bool {
    sub == OPT_HELP_SHORT || sub == OPT_HELP_LONG || sub == SUB_HELP
}

fn dispatch_marking_subcommand(ctx: &CliContext, sub: &str, sub_args: &[String]) -> bool {
    match sub {
        SUB_START => handle_bisect_start(ctx, sub_args),
        SUB_BAD => handle_bisect_mark(ctx, sub_args, true),
        SUB_GOOD => handle_bisect_mark(ctx, sub_args, false),
        SUB_SKIP => handle_bisect_skip(ctx, sub_args),
        _ => return false,
    }
    true
}

/// Dispatches `taxis bisect`.
pub fn handle_bisect(ctx: &CliContext) {
    if ctx.args.is_empty() {
        print_bisect_help();
        return;
    }

    let sub = ctx.args[0].as_str();
    let sub_args = &ctx.args[1..];

    if is_bisect_help_command(sub) {
        print_bisect_help();
        return;
    }
    if dispatch_marking_subcommand(ctx, sub, sub_args) {
        return;
    }

    match sub {
        SUB_RESET => handle_bisect_reset(ctx, sub_args),
        SUB_RUN => handle_bisect_run(ctx, sub_args),
        SUB_STATUS | SUB_LOG => handle_bisect_status(ctx),
        other => reject(
            CliTag::ERROR,
            format!("unknown bisect subcommand '{other}'"),
        ),
    }
}

fn print_bisect_help() {
    println!(
        "Usage: taxis bisect <subcommand> [options]\n\n\
         Subcommands:\n\
           start [<bad> [<good>...]]  Start a bisection session\n\
           bad [<rev>]                Mark a revision as bad (broken)\n\
           good [<rev>...]            Mark revision(s) as good (clean)\n\
           skip [<rev>...]            Skip revision(s) that cannot be tested\n\
           reset [<commit>]           Abort bisection and restore starting branch/commit\n\
           run <cmd>...               Automatically bisect by running test script\n\
           status                     Show current bisection state and progress"
    );
}

fn open_repo_or_reject(ctx: &CliContext) -> RepoView {
    RepoView::open(ctx)
        .unwrap_or_else(|err| reject(CliTag::ERROR, format!("open repository: {err}")))
}

fn resolve_oid_or_reject(view: &RepoView, rev: &str, label: &str) -> Oid {
    view.resolve(rev)
        .unwrap_or_else(|err| reject(CliTag::ERROR, format!("resolve {label} '{rev}': {err}")))
}

fn load_state_or_reject(view: &RepoView) -> BisectState {
    match BisectState::load(view.git_dir()) {
        Ok(Some(s)) => s,
        Ok(None) => reject(
            CliTag::ERROR,
            "no bisection in progress (use 'taxis bisect start')",
        ),
        Err(err) => reject(CliTag::ERROR, format!("read bisect state: {err}")),
    }
}

fn save_state_or_reject(view: &RepoView, state: &BisectState) {
    if let Err(err) = state.save(view.git_dir()) {
        reject(CliTag::ERROR, format!("save bisect state: {err}"));
    }
}

fn handle_bisect_start(ctx: &CliContext, args: &[String]) {
    let view = open_repo_or_reject(ctx);
    let orig_head = resolve_oid_or_reject(&view, HEAD_REV, "HEAD");

    let bad_oid = match args.first() {
        Some(arg) => resolve_oid_or_reject(&view, arg, "bad commit"),
        None => orig_head,
    };

    let mut state = BisectState::new(orig_head, bad_oid);
    if args.len() > 1 {
        for good_arg in &args[1..] {
            let oid = resolve_oid_or_reject(&view, good_arg, "good commit");
            state.good.push(oid);
        }
    }

    save_state_or_reject(&view, &state);

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "started",
            "bad": state.bad.to_hex(),
            "good": state.good.iter().map(|o| o.to_hex()).collect::<Vec<_>>(),
            "orig_head": state.orig_head.to_hex(),
        }));
    } else {
        println!(
            "Bisecting: started at bad={}",
            &state.bad.to_hex()[..HEX_SHORT_LEN]
        );
    }

    if !state.good.is_empty() {
        advance_bisect(ctx, &view, &mut state);
    }
}

fn handle_bisect_mark(ctx: &CliContext, args: &[String], is_bad: bool) {
    let view = open_repo_or_reject(ctx);
    let mut state = load_state_or_reject(&view);
    let rev = args.first().map(|s| s.as_str()).unwrap_or(HEAD_REV);

    let oid = resolve_oid_or_reject(&view, rev, LABEL_REVISION);
    if is_bad {
        state.bad = oid;
    } else if !state.good.contains(&oid) {
        state.good.push(oid);
    }

    save_state_or_reject(&view, &state);
    advance_bisect(ctx, &view, &mut state);
}

fn handle_bisect_skip(ctx: &CliContext, args: &[String]) {
    let view = open_repo_or_reject(ctx);
    let mut state = load_state_or_reject(&view);
    let rev = args.first().map(|s| s.as_str()).unwrap_or(HEAD_REV);

    let oid = resolve_oid_or_reject(&view, rev, LABEL_REVISION);
    if !state.skipped.contains(&oid) {
        state.skipped.push(oid);
    }

    save_state_or_reject(&view, &state);
    advance_bisect(ctx, &view, &mut state);
}

fn handle_bisect_reset(ctx: &CliContext, args: &[String]) {
    let view = open_repo_or_reject(ctx);

    let state = match BisectState::load(view.git_dir()) {
        Ok(Some(s)) => s,
        Ok(None) => {
            if ctx.json_mode {
                print_json(&serde_json::json!({ "status": "reset", "restored": null }));
            } else {
                println!("We are not bisecting.");
            }
            return;
        }
        Err(err) => reject(CliTag::ERROR, format!("read bisect state: {err}")),
    };

    let target_rev = args
        .first()
        .cloned()
        .unwrap_or_else(|| state.orig_head.to_hex());

    let checkout_ctx = CliContext {
        git_dir: ctx.git_dir.clone(),
        json_mode: false,
        args: vec![target_rev.clone()],
    };
    handle_checkout(&checkout_ctx);

    if let Err(err) = BisectState::clear(view.git_dir()) {
        reject(CliTag::ERROR, format!("clear bisect state: {err}"));
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "reset",
            "restored": target_rev,
        }));
    } else {
        println!("Bisect reset: restored to {target_rev}");
    }
}

fn handle_bisect_status(ctx: &CliContext) {
    let view = open_repo_or_reject(ctx);
    match BisectState::load(view.git_dir()) {
        Ok(Some(s)) => render_bisect_status(ctx, &s),
        Ok(None) => {
            if ctx.json_mode {
                print_json(&serde_json::json!({ "active": false }));
            } else {
                println!("No bisection in progress.");
            }
        }
        Err(err) => reject(CliTag::ERROR, format!("read bisect state: {err}")),
    }
}

fn render_bisect_status(ctx: &CliContext, state: &BisectState) {
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "active": state.active,
            "orig_head": state.orig_head.to_hex(),
            "bad": state.bad.to_hex(),
            "good": state.good.iter().map(|o| o.to_hex()).collect::<Vec<_>>(),
            "skipped": state.skipped.iter().map(|o| o.to_hex()).collect::<Vec<_>>(),
        }));
        return;
    }

    println!("Bisection in progress:");
    println!("  bad:       {}", state.bad.to_hex());
    for g in &state.good {
        println!("  good:      {}", g.to_hex());
    }
    for s in &state.skipped {
        println!("  skipped:   {}", s.to_hex());
    }
    println!("  orig_head: {}", state.orig_head.to_hex());
}

fn update_state_for_run_code(view: &RepoView, state: &mut BisectState, code: i32) {
    let curr_head = resolve_oid_or_reject(view, HEAD_REV, "HEAD");
    if code == 0 {
        if !state.good.contains(&curr_head) {
            state.good.push(curr_head);
        }
    } else if code == EXIT_CODE_SKIP {
        if !state.skipped.contains(&curr_head) {
            state.skipped.push(curr_head);
        }
    } else {
        state.bad = curr_head;
    }
}

fn execute_single_run_iteration(
    ctx: &CliContext,
    program: &str,
    prog_args: &[String],
) -> BisectStep {
    let view = open_repo_or_reject(ctx);
    let mut state = load_state_or_reject(&view);

    println!("Running: {} {:?}", program, prog_args);
    let status = match Command::new(program).args(prog_args).status() {
        Ok(s) => s,
        Err(err) => reject(CliTag::ERROR, format!("execute command '{program}': {err}")),
    };

    let code = status.code().unwrap_or(1);
    update_state_for_run_code(&view, &mut state, code);
    save_state_or_reject(&view, &state);

    advance_bisect(ctx, &view, &mut state)
}

fn handle_bisect_run(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(CliTag::ERROR, "taxis bisect run requires a command script");
    }

    let program = &args[0];
    let prog_args = &args[1..];

    loop {
        let step = execute_single_run_iteration(ctx, program, prog_args);
        match step {
            BisectStep::Found { .. } | BisectStep::Finished { .. } => break,
            BisectStep::Step { .. } => {}
        }
    }
}

fn advance_bisect(ctx: &CliContext, view: &RepoView, state: &mut BisectState) -> BisectStep {
    let mut commit_cache: HashMap<Oid, Vec<Oid>> = HashMap::new();

    let step = BisectEngine::compute_midpoint(&state.bad, &state.good, &state.skipped, |oid| {
        if let Some(parents) = commit_cache.get(oid) {
            return Some(parents.clone());
        }
        if let Ok(obj) = view.object(oid) {
            if let Ok(record) = parse_commit_record(*oid, &obj.payload) {
                commit_cache.insert(*oid, record.parents.clone());
                return Some(record.parents);
            }
        }
        None
    });

    render_bisect_step(ctx, &step);
    step
}

fn render_bisect_step(ctx: &CliContext, step: &BisectStep) {
    match step {
        BisectStep::Step {
            candidate,
            remaining_candidates,
            estimated_steps,
        } => {
            let checkout_ctx = CliContext {
                git_dir: ctx.git_dir.clone(),
                json_mode: false,
                args: vec![candidate.to_hex()],
            };
            handle_checkout(&checkout_ctx);

            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "step": "midpoint",
                    "candidate": candidate.to_hex(),
                    "remaining_candidates": remaining_candidates,
                    "estimated_steps": estimated_steps,
                }));
            } else {
                println!(
                    "Bisecting: {} revisions left to test after this (roughly {} steps)",
                    remaining_candidates, estimated_steps
                );
                println!(
                    "[{}] Checking out candidate commit",
                    &candidate.to_hex()[..HEX_SHORT_LEN]
                );
            }
        }
        BisectStep::Found { first_bad } => {
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "step": "found",
                    "first_bad": first_bad.to_hex(),
                }));
            } else {
                println!("{} is the first bad commit", first_bad.to_hex());
            }
        }
        BisectStep::Finished { message } => {
            if ctx.json_mode {
                print_json(&serde_json::json!({
                    "step": "finished",
                    "message": message,
                }));
            } else {
                println!("Bisect finished: {message}");
            }
        }
    }
}
