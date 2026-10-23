//! Module: taxis_cmd::config — Repository Configuration Subset
//! File Path: src/bin/taxis_cmd/config.rs
//! Architecture Role: Supplies the handful of configuration values that change what `status` and
//!   `diff` report, read from the repository's own `config` file.
//! Dependencies & Triggers: Loaded by `RepoView::open`; read by the worktree comparison in `status`
//!   and by the worktree mode probe in `diff`.
//! Responsibilities: Parse `[section]` headers and `key = value` pairs, and expose `core.filemode`
//!   and `core.autocrlf` with Git's own defaults.
//! Exit Semantics & Design Rationale:
//!   - Only `core.filemode` and `core.autocrlf` are modelled. Neither is a stylistic choice: on a
//!     platform that cannot represent an executable bit, `git init` writes `filemode = false`, and
//!     with that set Git stops reporting an executable-bit change as a modification at all; and
//!     `autocrlf` decides what an unmarked path's line endings mean, which is the difference between
//!     hashing a file and hashing a normalised copy of it. A tool that ignored either would print
//!     ` M` for files Git calls clean.
//!   - The default is `true` for `filemode`, matching Git's compiled-in default. Deriving it from the
//!     platform instead would silently diverge for a repository created elsewhere and copied in,
//!     because the value Git honours is the one recorded in that repository, not the one this host
//!     would write. `autocrlf` defaults to `false` for the same reason.
//!   - An unreadable or malformed config is not an error. Git treats a missing `config` as "all
//!     defaults", and a repository cloned without one still works; failing here would make `status`
//!     refuse to describe a tree it can read perfectly well.
//!   - `include.path` is deliberately not followed. The setting this module reads is written by
//!     `git init` into the repository's own file, and following includes would mean resolving
//!     absolute paths outside the repository for a value that cannot legitimately live there.

use std::path::Path;

use fg_index::AutoCrlf;

/// The configuration values that change what a comparison reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RepoConfig {
    trust_executable_bit: bool,
    auto_crlf: AutoCrlf,
}

impl Default for RepoConfig {
    fn default() -> Self {
        Self {
            trust_executable_bit: true,
            auto_crlf: AutoCrlf::False,
        }
    }
}

impl RepoConfig {
    /// Reads the repository's `config` file, falling back to the defaults when it is absent.
    pub fn load(git_dir: &Path) -> Self {
        let text = match std::fs::read_to_string(git_dir.join("config")) {
            Ok(found) => found,
            Err(_) => return Self::default(),
        };
        Self::parse(&text)
    }

    /// Parses config text, honouring only the keys this build models.
    pub fn parse(text: &str) -> Self {
        let mut config = Self::default();
        let mut section = String::new();
        for raw in text.lines() {
            let line = strip_comment(raw).trim();
            if line.is_empty() {
                continue;
            }
            if let Some(name) = section_header(line) {
                section = name;
                continue;
            }
            if section != "core" {
                continue;
            }
            let (key, value) = split_entry(line);
            if key.eq_ignore_ascii_case("filemode") {
                config.trust_executable_bit = parse_bool(value).unwrap_or(true);
            }
            if key.eq_ignore_ascii_case("autocrlf") {
                config.auto_crlf = parse_autocrlf(value);
            }
        }
        config
    }

    /// Reports whether an executable-bit difference between the index and the worktree is a change.
    ///
    /// When false, the worktree mode is taken from the index rather than the filesystem, which is
    /// what Git's `ce_mode_from_stat` does with `trust_executable_bit` clear: it keeps the recorded
    /// bits and only fills in the file type.
    pub fn trust_executable_bit(&self) -> bool {
        self.trust_executable_bit
    }

    /// Returns `core.autocrlf`, which decides what an unmarked path's line endings mean.
    ///
    /// The value is three-valued rather than a boolean because `input` and `true` differ on checkout
    /// even though they agree on hashing; collapsing them would be a loss the moment this engine
    /// learns to write a worktree.
    pub fn auto_crlf(&self) -> AutoCrlf {
        self.auto_crlf
    }
}

/// Parses `core.autocrlf`, which accepts `input` alongside the boolean spellings.
///
/// An unrecognised value falls back to `false`, matching `read_convert_config`, which warns and keeps
/// the previous setting. Guessing `true` would convert line endings the repository never asked for.
fn parse_autocrlf(value: Option<&str>) -> AutoCrlf {
    let text = match value {
        Some(found) => found.trim_matches('"'),
        None => return AutoCrlf::True,
    };
    if text.eq_ignore_ascii_case("input") {
        return AutoCrlf::Input;
    }
    match parse_bool(Some(text)) {
        Some(true) => AutoCrlf::True,
        _ => AutoCrlf::False,
    }
}

/// Removes a trailing `#` or `;` comment that is not inside a quoted value.
fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut quoted = false;
    for (index, byte) in bytes.iter().enumerate() {
        match byte {
            b'"' => quoted = !quoted,
            b'\\' if quoted => {}
            b'#' | b';' if !quoted => return &line[..index],
            _ => {}
        }
    }
    line
}

