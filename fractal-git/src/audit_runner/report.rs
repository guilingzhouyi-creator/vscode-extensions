//! Module: Fractal Git — AAS v1 & Markdown Audit Summary Generators
//! File Path: src/audit_runner/report.rs
//! Architecture Role: Produces compact AAS v1 JSON payloads and human-readable Markdown summaries
//!   stored inside `refs/fractal/audit/...` trees (`reports/aas-v1.json` & `reports/summary.md`).
//! Dependencies & Triggers: Uses `TenDimensions`, `QuantMetrics`, and `AntiGamingVerdict`.
//! Responsibilities: Emit zero-disk-leakage report artifacts from memory structures cleanly.
//! Exit Semantics & Design Rationale: Shared [`SummaryOutputInput`] unifies AAS and Markdown calls.

use fg_algorithms::scoring::AntiGamingVerdict;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::quality_contracts::{QuantMetrics, ReceiptPayloadDecision, TenDimensions};
use fg_core::models::Oid;

pub(super) struct SummaryOutputInput<'a> {
    pub(super) tree_oid: Oid,
    pub(super) ten_dimensions: &'a TenDimensions,
    pub(super) quant: &'a QuantMetrics,
    pub(super) error_count: usize,
    pub(super) warning_count: usize,
    pub(super) info_count: usize,
    pub(super) gaming: &'a AntiGamingVerdict,
    pub(super) decision: &'a ReceiptPayloadDecision,
}

pub(super) fn build_aas_summary(input: &SummaryOutputInput<'_>) -> FractalResult<Vec<u8>> {
    let val = serde_json::json!({
        "schema": "aas/v1",
        "decision": input.decision,
        "antiGamingPassed": !input.gaming.is_gaming,
        "findings": {
            "error": input.error_count,
            "warning": input.warning_count,
            "info": input.info_count,
        },
        "tenDimensions": input.ten_dimensions,
        "quantMetrics": input.quant,
    });
    serde_json::to_vec_pretty(&val).map_err(FractalError::from)
}

pub(super) fn build_markdown_report(input: &SummaryOutputInput<'_>) -> String {
    let td = input.ten_dimensions;
    let q = input.quant;
    format!(
        "# Taxis Kernel Native Audit Report\n\n\
        - **Snapshot Tree**: `{}`\n\
        - **Composite Score**: **{:.2}** (Grade **{}**)\n\
        - **Findings**: error={}, warning={}, info={}\n\
        - **Anti-Gaming**: {}\n\n\
        ## Ten Dimensions\n\
        | Dimension | Score |\n\
        | :--- | ---: |\n\
        | Architecture Consistency | {:.2} |\n\
        | Semantic Purity | {:.2} |\n\
        | Code Security | {:.2} |\n\
        | Performance Efficiency | {:.2} |\n\
        | Standardization | {:.2} |\n\
        | Modernity | {:.2} |\n\
        | Maintainability | {:.2} |\n\
        | Comment Quality | {:.2} |\n\
        | Duplication | {:.2} |\n\
        | Tech Debt Risk | {:.2} |\n\n\
        ## Quantitative Risk & SQALE\n\
        - SQALE Effort: {:.2} min | TDR: {:.4} | Confidence: {:.2}\n\
        - Autonomy (CAI 2.0): {:.2}% | Polyglot Index: {:.2}\n\
        - ADR-Q: rcr={:.2}, erq={:.2}, ddr={:.2}, edb95={:.2}, ptd={:.2}, dsi={:.2}, rcd={:.2}, ehl={:.2}\n",
        input.tree_oid.to_hex(),
        td.composite_score,
        td.grade,
        input.error_count,
        input.warning_count,
        input.info_count,
        if input.gaming.is_gaming { "BLOCKED" } else { "PASS" },
        td.architecture_consistency,
        td.semantic_purity,
        td.code_security,
        td.performance_efficiency,
        td.standardization,
        td.modernity,
        td.maintainability,
        td.comment_quality,
        td.duplication,
        td.tech_debt_risk,
        q.sqale_minutes,
        q.tdr,
        q.confidence,
        q.autonomy_rate * 100.0,
        q.polyglot_index,
        q.rcr,
        q.erq,
        q.ddr,
        q.edb95,
        q.ptd,
        q.dsi,
        q.rcd,
        q.ehl,
    )
}
