//! Module: fg-topology — Conflict Tree Manager & Dual-Mode Presentation
//! File Path: crates/fg-topology/src/conflict_tree.rs
//! Architecture Role: Manages unmerged stage entries (Base/Ours/Theirs) and renders conflict
//!   slices across Agent-Algebraic, Git-Compatible, and Diff3 modes.
//! Dependencies & Triggers: Consumed by merge, rebase, and checkout commands; integrates with
//!   TAXC container INDX section and CLI JSON diagnostic output.
//! Responsibilities: Track multi-stage conflict slices, provide deterministic conflict marker
//!   renderers, and support resolution strategies.
//! Exit Semantics & Design Rationale:
//!   - AgentAlgebraic preserves clean, compilable working tree files while emitting structured
//!     conflict slices, preventing broken AST states for autonomous SubAgents.
//!   - GitCompat and Diff3 strictly adhere to standard Git marker specifications (`<<<<<<<`, `=======`, `>>>>>>>`).
//!   - Zero transient heap allocations inside iteration loops.

use std::collections::BTreeMap;

use fg_core::models::{ConflictPresentationMode, FileMode, Oid};
use serde::{Deserialize, Serialize};

/// Detailed conflict slice report designed for headless Agent consumption.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentConflictSliceReport {
    /// Conflicted repository path.
    pub path: String,
    /// Active presentation mode.
    pub mode: String,
    /// Base (common ancestor) blob OID if available.
    pub base_oid: Option<String>,
    /// Ours (current branch) blob OID if available.
    pub ours_oid: Option<String>,
    /// Theirs (incoming branch) blob OID if available.
    pub theirs_oid: Option<String>,
    /// Byte length of ours content.
    pub ours_len: usize,
    /// Byte length of theirs content.
    pub theirs_len: usize,
    /// Machine status tag.
    pub status: String,
}

/// Represents one unmerged file path across stages 1, 2, and 3.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictSlice {
    /// Conflicted path.
    pub path: String,
    /// File mode.
    pub mode: FileMode,
    /// Common ancestor OID (Stage 1).
    pub base_oid: Option<Oid>,
    /// Current branch OID (Stage 2).
    pub ours_oid: Option<Oid>,
    /// Incoming branch OID (Stage 3).
    pub theirs_oid: Option<Oid>,
}

impl ConflictSlice {
    /// Creates a new conflict slice.
    pub fn new(
        path: impl Into<String>,
        mode: FileMode,
        base_oid: Option<Oid>,
        ours_oid: Option<Oid>,
        theirs_oid: Option<Oid>,
    ) -> Self {
        Self {
            path: path.into(),
            mode,
            base_oid,
            ours_oid,
            theirs_oid,
        }
    }

    /// Generates structured agent diagnostic report.
    pub fn to_agent_report(&self, ours_len: usize, theirs_len: usize) -> AgentConflictSliceReport {
        AgentConflictSliceReport {
            path: self.path.clone(),
            mode: ConflictPresentationMode::AgentAlgebraic
                .as_str()
                .to_string(),
            base_oid: self.base_oid.map(|o| o.to_hex()),
            ours_oid: self.ours_oid.map(|o| o.to_hex()),
            theirs_oid: self.theirs_oid.map(|o| o.to_hex()),
            ours_len,
            theirs_len,
            status: "unmerged_algebraic".to_string(),
        }
    }
}

/// In-memory manager for unmerged stage conflicts during merges and rebases.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ConflictTreeManager {
    conflicts: BTreeMap<String, ConflictSlice>,
}

impl ConflictTreeManager {
    /// Creates an empty manager.
    pub fn new() -> Self {
        Self {
            conflicts: BTreeMap::new(),
        }
    }

