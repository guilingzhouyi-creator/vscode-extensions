//! Module: fg-gate — Commit Section Slot Resolution
//! File Path: crates/fg-gate/src/commit_guard/sections.rs
//! Architecture Role: Turns the free-form `[Heading]` blocks of a commit body into a typed set
//!   of semantic slots, independent of the language the author chose to write the heading in.
//! Dependencies & Triggers: Consumed by `commit_guard::verify` when checking required sections,
//!   ordering and duplicates.
//! Responsibilities: Recognize bilingual headings, tolerate the `[Project / 项目归属]` dual-name
//!   form, collect each slot's content, and detect duplicate or out-of-order declarations.
//! Exit Semantics & Design Rationale: Recognition is a closed mapping, not a substring guess.
//!   Comparing raw heading text was the reason `[Project / 项目归属]` and `[动机]` were rejected
//!   even though the authoring template told people to write exactly that, so a heading now
//!   resolves to a slot or to nothing at all.
//!
//! Domain Governance Rules: FGT-MSG-002 (section topology), FGT-MSG-006 (empty sections).

use std::collections::BTreeMap;

/// Semantic slot a heading names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SectionSlot {
    /// Project ownership declaration.
    Project = 0,
    /// Motivation and background.
    Why = 1,
    /// Added content.
    Added = 2,
    /// Changed content.
    Changed = 3,
    /// Removed content.
    Removed = 4,
    /// Fixed defect.
    Fixed = 5,
    /// Breaking change notice.
    Breaking = 6,
    /// Verification conclusion.
    Verification = 7,
}

impl SectionSlot {
    /// Whether this slot describes a change rather than rationale or verification.
    ///
    /// `Added`, `Changed`, `Removed` and `Fixed` are interchangeable for the purpose of satisfying
    /// "describe what changed": a fix-only commit that says nothing under `[Changed]` is still
    /// complete, because the omission is the point of a fix.
    pub const fn is_change_group(self) -> bool {
        matches!(
            self,
            Self::Added | Self::Changed | Self::Removed | Self::Fixed
        )
    }

    /// Canonical English name used in diagnostics.
    pub const fn canonical_name(self) -> &'static str {
        match self {
            Self::Project => "Project",
            Self::Why => "Why",
            Self::Added => "Added",
            Self::Changed => "Changed",
            Self::Removed => "Removed",
            Self::Fixed => "Fixed",
            Self::Breaking => "Breaking Changes",
            Self::Verification => "Verification",
        }
    }

    /// Topological rank used for ordering checks.
    ///
    /// `Added`, `Changed`, `Removed` and `Fixed` share one rank because a commit legitimately
    /// carries any subset of them in any order; only the coarse Project -> Why -> change ->
    /// Verification progression is contractual.
    pub const fn rank(self) -> u8 {
        match self {
            Self::Project => 1,
            Self::Why => 2,
            Self::Added | Self::Changed | Self::Removed | Self::Fixed => 3,
            Self::Breaking => 4,
            Self::Verification => 5,
        }
    }

    /// Returns every heading spelling that resolves to this slot.
    pub const fn aliases(self) -> &'static [&'static str] {
        match self {
            Self::Project => &["project", "项目", "项目归属"],
            Self::Why => &["why", "动机", "背景", "动机背景"],
            Self::Added => &["added", "新增", "新增内容"],
            Self::Changed => &["changed", "变更", "变更调整", "修改", "调整"],
            Self::Removed => &["removed", "删除", "移除"],
            Self::Fixed => &["fixed", "修复", "修复缺陷"],
            Self::Breaking => &["breaking changes", "breaking change", "破坏性变更"],
            Self::Verification => &["verification", "验证", "验证结论"],
        }
    }
}

/// One declared section: which slot it names plus the content that followed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeclaredSection {
    /// Resolved semantic slot, or `None` when the heading is a local extension.
    pub slot: Option<SectionSlot>,
    /// Heading text exactly as written, used for diagnostics.
    pub heading: String,
    /// Body lines belonging to this heading, already trimmed.
    pub lines: Vec<String>,
}

impl DeclaredSection {
    /// Number of non-whitespace characters carried by this section.
    pub fn substantive_chars(&self) -> usize {
        self.lines
            .iter()
            .flat_map(|line| line.chars())
            .filter(|character| !character.is_whitespace())
            .count()
    }

    /// Whether the section carries any content at all.
    pub fn is_empty_shell(&self) -> bool {
        self.substantive_chars() == 0
    }
}

/// Result of scanning a commit body.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SectionScan {
    /// Sections in the order they were declared.
    pub declared: Vec<DeclaredSection>,
}

impl SectionScan {
    /// Scans body lines into declared sections.
    ///
    /// A heading line is `[` ... `]` optionally followed by a colon and inline content. Text before
    /// the first heading is ignored, matching how Git readers treat a preamble.
    pub fn parse(body_lines: &[&str]) -> Self {
        let mut declared: Vec<DeclaredSection> = Vec::with_capacity(body_lines.len().min(16));
        for raw_line in body_lines {
            let line = raw_line.trim();
            if line.is_empty() {
                continue;
            }
            match split_heading(line) {
                Some((heading, inline)) => {
                    let slot = resolve_slot(&heading);
                    // The inline payload is pushed only when present, and the vector is sized for
                    // the common case of zero or one trailing line, so no allocation happens for a
                    // heading with no inline content.
                    let mut lines = Vec::with_capacity(usize::from(!inline.is_empty()));
                    if !inline.is_empty() {
                        lines.push(inline);
                    }
                    declared.push(DeclaredSection {
                        slot,
                        heading,
                        lines,
                    });
                }
                None => {
                    if let Some(current) = declared.last_mut() {
                        current.lines.push(line.to_string());
                    }
                }
            }
        }
        Self { declared }
    }

