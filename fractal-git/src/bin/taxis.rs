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
    am, apply, archive, bench, bisect, blackboard, blame, branch, bundle, checkout, cherry_pick,
    clone, commit, config, daemon, diagnostics_tool, diff, doctor, format_patch, gate_slice,
    hash_object, index_plumbing, init, inspect, lineage, list_files, log, maintenance,
    maintenance_ops, merge, notes_replace, operation, pack_plumbing, plumbing_tree, project,
    projection, promotion, quality, quarantine, read, rebase, reclaim, refs, relocate, remote,
    repack, reset, rev_list, revert, stage, stash, status, submodule, tag, unarchive, undo, verify,
    worktree,
};

use fg_core::models::current_unix_seconds;
use fg_gate::authority::resolve_authority_secret;
use fractal_git::constants::cli::CliTag;

/// Specification for one Taxis CLI subcommand and its accepted shorthand aliases.
struct CommandSpec {
    canonical: &'static str,
    aliases: &'static [&'static str],
    handler: fn(&CliContext),
}

const fn cmd(
    canonical: &'static str,
    aliases: &'static [&'static str],
    handler: fn(&CliContext),
) -> CommandSpec {
    CommandSpec {
        canonical,
        aliases,
        handler,
    }
}

const COMMAND_TABLE: &[CommandSpec] = &[
    cmd("init", &[], init::handle_init),
    cmd("doctor", &[], doctor::handle_doctor),
    cmd("relocate", &[], relocate::handle_relocate),
    cmd("git-export", &["export"], projection::handle_git_export),
    cmd("git-import", &["import"], projection::handle_git_import),
    cmd("status", &["st"], status::handle_status),
    cmd("add", &[], stage::handle_add),
    cmd("rm", &[], stage::handle_rm),
    cmd("mv", &[], stage::handle_mv),
    cmd("restore", &[], stage::handle_restore),
    cmd("branch", &["br"], branch::handle_branch),
    cmd("commit", &["ci"], commit::handle_commit),
    cmd("diff", &["di"], diff::handle_diff),
    cmd("hash-object", &[], hash_object::handle_hash_object),
    cmd("write-tree", &[], index_plumbing::handle_write_tree),
    cmd("commit-tree", &[], index_plumbing::handle_commit_tree),
    cmd("update-index", &[], index_plumbing::handle_update_index),
    CommandSpec {
        canonical: "authority",
        aliases: &["authority", "auth"],
        handler: handle_authority,
    },
    CommandSpec {
        canonical: "reclaim",
        aliases: &["reclaim"],
        handler: reclaim::handle_reclaim,
    },
    CommandSpec {
        canonical: "gc",
        aliases: &["gc"],
        handler: maintenance::handle_gc,
    },
    CommandSpec {
        canonical: "clean",
        aliases: &["clean"],
        handler: maintenance::handle_clean,
    },
    CommandSpec {
        canonical: "prune",
        aliases: &["prune"],
        handler: maintenance::handle_prune,
    },
    CommandSpec {
        canonical: "fsck",
        aliases: &["fsck"],
        handler: maintenance::handle_fsck,
    },
    CommandSpec {
        canonical: "clone",
        aliases: &["clone"],
        handler: clone::handle_clone,
    },
    CommandSpec {
        canonical: "repack",
        aliases: &["repack", "pack-objects"],
        handler: repack::handle_repack,
    },
    CommandSpec {
        canonical: "remote",
        aliases: &["remote"],
        handler: remote::handle_remote,
    },
    CommandSpec {
        canonical: "fetch",
        aliases: &["fetch"],
        handler: remote::handle_fetch,
    },
    CommandSpec {
        canonical: "push",
        aliases: &["push"],
        handler: remote::handle_push,
    },
    CommandSpec {
        canonical: "pull",
        aliases: &["pull"],
        handler: remote::handle_pull,
    },
    CommandSpec {
        canonical: "config",
        aliases: &["config", "cfg"],
        handler: config::handle_config,
    },
    CommandSpec {
        canonical: "submodule",
        aliases: &["submodule", "sub"],
        handler: submodule::handle_submodule,
    },
    CommandSpec {
        canonical: "project",
        aliases: &["project", "pj"],
        handler: project::handle_project,
    },
    CommandSpec {
        canonical: "quality",
        aliases: &["quality", "trace"],
        handler: quality::handle_quality,
    },
    CommandSpec {
        canonical: "quarantine",
        aliases: &["quarantine", "quar"],
        handler: quarantine::handle_quarantine,
    },
    CommandSpec {
        canonical: "archive",
        aliases: &["archive"],
        handler: archive::handle_archive,
    },
    CommandSpec {
        canonical: "unarchive",
        aliases: &["unarchive", "extract"],
        handler: unarchive::handle_unarchive,
    },
    CommandSpec {
        canonical: "bundle",
        aliases: &["bundle"],
        handler: bundle::handle_bundle,
    },
    CommandSpec {
        canonical: "blame",
        aliases: &["blame"],
        handler: blame::handle_blame,
    },
    CommandSpec {
        canonical: "bisect",
        aliases: &["bisect"],
        handler: bisect::handle_bisect,
    },
    CommandSpec {
        canonical: "daemon",
        aliases: &["serve", "daemon"],
        handler: daemon::handle_daemon,
    },
    CommandSpec {
        canonical: "notes",
        aliases: &["notes"],
        handler: notes_replace::handle_notes,
    },
    CommandSpec {
        canonical: "replace",
        aliases: &["replace"],
        handler: notes_replace::handle_replace,
    },
    CommandSpec {
        canonical: "commit-graph",
        aliases: &["commit-graph"],
        handler: maintenance_ops::handle_commit_graph,
    },
    CommandSpec {
        canonical: "sparse-checkout",
        aliases: &["sparse-checkout"],
        handler: maintenance_ops::handle_sparse_checkout,
    },
    CommandSpec {
        canonical: "maintenance",
        aliases: &["maintenance"],
        handler: maintenance_ops::handle_maintenance,
    },
    CommandSpec {
        canonical: "rerere",
        aliases: &["rerere"],
        handler: maintenance_ops::handle_rerere,
    },
    CommandSpec {
        canonical: "unpack-objects",
        aliases: &["unpack-objects"],
        handler: pack_plumbing::handle_unpack_objects,
    },
    CommandSpec {
        canonical: "index-pack",
        aliases: &["index-pack"],
        handler: pack_plumbing::handle_index_pack,
    },
    CommandSpec {
        canonical: "multi-pack-index",
        aliases: &["multi-pack-index", "midx"],
        handler: pack_plumbing::handle_multi_pack_index,
    },
    CommandSpec {
        canonical: "diagnostics",
        aliases: &["diagnostics", "diag"],
        handler: diagnostics_tool::handle_diagnostics,
    },
    CommandSpec {
        canonical: "version",
        aliases: &["version", "-v", "--version"],
        handler: handle_version,
    },
    CommandSpec {
        canonical: "help",
        aliases: &["help", "-h", "--help"],
        handler: handle_help,
    },
];

