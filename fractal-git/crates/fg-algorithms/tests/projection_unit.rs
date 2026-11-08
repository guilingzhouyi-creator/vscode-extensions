//! Unit tests: fg-algorithms::traverse::projection
//! File Path: crates/fg-algorithms/tests/projection_unit.rs
//!
//! The projection makes one claim worth testing hard: it changes what you *see*, never what
//! *exists*. Every test below checks one half of that, because an implementation that splices
//! invisible commits out would pass a "shows the right files" test and fail all of these.

use std::collections::HashMap;

use fg_algorithms::traverse::{project_history, CommitSource, Projection, ProjectionVerdict};
use fg_core::error::FractalResult;
use fg_core::models::{FileMode, Oid, ProjectionScope, ProjectionTier};
use fg_object::{GitTree, GitTreeEntry};

fn oid(byte: u8) -> Oid {
    Oid::from_bytes([byte; 20])
}

/// An in-memory commit graph: each commit names its parents, a tree, and that tree's entries.
#[derive(Default)]
struct Fixture {
    commits: HashMap<Oid, (Vec<Oid>, Oid)>,
    trees: HashMap<Oid, Vec<u8>>,
}

impl Fixture {
    /// Registers a tree built from `(mode, name, blob)` entries.
    fn add_tree(&mut self, id: Oid, entries: &[(FileMode, &str, Oid)]) {
        let mut owned: Vec<GitTreeEntry> = entries
            .iter()
            .map(|(mode, name, blob)| GitTreeEntry::new(*mode, (*name).to_string(), *blob))
            .collect();
        let payload = GitTree::serialize_sorted_entries(&mut owned);
        self.trees.insert(id, payload);
    }

    fn add_commit(&mut self, id: Oid, parents: Vec<Oid>, tree: Oid) {
        self.commits.insert(id, (parents, tree));
    }
}

impl CommitSource for Fixture {
    fn commit(&self, oid: &Oid) -> FractalResult<(Vec<Oid>, Oid)> {
        Ok(self.commits[oid].clone())
    }

    fn tree(&self, oid: &Oid) -> FractalResult<Vec<u8>> {
        Ok(self.trees[oid].clone())
    }
}

/// A three-commit history where only the middle commit touches `crates/core`.
fn three_commits() -> Fixture {
    let mut fixture = Fixture::default();

    // root: docs/readme.md only
    fixture.add_tree(
        oid(0x10),
        &[(FileMode::RegularFile, "readme.md", oid(0x21))],
    );
    fixture.add_commit(oid(1), vec![], oid(0x10));

    // second: adds crates/core/lib.rs (in scope) and keeps the readme
    fixture.add_tree(
        oid(0x11),
        &[
            (FileMode::RegularFile, "lib.rs", oid(0x22)),
            (FileMode::RegularFile, "readme.md", oid(0x21)),
        ],
    );
    fixture.add_commit(oid(2), vec![oid(1)], oid(0x11));

    // third: reverts to the readme-only snapshot (the in-scope file is deleted)
    fixture.add_tree(
        oid(0x12),
        &[(FileMode::RegularFile, "readme.md", oid(0x21))],
    );
    fixture.add_commit(oid(3), vec![oid(2)], oid(0x12));

    fixture
}

fn scope(include: &[&str]) -> ProjectionScope {
    ProjectionScope::restricted(
        ProjectionTier::AgentCard,
        include.iter().map(|p| (*p).to_string()).collect(),
        Vec::new(),
    )
    .expect("scope")
}

fn verdicts(projection: &Projection) -> Vec<(u8, ProjectionVerdict)> {
    let mut out: Vec<(u8, ProjectionVerdict)> = projection
        .commits
        .iter()
        .map(|commit| (commit.oid.as_bytes()[0], commit.verdict))
        .collect();
    out.sort_unstable_by_key(|(byte, _)| *byte);
    out
}

