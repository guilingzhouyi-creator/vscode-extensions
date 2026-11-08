//! Module: fg-algorithms::traverse::projection — Path-Scoped History Projection
//! File Path: crates/fg-algorithms/src/traverse/projection.rs
//! Architecture Role: Turns one commit graph plus a [`ProjectionScope`] into the view a single
//!   fractal node presents, without altering the graph it came from.
//! Dependencies & Triggers: Consumed by any command that reports history or a diff at a tier below
//!   the system trunk.
//! Responsibilities: Classify each reached commit as visible or present-but-outside-scope, and
//!   report the reachable set so the graph stays whole.
//! Exit Semantics & Design Rationale:
//!   - Every reached commit is kept in the result with its original parents. Splicing an invisible
//!     commit out and reparenting its child would change what the child's hash means, so the
//!     projection would be presenting commits under names that do not describe them. A projection
//!     may hide a node from a view; it may not rewrite the graph.
//!   - "Invisible" is a first-class verdict, not the absence of a verdict. A caller that receives
//!     only the visible commits cannot distinguish "nothing happened here" from "a great deal
//!     happened, elsewhere", and those two answers lead an agent to opposite conclusions.
//!   - Visibility is decided by what a commit changed against its parents, not by what its snapshot
//!     contains. Every commit's tree holds every file, so asking "does the tree contain an admitted
//!     path" marks the whole history visible. The diff is the only signal that identifies authorship.
//!   - A merge is visible when it changed something in scope against *any* parent. A merge that
//!     brings an in-scope change from a side branch is visible on the mainline even though its first
//!     parent already had it.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-ALG-001`: DAG traversal and generation pruning
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocation on hot paths

use std::collections::{BTreeMap, HashMap};

use fg_core::error::FractalResult;
use fg_core::models::{FastOidMap, Oid, ProjectionScope};

use fg_object::GitTreeRef;

use super::tree_flatten::FlattenedTreeEntry;

/// Why a commit appears in a projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionVerdict {
    /// The commit changed at least one path the scope admits.
    Visible,
    /// The commit exists and is reachable, but changed nothing the scope admits.
    OutsideScope,
}

/// One commit's place in a projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedCommit {
    /// Commit identifier.
    pub oid: Oid,
    /// Parents, exactly as recorded. The projection never rewrites these.
    pub parents: Vec<Oid>,
    /// Whether this commit changed anything inside the scope.
    pub verdict: ProjectionVerdict,
}

impl ProjectedCommit {
    /// Reports whether this commit changed anything the scope admits.
    #[must_use]
    pub fn is_visible(&self) -> bool {
        self.verdict == ProjectionVerdict::Visible
    }
}

/// A history as one node sees it.
#[derive(Debug, Clone, Default)]
pub struct Projection {
    /// Every reached commit, in reach order.
    pub commits: Vec<ProjectedCommit>,
}

impl Projection {
    /// Number of commits that changed something inside the scope.
    #[must_use]
    pub fn visible_count(&self) -> usize {
        self.commits
            .iter()
            .filter(|commit| commit.is_visible())
            .count()
    }

    /// Number of commits that are present but invisible here.
    #[must_use]
    pub fn outside_scope_count(&self) -> usize {
        self.commits.len() - self.visible_count()
    }

    /// Reports whether `oid` changed anything inside the scope.
    ///
    /// Returns `None` when the commit was never reached, which is a different answer from `false`.
    #[must_use]
    pub fn verdict_of(&self, oid: &Oid) -> Option<ProjectionVerdict> {
        self.commits
            .iter()
            .find(|commit| commit.oid == *oid)
            .map(|commit| commit.verdict)
    }

    /// Iterates the visible commits in reach order.
    pub fn visible(&self) -> impl Iterator<Item = &ProjectedCommit> {
        self.commits.iter().filter(|commit| commit.is_visible())
    }
}

/// Reads a commit and a tree.
///
/// A trait rather than a concrete store keeps the projection usable from the CLI, from tests, and
/// from any future transport without threading an object database through every signature.
pub trait CommitSource {
    /// Returns `(parents, tree_oid)` for `oid`.
    ///
    /// # Errors
    ///
    /// Returns an error when the commit is unreadable or malformed.
    fn commit(&self, oid: &Oid) -> FractalResult<(Vec<Oid>, Oid)>;

