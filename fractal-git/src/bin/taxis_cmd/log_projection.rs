//! Module: taxis_cmd::log_projection — Slice Verdicts for `taxis log`
//! File Path: src/bin/taxis_cmd/log_projection.rs
//! Architecture Role: Bridges `fg-algorithms`' projection classifier to the CLI's already-parsed
//!   commit records, so `--scope` can label commits without re-reading the graph.
//! Dependencies & Triggers: Called by `log::handle_log` when the caller passed `--scope`.
//! Responsibilities: Answer "did this commit change anything in my slice" per record, and report
//!   how many commits are present but outside it.
//! Exit Semantics & Design Rationale:
//!   - The verdict is computed from the records the walk already produced. Re-walking to classify
//!     would double the object reads of the one command that most needs to stay fast.
//!   - A commit whose tree cannot be read is classified `Visible`, not `OutsideScope`. Reporting a
//!     corrupt commit as "nothing changed here" would hide damage behind a slice boundary.
//!   - The number of out-of-scope commits is printed even when the caller did not ask for it. A
//!     slice that silently drops 97 percent of the history looks exactly like a quiet repository,
//!     and those two situations call for opposite decisions.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-ALG-001`: DAG traversal and generation pruning
//! - `FGT-COR-001`: Core data model and error contract guard

use std::collections::HashMap;

use fg_algorithms::traverse::FlattenedTreeEntry;
use fg_core::models::{Oid, ProjectionScope};

use super::commit_walk::CommitRecord;
use super::repo_view::RepoView;

/// One record's verdict against a slice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SliceVerdict {
    /// The commit changed at least one path the scope admits.
    Visible,
    /// The commit is present and reachable but changed nothing the scope admits.
    OutsideScope,
}

/// Per-commit verdicts plus the totals a caller needs to report honestly.
pub(crate) struct SliceReport {
    /// Verdict for every record, in the order the records arrived.
    pub(crate) verdicts: Vec<SliceVerdict>,
    /// Commits that changed something inside the slice.
    pub(crate) visible: usize,
    /// Commits that exist but changed nothing inside it.
    pub(crate) outside: usize,
}

impl SliceReport {
    /// Renders the one-line summary printed below the history.
    ///
    /// Always printed, never conditional: the whole point is that a reader cannot mistake a slice
    /// for the complete history.
    pub(crate) fn summary(&self, scope: &ProjectionScope) -> String {
        let patterns = if scope.is_whole() {
            "the whole tree".to_string()
        } else {
            scope.include_patterns.join(", ")
        };
        format!(
            "slice {} ({}): {} visible, {} present but outside",
            scope.tier.as_str(),
            patterns,
            self.visible,
            self.outside
        )
    }
}

/// Classifies every record against `scope`.
///
/// Trees are flattened once per distinct tree id, and only the directories the slice can reach are
/// opened, so a narrow slice over a large history reads a small part of it.
pub(crate) fn classify_records(
    view: &RepoView,
    records: &[CommitRecord],
    scope: &ProjectionScope,
) -> SliceReport {
    let mut flattened: HashMap<Oid, std::collections::BTreeMap<String, FlattenedTreeEntry>> =
        HashMap::new();
    let mut verdicts = Vec::with_capacity(records.len());
    let mut visible = 0usize;

    for record in records {
        // Flatten the commit's own tree first, then classify. Holding the returned reference across
        // the classification would keep the cache mutably borrowed while it is read again for the
        // parents, which the borrow checker refuses — and rightly: the cache grows during that call.
        flatten_full(view, &mut flattened, &record.tree);
        // Flatten every parent up front so the comparison below borrows the cache immutably only.
        // Growing the cache mid-comparison would invalidate the reference to the commit's own tree.
        let parent_trees: Vec<Oid> = record
            .parents
            .iter()
            .filter_map(|parent| parent_tree_of(view, parent))
            .collect();
        for tree in &parent_trees {
            flatten_full(view, &mut flattened, tree);
        }
        let verdict = classify_one(&flattened, record, &parent_trees, scope);
        if verdict == SliceVerdict::Visible {
            visible += 1;
        }
        verdicts.push(verdict);
    }

    SliceReport {
        verdicts,
        visible,
        outside: records.len() - visible,
    }
}

/// Flattens a tree completely, ignoring the slice.
///
/// Visibility cannot be decided from a pruned view. Pruning keeps only the paths the scope admits,
/// so a commit that changed `docs/` and one that changed nothing both arrive here as the same
/// single-entry map, and every comparison reports "no change". The diff has to see the whole tree;
/// pruning belongs to enumeration ("what is in my slice"), not to authorship.
fn flatten_full(
    view: &RepoView,
    cache: &mut HashMap<Oid, std::collections::BTreeMap<String, FlattenedTreeEntry>>,
    tree: &Oid,
) {
    if cache.contains_key(tree) {
        return;
    }
    let mut entries = std::collections::BTreeMap::new();
    let mut payload_of =
        |oid: &Oid| -> fg_core::error::FractalResult<Vec<u8>> { Ok(view.object(oid)?.payload) };
    // An unrestricted scope makes `may_contain` accept every directory and `admits` accept every
    // path, so the same traversal yields the whole tree without a second implementation.
    let whole =
        fg_core::models::ProjectionScope::whole(fg_core::models::ProjectionTier::SystemTrunk);
    if flatten_scope_pruned(tree, "", &mut payload_of, &whole, &mut entries).is_ok() {
        cache.insert(*tree, entries);
    }
}

