//! Module: fg-index — Git Configuration Syntax Layer
//! File Path: crates/fg-index/src/config_format.rs
//! Architecture Role: Tokenizes, parses and re-renders the Git configuration grammar that
//!   [crate::config] exposes as keys and entries, and owns the scratch-file replacement used by writes.
//! Dependencies & Triggers: Called by crate::config only; no other module decodes config text.
//! Responsibilities: Line kinds and section headers, quoting and escapes, entry collection, surgical
//!   rewriting with re-parse verification, and atomic file replacement.
//! Exit Semantics & Design Rationale:
//!   - Parsing keeps every original line so a write can preserve comments, order and line endings.
//!   - Values are quoted only when Git's writer would quote them.
//!   - Every rewrite is re-parsed and compared before it can replace the file.

use std::fs;
use std::io;
use std::path::Path;

use crate::config::{ConfigEntry, ConfigError, ConfigKey, ConfigWriteMode};

pub(crate) fn normalize_name_component(raw: &str, label: &str) -> Result<String, ConfigError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ConfigError::InvalidKey(format!("{label} name is empty")));
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(ConfigError::InvalidKey(format!(
            "{label} name '{trimmed}' may contain only ASCII letters, digits and '-'"
        )));
    }
    Ok(trimmed.to_ascii_lowercase())
}

pub(crate) fn unescape_quoted_text(text: &str) -> Option<String> {
    let mut unescaped = String::with_capacity(text.len());
    let mut characters = text.chars();
    while let Some(character) = characters.next() {
        match character {
            '"' => return None,
            '\\' => {
                let escaped = characters.next()?;
                unescaped.push(unescape_character(escaped)?);
            }
            other => unescaped.push(other),
        }
    }
    Some(unescaped)
}

fn unescape_character(character: char) -> Option<char> {
    match character {
        'n' => Some('\n'),
        't' => Some('\t'),
        'b' => Some('\u{8}'),
        '"' => Some('"'),
        '\\' => Some('\\'),
        _ => None,
    }
}

pub(crate) fn escape_quoted(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\t' => escaped.push_str("\\t"),
            '\u{8}' => escaped.push_str("\\b"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// Serializes a value the way Git's writer does: quote only when the value needs it.
fn render_value(value: &str) -> String {
    let needs_quotes = value.starts_with([' ', '\t'])
        || value.ends_with([' ', '\t'])
        || value.contains(['#', ';']);
    let escaped = escape_quoted(value);
    if needs_quotes {
        format!("\"{escaped}\"")
    } else {
        escaped
    }
}

pub(crate) fn render_entry(indent: &str, key: &ConfigKey, value: &str, suffix: &str) -> String {
    format!("{indent}{} = {}{suffix}", key.name(), render_value(value))
}

#[derive(Debug, Clone)]
pub(crate) enum ParsedKind {
    Section {
        section: String,
        subsection: Option<String>,
    },
    Entry {
        key: ConfigKey,
        value: Option<String>,
        indent: String,
        suffix: String,
    },
    Other,
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedLine {
    pub(crate) text: String,
    pub(crate) crlf: bool,
    pub(crate) kind: ParsedKind,
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedFile {
    pub(crate) lines: Vec<ParsedLine>,
    pub(crate) trailing_newline: bool,
}

pub(crate) fn parse_file(text: &str) -> ParsedFile {
    if text.is_empty() {
        return ParsedFile {
            lines: Vec::new(),
            trailing_newline: false,
        };
    }
    let trailing_newline = text.ends_with('\n');
    let body = if trailing_newline {
        &text[..text.len() - 1]
    } else {
        text
    };
    let mut current: Option<(String, Option<String>)> = None;
    let mut lines = Vec::with_capacity(body.matches('\n').count() + 1);
    for chunk in body.split('\n') {
        let (line, crlf) = match chunk.strip_suffix('\r') {
            Some(rest) => (rest, true),
            None => (chunk, false),
        };
        let kind = parse_line(line, &mut current);
        lines.push(ParsedLine {
            text: line.to_string(),
            crlf,
            kind,
        });
    }
    ParsedFile {
        lines,
        trailing_newline,
    }
}

fn parse_line(text: &str, current: &mut Option<(String, Option<String>)>) -> ParsedKind {
    let (content, suffix) = split_inline_comment(text);
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return ParsedKind::Other;
    }
    if trimmed.starts_with('[') {
        if let Some((section, subsection)) = parse_section_header(trimmed) {
            *current = Some((section.clone(), subsection.clone()));
            return ParsedKind::Section {
                section,
                subsection,
            };
        }
        return ParsedKind::Other;
    }
    let Some((section, subsection)) = current.clone() else {
        return ParsedKind::Other;
    };
    let indent = leading_whitespace(text).to_string();
    let Some(equals) = content.find('=') else {
        let name = content.trim();
        return match ConfigKey::new(&section, subsection.as_deref(), name) {
            Ok(key) => ParsedKind::Entry {
                key,
                value: None,
                indent,
                suffix: suffix.to_string(),
            },
            Err(_) => ParsedKind::Other,
        };
    };
    let key_part = &content[..equals];
    let value_part = &content[equals + 1..];
    let Ok(key) = ConfigKey::new(&section, subsection.as_deref(), key_part) else {
        return ParsedKind::Other;
    };
    let Some(value) = parse_value(value_part) else {
        return ParsedKind::Other;
    };
    ParsedKind::Entry {
        key,
        value: Some(value),
        indent,
        suffix: suffix.to_string(),
    }
}

/// Splits a line at the first # or ; outside a quoted value, keeping the suffix verbatim.
fn split_inline_comment(text: &str) -> (&str, &str) {
    let bytes = text.as_bytes();
    let mut quoted = false;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' if quoted => index += 2,
            b'"' => {
                quoted = !quoted;
                index += 1;
            }
            b'#' | b';' if !quoted => {
                let content_end = text[..index].trim_end().len();
                return (&text[..content_end], &text[content_end..]);
            }
            _ => index += 1,
        }
    }
    let content_end = text.trim_end().len();
    (&text[..content_end], &text[content_end..])
}

fn leading_whitespace(text: &str) -> &str {
    let trimmed = text.trim_start();
    &text[..text.len() - trimmed.len()]
}

fn parse_value(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Some(String::new());
    }
    if let Some(rest) = trimmed.strip_prefix('"') {
        let (value, remainder) = parse_quoted_value(rest)?;
        if !remainder.trim().is_empty() {
            return None;
        }
        return Some(value);
    }
    unescape_unquoted_value(trimmed)
}