    /// Returns the first section declaring `slot`.
    pub fn find(&self, slot: SectionSlot) -> Option<&DeclaredSection> {
        self.declared
            .iter()
            .find(|section| section.slot == Some(slot))
    }

    /// Whether any section declares `slot` with content.
    pub fn has_slot(&self, slot: SectionSlot) -> bool {
        self.find(slot)
            .is_some_and(|section| !section.is_empty_shell())
    }

    /// Whether any of the change-description slots carries content.
    pub fn has_change_slot(&self) -> bool {
        [
            SectionSlot::Added,
            SectionSlot::Changed,
            SectionSlot::Removed,
            SectionSlot::Fixed,
        ]
        .into_iter()
        .any(|slot| self.has_slot(slot))
    }

    /// Returns headings that appear more than once, as `(slot, first heading text)`.
    pub fn duplicate_slots(&self) -> Vec<(SectionSlot, String)> {
        let mut seen: BTreeMap<SectionSlot, String> = BTreeMap::new();
        let mut duplicates: BTreeMap<SectionSlot, String> = BTreeMap::new();
        for section in &self.declared {
            let Some(slot) = section.slot else {
                continue;
            };
            if let Some(first) = seen.get(&slot) {
                duplicates.entry(slot).or_insert_with(|| first.clone());
            } else {
                seen.insert(slot, section.heading.clone());
            }
        }
        duplicates.into_iter().collect()
    }

    /// Returns the first ordering violation as `(out_of_place, must_come_after)`.
    pub fn first_ordering_violation(&self) -> Option<(&str, &str)> {
        let mut highest_rank = 0u8;
        let mut highest_heading = "";
        for section in &self.declared {
            let Some(slot) = section.slot else {
                continue;
            };
            let rank = slot.rank();
            if rank < highest_rank {
                return Some((section.heading.as_str(), highest_heading));
            }
            if rank >= highest_rank {
                highest_rank = rank;
                highest_heading = section.heading.as_str();
            }
        }
        None
    }

    /// Headings that name no known slot, for diagnostics only.
    pub fn unknown_headings(&self) -> Vec<&str> {
        self.declared
            .iter()
            .filter(|section| section.slot.is_none())
            .map(|section| section.heading.as_str())
            .collect()
    }
}

/// Resolves a policy's required-section name to a slot.
///
/// Policies name their obligations in the authoring vocabulary ("Project", "Why", "Changed",
/// "Verification"). Unknown names return `None` so the caller can fall back to a literal match
/// instead of silently treating an unrecognized obligation as satisfied.
pub fn resolve_required_slot(required: &str) -> Option<SectionSlot> {
    resolve_slot(required)
}

/// Splits a heading line into its resolved name and any inline content.
///
/// Both `[Project] a, b` and `[Project: a, b]` are accepted, and the dual-name template form
/// `[Project / 项目归属]` is reduced to the part before the separator for slot resolution.
fn split_heading(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix('[')?;
    let close = rest.find(']')?;
    let inner = rest[..close].trim();
    if inner.is_empty() {
        return None;
    }
    let after = rest[close + 1..].trim().trim_start_matches(':').trim();
    let (name, inline) = match inner.find(':') {
        Some(colon) => {
            let head = inner[..colon].trim();
            let tail = inner[colon + 1..].trim();
            if tail.is_empty() {
                (head, after)
            } else {
                (head, tail)
            }
        }
        None => (inner, after),
    };
    Some((name.to_string(), inline.to_string()))
}

/// Resolves a heading name to a slot, tolerating the dual-name template form.
fn resolve_slot(heading: &str) -> Option<SectionSlot> {
    const ALL: &[SectionSlot] = &[
        SectionSlot::Project,
        SectionSlot::Why,
        SectionSlot::Added,
        SectionSlot::Changed,
        SectionSlot::Removed,
        SectionSlot::Fixed,
        SectionSlot::Breaking,
        SectionSlot::Verification,
    ];
    let normalized = heading
        .replace(['/', '|', '，', ','], " ")
        .replace("  ", " ")
        .trim()
        .to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    for slot in ALL {
        for alias in slot.aliases() {
            if normalized == *alias {
                return Some(*slot);
            }
        }
    }
    // A dual-name heading such as "Project / 项目归属" splits into tokens; accept the heading when
    // every token belongs to one slot, which is exactly the template's intent.
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    if tokens.len() < 2 {
        return None;
    }
    let mut matched: Option<SectionSlot> = None;
    for token in tokens {
        let slot = ALL
            .iter()
            .copied()
            .find(|candidate| candidate.aliases().iter().any(|alias| alias == &token))?;
        match matched {
            None => matched = Some(slot),
            Some(existing) if existing == slot => {}
            Some(_) => return None,
        }
    }
    matched
}
