//! Module: fg-core — Human Authority Credential Cryptography
//! File Path: crates/fg-core/src/models/authority.rs
//! Architecture Role: Cryptographically verifiable human authority tokens
//!   (HMAC-SHA1, three-segment claims) closing the "any non-empty string is a
//!   credential" hole in the dual-trunk boundary.
//! Dependencies & Triggers: Consumed by fg-gate pre-receive/hook guards and the
//!   Taxis CLI commit/authority paths.
//! Responsibilities: Secret parsing (hex/raw), token issuance, token verification
//!   with constant-time MAC comparison, and fail-closed secret resolution.
//! Exit Semantics & Design Rationale: Every failure is a typed error carrying the
//!   already registered `[AUTHORITY_BREACH]` CLI tag; a missing secret is never
//!   treated as "no verification required".

use std::time::{SystemTime, UNIX_EPOCH};

use sha1::{Digest, Sha1};

use super::hex::{decode_fixed_hex, encode_hex, HexDecodeError};
use crate::error::{FractalError, FractalResult};

/// Environment variable carrying the authority secret.
pub const AUTHORITY_SECRET_ENV: &str = "TAXIS_AUTHORITY_SECRET";

/// Operator remediation sentence embedded in every authority rejection.
pub const AUTHORITY_REMEDIATION: &str = "set TAXIS_AUTHORITY_SECRET (64 hex chars or at least 32 raw bytes) or configure core.authoritysecret, then issue a token with taxis authority issue --subject <name>";

/// Minimum accepted secret length in bytes.
const MIN_SECRET_BYTES: usize = 32;

/// Canonical token prefix.
const TOKEN_PREFIX: &str = "taxis1";

/// Internal build-fail tag reused from the registered CLI tag set.
const BREACH_TAG: &str = "[AUTHORITY_BREACH]";

/// A 32-byte HMAC key used to issue and verify human authority tokens.
///
/// The `Debug` implementation is redacted so a secret can never leak through a
/// `{:?}` diagnostic or a panic message.
#[derive(Clone, PartialEq, Eq)]
pub struct AuthoritySecret([u8; MIN_SECRET_BYTES]);

impl std::fmt::Debug for AuthoritySecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AuthoritySecret(<redacted>)")
    }
}

/// Verified claims extracted from a human authority token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorityClaims {
    /// Signed principal name; must equal the claimed human username.
    pub subject: String,
    /// Unix seconds at which the token was issued.
    pub issued_at: i64,
    /// Unix seconds after which the token is rejected.
    pub expires_at: i64,
}

impl AuthoritySecret {
    /// Builds a secret from raw key bytes, requiring at least 32 bytes.
    ///
    /// Longer inputs are truncated to the first 32 bytes, which keeps the HMAC
    /// block plan size fixed and makes secret length unobservable from signatures.
    pub fn from_bytes(raw: &[u8]) -> FractalResult<Self> {
        if raw.len() < MIN_SECRET_BYTES {
            return Err(FractalError::PolicyViolation(format!(
                "{BREACH_TAG} authority secret must be at least {MIN_SECRET_BYTES} bytes, got {}; {AUTHORITY_REMEDIATION}",
                raw.len()
            )));
        }
        let mut key = [0u8; MIN_SECRET_BYTES];
        key.copy_from_slice(&raw[..MIN_SECRET_BYTES]);
        Ok(Self(key))
    }

    /// Builds a secret from exactly 64 lowercase or uppercase hex characters.
    pub fn from_hex(hex: &str) -> FractalResult<Self> {
        let trimmed = hex.trim();
        let key = decode_fixed_hex::<MIN_SECRET_BYTES>(trimmed).map_err(|decode_err| {
            let observed = match decode_err {
                HexDecodeError::Length { actual, .. } => actual,
                HexDecodeError::NonHex => trimmed.len(),
            };
            FractalError::PolicyViolation(format!(
                "{BREACH_TAG} authority secret hex must be exactly {} hexadecimal characters, got {observed}; {AUTHORITY_REMEDIATION}",
                MIN_SECRET_BYTES * 2
            ))
        })?;
        Ok(Self(key))
    }

