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

use super::common::{
    fail_fatal, fail_unavailable, fail_usage, print_json, reject, CliContext, EXIT_UNAVAILABLE,
};
use super::repo_view::RepoView;

/// Reports that network transport is disabled in this edition, emitting `fallback_hint` JSON when requested.
pub(crate) fn fail_network_unavailable(
    ctx: &CliContext,
    operation: &str,
    url: &str,
    fallback_hint: &str,
) -> ! {
    let edition = fg_core::constants::Edition::CURRENT;
    let capability = fg_core::constants::CAPABILITY_NETWORK;
    if ctx.json_mode {
        fg_core::diag_debug!(
            "capability",
            "refused '{}' on '{}' because '{}' is disabled in the {} edition",
            operation,
            url,
            capability,
            edition.as_str()
        );
        print_json(&json!({
            "engine": "taxis",
            "operation": operation,
            "status": "unavailable",
            "capability": capability,
            "edition": edition.as_str(),
            "url": url,
            "fallback_hint": fallback_hint,
            "error": format!(
                "'{operation}' requires the '{capability}' capability, which the {} edition does not provide.",
                edition.as_str()
            ),
        }));
        std::process::exit(EXIT_UNAVAILABLE)
    }
    eprintln!("  url: {url}");
    eprintln!("  fallback_hint: {fallback_hint}");
    fail_unavailable(capability, operation)
}

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
        "set-url" => super::remote_upstream::set_remote_url(ctx, &config_path, rest_args),
        other if other.starts_with('-') => {
            fail_usage(format!("unknown option `{other}` for `remote`"));
        }
        other => {
            reject(
                CliTag::ERROR,
                format!(
                    "unknown remote subcommand '{other}'; supported: add, remove, rm, get-url, set-url, -v"
                ),
            );
        }
    }
}

/// Dispatches the `taxis fetch` command.
pub fn handle_fetch(ctx: &CliContext) {
    let mut fetch_all = false;
    let mut positional: Vec<&str> = Vec::new();
    for arg in &ctx.args {
        match arg.as_str() {
            "--all" => fetch_all = true,
            "-p" | "--prune" | "-q" | "--quiet" | "-v" | "--verbose" | "-f" | "--force"
            | "--tags" | "-n" | "--no-tags" => {}
            other if other.starts_with('-') => {
                fail_usage(format!("unknown option `{other}` for `fetch`"));
            }
            other => positional.push(other),
        }
    }

    let config_path = ctx.git_dir.join("config");
    if fetch_all {
        let remotes = load_configured_remotes(&config_path);
        if remotes.is_empty() {
            fail_fatal("no remotes configured for fetch --all");
        }
        for remote_entry in &remotes {
            let scheme = require_transport(ctx, "fetch", &remote_entry.name, &remote_entry.url);
            execute_loopback_fetch(ctx, scheme, &remote_entry.name, &remote_entry.url);
        }
        return;
    }

    let remote_target = positional.first().copied().unwrap_or("origin");
    let target_url = resolve_remote_url(&config_path, remote_target);
    let scheme = require_transport(ctx, "fetch", remote_target, &target_url);
    execute_loopback_fetch(ctx, scheme, remote_target, &target_url);
}

/// Dispatches the `taxis push` command.
pub fn handle_push(ctx: &CliContext) {
    let mut dry_run = false;
    let mut force = false;
    let mut set_upstream = false;
    let mut positional: Vec<String> = Vec::new();
    for arg in &ctx.args {
        match arg.as_str() {
            "-n" | "--dry-run" => dry_run = true,
            "-f" | "--force" => force = true,
            "-u" | "--set-upstream" => set_upstream = true,
            other if other.starts_with('-') => {
                reject(CliTag::ERROR, format!("push: unknown option '{other}'"));
            }
            other => positional.push(other.to_string()),
        }
    }
    let remote_target = positional.first().map(String::as_str).unwrap_or("origin");
    let refspecs: &[String] = if positional.len() > 1 {
        &positional[1..]
    } else {
        &[]
    };
    let config_path = ctx.git_dir.join("config");
    let target_url = resolve_remote_url(&config_path, remote_target);

    let scheme = require_transport(ctx, "push", remote_target, &target_url);
    if scheme == TransportScheme::LocalFile && !dry_run {
        if let Some(dest_git_dir) = super::remote_sync::resolve_source_git_dir(&target_url) {
            super::remote_sync::sync_local_repository_push(&super::remote_sync::LocalPushParams {
                ctx,
                dest_git_dir: &dest_git_dir,
                remote_target,
                target_url: &target_url,
                refspecs,
                force,
            });
            if set_upstream {
                super::remote_upstream::configure_upstream_tracking(ctx, remote_target, refspecs);
            }
            return;
        }
    }
    execute_loopback_push(ctx, scheme, remote_target, &target_url, refspecs, dry_run);
    if set_upstream && !dry_run {
        super::remote_upstream::configure_upstream_tracking(ctx, remote_target, refspecs);
    }
}