fn handle_version(_ctx: &CliContext) {
    print_banner();
    let edition = fg_core::constants::Edition::CURRENT;
    let capabilities = edition.capabilities();
    println!("Version: 0.1.0 (Rust Stable, 10 Kernel Subsystems)");
    println!("Edition: {}", edition.as_str());
    println!("  {}", edition.description());
    // Capabilities are printed unconditionally, including the disabled ones. A reader asking "can
    // this push to a remote?" must find a definite no rather than the absence of a mention.
    println!(
        "  capabilities: network_transport={} multi_repo_coordination={} local_git_parity={}",
        capabilities.network_transport,
        capabilities.multi_repo_coordination,
        capabilities.local_git_parity
    );
    // Listing where the disabled capabilities will land is what separates "not built yet" from
    // "forgotten". It is also the honest answer to "can I expect this later?".
    for planned in fg_core::constants::PLANNED_CAPABILITIES {
        if capabilities.allows(planned.name) {
            continue;
        }
        println!("  planned {}: {}", planned.name, planned.landing_point);
    }
}

fn handle_help(_ctx: &CliContext) {
    print_help();
}

fn resolve_canonical_subcommand(raw: &str) -> &str {
    for spec in COMMAND_TABLE {
        if spec.canonical == raw || spec.aliases.contains(&raw) {
            return spec.canonical;
        }
    }
    raw
}