    /// Resolves the secret from an environment value and a config value.
    ///
    /// Precedence is environment first, then configuration. A missing secret is a
    /// hard failure (fail-closed): callers may never interpret absence as
    /// "verification disabled".
    pub fn from_env_or_config(env: Option<&str>, config: Option<&str>) -> FractalResult<Self> {
        let candidate = [env, config]
            .into_iter()
            .flatten()
            .map(str::trim)
            .find(|value| !value.is_empty())
            .ok_or_else(|| {
                FractalError::PolicyViolation(format!(
                    "{BREACH_TAG} no authority secret configured; {AUTHORITY_REMEDIATION}"
                ))
            })?;
        if candidate.len() == MIN_SECRET_BYTES * 2
            && candidate.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Self::from_hex(candidate);
        }
        Self::from_bytes(candidate.as_bytes())
    }

    /// Issues a signed token for `subject` valid for `ttl_secs` seconds.
    pub fn issue(&self, subject: &str, ttl_secs: u64, now_secs: i64) -> FractalResult<String> {
        validate_subject(subject)?;
        let issued_at = now_secs;
        let expires_at = now_secs.saturating_add(i64::try_from(ttl_secs).unwrap_or(i64::MAX));
        let mac = self.sign(subject, issued_at, expires_at);
        Ok(format!(
            "{TOKEN_PREFIX}.{subject}.{issued_at}.{expires_at}.{}",
            encode_hex(&mac)
        ))
    }

    /// Verifies a token signature, expiry, and issue-time plausibility.
    ///
    /// The MAC comparison is constant time: every byte is folded into an
    /// accumulator and the result is compared against zero once, so timing does
    /// not reveal how many leading bytes matched.
    pub fn verify(&self, token: &str, now_secs: i64) -> FractalResult<AuthorityClaims> {
        let claims = parse_token(token)?;
        if claims.expires_at <= now_secs {
            return Err(FractalError::AuthProofInvalid(format!(
                "{BREACH_TAG} authority token expired at {}, current time {}; {AUTHORITY_REMEDIATION}",
                claims.expires_at, now_secs
            )));
        }
        if claims.issued_at > now_secs.saturating_add(300) {
            return Err(FractalError::AuthProofInvalid(format!(
                "{BREACH_TAG} authority token was issued too far in the future ({} > {}); {AUTHORITY_REMEDIATION}",
                claims.issued_at, now_secs
            )));
        }
        let expected = self.sign(&claims.subject, claims.issued_at, claims.expires_at);
        let presented = parse_hex_mac(token)?;
        if !ct_eq_bytes(&expected, &presented) {
            return Err(FractalError::AuthProofInvalid(format!(
                "{BREACH_TAG} authority token MAC mismatch; {AUTHORITY_REMEDIATION}"
            )));
        }
        Ok(claims)
    }

    fn sign(&self, subject: &str, issued_at: i64, expires_at: i64) -> [u8; 20] {
        let canonical = format!("{TOKEN_PREFIX}|{subject}|{issued_at}|{expires_at}");
        hmac_sha1(&self.0, canonical.as_bytes())
    }

    /// Signs an arbitrary binary payload with HMAC-SHA1 using this secret.
    #[must_use]
    pub fn sign_payload(&self, payload: &[u8]) -> [u8; 20] {
        hmac_sha1(&self.0, payload)
    }
}

/// Returns the current Unix time in seconds, clamped at zero.
pub fn current_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// RFC 2104 HMAC-SHA1 over the given key and message.
pub fn hmac_sha1(key: &[u8], message: &[u8]) -> [u8; 20] {
    const BLOCK: usize = 64;
    let mut normalized = [0u8; BLOCK];
    if key.len() > BLOCK {
        let digest = Sha1::digest(key);
        normalized[..digest.len()].copy_from_slice(&digest);
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha1::new();
    let mut outer = Sha1::new();
    let mut inner_pad = [0x36u8; BLOCK];
    let mut outer_pad = [0x5cu8; BLOCK];
    for index in 0..BLOCK {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();
    outer.update(outer_pad);
    outer.update(inner_digest);
    let outer_digest = outer.finalize();
    let mut mac = [0u8; 20];
    mac.copy_from_slice(&outer_digest);
    mac
}

fn validate_subject(subject: &str) -> FractalResult<()> {
    let valid_length = !subject.is_empty() && subject.len() <= 64;
    let valid_chars = subject
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'@' | b'-'));
    if !valid_length || !valid_chars {
        return Err(FractalError::PolicyViolation(format!(
            "{BREACH_TAG} authority subject must be 1..=64 characters of [A-Za-z0-9._@-], got '{subject}'; {AUTHORITY_REMEDIATION}"
        )));
    }
    Ok(())
}

/// Parses the token grammar from the right so subjects containing dots stay valid.
fn parse_token(token: &str) -> FractalResult<AuthorityClaims> {
    let mut fields = token.rsplitn(4, '.');
    let mac = fields.next().unwrap_or_default();
    let expires = fields.next().unwrap_or_default();
    let issued = fields.next().unwrap_or_default();
    let prefix_and_subject = fields.next().unwrap_or_default();
    if mac.len() != 40 || !mac.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(invalid_token("MAC segment must be 40 hex characters"));
    }
    let subject = prefix_and_subject
        .strip_prefix(TOKEN_PREFIX)
        .and_then(|rest| rest.strip_prefix('.'))
        .ok_or_else(|| invalid_token("token must start with 'taxis1.'"))?;
    validate_subject(subject)?;
    let issued_at = issued
        .parse::<i64>()
        .map_err(|_| invalid_token("issued timestamp must be Unix seconds"))?;
    let expires_at = expires
        .parse::<i64>()
        .map_err(|_| invalid_token("expires timestamp must be Unix seconds"))?;
    if expires_at < issued_at {
        return Err(invalid_token("expires timestamp precedes issued timestamp"));
    }
    Ok(AuthorityClaims {
        subject: subject.to_string(),
        issued_at,
        expires_at,
    })
}

