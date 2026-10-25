//! Module: fg-index — Repository Configuration Subset
//! File Path: crates/fg-index/src/config.rs
//! Architecture Role: Parses Git configuration files ('core.filemode', 'core.autocrlf', 'conflict.mode')
//!   with a faithful section/subsection/quoting model and updates single entries atomically.
//! Dependencies & Triggers: Consumed by status, diff, merge, checkout, submodule wiring and 'taxis config'.
//! Responsibilities: Parse Git config syntax, expose modelled keys through [RepoConfig], read any
//!   entry by [ConfigKey], and rewrite one entry while preserving the unrelated bytes of the file.
//! Exit Semantics & Design Rationale:
//!   - [ConfigError] separates a rejected key or value from an I/O failure, so a caller can refuse
//!     bad input without implying the repository is damaged.
//!   - Writes are surgical: comments, blank lines, key order, CRLF/LF style and the trailing-newline
//!     state survive, and the rendered text is re-parsed before the temporary file is renamed.
//!   - A failed write leaves the original config untouched: nothing is renamed until verification
//!     passes, and every temporary file is removed on every error path.

use std::fmt;
use std::io;
use std::path::Path;

use fg_core::models::ConflictPresentationMode;

use crate::attributes::AutoCrlf;
use crate::config_format::{
    atomic_replace, collect_entries, count_entries, escape_quoted, normalize_name_component,
    parse_file, read_text, render_file, rewrite_entries, unescape_quoted_text, verify_rewrite,
    ParsedKind,
};

/// A Git configuration key: a section, an optional subsection, and a variable name.
///
/// Section and variable names are normalized to ASCII lower case because Git reads them
/// case-insensitively, while a subsection keeps its original bytes: [submodule "Lib"] and
/// [submodule "lib"] name different entries.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ConfigKey {
    section: String,
    subsection: Option<String>,
    name: String,
}

impl ConfigKey {
    /// Builds a key from its three parts, validating what Git's parser accepts.
    pub fn new(section: &str, subsection: Option<&str>, name: &str) -> Result<Self, ConfigError> {
        let section = normalize_name_component(section, "section")?;
        let name = normalize_name_component(name, "variable")?;
        let subsection = match subsection {
            Some(value) => Some(validate_subsection(value)?),
            None => None,
        };
        Ok(Self {
            section,
            subsection,
            name,
        })
    }

    /// Parses a section[.subsection].name specification.
    ///
    /// Git splits at the first and the last dot, so everything between them is the subsection and
    /// a dotted subsection survives. A subsection written with surrounding quotes is unescaped the
    /// way [section "subsection"] is, which lets submodule."q".url address the entry Git lists
    /// as submodule.q.url.
    pub fn parse(spec: &str) -> Result<Self, ConfigError> {
        let first_dot = spec.find('.').ok_or_else(|| {
            ConfigError::InvalidKey(format!("'{spec}' is missing a section separator"))
        })?;
        let last_dot = spec.rfind('.').unwrap_or(first_dot);
        let section = &spec[..first_dot];
        let name = &spec[last_dot + 1..];
        let subsection = if last_dot > first_dot {
            Some(parse_subsection_segment(&spec[first_dot + 1..last_dot])?)
        } else {
            None
        };
        Self::new(section, subsection.as_deref(), name)
    }

    /// Builds a key from a section argument in the older section-only form, such as remote "origin".
    ///
    /// Call sites created before [ConfigKey] existed pass the header text itself; accepting it
    /// keeps their public API intact while the structured model takes over internally.
    pub fn from_section_spec(section_spec: &str, name: &str) -> Result<Self, ConfigError> {
        let trimmed = section_spec.trim();
        let inner = trimmed
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
            .unwrap_or(trimmed);
        if let Some(index) = inner.find(char::is_whitespace) {
            let head = &inner[..index];
            let tail = inner[index..].trim();
            let subsection = parse_subsection_segment(tail)?;
            return Self::new(head, Some(&subsection), name);
        }
        if let Some((head, subsection)) = inner.split_once('.') {
            return Self::new(head, Some(subsection), name);
        }
        Self::new(inner, None, name)
    }

