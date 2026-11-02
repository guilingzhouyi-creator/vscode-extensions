//! Module: fg-core — Cryptographic Tamper-Proof Audit Chain & Telemetry Record
//! File Path: crates/fg-core/src/models/audit_chain.rs
//! Architecture Role: Implements the in-kernel cryptographic audit log protocol:
//!   - Single-line compact NDJSON serialization (< 350 bytes per entry).
//!   - Lamport monotonic logical clocks (`clk`) eliminating physical clock skew.
//!   - HMAC-SHA1 Merkle-hash-chain (`prev` -> `sig` cascade) preventing history tampering.
//!   - `cat_sort_uniq` idempotent merge algorithm for concurrent multi-agent branches.
//!
//! SSOT Domain Governance Rules:
//! - `FGT-AUD-001`: Cryptographic telemetry audit hash-chain and <= 350B budget guard.
//! - `FGT-COR-001`: Core domain error and model closure.
//! - `FGT-STO-001`: Crash-safe and tamper-evident storage guarantees.

use serde::{Deserialize, Serialize};

use super::authority::{ct_eq_bytes, AuthoritySecret};
use super::hex::encode_hex;
use crate::error::{FractalError, FractalResult};

/// Genesis sentinel string for the first record in an audit chain.
pub const GENESIS_PREV_HASH: &str = "00000000";

/// Hard per-record byte budget for the active runs ledger (< 350B).
pub const AUDIT_RECORD_BYTE_BUDGET: usize = 350;

/// Number of hex characters retained for record fingerprints (8 chars = 32 bits).
pub const HASH_FINGERPRINT_LEN: usize = 8;

/// Number of hex characters retained for HMAC signatures (16 chars = 64 bits).
pub const SIGNATURE_HEX_LEN: usize = 16;

const fn is_zero_u32(val: &u32) -> bool {
    *val == 0
}

const fn is_zero_f32(val: &f32) -> bool {
    *val == 0.0
}

const fn is_false(val: &bool) -> bool {
    !*val
}

/// In-kernel code verifier (TKCV) invariant outcome snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditTkcvVerdict {
    /// Whether Control Flow Graph (CFG) boundary was respected.
    pub cfg: bool,
    /// Transient heap allocation count detected in loop hot paths (target: 0).
    pub alloc: u32,
    /// Total formal AST invariant violations detected by TKCV (`FGT-VRF-001`).
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub viol: u32,
}

/// In-kernel canary engine (IKCE) hidden blind-test outcome snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AuditIkceVerdict {
    /// Canary mutation kill ratio (0.0 to 1.0, e.g. 0.95 = 95% killed).
    pub mut_kill: f32,
    /// Whether round-trip and idempotency invariants held true.
    pub roundtrip: bool,
    /// Tautological or vacuous assertion count caught by IKCE (`FGT-TAU-001`).
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub taut: u32,
}

/// Net quality evolution, Bayesian credit rating, and 5D manifold telemetry.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AuditScore {
    /// Net quality delta (+/- score increment).
    pub net: f32,
    /// Dynamic agent credit score (0.0 to 100.0, Jeffreys Beta posterior).
    pub cred: f32,
    /// 95% Bayesian credible interval lower bound in `[0.0, 1.0]`.
    #[serde(default)]
    pub ci_lo: f32,
    /// 5D Riemannian phase-space Mahalanobis distance norm (`>= 0.0`).
    #[serde(default)]
    pub d_norm: f32,
    /// Whether the candidate triggered quarantine isolation (`FGT-QRN-001`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub quar: bool,
    /// Net 5D ELOC turnover evaluated for this commit beat.
    #[serde(default, skip_serializing_if = "is_zero_f32")]
    pub turn: f32,
}

impl AuditScore {
    /// Returns the net 5D ELOC turnover evaluated for this commit beat.
    pub const fn net_turnover(&self) -> f32 {
        self.turn
    }
}

/// A compact, cryptographically tamper-evident single audit record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditRecord {
    /// Unix timestamp in seconds.
    pub t: u64,
    /// Lamport logical clock (monotonically increasing counter).
    pub clk: u64,
    /// Target commit short OID (up to 8 hex chars).
    pub rev: String,
    /// Previous record HMAC fingerprint (`00000000` for genesis).
    pub prev: String,
    /// Agent or actor identifier (e.g. "sub-03").
    pub actor: String,
    /// Target domain module identifier (e.g. "engine").
    #[serde(rename = "mod")]
    pub mod_id: String,
    /// TKCV invariant verification outcome.
    pub tkcv: AuditTkcvVerdict,
    /// IKCE hidden blind-test canary outcome.
    pub ikce: AuditIkceVerdict,
    /// Quality score and credit snapshot.
    pub score: AuditScore,
    /// Truncated HMAC-SHA1 cryptographic signature over canonical payload.
    pub sig: String,
}