fn parse_hex_mac(token: &str) -> FractalResult<[u8; 20]> {
    let mac = token.rsplit('.').next().unwrap_or_default();
    decode_fixed_hex::<20>(mac).map_err(|decode_err| match decode_err {
        HexDecodeError::Length { .. } => invalid_token("MAC segment must decode to 20 bytes"),
        HexDecodeError::NonHex => invalid_token("MAC segment must be hexadecimal"),
    })
}

/// Constant-time equality over equal-length byte slices, mitigating timing side-channels on MACs
/// and challenge nonces.
#[must_use]
pub fn ct_eq_bytes(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        difference |= a ^ b;
    }
    difference == 0
}

fn invalid_token(reason: &str) -> FractalError {
    FractalError::AuthProofInvalid(format!(
        "{BREACH_TAG} malformed authority token: {reason}; {AUTHORITY_REMEDIATION}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_secret() -> AuthoritySecret {
        AuthoritySecret::from_bytes(&[7u8; 32]).expect("fixture secret")
    }

    #[test]
    fn rfc2202_hmac_sha1_case_1() {
        let key = [0x0bu8; 20];
        let mac = hmac_sha1(&key, b"Hi There");
        assert_eq!(encode_hex(&mac), "b617318655057264e28bc0b6fb378c8ef146be00");
    }

    #[test]
    fn round_trip_token_verifies() {
        let secret = fixture_secret();
        let token = secret.issue("Lead-Architect", 3600, 1000).expect("issue");
        let claims = secret.verify(&token, 1200).expect("verify");
        assert_eq!(claims.subject, "Lead-Architect");
        assert_eq!(claims.issued_at, 1000);
        assert_eq!(claims.expires_at, 4600);
    }

    #[test]
    fn token_with_dotted_subject_round_trips() {
        let secret = fixture_secret();
        let token = secret
            .issue("lead.architect@corp", 60, 1000)
            .expect("issue");
        let claims = secret.verify(&token, 1000).expect("verify");
        assert_eq!(claims.subject, "lead.architect@corp");
    }

    #[test]
    fn tampered_mac_is_rejected() {
        let secret = fixture_secret();
        let token = secret.issue("Guiling", 3600, 1000).expect("issue");
        let mut tampered = token.clone();
        let last = tampered.pop().expect("mac");
        tampered.push(if last == '0' { '1' } else { '0' });
        let error = secret.verify(&tampered, 1000).expect_err("must reject");
        assert!(format!("{error}").contains("MAC mismatch"));
    }

    #[test]
    fn expired_token_is_rejected() {
        let secret = fixture_secret();
        let token = secret.issue("Guiling", 0, 1000).expect("issue");
        let error = secret.verify(&token, 1000).expect_err("must reject");
        assert!(format!("{error}").contains("expired"));
    }

    #[test]
    fn future_issued_token_is_rejected() {
        let secret = fixture_secret();
        let token = secret.issue("Guiling", 3600, 5000).expect("issue");
        let error = secret.verify(&token, 1000).expect_err("must reject");
        assert!(format!("{error}").contains("future"));
    }

    #[test]
    fn missing_secret_fails_closed() {
        let error = AuthoritySecret::from_env_or_config(None, None).expect_err("must reject");
        let message = format!("{error}");
        assert!(message.contains("no authority secret configured"));
        assert!(message.contains("taxis authority issue"));
    }

    #[test]
    fn env_hex_secret_is_decoded_and_takes_precedence() {
        let hex = "ab".repeat(32);
        let secret = AuthoritySecret::from_env_or_config(Some(&hex), Some("ignored")).expect("hex");
        assert_eq!(secret.0, [0xabu8; 32]);
    }

    #[test]
    fn invalid_subject_is_rejected() {
        let secret = fixture_secret();
        let error = secret
            .issue("bad subject", 60, 1000)
            .expect_err("must reject");
        assert!(format!("{error}").contains("authority subject"));
    }

    #[test]
    fn secret_debug_is_redacted() {
        let secret = fixture_secret();
        assert_eq!(format!("{secret:?}"), "AuthoritySecret(<redacted>)");
    }
}