    /// Returns the lower-case section name.
    pub fn section(&self) -> &str {
        &self.section
    }

    /// Returns the subsection exactly as written inside the header quotes, if any.
    pub fn subsection(&self) -> Option<&str> {
        self.subsection.as_deref()
    }

    /// Returns the lower-case variable name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Renders the key in section[.subsection].name form for diagnostics and --list.
    pub fn to_dotted(&self) -> String {
        match &self.subsection {
            Some(subsection) => format!("{}.{}.{}", self.section, subsection, self.name),
            None => format!("{}.{}", self.section, self.name),
        }
    }

    /// Renders the header line that owns this key, quoting the subsection Git-style.
    pub fn section_header(&self) -> String {
        match &self.subsection {
            Some(subsection) => format!("[{} \"{}\"]", self.section, escape_quoted(subsection)),
            None => format!("[{}]", self.section),
        }
    }
}

/// One entry stored in a config file: a [ConfigKey] and its raw value.
///
/// value == None marks the bare-key form (a name on its own line), which Git treats as the
/// implicit boolean true even though --get prints an empty line for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigEntry {
    pub(crate) key: ConfigKey,
    pub(crate) value: Option<String>,
}

impl ConfigEntry {
    /// Returns the key addressed by this entry.
    pub fn key(&self) -> &ConfigKey {
        &self.key
    }

    /// Returns the raw value; None marks the bare-key form.
    pub fn value(&self) -> Option<&str> {
        self.value.as_deref()
    }

    /// Returns the dotted key form used by --list and diagnostics.
    pub fn dotted_key(&self) -> String {
        self.key.to_dotted()
    }
}

/// How a write treats a key that already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigWriteMode {
    /// Replace the first matching entry, drop duplicates, and append when absent.
    Replace,
    /// Append one more value, leaving every existing entry in place (git config --add).
    Add,
}

/// Failure while reading, parsing, validating or atomically replacing a config file.
#[derive(Debug)]
pub enum ConfigError {
    /// A key, section, subsection or value Git would reject.
    InvalidKey(String),
    /// The file could not be read or replaced.
    Io(io::Error),
    /// The rendered text did not survive a re-parse, so the edit would corrupt the file.
    Verify(String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidKey(detail) => write!(formatter, "invalid config key: {detail}"),
            Self::Io(error) => write!(formatter, "config I/O failed: {error}"),
            Self::Verify(detail) => write!(formatter, "config write verification failed: {detail}"),
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for ConfigError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// The configuration values that change what a comparison or merge reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RepoConfig {
    trust_executable_bit: bool,
    auto_crlf: AutoCrlf,
    conflict_mode: ConflictPresentationMode,
}

impl Default for RepoConfig {
    fn default() -> Self {
        Self {
            trust_executable_bit: true,
            auto_crlf: AutoCrlf::False,
            conflict_mode: ConflictPresentationMode::AgentAlgebraic,
        }
    }
}

impl RepoConfig {
    /// Reads the repository's config file, falling back to the defaults when it is absent.
    pub fn load(git_dir: &Path) -> Self {
        let text = match std::fs::read_to_string(git_dir.join("config")) {
            Ok(found) => found,
            Err(_) => return Self::default(),
        };
        Self::parse(&text)
    }

    /// Parses config text, honouring modelled keys.
    pub fn parse(text: &str) -> Self {
        let mut config = Self::default();
        for entry in collect_entries(&parse_file(text)) {
            let key = entry.key();
            match (key.section(), key.subsection(), key.name()) {
                ("core", None, "filemode") => {
                    config.trust_executable_bit = parse_bool(entry.value()).unwrap_or(true);
                }
                ("core", None, "autocrlf") => {
                    config.auto_crlf = parse_autocrlf(entry.value());
                }
                ("conflict", None, "mode") => {
                    if let Some(text) = entry.value() {
                        if let Some(mode) = ConflictPresentationMode::parse_str(text) {
                            config.conflict_mode = mode;
                        }
                    }
                }
                _ => {}
            }
        }
        config
    }

