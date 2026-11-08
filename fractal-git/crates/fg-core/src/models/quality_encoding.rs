//! Module: fg-core — Canonical Review JSON Encoding
//! File Path: crates/fg-core/src/models/quality_encoding.rs
//! Architecture Role: Bounded, lossless RFC 8785 encoding for review evidence payloads.
//! Dependencies & Triggers: Serde, the pinned JCS implementation, and existing SM3 primitives.
//! Responsibilities: Reject duplicate keys, invalid numbers and Unicode before hashing or signing.
//! Exit Semantics & Design Rationale: Encoding and MAC verification do not establish issuer trust.

use std::fmt;

use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Number, Value};

use crate::crypto::sm3_hash;
use crate::error::{FractalError, FractalResult};
use crate::models::authority::{ct_eq_bytes, AuthoritySecret};

/// Review payloads are bounded independently of transport framing.
pub const MAX_REVIEW_JSON_BYTES: usize = 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

const MAX_JSON_DEPTH: usize = 64;
struct UniqueJson(Value);
struct UniqueJsonSeed(usize);
struct UniqueJsonVisitor(usize);

impl<'de> Deserialize<'de> for UniqueJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        UniqueJsonSeed(0).deserialize(deserializer)
    }
}

impl<'de> DeserializeSeed<'de> for UniqueJsonSeed {
    type Value = UniqueJson;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(UniqueJsonVisitor(self.0))
    }
}

impl<'de> Visitor<'de> for UniqueJsonVisitor {
    type Value = UniqueJson;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("unique-key JSON with finite, interoperable numbers")
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Self::Value, E> {
        Ok(UniqueJson(Value::Bool(value)))
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(UniqueJson(Value::Null))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
        Ok(UniqueJson(Value::String(value.to_owned())))
    }

    fn visit_string<E: de::Error>(self, value: String) -> Result<Self::Value, E> {
        Ok(UniqueJson(Value::String(value)))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
        if value.unsigned_abs() > MAX_SAFE_INTEGER {
            return Err(E::custom("review number exceeds the safe numeric range"));
        }
        Ok(UniqueJson(Value::Number(value.into())))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
        if value > MAX_SAFE_INTEGER {
            return Err(E::custom("review number exceeds the safe numeric range"));
        }
        Ok(UniqueJson(Value::Number(value.into())))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
        if !value.is_finite() || value.abs() > MAX_SAFE_INTEGER as f64 {
            return Err(E::custom(
                "review number is non-finite or outside the safe range",
            ));
        }
        Number::from_f64(value)
            .map(|number| UniqueJson(Value::Number(number)))
            .ok_or_else(|| E::custom("invalid review number"))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
        if self.0 >= MAX_JSON_DEPTH {
            return Err(de::Error::custom(
                "review JSON nesting exceeds the depth budget",
            ));
        }
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element_seed(UniqueJsonSeed(self.0 + 1))? {
            values.push(value.0);
        }
        Ok(UniqueJson(Value::Array(values)))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut object: A) -> Result<Self::Value, A::Error> {
        if self.0 >= MAX_JSON_DEPTH {
            return Err(de::Error::custom(
                "review JSON nesting exceeds the depth budget",
            ));
        }
        let mut values = Map::new();
        while let Some(key) = object.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(de::Error::custom("duplicate review JSON property"));
            }
            values.insert(key, object.next_value_seed(UniqueJsonSeed(self.0 + 1))?.0);
        }
        Ok(UniqueJson(Value::Object(values)))
    }
}

fn invalid_evidence(reason: impl Into<String>) -> FractalError {
    FractalError::InvalidReviewEvidence {
        reason: reason.into(),
    }
}

/// Canonicalize strict JSON using RFC 8785 and the review numeric/size profile.
///
/// # Errors
/// Rejects duplicate decoded keys, invalid Unicode, out-of-range numbers, excessive
/// nesting, trailing data, and input or canonical output beyond the payload budget.
pub fn canonical_review_json(input: &[u8]) -> FractalResult<Vec<u8>> {
    if input.len() > MAX_REVIEW_JSON_BYTES {
        return Err(invalid_evidence(
            "review JSON input exceeds the payload budget",
        ));
    }
    let value: UniqueJson =
        serde_json::from_slice(input).map_err(|error| invalid_evidence(error.to_string()))?;
    let output = serde_json_canonicalizer::to_vec(&value.0)
        .map_err(|error| invalid_evidence(error.to_string()))?;
    if output.len() > MAX_REVIEW_JSON_BYTES {
        return Err(invalid_evidence(
            "canonical review JSON exceeds the payload budget",
        ));
    }
    Ok(output)
}

/// Compute the SM3 digest of the complete canonical payload, including all identities.
///
/// # Errors
/// Returns the validation errors documented by [`canonical_review_json`].
pub fn canonical_review_sm3(input: &[u8]) -> FractalResult<[u8; 32]> {
    Ok(sm3_hash(&canonical_review_json(input)?))
}

/// Compute an HMAC-SM3 over canonical bytes using an explicitly supplied authority key.
///
/// # Errors
/// Returns the validation errors documented by [`canonical_review_json`].
pub fn sign_canonical_review(input: &[u8], secret: &AuthoritySecret) -> FractalResult<[u8; 32]> {
    Ok(secret.sign_payload_sm3(&canonical_review_json(input)?))
}

/// Verify payload integrity in constant time. Issuer trust and policy are separate checks.
///
/// # Errors
/// Returns the validation errors documented by [`canonical_review_json`].
pub fn verify_canonical_review(
    input: &[u8],
    signature: &[u8],
    secret: &AuthoritySecret,
) -> FractalResult<bool> {
    let expected = sign_canonical_review(input, secret)?;
    Ok(ct_eq_bytes(&expected, signature))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_canonical_vectors_match_bytes_digests_and_signatures(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let vectors: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/quality/canonical-vectors.json"
        ))?;
        let key = vectors["testKeyHex"].as_str().ok_or("missing test key")?;
        let secret = AuthoritySecret::from_hex(key)?;
        for vector in vectors["valid"].as_array().ok_or("missing valid vectors")? {
            let input = vector["input"].as_str().ok_or("missing input")?.as_bytes();
            let canonical = vector["canonical"]
                .as_str()
                .ok_or("missing canonical bytes")?
                .as_bytes();
            assert_eq!(
                canonical_review_json(input)?,
                canonical,
                "{}",
                vector["name"]
            );
            assert_eq!(hex(&canonical_review_sm3(input)?), vector["sm3"]);
            let signature = sign_canonical_review(input, &secret)?;
            assert_eq!(hex(&signature), vector["hmacSm3"]);
            assert!(verify_canonical_review(input, &signature, &secret)?);
            let mut tampered = signature;
            tampered[0] ^= 1;
            assert!(!verify_canonical_review(input, &tampered, &secret)?);
            assert!(!verify_canonical_review(input, &signature[..31], &secret)?);
        }
        Ok(())
    }

    #[test]
    fn shared_invalid_vectors_are_rejected() -> Result<(), Box<dyn std::error::Error>> {
        let vectors: Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/quality/canonical-vectors.json"
        ))?;
        for vector in vectors["invalid"]
            .as_array()
            .ok_or("missing invalid vectors")?
        {
            let input = vector["input"].as_str().ok_or("missing input")?.as_bytes();
            assert!(canonical_review_json(input).is_err(), "{}", vector["name"]);
        }
        assert!(canonical_review_json(&[b'"', 0xff, b'"']).is_err());
        assert!(canonical_review_json(&vec![b' '; MAX_REVIEW_JSON_BYTES + 1]).is_err());
        Ok(())
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
