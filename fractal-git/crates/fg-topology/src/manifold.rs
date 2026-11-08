//! Module: fg-topology — Trinity Composite Manifold Metrics & Quality Trace
//! File Path: crates/fg-topology/src/manifold.rs
//! Architecture Role: Evaluates the three-pillar composite manifold of code evolution:
//!   1. Cryptographic Integrity: Validates HMAC-SHA1 chain unbroken continuity from Genesis to tip.
//!   2. Invariant & Canary Quality: Aggregates TKCV formal proofs, IKCE mutant kill rates, and Bayesian credit.
//!   3. 5D Riemann Phase Space: Measures geometric deviation vector $[D_{\text{line}}, D_{\text{col}}, D_{\text{reuse}}, D_{\text{shared}}, D_{\text{payload}}]$ and net technical debt delta ($\Delta\text{Debt}$).
//!
//! Dependencies & Triggers: Consumed by `taxis quality trace` and promotion governance gates.
//! Responsibilities: Holistic manifold evaluation, multi-dimensional score synthesis, and visual trace rendering.
//!
//! Exit Semantics & Design Rationale:
//!   - Single-pass linear evaluation over in-memory audit records without disk allocations.
//!   - Deterministic and tamper-evident: any modified byte in the audit chain breaks the cryptographic seal.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TOP-001`: Fractal topology reference guard
//! - `FGT-PRF-001`: Hot-path zero transient heap allocation guard

use fg_core::models::{AuditHashChain, AuditRecord, AuthoritySecret};
use serde::{Deserialize, Serialize};

/// 5D Riemann Phase Space tensor $[D_{\text{line}}, D_{\text{col}}, D_{\text{reuse}}, D_{\text{shared}}, D_{\text{payload}}]$.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Riemann5DPhaseVector {
    /// Line density deviation from baseline.
    pub d_line: f64,
    /// Column density and nesting depth deviation.
    pub d_col: f64,
    /// Module reuse index.
    pub d_reuse: f64,
    /// Shared symbol coupling index.
    pub d_shared: f64,
    /// AST payload entropy.
    pub d_payload: f64,
}

impl Default for Riemann5DPhaseVector {
    fn default() -> Self {
        Self {
            d_line: 0.0,
            d_col: 0.0,
            d_reuse: 1.0,
            d_shared: 0.0,
            d_payload: 0.0,
        }
    }
}

impl Riemann5DPhaseVector {
    /// Computes the Euclidean norm (manifold distance from optimal origin).
    #[must_use]
    pub fn distance_from_origin(&self) -> f64 {
        (self.d_line * self.d_line
            + self.d_col * self.d_col
            + (self.d_reuse - 1.0) * (self.d_reuse - 1.0)
            + self.d_shared * self.d_shared
            + self.d_payload * self.d_payload)
            .sqrt()
    }
}

/// Comprehensive composite snapshot synthesized from the audit chain and geometric metrics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrinityManifoldSnapshot {
    /// Whether cryptographic HMAC chain integrity is fully intact from genesis to tip.
    pub chain_verified: bool,
    /// Total number of verified records in the chain.
    pub chain_length: usize,
    /// Measured aggregate kill rate; compact audit rates lack execution denominators.
    pub avg_mutant_kill_rate: Option<f64>,
    /// Total loop transient heap allocations reported by compact audit records.
    pub total_transient_allocs: u32,
    /// Objective credit, absent without provenance-backed trial counts.
    pub bayesian_credit: Option<f64>,
    /// Lower bound of the 95% Bayesian credible interval, when measured.
    pub credit_lower_bound: Option<f64>,
    /// Upper bound of the 95% Bayesian credible interval, when measured.
    pub credit_upper_bound: Option<f64>,
    /// Evaluated 5D Riemann phase space vector.
    pub riemann_vector: Riemann5DPhaseVector,
    /// Manifold geometric deviation from optimal origin.
    pub riemann_deviation: f64,
    /// Cumulative net quality delta across all records.
    pub net_quality_delta: f64,
    /// Technical debt change, absent without a calibrated measurement model.
    pub net_debt_delta: Option<f64>,
}

/// Evaluates multi-dimensional code evolution manifolds.
#[derive(Debug, Default)]
pub struct TrinityManifoldEvaluator;

impl TrinityManifoldEvaluator {
    /// Evaluates an audit record sequence and optional Riemann vector against the kernel secret.
    pub fn evaluate(
        records: &[AuditRecord],
        riemann: Option<Riemann5DPhaseVector>,
        secret: &AuthoritySecret,
    ) -> TrinityManifoldSnapshot {
        let riemann_vec = riemann.unwrap_or_default();
        let riemann_deviation = riemann_vec.distance_from_origin();

        if records.is_empty() {
            return TrinityManifoldSnapshot {
                chain_verified: true,
                chain_length: 0,
                avg_mutant_kill_rate: None,
                total_transient_allocs: 0,
                bayesian_credit: None,
                credit_lower_bound: None,
                credit_upper_bound: None,
                riemann_vector: riemann_vec,
                riemann_deviation,
                net_quality_delta: 0.0,
                net_debt_delta: None,
            };
        }

        // Verify cryptographic chain
        let mut chain = AuditHashChain::new();
        let mut chain_verified = true;
        for record in records {
            if chain.append(record.clone(), secret).is_err() {
                chain_verified = false;
                break;
            }
        }
        if chain_verified {
            chain_verified = chain.verify_integrity(secret).is_ok();
        }

        let mut total_allocs = 0u32;
        let mut total_net_quality = 0.0f64;

        for record in records {
            total_allocs += record.tkcv.alloc;
            total_net_quality += record.score.net as f64;
        }

        // Compact audit records contain rates without execution identities or trial
        // denominators. Authenticating their chain does not make them measurements.
        TrinityManifoldSnapshot {
            chain_verified,
            chain_length: records.len(),
            avg_mutant_kill_rate: None,
            total_transient_allocs: total_allocs,
            bayesian_credit: None,
            credit_lower_bound: None,
            credit_upper_bound: None,
            riemann_vector: riemann_vec,
            riemann_deviation,
            net_quality_delta: total_net_quality,
            net_debt_delta: None,
        }
    }

