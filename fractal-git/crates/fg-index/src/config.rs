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

use std::ffi::OsString;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

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
    /// Reads Git's configuration sequence: system, user, then the repository file.
    ///
    /// Git resolves core.autocrlf, core.filemode and conflict.mode from a merge of those layers,
    /// so reading <git_dir>/config alone misreads a clean CRLF worktree as dirty whenever the
    /// user's ~/.gitconfig sets core.autocrlf = true.
    pub fn load(git_dir: &Path) -> Self {
        Self::load_with_layers(git_dir, &config_layers(git_dir))
    }

    /// Loads the listed files in order, expanding include.path in place.
    fn load_with_layers(git_dir: &Path, layers: &[PathBuf]) -> Self {
        let mut config = Self::default();
        let mut include_stack = Vec::new();
        for path in layers {
            apply_config_file(path, git_dir, 0, &mut include_stack, &mut config);
        }
        config
    }

    /// Parses config text, honouring modelled keys.
    pub fn parse(text: &str) -> Self {
        let mut config = Self::default();
        for entry in collect_entries(&parse_file(text)) {
            config.apply_entry(entry.key(), entry.value());
        }
        config
    }

    /// Applies one entry; a later occurrence overrides an earlier one exactly as Git does.
    fn apply_entry(&mut self, key: &ConfigKey, value: Option<&str>) {
        match (key.section(), key.subsection(), key.name()) {
            ("core", None, "filemode") => {
                self.trust_executable_bit = parse_bool(value).unwrap_or(true);
            }
            ("core", None, "autocrlf") => {
                self.auto_crlf = parse_autocrlf(value);
            }
            ("conflict", None, "mode") => {
                if let Some(text) = value {
                    if let Some(mode) = ConflictPresentationMode::parse_str(text) {
                        self.conflict_mode = mode;
                    }
                }
            }
            _ => {}
        }
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

/// Maximum include.path nesting this layer follows before ignoring further files.
const MAX_INCLUDE_DEPTH: usize = 10;

/// Files Git consults before the repository config, in ascending precedence.
fn config_layers(git_dir: &Path) -> Vec<PathBuf> {
    let mut layers = system_config_paths();
    layers.extend(user_config_paths());
    layers.push(git_dir.join("config"));
    layers
}

/// System-wide configuration candidates, honouring Git's environment overrides.
fn system_config_paths() -> Vec<PathBuf> {
    if environment_flag("GIT_CONFIG_NOSYSTEM") {
        return Vec::new();
    }
    if let Some(explicit) = std::env::var_os("GIT_CONFIG_SYSTEM") {
        return explicit_file(explicit).into_iter().collect();
    }
    let mut candidates = Vec::new();
    if cfg!(windows) {
        for variable in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
            let Some(root) = std::env::var_os(variable) else {
                continue;
            };
            let root = PathBuf::from(root);
            candidates.push(root.join("Git").join("etc").join("gitconfig"));
            candidates.push(
                root.join("Programs")
                    .join("Git")
                    .join("etc")
                    .join("gitconfig"),
            );
        }
    } else {
        candidates.push(PathBuf::from("/etc/gitconfig"));
    }
    candidates
}

/// User configuration candidates: the XDG file first, then ~/.gitconfig.
fn user_config_paths() -> Vec<PathBuf> {
    if let Some(explicit) = std::env::var_os("GIT_CONFIG_GLOBAL") {
        return explicit_file(explicit).into_iter().collect();
    }
    let mut paths = Vec::new();
    if let Some(xdg) = xdg_config_home() {
        paths.push(xdg.join("git").join("config"));
    }
    if let Some(home) = home_dir() {
        paths.push(home.join(".gitconfig"));
    }
    paths
}

/// Reads one Git boolean environment flag using Git's git_env_bool truth table.
///
/// Presence alone is not enough: Git treats 0, false, no and off as "unset", so checking
/// only whether the variable exists would disable the system layer for a caller that asked
/// for it to stay enabled.
fn environment_flag(name: &str) -> bool {
    match std::env::var_os(name) {
        Some(value) => {
            let text = value.to_string_lossy().to_ascii_lowercase();
            matches!(text.as_str(), "true" | "yes" | "on" | "1")
        }
        None => false,
    }
}

/// Converts an environment path variable, treating an empty value as unset.
fn explicit_file(value: OsString) -> Option<PathBuf> {
    (!value.is_empty()).then_some(PathBuf::from(value))
}