/// Consolidated parameter object for constructing an unsigned cryptographic audit record.
#[derive(Debug, Clone, PartialEq)]
pub struct UnsignedAuditRecordParams {
    /// Unix timestamp in seconds.
    pub t: u64,
    /// Lamport logical clock counter.
    pub clk: u64,
    /// Target commit short OID.
    pub rev: String,
    /// Previous record HMAC fingerprint.
    pub prev: String,
    /// Agent or actor identifier.
    pub actor: String,
    /// Target domain module identifier.
    pub mod_id: String,
    /// TKCV invariant verification outcome.
    pub tkcv: AuditTkcvVerdict,
    /// IKCE hidden blind-test canary outcome.
    pub ikce: AuditIkceVerdict,
    /// Quality score and credit snapshot.
    pub score: AuditScore,
}

impl AuditRecord {
    /// Creates an unsigned audit record instance from a structured parameter object.
    #[must_use]
    pub fn new_unsigned(params: UnsignedAuditRecordParams) -> Self {
        let rev_bounded = if params.rev.len() > 8 {
            params.rev[..8].to_string()
        } else {
            params.rev
        };

        let prev_bounded = if params.prev.len() > HASH_FINGERPRINT_LEN {
            params.prev[..HASH_FINGERPRINT_LEN].to_string()
        } else {
            params.prev
        };

        Self {
            t: params.t,
            clk: params.clk,
            rev: rev_bounded,
            prev: prev_bounded,
            actor: params.actor,
            mod_id: params.mod_id,
            tkcv: params.tkcv,
            ikce: params.ikce,
            score: params.score,
            sig: String::new(),
        }
    }

    /// Computes the deterministic canonical representation used for signing (`FGT-AUD-001`).
    #[must_use]
    pub fn canonical_payload(&self) -> String {
        format!(
            "{}:{}:{}:{}:{}:{}:{}:{}:{}:{:.2}:{}:{}:{:.2}:{:.1}:{:.4}:{:.4}:{}:{:.1}",
            self.t,
            self.clk,
            self.rev,
            self.prev,
            self.actor,
            self.mod_id,
            self.tkcv.cfg,
            self.tkcv.alloc,
            self.tkcv.viol,
            self.ikce.mut_kill,
            self.ikce.roundtrip,
            self.ikce.taut,
            self.score.net,
            self.score.cred,
            self.score.ci_lo,
            self.score.d_norm,
            self.score.quar,
            self.score.turn,
        )
    }

    /// Signs this record using the kernel authority secret and embeds the signature.
    pub fn sign(&mut self, secret: &AuthoritySecret) {
        let payload = self.canonical_payload();
        let signature_bytes = secret.sign_payload(payload.as_bytes());
        let full_signature_hex = encode_hex(&signature_bytes);
        self.sig = full_signature_hex[..SIGNATURE_HEX_LEN].to_string();
    }

    /// Verifies whether the embedded signature matches the canonical payload.
    #[must_use]
    pub fn verify_signature(&self, secret: &AuthoritySecret) -> bool {
        if self.sig.len() != SIGNATURE_HEX_LEN {
            return false;
        }
        let payload = self.canonical_payload();
        let expected_signature = secret.sign_payload(payload.as_bytes());
        let expected_hex = encode_hex(&expected_signature);
        ct_eq_bytes(
            self.sig.as_bytes(),
            &expected_hex.as_bytes()[..SIGNATURE_HEX_LEN],
        )
    }

    /// Computes the chaining hash fingerprint of this record (used as `prev` for next record).
    #[must_use]
    pub fn compute_record_hash(&self, secret: &AuthoritySecret) -> String {
        let chain_input = format!("{}:{}:{}", self.prev, self.clk, self.sig);
        let fingerprint_bytes = secret.sign_payload(chain_input.as_bytes());
        let full_fingerprint_hex = encode_hex(&fingerprint_bytes);
        full_fingerprint_hex[..HASH_FINGERPRINT_LEN].to_string()
    }

    /// Serializes this record into a single-line NDJSON string, verifying budget <= 350B.
    ///
    /// # Errors
    /// Returns [`FractalError::PolicyViolation`] if the serialized line exceeds [`AUDIT_RECORD_BYTE_BUDGET`].
    pub fn to_ndjson_line(&self) -> FractalResult<String> {
        let serialized = serde_json::to_string(self)?;
        if serialized.len() > AUDIT_RECORD_BYTE_BUDGET {
            return Err(FractalError::PolicyViolation(format!(
                "FGT-AUD-001: Audit record NDJSON exceeded byte budget (got {} bytes, ceiling {})",
                serialized.len(),
                AUDIT_RECORD_BYTE_BUDGET
            )));
        }
        Ok(serialized)
    }

