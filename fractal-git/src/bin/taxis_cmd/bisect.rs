//! Module: taxis_cmd::bisect — Topological Centroid Bisect Command Dispatcher
//! File Path: src/bin/taxis_cmd/bisect.rs
//! Architecture Role: Dispatches `taxis bisect`, orchestrating binary search across the commit DAG
//!   to isolate bug origins using topological centroid midpoint selection and automated run loops.
//! Dependencies & Triggers: Dispatched by `taxis bisect`.
//! Responsibilities: CLI option parsing, bisect session lifecycle (start, good, bad, skip, reset, run),
//!   DAG ancestor exploration, and automated regression verification.
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

/// Dispatches `taxis bisect`.
pub fn handle_bisect(ctx: &CliContext) {
    if ctx.args.is_empty() {
        print_bisect_help();
        return;
    }

    let sub = ctx.args[0].as_str();
    let sub_args = &ctx.args[1..];

    match sub {
        "start" => handle_bisect_start(ctx, sub_args),
        "bad" => handle_bisect_mark(ctx, sub_args, true),
        "good" => handle_bisect_mark(ctx, sub_args, false),
        "skip" => handle_bisect_skip(ctx, sub_args),
        "reset" => handle_bisect_reset(ctx, sub_args),
        "run" => handle_bisect_run(ctx, sub_args),
        "status" | "log" => handle_bisect_status(ctx),
        "-h" | "--help" | "help" => print_bisect_help(),
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

fn handle_bisect_start(ctx: &CliContext, args: &[String]) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let orig_head = match view.resolve("HEAD") {
        Ok(oid) => oid,
        Err(err) => reject(CliTag::ERROR, format!("resolve HEAD: {err}")),
    };

    let bad_oid = if !args.is_empty() {
        match view.resolve(&args[0]) {
            Ok(oid) => oid,
            Err(err) => reject(
                CliTag::ERROR,
                format!("resolve bad commit '{}': {err}", args[0]),
            ),
        }
    } else {
        orig_head
    };

    let mut state = BisectState::new(orig_head, bad_oid);

    if args.len() > 1 {
        for good_arg in &args[1..] {
            match view.resolve(good_arg) {
                Ok(oid) => state.good.push(oid),
                Err(err) => reject(
                    CliTag::ERROR,
                    format!("resolve good commit '{good_arg}': {err}"),
                ),
            }
        }
    }

    if let Err(err) = state.save(view.git_dir()) {
        reject(CliTag::ERROR, format!("save bisect state: {err}"));
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "started",
            "bad": state.bad.to_hex(),
            "good": state.good.iter().map(|o| o.to_hex()).collect::<Vec<_>>(),
            "orig_head": state.orig_head.to_hex(),
        }));
    } else {
        println!("Bisecting: started at bad={}", &state.bad.to_hex()[..8]);
    }

    if !state.good.is_empty() {
        advance_bisect(ctx, &view, &mut state);
    }
}

fn handle_bisect_mark(ctx: &CliContext, args: &[String], is_bad: bool) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let mut state = match BisectState::load(view.git_dir()) {
        Ok(Some(s)) => s,
        Ok(None) => reject(
            CliTag::ERROR,
            "no bisection in progress (use 'taxis bisect start')",
        ),
        Err(err) => reject(CliTag::ERROR, format!("read bisect state: {err}")),
    };

    let rev = if !args.is_empty() {
        args[0].as_str()
    } else {
        "HEAD"
    };

    let oid = match view.resolve(rev) {
        Ok(o) => o,
        Err(err) => reject(CliTag::ERROR, format!("resolve revision '{rev}': {err}")),
    };

    if is_bad {
        state.bad = oid;
    } else if !state.good.contains(&oid) {
        state.good.push(oid);
    }

    if let Err(err) = state.save(view.git_dir()) {
        reject(CliTag::ERROR, format!("save bisect state: {err}"));
    }

    advance_bisect(ctx, &view, &mut state);
}

