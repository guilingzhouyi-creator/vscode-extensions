//! Module: fg-core — Structural Quality Evidence Boundary
//! File Path: crates/fg-core/src/models/quality_evidence.rs
//! Architecture Role: Parse immutable documents against the shared wire schema.
//! Dependencies & Triggers: Canonical encoding, generated DTOs, and offline JSON Schema validation.
//! Responsibilities: Reject malformed evidence before it reaches semantic or authority verification.
//! Exit Semantics & Design Rationale: Structural validity never establishes approval or issuer trust.

use std::sync::OnceLock;

use jsonschema::Validator;
use serde_json::Value;

use crate::error::{FractalError, FractalResult};
use crate::models::quality_contracts::QualityDocument;
use crate::models::quality_encoding::canonical_review_json;

static VALIDATOR: OnceLock<Result<Validator, String>> = OnceLock::new();

/// A structurally validated wire document. This type conveys no issuer trust or gate authority.
///
/// The private fields and shared-only accessors prevent mutation after validation.
#[derive(Debug)]
pub struct StructuralQualityDocument {
    document: QualityDocument,
    canonical: Vec<u8>,
}

impl StructuralQualityDocument {
    /// Borrow the generated DTO without allowing mutation of its validated fields.
    pub fn document(&self) -> &QualityDocument {
        &self.document
    }

    /// The exact RFC 8785 bytes of the validated wire envelope.
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical
    }

    /// Encode the v1 receipt envelope and full payload, excluding only its signature.
    /// A MAC of these bytes proves integrity only, never issuer trust or approval.
    pub fn receipt_signing_bytes(&self) -> FractalResult<Vec<u8>> {
        let QualityDocument::TrustedReviewReceipt(receipt) = &self.document else {
            return Err(invalid(
                "receipt signing requires a trusted-review-receipt envelope",
            ));
        };
        let unsigned = serde_json::json!({
            "schemaVersion": receipt.schema_version,
            "kind": receipt.kind,
            "payload": receipt.payload,
        });
        let bytes = serde_json::to_vec(&unsigned)
            .map_err(|_| invalid("receipt signing payload could not be encoded"))?;
        canonical_review_json(&bytes)
    }
}

fn invalid(reason: &str) -> FractalError {
    FractalError::InvalidReviewEvidence {
        reason: reason.to_owned(),
    }
}

fn schema_validator() -> FractalResult<&'static Validator> {
    VALIDATOR
        .get_or_init(|| {
            let schema: Value =
                serde_json::from_str(include_str!("../../../../quality-evidence.schema.json"))
                    .map_err(|error| error.to_string())?;
            jsonschema::validator_for(&schema).map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|_| invalid("embedded quality evidence schema could not be compiled"))
}