    /// Deserializes an audit record from a single-line NDJSON string.
    ///
    /// # Errors
    /// Propagates JSON decoding failures.
    pub fn from_ndjson_line(line: &str) -> FractalResult<Self> {
        let trimmed = line.trim();
        let record: Self = serde_json::from_str(trimmed)?;
        Ok(record)
    }
}

/// Managed cryptographically verifiable audit hash chain.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AuditHashChain {
    records: Vec<AuditRecord>,
}

impl AuditHashChain {
    /// Creates an empty audit hash chain.
    #[must_use]
    pub fn new() -> Self {
        Self {
            records: Vec::new(),
        }
    }

    /// Returns a slice of all records in chronological order.
    #[must_use]
    pub fn records(&self) -> &[AuditRecord] {
        &self.records
    }

    /// Returns the number of records in the chain.
    #[must_use]
    pub fn len(&self) -> usize {
        self.records.len()
    }

    /// Returns true if the chain contains no records.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// Returns the expected `prev` fingerprint for the next appended record.
    #[must_use]
    pub fn next_expected_prev(&self, secret: &AuthoritySecret) -> String {
        match self.records.last() {
            Some(last) => last.compute_record_hash(secret),
            None => GENESIS_PREV_HASH.to_string(),
        }
    }

    /// Returns the next expected Lamport clock value.
    #[must_use]
    pub fn next_expected_clk(&self) -> u64 {
        match self.records.last() {
            Some(last) => last.clk + 1,
            None => 1,
        }
    }

    /// Appends a new signed record into the chain, enforcing hash link and monotonic clock invariants.
    ///
    /// # Errors
    /// Returns [`FractalError::AuditIntegrityViolation`] if chaining or clock invariants are broken.
    pub fn append(
        &mut self,
        mut record: AuditRecord,
        secret: &AuthoritySecret,
    ) -> FractalResult<()> {
        let expected_prev = self.next_expected_prev(secret);
        if record.prev != expected_prev {
            return Err(FractalError::AuditIntegrityViolation(format!(
                "hash chain broken at rev '{}': expected prev '{}', observed '{}'",
                record.rev, expected_prev, record.prev
            )));
        }

        if let Some(last) = self.records.last() {
            if record.clk <= last.clk {
                return Err(FractalError::AuditIntegrityViolation(format!(
                    "non-monotonic Lamport clock at rev '{}': previous clk={}, observed clk={}",
                    record.rev, last.clk, record.clk
                )));
            }
        }

        if !record.verify_signature(secret) {
            record.sign(secret);
        }

        self.records.push(record);
        Ok(())
    }

    /// Verifies the integrity of the entire chain from genesis to tail.
    ///
    /// # Errors
    /// Returns [`FractalError::AuditIntegrityViolation`] if any record is forged, tampered with, or misordered.
    pub fn verify_integrity(&self, secret: &AuthoritySecret) -> FractalResult<()> {
        let mut expected_prev = GENESIS_PREV_HASH.to_string();
        let mut last_clk = 0u64;

        for (idx, record) in self.records.iter().enumerate() {
            if record.prev != expected_prev {
                return Err(FractalError::AuditIntegrityViolation(format!(
                    "tamper detected at index {idx} (rev '{}'): expected prev '{expected_prev}', observed '{}'",
                    record.rev, record.prev
                )));
            }

            if idx > 0 && record.clk <= last_clk {
                return Err(FractalError::AuditIntegrityViolation(format!(
                    "clock corruption at index {idx} (rev '{}'): clock did not advance (prev={last_clk}, current={})",
                    record.rev, record.clk
                )));
            }

            if !record.verify_signature(secret) {
                return Err(FractalError::AuditIntegrityViolation(format!(
                    "invalid signature at index {idx} (rev '{}'): HMAC signature verification failed",
                    record.rev
                )));
            }

            expected_prev = record.compute_record_hash(secret);
            last_clk = record.clk;
        }

        Ok(())
    }

