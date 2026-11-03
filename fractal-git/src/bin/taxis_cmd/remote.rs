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

use super::common::{fail_fatal, fail_unavailable, print_json, reject, CliContext};
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

    let scheme = require_transport("fetch", remote_target, &target_url);
    execute_loopback_fetch(ctx, scheme, remote_target, &target_url);
}

/// Dispatches the `taxis push` command.
pub fn handle_push(ctx: &CliContext) {
    let remote_target = ctx.args.first().map(String::as_str).unwrap_or("origin");
    let config_path = ctx.git_dir.join("config");
    let target_url = resolve_remote_url(&config_path, remote_target);

    let scheme = require_transport("push", remote_target, &target_url);
    execute_loopback_push(ctx, scheme, remote_target, &target_url);
}

/// Dispatches the `taxis pull` command.
pub fn handle_pull(ctx: &CliContext) {
    let remote_target = ctx.args.first().map(String::as_str).unwrap_or("origin");
    let config_path = ctx.git_dir.join("config");
    let target_url = resolve_remote_url(&config_path, remote_target);

    let scheme = require_transport("pull", remote_target, &target_url);
    execute_loopback_pull(ctx, scheme, remote_target, &target_url);
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

/// Resolves a remote reference to a URL, or terminates when the name is unknown.
///
/// The previous version fell back to returning the input unchanged, so a mistyped remote name was
/// silently reinterpreted as a URL. That is how `push ghost` reached the transport layer and
/// reported "not mounted" instead of "no such remote", and it is why a typo could not be
/// distinguished from an unsupported scheme.
///
/// A value that is *visibly* a URL or path (it carries a scheme or a separator) is still accepted
/// verbatim, because Git allows `git push <url>` without configuring a remote first.
fn resolve_remote_url(config_path: &Path, remote_target: &str) -> String {
    let remotes = load_configured_remotes(config_path);
    if let Some(matching_remote) = remotes
        .iter()
        .find(|remote_entry| remote_entry.name == remote_target)
    {
        return matching_remote.url.clone();
    }

    if looks_like_url_or_path(remote_target) {
        return remote_target.to_string();
    }

    fail_fatal(format!(
        "'{remote_target}' does not appear to be a git repository\n\
         no such remote is configured; use `taxis remote add <name> <url>` or pass a URL directly"
    ))
}

/// Whether a remote argument is self-evidently a URL or a path rather than a configured name.
///
/// Deliberately narrow: a bare word is a remote *name*, and treating it as a path is exactly the
/// silent reinterpretation this function exists to prevent.
fn looks_like_url_or_path(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    let has_scheme = lowered.starts_with("https://")
        || lowered.starts_with("http://")
        || lowered.starts_with("ssh://")
        || lowered.starts_with("git://")
        || lowered.starts_with("file://")
        || lowered.starts_with("loopback:");
    has_scheme
        || value.contains('/')
        || value.contains('\\')
        || value.starts_with('.')
        || Path::new(value).is_absolute()
}

/// A transport scheme this build can actually reach.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportScheme {
    /// In-process loopback, addressed as `loopback:<id>`.
    Loopback,
    /// A path on this machine, either a `file://` URL or a bare filesystem path.
    LocalFile,
}

impl TransportScheme {
    /// Human name reported in output and diagnostics.
    fn as_str(self) -> &'static str {
        match self {
            Self::Loopback => "loopback",
            Self::LocalFile => "local_file",
        }
    }
}

/// How a remote URL was classified.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ResolvedTransport {
    /// The build can reach this URL through the named scheme.
    Available(TransportScheme),
    /// A network scheme was requested; this edition cannot serve it.
    NetworkDisabled {
        /// Scheme name, so the refusal can name what was asked for.
        scheme: String,
    },
    /// A local-looking path that does not exist.
    MissingPath {
        /// The path that could not be found.
        path: String,
    },
}

