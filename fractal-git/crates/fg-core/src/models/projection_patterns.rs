//! Module: fg-core — Projection Pattern Matching
//! File Path: crates/fg-core/src/models/projection_patterns.rs
//! Architecture Role: Matches one path against one pattern, and orders one pattern against a
//!   parent scope, for the three pattern shapes the workspace actually uses.
//! Dependencies & Triggers: Called by [`super::projection::ProjectionScope`].
//! Responsibilities: The path predicate, the region-containment predicate, and the prefix relation
//!   the directory-pruning decision depends on.
//! Exit Semantics & Design Rationale:
//!   - Only three shapes are supported and no more: a trailing `/**` for a prefix, a leading `*.`
//!     for an extension, and an exact path. A richer syntax would need a real matcher; pretending
//!     to support one would make the visibility test silently wrong for the shapes it does not
//!     understand, and wrong in the permissive direction.
//!   - `region_within` answers a different question from the path predicate. Asking whether the
//!     string `crates/**` is itself a visible path always answers no, which made a nested card look
//!     like it had reached outside its cell. The two predicates are kept apart so neither is used
//!     to answer the other's question.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use super::projection::ProjectionScope;
use super::repo_path::path_matches_scope;
pub(super) fn region_within(pattern: &str, parent: &ProjectionScope) -> bool {
    if let Some(prefix) = pattern.strip_suffix("/**") {
        let prefix = prefix.trim_end_matches('/');
        if prefix.is_empty() {
            // `/**` names the whole tree, which a restricted parent cannot hold.
            return false;
        }
        return parent.include_patterns.iter().any(|parent_pattern| {
            let parent_prefix = parent_pattern
                .strip_suffix("/**")
                .unwrap_or(parent_pattern)
                .trim_end_matches('/');
            // The child's region is inside the parent's when the parent's prefix contains it.
            !parent_prefix.is_empty() && path_matches_scope(prefix, parent_prefix)
        });
    }

    if let Some(extension) = pattern.strip_prefix("*.") {
        return parent.include_patterns.iter().any(|parent_pattern| {
            parent_pattern
                .strip_prefix("*.")
                .is_some_and(|parent_extension| parent_extension == extension)
        });
    }

    parent.admits(pattern)
}

/// Reports whether `prefix` is a proper path-prefix of `path`, or equals it.
///
/// Separate from `path_matches_scope`, which asks whether a *candidate* is inside a *scope*. Here
/// the question is the reverse: is the scope's own pattern nested under a directory we are about to
/// skip? Getting the direction wrong prunes exactly the subtrees the slice needs.
pub(super) fn prefix_of(prefix: &str, path: &str) -> bool {
    let prefix = prefix.trim_end_matches("/**").trim_end_matches('/');
    if prefix.is_empty() {
        return true;
    }
    path_matches_scope(prefix, path) || path_matches_scope(path, prefix)
}

pub(super) fn pattern_matches(pattern: &str, path: &str) -> bool {
    if pattern == "**" || pattern == "*" {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix("/**") {
        return path_matches_scope(path, prefix);
    }
    if let Some(suffix) = pattern.strip_prefix("*.") {
        return path
            .rsplit_once('.')
            .is_some_and(|(_, extension)| extension == suffix);
    }
    pattern == path
}