    /// Records or updates an unmerged conflict entry.
    pub fn record_conflict(
        &mut self,
        path: impl Into<String>,
        mode: FileMode,
        base_oid: Option<Oid>,
        ours_oid: Option<Oid>,
        theirs_oid: Option<Oid>,
    ) {
        let p = path.into();
        self.conflicts.insert(
            p.clone(),
            ConflictSlice::new(p, mode, base_oid, ours_oid, theirs_oid),
        );
    }

    /// Returns a reference to all recorded conflict slices.
    pub fn conflicts(&self) -> &BTreeMap<String, ConflictSlice> {
        &self.conflicts
    }

    /// Reports whether unresolved conflicts exist.
    pub fn has_conflicts(&self) -> bool {
        !self.conflicts.is_empty()
    }

    /// Count of active conflict slices.
    pub fn conflict_count(&self) -> usize {
        self.conflicts.len()
    }

    /// Resolves conflict by selecting the current branch (ours).
    pub fn resolve_ours(&mut self, path: &str) -> Option<Oid> {
        let slice = self.conflicts.remove(path)?;
        slice.ours_oid
    }

    /// Resolves conflict by selecting the incoming branch (theirs).
    pub fn resolve_theirs(&mut self, path: &str) -> Option<Oid> {
        let slice = self.conflicts.remove(path)?;
        slice.theirs_oid
    }

    /// Resolves conflict with a custom synthesized OID.
    pub fn resolve_custom(&mut self, path: &str) -> bool {
        self.conflicts.remove(path).is_some()
    }

    /// Renders file content according to the selected presentation mode.
    ///
    /// For [`ConflictPresentationMode::AgentAlgebraic`], returns `ours` content untouched
    /// so the workspace remains clean and compilable.
    /// For [`ConflictPresentationMode::GitCompat`], renders 2-way markers (`<<<<<<<`, `=======`, `>>>>>>>`).
    /// For [`ConflictPresentationMode::Diff3`], renders 3-way markers (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`).
    pub fn render_content(
        mode: ConflictPresentationMode,
        base: &[u8],
        ours: &[u8],
        theirs: &[u8],
        our_label: &str,
        their_label: &str,
    ) -> Vec<u8> {
        match mode {
            ConflictPresentationMode::AgentAlgebraic => ours.to_vec(),
            ConflictPresentationMode::GitCompat => {
                Self::render_git_compat(ours, theirs, our_label, their_label)
            }
            ConflictPresentationMode::Diff3 => {
                Self::render_diff3(base, ours, theirs, our_label, "base", their_label)
            }
        }
    }

    /// Formats 2-way Git-compatible conflict markers into byte buffer.
    pub fn render_git_compat(
        ours: &[u8],
        theirs: &[u8],
        our_label: &str,
        their_label: &str,
    ) -> Vec<u8> {
        let mut out = Vec::with_capacity(ours.len() + theirs.len() + 128);
        out.extend_from_slice(b"<<<<<<< ");
        out.extend_from_slice(our_label.as_bytes());
        out.push(b'\n');
        out.extend_from_slice(ours);
        if !ours.ends_with(b"\n") && !ours.is_empty() {
            out.push(b'\n');
        }
        out.extend_from_slice(b"=======\n");
        out.extend_from_slice(theirs);
        if !theirs.ends_with(b"\n") && !theirs.is_empty() {
            out.push(b'\n');
        }
        out.extend_from_slice(b">>>>>>> ");
        out.extend_from_slice(their_label.as_bytes());
        out.push(b'\n');
        out
    }

