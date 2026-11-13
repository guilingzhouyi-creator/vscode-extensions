//! Module: fg-gate — Git Hook Config & Path Discovery Helpers
//! File Path: crates/fg-gate/src/git_hook/config.rs
//! Architecture Role: Parses `[core]` hook policy switches from `.git/config` and checks hook
//!   file executability and path normalization for `GitHookRunner`.
//! Dependencies & Triggers: Internal submodule of `fg-gate::git_hook`; also supplies
//!   `read_core_authority_secret` to `fg-gate::authority`.
//! Responsibilities: Extract `core.hooksPath`, `core.taxishooks`, `core.taxishooktimeout`, and
//!   `core.authoritysecret` without following Git config includes.
//! Exit Semantics & Design Rationale: Missing or malformed config entries yield `None` / default
//!   policy without blocking callers.
//!
//! Domain Governance Rules: FGT-GAT-001 (hook contracts), FGT-COR-001.

use std::path::{Path, PathBuf};

/// Resolved `[core]` switches that influence whether user hooks participate.
#[derive(Debug, Default, Clone)]
pub(super) struct CoreHookSettings {
    pub(super) hooks_path: Option<String>,
    pub(super) enabled: Option<bool>,
    pub(super) timeout_millis: Option<u64>,
    pub(super) authority_secret: Option<String>,
}

/// Resolves the hooks directory from config, defaulting to `<git-dir>/hooks`.
pub(super) fn resolve_hooks_dir(work_root: &Path, git_dir: &Path) -> PathBuf {
    let configured = read_core_hook_settings(&git_dir.join("config"))
        .and_then(|settings| settings.hooks_path)
        .filter(|value| !value.is_empty());
    match configured {
        Some(configured) => {
            let candidate = PathBuf::from(&configured);
            if candidate.is_absolute() {
                candidate
            } else {
                work_root.join(candidate)
            }
        }
        None => git_dir.join("hooks"),
    }
}

/// Reads the supported `[core]` hook switches from a Git config file without following includes.
pub(super) fn read_core_hook_settings(config_path: &Path) -> Option<CoreHookSettings> {
    let contents = std::fs::read_to_string(config_path).ok()?;
    let mut settings = CoreHookSettings::default();
    let mut in_core_section = false;

    for raw_line in contents.lines() {
        let line = strip_config_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') {
            in_core_section = line.eq_ignore_ascii_case("[core]");
            continue;
        }
        if !in_core_section {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = unquote_config_value(value.trim());
        if key.eq_ignore_ascii_case("hookspath") {
            settings.hooks_path = Some(value);
        } else if key.eq_ignore_ascii_case("taxishooks") {
            settings.enabled = Some(parse_config_bool(&value));
        } else if key.eq_ignore_ascii_case("taxishooktimeout") {
            settings.timeout_millis = value.parse::<u64>().ok();
        } else if key.eq_ignore_ascii_case("authoritysecret") {
            settings.authority_secret = Some(value);
        }
    }

    Some(settings)
}

/// Reads the configured HMAC authority secret (`core.authoritysecret`).
///
/// Values may be 64 hex characters or at least 32 raw bytes; validation and the
/// fail-closed missing-secret verdict belong to [`fg_core::models::AuthoritySecret`].
pub fn read_core_authority_secret(config_path: &Path) -> Option<String> {
    read_core_hook_settings(config_path)
        .and_then(|settings| settings.authority_secret)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Interprets one Git boolean config value.
fn parse_config_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "yes" | "on" | "1"
    )
}

/// Removes a trailing Git config comment while honouring double-quoted values.
fn strip_config_comment(line: &str) -> &str {
    let mut inside_quotes = false;
    for (index, character) in line.char_indices() {
        match character {
            '"' => inside_quotes = !inside_quotes,
            '#' | ';' if !inside_quotes => return &line[..index],
            _ => {}
        }
    }
    line
}

/// Unwraps one double-quoted Git config value, leaving bare values untouched.
fn unquote_config_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        return trimmed[1..trimmed.len() - 1].replace("\\\"", "\"");
    }
    trimmed.to_string()
}

/// Reports whether a path is a hook Git would consider executable.
pub(super) fn hook_is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Converts a path to an absolute path anchored at the process working directory.
pub(super) fn absolutize(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }
    match std::env::current_dir() {
        Ok(current) => current.join(path),
        Err(_) => path,
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_config_bool, strip_config_comment, unquote_config_value};

    #[test]
    fn strips_comments_outside_quotes_only() {
        assert_eq!(
            strip_config_comment("  hooksPath = .githooks # note"),
            "  hooksPath = .githooks "
        );
        assert_eq!(
            strip_config_comment("hooksPath = \"a#b\""),
            "hooksPath = \"a#b\""
        );
    }

    #[test]
    fn unwraps_quoted_values() {
        assert_eq!(unquote_config_value("\".githooks\""), ".githooks");
        assert_eq!(unquote_config_value(".githooks"), ".githooks");
        assert_eq!(unquote_config_value("\"\""), "");
    }

    #[test]
    fn interprets_git_boolean_switches() {
        for enabled in ["true", "TRUE", "yes", "on", "1", " true "] {
            assert!(parse_config_bool(enabled), "{enabled} should enable hooks");
        }
        for disabled in ["false", "no", "off", "0", "", "maybe"] {
            assert!(
                !parse_config_bool(disabled),
                "{disabled} should disable hooks"
            );
        }
    }
}
