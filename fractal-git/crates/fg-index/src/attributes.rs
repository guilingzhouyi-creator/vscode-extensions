//! Module: fg-index — Git Attributes Projection
//! File Path: crates/fg-index/src/attributes.rs
//! Architecture Role: Reads `.gitattributes` and answers the one question a worktree comparison
//!   needs: how does Git rewrite a file's bytes on the way into an object?
//! Dependencies & Triggers: Consumed by `status` and `diff` before they hash or render a worktree
//!   file; reuses the pattern grammar from [`crate::ignore`].
//! Responsibilities: Parse attribute lines, resolve `text` and `eol` for a path with Git's
//!   precedence, and apply the resulting CRLF conversion.
//! Exit Semantics & Design Rationale:
//!   - The conversion is not cosmetic. Git hashes the *converted* bytes, so a `.ps1` declared
//!     `text eol=crlf` whose worktree copy uses CRLF hashes to the same object as its LF blob. A
//!     reader that hashed raw bytes would report every such file as wholly rewritten, and on a
//!     Windows checkout of this repository that turned 1,758 changed lines into 5,005.
//!   - Only the direction *into* the object store is modelled. `eol` also decides how a checkout
//!     writes the file back, but nothing in this engine materialises a worktree, so carrying that
//!     distinction would be a variant no caller could observe. It is collapsed into
//!     [`CrlfAction::Text`], and the resolution comment records what was dropped.
//!   - `core.autocrlf` only decides what an *absent* `text` attribute means. With it false — the
//!     setting this repository records — an unmarked path passes through untouched, which is why
//!     "unset", "no opinion", and "no line at all" must stay distinguishable.
//!   - `working-tree-encoding` and `filter` drivers are not modelled. Both rewrite bytes through a
//!     codec this build does not carry, and pretending to convert would produce an object id that no
//!     Git agrees with. A path using either stays unconverted, which keeps the hash honest rather
//!     than plausibly wrong.
//!   - Attribute files are read from the worktree only. A machine-level `core.attributesfile` would
//!     make the same repository hash differently on two hosts, and this engine's contract is that a
//!     repository describes itself.

use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};

use crate::ignore::{parse_pattern, pattern_matches, PatternSegment};

/// Name of the per-directory attribute file.
const ATTRIBUTE_FILE: &str = ".gitattributes";

/// How Git treats a path's line endings on the way into an object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrlfAction {
    /// The bytes pass through untouched: `-text`, or no attribute with `core.autocrlf` false.
    Binary,
    /// Convert CRLF to LF unconditionally: `text`, or `core.autocrlf`.
    Text,
    /// Convert CRLF to LF only when the file does not look binary and the stored blob has no CRLF:
    /// `text=auto`.
    Auto,
}

impl CrlfAction {
    /// Reports whether the bytes pass through untouched.
    fn is_binary(self) -> bool {
        self == Self::Binary
    }

    /// Reports whether conversion is conditional on the file's shape and the stored blob.
    fn is_auto(self) -> bool {
        self == Self::Auto
    }
}

/// `core.autocrlf`, as a three-valued setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AutoCrlf {
    /// `false`: no automatic conversion. The default when the key is absent.
    #[default]
    False,
    /// `true`: convert on the way in.
    True,
    /// `input`: convert on the way in, which for hashing is the same as `true`.
    Input,
}

/// One `pattern attr...` line, with the pattern already parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
struct AttributeRule {
    /// Directory the rule is anchored to, relative to the worktree root (`""` for the root).
    base: String,
    segments: Vec<PatternSegment>,
    anchored: bool,
    /// The assignments this line makes, in written order.
    assignments: Vec<Assignment>,
}

/// One `name`, `-name`, `!name`, or `name=value` token.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Assignment {
    name: String,
    value: AttributeValue,
}

/// What a token says about one attribute.
#[derive(Debug, Clone, PartialEq, Eq)]
enum AttributeValue {
    /// The bare name: the attribute is set.
    Set,
    /// `-name`: the attribute is unset.
    Unset,
    /// `!name`: no opinion, overriding any earlier line.
    Unspecified,
    /// `name=value`.
    Value(String),
}

/// Every attribute rule that applies to one worktree, in Git's evaluation order.
#[derive(Debug, Clone, Default)]
pub struct AttributeSet {
    rules: Vec<AttributeRule>,
}

