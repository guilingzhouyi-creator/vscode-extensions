//! Module: taxis_cmd::config — Repository Configuration CLI Dispatcher
//! File Path: src/bin/taxis_cmd/config.rs
//! Architecture Role: CLI dispatcher for 'taxis config', wrapping the structured fg-index
//!   configuration model (sections, subsections, quoting, atomic single-entry rewrites).
//! Dependencies & Triggers: Dispatched by 'taxis config'.
//! Responsibilities: Provide --list, --get, --get-all, --add, --unset and plain key/value
//!   updates across any section, including dotted subsection specs such as submodule."q".url.
//! Exit Semantics & Design Rationale:
//!   - A missing value exits 1 and garbage input exits 1, matching git config --get.
//!   - An --unset that matched nothing exits 5, which is the status git config --unset uses
//!     to mean "the key was not there", so wrappers can branch on it.
//!   - A rejected conflict.mode value never reaches the file; validation happens before the
//!     rewrite, and a failed rewrite reports [CONFIG_WRITE_INVALID] instead of leaving a
//!     half-written config behind.

use std::process::exit;

use fg_core::models::ConflictPresentationMode;
use fg_index::config::{
    read_config, read_value, set_value, unset_value, ConfigError, ConfigKey, ConfigWriteMode,
};
pub use fg_index::config::{write_config_entry, RepoConfig};
use fractal_git::constants::cli::CliTag;

use super::common::{fail_io, fail_usage, print_json, reject, CliContext, EXIT_REJECTED};

/// The operation a 'taxis config' invocation asks for.
#[derive(Debug)]
enum ConfigAction {
    /// Print every entry in file order.
    List,
    /// Print the last value stored for one key.
    Get(String),
    /// Print every value stored for one key.
    GetAll(String),
    /// Write one value, replacing or appending, in the requested mode.
    Set {
        spec: String,
        value: String,
        mode: ConfigWriteMode,
    },
    /// Remove every entry matching the key, optionally restricted to one literal value.
    Unset {
        spec: String,
        literal: Option<String>,
    },
}

/// Git's status for --unset matching no entry.
const EXIT_NO_MATCH: i32 = 5;

/// Dispatches the 'taxis config' command.
pub fn handle_config(ctx: &CliContext) {
    let action = parse_action(&ctx.args);
    let config_path = ctx.git_dir.join("config");
    match action {
        ConfigAction::List => run_list(ctx, &config_path),
        ConfigAction::Get(spec) => run_get(&config_path, &spec),
        ConfigAction::GetAll(spec) => run_get_all(&config_path, &spec),
        ConfigAction::Set { spec, value, mode } => run_set(ctx, &config_path, &spec, &value, mode),
        ConfigAction::Unset { spec, literal } => {
            run_unset(ctx, &config_path, &spec, literal.as_deref())
        }
    }
}

/// Parses the argument vector into one [ConfigAction], refusing unknown flags.
fn parse_action(args: &[String]) -> ConfigAction {
    let mut list = false;
    let mut wants_get = false;
    let mut wants_get_all = false;
    let mut wants_add = false;
    let mut wants_unset = false;
    let mut positional: Vec<&str> = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        match arg {
            "--list" | "-l" => list = true,
            "--get" => wants_get = true,
            "--get-all" => wants_get_all = true,
            "--add" => wants_add = true,
            "--unset" => wants_unset = true,
            "--replace-all" => {}
            other if other.starts_with('-') => {
                reject(CliTag::ERROR, format!("unknown config flag '{other}'"));
            }
            other => positional.push(other),
        }
        index += 1;
    }

    if list {
        return ConfigAction::List;
    }
    if wants_get {
        return match positional.first() {
            Some(spec) => ConfigAction::Get((*spec).to_string()),
            None => fail_usage("taxis config --get <key>"),
        };
    }
    if wants_get_all {
        return match positional.first() {
            Some(spec) => ConfigAction::GetAll((*spec).to_string()),
            None => fail_usage("taxis config --get-all <key>"),
        };
    }
    if wants_unset {
        return match positional.first() {
            Some(spec) => ConfigAction::Unset {
                spec: (*spec).to_string(),
                literal: positional.get(1).map(|value| (*value).to_string()),
            },
            None => fail_usage("taxis config --unset <key> [<value>]"),
        };
    }
    if wants_add {
        return match (positional.first(), positional.get(1)) {
            (Some(spec), Some(value)) => ConfigAction::Set {
                spec: (*spec).to_string(),
                value: (*value).to_string(),
                mode: ConfigWriteMode::Add,
            },
            _ => fail_usage("taxis config --add <key> <value>"),
        };
    }
    match (positional.first(), positional.get(1)) {
        (Some(spec), Some(value)) => ConfigAction::Set {
            spec: (*spec).to_string(),
            value: (*value).to_string(),
            mode: ConfigWriteMode::Replace,
        },
        (Some(spec), None) => ConfigAction::Get((*spec).to_string()),
        _ => fail_usage("taxis config [--list] [--get <key>] [--add] [--unset] [<key> [<value>]]"),
    }
}