/// Dispatches the `taxis pull` command.
pub fn handle_pull(ctx: &CliContext) {
    let mut merge_flags: Vec<String> = Vec::new();
    let mut positional: Vec<&str> = Vec::new();
    for arg in &ctx.args {
        match arg.as_str() {
            "--ff-only" | "--no-ff" => merge_flags.push(arg.clone()),
            "--rebase" | "--ff" | "-q" | "--quiet" | "-v" | "--verbose" | "-f" | "--force"
            | "--no-rebase" => {}
            other if other.starts_with('-') => {
                fail_usage(format!("unknown option `{other}` for `pull`"));
            }
            other => positional.push(other),
        }
    }
    let remote_target = positional.first().copied().unwrap_or("origin");
    let config_path = ctx.git_dir.join("config");
    let target_url = resolve_remote_url(&config_path, remote_target);

    let scheme = require_transport(ctx, "pull", remote_target, &target_url);
    execute_loopback_pull_with_flags(ctx, scheme, remote_target, &target_url, &merge_flags);
}

/// Loads all configured remotes from the repository configuration file.
pub(crate) fn load_configured_remotes(config_path: &Path) -> Vec<ConfiguredRemote> {
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

/// Whether a URL looks like an SCP-style SSH remote (`[user@]host:path`) rather than a Windows drive path.
pub(crate) fn looks_like_scp_remote(value: &str) -> bool {
    let bytes = value.as_bytes();
    let is_windows_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    !is_windows_drive
        && !value.starts_with('/')
        && !value.starts_with('.')
        && value.contains('@')
        && value.contains(':')
        && !Path::new(value).exists()
}

/// Strips `file://` (handling Windows `file:///C:/...` leading slash) while keeping original path case.
pub(crate) fn strip_file_url_prefix(trimmed: &str) -> &str {
    let Some(rest) = trimmed
        .strip_prefix("file://")
        .or_else(|| trimmed.strip_prefix("FILE://"))
    else {
        return trimmed;
    };
    if cfg!(windows) {
        let bytes = rest.as_bytes();
        if bytes.len() >= 3
            && bytes[0] == b'/'
            && bytes[1].is_ascii_alphabetic()
            && bytes[2] == b':'
        {
            return &rest[1..];
        }
    }
    rest
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
        || looks_like_scp_remote(value)
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
    if looks_like_scp_remote(trimmed) {
        return ResolvedTransport::NetworkDisabled {
            scheme: "ssh".to_string(),
        };
    }

    let local_path = strip_file_url_prefix(trimmed).to_string();
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
fn require_transport(
    ctx: &CliContext,
    operation: &str,
    remote_target: &str,
    url: &str,
) -> TransportScheme {
    match resolve_transport(url) {
        ResolvedTransport::Available(scheme) => scheme,
        ResolvedTransport::NetworkDisabled { .. } => {
            let hint = format!(
                "Run native `git {operation} {remote_target}` when online, or configure a local path / `file://` mirror or bundle."
            );
            fail_network_unavailable(ctx, operation, url, &hint);
        }
        ResolvedTransport::MissingPath { path } => fail_fatal(format!(
            "'{remote_target}' does not appear to be a git repository (no such path: {path})"
        )),
    }
}

/// Executes local loopback fetch without network sockets.
fn execute_loopback_fetch(
    ctx: &CliContext,
    scheme: TransportScheme,
    remote_target: &str,
    target_url: &str,
) {
    if scheme == TransportScheme::LocalFile {
        if let Some(src_git) = super::remote_sync::resolve_source_git_dir(target_url) {
            super::remote_sync::sync_local_repository_fetch(
                ctx,
                &src_git,
                remote_target,
                target_url,
            );
            return;
        }
    }
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
    refspecs: &[String],
    dry_run: bool,
) {
    let mut loopback = LoopbackTransport::new(target_url);
    let repo_view = match RepoView::open(ctx) {
        Ok(opened_view) => opened_view,
        Err(open_error) => reject(CliTag::ERROR, format!("open repository view: {open_error}")),
    };

    let (effective_ref, head_oid) = match repo_view.effective_head_commit() {
        Ok(Some(resolved)) => resolved,
        Ok(None) => reject(
            CliTag::ERROR,
            "fatal: HEAD is unborn or repository is empty",
        ),
        Err(head_error) => reject(CliTag::ERROR, format!("read HEAD: {head_error}")),
    };

    let mut push_updates = Vec::new();
    if refspecs.is_empty() {
        push_updates.push(("refs/heads/main".to_string(), head_oid, None));
        if effective_ref != "refs/heads/main" && effective_ref != "HEAD" {
            push_updates.push((effective_ref, head_oid, None));
        }
    } else {
        for spec in refspecs {
            let clean = spec.strip_prefix('+').unwrap_or(spec.as_str());
            let dst = clean.split_once(':').map(|(_, d)| d).unwrap_or(clean);
            let full_dst = if dst.starts_with("refs/") {
                dst.to_string()
            } else {
                format!("refs/heads/{dst}")
            };
            push_updates.push((full_dst, head_oid, None));
        }
    }

    let push_results = match loopback.push(&push_updates, None) {
        Ok(report_list) => report_list,
        Err(push_error) => reject(CliTag::ERROR, format!("loopback push error: {push_error}")),
    };

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
            "dry_run": dry_run,
            "reports": reports_json
        }));
    } else {
        let prefix = if dry_run { "[dry-run] " } else { "" };
        println!(
            "{prefix}Pushing to {} endpoint '{remote_target}' ({target_url})...",
            scheme.as_str()
        );
        let tag = if dry_run { "[dry-run]" } else { "[pushed]" };
        for (ref_name, result_status) in &push_results {
            match result_status {
                Ok(_) => println!("  * {tag} {ref_name} -> {}", head_oid.to_hex()),
                Err(err_msg) => println!("  ! [rejected] {ref_name} ({err_msg})"),
            }
        }
    }

    if !rejected_refs.is_empty() {
        reject(
            CliTag::ERROR,
            format!(
                "{} reference(s) were rejected by the remote",
                rejected_refs.len()
            ),
        );
    }
}

