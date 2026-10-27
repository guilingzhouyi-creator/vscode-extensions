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
use taxis_cmd::common::{find_arg_value, print_json, reject, CliContext};
use taxis_cmd::{
    archive, bench, bisect, blackboard, blame, branch, bundle, checkout, cherry_pick, commit,
    config, daemon, diff, doctor, hash_object, init, log, merge, operation, project, projection,
    promotion, quarantine, read, rebase, reclaim, relocate, remote, repack, reset, rev_list,
    revert, stash, status, submodule, tag, unarchive, undo, verify, worktree,
};

use fg_core::models::current_unix_seconds;
use fg_gate::authority::resolve_authority_secret;
use fractal_git::constants::cli::CliTag;

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
        (&["repack", "pack-objects"], "repack"),
        (&["remote"], "remote"),
        (&["fetch"], "fetch"),
        (&["push"], "push"),
        (&["pull"], "pull"),
        (&["config", "cfg"], "config"),
        (&["submodule", "sub"], "submodule"),
        (&["project", "pj"], "project"),
        (&["archive"], "archive"),
        (&["unarchive", "extract"], "unarchive"),
        (&["bundle"], "bundle"),
        (&["blame"], "blame"),
        (&["bisect"], "bisect"),
        (&["serve", "daemon"], "daemon"),
        (&["lg", "log"], "log"),
        (&["sh", "show"], "show"),
        (&["rb", "rebase"], "rebase"),
        (&["mg", "merge"], "merge"),
        (&["cp", "cherry-pick"], "cherry-pick"),
        (&["reset"], "reset"),
        (&["tag"], "tag"),
        (&["revert"], "revert"),
        (&["stash"], "stash"),
        (&["wt", "worktree"], "worktree"),
        (&["pm", "promo", "promotion"], "promotion"),
        (&["quarantine", "quar"], "quarantine"),
        (&["bb", "blackboard"], "blackboard"),
        (&["bench", "benchmark"], "bench"),
        (&["undo"], "undo"),
        (&["op", "operation"], "operation"),
        (&["hash-object"], "hash-object"),
        (&["rev-list"], "rev-list"),
        (&["authority", "auth"], "authority"),
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
  branch,   br       List, create, delete, or verify branches (Trunk/Cell/Card/Sub)
  commit,   ci       Create atomic commit with agent metadata
  diff,     di       Show tree diff or pass through to git diff
  checkout, co       Switch fractal worktree or git reference (-b to create branch)
  merge,    mg       3-Way hierarchical branch merge with fast-forward and conflict markers
  reset              Reset HEAD, index, or worktree (--soft | --mixed | --hard)
  tag                Create, list, or delete lightweight and annotated Git tags
  cherry-pick, cp    Apply commit delta onto current HEAD branch
  revert             Create inverse commit delta reverting a past commit
  stash              Shelve and restore uncommitted changes (push, pop, apply, list, drop)
  rebase,   rb       Replay branch commits linearly onto an upstream tip
  undo               Revert repository state to predecessor operation (Jujutsu-style)
  operation, op      Inspect immutable Operation Log DAG history
  verify,   check    Run pre-receive guard, conflict marker scanner & quota checks
  authority, auth    Issue or verify HMAC authority credentials (--subject / --token)
  archive            Package tree-ish object states into streaming Tar, Tar.gz, or Zip archives
  unarchive, extract Extract Zip, Tar, Tar.gz, or Bundle in-place with SpacePlan preflight (--dry-run, --to-odb)
  bundle             Create, verify, list-heads, or unbundle Git bundle v2 packages in-place
  reclaim,  gc       Trigger zero-allocation worktree & sandbox reclamation
  repack             Consolidate loose objects into Git packfiles and index v2 (--async, --low-disk, --window)
  remote             Manage set of tracked repositories (list, add, remove, get-url)
  fetch              Download objects and refs from another repository
  push               Update remote refs along with associated objects
  pull               Fetch from and integrate with another repository
  project,  pj       Manage controlled project leases and hierarchical TTL (list, register, renew, evict)
  quarantine, quar   Manage elastic quarantine stash for unauthorized changes (list, show, restore, discard)
  worktree, wt       Display or allocate scoped projection worktree (--scope / --full)
  blackboard, bb     Manage concurrent SubAgent intent leases (claim, check, release, list)
  promotion, pm      Manage staged promotions to System Trunk with Human GUI UAC gate
  bench,    benchmark Run performance benchmarks (--level <1|2|3|all>, -m <mult>)
  daemon,   serve    Display protocol daemon status & IPC endpoints
  version,  -v       Display version and domain rules SSOT

