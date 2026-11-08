//! Module: fg-algorithms — Graph Traversal Facade
//! File Path: crates/fg-algorithms/src/traverse/mod.rs

pub mod corrected_date_index;
pub mod dag_walk;
pub mod projection;
pub mod segmented_dag;
pub mod tree_flatten;
pub mod window;

pub use corrected_date_index::{CcdIndex, MAX_INDEXED_COMMITS};
pub use dag_walk::{DagWalker, FastOidHasher, FastOidSet, SmallParentList};
pub use projection::{
    project_history, CommitSource, ProjectedCommit, Projection, ProjectionVerdict,
};
pub use segmented_dag::SegmentedCommitDag;
pub use tree_flatten::{
    commit_tree_oid, flatten_commit_tree_with, flatten_tree_with, FlattenedTreeEntry,
};
pub use window::{collect_window, Window, WindowSet};