    /// Returns the payload of a tree object.
    ///
    /// # Errors
    ///
    /// Returns an error when the tree is unreadable.
    fn tree(&self, oid: &Oid) -> FractalResult<Vec<u8>>;
}

/// Classifies every commit reachable from `tips` against `scope`.
///
/// The walk is iterative and bounded by the number of commits reached, not by the DAG's depth: a
/// hostile repository can present a chain deeper than the thread stack.
///
/// # Errors
///
/// Propagates a failed commit or tree read. A tree that cannot be read is an error rather than an
/// empty change set: reporting "nothing changed here" for an unreadable tree would silently
/// classify a corrupt commit as invisible.
pub fn project_history<S: CommitSource>(
    tips: &[Oid],
    scope: &ProjectionScope,
    source: &S,
) -> FractalResult<Projection> {
    if tips.is_empty() {
        return Ok(Projection::default());
    }

    // Catalogue the reachable set first so a commit's parents are always resolvable. Classifying
    // during the walk would need the parent's tree before it has been read.
    let mut reached: FastOidMap<(Vec<Oid>, Oid)> = FastOidMap::default();
    let mut stack: Vec<Oid> = tips.to_vec();
    while let Some(oid) = stack.pop() {
        if reached.contains_key(&oid) {
            continue;
        }
        let (parents, tree) = source.commit(&oid)?;
        for parent in &parents {
            if !reached.contains_key(parent) {
                stack.push(*parent);
            }
        }
        reached.insert(oid, (parents, tree));
    }

    // Flatten each distinct tree once. Histories reuse trees heavily, and flattening per commit
    // would re-read the whole working tree for every commit that did not change it.
    //
    // Flattening is scope-pruned: a directory the scope cannot reach is never opened. Without that,
    // a card holding one crate would still read every tree object in the repository just to discard
    // the entries, which makes the whole notion of a slice pointless on a large history.
    let mut flattened: HashMap<Oid, BTreeMap<String, FlattenedTreeEntry>> = HashMap::new();
    for (_, tree) in reached.values() {
        if !flattened.contains_key(tree) {
            let mut entries = BTreeMap::new();
            flatten_tree_pruned(tree, "", &|oid| source.tree(oid), scope, &mut entries)?;
            flattened.insert(*tree, entries);
        }
    }

    let mut commits: Vec<ProjectedCommit> = Vec::with_capacity(reached.len());
    for (oid, (parents, tree)) in &reached {
        let verdict = classify(*tree, parents, &reached, &flattened, scope);
        commits.push(ProjectedCommit {
            oid: *oid,
            parents: parents.clone(),
            verdict,
        });
    }

    Ok(Projection { commits })
}

/// Decides whether a commit authored a change inside the scope.
fn classify(
    tree: Oid,
    parents: &[Oid],
    reached: &FastOidMap<(Vec<Oid>, Oid)>,
    flattened: &HashMap<Oid, BTreeMap<String, FlattenedTreeEntry>>,
    scope: &ProjectionScope,
) -> ProjectionVerdict {
    // A commit whose tree equals its *only* parent's is reusing that snapshot and cannot have
    // authored anything, whatever the scope admits.
    //
    // The single-parent requirement is load-bearing. A merge's tree frequently equals one of its
    // parents' — that is exactly what "took this side" means — yet the merge still changed the
    // mainline against its other parent. Applying the shortcut to a merge reported every such
    // merge as invisible, which silently hid the commits an integration line most needs to see.
    if parents.len() == 1 {
        if let Some((_, parent_tree)) = reached.get(&parents[0]) {
            if *parent_tree == tree {
                return ProjectionVerdict::OutsideScope;
            }
        }
    }

    if parents.is_empty() {
        // The root commit authored every path it contains.
        return verdict_for_diff(flattened.get(&tree), None, scope);
    }

    // Visible if any parent comparison shows an admitted change. Folding over parents rather than
    // stopping at the first keeps the answer independent of parent order.
    for parent in parents {
        let parent_tree = reached.get(parent).map(|(_, p_tree)| *p_tree);
        let parent_entries = parent_tree.and_then(|tree_oid| flattened.get(&tree_oid));
        if verdict_for_diff(flattened.get(&tree), parent_entries, scope)
            == ProjectionVerdict::Visible
        {
            return ProjectionVerdict::Visible;
        }
    }
    ProjectionVerdict::OutsideScope
}

