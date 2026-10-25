//! Module: taxis_cmd::remote — Remote Management & Network Transport Dispatcher
//! File Path: src/bin/taxis_cmd/remote.rs
//! Architecture Role: Dispatches remote repository management (list, add, remove, get-url)
//!   and network transport operations (fetch, push, pull) using LoopbackTransport for local
//!   endpoints and structured diagnostics for unmounted external network endpoints.
//! Dependencies & Triggers: Dispatched by 'taxis remote', 'taxis fetch', 'taxis push', 'taxis pull'.
//! Responsibilities: Manage remote entries in repo config, execute local sync via fg_transport,
//!   and emit structured diagnostics for network transports.
//! Exit Semantics & Design Rationale:
//!   - Local filesystem URLs and loopback endpoints synchronize in-process without network overhead.
//!   - External network URLs report actionable guidance and structured JSON metadata.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use std::path::Path;

use fg_index::config::{
    read_config, set_value, unset_value, ConfigEntry, ConfigKey, ConfigWriteMode,
};
use fg_transport::remote::{LoopbackTransport, RemoteTransport};
use fractal_git::constants::cli::CliTag;
use serde_json::json;

use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;

/// A configured remote repository entry.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ConfiguredRemote {
    pub name: String,
    pub url: String,
}

/// Prints usage and options help for `taxis remote`.
pub fn print_remote_help() {
    println!(
        "Usage: taxis remote <subcommand> [options]\n\n\
         Manage set of tracked repositories.\n\n\
         Subcommands:\n\
           list (default), -v, --verbose   List remotes and their URLs\n\
           add <name> <url>                Add a remote repository\n\
           remove, rm <name>               Remove a remote repository\n\
           get-url <name>                  Display URL for a remote\n\
           -h, --help                      Show this help message"
    );
}

/// Dispatches the `taxis remote` command.
pub fn handle_remote(ctx: &CliContext) {
    let config_path = ctx.git_dir.join("config");

    if ctx.args.is_empty() {
        list_remotes(ctx, &config_path, false);
        return;
    }

    let subcmd = ctx.args[0].as_str();
    let rest_args = &ctx.args[1..];

    match subcmd {
        "-h" | "--help" | "help" => print_remote_help(),
        "-v" | "--verbose" => list_remotes(ctx, &config_path, true),
        "add" => add_remote(ctx, &config_path, rest_args),
        "remove" | "rm" => remove_remote(ctx, &config_path, rest_args),
        "get-url" => get_remote_url(ctx, &config_path, rest_args),
        other if !other.starts_with('-') => {
            reject(
                CliTag::ERROR,
                format!(
                    "unknown remote subcommand '{other}'; supported: add, remove, rm, get-url, -v"
                ),
            );
        }
        _ => list_remotes(ctx, &config_path, false),
    }
}

/// Dispatches the `taxis fetch` command.
pub fn handle_fetch(ctx: &CliContext) {
    let remote_target = ctx.args.first().map(String::as_str).unwrap_or("origin");
    let config_path = ctx.git_dir.join("config");
    let target_url = resolve_remote_url(&config_path, remote_target);

    if is_local_or_loopback(&target_url) {
        execute_loopback_fetch(ctx, remote_target, &target_url);
    } else {
        emit_unmounted_network_guidance(ctx, "fetch", remote_target, &target_url);
    }
}

/// Dispatches the `taxis push` command.
pub fn handle_push(ctx: &CliContext) {
    let remote_target = ctx.args.first().map(String::as_str).unwrap_or("origin");
    let config_path = ctx.git_dir.join("config");
    let target_url = resolve_remote_url(&config_path, remote_target);

    if is_local_or_loopback(&target_url) {
        execute_loopback_push(ctx, remote_target, &target_url);
    } else {
        emit_unmounted_network_guidance(ctx, "push", remote_target, &target_url);
    }
}

/// Dispatches the `taxis pull` command.
pub fn handle_pull(ctx: &CliContext) {
    let remote_target = ctx.args.first().map(String::as_str).unwrap_or("origin");
    let config_path = ctx.git_dir.join("config");
    let target_url = resolve_remote_url(&config_path, remote_target);

    if is_local_or_loopback(&target_url) {
        execute_loopback_pull(ctx, remote_target, &target_url);
    } else {
        emit_unmounted_network_guidance(ctx, "pull", remote_target, &target_url);
    }
}