fn handle_bisect_skip(ctx: &CliContext, args: &[String]) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let mut state = match BisectState::load(view.git_dir()) {
        Ok(Some(s)) => s,
        Ok(None) => reject(
            CliTag::ERROR,
            "no bisection in progress (use 'taxis bisect start')",
        ),
        Err(err) => reject(CliTag::ERROR, format!("read bisect state: {err}")),
    };

    let rev = if !args.is_empty() {
        args[0].as_str()
    } else {
        "HEAD"
    };

    let oid = match view.resolve(rev) {
        Ok(o) => o,
        Err(err) => reject(CliTag::ERROR, format!("resolve revision '{rev}': {err}")),
    };

    if !state.skipped.contains(&oid) {
        state.skipped.push(oid);
    }

    if let Err(err) = state.save(view.git_dir()) {
        reject(CliTag::ERROR, format!("save bisect state: {err}"));
    }

    advance_bisect(ctx, &view, &mut state);
}

fn handle_bisect_reset(ctx: &CliContext, args: &[String]) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

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

    let target_rev = if !args.is_empty() {
        args[0].clone()
    } else {
        state.orig_head.to_hex()
    };

    // Checkout target commit
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
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
    };

    let state = match BisectState::load(view.git_dir()) {
        Ok(Some(s)) => s,
        Ok(None) => {
            if ctx.json_mode {
                print_json(&serde_json::json!({ "active": false }));
            } else {
                println!("No bisection in progress.");
            }
            return;
        }
        Err(err) => reject(CliTag::ERROR, format!("read bisect state: {err}")),
    };

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "active": state.active,
            "orig_head": state.orig_head.to_hex(),
            "bad": state.bad.to_hex(),
            "good": state.good.iter().map(|o| o.to_hex()).collect::<Vec<_>>(),
            "skipped": state.skipped.iter().map(|o| o.to_hex()).collect::<Vec<_>>(),
        }));
    } else {
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
}

fn handle_bisect_run(ctx: &CliContext, args: &[String]) {
    if args.is_empty() {
        reject(CliTag::ERROR, "taxis bisect run requires a command script");
    }

    let program = &args[0];
    let prog_args = &args[1..];

    loop {
        let view = match RepoView::open(ctx) {
            Ok(v) => v,
            Err(err) => reject(CliTag::ERROR, format!("open repository: {err}")),
        };

        let mut state = match BisectState::load(view.git_dir()) {
            Ok(Some(s)) => s,
            Ok(None) => reject(CliTag::ERROR, "no bisection in progress"),
            Err(err) => reject(CliTag::ERROR, format!("read bisect state: {err}")),
        };

        println!("Running: {} {:?}", program, prog_args);
        let status = match Command::new(program).args(prog_args).status() {
            Ok(s) => s,
            Err(err) => reject(CliTag::ERROR, format!("execute command '{program}': {err}")),
        };

        let code = status.code().unwrap_or(1);
        if code == 0 {
            let curr_head = match view.resolve("HEAD") {
                Ok(o) => o,
                Err(err) => reject(CliTag::ERROR, format!("resolve HEAD: {err}")),
            };
            if !state.good.contains(&curr_head) {
                state.good.push(curr_head);
            }
        } else if code == 125 {
            let curr_head = match view.resolve("HEAD") {
                Ok(o) => o,
                Err(err) => reject(CliTag::ERROR, format!("resolve HEAD: {err}")),
            };
            if !state.skipped.contains(&curr_head) {
                state.skipped.push(curr_head);
            }
        } else {
            let curr_head = match view.resolve("HEAD") {
                Ok(o) => o,
                Err(err) => reject(CliTag::ERROR, format!("resolve HEAD: {err}")),
            };
            state.bad = curr_head;
        }

        if let Err(err) = state.save(view.git_dir()) {
            reject(CliTag::ERROR, format!("save bisect state: {err}"));
        }

        let step = advance_bisect(ctx, &view, &mut state);
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

    match &step {
        BisectStep::Step {
            candidate,
            remaining_candidates,
            estimated_steps,
        } => {
            // Materialize candidate commit in worktree
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
                    &candidate.to_hex()[..8]
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

    step
}
