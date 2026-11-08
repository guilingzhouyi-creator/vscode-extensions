//! Module: fg-topology — Promotion Acceptance Writer
//! File Path: crates/fg-topology/src/acceptance.rs
//! Architecture Role: Materializes a promotion acceptance as a real commit object so an upper
//!   tier's history grows by one entry per acceptance instead of absorbing every nested commit.
//! Dependencies & Triggers: Called by `PromotionStagingLedger::apply_elevation_approval`.
//! Responsibilities: Read the candidate commit, refuse no-op acceptances, render and persist the
//!   summary commit, and report the resulting object id.
//! Exit Semantics & Design Rationale:
//!   - The object store is taken as the `OdbStore` trait rather than a concrete backend so this
//!     layer stays free of storage-engine detail; the caller decides where objects live.
//!   - A candidate that cannot be read is an error, never a silent acceptance. Advancing a trunk to
//!     an unreadable commit would publish a reference no reader can resolve.
//!   - The candidate's own tree is copied into the summary, so the acceptance records exactly the
//!     content the operator approved rather than a re-derived tree.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-TOP-001`: Fractal topology reference guard
//! - `FGT-OBJ-001`: Git object model serialization guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{
    parse_commit_header, parse_loose_header, FoldedRange, ObjectKind, Oid, PromotionSummary,
};
use fg_core::traits::OdbStore;

/// Object type name commit objects are written with.
const COMMIT_TYPE: &str = "commit";

/// Reads a commit object and returns its parsed header.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when the object is absent, is not a commit, or carries a
/// malformed header.
pub fn read_commit_header(odb: &impl OdbStore, oid: &Oid) -> FractalResult<fg_core::models::CommitHeader> {
    let raw = odb.read_object(oid)?;
    let (kind, payload) = parse_loose_header(&raw)?;
    if kind != ObjectKind::Commit {
        return Err(FractalError::ObjectCodec(format!(
            "{oid} is a {}, not a commit",
            kind.as_str()
        )));
    }
    parse_commit_header(payload)
}

/// Writes a promotion acceptance commit and returns its object id.
///
/// The summary's parent is the tier's current head, so the upper tier advances by exactly one
/// commit per acceptance regardless of how many commits the lower tier accumulated.
///
/// # Errors
///
/// Propagates a failed candidate read, a rejected no-op acceptance, or a failed object write.
pub fn write_acceptance(
    odb: &impl OdbStore,
    request_id: &str,
    source_ref: &str,
    candidate: &Oid,
    parent: Option<Oid>,
) -> FractalResult<Oid> {
    let header = read_commit_header(odb, candidate)?;

    if PromotionSummary::is_duplicate(header.tree, parent_tree(odb, &parent)?) {
        return Err(FractalError::PolicyViolation(format!(
            "promotion of {candidate} records no content change over its parent"
        )));
    }

    let summary = PromotionSummary {
        request_id: request_id.to_string(),
        tree: header.tree,
        parent,
        folded: FoldedRange {
            source_ref: source_ref.to_string(),
            from: None,
            to: *candidate,
            covered_commits: 1,
        },
    };

    let payload = summary.render_payload(&header.author, &header.committer)?;
    odb.write_object(COMMIT_TYPE, &payload)
}