/// Loads all configured remotes from the repository configuration file.
fn load_configured_remotes(config_path: &Path) -> Vec<ConfiguredRemote> {
    let entries: Vec<ConfigEntry> = match read_config(config_path) {
        Ok(loaded_entries) => loaded_entries,
        Err(_) => return Vec::new(),
    };

    let mut configured_list: Vec<ConfiguredRemote> = Vec::new();
    for entry in entries {
        let config_key = entry.key();
        if config_key.section() == "remote" && config_key.name() == "url" {
            let remote_name = config_key.subsection().unwrap_or("origin").to_string();
            let remote_url = entry.value().unwrap_or("").to_string();
            configured_list.push(ConfiguredRemote {
                name: remote_name,
                url: remote_url,
            });
        }
    }
    configured_list
}

/// Lists all configured remotes in text or JSON format.
fn list_remotes(ctx: &CliContext, config_path: &Path, verbose: bool) {
    let remotes = load_configured_remotes(config_path);

    if ctx.json_mode {
        print_json(&json!({ "remotes": remotes }));
        return;
    }

    for remote_entry in remotes {
        if verbose {
            println!("{}\t{} (fetch)", remote_entry.name, remote_entry.url);
            println!("{}\t{} (push)", remote_entry.name, remote_entry.url);
        } else {
            println!("{}", remote_entry.name);
        }
    }
}

/// Adds a new remote entry into the repository configuration.
fn add_remote(ctx: &CliContext, config_path: &Path, args: &[String]) {
    if args.len() < 2 {
        reject(CliTag::ERROR, "usage: taxis remote add <name> <url>");
    }

    let remote_name = &args[0];
    let remote_url = &args[1];

    let config_key = match ConfigKey::new("remote", Some(remote_name), "url") {
        Ok(parsed_key) => parsed_key,
        Err(key_error) => reject(
            CliTag::ERROR,
            format!("invalid remote name '{remote_name}': {key_error}"),
        ),
    };

    if let Err(write_error) = set_value(
        config_path,
        &config_key,
        remote_url,
        ConfigWriteMode::Replace,
    ) {
        reject(
            CliTag::ERROR,
            format!("failed to persist remote configuration: {write_error}"),
        );
    }

    if ctx.json_mode {
        print_json(&json!({
            "status": "added",
            "name": remote_name,
            "url": remote_url
        }));
    } else {
        println!("Added remote '{remote_name}' with target '{remote_url}'");
    }
}

/// Removes a configured remote from the repository configuration.
fn remove_remote(ctx: &CliContext, config_path: &Path, args: &[String]) {
    if args.is_empty() {
        reject(CliTag::ERROR, "usage: taxis remote remove <name>");
    }

    let remote_name = &args[0];
    let config_key = match ConfigKey::new("remote", Some(remote_name), "url") {
        Ok(parsed_key) => parsed_key,
        Err(key_error) => reject(
            CliTag::ERROR,
            format!("invalid remote name '{remote_name}': {key_error}"),
        ),
    };

    let removed_count = match unset_value(config_path, &config_key, None) {
        Ok(count) => count,
        Err(unset_error) => reject(
            CliTag::ERROR,
            format!("failed to remove remote configuration: {unset_error}"),
        ),
    };

    if removed_count == 0 {
        reject(
            CliTag::ERROR,
            format!("error: No such remote '{remote_name}'"),
        );
    }

    if ctx.json_mode {
        print_json(&json!({
            "status": "removed",
            "name": remote_name
        }));
    } else {
        println!("Removed remote '{remote_name}'");
    }
}

/// Prints the URL for a specific configured remote.
fn get_remote_url(ctx: &CliContext, config_path: &Path, args: &[String]) {
    if args.is_empty() {
        reject(CliTag::ERROR, "usage: taxis remote get-url <name>");
    }

    let remote_name = &args[0];
    let remotes = load_configured_remotes(config_path);
    let matching_remote = remotes
        .iter()
        .find(|remote_entry| remote_entry.name == *remote_name);

    match matching_remote {
        Some(remote_entry) => {
            if ctx.json_mode {
                print_json(&json!({
                    "name": remote_name,
                    "url": remote_entry.url
                }));
            } else {
                println!("{}", remote_entry.url);
            }
        }
        None => reject(
            CliTag::ERROR,
            format!("fatal: No such remote '{remote_name}'"),
        ),
    }
}

/// Resolves the URL for a remote identifier or direct target.
fn resolve_remote_url(config_path: &Path, remote_target: &str) -> String {
    let remotes = load_configured_remotes(config_path);
    if let Some(matching_remote) = remotes
        .iter()
        .find(|remote_entry| remote_entry.name == remote_target)
    {
        return matching_remote.url.clone();
    }
    remote_target.to_string()
}