/// Returns the user's home directory, preferring Git's POSIX variable.
fn home_dir() -> Option<PathBuf> {
    ["HOME", "USERPROFILE"]
        .iter()
        .find_map(std::env::var_os)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Returns the XDG configuration root, which defaults to ~/.config.
fn xdg_config_home() -> Option<PathBuf> {
    match std::env::var_os("XDG_CONFIG_HOME") {
        Some(value) if !value.is_empty() => Some(PathBuf::from(value)),
        Some(_) => None,
        None => home_dir().map(|home| home.join(".config")),
    }
}

/// Applies one file, expanding includes and stopping a cycle or an over-deep chain.
fn apply_config_file(
    path: &Path,
    git_dir: &Path,
    depth: usize,
    include_stack: &mut Vec<PathBuf>,
    config: &mut RepoConfig,
) {
    if depth > MAX_INCLUDE_DEPTH {
        return;
    }
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let identity = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if include_stack.contains(&identity) {
        return;
    }
    include_stack.push(identity);
    for entry in collect_entries(&parse_file(&text)) {
        match included_path(entry.key(), entry.value(), path, git_dir) {
            Some(included) => {
                apply_config_file(&included, git_dir, depth + 1, include_stack, config);
            }
            None => config.apply_entry(entry.key(), entry.value()),
        }
    }
    include_stack.pop();
}

/// Resolves the file named by an include entry, or None when the entry is an ordinary setting.
fn included_path(
    key: &ConfigKey,
    value: Option<&str>,
    from: &Path,
    git_dir: &Path,
) -> Option<PathBuf> {
    let value = value?;
    if key.name() != "path" {
        return None;
    }
    match (key.section(), key.subsection()) {
        ("include", None) => resolve_include(value, from),
        ("includeif", Some(condition)) => {
            include_condition(condition, from, git_dir).then(|| resolve_include(value, from))?
        }
        _ => None,
    }
}

/// Evaluates the condition of an includeIf entry.
fn include_condition(condition: &str, from: &Path, git_dir: &Path) -> bool {
    match condition.split_once(':') {
        Some((kind, pattern)) if kind.eq_ignore_ascii_case("gitdir") => {
            gitdir_matches(pattern, from, git_dir, false)
        }
        Some((kind, pattern)) if kind.eq_ignore_ascii_case("gitdir/i") => {
            gitdir_matches(pattern, from, git_dir, true)
        }
        _ => false,
    }
}

/// Resolves an include target relative to the including file, expanding a leading tilde.
fn resolve_include(value: &str, from: &Path) -> Option<PathBuf> {
    let expanded = expand_home(value.trim());
    if expanded.is_empty() {
        return None;
    }
    let path = PathBuf::from(expanded);
    Some(if path.is_absolute() {
        path
    } else {
        from.parent().unwrap_or(Path::new(".")).join(path)
    })
}

/// Matches a gitdir includeIf pattern against the repository's Git directory.
fn gitdir_matches(pattern: &str, from: &Path, git_dir: &Path, ignore_case: bool) -> bool {
    let pattern = expand_home(pattern.trim());
    let pattern_path = if let Some(relative) = pattern.strip_prefix("./") {
        from.parent().unwrap_or(Path::new(".")).join(relative)
    } else {
        PathBuf::from(&pattern)
    };
    let pattern_text = normalize_glob_text(&pattern_path);
    let anchored = pattern_text.starts_with('/') || has_windows_prefix(&pattern_text);
    let mut candidates = vec![if anchored {
        pattern_text.clone()
    } else {
        format!("**/{pattern_text}")
    }];
    if pattern_text.ends_with('/') {
        if let Some(last) = candidates.last_mut() {
            last.push_str("**");
        }
    }
    let mut location = normalize_glob_text(git_dir);
    if ignore_case {
        location = location.to_ascii_lowercase();
        candidates = candidates
            .into_iter()
            .map(|candidate| candidate.to_ascii_lowercase())
            .collect();
    }
    let locations = [location.clone(), format!("{location}/")];
    candidates.iter().any(|candidate| {
        locations
            .iter()
            .any(|location| glob_matches(candidate, location))
    })
}

/// Reports whether normalized text starts with a drive prefix such as C:/.
fn has_windows_prefix(text: &str) -> bool {
    let mut characters = text.chars();
    matches!(
        (characters.next(), characters.next()),
        (Some(letter), Some(':')) if letter.is_ascii_alphabetic()
    )
}

/// Expands a leading tilde to the user's home directory.
fn expand_home(text: &str) -> String {
    if text == "~" {
        return home_dir().map_or_else(|| text.to_string(), |home| normalize_glob_text(&home));
    }
    let Some(rest) = text.strip_prefix("~/") else {
        return text.to_string();
    };
    match home_dir() {
        Some(home) => format!("{}/{}", normalize_glob_text(&home), rest),
        None => text.to_string(),
    }
}

/// Normalizes a path into Git's forward-slash spelling for pattern comparison.
fn normalize_glob_text(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Matches text against a glob where double-star spans separators and star stays in one segment.
fn glob_matches(pattern: &str, text: &str) -> bool {
    let pattern_chars: Vec<char> = pattern.chars().collect();
    let text_chars: Vec<char> = text.chars().collect();
    let length = text_chars.len();
    let mut reachable = vec![false; length + 1];
    reachable[0] = true;
    let mut index = 0usize;
    while index < pattern_chars.len() {
        let pattern_char = pattern_chars[index];
        let mut next = vec![false; length + 1];
        if pattern_char == '*' && pattern_chars.get(index + 1) == Some(&'*') {
            index += 2;
            while pattern_chars.get(index) == Some(&'*') {
                index += 1;
            }
            let mut active = false;
            for offset in 0..=length {
                active |= reachable[offset];
                next[offset] = active;
            }
            if pattern_chars.get(index) == Some(&'/') {
                index += 1;
            }
        } else {
            match pattern_char {
                '*' => {
                    let mut active = false;
                    for offset in 0..=length {
                        active |= reachable[offset];
                        next[offset] = active;
                        if offset < length && text_chars[offset] == '/' {
                            active = false;
                        }
                    }
                }
                '?' => {
                    for offset in 0..length {
                        if reachable[offset] && text_chars[offset] != '/' {
                            next[offset + 1] = true;
                        }
                    }
                }
                literal => {
                    for offset in 0..length {
                        if reachable[offset] && text_chars[offset] == literal {
                            next[offset + 1] = true;
                        }
                    }
                }
            }
            index += 1;
        }
        reachable = next;
    }
    reachable[length]
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
    /// Creates a unique scratch directory inside the workspace tmp tree.
    ///
    /// The host temporary directory is not writable for every runner, and MSYS style shells hand
    /// native processes a POSIX style TEMP that Windows resolves against the current drive root, so
    /// scratch fixtures stay under the workspace exactly like the differential suite does.
    fn scratch_root(name: &str) -> std::path::PathBuf {
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = manifest_dir
            .ancestors()
            .nth(3)
            .expect("the crate lives three levels below the workspace root");
        let base = workspace_root.join("tmp").join("fg-index-config");
        let _ = std::fs::create_dir_all(&base);
        let root = base.join(format!("{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("scratch directory");
        root
    }

    fn write_fixture(path: &std::path::Path, contents: &str) {
        std::fs::write(path, contents).expect("fixture file");
    }

    #[test]
    fn later_layers_override_earlier_ones() {
        let root = scratch_root("layers");
        let base = root.join("base");
        let overlay = root.join("overlay");
        let local = root.join("repository-config");
        write_fixture(&base, "[core]\n\tautocrlf = input\n\tfilemode = true\n");
        write_fixture(&overlay, "[core]\n\tautocrlf = false\n");
        write_fixture(&local, "[core]\n\tfilemode = false\n");
        let config = RepoConfig::load_with_layers(&root.join("git"), &[base, overlay, local]);
        assert_eq!(config.auto_crlf(), AutoCrlf::False);
        assert!(!config.trust_executable_bit());
    }

    #[test]
    fn missing_layers_keep_the_compiled_in_defaults() {
        let root = scratch_root("missing");
        let config = RepoConfig::load_with_layers(&root.join("git"), &[root.join("absent")]);
        assert_eq!(config.auto_crlf(), AutoCrlf::False);
        assert!(config.trust_executable_bit());
    }

    #[test]
    fn include_path_expands_relative_to_the_including_file() {
        let root = scratch_root("include");
        let included = root.join("crlf.cfg");
        let local = root.join("config");
        write_fixture(&included, "[core]\n\tautocrlf = true\n");
        write_fixture(&local, "[include]\n\tpath = crlf.cfg\n");
        let config = RepoConfig::load_with_layers(&root.join("git"), &[local]);
        assert_eq!(config.auto_crlf(), AutoCrlf::True);
    }

    #[test]
    fn include_cycles_terminate_and_apply_each_file_once() {
        let root = scratch_root("cycle");
        let first = root.join("first");
        let second = root.join("second");
        write_fixture(
            &first,
            "[include]\n\tpath = second\n[core]\n\tfilemode = false\n",
        );
        write_fixture(
            &second,
            "[include]\n\tpath = first\n[core]\n\tautocrlf = true\n",
        );
        let config = RepoConfig::load_with_layers(&root.join("git"), &[first]);
        assert_eq!(config.auto_crlf(), AutoCrlf::True);
        assert!(!config.trust_executable_bit());
    }

    #[test]
    fn include_if_gitdir_matches_the_repository_directory() {
        let root = scratch_root("includeif");
        let included = root.join("matched.cfg");
        let local = root.join("config");
        write_fixture(&included, "[core]\n\tautocrlf = true\n");
        let pattern = root.join("repo/").to_string_lossy().replace('\\', "/");
        write_fixture(
            &local,
            &format!("[includeIf \"gitdir:{pattern}\"]\n\tpath = matched.cfg\n"),
        );
        let matched =
            RepoConfig::load_with_layers(&root.join("repo/.git"), std::slice::from_ref(&local));
        assert_eq!(matched.auto_crlf(), AutoCrlf::True);
        let unmatched = RepoConfig::load_with_layers(&root.join("other/.git"), &[local]);
        assert_eq!(unmatched.auto_crlf(), AutoCrlf::False);
    }
}
