//! Module: fg-topology — Dual-Trunk Commit Telemetry & Anti-Inflation Counter
//! File Path: crates/fg-topology/src/telemetry.rs
//! Architecture Role: Implements the anti-gaming commit counting metric. When Dual-Trunk
//!   mode is active, official commit count strictly counts promotions into Integration Trunk
//!   and System Trunk, filtering out internal ephemeral agent micro-commits. When inactive,
//!   100% native Git DAG traversal is used.

use crate::refs::FractalRef;
use fg_core::error::FractalResult;
use fg_core::models::Oid;
use std::collections::{HashSet, VecDeque};

/// Configuration for commit counting telemetry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitTelemetryConfig {
    /// Whether Dual-Trunk mode is enabled.
    pub dual_trunk_enabled: bool,
    /// Reference to evaluate (e.g. SystemTrunk or Integration Trunk).
    pub target_ref: FractalRef,
}

impl Default for CommitTelemetryConfig {
    fn default() -> Self {
        Self {
            dual_trunk_enabled: false,
            target_ref: FractalRef::SystemTrunk {
                branch: "main".into(),
            },
        }
    }
}

/// Result of commit count evaluation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitCountVerdict {
    /// Official commit count (anti-gaming filtered in Dual-Trunk mode, raw in Git mode).
    pub official_count: usize,
    /// Total commits traversed including ephemeral agent micro-commits.
    pub total_raw_commits: usize,
    /// Number of ephemeral internal agent commits filtered out.
    pub filtered_agent_commits: usize,
    /// Whether Dual-Trunk mode was active.
    pub dual_trunk_active: bool,
}

/// Generic representation of a commit for telemetry traversal.
#[derive(Debug, Clone)]
pub struct TelemetryCommitNode {
    pub oid: Oid,
    pub parent_oids: Vec<Oid>,
    pub is_human_signed: bool,
    pub is_promotion_merge: bool,
    pub is_agent_micro_commit: bool,
}

/// Topological commit counter.
pub struct CommitCounter;

impl CommitCounter {
    /// Counts commits given a starting commit OID and a commit resolver closure.
    pub fn count_commits<F>(
        head_oid: Option<Oid>,
        config: &CommitTelemetryConfig,
        mut resolver: F,
    ) -> FractalResult<CommitCountVerdict>
    where
        F: FnMut(&Oid) -> FractalResult<Option<TelemetryCommitNode>>,
    {
        let head = match head_oid {
            Some(head_commit_oid) => head_commit_oid,
            None => {
                return Ok(CommitCountVerdict {
                    official_count: 0,
                    total_raw_commits: 0,
                    filtered_agent_commits: 0,
                    dual_trunk_active: config.dual_trunk_enabled,
                });
            }
        };

        let mut queue = VecDeque::new();
        let mut visited = HashSet::new();
        queue.push_back(head);

        let mut total_raw = 0;
        let mut official = 0;
        let mut filtered_agent = 0;

        while let Some(current_oid) = queue.pop_front() {
            if !visited.insert(current_oid) {
                continue;
            }

            if let Some(node) = resolver(&current_oid)? {
                total_raw += 1;

                if config.dual_trunk_enabled {
                    // Dual-Trunk Mode: Only count verified milestone promotions
                    // or human-signed merges
                    let is_official = node.is_human_signed
                        || node.is_promotion_merge
                        || (node.parent_oids.len() >= 2 && !node.is_agent_micro_commit);

                    if is_official {
                        official += 1;
                    } else if node.is_agent_micro_commit {
                        filtered_agent += 1;
                    } else {
                        // Root or direct official commit
                        official += 1;
                    }
                } else {
                    // Native Git Compatible Mode: Count every reachable commit
                    official += 1;
                }

                for parent in node.parent_oids {
                    queue.push_back(parent);
                }
            }
        }

        Ok(CommitCountVerdict {
            official_count: official,
            total_raw_commits: total_raw,
            filtered_agent_commits: filtered_agent,
            dual_trunk_active: config.dual_trunk_enabled,
        })
    }
}