#[test]
fn a_commit_that_adds_an_in_scope_file_is_visible() {
    let fixture = three_commits();
    let projection = project_history(&[oid(3)], &scope(&["lib.rs"]), &fixture).expect("project");

    assert_eq!(projection.visible_count(), 2);
    assert_eq!(
        projection.verdict_of(&oid(2)),
        Some(ProjectionVerdict::Visible),
        "the commit that added lib.rs authored the change"
    );
    assert_eq!(
        projection.verdict_of(&oid(3)),
        Some(ProjectionVerdict::Visible),
        "deleting an in-scope file is an authored change here too"
    );
}

#[test]
fn a_commit_that_touches_nothing_in_scope_is_reported_as_outside() {
    let fixture = three_commits();
    let projection = project_history(&[oid(3)], &scope(&["lib.rs"]), &fixture).expect("project");
    assert_eq!(
        projection.verdict_of(&oid(1)),
        Some(ProjectionVerdict::OutsideScope)
    );
}

#[test]
fn an_invisible_commit_keeps_its_identity_and_its_parents() {
    // The failure this guards: splicing the invisible root out and reparenting commit 2 onto
    // nothing. That would report a commit under an id whose bytes describe a different history.
    let fixture = three_commits();
    let projection = project_history(&[oid(3)], &scope(&["lib.rs"]), &fixture).expect("project");

    let root = projection
        .commits
        .iter()
        .find(|commit| commit.oid == oid(1))
        .expect("the root must still be present");
    assert_eq!(root.verdict, ProjectionVerdict::OutsideScope);
    assert!(
        root.parents.is_empty(),
        "the root has no parent, and no parent may be invented"
    );

    let second = projection
        .commits
        .iter()
        .find(|commit| commit.oid == oid(2))
        .expect("commit 2");
    assert_eq!(
        second.parents,
        vec![oid(1)],
        "an invisible parent stays named; it is not skipped over"
    );
}

#[test]
fn every_reachable_commit_is_reported_even_when_none_is_visible() {
    // A scope that matches nothing must still say how much history exists, or an agent reading the
    // projection concludes the repository is empty.
    let fixture = three_commits();
    let projection =
        project_history(&[oid(3)], &scope(&["no/such/path.rs"]), &fixture).expect("project");
    assert_eq!(projection.commits.len(), 3);
    assert_eq!(projection.visible_count(), 0);
    assert_eq!(projection.outside_scope_count(), 3);
}

#[test]
fn an_unrestricted_scope_keeps_the_root_visible_but_not_the_unchanged_child() {
    let mut fixture = Fixture::default();
    fixture.add_tree(oid(0x30), &[(FileMode::RegularFile, "a.txt", oid(0x41))]);
    fixture.add_commit(oid(4), vec![], oid(0x30));
    // A commit whose tree is byte-identical to its parent's cannot have authored anything.
    fixture.add_commit(oid(5), vec![oid(4)], oid(0x30));

    let projection = project_history(
        &[oid(5)],
        &ProjectionScope::whole(ProjectionTier::SystemTrunk),
        &fixture,
    )
    .expect("project");

    assert_eq!(
        projection.verdict_of(&oid(4)),
        Some(ProjectionVerdict::Visible)
    );
    assert_eq!(
        projection.verdict_of(&oid(5)),
        Some(ProjectionVerdict::OutsideScope),
        "a commit that changed nothing is not a change, whatever the scope admits"
    );
}

#[test]
fn a_merge_is_visible_when_a_side_branch_brought_an_in_scope_change() {
    //   5 (merge) -> 4 (mainline, docs only) -> 3 (root)
    //              -> 6 (side, adds lib.rs)
    let mut fixture = Fixture::default();
    fixture.add_tree(
        oid(0x50),
        &[(FileMode::RegularFile, "readme.md", oid(0x61))],
    );
    fixture.add_commit(oid(3), vec![], oid(0x50));

    fixture.add_tree(
        oid(0x51),
        &[(FileMode::RegularFile, "readme.md", oid(0x62))],
    );
    fixture.add_commit(oid(4), vec![oid(3)], oid(0x51));

    fixture.add_tree(
        oid(0x52),
        &[
            (FileMode::RegularFile, "lib.rs", oid(0x63)),
            (FileMode::RegularFile, "readme.md", oid(0x61)),
        ],
    );
    fixture.add_commit(oid(6), vec![oid(3)], oid(0x52));

    // The merge snapshot equals the side branch: mainline's readme change was dropped.
    fixture.add_commit(oid(5), vec![oid(4), oid(6)], oid(0x52));

    let projection = project_history(&[oid(5)], &scope(&["lib.rs"]), &fixture).expect("project");
    assert_eq!(
        projection.verdict_of(&oid(5)),
        Some(ProjectionVerdict::Visible),
        "against the side parent the merge adds lib.rs, so the mainline must report it"
    );
    assert_eq!(
        projection.verdict_of(&oid(4)),
        Some(ProjectionVerdict::OutsideScope),
        "the mainline commit touched only docs"
    );
}

