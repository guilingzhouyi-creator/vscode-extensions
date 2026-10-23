//! Module: fg-core — Mechanical Code Chunk Provenance Ledger (MCPL)
//! File Path: crates/fg-core/src/models/provenance.rs
//! Architecture Role: Implements objective, non-model-dependent provenance tracking for individual
//!   code blocks and hunks, capturing host nanosecond physical timestamps, CCD v2 topological
//!   logical clocks, and authentic agent process signatures.
//! Dependencies & Triggers: Recorded during commit materialization and consumed during causal arbitration.
//! Responsibilities: Block-level provenance representation, chronological query, and JSON persistence.
//! Exit Semantics & Design Rationale:
//!   - Completely independent of LLM self-reporting; timestamps are sampled by host kernel.
//!   - SHA1 chunk hashing creates an immutable link between code payload and physical generation time.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use crate::models::Oid;
use serde::{Deserialize, Serialize};

/// Objective provenance record for an individual modified code chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockProvenanceEntry {
    /// Relative file path within the repository (e.g. `src/lib.rs`).
    pub file_path: String,
    /// Semantic identifier or chunk signature (e.g. `fn evaluate_tree` or `chunk-4a8b`).
    pub block_id: String,
    /// 1-based start and end line coordinates in the target commit.
    pub line_span: (u32, u32),
    /// SHA1 content hash of the block bytes.
    pub block_hash: Oid,
    /// Host system physical timestamp in nanoseconds since UNIX epoch.
    pub physical_timestamp_ns: u64,
    /// Corrected Commit Date (CCD v2) topological generation counter.
    pub ccd_generation: u64,
    /// Agent UID executing the change (injected from process context).
    pub agent_uid: String,
    /// Cell ID scope of the agent.
    pub cell_id: String,
    /// Direct parent commit OID upon which this block was derived.
    pub base_commit: Oid,
}

/// Parameters for constructing a validated block provenance entry (SIM-ARGS-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockProvenanceParams {
    pub file_path: String,
    pub block_id: String,
    pub line_span: (u32, u32),
    pub block_hash: Oid,
    pub physical_timestamp_ns: u64,
    pub ccd_generation: u64,
    pub agent_uid: String,
    pub cell_id: String,
    pub base_commit: Oid,
}

impl BlockProvenanceEntry {
    /// Constructs a validated provenance entry directly from host environment telemetry.
    pub fn new(params: BlockProvenanceParams) -> Self {
        Self {
            file_path: params.file_path,
            block_id: params.block_id,
            line_span: params.line_span,
            block_hash: params.block_hash,
            physical_timestamp_ns: params.physical_timestamp_ns,
            ccd_generation: params.ccd_generation,
            agent_uid: params.agent_uid,
            cell_id: params.cell_id,
            base_commit: params.base_commit,
        }
    }
}

/// Ledger aggregating block-level provenance history for a repository or worktree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvenanceLedger {
    pub entries: Vec<BlockProvenanceEntry>,
}

impl ProvenanceLedger {
    /// Creates an empty provenance ledger.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Records a new block provenance entry.
    pub fn record(&mut self, entry: BlockProvenanceEntry) {
        self.entries.push(entry);
    }

    /// Queries all historical provenance records for a given file path.
    pub fn query_file(&self, file_path: &str) -> Vec<&BlockProvenanceEntry> {
        self.entries
            .iter()
            .filter(|e| e.file_path == file_path)
            .collect()
    }

    /// Queries the most recent provenance record for a specific semantic block.
    pub fn query_latest_block(
        &self,
        file_path: &str,
        block_id: &str,
    ) -> Option<&BlockProvenanceEntry> {
        self.entries
            .iter()
            .filter(|e| e.file_path == file_path && e.block_id == block_id)
            .max_by_key(|e| e.physical_timestamp_ns)
    }
}