fn print_banner() {
    // The edition is part of the banner rather than a footnote because the single most damaging
    // misunderstanding today is assuming this build can reach a remote. A reader who sees the
    // banner at all has already been told which capability tier they are holding.
    print!(
        "=== Taxis (Fractal Git) Engine v0.1.0 [{} edition] ===\n\
         Agent-Native In-Memory CAS & Fractal Version Matrix\n\
         SSOT Rules: FGT-COR-001 through FGT-CAS-001\n\n",
        fg_core::constants::Edition::CURRENT.as_str()
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
  update-ref         Update, read or delete a reference (CAS guard supported)
  symbolic-ref       Read or set HEAD's symbolic target
  merge-base         Find the best common ancestor; --is-ancestor for a predicate
  reflog             Show reference update history from the operation ledger
  diff,     di       Show tree diff or pass through to git diff
  checkout, co       Switch fractal worktree or git reference (-b to create branch)
  merge,    mg       3-Way hierarchical branch merge with fast-forward and conflict markers
  reset              Reset HEAD, index, or worktree (--soft | --mixed | --hard)
  tag                Create, list, or delete lightweight and annotated Git tags
  cherry-pick, cp    Apply commit delta onto current HEAD branch
  revert             Create inverse commit delta reverting a past commit
  format-patch       Prepare each commit for email submission by creating a patch file
  apply              Apply a patch to files and/or to the index (--stat, --check, --cached)
  am                 Apply a series of patches from a mailbox (--abort, --skip, --resolved)
  range-diff         Compare two commit ranges
  cherry             Find commits yet to be applied to upstream (-v)
  patch-id           Compute unique ID for a patch from stdin
  merge-tree         Perform 3-way tree merge without touching index or worktree
  stripspace         Remove unnecessary whitespace and comment lines from stdin
  mktree             Build a tree-object from ls-tree formatted text
  read-tree          Read tree information into the index (-u, --prefix)
  mktag              Creates a tag object with extra validation
  name-rev           Find symbolic names for given revs (--tags)
  verify-commit      Check cryptographic signature of commits (--raw, --verbose)
  verify-tag         Check the cryptographic signature of tags (--raw, --verbose)
  stash              Shelve and restore uncommitted changes (push, pop, apply, list, drop)
  rebase,   rb       Replay branch commits linearly onto an upstream tip
  undo               Revert repository state to predecessor operation (Jujutsu-style)
  operation, op      Inspect immutable Operation Log DAG history
  verify,   check    Run pre-receive guard, conflict marker scanner & quota checks
  authority, auth    Issue or verify HMAC authority credentials (--subject / --token)
  archive            Package tree-ish object states into streaming Tar, Tar.gz, or Zip archives
  unarchive, extract Extract Zip, Tar, Tar.gz, or Bundle in-place with SpacePlan preflight (--dry-run, --to-odb)
  bundle             Create, verify, list-heads, or unbundle Git bundle v2 packages in-place
  reclaim            Trigger worktree & sandbox reclamation (or 'worktree prune')
  prune              Prune all unreachable loose objects from the object database
  clean              Remove untracked files from the working tree (-f, -d, -n)
  gc                 Cleanup unnecessary files and optimize the local repository
  fsck               Verify the connectivity and validity of objects in the database
  repack             Consolidate loose objects into Git packfiles and index v2 (--async, --low-disk, --window)
  remote             Manage set of tracked repositories (list, add, remove, get-url)
  fetch              Local transports only; network is disabled in this edition
  push               Local transports only; network is disabled in this edition
  pull               Local transports only; network is disabled in this edition
  config,   cfg      Get and set repository or global options (--global, --local, -f)
  submodule, sub     Initialize, update, inspect, or sync submodules (status, init, sync, add)
  project,  pj       Manage controlled project leases and hierarchical TTL (list, register, renew, evict)
  quarantine, quar   Manage elastic quarantine stash for unauthorized changes (list, show, restore, discard)
  worktree, wt       Display or allocate scoped projection worktree (--scope / --full)
  blackboard, bb     Manage concurrent SubAgent intent leases (claim, check, release, list)
  promotion, pm      Manage staged promotions to System Trunk with Human Elevation gate
  bench,    benchmark Run performance benchmarks (--level <1|2|3|all>, -m <mult>)
  daemon,   serve    Display protocol daemon status & IPC endpoints
  notes              Add, inspect, or remove commit notes (list, show, add, remove)
  replace            Create, list, or delete replace refs for objects (-l, -d)
  commit-graph       Write or verify Git Commit-Graph (CGPH) generation indices
  sparse-checkout    Initialize, set, list, or disable sparse-checkout patterns
  maintenance        Run periodic repository optimization tasks (commit-graph, repack)
  rerere             Reuse recorded resolution of conflicted merges (status, clear, diff)
  unpack-objects     Unpack objects from a packed archive on stdin into loose store
  index-pack         Build pack index file for an existing packed archive (-o)
  multi-pack-index   Write or verify Multi-Pack Index (MIDX) files for object packs (write, verify)
  diagnostics, diag  Passive commercial JSONL logging inspector and stats report
  version,  -v       Display version and domain rules SSOT

Transparent Git Command Aliases:
  sw/switch, lg/log, sh/show, rb/rebase, mg/merge, cp/cherry-pick
  Only commands listed above are dispatched natively. Anything else is refused by name rather
  than silently forwarded, so an unimplemented command can never look like it succeeded.

Edition: engineering (network disabled). Run `taxis version` for the capability set.


Slice and horizon flags (accepted by log, show, diff):
  --scope <glob>     Restrict the view to a path slice; repeatable, '!' prefix subtracts
  --tier <name>      system-trunk | integration-cell | agent-card | sub-agent
  --horizon <spec>   full (default) | <n> commits | <n>s seconds

  `log` keeps out-of-scope commits and labels them; `show` and `diff` omit their hunks.
  A slice never removes a commit from the graph: it reports what this tier can see.

Installation:
  install            Copy this binary onto PATH so `taxis` runs without a full path
  uninstall          Remove the installed copy (refuses to delete the running binary)

Flags:
  --json             Output machine-readable JSON format
  --git-dir <path>   Override .git or .taxis directory location
  --log-level <lvl>  trace | debug | info | warn | error | off (also TAXIS_LOG)
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
        } else if raw_args[arg_cursor] == "--log-level" && arg_cursor + 1 < raw_args.len() {
            // Consumed by diagnostic configuration in `main`; it is a process-level switch, not a
            // subcommand argument, so it must not reach subcommand dispatch.
            arg_cursor += 2;
        } else if raw_args[arg_cursor] == "--debug"
            || raw_args[arg_cursor] == "--verbose"
            || raw_args[arg_cursor] == "--diagnostic"
        {
            // Process-level diagnostic toggles; consumed before subcommand dispatch.
            arg_cursor += 1;
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
    for spec in COMMAND_TABLE {
        if spec.canonical == effective_subcommand {
            (spec.handler)(ctx);
            return;
        }
    }
    reject_unimplemented(effective_subcommand);
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
             Implemented: init, doctor, relocate, git-export, git-import, status, add, rm, mv, restore, branch, commit, diff, hash-object, \
             write-tree, commit-tree, update-index, rev-parse, cat-file, ls-tree, ls-files, show-ref, for-each-ref, update-ref, symbolic-ref, \
             merge-base, reflog, grep, shortlog, describe, count-objects, check-attr, var, check-ignore, log, show, checkout, merge, reset, \
             tag, cherry-pick, revert, format-patch, apply, am, range-diff, cherry, patch-id, merge-tree, stripspace, mktree, read-tree, \
             mktag, name-rev, verify-commit, verify-tag, stash, rebase, worktree, blackboard, promotion, bench, undo, operation, rev-list, \
             verify, gate-slice, authority, reclaim, gc, clean, prune, fsck, clone, repack, remote, fetch, push, pull, config, submodule, \
             project, quality, quarantine, archive, unarchive, bundle, blame, bisect, daemon, notes, replace, commit-graph, sparse-checkout, \
             maintenance, rerere, unpack-objects, index-pack, multi-pack-index, diagnostics, version, help."
        ),
    )
}