#[test]
fn a_child_scope_narrower_than_its_ancestor_sees_less() {
    // The magnification the four tiers describe: the same commit, two nodes, two answers.
    let fixture = three_commits();
    let trunk = ProjectionScope::whole(ProjectionTier::SystemTrunk);
    let card = scope(&["lib.rs"]);

    let wide = project_history(&[oid(3)], &trunk, &fixture).expect("trunk");
    let narrow = project_history(&[oid(3)], &card, &fixture).expect("card");

    assert!(
        wide.visible_count() >= narrow.visible_count(),
        "the trunk can never see less than a card cut from it"
    );
    assert_eq!(
        wide.commits.len(),
        narrow.commits.len(),
        "the graph size is identical"
    );
}

/// A source that counts how many tree objects it was asked for.
struct CountingSource {
    inner: Fixture,
    reads: std::cell::RefCell<Vec<Oid>>,
}

impl CommitSource for CountingSource {
    fn commit(&self, oid: &Oid) -> FractalResult<(Vec<Oid>, Oid)> {
        self.inner.commit(oid)
    }

    fn tree(&self, oid: &Oid) -> FractalResult<Vec<u8>> {
        self.reads.borrow_mut().push(*oid);
        self.inner.tree(oid)
    }
}

#[test]
fn a_pruned_subtree_is_never_read() {
    // Two sibling directories at the root; the scope admits only `keep`. The traversal has to reach
    // the root and the admitted subtree, and must never open the other tree object. Without pruning
    // the slice would cost a full walk of the repository for every distinct snapshot.
    let keep_tree = oid(0x70);
    let other_tree = oid(0x71);
    let root_tree = oid(0x72);

    let mut inner = Fixture::default();
    inner.add_tree(keep_tree, &[(FileMode::RegularFile, "lib.rs", oid(0x80))]);
    inner.add_tree(
        other_tree,
        &[(FileMode::RegularFile, "other.rs", oid(0x81))],
    );
    // The root names both sub-directories. Built by hand because the helper only makes flat trees.
    let root_payload = {
        let mut entries = vec![
            GitTreeEntry::new(FileMode::Directory, "keep".to_string(), keep_tree),
            GitTreeEntry::new(FileMode::Directory, "other".to_string(), other_tree),
        ];
        GitTree::serialize_sorted_entries(&mut entries)
    };
    inner.trees.insert(root_tree, root_payload);
    inner.add_commit(oid(7), vec![], root_tree);

    let source = CountingSource {
        inner,
        reads: std::cell::RefCell::new(Vec::new()),
    };
    let projection = project_history(&[oid(7)], &scope(&["keep/**"]), &source).expect("project");

    let reads = source.reads.borrow();
    assert!(reads.contains(&root_tree), "the root must be opened");
    assert!(
        reads.contains(&keep_tree),
        "the admitted subtree must be opened"
    );
    assert!(
        !reads.contains(&other_tree),
        "the pruned subtree must never be read, got {reads:?}"
    );
    assert_eq!(projection.visible_count(), 1);
}

#[test]
fn no_tips_yields_an_empty_projection() {
    let fixture = three_commits();
    let projection = project_history(&[], &scope(&["lib.rs"]), &fixture).expect("project");
    assert!(projection.commits.is_empty());
    assert_eq!(verdicts(&projection), Vec::new());
}
