//! Module: fg-core — Agent Execution Context
//! File Path: crates/fg-core/src/models/context.rs
//! Architecture Role: Strongly-typed Praxis task card context and dual-faced commit metadata.

use serde::{Deserialize, Serialize};

/// Execution context associating an autonomous commit with its originating Praxis task card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PraxisCardContext {
    pub card_id: String,
    pub cell_id: String,
    pub agent_uid: String,
    pub role: Option<String>,
}

/// Dual-faced agent metadata serialized into commit trailers for machine verification.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentCommitMeta {
    pub card_context: PraxisCardContext,
    pub quality_score: f64,
    pub gate_status: String,
    pub timestamp_ms: i64,
}