/// Flattens a tree, skipping every directory the scope cannot reach.
///
/// The CLI carries its own copy rather than reaching into `fg-algorithms`' private helper: only the
/// published `flatten_tree_with` is exported, and exporting a second flattening routine would give
/// two public paths that must stay behaviourally identical. The pruning decision itself is the
/// scope's, so the two implementations cannot disagree about what a slice contains.
fn flatten_scope_pruned<F>(
    tree_oid: &Oid,
    prefix: &str,
    payload_of: &mut F,
    scope: &ProjectionScope,
    flat: &mut std::collections::BTreeMap<String, FlattenedTreeEntry>,
) -> fg_core::error::FractalResult<()>
where
    F: FnMut(&Oid) -> fg_core::error::FractalResult<Vec<u8>>,
{
    let mut path = String::from(prefix);
    descend(tree_oid, &mut path, payload_of, scope, flat)
}

fn descend<F>(
    tree_oid: &Oid,
    path: &mut String,
    payload_of: &mut F,
    scope: &ProjectionScope,
    flat: &mut std::collections::BTreeMap<String, FlattenedTreeEntry>,
) -> fg_core::error::FractalResult<()>
where
    F: FnMut(&Oid) -> fg_core::error::FractalResult<Vec<u8>>,
{
    let payload = payload_of(tree_oid)?;
    for entry in fg_object::GitTreeRef::from_bytes(&payload).iter() {
        let entry = entry?;
        let prev = path.len();
        if !path.is_empty() {
            path.push('/');
        }
        path.push_str(entry.name);
        if entry.mode.is_tree() {
            if scope.may_contain(path) {
                let nested = descend(&entry.oid, path, payload_of, scope, flat);
                path.truncate(prev);
                nested?;
            } else {
                path.truncate(prev);
            }
            continue;
        }
        if scope.admits(path) {
            flat.insert(
                path.clone(),
                FlattenedTreeEntry {
                    mode: entry.mode,
                    oid: entry.oid,
                },
            );
        }
        path.truncate(prev);
    }
    Ok(())
}

fn classify_one(
    cache: &HashMap<Oid, std::collections::BTreeMap<String, FlattenedTreeEntry>>,
    record: &CommitRecord,
    parent_trees: &[Oid],
    scope: &ProjectionScope,
) -> SliceVerdict {
    let Some(own) = cache.get(&record.tree) else {
        return SliceVerdict::Visible;
    };

    // A single parent whose tree is identical means the commit reused that snapshot. Applied to
    // single-parent commits only: a merge's tree often equals one parent's precisely because the
    // merge took that side, yet it still changed the other side.
    if record.parents.len() == 1 && parent_trees.first() == Some(&record.tree) {
        return SliceVerdict::OutsideScope;
    }

    if parent_trees.is_empty() {
        return verdict_for_diff(own, None, scope);
    }

    for tree in parent_trees {
        if verdict_for_diff(own, cache.get(tree), scope) == SliceVerdict::Visible {
            return SliceVerdict::Visible;
        }
    }
    SliceVerdict::OutsideScope
}

/// Returns the tree id of `parent`.
///
/// The walk's records are not consulted: a parent outside them was dropped by `--max-count`, and
/// reading the commit directly is the only way to compare against it. Returning `None` there would
/// compare every first commit against nothing and mark it visible, which is the failure this
/// function exists to avoid.
fn parent_tree_of(view: &RepoView, parent: &Oid) -> Option<Oid> {
    let object = view.object(parent).ok()?;
    if object.kind != fg_core::models::ObjectKind::Commit {
        return None;
    }
    fg_algorithms::traverse::commit_tree_oid(&object.payload).ok()
}

fn verdict_for_diff(
    own: &std::collections::BTreeMap<String, FlattenedTreeEntry>,
    parent: Option<&std::collections::BTreeMap<String, FlattenedTreeEntry>>,
    scope: &ProjectionScope,
) -> SliceVerdict {
    let Some(parent) = parent else {
        return if own.keys().any(|path| scope.admits(path)) {
            SliceVerdict::Visible
        } else {
            SliceVerdict::OutsideScope
        };
    };
    for (path, entry) in own {
        if scope.admits(path) && parent.get(path) != Some(entry) {
            return SliceVerdict::Visible;
        }
    }
    for path in parent.keys() {
        if scope.admits(path) && !own.contains_key(path) {
            return SliceVerdict::Visible;
        }
    }
    SliceVerdict::OutsideScope
}
