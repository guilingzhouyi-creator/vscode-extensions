//! Module: fg-core — Topology Projection Scope
//! File Path: crates/fg-core/src/models/projection.rs
//! Architecture Role: Declares the path scope a fractal node's working copy, diff, and history
//!   view are restricted to, so the same commit graph can be presented at four different
//!   magnifications without four copies of it.
//! Dependencies & Triggers: Attached to project and sub-lease records; consumed by traversal
//!   windows and by any command that reports "what changed here".
//! Responsibilities: Combine the node's tier with its path patterns, decide whether a path is
//!   visible at this tier, and refuse a scope that claims more than its parent holds.
//! Exit Semantics & Design Rationale:
//!   - A projection filters **visibility**, never **reachability**. A commit that changes only
//!     files outside the scope stays in the graph with its original parents and is reported as
//!     "present, not visible here". The tempting alternative — splicing the commit out and
//!     reparenting its child onto its parent — produces a graph whose hashes no longer match the
//!     commits they name. That is not a projection; it is a forged history, and it destroys the
//!     one property a version store cannot lose.
//!   - Visibility is a property of (tier, path), not of the commit. Two nodes holding the same
//!     commit therefore disagree about it, which is the entire point: the System trunk sees the
//!     whole change, a Card sees the part inside its slice. Keeping the disagreement in the scope
//!     rather than in the commit is what lets one commit serve both.
//!   - An empty pattern set means "everything", not "nothing". A node that has not been given a
//!     slice has not been restricted; treating the absence as an empty allowlist would black out
//!     every node whose scope was never configured, which is the opposite of the safe default.
//!   - Narrowing is one-way. A child may see less than its parent, never more, for the same reason
//!     a horizon may narrow but not widen: the parent holds the bytes, so a child claiming a wider
//!     view promises history no node in the chain actually keeps.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TOP-001`: Fractal topology reference guard

use super::projection_patterns::{pattern_matches, prefix_of, region_within};
pub use super::projection_tier::ProjectionTier;
use super::repo_path::path_matches_scope;
use crate::error::{FractalError, FractalResult};
use serde::{Deserialize, Serialize};

/// The slice of the tree one node presents, and the tier that slice belongs to.
///
/// A scope answers exactly one question — "is this path visible here?" — and deliberately does not
/// answer "did this commit touch anything visible?". Keeping the two apart lets a caller report a
/// commit as present-but-outside-scope instead of having to drop it or lie about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectionScope {
    /// Tier this scope is declared at.
    pub tier: ProjectionTier,
    /// Path prefixes or globs the scope includes. Empty means the whole tree.
    pub include_patterns: Vec<String>,
    /// Path prefixes or globs subtracted after inclusion.
    pub exclude_patterns: Vec<String>,
}

impl ProjectionScope {
    /// Creates the unrestricted scope at `tier`.
    ///
    /// An empty include set is the whole tree. This is the value a node gets when nobody has given
    /// it a slice, and it must behave exactly like having no projection at all.
    #[must_use]
    pub fn whole(tier: ProjectionTier) -> Self {
        Self {
            tier,
            include_patterns: Vec::new(),
            exclude_patterns: Vec::new(),
        }
    }

    /// Creates a scope restricted to `patterns`.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] for a blank pattern, because a blank prefix would
    /// silently match nothing and leave the node unable to see the files it was created for.
    pub fn restricted(
        tier: ProjectionTier,
        include_patterns: Vec<String>,
        exclude_patterns: Vec<String>,
    ) -> FractalResult<Self> {
        for pattern in include_patterns.iter().chain(exclude_patterns.iter()) {
            if pattern.trim().is_empty() {
                return Err(FractalError::PolicyViolation(
                    "projection scope contains a blank path pattern".to_string(),
                ));
            }
        }
        Ok(Self {
            tier,
            include_patterns,
            exclude_patterns,
        })
    }

    /// Reports whether this scope restricts anything.
    ///
    /// Callers use this to take the unmodified path, so an unrestricted node stays provably
    /// identical to a node that never had a scope.
    #[must_use]
    pub fn is_whole(&self) -> bool {
        self.include_patterns.is_empty()
    }

    /// Reports whether a directory can contain anything this scope admits.
    ///
    /// This is the traversal-pruning question, and it is not the same as [`Self::admits`]. A
    /// directory is not a file: `admits("crates")` is false for a scope restricted to
    /// `crates/fg-core/**`, yet that directory must still be descended into. Answering with
    /// `admits` would prune the whole subtree and report an empty slice for a scope that actually
    /// contains files.
    ///
    /// A caller that skips a directory this returns `false` for therefore reads only the
    /// directories its slice can reach, instead of flattening the entire tree and filtering after.
    #[must_use]
    pub fn may_contain(&self, directory: &str) -> bool {
        if directory.is_empty() {
            // The root always has to be entered; it holds every top-level entry.
            return true;
        }
        if self.is_whole() {
            return true;
        }
        // An exclusion that dominates the directory removes it entirely.
        if self
            .exclude_patterns
            .iter()
            .any(|pattern| pattern == directory || prefix_of(pattern, directory))
        {
            return false;
        }
        self.include_patterns.iter().any(|pattern| {
            // Either the pattern points inside this directory, or it is at or below it. Both mean
            // the directory is on a path to something included.
            path_matches_scope(pattern, directory)
                || prefix_of(pattern, directory)
                || pattern_matches(pattern, directory)
        })
    }

