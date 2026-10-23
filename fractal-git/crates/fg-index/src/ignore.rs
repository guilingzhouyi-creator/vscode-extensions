//! Module: fg-index — Git Ignore Pattern Matcher
//! File Path: crates/fg-index/src/ignore.rs
//! Architecture Role: Decides whether a worktree path is excluded, using the same rule sources Git
//!   reads: nested `.gitignore` files, `.git/info/exclude`, and the configured global excludes file.
//! Dependencies & Triggers: Consumed by `check-ignore` and by `status`, which cannot classify an
//!   untracked path without it.
//! Responsibilities: Parse pattern files, match a path against every applicable rule, and report the
//!   rule that decided the outcome.
//! Exit Semantics & Design Rationale:
//!   - The deciding rule is returned, not just a boolean. `check-ignore -v` and every "why is this
//!     file ignored" question need the source file, line, and pattern; recomputing them at the call
//!     site would mean matching twice and possibly disagreeing with the first answer.
//!   - Rule precedence is resolved by *order of evaluation*, deepest file last, then line order
//!     within a file. The last matching rule wins, which is how a later `!` re-includes a path an
//!     earlier rule excluded.
//!   - An excluded parent directory excludes its contents regardless of a later `!` for the child.
//!     Git documents this and relies on it: a negation can only re-include a path whose parents are
//!     still traversable. Reporting the child's own rule would claim a file is tracked when a
//!     checkout would never create it.
//!   - Patterns without an internal slash match at any depth, patterns with one are anchored to the
//!     directory holding the file that declared them. That single distinction decides whether `dist/`
//!     means "the root's dist" or "any dist"; getting it backwards silently ignores the wrong tree.
//!   - A pattern file that cannot be read is reported. Treating it as empty would make every path it
//!     excludes appear untracked, and the user would stage build output into the repository.

use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};

/// One parsed pattern line together with the file and line it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnorePattern {
    /// File that declared the rule.
    pub source: PathBuf,
    /// One-based line number inside that file.
    pub line: usize,
    /// Pattern text as written, without the leading `!`.
    pub pattern: String,
    /// Complete line as written, including the leading `!` and any trailing slash.
    ///
    /// `check-ignore -v` prints this form verbatim, and a caller comparing its output against Git's
    /// needs the same bytes. Reporting the stripped internal form loses exactly the two characters
    /// that say whether the rule negates or targets directories.
    pub raw: String,
    /// True when the rule re-includes rather than excludes.
    pub negated: bool,
    /// True when the rule applies only to directories.
    pub directory_only: bool,
    /// Directory the rule is anchored to, relative to the worktree root (`""` for the root).
    pub base: String,
    segments: Vec<PatternSegment>,
    anchored: bool,
}

/// One path segment of a pattern.
///
/// Shared with the attributes reader, which uses the same path grammar as `.gitignore` (Git
/// documents that the two formats differ only in negation and directory handling, not in how a
/// pattern matches a path).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PatternSegment {
    /// `**`: matches zero or more whole segments.
    AnyDepth,
    /// A glob that must match exactly one segment.
    Glob(String),
}

/// The rule that decided a path's ignore state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnoreMatch {
    /// Rule that decided the outcome.
    pub pattern: IgnorePattern,
    /// True when the deciding rule excludes the path.
    pub ignored: bool,
}

/// Every rule that applies to one worktree, in evaluation order.
#[derive(Debug, Clone, Default)]
pub struct IgnoreMatcher {
    rules: Vec<IgnorePattern>,
}

impl IgnoreMatcher {
    /// Builds a matcher from an explicit rule list, preserving evaluation order.
    pub fn from_rules(rules: Vec<IgnorePattern>) -> Self {
        Self { rules }
    }

