//! Module: taxis_cmd::project — Controlled Project Lease & In-Memory Registry Dispatcher
//! File Path: src/bin/taxis_cmd/project.rs
//! Architecture Role: Dispatches controlled project lease management commands (`register`, `list`,
//!   `touch`, `renew`, `unregister`, `evict`, `discover`, `show`), enforcing hierarchical TTL constraints.
//! Dependencies & Triggers: Dispatched by `taxis project` or `taxis pj`.
//! Responsibilities: Project lease inspection, unfreezing renewals, manual registrations, and opportunistic discovery.
//! Exit Semantics & Design Rationale:
//!   - Supports dual-faced JSON and human formatted console output.
//!   - Strictly blocks expired leases from claiming active status without explicit renewal.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use fg_core::models::{
    LeaseStatus, ProjectLease, RegistrationOrigin, DEFAULT_PROJECT_MASTER_TTL_SECONDS,
};
use fg_topology::project_store::DiskProjectStore;
use fractal_git::constants::cli::CliTag;

use super::common::{fail_io, find_arg_value, print_json, reject, CliContext};

/// Returns the host system time in seconds since the UNIX epoch.
fn current_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Parses human-readable duration strings (e.g. "48h", "7d", "30m", "3600s", or plain seconds).
fn parse_duration_string(raw: &str) -> Option<u64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(hours) = trimmed
        .strip_suffix('h')
        .or_else(|| trimmed.strip_suffix('H'))
    {
        return hours
            .parse::<u64>()
            .ok()
            .map(|hours_val| hours_val.saturating_mul(3600));
    }
    if let Some(days) = trimmed
        .strip_suffix('d')
        .or_else(|| trimmed.strip_suffix('D'))
    {
        return days
            .parse::<u64>()
            .ok()
            .map(|days_val| days_val.saturating_mul(86400));
    }
    if let Some(mins) = trimmed
        .strip_suffix('m')
        .or_else(|| trimmed.strip_suffix('M'))
    {
        return mins
            .parse::<u64>()
            .ok()
            .map(|minutes_val| minutes_val.saturating_mul(60));
    }
    if let Some(secs) = trimmed
        .strip_suffix('s')
        .or_else(|| trimmed.strip_suffix('S'))
    {
        return secs.parse::<u64>().ok();
    }

    trimmed.parse::<u64>().ok()
}

/// Prints usage and options help for `taxis project`.
pub fn print_project_help() {
    println!(
        "Usage: taxis project <subcommand> [options]\n\n\
         Manage controlled project leases and hierarchical TTL.\n\n\
         Subcommands:\n\
           list, ls [--active-only]         List registered project leases\n\
           register, add <name> [options]   Register a project lease with TTL\n\
           touch <name>                     Update lease heartbeat\n\
           renew, unfreeze <name> [options] Renew and unfreeze a project lease\n\
           unregister, rm <name>            Unregister a project lease\n\
           evict, prune                     Purge expired and frozen leases\n\
           discover, sniff                  Discover workspace project candidates\n\
           show, inspect <name>             Inspect detailed lease metadata\n\
           -h, --help                       Show this help message"
    );
}

/// Dispatches the `taxis project` command.
pub fn handle_project(ctx: &CliContext) {
    if ctx.args.is_empty() {
        handle_list(ctx, &[]);
        return;
    }

    let subcmd = ctx.args[0].as_str();
    let rest_args = &ctx.args[1..];

    match subcmd {
        "list" | "ls" => handle_list(ctx, rest_args),
        "register" | "add" => handle_register(ctx, rest_args),
        "touch" => handle_touch(ctx, rest_args),
        "renew" | "unfreeze" => handle_renew(ctx, rest_args),
        "unregister" | "rm" | "remove" => handle_unregister(ctx, rest_args),
        "evict" | "prune" => handle_evict(ctx, rest_args),
        "discover" | "sniff" => handle_discover(ctx, rest_args),
        "show" | "inspect" => handle_show(ctx, rest_args),
        "-h" | "--help" | "help" => print_project_help(),
        other => reject(
            CliTag::ERROR,
            format!(
                "unknown project subcommand '{other}'; supported: list, register, touch, renew, unregister, evict, discover, show"
            ),
        ),
    }
}