/// Parses a key specification or terminates with the same status git uses for a bad key.
fn resolve_key(spec: &str) -> ConfigKey {
    match ConfigKey::parse(spec) {
        Ok(key) => key,
        Err(error) => reject(CliTag::ERROR, format!("invalid config key: {error}")),
    }
}

/// Refuses a conflict.mode value the presentation engine cannot honour.
fn validate_conflict_mode(key: &ConfigKey, value: &str) {
    let is_conflict_mode =
        key.section() == "conflict" && key.subsection().is_none() && key.name() == "mode";
    if is_conflict_mode && ConflictPresentationMode::parse_str(value).is_none() {
        reject(
            CliTag::ERROR,
            format!(
                "invalid conflict mode '{value}'; expected agent-algebraic, git-compat, or diff3"
            ),
        );
    }
}

/// Prints every entry in file order, bare keys without a separator exactly like git --list.
fn run_list(ctx: &CliContext, config_path: &std::path::Path) {
    let entries = match read_config(config_path) {
        Ok(entries) => entries,
        Err(error) => report_config_error("read configuration", error),
    };
    if ctx.json_mode {
        let rendered: Vec<serde_json::Value> = entries
            .iter()
            .map(|entry| {
                serde_json::json!({
                    "key": entry.dotted_key(),
                    "value": entry.value(),
                })
            })
            .collect();
        print_json(&rendered);
        return;
    }
    for entry in entries {
        match entry.value() {
            Some(value) => println!("{}={}", entry.dotted_key(), value),
            None => println!("{}", entry.dotted_key()),
        }
    }
}

/// Prints the last value for one key; a bare key prints an empty line and an absent key exits 1.
fn run_get(config_path: &std::path::Path, spec: &str) {
    let key = resolve_key(spec);
    let stored = match read_value(config_path, &key) {
        Ok(stored) => stored,
        Err(error) => report_config_error("read configuration", error),
    };
    match stored {
        Some(value) => println!("{value}"),
        None => exit(EXIT_REJECTED),
    }
}

/// Prints every value for one key in file order; no match exits 1 like git --get-all.
fn run_get_all(config_path: &std::path::Path, spec: &str) {
    let key = resolve_key(spec);
    let entries = match read_config(config_path) {
        Ok(entries) => entries,
        Err(error) => report_config_error("read configuration", error),
    };
    let mut found = false;
    for entry in entries.iter().filter(|entry| entry.key() == &key) {
        println!("{}", entry.value().unwrap_or_default());
        found = true;
    }
    if !found {
        exit(EXIT_REJECTED);
    }
}

/// Writes one entry, reporting a verification failure with its dedicated tag.
fn run_set(
    ctx: &CliContext,
    config_path: &std::path::Path,
    spec: &str,
    value: &str,
    mode: ConfigWriteMode,
) {
    let key = resolve_key(spec);
    validate_conflict_mode(&key, value);
    if let Err(error) = set_value(config_path, &key, value, mode) {
        report_config_error("write configuration", error);
    }
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "updated",
            "key": key.to_dotted(),
            "value": value,
        }));
    }
}

/// Removes matching entries; nothing removed exits 5 so callers see git's --unset contract.
fn run_unset(ctx: &CliContext, config_path: &std::path::Path, spec: &str, literal: Option<&str>) {
    let key = resolve_key(spec);
    let removed = match unset_value(config_path, &key, literal) {
        Ok(removed) => removed,
        Err(error) => report_config_error("write configuration", error),
    };
    if removed == 0 {
        exit(EXIT_NO_MATCH);
    }
    if ctx.json_mode {
        print_json(&serde_json::json!({
            "status": "unset",
            "key": key.to_dotted(),
            "removed": removed,
        }));
    }
}

/// Terminates with EXIT_FATAL, tagging a failed self-verification so operators can spot it.
fn report_config_error(action: &str, error: ConfigError) -> ! {
    match error {
        ConfigError::Verify(detail) => {
            eprintln!("[CONFIG_WRITE_INVALID] {detail}");
            exit(EXIT_REJECTED)
        }
        ConfigError::InvalidKey(detail) => reject(CliTag::ERROR, detail),
        ConfigError::Io(io_error) => fail_io(action, io_error),
    }
}