    /// Number of rules currently loaded.
    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }

    /// Loads the rules that apply to `work_root`.
    ///
    /// Reads `info/exclude` from `git_dir`, the worktree-root `.gitignore`, and then every nested
    /// `.gitignore` in one walk. Nested files are appended after their parents, so the last matching
    /// rule is also the most specific one.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] when a pattern file exists but cannot be read. A missing file is
    /// not an error: most directories have no `.gitignore`.
    pub fn load(git_dir: &Path, work_root: &Path) -> FractalResult<Self> {
        let mut rules = Vec::new();
        let info_exclude = git_dir.join("info").join("exclude");
        load_file(&info_exclude, "", &mut rules)?;

        let mut pending: Vec<PathBuf> = vec![work_root.to_path_buf()];
        while let Some(directory) = pending.pop() {
            let relative = relative_directory(work_root, &directory)?;
            load_file(&directory.join(".gitignore"), &relative, &mut rules)?;
            collect_child_directories(&directory, &mut pending)?;
        }
        Ok(Self { rules })
    }

    /// Adds a pattern file's rules under `base`.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] when the file exists but cannot be read.
    pub fn add_file(&mut self, path: &Path, base: &str) -> FractalResult<()> {
        load_file(path, base, &mut self.rules)
    }

    /// Decides whether `relative_path` is ignored, reporting the deciding rule.
    ///
    /// `relative_path` must use `/` separators and be relative to the worktree root.
    ///
    /// Ancestors are consulted before the path itself and from the shallowest downward. Git never
    /// descends into an excluded directory, so no rule written inside one can apply to its contents:
    /// a `!build/keep.txt` after `build/` leaves the file ignored. A deeper rule would only be
    /// reachable by enumerating a directory Git never enters, which is the difference between "the
    /// file has a rule that re-includes it" and "a checkout would create the file".
    pub fn decide(&self, relative_path: &str, is_directory: bool) -> Option<IgnoreMatch> {
        let trimmed = relative_path.trim_matches('/');
        if trimmed.is_empty() {
            return None;
        }
        let components: Vec<&str> = trimmed.split('/').collect();

        for depth in 1..components.len() {
            let ancestor = components[..depth].join("/");
            if let Some(decided) = self.direct_match(&ancestor, true) {
                if decided.ignored {
                    return Some(decided);
                }
            }
        }
        self.direct_match(trimmed, is_directory)
    }

    /// Returns true when the path is excluded and no later rule re-included it.
    pub fn is_ignored(&self, relative_path: &str, is_directory: bool) -> bool {
        self.decide(relative_path, is_directory)
            .map(|decided| decided.ignored)
            .unwrap_or(false)
    }

    /// Finds the last rule that matches the path directly.
    fn direct_match(&self, relative_path: &str, is_directory: bool) -> Option<IgnoreMatch> {
        let mut decided: Option<IgnoreMatch> = None;
        for rule in &self.rules {
            if rule.directory_only && !is_directory {
                continue;
            }
            if !rule.matches(relative_path) {
                continue;
            }
            decided = Some(IgnoreMatch {
                pattern: rule.clone(),
                ignored: !rule.negated,
            });
        }
        decided
    }
}

impl IgnorePattern {
    /// Reports whether this rule matches `relative_path`.
    fn matches(&self, relative_path: &str) -> bool {
        pattern_matches(&self.segments, self.anchored, &self.base, relative_path)
    }
}

/// Matches a parsed pattern against a worktree path.
///
/// Shared with the attribute reader, whose pattern grammar Git documents as the same one: only the
/// meaning of a leading `!` and of a trailing `/` differ between `.gitignore` and `.gitattributes`,
/// and neither changes whether a pattern matches a path. A second matcher would be a second answer
/// to "does `*.ps1` cover `scripts/build.ps1`", and the two would drift.
pub(crate) fn pattern_matches(
    segments: &[PatternSegment],
    anchored: bool,
    base: &str,
    relative_path: &str,
) -> bool {
    let Some(scoped) = scope_components(base, relative_path) else {
        return false;
    };
    if anchored {
        return match_from(segments, &scoped);
    }
    // An unanchored pattern is matched against the basename only.
    match scoped.last() {
        Some(basename) => match_from(segments, &[basename]),
        None => false,
    }
}

/// Strips the rule's base directory from the path, or returns `None` when the path is outside it.
fn scope_components<'a>(base: &str, relative_path: &'a str) -> Option<Vec<&'a str>> {
    if base.is_empty() {
        return Some(relative_path.split('/').collect());
    }
    let prefix = format!("{base}/");
    let remainder = relative_path.strip_prefix(&prefix)?;
    Some(remainder.split('/').collect())
}

/// Matches pattern segments against path components, with `**` spanning any number of them.
fn match_from(segments: &[PatternSegment], components: &[&str]) -> bool {
    match segments.first() {
        None => components.is_empty(),
        Some(PatternSegment::AnyDepth) => {
            (0..=components.len()).any(|skip| match_from(&segments[1..], &components[skip..]))
        }
        Some(PatternSegment::Glob(glob)) => match components.first() {
            Some(component) => {
                glob_match(glob.as_bytes(), component.as_bytes())
                    && match_from(&segments[1..], &components[1..])
            }
            None => false,
        },
    }
}

/// Matches one glob against one path component.
///
/// Supports `*` (any run of characters inside the component), `?` (exactly one character),
/// `[abc]`, `[a-z]`, and `[!abc]`. A trailing backslash escapes the next character.
fn glob_match(pattern: &[u8], text: &[u8]) -> bool {
    if pattern.is_empty() {
        return text.is_empty();
    }
    match pattern[0] {
        b'*' => {
            // Collapse consecutive stars; they mean the same thing as one.
            let mut rest = &pattern[1..];
            while rest.first() == Some(&b'*') {
                rest = &rest[1..];
            }
            (0..=text.len()).any(|skip| glob_match(rest, &text[skip..]))
        }
        b'?' => !text.is_empty() && glob_match(&pattern[1..], &text[1..]),
        b'[' => match_class(pattern, text),
        b'\\' if pattern.len() > 1 => {
            !text.is_empty() && text[0] == pattern[1] && glob_match(&pattern[2..], &text[1..])
        }
        literal => !text.is_empty() && text[0] == literal && glob_match(&pattern[1..], &text[1..]),
    }
}