/// Parse bounded strict JSON, validate the shared v1 schema, and freeze the typed result.
///
/// Runs in O(input size + schema validation); retains the DTO and canonical bytes.
/// Network and file schema resolution are disabled in the jsonschema dependency features.
/// Semantic completion, binding, signature integrity, and trust require separate verification.
pub fn parse_quality_document(input: &[u8]) -> FractalResult<StructuralQualityDocument> {
    let canonical = canonical_review_json(input)?;
    let value: Value = serde_json::from_slice(&canonical)
        .map_err(|_| invalid("canonical quality document could not be decoded"))?;
    if !schema_validator()?.is_valid(&value) {
        return Err(invalid(
            "document does not match the quality evidence v1 schema",
        ));
    }
    let document = serde_json::from_value(value)
        .map_err(|_| invalid("quality evidence schema and generated DTO disagree"))?;
    Ok(StructuralQualityDocument {
        document,
        canonical,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn vectors() -> Value {
        serde_json::from_str(include_str!(
            "../../../../tests/fixtures/quality/schema-vectors.json"
        ))
        .expect("shared quality schema fixtures")
    }

    #[test]
    fn shared_documents_round_trip_without_losing_states() {
        let fixtures = vectors();
        for document in fixtures["documents"]
            .as_object()
            .expect("documents")
            .values()
        {
            let input = serde_json::to_vec(document).expect("fixture serialization");
            let parsed = parse_quality_document(&input).expect("structural document");
            let encoded = serde_json::to_vec(parsed.document()).expect("DTO serialization");
            assert_eq!(
                crate::models::quality_encoding::canonical_review_json(&encoded)
                    .expect("canonical DTO"),
                parsed.canonical_bytes()
            );
            assert_eq!(
                parsed.canonical_bytes(),
                crate::models::quality_encoding::canonical_review_json(&input)
                    .expect("canonical fixture")
            );
        }
    }

    #[test]
    fn shared_mutations_are_rejected() {
        let fixtures = vectors();
        for vector in fixtures["mutations"].as_array().expect("negative vectors") {
            let name = vector["name"].as_str().expect("name");
            let base = vector["target"].as_str().expect("target");
            let pointer = vector["pointer"].as_str().expect("pointer");
            let mut document = fixtures["documents"][base].clone();
            let (parent, field) = pointer.rsplit_once('/').expect("field pointer");
            let object = document
                .pointer_mut(parent)
                .expect("parent")
                .as_object_mut()
                .expect("object");
            if vector["action"] == "remove" {
                object.remove(field);
            } else {
                object.insert(field.to_owned(), vector["value"].clone());
            }
            let input = serde_json::to_vec(&document).expect("mutated document");
            assert!(parse_quality_document(&input).is_err(), "{name}");
        }
    }

    #[test]
    fn receipt_signing_covers_the_envelope_and_payload() {
        use crate::models::authority::AuthoritySecret;
        use crate::models::quality_encoding::{canonical_review_sm3, sign_canonical_review};

        let vector: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/quality/receipt-signing-vector.json"
        ))
        .expect("shared signing vector");
        let input = serde_json::to_vec(&vector["receipt"]).expect("receipt input");
        let parsed = parse_quality_document(&input).expect("structural receipt");
        let bytes = parsed
            .receipt_signing_bytes()
            .expect("receipt signing bytes");
        assert_eq!(
            bytes,
            vector["signingCanonical"]
                .as_str()
                .expect("bytes")
                .as_bytes()
        );
        let secret = AuthoritySecret::from_hex(vector["testKeyHex"].as_str().expect("test key"))
            .expect("public interoperability key");
        let signature = sign_canonical_review(&bytes, &secret).expect("MAC");
        let hex = |value: &[u8]| {
            value
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        assert_eq!(hex(&signature), vector["receipt"]["signature"]);
        assert_eq!(
            hex(&canonical_review_sm3(&bytes).expect("digest")),
            vector["signingDigestSm3"]
        );
        for (name, field) in [
            ("request", "requestCanonical"),
            ("evidence", "evidenceCanonical"),
        ] {
            let input = serde_json::to_vec(&vectors()["documents"][name]).expect("document");
            assert_eq!(
                canonical_review_json(&input).expect("canonical"),
                vector[field]
                    .as_str()
                    .expect("canonical fixture")
                    .as_bytes()
            );
        }
        let request = serde_json::to_vec(&vectors()["documents"]["request"]).expect("request");
        assert!(parse_quality_document(&request)
            .expect("request")
            .receipt_signing_bytes()
            .is_err());
    }

    #[test]
    fn duplicate_wire_fields_are_rejected_before_schema_validation() {
        let fixtures = vectors();
        let document =
            serde_json::to_string(&fixtures["documents"]["request"]).expect("request fixture");
        let duplicate = document.replacen('{', "{\"schemaVersion\":1,", 1);
        assert!(parse_quality_document(duplicate.as_bytes()).is_err());
    }

    #[test]
    fn ten_dimensions_and_quant_metrics_round_trip_and_reject_invalid_bounds() {
        let mut evidence = vectors()["documents"]["evidence"].clone();
        evidence["measurements"]["tenDimensions"] = serde_json::json!({
            "architectureConsistency": 94.5,
            "semanticPurity": 96.0,
            "codeSecurity": 99.5,
            "performanceEfficiency": 92.25,
            "standardization": 95.0,
            "modernity": 91.5,
            "maintainability": 93.0,
            "commentQuality": 89.75,
            "duplication": 98.0,
            "techDebtRisk": 97.5,
            "compositeScore": 94.8,
            "grade": "A+"
        });
        evidence["measurements"]["quantMetrics"] = serde_json::json!({
            "rcr": 1.4,
            "erq": 2.1,
            "ddr": 1.8,
            "edb95": 3.2,
            "ptd": 4.5,
            "dsi": 0.28,
            "rcd": 1.15,
            "ehl": 2.5,
            "workspaceHealthScore": 93.2,
            "autonomyRate": 0.96,
            "polyglotIndex": 91.0,
            "sqaleMinutes": 42.5,
            "tdr": 0.03,
            "confidence": 0.91
        });
        let raw = serde_json::to_vec(&evidence).expect("encode evidence");
        let parsed = parse_quality_document(&raw).expect("valid extended evidence");
        let reparsed = parse_quality_document(parsed.canonical_bytes()).expect("re-parse");
        assert_eq!(parsed.document(), reparsed.document());
        assert_eq!(parsed.canonical_bytes(), reparsed.canonical_bytes());

        let mut extra = evidence.clone();
        extra["measurements"]["quantMetrics"]["extraMetric"] = serde_json::json!(1.0);
        assert!(
            parse_quality_document(&serde_json::to_vec(&extra).expect("encode extra")).is_err()
        );

        let mut bad_score = evidence;
        bad_score["measurements"]["tenDimensions"]["codeSecurity"] = serde_json::json!(101.0);
        assert!(
            parse_quality_document(&serde_json::to_vec(&bad_score).expect("encode bad")).is_err()
        );
    }
}