/// Returns the lowercased section name when `line` is a `[section]` or `[section "sub"]` header.
///
/// A subsection is folded into the name (`core "alias"` becomes `core.alias`) because that is how Git
/// spells the resulting key. Keeping only `core` would let `[core "alias"] filemode = false` disable
/// executable-bit tracking for the whole repository, which no Git does.
fn section_header(line: &str) -> Option<String> {
    let inner = line.strip_prefix('[')?.strip_suffix(']')?;
    match inner.split_once(char::is_whitespace) {
        Some((head, tail)) => {
            let subsection = tail.trim().trim_matches('"');
            Some(format!("{}.{subsection}", head.to_ascii_lowercase()))
        }
        None => Some(inner.to_ascii_lowercase()),
    }
}

/// Splits `key = value` into its two halves, treating a bare key as an implicit `true`.
fn split_entry(line: &str) -> (&str, Option<&str>) {
    match line.split_once('=') {
        Some((key, value)) => (key.trim(), Some(value.trim())),
        None => (line.trim(), None),
    }
}

/// Parses Git's boolean spellings.
///
/// A bare key means true, and an empty or `false`-family value means false. Returning `None` for
/// anything else lets the caller keep the default rather than invent an answer, because Git rejects
/// an unparsable boolean with an error and continuing with the documented default is the closest
/// faithful behaviour available without a full config error channel.
fn parse_bool(value: Option<&str>) -> Option<bool> {
    let text = match value {
        Some(found) => found.trim_matches('"'),
        None => return Some(true),
    };
    if text.is_empty() {
        return Some(false);
    }
    match text.to_ascii_lowercase().as_str() {
        "true" | "yes" | "on" => Some(true),
        "false" | "no" | "off" => Some(false),
        other => other.parse::<i64>().ok().map(|number| number != 0),
    }
}

#[cfg(test)]
mod tests {
    use super::RepoConfig;
    use fg_index::AutoCrlf;

    #[test]
    fn an_absent_setting_keeps_the_compiled_in_default() {
        let config = RepoConfig::parse("[core]\n\trepositoryformatversion = 0\n");
        assert!(config.trust_executable_bit());
    }

    #[test]
    fn filemode_false_disables_executable_bit_tracking() {
        let config = RepoConfig::parse("[core]\n\tfilemode = false\n");
        assert!(!config.trust_executable_bit());
    }

    #[test]
    fn a_bare_filemode_key_means_true() {
        let config = RepoConfig::parse("[core]\n\tfilemode\n");
        assert!(config.trust_executable_bit());
    }

    #[test]
    fn numeric_boolean_spellings_are_understood() {
        assert!(!RepoConfig::parse("[core]\nfilemode = 0\n").trust_executable_bit());
        assert!(RepoConfig::parse("[core]\nfilemode = 1\n").trust_executable_bit());
    }

    #[test]
    fn a_trailing_comment_is_not_part_of_the_value() {
        let config = RepoConfig::parse("[core]\nfilemode = false ; set by git init\n");
        assert!(!config.trust_executable_bit());
    }

    #[test]
    fn the_key_is_matched_case_insensitively() {
        let config = RepoConfig::parse("[Core]\n\tFileMode = false\n");
        assert!(!config.trust_executable_bit());
    }

    #[test]
    fn a_subsection_header_does_not_activate_core() {
        let config = RepoConfig::parse("[core \"alias\"]\n\tfilemode = false\n");
        assert!(config.trust_executable_bit());
    }

    #[test]
    fn a_setting_outside_the_core_section_is_ignored() {
        let config = RepoConfig::parse("[status]\n\tfilemode = false\n");
        assert!(config.trust_executable_bit());
    }

    #[test]
    fn autocrlf_defaults_to_false_when_absent() {
        let config = RepoConfig::parse("[core]\n\trepositoryformatversion = 0\n");
        assert_eq!(config.auto_crlf(), AutoCrlf::False);
    }

    #[test]
    fn autocrlf_understands_input_as_its_own_value() {
        assert_eq!(
            RepoConfig::parse("[core]\n\tautocrlf = input\n").auto_crlf(),
            AutoCrlf::Input
        );
    }

    #[test]
    fn autocrlf_understands_the_boolean_spellings() {
        assert_eq!(
            RepoConfig::parse("[core]\n\tautocrlf = true\n").auto_crlf(),
            AutoCrlf::True
        );
        assert_eq!(
            RepoConfig::parse("[core]\n\tautocrlf = false\n").auto_crlf(),
            AutoCrlf::False
        );
    }

    #[test]
    fn an_unparsable_autocrlf_keeps_conversion_off() {
        assert_eq!(
            RepoConfig::parse("[core]\n\tautocrlf = sometimes\n").auto_crlf(),
            AutoCrlf::False
        );
    }
}