impl AttributeSet {
    /// Loads the rules that apply to `work_root`.
    ///
    /// Files are collected shallowest first and `info/attributes` last, so a later match overrides
    /// an earlier one — which is Git's precedence: a deeper file beats a shallower one, and the
    /// repository's own `info/attributes` beats both.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] when an attribute file exists but cannot be read. Treating it as
    /// empty would make every path it configures hash differently from the repository it belongs to.
    pub fn load(git_dir: &Path, work_root: &Path) -> FractalResult<Self> {
        let mut files: Vec<(PathBuf, String)> = Vec::new();
        collect_attribute_files(work_root, work_root, &mut files)?;
        files.sort_by_key(|(_, base)| base.matches('/').count() + usize::from(!base.is_empty()));

        let mut rules = Vec::new();
        for (path, base) in files {
            load_file(&path, &base, &mut rules)?;
        }
        load_file(&git_dir.join("info").join("attributes"), "", &mut rules)?;
        Ok(Self { rules })
    }

    /// Number of rules currently loaded.
    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }

    /// Looks up one attribute for `relative_path`.
    ///
    /// Returns `None` when no matching rule mentions the attribute, which `check-attr` reports as
    /// `unspecified`. Git distinguishes four outcomes and so does this: `set` (bare name), `unset`
    /// (`-name`), `unspecified` (`!name`), and a literal value (`name=value`). Collapsing them into a
    /// single string would make `!name` indistinguishable from "no rule matched", which is exactly
    /// the distinction `git check-attr` exists to expose.
    ///
    /// Later matching rules win, consistent with [`Self::crlf_action`] and with Git's precedence: a
    /// deeper attribute file overrides a shallower one, and `info/attributes` overrides both.
    pub fn lookup(&self, relative_path: &str, attribute: &str) -> Option<String> {
        let mut found: Option<String> = None;
        for rule in &self.rules {
            if !pattern_matches(&rule.segments, rule.anchored, &rule.base, relative_path) {
                continue;
            }
            for assignment in &rule.assignments {
                if assignment.name != attribute {
                    continue;
                }
                found = Some(match &assignment.value {
                    AttributeValue::Set => "set".to_string(),
                    AttributeValue::Unset => "unset".to_string(),
                    AttributeValue::Unspecified => "unspecified".to_string(),
                    AttributeValue::Value(text) => text.clone(),
                });
            }
        }
        found
    }

    /// Resolves the conversion action for `relative_path`.
    ///
    /// `relative_path` must use `/` separators and be relative to the worktree root. `auto_crlf` is
    /// `core.autocrlf`, passed in rather than stored because the answer is a function of the path and
    /// the configuration together, and a caller should not resolve a path against a configuration it
    /// never chose.
    pub fn crlf_action(&self, relative_path: &str, auto_crlf: AutoCrlf) -> CrlfAction {
        let (mut text, mut eol) = (None, None);
        for rule in &self.rules {
            if !pattern_matches(&rule.segments, rule.anchored, &rule.base, relative_path) {
                continue;
            }
            for assignment in &rule.assignments {
                match assignment.name.as_str() {
                    "text" | "crlf" => text = Some(assignment.value.clone()),
                    "eol" => eol = Some(assignment.value.clone()),
                    _ => {}
                }
            }
        }
        resolve_action(text.as_ref(), eol.as_ref(), auto_crlf)
    }
}

/// Maps the resolved `text` and `eol` attributes onto a conversion action.
///
/// This is `convert_attrs` in `convert.c` with the driver, encoding, and checkout-direction branches
/// removed. Three details are load-bearing:
///
///   - An explicit `-text` short-circuits everything. Git's `eol` block is guarded by
///     `crlf_action != CRLF_BINARY`, so `-text eol=crlf` stays binary and a resolution that consulted
///     `eol` first would convert a file the repository declared binary.
///   - `eol` alone is enough to make a path text. `eol=crlf` with no `text` attribute leaves the
///     action `CRLF_UNDEFINED`, which still enters the block, so the path converts.
///   - Only an action that is still undefined reaches `core.autocrlf`.
fn resolve_action(
    text: Option<&AttributeValue>,
    eol: Option<&AttributeValue>,
    auto_crlf: AutoCrlf,
) -> CrlfAction {
    let declared = text_action(text);
    let refined = match eol {
        Some(AttributeValue::Value(value)) if value == "lf" || value == "crlf" => {
            declared.or(Some(CrlfAction::Text))
        }
        _ => declared,
    };
    match refined {
        Some(action) => action,
        None => auto_fallback(auto_crlf),
    }
}