fn main() {
    let raw_args: Vec<String> = env::args().skip(1).collect();
    if raw_args.is_empty() {
        print_help();
        return;
    }

    // Logging is configured before any command runs so a failure during start-up is itself
    // diagnosable. `--log-level` wins over `TAXIS_LOG` so one invocation can raise detail without
    // changing the environment.
    let level_flag = find_arg_value(&raw_args, &["--log-level"]);
    fg_core::diagnostics::configure(level_flag);
    if raw_args
        .iter()
        .any(|arg| arg == "--debug" || arg == "--verbose" || arg == "--diagnostic")
    {
        fg_core::diagnostics::set_level(fg_core::diagnostics::LogLevel::Debug);
    }
    fg_core::diag_debug!(
        "taxis",
        "diagnostics configured at level {}",
        fg_core::diagnostics::level()
    );

    let (git_dir, json_mode, filtered_args) = parse_cli_args(&raw_args);
    if filtered_args.is_empty() {
        print_help();
        return;
    }

    let (effective_subcommand, sub_args) = extract_effective_subcommand(&filtered_args);
    let log_file_arg = find_arg_value(&raw_args, &["--log-file"]);
    let log_path = log_file_arg
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var("TAXIS_LOG_FILE")
                .ok()
                .map(std::path::PathBuf::from)
        })
        .or_else(|| {
            if git_dir.is_dir() {
                Some(git_dir.join("diagnostics/taxis.jsonl"))
            } else {
                None
            }
        });
    if let Some(path) = log_path {
        let _ = fg_core::diagnostics::set_file_sink(path, None, None);
    }
    fg_core::diagnostics::set_active_subcommand(effective_subcommand);
    fg_core::diag_debug!(
        "taxis",
        "dispatching '{}' with {} argument(s), json={}",
        effective_subcommand,
        sub_args.len(),
        json_mode
    );
    let invocation_summary = if sub_args.is_empty() {
        format!("Dispatching '{effective_subcommand}'")
    } else {
        format!(
            "Dispatching '{effective_subcommand} {}'",
            sub_args.join(" ")
        )
    };
    fg_core::diagnostics::record_event(
        fg_core::diagnostics::LogLevel::Info,
        "taxis::cli",
        "command_dispatch",
        &invocation_summary,
        None,
        Some(serde_json::json!({
            "subcommand": effective_subcommand,
            "args_count": sub_args.len(),
            "json_mode": json_mode
        })),
    );

    let ctx = CliContext {
        git_dir,
        json_mode,
        args: sub_args,
    };

    dispatch_command(effective_subcommand, &ctx);
}