/// Reads the root tree of `parent`, or `None` when the tier has no head yet.
///
/// A parent that is named but unreadable is an error: treating it as absent would let the
/// duplicate check pass vacuously and record an acceptance the tier never approved.
fn parent_tree(odb: &impl OdbStore, parent: &Option<Oid>) -> FractalResult<Option<Oid>> {
    match parent {
        Some(oid) => Ok(Some(read_commit_header(odb, oid)?.tree)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use fg_core::models::raw_object;

    /// Minimal in-memory object store covering the read/write pair this module needs.
    #[derive(Default)]
    struct MemoryOdb {
        objects: Mutex<Vec<(Oid, Vec<u8>)>>,
    }

    impl OdbStore for MemoryOdb {
        fn read_object(&self, oid: &Oid) -> FractalResult<Vec<u8>> {
            let objects = self.objects.lock().expect("lock");
            objects
                .iter()
                .find(|(stored, _)| stored == oid)
                .map(|(_, raw)| raw.clone())
                .ok_or_else(|| FractalError::ObjectCodec(format!("object {oid} not found")))
        }

        fn write_object(&self, object_type: &str, payload: &[u8]) -> FractalResult<Oid> {
            let kind = match object_type {
                "commit" => ObjectKind::Commit,
                "tree" => ObjectKind::Tree,
                other => {
                    return Err(FractalError::ObjectCodec(format!(
                        "unsupported test object type {other}"
                    )))
                }
            };
            let oid = fg_core::models::compute_object_oid(kind, payload);
            self.objects
                .lock()
                .expect("lock")
                .push((oid, raw_object(kind, payload)));
            Ok(oid)
        }

        fn has_object(&self, oid: &Oid) -> bool {
            self.objects
                .lock()
                .expect("lock")
                .iter()
                .any(|(stored, _)| stored == oid)
        }
    }

    fn commit_payload(tree: Oid, parent: Option<Oid>) -> Vec<u8> {
        let mut text = format!("tree {tree}\n");
        if let Some(parent) = parent {
            text.push_str(&format!("parent {parent}\n"));
        }
        text.push_str("author A <a@example.com> 1 +0000\n");
        text.push_str("committer A <a@example.com> 1 +0000\n\nsubject\n");
        text.into_bytes()
    }

    fn put(odb: &MemoryOdb, tree: u8, parent: Option<Oid>) -> Oid {
        odb.write_object("commit", &commit_payload(Oid::from_bytes([tree; 20]), parent))
            .expect("write candidate")
    }

    #[test]
    fn an_acceptance_is_a_new_commit_whose_parent_is_the_tier_head() {
        let odb = MemoryOdb::default();
        let first = put(&odb, 0x11, None);
        let second = put(&odb, 0x22, Some(first));

        let accepted = write_acceptance(
            &odb,
            "req-1",
            "refs/fractal/cell/core/main",
            &second,
            Some(first),
        )
        .expect("accept");

        let header = read_commit_header(&odb, &accepted).expect("read acceptance");
        assert_eq!(header.parents, vec![first]);
        assert_eq!(header.tree, Oid::from_bytes([0x22; 20]));
    }

    #[test]
    fn the_first_acceptance_has_no_parent() {
        let odb = MemoryOdb::default();
        let candidate = put(&odb, 0x11, None);

        let accepted =
            write_acceptance(&odb, "req-1", "refs/fractal/cell/core/main", &candidate, None)
                .expect("accept");

        let header = read_commit_header(&odb, &accepted).expect("read acceptance");
        assert!(header.parents.is_empty());
    }

    #[test]
    fn an_acceptance_that_changes_no_content_is_refused() {
        let odb = MemoryOdb::default();
        let head = put(&odb, 0x11, None);
        let same_tree = put(&odb, 0x11, Some(head));

        let err = write_acceptance(
            &odb,
            "req-1",
            "refs/fractal/cell/core/main",
            &same_tree,
            Some(head),
        )
        .expect_err("duplicate must be refused");
        assert!(matches!(err, FractalError::PolicyViolation(_)));
    }

    #[test]
    fn an_absent_candidate_is_an_error_rather_than_an_acceptance() {
        let odb = MemoryOdb::default();
        let absent = Oid::from_bytes([0x99; 20]);
        assert!(write_acceptance(&odb, "req-1", "refs/x", &absent, None).is_err());
    }

    #[test]
    fn an_unreadable_parent_is_an_error() {
        let odb = MemoryOdb::default();
        let candidate = put(&odb, 0x11, None);
        let absent_parent = Oid::from_bytes([0x99; 20]);
        let err = write_acceptance(
            &odb,
            "req-1",
            "refs/fractal/cell/core/main",
            &candidate,
            Some(absent_parent),
        )
        .expect_err("unreadable parent must fail");
        assert!(matches!(err, FractalError::ObjectCodec(_)));
    }
}