    /// Performs idempotent `cat_sort_uniq` merge across multiple concurrent branch chains.
    ///
    /// Entries are sorted by `(clk, actor, rev)` and deduplicated by `(clk, rev)`.
    #[must_use]
    pub fn merge_cat_sort_uniq(chains: &[&AuditHashChain]) -> Self {
        let mut all_records: Vec<AuditRecord> = Vec::new();
        for chain in chains {
            all_records.extend_from_slice(&chain.records);
        }

        all_records.sort_by(|a, b| {
            a.clk
                .cmp(&b.clk)
                .then_with(|| a.actor.cmp(&b.actor))
                .then_with(|| a.rev.cmp(&b.rev))
        });

        let mut deduped: Vec<AuditRecord> = Vec::with_capacity(all_records.len());
        for rec in all_records {
            let is_duplicate = deduped
                .last()
                .is_some_and(|last| last.clk == rec.clk && last.rev == rec.rev);
            if !is_duplicate {
                deduped.push(rec);
            }
        }

        Self { records: deduped }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_secret() -> AuthoritySecret {
        AuthoritySecret::from_bytes(&[0x42; 32]).expect("valid 32-byte secret")
    }

    fn make_test_record(
        clk: u64,
        rev: &str,
        prev: &str,
        actor: &str,
        net: f32,
        cred: f32,
    ) -> AuditRecord {
        AuditRecord::new_unsigned(UnsignedAuditRecordParams {
            t: 1729000000 + clk,
            clk,
            rev: rev.to_string(),
            prev: prev.to_string(),
            actor: actor.to_string(),
            mod_id: "core".to_string(),
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
                net,
                cred,
                ci_lo: 0.91,
                d_norm: 0.14,
                quar: false,
                turn: 0.0,
            },
        })
    }

    #[test]
    fn test_audit_record_signing_and_verification() {
        let secret = test_secret();
        let mut rec = make_test_record(1, "a1b2c3d4", GENESIS_PREV_HASH, "sub-01", 0.45, 96.5);

        assert!(!rec.verify_signature(&secret));
        rec.sign(&secret);
        assert!(rec.verify_signature(&secret));

        // Tampering with any field (including new telemetry fields) must invalidate signature
        let mut tampered = rec.clone();
        tampered.score.net = 0.99;
        assert!(!tampered.verify_signature(&secret));

        let mut tampered_ci = rec.clone();
        tampered_ci.score.ci_lo = 0.50;
        assert!(!tampered_ci.verify_signature(&secret));

        let mut tampered_taut = rec;
        tampered_taut.ikce.taut = 2;
        assert!(!tampered_taut.verify_signature(&secret));
    }

    #[test]
    fn test_audit_record_ndjson_budget() {
        let secret = test_secret();
        let mut rec = make_test_record(
            1042,
            "12345678",
            GENESIS_PREV_HASH,
            "ar-construct-01",
            0.85,
            99.2,
        );
        rec.sign(&secret);

        let line = rec.to_ndjson_line().expect("valid line");
        assert!(
            line.len() <= AUDIT_RECORD_BYTE_BUDGET,
            "line length {} exceeded budget {}",
            line.len(),
            AUDIT_RECORD_BYTE_BUDGET
        );

        let parsed = AuditRecord::from_ndjson_line(&line).expect("valid decode");
        assert_eq!(rec, parsed);
    }

    #[test]
    fn test_audit_hash_chain_append_and_tamper_detection() {
        let secret = test_secret();
        let mut chain = AuditHashChain::new();

        let mut r1 = make_test_record(1, "rev00001", GENESIS_PREV_HASH, "agent-a", 0.2, 90.0);
        r1.sign(&secret);
        chain.append(r1, &secret).expect("r1 append success");

        let expected_prev_p2 = chain.next_expected_prev(&secret);
        let mut r2 = make_test_record(2, "rev00002", &expected_prev_p2, "agent-b", 0.4, 95.0);
        r2.sign(&secret);
        chain.append(r2, &secret).expect("r2 append success");

        assert!(chain.verify_integrity(&secret).is_ok());

        // Tamper with r1 inside chain
        let mut corrupted_chain = chain.clone();
        corrupted_chain.records[0].score.cred = 100.0;
        let verification_error = corrupted_chain.verify_integrity(&secret);
        assert!(verification_error.is_err());
    }

    #[test]
    fn test_audit_chain_cat_sort_uniq_merge() {
        let secret = test_secret();
        let mut chain_a = AuditHashChain::new();
        let mut chain_b = AuditHashChain::new();

        let mut r1 = make_test_record(1, "rev00001", GENESIS_PREV_HASH, "agent-a", 0.2, 90.0);
        r1.sign(&secret);
        chain_a.append(r1.clone(), &secret).unwrap();

        let expected_prev_p2 = chain_a.next_expected_prev(&secret);
        let mut r2a = make_test_record(2, "rev00002", &expected_prev_p2, "agent-a", 0.4, 95.0);
        r2a.sign(&secret);
        chain_a.append(r2a, &secret).unwrap();

        // chain_b has identical r1 and a distinct r2b at clk 3
        chain_b.append(r1, &secret).unwrap();
        let mut r2b = make_test_record(3, "rev00003", &expected_prev_p2, "agent-b", 0.1, 88.0);
        r2b.sign(&secret);
        chain_b.append(r2b, &secret).unwrap();

        let merged = AuditHashChain::merge_cat_sort_uniq(&[&chain_a, &chain_b]);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged.records()[0].clk, 1);
        assert_eq!(merged.records()[1].clk, 2);
        assert_eq!(merged.records()[2].clk, 3);
    }
}