fn parse_quoted_value(input: &str) -> Option<(String, &str)> {
    let mut value = String::with_capacity(input.len());
    let mut characters = input.char_indices();
    while let Some((index, character)) = characters.next() {
        match character {
            '"' => return Some((value, &input[index + 1..])),
            '\\' => {
                let (_, escaped) = characters.next()?;
                value.push(unescape_character(escaped)?);
            }
            other => value.push(other),
        }
    }
    None
}

fn unescape_unquoted_value(input: &str) -> Option<String> {
    let mut value = String::with_capacity(input.len());
    let mut characters = input.chars();
    while let Some(character) = characters.next() {
        if character == '\\' {
            let escaped = characters.next()?;
            value.push(unescape_character(escaped)?);
        } else {
            value.push(character);
        }
    }
    Some(value)
}

fn parse_section_header(trimmed: &str) -> Option<(String, Option<String>)> {
    let inner = trimmed.strip_prefix('[')?.strip_suffix(']')?.trim();
    if inner.is_empty() {
        return None;
    }
    if let Some(index) = inner.find(char::is_whitespace) {
        let head = &inner[..index];
        let tail = inner[index..].trim();
        let quoted = tail.strip_prefix('"')?;
        let body = quoted.strip_suffix('"')?;
        let subsection = unescape_quoted_text(body)?;
        return Some((
            normalize_name_component(head, "section").ok()?,
            Some(subsection),
        ));
    }
    if let Some((head, subsection)) = inner.split_once('.') {
        let section = normalize_name_component(head, "section").ok()?;
        if subsection.is_empty()
            || subsection.contains('"')
            || subsection.contains(char::is_whitespace)
        {
            return None;
        }
        return Some((section, Some(subsection.to_ascii_lowercase())));
    }
    Some((normalize_name_component(inner, "section").ok()?, None))
}

pub(crate) fn collect_entries(file: &ParsedFile) -> Vec<ConfigEntry> {
    file.lines
        .iter()
        .filter_map(|line| match &line.kind {
            ParsedKind::Entry { key, value, .. } => Some(ConfigEntry {
                key: key.clone(),
                value: value.clone(),
            }),
            _ => None,
        })
        .collect()
}

pub(crate) fn count_entries(file: &ParsedFile, key: &ConfigKey, literal: Option<&str>) -> usize {
    collect_entries(file)
        .iter()
        .filter(|entry| {
            &entry.key == key
                && literal.is_none_or(|expected| entry.value.as_deref() == Some(expected))
        })
        .count()
}

