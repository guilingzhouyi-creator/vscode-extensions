//! Module: fg-core — Proven Commit Witness
//! File Path: crates/fg-core/src/models/commit_witness.rs
//! Architecture Role: Strongly-typed proof object representing a compile-time verified
//!   commit message. Adheres to "Parse, Don't Validate" principles: cannot be created
//!   without passing through the Taxis governance parser and diff coherence checks.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Type-safe witness certifying that a commit message has passed all invariant checks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidatedCommitWitness {
    /// Normalized conventional commit type (e.g. "feat", "fix", "refactor").
    pub commit_type: String,
    /// Verified scope of the commit, if provided.
    pub scope: Option<String>,
    /// Summary line (imperative, bounded length, no trailing punctuation).
    pub summary: String,
    /// Substantive character count in body.
    pub substantive_char_count: usize,
    /// Structured named sections parsed from the body (e.g. "Why", "Changed", "Verification").
    pub sections: HashMap<String, String>,
    /// Full normalized commit message string.
    pub raw_message: String,
}

impl ValidatedCommitWitness {
    /// Package-internal constructor for validated witnesses.
    pub fn new(
        commit_type: impl Into<String>,
        scope: Option<String>,
        summary: impl Into<String>,
        substantive_char_count: usize,
        sections: HashMap<String, String>,
        raw_message: impl Into<String>,
    ) -> Self {
        Self {
            commit_type: commit_type.into(),
            scope,
            summary: summary.into(),
            substantive_char_count,
            sections,
            raw_message: raw_message.into(),
        }
    }

    /// Access a structured section by name (case-insensitive lookup), returning a string slice.
    pub fn section(&self, name: &str) -> Option<&str> {
        let lower = name.to_lowercase();
        self.sections
            .iter()
            .find_map(|(section_key, section_value)| {
                if section_key.to_lowercase() == lower {
                    Some(section_value.as_str())
                } else {
                    None
                }
            })
    }

    /// Access a structured section by name (case-insensitive lookup, backwards compatible alias).
    pub fn get_section(&self, name: &str) -> Option<&String> {
        let lower = name.to_lowercase();
        self.sections
            .iter()
            .find_map(|(section_key, section_value)| {
                if section_key.to_lowercase() == lower {
                    Some(section_value)
                } else {
                    None
                }
            })
    }
}