Transparent Git Command Aliases & Passthrough:
  sw/switch, lg/log, sh/show, rb/rebase, mg/merge, cp/cherry-pick
  Any standard git command runs seamlessly with CAS acceleration.

Flags:
  --json             Output machine-readable JSON format
  --git-dir <path>   Override .git or .taxis directory location
"#
    );
}

/// Resolves effective repository directory following priority:
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
        "git-export" => projection::handle_git_export(ctx),
        "git-import" => projection::handle_git_import(ctx),
        "status" => status::handle_status(ctx),
        "branch" => branch::handle_branch(ctx),
        "commit" => commit::handle_commit(ctx),
        "diff" => diff::handle_diff(ctx),
        "hash-object" => hash_object::handle_hash_object(ctx),
        "cat-file" => read::handle_cat_file(ctx),
        "ls-tree" => read::handle_ls_tree(ctx),
        "ls-files" => read::handle_ls_files(ctx),
        "show-ref" => read::handle_show_ref(ctx),
        "for-each-ref" => read::handle_for_each_ref(ctx),
        "check-ignore" => read::handle_check_ignore(ctx),
        "log" => log::handle_log(ctx),
        "show" => log::handle_show(ctx),
        "checkout" | "switch" => checkout::handle_checkout(ctx),
        "merge" => merge::handle_merge(ctx),
        "reset" => reset::handle_reset(ctx),
        "tag" => tag::handle_tag(ctx),
        "cherry-pick" => cherry_pick::handle_cherry_pick(ctx),
        "revert" => revert::handle_revert(ctx),
        "stash" => stash::handle_stash(ctx),
        "rebase" => rebase::handle_rebase(ctx),
        "worktree" => worktree::handle_worktree(ctx),
        "blackboard" => blackboard::handle_blackboard(ctx),
        "promotion" => promotion::handle_promotion(ctx),
        "bench" => bench::handle_bench(ctx),
        "undo" => undo::handle_undo(ctx),
        "operation" => operation::handle_operation(ctx),
        "rev-list" => rev_list::handle_rev_list(ctx),
        "verify" => verify::handle_verify(ctx),
        "authority" => handle_authority(ctx),
        "reclaim" => reclaim::handle_reclaim(ctx),
        "repack" | "pack-objects" => repack::handle_repack(ctx),
        "remote" => remote::handle_remote(ctx),
        "fetch" => remote::handle_fetch(ctx),
        "push" => remote::handle_push(ctx),
        "pull" => remote::handle_pull(ctx),
        "config" => config::handle_config(ctx),
        "submodule" => submodule::handle_submodule(ctx),
        "project" => project::handle_project(ctx),
        "quarantine" => quarantine::handle_quarantine(ctx),
        "archive" => archive::handle_archive(ctx),
        "unarchive" => unarchive::handle_unarchive(ctx),
        "bundle" => bundle::handle_bundle(ctx),
        "blame" => blame::handle_blame(ctx),
        "bisect" => bisect::handle_bisect(ctx),
        "daemon" => daemon::handle_daemon(ctx),
        "version" => {
            print_banner();
            println!("Version: 0.1.0 (Rust Stable, 10 Micro-Crates)");
        }
        "help" => print_help(),
        other => reject_unimplemented(other),
    }
}