    /// Renders an ASCII visualization of the evolution quality trace for terminal inspection.
    pub fn render_ascii_trace(snapshot: &TrinityManifoldSnapshot) -> String {
        let chain_status = if !snapshot.chain_verified {
            "TAMPERED / INVALID CHAIN"
        } else if snapshot.chain_length == 0 {
            "UNMEASURED (0 VERIFIED RECORDS)"
        } else {
            "VALID (HMAC-SHA1 SEAL INTACT)"
        };

        let kill_rate_str = snapshot.avg_mutant_kill_rate.map_or_else(
            || "UNMEASURED (no execution samples)".to_string(),
            |rate| format!("{:.1}%", rate * 100.0),
        );
        let credit_bar = match (
            snapshot.bayesian_credit,
            snapshot.credit_lower_bound,
            snapshot.credit_upper_bound,
        ) {
            (Some(mean), Some(lower), Some(upper)) => {
                format!("{mean:.1}% (95% CI: [{lower:.1}%, {upper:.1}%])")
            }
            _ => "UNMEASURED (no execution samples)".to_string(),
        };
        let debt_delta = snapshot.net_debt_delta.map_or_else(
            || "UNMEASURED (no calibrated model)".to_string(),
            |delta| format!("{delta:+.2} debt points eliminated"),
        );

        format!(
            "================================================================================\n\
             TAXIS EVOLUTION QUALITY TRACE (TRINITY MANIFOLD)\n\
             ================================================================================\n\
             [Pillar 1: Cryptographic Integrity]\n\
               Audit Chain Status     : {}\n\
               Verified Record Count  : {}\n\n\
             [Pillar 2: Invariants & Blind Mutation Canary]\n\
               Mutant Kill Rate (K)   : {}\n\
               Transient Allocations  : {} in hot paths (Target: 0)\n\
               Bayesian Credit Rating : {}\n\n\
             [Pillar 3: 5D Riemann Phase Space & Technical Debt]\n\
               Riemann Deviation (||D||) : {:.4}\n\
               Net Quality Delta (+/-)  : {:+.2}\n\
               Net Debt Reduction       : {}\n\
             ================================================================================\n",
            chain_status,
            snapshot.chain_length,
            kill_rate_str,
            snapshot.total_transient_allocs,
            credit_bar,
            snapshot.riemann_deviation,
            snapshot.net_quality_delta,
            debt_delta
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fg_core::models::{
        AuditIkceVerdict, AuditScore, AuditTkcvVerdict, UnsignedAuditRecordParams,
    };

    #[test]
    fn test_trinity_manifold_evaluation_and_rendering() {
        let secret = AuthoritySecret::from_bytes(&[0x55; 32]).unwrap();

        let mut r1 = AuditRecord::new_unsigned(UnsignedAuditRecordParams {
            t: 1729000000,
            clk: 1,
            rev: "c0000001".into(),
            prev: "00000000".into(),
            actor: "agent-01".into(),
            mod_id: "core".into(),
            tkcv: AuditTkcvVerdict {
                cfg: true,
                alloc: 0,
                viol: 0,
            },
            ikce: AuditIkceVerdict {
                mut_kill: 0.95,
                roundtrip: true,
                taut: 0,
            },
            score: AuditScore {
                net: 2.0,
                cred: 95.0,
                ci_lo: 0.90,
                d_norm: 0.12,
                quar: false,
                turn: 12.0,
            },
        });
        r1.sign(&secret);
        let h1 = r1.compute_record_hash(&secret);

        let mut r2 = AuditRecord::new_unsigned(UnsignedAuditRecordParams {
            t: 1729000010,
            clk: 2,
            rev: "c0000002".into(),
            prev: h1,
            actor: "agent-01".into(),
            mod_id: "core".into(),
            tkcv: AuditTkcvVerdict {
                cfg: true,
                alloc: 0,
                viol: 0,
            },
            ikce: AuditIkceVerdict {
                mut_kill: 0.90,
                roundtrip: true,
                taut: 0,
            },
            score: AuditScore {
                net: 1.5,
                cred: 94.0,
                ci_lo: 0.89,
                d_norm: 0.15,
                quar: false,
                turn: 8.5,
            },
        });
        r2.sign(&secret);

        let records = vec![r1, r2];
        let snapshot = TrinityManifoldEvaluator::evaluate(&records, None, &secret);

        assert!(snapshot.chain_verified);
        assert_eq!(snapshot.chain_length, 2);
        let encoded = serde_json::to_value(&snapshot).unwrap();
        assert!(encoded["avg_mutant_kill_rate"].is_null());
        assert!(encoded["bayesian_credit"].is_null());
        assert!(encoded["credit_lower_bound"].is_null());
        assert!(encoded["credit_upper_bound"].is_null());
        assert_eq!(snapshot.total_transient_allocs, 0);
        assert!(snapshot.net_quality_delta > 3.0);
        assert_eq!(snapshot.net_debt_delta, None);

        let ascii = TrinityManifoldEvaluator::render_ascii_trace(&snapshot);
        assert!(ascii.contains("VALID (HMAC-SHA1 SEAL INTACT)"));
        assert!(ascii.contains("Mutant Kill Rate"));
    }
}