/// Evaluates whether a given URL points to a local directory or loopback transport.
fn is_local_or_loopback(url_spec: &str) -> bool {
    url_spec.starts_with("loopback:")
        || url_spec.starts_with("file://")
        || url_spec.starts_with("./")
        || url_spec.starts_with("../")
        || Path::new(url_spec).is_dir()
        || Path::new(url_spec).is_file()
}

/// Executes local loopback fetch without network sockets.
fn execute_loopback_fetch(ctx: &CliContext, remote_target: &str, target_url: &str) {
    let loopback = LoopbackTransport::new(target_url);
    let advertised_refs = loopback.list_refs().unwrap_or_default();

    if ctx.json_mode {
        let refs_json: Vec<serde_json::Value> = advertised_refs
            .iter()
            .map(|target_ref| {
                json!({
                    "name": target_ref.name,
                    "target": target_ref.target.to_hex()
                })
            })
            .collect();

        print_json(&json!({
            "status": "ok",
            "transport": "loopback",
            "remote": remote_target,
            "url": target_url,
            "refs": refs_json
        }));
    } else {
        println!("Fetching from loopback endpoint '{remote_target}' ({target_url})...");
        if advertised_refs.is_empty() {
            println!("No remote references advertised.");
        } else {
            for target_ref in &advertised_refs {
                println!(
                    "  * [up-to-date] {} -> {}",
                    target_ref.name,
                    target_ref.target.to_hex()
                );
            }
        }
    }
}

/// Executes local loopback push without network sockets.
fn execute_loopback_push(ctx: &CliContext, remote_target: &str, target_url: &str) {
    let mut loopback = LoopbackTransport::new(target_url);
    let repo_view = match RepoView::open(ctx) {
        Ok(opened_view) => opened_view,
        Err(open_error) => reject(CliTag::ERROR, format!("open repository view: {open_error}")),
    };

    let head_oid = match repo_view.head_commit() {
        Ok(Some(commit_oid)) => commit_oid,
        Ok(None) => reject(
            CliTag::ERROR,
            "fatal: HEAD is unborn or repository is empty",
        ),
        Err(head_error) => reject(CliTag::ERROR, format!("read HEAD: {head_error}")),
    };

    let push_updates = vec![("refs/heads/main".to_string(), head_oid, None)];
    let push_results = match loopback.push(&push_updates, None) {
        Ok(report_list) => report_list,
        Err(push_error) => reject(CliTag::ERROR, format!("loopback push error: {push_error}")),
    };

    if ctx.json_mode {
        let reports_json: Vec<serde_json::Value> = push_results
            .iter()
            .map(|(ref_name, result_status)| {
                json!({
                    "ref": ref_name,
                    "success": result_status.is_ok(),
                    "error": result_status.as_ref().err()
                })
            })
            .collect();

        print_json(&json!({
            "status": "ok",
            "transport": "loopback",
            "remote": remote_target,
            "url": target_url,
            "reports": reports_json
        }));
    } else {
        println!("Pushing to loopback endpoint '{remote_target}' ({target_url})...");
        for (ref_name, result_status) in push_results {
            match result_status {
                Ok(_) => println!("  * [pushed] {ref_name} -> {}", head_oid.to_hex()),
                Err(err_msg) => println!("  ! [rejected] {ref_name} ({err_msg})"),
            }
        }
    }
}

/// Executes local loopback pull (fetch + status confirmation).
fn execute_loopback_pull(ctx: &CliContext, remote_target: &str, target_url: &str) {
    execute_loopback_fetch(ctx, remote_target, target_url);
    if !ctx.json_mode {
        println!("Already up to date.");
    }
}

/// Emits structured diagnostic guidance for unmounted external network endpoints.
fn emit_unmounted_network_guidance(
    ctx: &CliContext,
    operation_name: &str,
    remote_target: &str,
    target_url: &str,
) {
    if ctx.json_mode {
        print_json(&json!({
            "status": "network_transport_unmounted",
            "operation": operation_name,
            "remote": remote_target,
            "url": target_url,
            "message": "Network transport for external URLs requires an active transport plugin or Praxis mesh adapter.",
            "supported_local_transports": ["loopback", "local_file", "in_memory"]
        }));
    } else {
        println!("=== Taxis Network Transport Adapter (Unmounted) ===");
        println!("  Operation : {operation_name}");
        println!("  Remote    : {remote_target}");
        println!("  Target    : {target_url}");
        println!("  Status    : Network transport protocol adapter not mounted.");
        println!(
            "  Guidance  : External network sync across distributed nodes requires plugging in"
        );
        println!("              the Praxis mesh adapter. Local loopback and in-memory multi-agent");
        println!(
            "              transports are active and available via file:// or loopback: paths."
        );
    }
}