/// Matches a `[...]` character class at the head of `pattern` against `text`.
fn match_class(pattern: &[u8], text: &[u8]) -> bool {
    let Some(close) = pattern.iter().skip(1).position(|byte| *byte == b']') else {
        // An unterminated class is a literal '[' — Git treats it that way rather than failing.
        return !text.is_empty() && text[0] == b'[' && glob_match(&pattern[1..], &text[1..]);
    };
    if text.is_empty() {
        return false;
    }
    let body = &pattern[1..1 + close];
    let rest = &pattern[1 + close + 1..];
    let (negated, members) = match body.first() {
        Some(b'!') | Some(b'^') => (true, &body[1..]),
        _ => (false, body),
    };
    let mut matched = false;
    let mut cursor = 0usize;
    while cursor < members.len() {
        if cursor + 2 < members.len() && members[cursor + 1] == b'-' {
            if members[cursor] <= text[0] && text[0] <= members[cursor + 2] {
                matched = true;
            }
            cursor += 3;
        } else {
            if members[cursor] == text[0] {
                matched = true;
            }
            cursor += 1;
        }
    }
    matched != negated && glob_match(rest, &text[1..])
}

/// Splits a pattern body into its anchoring flag and its path segments.
///
/// A pattern containing a slash is anchored to the directory that declared it; one without a slash
/// matches a basename at any depth. A leading slash anchors without contributing a segment, so `/x`
/// and `x/` are different rules and both must survive parsing.
///
/// Exposed so the attribute reader parses patterns exactly as `.gitignore` does. The two formats
/// share this grammar, and a second parser would disagree with the first on `**` or on an empty
/// segment the first time either was changed.
pub(crate) fn parse_pattern(
    body: &str,
    anchored_explicitly: bool,
) -> Option<(bool, Vec<PatternSegment>)> {
    if body.is_empty() {
        return None;
    }
    let anchored = anchored_explicitly || body.contains('/');
    let segments: Vec<PatternSegment> = body
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            if segment == "**" {
                PatternSegment::AnyDepth
            } else {
                PatternSegment::Glob(segment.to_string())
            }
        })
        .collect();
    match segments.is_empty() {
        true => None,
        false => Some((anchored, segments)),
    }
}

/// Reads one pattern file into `rules`, ignoring blank lines and comments.
fn load_file(path: &Path, base: &str, rules: &mut Vec<IgnorePattern>) -> FractalResult<()> {
    if !path.is_file() {
        return Ok(());
    }
    let text = fs::read_to_string(path)?;
    for (index, raw_line) in text.lines().enumerate() {
        if let Some(rule) = parse_line(raw_line, path, index + 1, base) {
            rules.push(rule);
        }
    }
    Ok(())
}

/// Parses one line, returning `None` for blanks and comments.
fn parse_line(raw_line: &str, source: &Path, line: usize, base: &str) -> Option<IgnorePattern> {
    let trimmed = raw_line.trim_end_matches(['\r', ' ', '\t']);
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let (negated, body) = match trimmed.strip_prefix('!') {
        Some(rest) => (true, rest),
        None => (false, trimmed),
    };
    if body.is_empty() {
        return None;
    }
    let (directory_only, body) = match body.strip_suffix('/') {
        Some(rest) if !rest.is_empty() => (true, rest),
        _ => (false, body),
    };
    // A leading slash anchors the pattern without contributing a segment.
    let anchored_explicitly = body.starts_with('/');
    let body = body.trim_start_matches('/');
    let (anchored, segments) = parse_pattern(body, anchored_explicitly)?;
    if segments.is_empty() {
        return None;
    }
    Some(IgnorePattern {
        source: source.to_path_buf(),
        line,
        pattern: body.to_string(),
        raw: trimmed.to_string(),
        negated,
        directory_only,
        base: base.to_string(),
        segments,
        anchored,
    })
}

/// Path of `directory` relative to `work_root`, using `/` separators.
fn relative_directory(work_root: &Path, directory: &Path) -> FractalResult<String> {
    let relative = directory.strip_prefix(work_root).map_err(|strip_err| {
        FractalError::Io(std::io::Error::other(format!(
            "'{}' is not inside '{}': {strip_err}",
            directory.display(),
            work_root.display()
        )))
    })?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<String>>()
        .join("/"))
}