    /// Reports whether an executable-bit difference between the index and the worktree is a change.
    pub fn trust_executable_bit(&self) -> bool {
        self.trust_executable_bit
    }

    /// Returns core.autocrlf, which decides what an unmarked path's line endings mean.
    pub fn auto_crlf(&self) -> AutoCrlf {
        self.auto_crlf
    }

    /// Returns conflict.mode, determining presentation of unmerged stages in working tree.
    pub fn conflict_mode(&self) -> ConflictPresentationMode {
        self.conflict_mode
    }
}

/// Reads every entry in path, in file order; a missing file is empty rather than an error.
pub fn read_config(path: &Path) -> Result<Vec<ConfigEntry>, ConfigError> {
    let text = read_text(path)?.unwrap_or_default();
    Ok(collect_entries(&parse_file(&text)))
}

/// Returns the last value stored for key (Git's --get precedence).
///
/// None means the key is absent; a present bare key yields Some("") because that is what
/// Git prints for it.
pub fn read_value(path: &Path, key: &ConfigKey) -> Result<Option<String>, ConfigError> {
    let entries = read_config(path)?;
    Ok(entries
        .iter()
        .rev()
        .find(|entry| entry.key == *key)
        .map(|entry| entry.value.clone().unwrap_or_default()))
}

/// Writes value under key, replacing or appending according to mode.
///
/// The file is re-parsed and verified before the temporary file is renamed over it, and a missing
/// file is created together with its section header.
pub fn set_value(
    path: &Path,
    key: &ConfigKey,
    value: &str,
    mode: ConfigWriteMode,
) -> Result<(), ConfigError> {
    let existing_text = read_text(path)?.unwrap_or_default();
    let before = parse_file(&existing_text);
    let rendered = render_file(
        &rewrite_entries(&before, key, value, mode),
        before.trailing_newline || before.lines.is_empty(),
    );
    verify_rewrite(&before, &rendered, key, value, mode)?;
    atomic_replace(path, rendered.as_bytes())
}

/// Removes entries matching key (and, when given, the literal value), returning how many went.
pub fn unset_value(
    path: &Path,
    key: &ConfigKey,
    literal: Option<&str>,
) -> Result<usize, ConfigError> {
    let Some(existing_text) = read_text(path)? else {
        return Ok(0);
    };
    let before = parse_file(&existing_text);
    let mut kept: Vec<(String, bool)> = Vec::with_capacity(before.lines.len());
    let mut removed = 0usize;
    for line in &before.lines {
        if let ParsedKind::Entry {
            key: entry_key,
            value,
            ..
        } = &line.kind
        {
            let matches_value = literal.is_none_or(|expected| value.as_deref() == Some(expected));
            if entry_key == key && matches_value {
                removed += 1;
                continue;
            }
        }
        kept.push((line.text.clone(), line.crlf));
    }
    if removed == 0 {
        return Ok(0);
    }
    let rendered = render_file(&kept, before.trailing_newline);
    let after = parse_file(&rendered);
    if count_entries(&after, key, literal) + removed != count_entries(&before, key, literal) {
        return Err(ConfigError::Verify(format!(
            "removing '{}' did not shrink the matching-entry count",
            key.to_dotted()
        )));
    }
    atomic_replace(path, rendered.as_bytes())?;
    Ok(removed)
}

/// Updates or appends a key = value entry under a section header.
///
/// Kept for the pre-[ConfigKey] call sites (repository init and submodule wiring); new code
/// should use [set_value] so that section and variable are validated together.
pub fn write_config_entry(
    config_path: &Path,
    section: &str,
    key: &str,
    value: &str,
) -> io::Result<()> {
    let structured = ConfigKey::from_section_spec(section, key).map_err(config_error_to_io)?;
    set_value(config_path, &structured, value, ConfigWriteMode::Replace).map_err(config_error_to_io)
}

fn config_error_to_io(error: ConfigError) -> io::Error {
    match error {
        ConfigError::Io(io_error) => io_error,
        other => io::Error::new(io::ErrorKind::InvalidData, other.to_string()),
    }
}

/// Parses core.autocrlf, which accepts input alongside boolean spellings.
fn parse_autocrlf(value: Option<&str>) -> AutoCrlf {
    let Some(text) = value else {
        return AutoCrlf::True;
    };
    if text.eq_ignore_ascii_case("input") {
        return AutoCrlf::Input;
    }
    match parse_bool(Some(text)) {
        Some(true) => AutoCrlf::True,
        _ => AutoCrlf::False,
    }
}

/// Parses Git's boolean spellings, keeping the historical treatment of a bare key as true.
fn parse_bool(value: Option<&str>) -> Option<bool> {
    let Some(text) = value else {
        return Some(true);
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

fn validate_subsection(raw: &str) -> Result<String, ConfigError> {
    if raw
        .chars()
        .any(|character| matches!(character, '\n' | '\r' | '\0'))
    {
        return Err(ConfigError::InvalidKey(
            "subsection may not contain a newline or NUL".to_string(),
        ));
    }
    Ok(raw.to_string())
}

/// Parses one dotted-key middle segment, unescaping surrounding quotes when present.
fn parse_subsection_segment(segment: &str) -> Result<String, ConfigError> {
    let trimmed = segment.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if let Some(quoted) = trimmed.strip_prefix('"') {
        let body = quoted.strip_suffix('"').ok_or_else(|| {
            ConfigError::InvalidKey(format!("unterminated quote in subsection '{segment}'"))
        })?;
        return unescape_quoted_text(body).ok_or_else(|| {
            ConfigError::InvalidKey(format!("invalid escape in subsection '{segment}'"))
        });
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::{ConfigKey, ConfigWriteMode, RepoConfig};
    use crate::attributes::AutoCrlf;
    use crate::config_format::{
        collect_entries, parse_file, render_entry, render_file, rewrite_entries, ParsedKind,
    };
    use fg_core::models::ConflictPresentationMode;

    fn write_via_rewrite(
        original: &str,
        key: &ConfigKey,
        value: &str,
        mode: ConfigWriteMode,
    ) -> String {
        let before = parse_file(original);
        render_file(
            &rewrite_entries(&before, key, value, mode),
            before.trailing_newline || before.lines.is_empty(),
        )
    }

    #[test]
    fn an_absent_setting_keeps_the_compiled_in_default() {
        let config = RepoConfig::parse("[core]\n\trepositoryformatversion = 0\n");
        assert!(config.trust_executable_bit());
        assert_eq!(
            config.conflict_mode(),
            ConflictPresentationMode::AgentAlgebraic
        );
    }

    #[test]
    fn conflict_mode_parsing() {
        let config = RepoConfig::parse("[conflict]\n\tmode = git-compat\n");
        assert_eq!(config.conflict_mode(), ConflictPresentationMode::GitCompat);

        let config_diff3 = RepoConfig::parse("[conflict]\n\tmode = diff3\n");
        assert_eq!(
            config_diff3.conflict_mode(),
            ConflictPresentationMode::Diff3
        );
    }

    #[test]
    fn filemode_false_disables_executable_bit_tracking() {
        let config = RepoConfig::parse("[core]\n\tfilemode = false\n");
        assert!(!config.trust_executable_bit());
    }

    #[test]
    fn autocrlf_understands_input_as_its_own_value() {
        assert_eq!(
            RepoConfig::parse("[core]\n\tautocrlf = input\n").auto_crlf(),
            AutoCrlf::Input
        );
    }

    #[test]
    fn dotted_keys_split_at_the_first_and_last_dot() {
        let plain = ConfigKey::parse("core.filemode").expect("plain key");
        assert_eq!(plain.section(), "core");
        assert_eq!(plain.subsection(), None);
        assert_eq!(plain.name(), "filemode");

        let nested = ConfigKey::parse("submodule.libs.engine.url").expect("nested key");
        assert_eq!(nested.section(), "submodule");
        assert_eq!(nested.subsection(), Some("libs.engine"));
        assert_eq!(nested.name(), "url");

        let quoted = ConfigKey::parse("submodule.\"q\".url").expect("quoted subsection");
        assert_eq!(quoted.subsection(), Some("q"));
        assert_eq!(quoted.section_header(), "[submodule \"q\"]");

        assert!(ConfigKey::parse("no-separator").is_err());
        assert!(ConfigKey::parse("bad key.x").is_err());
    }

    #[test]
    fn section_headers_quote_and_escape_subsections() {
        let key = ConfigKey::new("submodule", Some("a\"b\\c"), "url").expect("key");
        assert_eq!(key.section_header(), "[submodule \"a\\\"b\\\\c\"]");
    }

    #[test]
    fn values_needing_quotes_survive_parse_round_trips() {
        let samples = [
            "plain", "a b", " a ", "a#b", "a;b", "a\"b", "a\\b", "a\nb", "a\tb", "",
        ];
        for sample in samples {
            let rendered = render_entry("", &ConfigKey::parse("core.k").expect("key"), sample, "");
            let document = format!("[core]\n\t{}\n", rendered.trim());
            let file = parse_file(&document);
            let entries = collect_entries(&file);
            assert_eq!(entries.len(), 1, "document was {document:?}");
            assert_eq!(
                entries[0].value(),
                Some(sample),
                "document was {document:?}"
            );
        }
    }

    #[test]
    fn replacing_a_key_keeps_comments_blank_lines_and_order() {
        let original = "[core]\n\tfilemode = true\n# keep this comment\n\tautocrlf = input\n";
        let key = ConfigKey::parse("core.filemode").expect("key");
        let rendered = write_via_rewrite(original, &key, "false", ConfigWriteMode::Replace);
        assert_eq!(
            rendered,
            "[core]\n\tfilemode = false\n# keep this comment\n\tautocrlf = input\n"
        );
    }

    #[test]
    fn replacing_a_duplicate_collapses_it_to_one_entry() {
        let original = "[core]\n\tfilemode = true\n\tfilemode = false\n";
        let key = ConfigKey::parse("core.filemode").expect("key");
        let rendered = write_via_rewrite(original, &key, "true", ConfigWriteMode::Replace);
        assert_eq!(rendered, "[core]\n\tfilemode = true\n");
    }

    #[test]
    fn adding_a_value_appends_without_touching_existing_entries() {
        let original = "[core]\n\tfilemode = true\n";
        let key = ConfigKey::parse("core.filemode").expect("key");
        let rendered = write_via_rewrite(original, &key, "false", ConfigWriteMode::Add);
        assert_eq!(rendered, "[core]\n\tfilemode = true\n\tfilemode = false\n");
    }

    #[test]
    fn a_missing_section_is_appended_with_its_header() {
        let original = "[core]\n\tfilemode = true\n";
        let key = ConfigKey::parse("conflict.mode").expect("key");
        let rendered = write_via_rewrite(original, &key, "diff3", ConfigWriteMode::Replace);
        assert_eq!(
            rendered,
            "[core]\n\tfilemode = true\n\n[conflict]\n\tmode = diff3\n"
        );
    }

    #[test]
    fn crlf_files_keep_crlf_line_endings() {
        let original = "[core]\r\n\tfilemode = true\r\n";
        let key = ConfigKey::parse("core.filemode").expect("key");
        let rendered = write_via_rewrite(original, &key, "false", ConfigWriteMode::Replace);
        assert_eq!(rendered, "[core]\r\n\tfilemode = false\r\n");
    }

    #[test]
    fn bare_keys_parse_as_implicit_true() {
        let file = parse_file("[core]\n\tbare\n\tset = value\n");
        let entries = collect_entries(&file);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].value(), None);
        assert_eq!(entries[1].value(), Some("value"));
        let kinds = file
            .lines
            .iter()
            .filter(|line| matches!(line.kind, ParsedKind::Entry { .. }))
            .count();
        assert_eq!(kinds, 2);
    }
}
