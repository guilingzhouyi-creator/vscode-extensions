//! Module: fg-algorithms — Graph Traversal Facade
//! File Path: crates/fg-algorithms/src/traverse/mod.rs

pub mod dag_walk;
pub mod segmented_dag;
pub mod tree_flatten;

pub use dag_walk::{DagWalker, FastOidHasher, FastOidSet, SmallParentList};
pub use segmented_dag::SegmentedCommitDag;
pub use tree_flatten::{
    commit_tree_oid, flatten_commit_tree_with, flatten_tree_with, FlattenedTreeEntry,
};