/// Lists currently registered project leases with active/frozen status.
fn handle_list(ctx: &CliContext, args: &[String]) {
    let active_only = args
        .iter()
        .any(|arg| arg == "--active-only" || arg == "--active");
    let project_store = DiskProjectStore::new(&ctx.git_dir);
    let current_time_secs = current_now_secs();
    let workspace_root = ctx.git_dir.parent().unwrap_or_else(|| Path::new("."));

    let cache = match project_store.load_or_discover(Some(workspace_root), current_time_secs) {
        Ok(loaded_cache) => loaded_cache,
        Err(load_error) => fail_io("load project lease cache", load_error),
    };

    let mut project_list: Vec<&ProjectLease> = cache
        .leases
        .values()
        .filter(|lease| !active_only || lease.status == LeaseStatus::Active)
        .collect();

    project_list.sort_by(|left, right| left.id.cmp(&right.id));

    if ctx.json_mode {
        print_json(&project_list);
        return;
    }

    if project_list.is_empty() {
        println!("No controlled projects registered in active lease cache.");
        return;
    }

    println!(
        "{:<20} {:<10} {:<14} {:<10} {:<24}",
        "PROJECT ID", "STATUS", "REMAINING TTL", "COMMITS", "ROOT PATH"
    );
    println!(
        "{:-<20} {:-<10} {:-<14} {:-<10} {:-<24}",
        "", "", "", "", ""
    );

    for lease in project_list {
        let status_str = match lease.status {
            LeaseStatus::Active => "ACTIVE",
            LeaseStatus::Frozen => "FROZEN",
            LeaseStatus::Evicted => "EVICTED",
        };

        let remaining_secs = lease.remaining_ttl_seconds(current_time_secs);
        let remaining_str = if remaining_secs == 0 {
            "EXPIRED".to_string()
        } else if remaining_secs >= 86400 {
            format!("{:.1}d", remaining_secs as f64 / 86400.0)
        } else if remaining_secs >= 3600 {
            format!("{:.1}h", remaining_secs as f64 / 3600.0)
        } else {
            format!("{}s", remaining_secs)
        };

        println!(
            "{:<20} {:<10} {:<14} {:<10} {:<24}",
            lease.id, status_str, remaining_str, lease.commit_counter, lease.root_path
        );
    }
}

/// Registers a new controlled project lease into the active cache.
fn handle_register(ctx: &CliContext, args: &[String]) {
    let project_id = match args.first().filter(|arg| !arg.starts_with('-')) {
        Some(id) => id.as_str(),
        None => reject(
            CliTag::ERROR,
            "missing required project identifier: taxis project register <id> [--path <path>] [--ttl <duration>]",
        ),
    };

    let project_root_path = find_arg_value(args, &["--path", "-p"]).unwrap_or(project_id);
    let ttl_arg_str = find_arg_value(args, &["--ttl", "-t"]);
    let master_ttl_secs = ttl_arg_str
        .and_then(parse_duration_string)
        .unwrap_or(DEFAULT_PROJECT_MASTER_TTL_SECONDS);

    let project_store = DiskProjectStore::new(&ctx.git_dir);
    let current_time_secs = current_now_secs();

    let mut cache = match project_store.load_or_discover(None, current_time_secs) {
        Ok(loaded_cache) => loaded_cache,
        Err(load_error) => fail_io("load project lease cache", load_error),
    };

    let new_lease = ProjectLease::new(
        project_id,
        project_root_path,
        master_ttl_secs,
        RegistrationOrigin::CommandInteractive,
        current_time_secs,
    );

    cache.register(new_lease.clone());

    if let Err(save_err) = project_store.save(&cache) {
        fail_io("persist project lease", save_err);
    }

    if ctx.json_mode {
        print_json(&new_lease);
    } else {
        println!(
            "Registered controlled project '{}' at '{}' (TTL: {}s, Status: ACTIVE)",
            project_id, project_root_path, master_ttl_secs
        );
    }
}

/// Touches an active project lease to refresh its activity heartbeat and reset dormant counter.
fn handle_touch(ctx: &CliContext, args: &[String]) {
    let project_id = match args.first().filter(|arg| !arg.starts_with('-')) {
        Some(id) => id.as_str(),
        None => reject(CliTag::ERROR, "usage: taxis project touch <id>"),
    };

    let project_store = DiskProjectStore::new(&ctx.git_dir);
    let current_time_secs = current_now_secs();

    if let Err(touch_error) = project_store.touch_project(project_id, current_time_secs) {
        reject(CliTag::ERROR, format!("{touch_error}"));
    }

    if ctx.json_mode {
        println!("{{\"touched\": \"{project_id}\", \"status\": \"ACTIVE\"}}");
    } else {
        println!("Touched project '{project_id}': lease activity renewed.");
    }
}