/// Reports whether the change from `parent` to `own` touches an admitted path.
fn verdict_for_diff(
    own: Option<&BTreeMap<String, FlattenedTreeEntry>>,
    parent: Option<&BTreeMap<String, FlattenedTreeEntry>>,
    scope: &ProjectionScope,
) -> ProjectionVerdict {
    let Some(own) = own else {
        // A tree that was never flattened cannot be diffed. Treating it as unchanged would hide a
        // real change, so the conservative answer keeps the commit visible.
        return ProjectionVerdict::Visible;
    };

    let Some(parent) = parent else {
        // No readable parent snapshot: every entry counts as an addition.
        return if own.keys().any(|path| scope.admits(path)) {
            ProjectionVerdict::Visible
        } else {
            ProjectionVerdict::OutsideScope
        };
    };

    for (path, entry) in own {
        if scope.admits(path) && parent.get(path) != Some(entry) {
            return ProjectionVerdict::Visible;
        }
    }
    // A deletion inside the scope is also an authored change here.
    for path in parent.keys() {
        if scope.admits(path) && !own.contains_key(path) {
            return ProjectionVerdict::Visible;
        }
    }
    ProjectionVerdict::OutsideScope
}

/// Flattens one tree, skipping every directory the scope cannot reach.
///
/// The traversal walks the tree exactly as [`super::tree_flatten::flatten_tree_with`] does, with one
/// extra decision per directory: if [`ProjectionScope::may_contain`] refuses it, the subtree is not
/// opened at all. That is the difference between filtering a slice and reading the whole repository
/// in order to throw most of it away.
///
/// # Errors
///
/// Propagates a failed tree read. An unreadable tree is an error even when the scope would have
/// pruned it, because the pruning decision came from the path, not from the object.
fn flatten_tree_pruned<F, P>(
    tree_oid: &Oid,
    prefix: &str,
    read_payload: &F,
    scope: &ProjectionScope,
    flat: &mut BTreeMap<String, FlattenedTreeEntry>,
) -> FractalResult<()>
where
    F: Fn(&Oid) -> FractalResult<P>,
    P: AsRef<[u8]>,
{
    let mut path_buf = String::with_capacity(prefix.len() + 128);
    path_buf.push_str(prefix);
    flatten_into_pruned(tree_oid, &mut path_buf, read_payload, scope, flat)
}

fn flatten_into_pruned<F, P>(
    tree_oid: &Oid,
    path_buf: &mut String,
    read_payload: &F,
    scope: &ProjectionScope,
    flat: &mut BTreeMap<String, FlattenedTreeEntry>,
) -> FractalResult<()>
where
    F: Fn(&Oid) -> FractalResult<P>,
    P: AsRef<[u8]>,
{
    let payload = read_payload(tree_oid)?;
    for entry in GitTreeRef::from_bytes(payload.as_ref()).iter() {
        let entry = entry?;
        let prev_len = path_buf.len();
        if !path_buf.is_empty() {
            path_buf.push('/');
        }
        path_buf.push_str(entry.name);
        if entry.mode.is_tree() {
            // The pruning decision comes before the read, so a refused subtree costs one `may_contain`
            // call instead of one object fetch per file it contains.
            if scope.may_contain(path_buf) {
                let descend = flatten_into_pruned(&entry.oid, path_buf, read_payload, scope, flat);
                path_buf.truncate(prev_len);
                descend?;
            } else {
                path_buf.truncate(prev_len);
            }
            continue;
        }
        if scope.admits(path_buf) {
            flat.insert(
                path_buf.clone(),
                FlattenedTreeEntry {
                    mode: entry.mode,
                    oid: entry.oid,
                },
            );
        }
        path_buf.truncate(prev_len);
    }
    Ok(())
}
