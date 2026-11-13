//! Module: Fractal Git — AnalysisEvidence Canonical Payload Builder
//! File Path: src/audit_runner/evidence.rs
//! Architecture Role: Serializes diagnostic findings (capped at 500), engine execution coverage,
//!   and composite quality measurements into schema-compliant `AnalysisEvidence`.
//! Dependencies & Triggers: Uses `fg_core::models::quality_contracts`.
//! Responsibilities: Emit deterministic schema payloads without clippy argument suppressions.
//! Exit Semantics & Design Rationale: Bundles evidence inputs inside [`EvidenceBuildInput`].

use fg_core::models::quality_contracts::{
    AnalysisEvidence, AnalysisEvidenceKind, CapabilityCoverage, CapabilityCoverageStatus,
    Diagnostic, DiagnosticSeverity, Digest, DigestAlgorithm, EngineVersion, Execution,
    ExecutionStatus, ExecutionTracks, MeasuredNumber, MeasuredNumberStatus, Measurements,
    NumberMeasurement, Provenance, ProvenanceSource, QuantMetrics, ReviewBinding, ReviewFailure,
    TenDimensions, Timing, TrackStatus, TrialMeasurement, Unmeasured, UnmeasuredStatus,
};
use fg_gate::audit_engine::{AuditFinding, AuditSeverity};

pub(super) struct EvidenceBuildInput<'a> {
    pub(super) binding: &'a ReviewBinding,
    pub(super) config_hex: &'a str,
    pub(super) findings: &'a [AuditFinding],
    pub(super) ten_dimensions: TenDimensions,
    pub(super) quant_metrics: QuantMetrics,
    pub(super) total_eloc: usize,
    pub(super) elapsed_ms: f64,
    pub(super) review_id: &'a str,
}

pub(super) fn build_analysis_evidence(input: &EvidenceBuildInput<'_>) -> AnalysisEvidence {
    let mut diagnostics = Vec::with_capacity(input.findings.len().min(500));
    for (idx, finding) in input.findings.iter().take(500).enumerate() {
        diagnostics.push(Diagnostic {
            id: format!("diag-{idx:04}"),
            analyzer: finding.analyzer.clone(),
            rule: finding.rule_id.clone(),
            file: finding.file.clone(),
            severity: match finding.severity {
                AuditSeverity::Error => DiagnosticSeverity::Error,
                AuditSeverity::Warning => DiagnosticSeverity::Warning,
                AuditSeverity::Info => DiagnosticSeverity::Info,
            },
            message: finding.message.clone(),
            start_line: finding.line as u64,
            start_column: 1,
            end_line: finding.line as u64,
            end_column: 80,
        });
    }
    let provenance = Provenance {
        source: ProvenanceSource::Analysis,
        sample_ids: vec![input.review_id.to_owned()],
    };
    let rounded_ms = (input.elapsed_ms * 100.0).round() / 100.0;
    AnalysisEvidence {
        schema_version: 1,
        kind: AnalysisEvidenceKind::AnalysisEvidence,
        binding: input.binding.clone(),
        engines: vec![EngineVersion {
            id: String::from("taxis-pure-rust-audit"),
            version: String::from("0.1.0"),
            configuration_digest: Digest {
                algorithm: DigestAlgorithm::Sm3,
                value: input.config_hex.to_owned(),
            },
        }],
        execution: Execution {
            schema_version: 1,
            review_id: input.review_id.to_owned(),
            status: ExecutionStatus::Complete,
            coverage: vec![CapabilityCoverage {
                analyzer: String::from("oxc-syn-polyglot-hygiene"),
                capability: String::from("static-ast-and-hygiene"),
                language: String::from("multi"),
                required: true,
                status: CapabilityCoverageStatus::Executed,
                reason: None,
                policy_allows_not_applicable: Some(false),
            }],
            tracks: ExecutionTracks {
                fast: TrackStatus::Complete,
                deep: TrackStatus::Complete,
            },
            failures: Vec::<ReviewFailure>::new(),
        },
        diagnostics,
        measurements: Measurements {
            quality_delta: NumberMeasurement::MeasuredNumber(MeasuredNumber {
                status: MeasuredNumberStatus::Measured,
                value: input.ten_dimensions.composite_score,
                provenance: provenance.clone(),
            }),
            generalization: NumberMeasurement::MeasuredNumber(MeasuredNumber {
                status: MeasuredNumberStatus::Measured,
                value: input.quant_metrics.polyglot_index,
                provenance: provenance.clone(),
            }),
            tests: TrialMeasurement::Unmeasured(Unmeasured {
                status: UnmeasuredStatus::Unmeasured,
                reason: format!(
                    "static-only snapshot review ({} eloc); external test runner not invoked",
                    input.total_eloc
                ),
            }),
            mutations: TrialMeasurement::Unmeasured(Unmeasured {
                status: UnmeasuredStatus::Unmeasured,
                reason: String::from(
                    "static-only snapshot review; external mutation runner not invoked",
                ),
            }),
            performance_ms: NumberMeasurement::MeasuredNumber(MeasuredNumber {
                status: MeasuredNumberStatus::Measured,
                value: rounded_ms,
                provenance,
            }),
            ten_dimensions: Some(input.ten_dimensions.clone()),
            quant_metrics: Some(input.quant_metrics.clone()),
        },
        timing: Timing {
            queue_ms: 0.0,
            elapsed_ms: rounded_ms,
            output_truncated: input.findings.len() > 500,
            budget_exhausted: false,
        },
    }
}