/// Collects subdirectories of `directory`, skipping the repository's own metadata directories.
fn collect_child_directories(directory: &Path, pending: &mut Vec<PathBuf>) -> FractalResult<()> {
    let entries = match fs::read_dir(directory) {
        Ok(read) => read,
        Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(io_err) => return Err(FractalError::Io(io_err)),
    };
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".git" || name == ".taxis" {
            continue;
        }
        pending.push(entry.path());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{glob_match, parse_line, IgnoreMatcher, IgnorePattern};
    use std::path::Path;

    fn rule(text: &str) -> IgnorePattern {
        parse_line(text, Path::new(".gitignore"), 1, "").expect("parse")
    }

    fn matcher(lines: &[&str]) -> IgnoreMatcher {
        let rules = lines
            .iter()
            .enumerate()
            .filter_map(|(index, line)| parse_line(line, Path::new(".gitignore"), index + 1, ""))
            .collect();
        IgnoreMatcher::from_rules(rules)
    }

    #[test]
    fn skips_blanks_and_comments() {
        assert!(parse_line("", Path::new("f"), 1, "").is_none());
        assert!(parse_line("   ", Path::new("f"), 1, "").is_none());
        assert!(parse_line("# note", Path::new("f"), 1, "").is_none());
    }

    #[test]
    fn an_unanchored_name_matches_at_any_depth() {
        let matcher = matcher(&["target"]);
        assert!(matcher.is_ignored("target", true));
        assert!(matcher.is_ignored("crates/fg-core/target", true));
        assert!(!matcher.is_ignored("src/target.txt", false));
    }

    #[test]
    fn a_trailing_slash_restricts_the_rule_to_directories() {
        let matcher = matcher(&["dist/"]);
        assert!(matcher.is_ignored("dist", true));
        assert!(!matcher.is_ignored("dist", false));
    }

    #[test]
    fn a_leading_slash_anchors_the_rule_to_the_declaring_directory() {
        let matcher = matcher(&["/target"]);
        assert!(matcher.is_ignored("target", true));
        assert!(!matcher.is_ignored("nested/target", true));
    }

    #[test]
    fn a_double_star_spans_directories() {
        let matcher = matcher(&["**/node_modules/"]);
        assert!(matcher.is_ignored("node_modules", true));
        assert!(matcher.is_ignored("packages/app/node_modules", true));
    }

    #[test]
    fn a_leading_double_star_does_not_require_a_parent() {
        let matcher = matcher(&["**/*.log"]);
        assert!(matcher.is_ignored("build.log", false));
        assert!(matcher.is_ignored("a/b/build.log", false));
    }

    #[test]
    fn a_negation_re_includes_a_previously_excluded_path() {
        let matcher = matcher(&["*.log", "!keep.log"]);
        assert!(matcher.is_ignored("debug.log", false));
        assert!(!matcher.is_ignored("keep.log", false));
    }

    #[test]
    fn an_excluded_parent_keeps_its_children_ignored() {
        let matcher = matcher(&["build/", "!build/keep.txt"]);
        assert!(matcher.is_ignored("build/keep.txt", false));
    }

    #[test]
    fn reports_the_deciding_rule_with_its_line() {
        let matcher = matcher(&["*.tmp"]);
        let decided = matcher.decide("a.tmp", false).expect("decided");
        assert!(decided.ignored);
        assert_eq!(decided.pattern.pattern, "*.tmp");
        assert_eq!(decided.pattern.line, 1);
    }

    #[test]
    fn a_nested_file_scopes_its_rules_to_its_own_directory() {
        let nested = parse_line("local.txt", Path::new("sub/.gitignore"), 1, "sub").expect("parse");
        let matcher = IgnoreMatcher::from_rules(vec![nested]);
        assert!(matcher.is_ignored("sub/local.txt", false));
        assert!(!matcher.is_ignored("local.txt", false));
    }

    #[test]
    fn character_classes_match_a_single_character() {
        assert!(glob_match(b"*.py[cod]", b"file.pyc"));
        assert!(!glob_match(b"*.py[cod]", b"file.pyx"));
        assert!(glob_match(b"[a-c]x", b"bx"));
        assert!(!glob_match(b"[!a-c]x", b"bx"));
    }

    #[test]
    fn question_marks_match_one_character() {
        assert!(glob_match(b"a?c", b"abc"));
        assert!(!glob_match(b"a?c", b"ac"));
    }

    #[test]
    fn a_literal_dollar_is_not_an_anchor() {
        assert!(glob_match(b"*$py.class", b"module$py.class"));
    }

    #[test]
    fn the_rule_keeps_its_pattern_text_for_reporting() {
        let parsed = rule("!config/*.json");
        assert!(parsed.negated);
        assert!(parsed.anchored);
        assert_eq!(parsed.pattern, "config/*.json");
    }
}