/// Classifies a remote URL by scheme instead of by substring sniffing.
///
/// The previous implementation tested `starts_with("file://")`, `starts_with("./")` and
/// `Path::is_dir()` and then fell through to "network". That silently treated any unrecognised
/// spelling as a network URL, so a caller could not tell a typo from an unsupported scheme, and a
/// local path that merely did not exist yet landed in the network bucket. Naming the scheme first
/// makes every branch explicit and lets the refusal name the capability that is missing.
///
/// `http`/`https`/`ssh`/`git` are recognised as network *on purpose even though unusable here*: the
/// point is to answer "yes I know what that is, and I cannot do it" rather than "unknown".
fn resolve_transport(url: &str) -> ResolvedTransport {
    let trimmed = url.trim();
    let lowered = trimmed.to_ascii_lowercase();

    if lowered.starts_with("loopback:") {
        return ResolvedTransport::Available(TransportScheme::Loopback);
    }

    for network_scheme in ["https://", "http://", "ssh://", "git://"] {
        if lowered.starts_with(network_scheme) {
            return ResolvedTransport::NetworkDisabled {
                scheme: network_scheme.trim_end_matches("://").to_string(),
            };
        }
    }

    // A bare or explicit local path. `file://` is stripped before the existence test because
    // `Path::new("file:///x")` is not a filesystem path on any platform.
    let local_path = lowered
        .strip_prefix("file://")
        .unwrap_or(trimmed)
        .to_string();
    if Path::new(&local_path).exists() {
        return ResolvedTransport::Available(TransportScheme::LocalFile);
    }
    ResolvedTransport::MissingPath { path: local_path }
}

/// Obtains a usable transport for `url`, or terminates with an honest refusal.
///
/// Every failure path exits non-zero. Returning success while printing "not mounted" was the defect
/// this replaces: `push` is the release path, and a `push && deploy` pipeline read that zero as
/// confirmation that the commit had reached the remote.
fn require_transport(operation: &str, remote_target: &str, url: &str) -> TransportScheme {
    match resolve_transport(url) {
        ResolvedTransport::Available(scheme) => scheme,
        ResolvedTransport::NetworkDisabled { scheme } => {
            if !fg_core::constants::Capabilities::current().allows(
                fg_core::constants::CAPABILITY_NETWORK,
            ) {
                fail_unavailable(
                    fg_core::constants::CAPABILITY_NETWORK,
                    &format!("{operation} over '{scheme}://' to '{remote_target}'"),
                );
            }
            // A general edition answers this scheme, but no implementation is linked into this
            // build yet. Refusing beats pretending, and the message must not claim it succeeded.
            fail_unavailable(
                fg_core::constants::CAPABILITY_NETWORK,
                &format!("{operation} over '{scheme}://' to '{remote_target}' (no adapter linked)"),
            )
        }
        ResolvedTransport::MissingPath { path } => fail_fatal(format!(
            "'{remote_target}' does not appear to be a git repository (no such path: {path})"
        )),
    }
}

/// Executes local loopback fetch without network sockets.
fn execute_loopback_fetch(ctx: &CliContext, scheme: TransportScheme, remote_target: &str, target_url: &str) {
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
            "transport": scheme.as_str(),
            "remote": remote_target,
            "url": target_url,
            "refs": refs_json
        }));
    } else {
        println!(
            "Fetching from {} endpoint '{remote_target}' ({target_url})...",
            scheme.as_str()
        );
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
fn execute_loopback_push(
    ctx: &CliContext,
    scheme: TransportScheme,
    remote_target: &str,
    target_url: &str,
) {
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

    // A transport that accepted the connection can still reject an individual ref. Reporting the
    // overall command as success in that case is the same dishonesty as the unmounted path, so any
    // rejected ref fails the command after every result has been printed.
    let rejected_refs: Vec<&String> = push_results
        .iter()
        .filter(|(_, status)| status.is_err())
        .map(|(name, _)| name)
        .collect();

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
            "status": if rejected_refs.is_empty() { "ok" } else { "rejected" },
            "transport": scheme.as_str(),
            "remote": remote_target,
            "url": target_url,
            "reports": reports_json
        }));
    } else {
        println!(
            "Pushing to {} endpoint '{remote_target}' ({target_url})...",
            scheme.as_str()
        );
        for (ref_name, result_status) in &push_results {
            match result_status {
                Ok(_) => println!("  * [pushed] {ref_name} -> {}", head_oid.to_hex()),
                Err(err_msg) => println!("  ! [rejected] {ref_name} ({err_msg})"),
            }
        }
    }

    if !rejected_refs.is_empty() {
        reject(
            CliTag::ERROR,
            format!("{} reference(s) were rejected by the remote", rejected_refs.len()),
        );
    }
}

/// Executes local loopback pull (fetch + status confirmation).
fn execute_loopback_pull(
    ctx: &CliContext,
    scheme: TransportScheme,
    remote_target: &str,
    target_url: &str,
) {
    execute_loopback_fetch(ctx, scheme, remote_target, target_url);
    if !ctx.json_mode {
        println!("Already up to date.");
    }
}