pub(crate) fn rewrite_entries(
    file: &ParsedFile,
    key: &ConfigKey,
    value: &str,
    mode: ConfigWriteMode,
) -> Vec<(String, bool)> {
    let default_crlf = file.lines.first().map(|line| line.crlf).unwrap_or(false);
    let mut rendered: Vec<(String, bool)> = Vec::with_capacity(file.lines.len() + 3);
    let mut in_target = false;
    let mut section_found = false;
    let mut placed = false;
    let mut inserted_indent: Option<String> = None;

    for line in &file.lines {
        if let ParsedKind::Section {
            section,
            subsection,
        } = &line.kind
        {
            if in_target && !placed {
                rendered.push((
                    render_entry(default_indent(&inserted_indent), key, value, ""),
                    line.crlf,
                ));
                placed = true;
            }
            in_target = section == key.section() && subsection.as_deref() == key.subsection();
            if in_target {
                section_found = true;
                inserted_indent = None;
            }
            rendered.push((line.text.clone(), line.crlf));
            continue;
        }

        if let ParsedKind::Entry {
            key: entry_key,
            indent,
            suffix,
            ..
        } = &line.kind
        {
            if in_target && entry_key == key {
                match mode {
                    ConfigWriteMode::Replace => {
                        if !placed {
                            rendered.push((render_entry(indent, key, value, suffix), line.crlf));
                            placed = true;
                        }
                        continue;
                    }
                    ConfigWriteMode::Add => inserted_indent = Some(indent.clone()),
                }
            }
        }

        rendered.push((line.text.clone(), line.crlf));
    }

    if in_target && !placed {
        let crlf = file
            .lines
            .last()
            .map(|line| line.crlf)
            .unwrap_or(default_crlf);
        rendered.push((
            render_entry(default_indent(&inserted_indent), key, value, ""),
            crlf,
        ));
    }

    if !section_found {
        if let Some((last, _)) = rendered.last() {
            if !last.trim().is_empty() {
                rendered.push((String::new(), default_crlf));
            }
        }
        rendered.push((key.section_header(), default_crlf));
        rendered.push((render_entry("\t", key, value, ""), default_crlf));
    }

    rendered
}

fn default_indent(inserted: &Option<String>) -> &str {
    inserted.as_deref().unwrap_or("\t")
}

pub(crate) fn render_file(lines: &[(String, bool)], trailing_newline: bool) -> String {
    let mut rendered = String::new();
    for (index, (text, crlf)) in lines.iter().enumerate() {
        rendered.push_str(text);
        let last = index + 1 == lines.len();
        if !(last && !trailing_newline) {
            rendered.push_str(if *crlf { "\r\n" } else { "\n" });
        }
    }
    rendered
}

pub(crate) fn verify_rewrite(
    before: &ParsedFile,
    rendered: &str,
    key: &ConfigKey,
    value: &str,
    mode: ConfigWriteMode,
) -> Result<(), ConfigError> {
    let after = parse_file(rendered);
    let target = key.to_dotted();
    let count_before = count_entries(before, key, None);
    let expected_count = match mode {
        ConfigWriteMode::Replace => 1,
        ConfigWriteMode::Add => count_before + 1,
    };
    let count_after = count_entries(&after, key, None);
    if count_after != expected_count {
        return Err(ConfigError::Verify(format!(
            "expected {expected_count} entries for '{target}', re-parsed {count_after}"
        )));
    }
    if count_entries(&after, key, Some(value)) == 0 {
        return Err(ConfigError::Verify(format!(
            "re-parsed '{target}' does not carry the written value"
        )));
    }
    let before_entries: Vec<(ConfigKey, Option<String>)> = collect_pairs(before);
    let after_entries: Vec<(ConfigKey, Option<String>)> = collect_pairs(&after);
    let (expected_rest, mut actual_rest) = match mode {
        ConfigWriteMode::Replace => (
            before_entries
                .into_iter()
                .filter(|(entry_key, _)| entry_key != key)
                .collect::<Vec<_>>(),
            after_entries
                .into_iter()
                .filter(|(entry_key, _)| entry_key != key)
                .collect::<Vec<_>>(),
        ),
        ConfigWriteMode::Add => (before_entries, after_entries),
    };
    if mode == ConfigWriteMode::Add {
        actual_rest = summarize_without_one_value(&actual_rest, key, value)?;
    }
    if expected_rest != actual_rest {
        return Err(ConfigError::Verify(format!(
            "rewriting '{target}' changed unrelated entries"
        )));
    }
    Ok(())
}

fn collect_pairs(file: &ParsedFile) -> Vec<(ConfigKey, Option<String>)> {
    collect_entries(file)
        .into_iter()
        .map(|entry| (entry.key, entry.value))
        .collect()
}

/// Removes one (key, value) occurrence and returns every remaining entry, preserving order.
fn summarize_without_one_value(
    entries: &[(ConfigKey, Option<String>)],
    key: &ConfigKey,
    value: &str,
) -> Result<Vec<(ConfigKey, Option<String>)>, ConfigError> {
    let position = entries
        .iter()
        .position(|(entry_key, entry_value)| {
            entry_key == key && entry_value.as_deref() == Some(value)
        })
        .ok_or_else(|| {
            ConfigError::Verify(format!(
                "the appended '{}' entry disappeared after re-parsing",
                key.to_dotted()
            ))
        })?;
    let mut remaining = entries.to_vec();
    remaining.remove(position);
    Ok(remaining)
}

pub(crate) fn read_text(path: &Path) -> Result<Option<String>, ConfigError> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ConfigError::Io(error)),
    }
}

pub(crate) fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<(), ConfigError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(ConfigError::Io(io::Error::new(
                io::ErrorKind::NotFound,
                format!("parent directory '{}' does not exist", parent.display()),
            )));
        }
    }
    fg_core::write_file_atomic(path, bytes, true).map_err(ConfigError::Io)
}
