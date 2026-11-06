//! Regression Suite: Commit-Graph Backed Ancestry
//! File Path: tests/rust/test_commit_graph_ancestry.rs
//!
//! The corrected-date index may be primed from `objects/info/commit-graph` instead of re-reading
//! commits from the object store. That optimisation is only safe if a graph-primed index produces
//! exactly the same answers as an object-store walk, so this suite builds a graph, primes from it,
//! and compares against ground truth computed by traversing the plain parent table.
//!
//! The failure mode being guarded against is subtle: a graph that silently drops entries would
//! present later commits as roots, which detaches history and makes unrelated commits look related.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

use fg_core::models::Oid;
use fg_storage::commit_graph::{CommitGraphEntry, CommitGraphReader, CommitGraphWriter};
use fractal_git::algorithms::traverse::CcdIndex;

fn oid(byte: u8) -> Oid {
    Oid::from_bytes([byte; 20])
}

struct TestDir(PathBuf);

impl TestDir {
    fn new(label: &str) -> Self {
        let path = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("target")
            .join("test_tmp")
            .join(format!(
                "fg_graph_ancestry_{label}_{}_{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
        std::fs::create_dir_all(&path).expect("create test dir");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Ground truth reachability over a plain parent table.
fn reachable(parents: &HashMap<Oid, Vec<Oid>>, ancestor: &Oid, descendant: &Oid) -> bool {
    if ancestor == descendant {
        return true;
    }
    let mut seen: HashSet<Oid> = HashSet::new();
    let mut queue: VecDeque<Oid> = VecDeque::new();
    queue.push_back(*descendant);
    seen.insert(*descendant);
    while let Some(current) = queue.pop_front() {
        for parent in parents.get(&current).cloned().unwrap_or_default() {
            if &parent == ancestor {
                return true;
            }
            if seen.insert(parent) {
                queue.push_back(parent);
            }
        }
    }
    false
}

/// Same-second timestamps throughout, so the cutoff is exercised at its weakest point.
const SAME_SECOND: u64 = 1_760_000_000;

fn fixture() -> (Vec<Oid>, HashMap<Oid, Vec<Oid>>) {
    // A diamond with a merge, all committed in the same second:
    //   root <- left, root <- right, {left,right} <- merge, merge <- tip
    let root = oid(1);
    let left = oid(2);
    let right = oid(3);
    let merge = oid(4);
    let tip = oid(5);

    let mut parents: HashMap<Oid, Vec<Oid>> = HashMap::new();
    parents.insert(root, vec![]);
    parents.insert(left, vec![root]);
    parents.insert(right, vec![root]);
    parents.insert(merge, vec![left, right]);
    parents.insert(tip, vec![merge]);
    (vec![root, left, right, merge, tip], parents)
}

#[test]
fn a_graph_primed_index_agrees_with_direct_traversal_on_every_pair() {
    let dir = TestDir::new("agrees");
    let (nodes, parents) = fixture();

    let mut writer = CommitGraphWriter::new();
    for node in &nodes {
        writer.add_commit(CommitGraphEntry {
            commit_oid: *node,
            tree_oid: oid(0x7F),
            parent_oids: parents[node].clone(),
            generation: 1,
            timestamp_sec: SAME_SECOND,
        });
    }
    let graph_path = dir.path().join("commit-graph");
    writer.write_to_file(&graph_path).expect("write graph");

    let reader = CommitGraphReader::open(&graph_path).expect("open graph");

    // Reconstruct the table exactly as the CLI prime step does.
    let mut primed: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    for node in &nodes {
        let entry = reader
            .find_position(node)
            .and_then(|position| reader.get_entry(position))
            .expect("graph must carry every fixture commit");
        assert_eq!(
            entry.parent_oids, parents[node],
            "graph must preserve parent edges; a dropped edge detaches history"
        );
        primed.insert(*node, (entry.parent_oids, entry.timestamp_sec));
    }

    let index = CcdIndex::from_table(&primed, &[nodes[4]]).expect("build index from graph");

    for ancestor in &nodes {
        for descendant in &nodes {
            assert_eq!(
                index.is_ancestor(ancestor, descendant),
                reachable(&parents, ancestor, descendant),
                "graph-primed ancestry disagrees for {ancestor:?} -> {descendant:?}"
            );
        }
    }
}

#[test]
fn same_second_commits_stay_ordered_when_built_from_a_graph() {
    // The graph carries raw timestamps, not corrected dates. Rebuilding the recurrence from the
    // graph must still break the tie, otherwise priming from the graph reintroduces the defect the
    // index was created to remove.
    let dir = TestDir::new("same_second");
    let (nodes, parents) = fixture();

    let mut writer = CommitGraphWriter::new();
    for node in &nodes {
        writer.add_commit(CommitGraphEntry {
            commit_oid: *node,
            tree_oid: oid(0x7F),
            parent_oids: parents[node].clone(),
            generation: 1,
            timestamp_sec: SAME_SECOND,
        });
    }
    let graph_path = dir.path().join("commit-graph");
    writer.write_to_file(&graph_path).expect("write graph");
    let reader = CommitGraphReader::open(&graph_path).expect("open graph");

    let mut primed: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    for node in &nodes {
        let entry = reader
            .find_position(node)
            .and_then(|position| reader.get_entry(position))
            .expect("entry");
        primed.insert(*node, (entry.parent_oids, entry.timestamp_sec));
    }
    let index = CcdIndex::from_table(&primed, &[nodes[4]]).expect("index");

    // Only genuine ancestry edges are strictly ordered. `left` and `right` are siblings, so they
    // may legitimately share a corrected date; asserting a total order across the whole node list
    // would be asserting something the invariant never promised.
    let chain = [nodes[0], nodes[1], nodes[3], nodes[4]];
    let mut previous: Option<fg_core::models::CorrectedCommitDate> = None;
    for node in chain {
        let ccd = index.corrected_date(&node).expect("dated");
        if let Some(prev) = previous {
            assert!(
                prev < ccd,
                "corrected dates must be strictly increasing along an ancestry chain even at \
                 one-second timestamp granularity"
            );
        }
        previous = Some(ccd);
    }

    // Siblings are incomparable, so neither may be reported as an ancestor of the other. Their
    // corrected dates may be equal, which is exactly why the scalar cutoff alone cannot answer
    // reachability and the graph search has to confirm it.
    assert!(!index.is_ancestor(&nodes[1], &nodes[2]));
    assert!(!index.is_ancestor(&nodes[2], &nodes[1]));

    // And the reachability the cutoff now permits must be the true reachability.
    assert!(index.is_ancestor(&nodes[0], &nodes[4]));
    assert!(index.is_ancestor(&nodes[1], &nodes[3]));
    assert!(!index.is_ancestor(&nodes[4], &nodes[0]));
}

#[test]
fn the_merge_with_two_distinct_same_second_branches_keeps_both_bases() {
    // A criss-cross whose two bases differ only by insertion order, committed in the same second.
    // This is the shape where a scalar cutoff comparison drops a base.
    let root = oid(1);
    let left = oid(2);
    let right = oid(3);
    let first_merge = oid(4);
    let second_merge = oid(5);

    let mut parents: HashMap<Oid, Vec<Oid>> = HashMap::new();
    parents.insert(root, vec![]);
    parents.insert(left, vec![root]);
    parents.insert(right, vec![root]);
    parents.insert(first_merge, vec![left, right]);
    parents.insert(second_merge, vec![right, left]);

    let dir = TestDir::new("criss_cross");
    let mut writer = CommitGraphWriter::new();
    for (node, parents_of) in &parents {
        writer.add_commit(CommitGraphEntry {
            commit_oid: *node,
            tree_oid: oid(0x7F),
            parent_oids: parents_of.clone(),
            generation: 1,
            timestamp_sec: SAME_SECOND,
        });
    }
    let graph_path = dir.path().join("commit-graph");
    writer.write_to_file(&graph_path).expect("write graph");
    let reader = CommitGraphReader::open(&graph_path).expect("open");

    let nodes = [root, left, right, first_merge, second_merge];
    let mut primed: HashMap<Oid, (Vec<Oid>, u64)> = HashMap::new();
    for node in &nodes {
        let entry = reader
            .find_position(node)
            .and_then(|position| reader.get_entry(position))
            .expect("entry");
        primed.insert(*node, (entry.parent_oids, entry.timestamp_sec));
    }
    let index = CcdIndex::from_table(&primed, &[first_merge, second_merge]).expect("index");

    let bases: HashSet<Oid> = index
        .merge_bases(&first_merge, &second_merge)
        .into_iter()
        .collect();
    assert_eq!(
        bases,
        HashSet::from([left, right]),
        "both incomparable bases must survive, including when their timestamps are identical"
    );
}

#[test]
fn a_missing_graph_leaves_direct_traversal_unaffected() {
    // The prime step is an optimisation, so its absence must be invisible. Nothing else in this
    // suite exercises the no-graph path, and a regression that made the graph mandatory would
    // otherwise only surface on a repository that never ran `taxis commit-graph`.
    let (nodes, parents) = fixture();
    let table: HashMap<Oid, (Vec<Oid>, u64)> = nodes
        .iter()
        .map(|node| (*node, (parents[node].clone(), SAME_SECOND)))
        .collect();

    let index = CcdIndex::from_table(&table, &[nodes[4]]).expect("index without graph");
    for ancestor in &nodes {
        for descendant in &nodes {
            assert_eq!(
                index.is_ancestor(ancestor, descendant),
                reachable(&parents, ancestor, descendant)
            );
        }
    }
}