    /// Reports whether `path` is visible at this tier.
    ///
    /// Exclusions are applied after inclusions, so a broad include plus a narrow exclude expresses
    /// "my slice, minus the generated files" without having to enumerate the slice.
    #[must_use]
    pub fn admits(&self, path: &str) -> bool {
        // The empty string is not a path; `RepoPath::parse` refuses it for the same reason. Without
        // this guard an unrestricted scope would report ``""`` as visible, and a caller enumerating
        // "visible paths" could then act on a name that never reaches a tree.
        if path.is_empty() {
            return false;
        }
        if self.is_whole() {
            return !self
                .exclude_patterns
                .iter()
                .any(|pattern| pattern_matches(pattern, path));
        }
        if !self
            .include_patterns
            .iter()
            .any(|pattern| pattern_matches(pattern, path))
        {
            return false;
        }
        !self
            .exclude_patterns
            .iter()
            .any(|pattern| pattern_matches(pattern, path))
    }

    /// Reports whether every path this scope admits is also admitted by `parent`.
    ///
    /// This is the containment test applied when a child is created, and it answers the question in
    /// the direction that matters: *is the child's slice inside the parent's?*
    ///
    /// Each of the child's include patterns is treated as a claim about a region of the tree, and the
    /// claim holds when the parent admits either the whole region or a superset of it. Testing the
    /// region itself with [`Self::admits`] alone is wrong: a parent scoped to `crates/**` does not
    /// admit the literal string `crates/fg-core/**`, yet it plainly contains everything that pattern
    /// names. Rejecting that pair would have banned nesting, which is the ordinary case for a card
    /// inside a cell.
    ///
    /// Anything this cannot order returns `false`, so an unrecognised shape is refused rather than
    /// allowed to widen a child past its parent.
    #[must_use]
    pub fn covers(&self, parent: &Self) -> bool {
        if parent.is_whole() {
            // Everything is inside everything, so a child of an unrestricted parent may restrict
            // freely and may also stay unrestricted.
            return true;
        }
        if self.is_whole() {
            // The parent is restricted and this scope is not, so this scope claims the whole tree.
            return false;
        }
        if self.include_patterns.iter().any(|pattern| {
            parent
                .exclude_patterns
                .iter()
                .any(|excluded| excluded == pattern)
        }) {
            // The child names a region the parent has explicitly subtracted.
            return false;
        }
        self.include_patterns
            .iter()
            .all(|pattern| region_within(pattern, parent))
    }

    /// Builds the scope a child node inherits when it was not given an explicit slice.
    ///
    /// Inheritance is by tier, not by pattern copy: the child starts at the parent's paths and may
    /// then narrow. Copying the patterns verbatim would make every card of a cell identical, which
    /// defeats the purpose of slicing in the first place.
    ///
    /// The returned scope is *whole at the narrower tier*, which is deliberately not the same claim
    /// as "may see everything". Its visibility is the intersection with its ancestors, computed on
    /// demand by [`Self::admits_within`], so a child can be created before its slice is known and
    /// still never exceed its line.
    #[must_use]
    pub fn descendant(&self) -> Option<Self> {
        Some(Self::whole(self.tier.child()?))
    }

    /// Returns the scope a child should hold when it was created by `self` and given no slice.
    ///
    /// Distinct from [`Self::descendant`] in that the result is a *usable* record: it carries the
    /// ancestor's patterns forward so the child's own [`Self::admits`] already reflects its line.
    /// A child that later narrows calls [`Self::narrow_to`].
    #[must_use]
    pub fn inheriting(&self) -> Option<Self> {
        Some(Self {
            tier: self.tier.child()?,
            include_patterns: self.include_patterns.clone(),
            exclude_patterns: self.exclude_patterns.clone(),
        })
    }

    /// Replaces this scope's patterns with a narrower set, refusing to widen.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] when `include` claims any region the current scope
    /// does not already hold.
    pub fn narrow_to(&mut self, include: Vec<String>, exclude: Vec<String>) -> FractalResult<()> {
        let candidate = Self {
            tier: self.tier,
            include_patterns: include,
            exclude_patterns: exclude,
        };
        if !candidate.covers(self) {
            return Err(FractalError::PolicyViolation(
                "narrowed scope claims a region its previous scope did not hold".to_string(),
            ));
        }
        self.include_patterns = candidate.include_patterns;
        self.exclude_patterns = candidate.exclude_patterns;
        Ok(())
    }

    /// Reports whether `path` is visible here **and** visible to `ancestor`.
    ///
    /// The intersection is computed on demand rather than stored, so a parent narrowing its slice
    /// takes effect for every descendant without rewriting their records.
    #[must_use]
    pub fn admits_within(&self, path: &str, ancestor: &Self) -> bool {
        self.admits(path) && ancestor.admits(path)
    }

    /// Verifies that this scope does not claim anything `parent` cannot see.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::TopologyBreach`] when the tier nesting or the path containment is
    /// violated, naming both tiers so the operator can see which record is wrong.
    pub fn assert_within(&self, parent: &Self) -> FractalResult<()> {
        if !self.tier.is_within(parent.tier) || self.tier == parent.tier {
            return Err(FractalError::TopologyBreach {
                source_ref: parent.tier.as_str().to_string(),
                target_ref: self.tier.as_str().to_string(),
                reason: "a projection must sit strictly below the projection it was cut from"
                    .to_string(),
            });
        }
        if !self.covers(parent) {
            return Err(FractalError::TopologyBreach {
                source_ref: parent.tier.as_str().to_string(),
                target_ref: self.tier.as_str().to_string(),
                reason: "projection claims paths its parent does not hold".to_string(),
            });
        }
        Ok(())
    }
}