    /// Formats 3-way Git diff3 conflict markers into byte buffer.
    pub fn render_diff3(
        base: &[u8],
        ours: &[u8],
        theirs: &[u8],
        our_label: &str,
        base_label: &str,
        their_label: &str,
    ) -> Vec<u8> {
        let mut out = Vec::with_capacity(base.len() + ours.len() + theirs.len() + 160);
        out.extend_from_slice(b"<<<<<<< ");
        out.extend_from_slice(our_label.as_bytes());
        out.push(b'\n');
        out.extend_from_slice(ours);
        if !ours.ends_with(b"\n") && !ours.is_empty() {
            out.push(b'\n');
        }
        out.extend_from_slice(b"||||||| ");
        out.extend_from_slice(base_label.as_bytes());
        out.push(b'\n');
        out.extend_from_slice(base);
        if !base.ends_with(b"\n") && !base.is_empty() {
            out.push(b'\n');
        }
        out.extend_from_slice(b"=======\n");
        out.extend_from_slice(theirs);
        if !theirs.ends_with(b"\n") && !theirs.is_empty() {
            out.push(b'\n');
        }
        out.extend_from_slice(b">>>>>>> ");
        out.extend_from_slice(their_label.as_bytes());
        out.push(b'\n');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::ConflictTreeManager;
    use fg_core::models::{ConflictPresentationMode, FileMode, Oid};

    fn dummy_oid(byte: u8) -> Oid {
        let mut bytes = [0u8; 20];
        bytes[0] = byte;
        Oid::from_bytes(bytes)
    }

    #[test]
    fn manager_records_and_resolves_conflicts() {
        let mut mgr = ConflictTreeManager::new();
        assert!(!mgr.has_conflicts());

        mgr.record_conflict(
            "src/lib.rs",
            FileMode::RegularFile,
            Some(dummy_oid(1)),
            Some(dummy_oid(2)),
            Some(dummy_oid(3)),
        );

        assert!(mgr.has_conflicts());
        assert_eq!(mgr.conflict_count(), 1);

        let slice = mgr.conflicts().get("src/lib.rs").expect("slice");
        assert_eq!(slice.base_oid, Some(dummy_oid(1)));
        assert_eq!(slice.ours_oid, Some(dummy_oid(2)));
        assert_eq!(slice.theirs_oid, Some(dummy_oid(3)));

        let report = slice.to_agent_report(10, 20);
        assert_eq!(report.status, "unmerged_algebraic");
        assert_eq!(report.ours_len, 10);
        assert_eq!(report.theirs_len, 20);

        let resolved = mgr.resolve_ours("src/lib.rs");
        assert_eq!(resolved, Some(dummy_oid(2)));
        assert!(!mgr.has_conflicts());
    }

    #[test]
    fn agent_algebraic_preserves_clean_ours_content() {
        let ours = b"fn main() { println!(\"clean\"); }\n";
        let theirs = b"fn main() { println!(\"other\"); }\n";
        let base = b"fn main() {}\n";

        let rendered = ConflictTreeManager::render_content(
            ConflictPresentationMode::AgentAlgebraic,
            base,
            ours,
            theirs,
            "HEAD",
            "feature",
        );
        assert_eq!(rendered, ours, "AgentAlgebraic must leave file clean");
    }

    #[test]
    fn git_compat_renders_standard_markers() {
        let ours = b"ours_line\n";
        let theirs = b"theirs_line\n";
        let base = b"base_line\n";

        let rendered = ConflictTreeManager::render_content(
            ConflictPresentationMode::GitCompat,
            base,
            ours,
            theirs,
            "HEAD",
            "feature",
        );
        let text = String::from_utf8(rendered).expect("utf8");
        assert!(text.contains("<<<<<<< HEAD\nours_line\n=======\ntheirs_line\n>>>>>>> feature\n"));
    }

    #[test]
    fn diff3_renders_ancestor_section() {
        let ours = b"ours\n";
        let theirs = b"theirs\n";
        let base = b"ancestor\n";

        let rendered = ConflictTreeManager::render_content(
            ConflictPresentationMode::Diff3,
            base,
            ours,
            theirs,
            "HEAD",
            "feature",
        );
        let text = String::from_utf8(rendered).expect("utf8");
        assert!(text.contains(
            "<<<<<<< HEAD\nours\n||||||| base\nancestor\n=======\ntheirs\n>>>>>>> feature\n"
        ));
    }
}
