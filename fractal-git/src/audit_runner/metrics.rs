//! Module: Fractal Git — Per-File Scoring & Polyglot Aggregation
//! File Path: src/audit_runner/metrics.rs
//! Architecture Role: Translates `SnapshotAuditBundle` file metrics and findings into 10D
//!   file scores, rule family histograms, and Polyglot Balance stack summaries.
//! Dependencies & Triggers: Uses `fg_algorithms::scoring`.
//! Responsibilities: Compute per-file SQALE minutes and feed aggregate inputs cleanly.
//! Exit Semantics & Design Rationale: Bundles return values in [`PerFileBatchEval`] to stay crisp.

use std::collections::BTreeMap;

use fg_algorithms::scoring::{
    evaluate_file_quality, evaluate_polyglot_balance, resolve_issue_remediation_minutes,
    EvaluatedQualityScore, FileMetricSummary, FindingSeverity, LanguageStackMeasurement,
    PolyglotBalanceReport, ProjectArchetype, QualityCurveConfig, ScoringFinding, StackLanguage,
};
use fg_gate::audit_engine::{AuditFinding, AuditSeverity, SnapshotAuditBundle, SourceLanguage};

pub(super) struct PerFileScoreRecord<'a> {
    pub(super) metric_summary: FileMetricSummary<'a>,
    pub(super) score: EvaluatedQualityScore,
    pub(super) debt_minutes: f64,
}

pub(super) struct PerFileBatchEval<'a> {
    pub(super) all_findings: Vec<AuditFinding>,
    pub(super) total_eloc: usize,
    pub(super) all_complexities: Vec<f64>,
    pub(super) min_large_entropy: Option<f64>,
    pub(super) records: Vec<PerFileScoreRecord<'a>>,
}

pub(super) fn evaluate_per_file_scores<'a>(
    bundle: &'a SnapshotAuditBundle,
    archetype: ProjectArchetype,
    curve: &QualityCurveConfig,
) -> PerFileBatchEval<'a> {
    let mut all_findings =
        Vec::with_capacity(bundle.file_outcomes.len() + bundle.cross_file_findings.len());
    let mut all_complexities = Vec::with_capacity(64);
    let mut total_eloc = 0usize;
    let mut min_large_entropy: Option<f64> = None;
    let mut records = Vec::with_capacity(bundle.file_outcomes.len());

    for outcome in &bundle.file_outcomes {
        total_eloc += outcome.eloc.max(1);
        for cc in &outcome.function_complexities {
            all_complexities.push(*cc);
        }
        if outcome.non_blank_lines >= 300 {
            min_large_entropy = Some(match min_large_entropy {
                Some(prev) => prev.min(outcome.shannon_entropy),
                None => outcome.shannon_entropy,
            });
        }
        let metric_summary = FileMetricSummary {
            file: outcome.file.as_str(),
            lines: outcome.lines,
            non_blank_lines: outcome.non_blank_lines,
            eloc: outcome.eloc,
            max_nesting_depth: outcome.max_nesting_depth,
            exported_symbols: outcome.exported_symbols,
            function_complexities: outcome.function_complexities.as_slice(),
        };
        let mut local_scoring = Vec::with_capacity(outcome.findings.len());
        let mut debt_minutes = 0.0_f64;
        for finding in &outcome.findings {
            all_findings.push(finding.clone());
            let sf = to_scoring_finding(finding);
            debt_minutes += resolve_issue_remediation_minutes(&sf);
            local_scoring.push(sf);
        }
        let score = evaluate_file_quality(&local_scoring, Some(&metric_summary), archetype, curve);
        records.push(PerFileScoreRecord {
            metric_summary,
            score,
            debt_minutes,
        });
    }

    for cycle_finding in &bundle.cross_file_findings {
        all_findings.push(cycle_finding.clone());
    }

    PerFileBatchEval {
        all_findings,
        total_eloc,
        all_complexities,
        min_large_entropy,
        records,
    }
}

pub(super) fn to_scoring_finding<'a>(finding: &'a AuditFinding) -> ScoringFinding<'a> {
    ScoringFinding {
        rule_id: finding.rule_id.as_str(),
        analyzer: finding.analyzer.as_str(),
        severity: match finding.severity {
            AuditSeverity::Error => FindingSeverity::Error,
            AuditSeverity::Warning => FindingSeverity::Warning,
            AuditSeverity::Info => FindingSeverity::Info,
        },
        message: finding.message.as_str(),
        line: finding.line,
    }
}

pub(super) fn count_rule_families(findings: &[AuditFinding]) -> Vec<usize> {
    let mut map: BTreeMap<&str, usize> = BTreeMap::new();
    for finding in findings {
        let prefix = finding
            .rule_id
            .split('-')
            .next()
            .unwrap_or(finding.rule_id.as_str());
        *map.entry(prefix).or_insert(0) += 1;
    }
    map.into_values().collect()
}

pub(super) fn evaluate_snapshot_polyglot(
    bundle: &SnapshotAuditBundle,
    records: &[PerFileScoreRecord<'_>],
) -> PolyglotBalanceReport {
    let mut counts = [0usize; 6];
    let mut locs = [0usize; 6];
    let mut sums = [0.0_f64; 6];
    for (outcome, rec) in bundle.file_outcomes.iter().zip(records.iter()) {
        let Some(stack_lang) = to_stack_language(outcome.language) else {
            continue;
        };
        let slot = stack_lang as usize;
        counts[slot] += 1;
        locs[slot] += outcome.lines;
        sums[slot] += rec.score.composite_score;
    }
    let langs = [
        StackLanguage::TypeScript,
        StackLanguage::GdScript,
        StackLanguage::Python,
        StackLanguage::Shell,
        StackLanguage::Rust,
        StackLanguage::Go,
    ];
    let mut measurements = Vec::with_capacity(6);
    for (slot, lang) in langs.iter().enumerate() {
        if counts[slot] > 0 {
            measurements.push(LanguageStackMeasurement {
                language: *lang,
                file_count: counts[slot],
                total_loc: locs[slot],
                mean_score: sums[slot] / (counts[slot] as f64),
            });
        }
    }
    evaluate_polyglot_balance(&measurements)
}

const fn to_stack_language(lang: SourceLanguage) -> Option<StackLanguage> {
    match lang {
        SourceLanguage::TypeScript => Some(StackLanguage::TypeScript),
        SourceLanguage::GdScript => Some(StackLanguage::GdScript),
        SourceLanguage::Python => Some(StackLanguage::Python),
        SourceLanguage::Shell => Some(StackLanguage::Shell),
        SourceLanguage::Rust => Some(StackLanguage::Rust),
        SourceLanguage::Go => Some(StackLanguage::Go),
        SourceLanguage::Other => None,
    }
}