/// Executes local loopback pull (fetch + status confirmation or fast-forward).
fn execute_loopback_pull_with_flags(
    ctx: &CliContext,
    scheme: TransportScheme,
    remote_target: &str,
    target_url: &str,
    merge_flags: &[String],
) {
    execute_loopback_fetch(ctx, scheme, remote_target, target_url);
    if scheme == TransportScheme::LocalFile {
        let fetch_head = ctx.git_dir.join("FETCH_HEAD");
        if fetch_head.is_file() {
            if try_pull_into_unborn_head(ctx, &fetch_head) {
                return;
            }
            let mut merge_args = Vec::with_capacity(1 + merge_flags.len());
            merge_args.push("FETCH_HEAD".to_string());
            merge_args.extend(merge_flags.iter().cloned());
            let merge_ctx = CliContext {
                git_dir: ctx.git_dir.clone(),
                args: merge_args,
                json_mode: ctx.json_mode,
            };
            super::merge::handle_merge(&merge_ctx);
            return;
        }
    }
    if !ctx.json_mode {
        println!("Already up to date.");
    }
}

/// Fast-forwards an unborn repository directly to the first commit listed in `FETCH_HEAD`.
fn try_pull_into_unborn_head(ctx: &CliContext, fetch_head_path: &Path) -> bool {
    let Ok(view) = RepoView::open(ctx) else {
        return false;
    };
    if view.head_commit().ok().flatten().is_some() {
        return false;
    }
    if let Ok(Some((_, eff_oid))) = view.effective_head_commit() {
        let branch = view
            .head_branch()
            .ok()
            .flatten()
            .map(|(n, _)| n)
            .unwrap_or_else(|| "main".to_string());
        super::checkout::update_references(
            view.git_dir(),
            view.work_root(),
            eff_oid,
            Some(&branch),
        );
        return false;
    }
    let Ok(content) = std::fs::read_to_string(fetch_head_path) else {
        return false;
    };
    let Some(first_hex) = content.split_whitespace().next() else {
        return false;
    };
    let Ok(target_oid) = fg_core::models::Oid::from_hex(first_hex) else {
        return false;
    };
    let Ok(files) = super::tree_view::flatten_commit_tree(&view, &target_oid) else {
        return false;
    };
    let index_entries = super::checkout::materialize_files(&view, &files);
    super::checkout::update_dirc_index(view.git_dir(), &index_entries);
    let branch = view
        .head_branch()
        .ok()
        .flatten()
        .map(|(n, _)| n)
        .unwrap_or_else(|| "main".to_string());
    super::checkout::update_references(view.git_dir(), view.work_root(), target_oid, Some(&branch));
    if fg_gate::BranchGovernanceFloor::resolve(view.git_dir()).tier
        != fg_core::models::BranchEnforcementTier::Strict
        && branch == "main"
    {
        let cell_ref = view
            .git_dir()
            .join(format!(
                "refs/fractal/cell/{}",
                fg_core::constants::policy::DEFAULT_CELL_ID
            ))
            .join(&branch);
        if let Some(parent) = cell_ref.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(cell_ref, format!("{}\n", target_oid.to_hex()));
    }

    if !ctx.json_mode {
        println!(
            "Fast-forward (initial pull -> {})",
            &target_oid.to_hex()[..8]
        );
    }
    true
}