/// Issues and verifies HMAC authority credentials.
fn handle_authority(ctx: &CliContext) {
    let action = ctx.args.first().map(String::as_str).unwrap_or("help");
    match action {
        "issue" => issue_authority(ctx),
        "verify" => verify_authority(ctx),
        "help" | "-h" | "--help" => println!(
            "Usage: taxis authority <action>\n  \
             issue  --subject <name> [--ttl <seconds>]  Mint a human authority token\n  \
             verify --token <credential>                Verify a token against the local secret"
        ),
        other => reject(
            CliTag::ERROR,
            format!("unknown authority action '{other}'; use 'issue' or 'verify'"),
        ),
    }
}

/// Mints one authority token for a named human subject.
fn issue_authority(ctx: &CliContext) {
    let secret = resolve_authority_secret(&ctx.git_dir).unwrap_or_else(|secret_err| {
        reject(
            CliTag::AUTHORITY_BREACH,
            format!("authority secret unavailable: {secret_err}"),
        )
    });
    let subject = find_arg_value(&ctx.args, &["--subject"])
        .unwrap_or_else(|| reject(CliTag::ERROR, "authority issue requires --subject <name>"));
    let ttl_secs = match find_arg_value(&ctx.args, &["--ttl"])
        .unwrap_or("3600")
        .parse::<u64>()
    {
        Ok(ttl) if ttl > 0 => ttl,
        _ => reject(
            CliTag::ERROR,
            "--ttl must be a positive integer number of seconds",
        ),
    };
    let now_secs = current_unix_seconds();
    let token = match secret.issue(subject, ttl_secs, now_secs) {
        Ok(token) => token,
        Err(issue_err) => reject(
            CliTag::AUTHORITY_BREACH,
            format!("authority issue failed: {issue_err}"),
        ),
    };
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "authority issue",
            "token": token,
            "subject": subject,
            "issued_at": now_secs,
            "expires_at": now_secs + (ttl_secs as i64),
        }));
        return;
    }
    println!("{token}");
}

/// Verifies one presented authority token against the local secret.
fn verify_authority(ctx: &CliContext) {
    let secret = resolve_authority_secret(&ctx.git_dir).unwrap_or_else(|secret_err| {
        reject(
            CliTag::AUTHORITY_BREACH,
            format!("authority secret unavailable: {secret_err}"),
        )
    });
    let token = find_arg_value(&ctx.args, &["--token"]).unwrap_or_else(|| {
        reject(
            CliTag::ERROR,
            "authority verify requires --token <credential>",
        )
    });
    let claims = match secret.verify(token, current_unix_seconds()) {
        Ok(claims) => claims,
        Err(verify_err) => reject(
            CliTag::AUTHORITY_BREACH,
            format!("authority verify failed: {verify_err}"),
        ),
    };
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "engine": "taxis",
            "operation": "authority verify",
            "valid": true,
            "subject": claims.subject,
            "issued_at": claims.issued_at,
            "expires_at": claims.expires_at,
        }));
        return;
    }
    println!(
        "valid: subject={} issued_at={} expires_at={}",
        claims.subject, claims.issued_at, claims.expires_at
    );
}
/// Rejects a subcommand that has no native implementation.
fn reject_unimplemented(subcommand: &str) -> ! {
    reject(
        CliTag::ERROR,
        format!(
            "'{subcommand}' has no native implementation in this build. \
             Implemented: init, doctor, relocate, git-export, git-import, status, branch, commit, diff, hash-object, cat-file, ls-tree, \
             ls-files, show-ref, for-each-ref, check-ignore, log, show, checkout, merge, reset, tag, cherry-pick, revert, \
             stash, rebase, repack, project, worktree, blackboard, promotion, bench, undo, operation, rev-list, verify, authority, reclaim, daemon, version, help."
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
