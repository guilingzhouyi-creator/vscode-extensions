//! Module: fg-core — Promotion Summary Commit Model
//! File Path: crates/fg-core/src/models/promotion.rs
//! Architecture Role: Defines the collapsed commit produced when a lower tier promotes into an
//!   upper tier, so the upper tier's DAG records one acceptance rather than every internal commit.
//! Dependencies & Triggers: Consumed by `fg-topology` promotion ledger and telemetry writers.
//! Responsibilities: Carry the folded range, render a deterministic commit payload, and extract the
//!   tree and identity lines a summary needs from a candidate commit's raw payload.
//! Exit Semantics & Design Rationale:
//!   - The upper tier's history length equals its promotion count, which is what makes a bounded
//!     history window meaningful at the trunk. Recording every nested commit there instead would
//!     make the trunk grow with total activity rather than with accepted change.
//!   - Payload rendering is deterministic text, not `serde` output: a commit object's bytes are
//!     what its object id hashes, so the renderer must not depend on map ordering or float form.
//!   - Parsing reads only the header block. The message may contain arbitrary bytes and is never
//!     inspected, so a crafted subject cannot influence which tree is recorded.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-TOP-001`: Fractal topology reference guard
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-OBJ-001`: Git object model serialization guard

use super::oid::Oid;
use crate::error::{FractalError, FractalResult};

/// Prefix identifying a summary commit subject line.
///
/// Written verbatim so a reader can distinguish an acceptance record from an authored commit
/// without consulting the ledger.
pub const PROMOTION_SUMMARY_SUBJECT: &str = "promotion: accept";

/// Hex width of a raw object id inside a commit header.
const OID_HEX_WIDTH: usize = 40;

/// The lower-tier commit range folded into one upper-tier acceptance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoldedRange {
    /// Reference the accepted commits came from, e.g. `refs/fractal/cell/core/main`.
    pub source_ref: String,
    /// Last commit already folded by an earlier acceptance, exclusive. `None` for the first one.
    pub from: Option<Oid>,
    /// Commit being folded by this acceptance, inclusive.
    pub to: Oid,
    /// How many lower-tier commits this acceptance covers.
    pub covered_commits: u32,
}

/// Header fields of a commit object, as far as a summary needs them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitHeader {
    /// Root tree of the commit.
    pub tree: Oid,
    /// Parent commits, in payload order.
    pub parents: Vec<Oid>,
    /// Verbatim `author` line, without the leading keyword.
    pub author: String,
    /// Verbatim `committer` line, without the leading keyword.
    pub committer: String,
}

/// One upper-tier acceptance commit produced by promoting a lower tier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromotionSummary {
    /// Request that produced this acceptance, carried into the subject for traceability.
    pub request_id: String,
    /// Root tree the acceptance records, taken from the promoted candidate.
    pub tree: Oid,
    /// Previous acceptance on this tier, or `None` when this is the tier's first.
    pub parent: Option<Oid>,
    /// Range of lower-tier commits collapsed into this acceptance.
    pub folded: FoldedRange,
}

impl PromotionSummary {
    /// Renders the commit payload (header block, blank line, message) for this acceptance.
    ///
    /// The identity lines are supplied by the caller rather than defaulted here: a summary is a
    /// real commit in a shared object store, and inventing an identity would attribute it to
    /// nobody. Passing the candidate's own lines keeps the acceptance attributable without
    /// requiring this module to parse or synthesize a signature.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] when a supplied identity line is empty or carries a
    /// newline, either of which would inject extra header fields into the payload.
    pub fn render_payload(&self, author: &str, committer: &str) -> FractalResult<Vec<u8>> {
        ensure_single_line("author", author)?;
        ensure_single_line("committer", committer)?;

        let mut payload = String::with_capacity(256);
        payload.push_str("tree ");
        payload.push_str(&self.tree.to_hex());
        payload.push('\n');

        if let Some(parent) = self.parent {
            payload.push_str("parent ");
            payload.push_str(&parent.to_hex());
            payload.push('\n');
        }

        payload.push_str("author ");
        payload.push_str(author);
        payload.push('\n');
        payload.push_str("committer ");
        payload.push_str(committer);
        payload.push_str("\n\n");

        payload.push_str(&self.subject());
        payload.push('\n');
        payload.push_str(&self.body());

        Ok(payload.into_bytes())
    }

    /// First line of the acceptance message.
    #[must_use]
    pub fn subject(&self) -> String {
        format!(
            "{PROMOTION_SUMMARY_SUBJECT} {} from {}",
            self.request_id, self.folded.source_ref
        )
    }

    /// Message body naming the folded range in a fixed field order.
    #[must_use]
    pub fn body(&self) -> String {
        format!(
            "Fold-From: {}\nFold-To: {}\nFold-Count: {}\n",
            self.folded
                .from
                .map_or_else(|| "none".to_string(), |oid| oid.to_hex()),
            self.folded.to.to_hex(),
            self.folded.covered_commits
        )
    }

    /// Reports whether accepting `candidate_tree` over `current_tree` would record no change.
    ///
    /// A promotion whose tree already matches the target's tree adds nothing; recording it would
    /// inflate the acceptance count without changing content, which is exactly the repetition the
    /// upper tier's history is meant to exclude.
    #[must_use]
    pub fn is_duplicate(candidate_tree: Oid, current_tree: Option<Oid>) -> bool {
        current_tree == Some(candidate_tree)
    }
}

/// Parses the header block of a commit payload.
///
/// Only the lines before the first blank line are read. Unknown header keywords are skipped rather
/// than rejected: `gpgsig` and future extensions are legal and carry no meaning here.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when `tree` is absent or malformed, when a `parent` line is
/// malformed, or when the payload has no blank line separating header from message.
pub fn parse_commit_header(payload: &[u8]) -> FractalResult<CommitHeader> {
    let mut tree: Option<Oid> = None;
    let mut parents: Vec<Oid> = Vec::new();
    let mut author: Option<String> = None;
    let mut committer: Option<String> = None;
    let mut saw_separator = false;

    for line in payload.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            saw_separator = true;
            break;
        }
        let line = std::str::from_utf8(line).map_err(|_| {
            FractalError::ObjectCodec("commit header contains non-UTF-8 bytes".into())
        })?;

        if let Some(rest) = line.strip_prefix("tree ") {
            tree = Some(parse_oid_field("tree", rest)?);
        } else if let Some(rest) = line.strip_prefix("parent ") {
            parents.push(parse_oid_field("parent", rest)?);
        } else if let Some(rest) = line.strip_prefix("author ") {
            author = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("committer ") {
            committer = Some(rest.to_string());
        }
    }

    let tree = tree
        .ok_or_else(|| FractalError::ObjectCodec("commit payload has no 'tree' header".into()))?;
    if !saw_separator {
        return Err(FractalError::ObjectCodec(
            "commit payload has no blank line after its header".into(),
        ));
    }

    Ok(CommitHeader {
        tree,
        parents,
        author: author.ok_or_else(|| {
            FractalError::ObjectCodec("commit payload has no 'author' header".into())
        })?,
        committer: committer.ok_or_else(|| {
            FractalError::ObjectCodec("commit payload has no 'committer' header".into())
        })?,
    })
}

/// Parses the hexadecimal object id of a header field.
fn parse_oid_field(field: &str, value: &str) -> FractalResult<Oid> {
    if value.len() != OID_HEX_WIDTH {
        return Err(FractalError::ObjectCodec(format!(
            "'{field}' header must carry {OID_HEX_WIDTH} hex characters, got {}",
            value.len()
        )));
    }
    Oid::from_hex(value)
}

/// Rejects an identity line that would break the header block.
fn ensure_single_line(field: &str, value: &str) -> FractalResult<()> {
    if value.is_empty() {
        return Err(FractalError::ObjectCodec(format!(
            "{field} identity line is empty"
        )));
    }
    if value.contains('\n') || value.contains('\r') {
        return Err(FractalError::ObjectCodec(format!(
            "{field} identity line contains a line break"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(byte: u8) -> Oid {
        Oid::from_bytes([byte; 20])
    }

    fn summary() -> PromotionSummary {
        PromotionSummary {
            request_id: "req-01".into(),
            tree: oid(0x11),
            parent: Some(oid(0x22)),
            folded: FoldedRange {
                source_ref: "refs/fractal/cell/core/main".into(),
                from: Some(oid(0x33)),
                to: oid(0x44),
                covered_commits: 7,
            },
        }
    }

    #[test]
    fn rendered_payload_round_trips_through_the_header_parser() {
        let summary = summary();
        let payload = summary
            .render_payload("A <a@example.com> 1 +0000", "B <b@example.com> 2 +0000")
            .expect("render");

        let header = parse_commit_header(&payload).expect("parse");
        assert_eq!(header.tree, summary.tree);
        assert_eq!(header.parents, vec![oid(0x22)]);
        assert_eq!(header.author, "A <a@example.com> 1 +0000");
        assert_eq!(header.committer, "B <b@example.com> 2 +0000");
    }

    #[test]
    fn a_first_acceptance_renders_no_parent_line() {
        let mut summary = summary();
        summary.parent = None;
        let payload = summary
            .render_payload("A <a@example.com> 1 +0000", "A <a@example.com> 1 +0000")
            .expect("render");

        let header = parse_commit_header(&payload).expect("parse");
        assert!(header.parents.is_empty());
    }

    #[test]
    fn rendering_is_deterministic_across_repeated_calls() {
        let summary = summary();
        let first = summary
            .render_payload("A <a@example.com> 1 +0000", "A <a@example.com> 1 +0000")
            .expect("render");
        let second = summary
            .render_payload("A <a@example.com> 1 +0000", "A <a@example.com> 1 +0000")
            .expect("render");
        assert_eq!(first, second);
    }

    #[test]
    fn an_identity_line_with_a_line_break_is_refused() {
        let summary = summary();
        let err = summary
            .render_payload("A <a@example.com> 1 +0000\ninjected x", "B 2 +0000")
            .expect_err("newline must be refused");
        assert!(matches!(err, FractalError::ObjectCodec(_)));
    }

    #[test]
    fn an_empty_identity_line_is_refused() {
        let summary = summary();
        assert!(summary.render_payload("", "B 2 +0000").is_err());
    }

    #[test]
    fn a_payload_without_a_tree_header_is_rejected() {
        let payload = b"parent 1111111111111111111111111111111111111111\n\nmsg";
        assert!(parse_commit_header(payload).is_err());
    }

    #[test]
    fn a_payload_without_a_blank_separator_is_rejected() {
        let payload = b"tree 1111111111111111111111111111111111111111\n";
        assert!(parse_commit_header(payload).is_err());
    }

    #[test]
    fn a_short_object_id_is_rejected() {
        let payload = b"tree 1111\n\nmsg";
        assert!(parse_commit_header(payload).is_err());
    }

    #[test]
    fn unknown_header_keywords_are_skipped() {
        let payload = b"tree 1111111111111111111111111111111111111111\n\
gpgsig -----BEGIN-----\nauthor A 1 +0000\ncommitter B 2 +0000\n\nmsg";
        // The continuation line of `gpgsig` is unknown and skipped, so the parse still succeeds.
        let header = parse_commit_header(payload).expect("parse");
        assert_eq!(header.author, "A 1 +0000");
    }

    #[test]
    fn a_matching_tree_is_reported_as_duplicate() {
        assert!(PromotionSummary::is_duplicate(oid(0x11), Some(oid(0x11))));
        assert!(!PromotionSummary::is_duplicate(oid(0x11), Some(oid(0x22))));
        assert!(!PromotionSummary::is_duplicate(oid(0x11), None));
    }
}