/// Resolves what `text` alone says, or `None` when it says nothing.
fn text_action(text: Option<&AttributeValue>) -> Option<CrlfAction> {
    match text {
        Some(AttributeValue::Set) => Some(CrlfAction::Text),
        Some(AttributeValue::Unset) => Some(CrlfAction::Binary),
        Some(AttributeValue::Value(value)) if value == "auto" => Some(CrlfAction::Auto),
        Some(AttributeValue::Value(value)) if value == "input" => Some(CrlfAction::Text),
        // An unrecognised value and an explicit `!text` both leave the decision to the next source,
        // which is what `git_path_check_crlf` returns `CRLF_UNDEFINED` for.
        Some(AttributeValue::Value(_)) | Some(AttributeValue::Unspecified) | None => None,
    }
}

/// Maps `core.autocrlf` onto the action an unmarked path receives.
fn auto_fallback(auto_crlf: AutoCrlf) -> CrlfAction {
    match auto_crlf {
        AutoCrlf::False => CrlfAction::Binary,
        AutoCrlf::True | AutoCrlf::Input => CrlfAction::Text,
    }
}

/// Rewrites worktree bytes into the form Git stores.
///
/// Returns a borrow when nothing changes, so an unmarked or already-normalised file costs no
/// allocation. `index_has_crlf` is consulted only for [`CrlfAction::Auto`], where Git refuses to
/// convert a file whose stored blob already contains CRLF; callers that cannot determine it pass
/// `false`, which converts — the answer Git reaches when the index has no blob for the path.
pub fn to_git_bytes<'a>(
    bytes: &'a [u8],
    action: CrlfAction,
    index_has_crlf: bool,
) -> Cow<'a, [u8]> {
    if action.is_binary() || bytes.is_empty() {
        return Cow::Borrowed(bytes);
    }
    let stats = TextStats::gather(bytes);
    if stats.crlf == 0 {
        return Cow::Borrowed(bytes);
    }
    if action.is_auto() && (stats.looks_binary() || index_has_crlf) {
        return Cow::Borrowed(bytes);
    }
    Cow::Owned(strip_cr(bytes, action.is_auto()))
}

/// Line-ending census of one payload, matching `gather_stats` in `convert.c`.
#[derive(Debug, Default, Clone, Copy)]
struct TextStats {
    nul: usize,
    lone_cr: usize,
    crlf: usize,
    printable: usize,
    nonprintable: usize,
}

impl TextStats {
    /// Counts the byte classes Git counts.
    fn gather(bytes: &[u8]) -> Self {
        let mut stats = Self::default();
        let mut index = 0usize;
        while index < bytes.len() {
            let byte = bytes[index];
            index += 1;
            match byte {
                b'\r' if bytes.get(index) == Some(&b'\n') => {
                    stats.crlf += 1;
                    index += 1;
                }
                b'\r' => stats.lone_cr += 1,
                0x7f => stats.nonprintable += 1,
                b'\x08' | b'\t' | 0x1b | 0x0c => stats.printable += 1,
                _ if byte < 0x20 => {
                    stats.nul += usize::from(byte == 0);
                    stats.nonprintable += 1;
                }
                _ => stats.printable += 1,
            }
        }
        // A trailing DOS EOF marker is not counted against the file, which is the one correction
        // `gather_stats` makes after its loop.
        if bytes.last() == Some(&0x1a) && stats.nonprintable > 0 {
            stats.nonprintable -= 1;
        }
        stats
    }

    /// Applies `convert_is_binary`: a bare CR, a NUL, or a mostly non-printable body.
    fn looks_binary(&self) -> bool {
        self.lone_cr > 0 || self.nul > 0 || (self.printable >> 7) < self.nonprintable
    }
}