/// Renews and unfreezes an expired or frozen project lease.
fn handle_renew(ctx: &CliContext, args: &[String]) {
    let project_id = match args.first().filter(|arg| !arg.starts_with('-')) {
        Some(id) => id.as_str(),
        None => reject(
            CliTag::ERROR,
            "usage: taxis project renew <id> [--ttl <duration>]",
        ),
    };

    let ttl_arg_str = find_arg_value(args, &["--ttl", "-t"]);
    let new_ttl = ttl_arg_str.and_then(parse_duration_string);

    let project_store = DiskProjectStore::new(&ctx.git_dir);
    let current_time_secs = current_now_secs();

    if let Err(renew_error) = project_store.renew_project(project_id, current_time_secs, new_ttl) {
        reject(CliTag::ERROR, format!("{renew_error}"));
    }

    if ctx.json_mode {
        println!("{{\"renewed\": \"{project_id}\", \"status\": \"ACTIVE\"}}");
    } else {
        println!("Renewed project '{project_id}': commit authorization unfrozen.");
    }
}

/// Unregisters a project lease from the active cache.
fn handle_unregister(ctx: &CliContext, args: &[String]) {
    let project_id = match args.first().filter(|arg| !arg.starts_with('-')) {
        Some(id) => id.as_str(),
        None => reject(CliTag::ERROR, "usage: taxis project unregister <id>"),
    };

    let project_store = DiskProjectStore::new(&ctx.git_dir);
    let current_time_secs = current_now_secs();

    match project_store.unregister_project(project_id, current_time_secs) {
        Ok(true) => {
            if ctx.json_mode {
                println!("{{\"unregistered\": \"{project_id}\"}}");
            } else {
                println!("Unregistered project '{project_id}' from active lease cache.");
            }
        }
        Ok(false) => {
            reject(
                CliTag::ERROR,
                format!("project '{project_id}' was not found in active lease cache"),
            );
        }
        Err(unregister_error) => fail_io("unregister project", unregister_error),
    }
}

/// Sweeps active projects, evicting frozen projects exceeding the dormant cycle threshold.
fn handle_evict(ctx: &CliContext, args: &[String]) {
    let threshold_parsed = find_arg_value(args, &["--threshold"])
        .and_then(|threshold_str| threshold_str.parse::<u32>().ok());
    let project_store = DiskProjectStore::new(&ctx.git_dir);
    let current_time_secs = current_now_secs();

    match project_store.sweep_evictions(current_time_secs, threshold_parsed) {
        Ok(evicted) => {
            if ctx.json_mode {
                print_json(&evicted);
            } else if evicted.is_empty() {
                println!("No expired project leases met eviction criteria.");
            } else {
                println!("Evicted {} dormant project lease(s):", evicted.len());
                for id in evicted {
                    println!("  - {id} (cold deregistered, source files untouched)");
                }
            }
        }
        Err(sweep_error) => fail_io("sweep project evictions", sweep_error),
    }
}

/// Triggers opportunistic project discovery across the workspace root.
fn handle_discover(ctx: &CliContext, _args: &[String]) {
    let project_store = DiskProjectStore::new(&ctx.git_dir);
    let current_time_secs = current_now_secs();
    let workspace_root = ctx.git_dir.parent().unwrap_or_else(|| Path::new("."));

    match project_store.load_or_discover(Some(workspace_root), current_time_secs) {
        Ok(cache) => {
            if ctx.json_mode {
                print_json(&cache);
            } else {
                println!("Discovery scan complete. Active registered projects:");
                for lease in cache.leases.values() {
                    println!(
                        "  - {:<20} ({:<18}) [{:?}]",
                        lease.id, lease.root_path, lease.status
                    );
                }
            }
        }
        Err(discovery_error) => fail_io("project discovery", discovery_error),
    }
}

/// Shows detailed metadata and sub-zones for a single project lease.
fn handle_show(ctx: &CliContext, args: &[String]) {
    let project_id = match args.first().filter(|arg| !arg.starts_with('-')) {
        Some(id) => id.as_str(),
        None => reject(CliTag::ERROR, "usage: taxis project show <id>"),
    };

    let project_store = DiskProjectStore::new(&ctx.git_dir);
    let current_time_secs = current_now_secs();

    let cache = match project_store.load_or_discover(None, current_time_secs) {
        Ok(loaded_cache) => loaded_cache,
        Err(load_error) => fail_io("load project lease cache", load_error),
    };

    match cache.get(project_id) {
        Some(lease) => {
            if ctx.json_mode {
                print_json(lease);
            } else {
                println!("Project:          {}", lease.id);
                println!("Root Path:        {}", lease.root_path);
                println!("Status:           {:?}", lease.status);
                println!("Registration:     {:?}", lease.origin);
                println!(
                    "Remaining TTL:    {}s",
                    lease.remaining_ttl_seconds(current_time_secs)
                );
                println!("Commit Count:     {}", lease.commit_counter);
                println!("Dormant Cycles:   {}", lease.dormant_cycles);
                println!("Path Jails:       {:?}", lease.path_jails);
                println!("Sub-Zones:        {}", lease.sub_zones.len());
            }
        }
        None => reject(
            CliTag::ERROR,
            format!("project '{project_id}' not found in active lease cache"),
        ),
    }
}