/// Removes the carriage returns Git removes.
///
/// The `AUTO` family has already proved there is no bare CR, so it drops every one; the `TEXT` family
/// drops only those that introduce a newline, which leaves a CR at the very end of the file intact.
/// Collapsing the two would silently rewrite a file whose last line ends in a lone CR.
fn strip_cr(bytes: &[u8], drop_all: bool) -> Vec<u8> {
    let mut stripped = Vec::with_capacity(bytes.len());
    for (index, byte) in bytes.iter().enumerate() {
        let keep = match (byte, drop_all) {
            (b'\r', true) => false,
            (b'\r', false) => bytes.get(index + 1) != Some(&b'\n'),
            _ => true,
        };
        if keep {
            stripped.push(*byte);
        }
    }
    stripped
}

/// Reports whether a stored blob already carries a CRLF pair, which the `AUTO` family treats as a
/// reason not to convert.
///
/// This is `has_crlf_in_index`: a blob with no CR at all answers `false` without the full census, and
/// one that has CRs only counts when it is text and at least one CR is followed by LF.
pub fn blob_has_crlf(payload: &[u8]) -> bool {
    if !payload.contains(&b'\r') {
        return false;
    }
    let stats = TextStats::gather(payload);
    !stats.looks_binary() && stats.crlf > 0
}

/// Collects every `.gitattributes` in the worktree with the directory it scopes.
fn collect_attribute_files(
    work_root: &Path,
    directory: &Path,
    files: &mut Vec<(PathBuf, String)>,
) -> FractalResult<()> {
    let base = match directory.strip_prefix(work_root) {
        Ok(found) => found
            .components()
            .map(|component| component.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<String>>()
            .join("/"),
        Err(_) => String::new(),
    };
    let candidate = directory.join(ATTRIBUTE_FILE);
    if candidate.is_file() {
        files.push((candidate, base));
    }
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
        // Descending into the repository's own metadata would read a second repository's rules.
        if name == ".git" || name == ".taxis" {
            continue;
        }
        collect_attribute_files(work_root, &entry.path(), files)?;
    }
    Ok(())
}

/// Reads one attribute file into `rules`.
fn load_file(path: &Path, base: &str, rules: &mut Vec<AttributeRule>) -> FractalResult<()> {
    if !path.is_file() {
        return Ok(());
    }
    let text = fs::read_to_string(path)?;
    for line in text.lines() {
        if let Some(rule) = parse_rule(line, base) {
            rules.push(rule);
        }
    }
    Ok(())
}

/// Parses one attribute line, returning `None` for blanks, comments, and macro definitions.
///
/// A `[attr]name ...` line defines a macro rather than applying attributes, so it is skipped:
/// honouring a use without expanding the definition would be a silently different rule set.
fn parse_rule(line: &str, base: &str) -> Option<AttributeRule> {
    let trimmed = line.trim_end_matches(['\r', ' ']);
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("[attr]") {
        return None;
    }
    let mut tokens = trimmed.split_whitespace();
    let pattern = tokens.next()?;
    let assignments: Vec<Assignment> = tokens.filter_map(parse_assignment).collect();
    if assignments.is_empty() {
        return None;
    }
    let anchored_explicitly = pattern.starts_with('/');
    let (anchored, segments) = parse_pattern(pattern.trim_start_matches('/'), anchored_explicitly)?;
    Some(AttributeRule {
        base: base.to_string(),
        segments,
        anchored,
        assignments,
    })
}

/// Parses one attribute token.
fn parse_assignment(token: &str) -> Option<Assignment> {
    let (name, value) = match token.split_once('=') {
        Some((name, value)) => (name, AttributeValue::Value(value.to_string())),
        None => match token.strip_prefix('-') {
            Some(rest) => (rest, AttributeValue::Unset),
            None => match token.strip_prefix('!') {
                Some(rest) => (rest, AttributeValue::Unspecified),
                None => (token, AttributeValue::Set),
            },
        },
    };
    match name.is_empty() {
        true => None,
        false => Some(Assignment {
            name: name.to_string(),
            value,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        blob_has_crlf, parse_rule, pattern_matches, resolve_action, strip_cr, to_git_bytes,
        AttributeValue, AutoCrlf, CrlfAction,
    };
    use std::borrow::Cow;

    fn value(text: &str) -> AttributeValue {
        AttributeValue::Value(text.to_string())
    }

    #[test]
    fn a_text_attribute_converts_crlf_to_lf() {
        let action = resolve_action(
            Some(&AttributeValue::Set),
            Some(&value("crlf")),
            AutoCrlf::False,
        );
        assert_eq!(action, CrlfAction::Text);
        assert_eq!(&*to_git_bytes(b"a\r\nb\r\n", action, false), b"a\nb\n");
    }

    #[test]
    fn an_unmarked_path_is_untouched_when_autocrlf_is_false() {
        let action = resolve_action(None, None, AutoCrlf::False);
        assert_eq!(action, CrlfAction::Binary);
        assert_eq!(&*to_git_bytes(b"a\r\nb\r\n", action, false), b"a\r\nb\r\n");
    }

    #[test]
    fn an_unmarked_path_converts_when_autocrlf_is_true() {
        let action = resolve_action(None, None, AutoCrlf::True);
        assert_eq!(action, CrlfAction::Text);
        assert_eq!(&*to_git_bytes(b"a\r\nb\r\n", action, false), b"a\nb\n");
    }

    #[test]
    fn a_binary_file_is_never_converted_by_an_auto_rule() {
        let action = resolve_action(Some(&value("auto")), Some(&value("crlf")), AutoCrlf::False);
        assert_eq!(action, CrlfAction::Auto);
        assert_eq!(&*to_git_bytes(b"a\0\r\n", action, false), b"a\0\r\n");
    }

    #[test]
    fn an_auto_rule_defers_when_the_index_already_holds_crlf() {
        let action = resolve_action(Some(&value("auto")), None, AutoCrlf::False);
        assert_eq!(&*to_git_bytes(b"a\r\nb\r\n", action, true), b"a\r\nb\r\n");
        assert_eq!(&*to_git_bytes(b"a\r\nb\r\n", action, false), b"a\nb\n");
    }

    #[test]
    fn a_text_rule_ignores_the_index_state() {
        let action = resolve_action(
            Some(&AttributeValue::Set),
            Some(&value("lf")),
            AutoCrlf::False,
        );
        assert_eq!(&*to_git_bytes(b"a\r\n", action, true), b"a\n");
    }

    #[test]
    fn a_trailing_lone_cr_survives_a_text_conversion() {
        assert_eq!(strip_cr(b"a\r\nb\r", false), b"a\nb\r");
        assert_eq!(strip_cr(b"a\r\nb\r", true), b"a\nb");
    }

    #[test]
    fn an_unset_text_attribute_beats_autocrlf() {
        let action = resolve_action(Some(&AttributeValue::Unset), None, AutoCrlf::True);
        assert_eq!(action, CrlfAction::Binary);
    }

    #[test]
    fn an_unspecified_text_attribute_falls_through_to_autocrlf() {
        let action = resolve_action(Some(&AttributeValue::Unspecified), None, AutoCrlf::Input);
        assert_eq!(action, CrlfAction::Text);
    }

    #[test]
    fn an_empty_payload_is_returned_untouched() {
        assert_eq!(&*to_git_bytes(b"", CrlfAction::Text, false), b"");
    }

    #[test]
    fn a_payload_without_carriage_returns_is_borrowed() {
        assert!(matches!(
            to_git_bytes(b"a\nb\n", CrlfAction::Text, false),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn a_blob_is_reported_as_carrying_crlf_only_when_it_is_text() {
        assert!(blob_has_crlf(b"a\r\nb\r\n"));
        assert!(!blob_has_crlf(b"a\nb\n"));
        assert!(!blob_has_crlf(b"a\0\r\n"));
    }

    #[test]
    fn a_rule_keeps_every_assignment_it_declares() {
        let rule = parse_rule("*.ps1 text eol=crlf -diff", "").expect("parse");
        assert_eq!(rule.assignments.len(), 3);
        assert_eq!(rule.assignments[1].name, "eol");
    }

    #[test]
    fn a_comment_and_a_macro_line_are_skipped() {
        assert!(parse_rule("# note", "").is_none());
        assert!(parse_rule("[attr]binary -diff -merge -text", "").is_none());
    }

    #[test]
    fn a_pattern_without_an_assignment_is_skipped() {
        assert!(parse_rule("*.rs", "").is_none());
    }

    #[test]
    fn a_nested_file_scopes_its_rules_to_its_own_directory() {
        let rule = parse_rule("*.gd text eol=lf", "WebGames").expect("parse");
        assert!(pattern_matches(
            &rule.segments,
            rule.anchored,
            &rule.base,
            "WebGames/a.gd"
        ));
        assert!(!pattern_matches(
            &rule.segments,
            rule.anchored,
            &rule.base,
            "a.gd"
        ));
    }
}
