//! Module: fg-native — PROM Section Codec
//! File Path: crates/fg-native/src/sections/prom.rs
//! Architecture Role: Encodes the staged promotion ledger — the active candidate and its archived
//!   history — as a record stream carrying the score envelope, lifecycle status, and lease window.
//! Dependencies & Triggers: Written by `taxis promotion request`; read by the GUI UAC bridge and
//!   `taxis promotion list`.
//! Responsibilities: Round-trip every promotion field with bit-exact scores and a closed status
//!   discriminant set.
//! Exit Semantics & Design Rationale:
//!   - Scores are stored as IEEE-754 bit patterns. A decimal rendering would lose the exact value,
//!     and the ratchet compares deltas against a fixed baseline — a value that shifts in the last
//!     digit can flip a comparison.
//!   - Non-finite scores are rejected on both encode and decode. `NaN` survives a bit round trip
//!     and would make every ratchet comparison silently false.
//!   - Status is a closed discriminant set with its payload fields written unconditionally. Writing
//!     only the fields a variant needs would make the record width depend on the variant, so a
//!     single misread status byte would desynchronize the whole stream.
//!   - The challenge nonce is stored verbatim; deriving it on read would let a replayed ledger
//!     produce a nonce the human operator never saw.

use fg_core::models::Oid;

use crate::codec::{FieldReader, FieldWriter};
use crate::constants::MAX_RECORD_COUNT;
use crate::error::{NativeError, NativeResult};

/// Tag reported in diagnostics for this section.
const SECTION_TAG: &str = "PROM";

/// Byte width of the challenge nonce.
pub const CHALLENGE_NONCE_LEN: usize = 32;

/// Lifecycle state of a staged promotion request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromotionStatus {
    /// Awaiting a human click inside the GUI elevation prompt.
    Pending = 0,
    /// Approved and merged into the system trunk.
    Approved = 1,
    /// Rejected by the human operator with feedback.
    Rejected = 2,
    /// Replaced by a higher-scoring candidate that met the ratchet baseline.
    Superseded = 3,
    /// Lease elapsed before any human action.
    Expired = 4,
}

impl PromotionStatus {
    /// Every status this build understands, in ascending on-disk order.
    pub const ALL: [Self; 5] = [
        Self::Pending,
        Self::Approved,
        Self::Rejected,
        Self::Superseded,
        Self::Expired,
    ];

    /// Returns the on-disk discriminant.
    pub const fn to_u8(self) -> u8 {
        self as u8
    }

    /// Decodes the on-disk discriminant.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::UnknownPromotionStatus`] for any value outside the closed set.
    pub const fn from_u8(value: u8) -> NativeResult<Self> {
        match value {
            0 => Ok(Self::Pending),
            1 => Ok(Self::Approved),
            2 => Ok(Self::Rejected),
            3 => Ok(Self::Superseded),
            4 => Ok(Self::Expired),
            other => Err(NativeError::UnknownPromotionStatus { status: other }),
        }
    }

    /// Reports whether this status still holds the lease.
    pub const fn is_open(self) -> bool {
        matches!(self, Self::Pending)
    }
}

/// One promotion record.
#[derive(Debug, Clone, PartialEq)]
pub struct PromotionRecord {
    /// Request identifier, unique within a repository.
    pub request_id: String,
    /// Candidate commit the promotion would advance the trunk to.
    pub candidate_oid: Oid,
    /// Reference the candidate came from.
    pub source_ref: String,
    /// Reference the promotion would advance.
    pub target_ref: String,
    /// Composite quality score.
    pub composite_score: f64,
    /// Objective autonomy index.
    pub cai_index: f64,
    /// Lower bound of the credible interval.
    pub credible_interval_lower: f64,
    /// Whether the anti-gaming guard passed.
    pub anti_gaming_passed: bool,
    /// Lifecycle state.
    pub status: PromotionStatus,
    /// Creation timestamp in milliseconds since the Unix epoch.
    pub created_at_ms: i64,
    /// Lease expiry timestamp in milliseconds since the Unix epoch.
    pub expires_at_ms: i64,
    /// Non-forgeable challenge nonce the human approval must sign.
    pub challenge_nonce: [u8; CHALLENGE_NONCE_LEN],
    /// Agent that requested the promotion.
    pub agent_uid: String,
    /// Human-facing summary.
    pub summary: String,
}

impl PromotionRecord {
    /// Serializes one record body (without the leading request-id length).
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::NonFiniteScore`] when any score is `NaN` or infinite, and propagates
    /// string-encoding failures.
    fn encode_body(&self) -> NativeResult<Vec<u8>> {
        if !self.composite_score.is_finite()
            || !self.cai_index.is_finite()
            || !self.credible_interval_lower.is_finite()
        {
            return Err(NativeError::NonFiniteScore);
        }

        let mut writer = FieldWriter::with_capacity(160);
        writer.write_oid(&self.candidate_oid);
        writer.write_string("source_ref", &self.source_ref)?;
        writer.write_string("target_ref", &self.target_ref)?;
        writer.write_f64_bits(self.composite_score);
        writer.write_f64_bits(self.cai_index);
        writer.write_f64_bits(self.credible_interval_lower);
        writer.write_u8(u8::from(self.anti_gaming_passed));
        writer.write_u8(self.status.to_u8());
        writer.write_i64(self.created_at_ms);
        writer.write_i64(self.expires_at_ms);
        writer.write_bytes(&self.challenge_nonce);
        writer.write_string("agent_uid", &self.agent_uid)?;
        writer.write_string("summary", &self.summary)?;
        Ok(writer.finish())
    }
}

/// Ordered promotion ledger: the active candidate plus archived history.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PromSection {
    active: Option<PromotionRecord>,
    history: Vec<PromotionRecord>,
}

impl PromSection {
    /// Creates an empty ledger.
    pub const fn new() -> Self {
        Self {
            active: None,
            history: Vec::new(),
        }
    }

    /// Returns the active candidate, if one holds the lease.
    pub fn active(&self) -> Option<&PromotionRecord> {
        self.active.as_ref()
    }

    /// Returns the archived records in insertion order.
    pub fn history(&self) -> &[PromotionRecord] {
        &self.history
    }

    /// Returns the number of archived records.
    pub fn history_len(&self) -> usize {
        self.history.len()
    }

    /// Sets the active candidate.
    pub fn set_active(&mut self, record: PromotionRecord) {
        self.active = Some(record);
    }

    /// Clears the active candidate without archiving it.
    pub fn clear_active(&mut self) {
        self.active = None;
    }

    /// Appends a record directly to history.
    ///
    /// Used when a candidate is resolved in the same step it was created, so it never occupies the
    /// active slot.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::CountExceeded`] when the history is at the record ceiling.
    pub fn record_history(&mut self, record: PromotionRecord) -> NativeResult<()> {
        if self.history.len() >= MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "promotion_history",
                declared: self.history.len() + 1,
                ceiling: MAX_RECORD_COUNT,
            });
        }
        self.history.push(record);
        Ok(())
    }

    /// Moves the active candidate into history.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::CountExceeded`] when the history is at the record ceiling.
    pub fn archive_active(&mut self) -> NativeResult<()> {
        if let Some(record) = self.active.take() {
            if self.history.len() >= MAX_RECORD_COUNT {
                self.active = Some(record);
                return Err(NativeError::CountExceeded {
                    field: "promotion_history",
                    declared: self.history.len() + 1,
                    ceiling: MAX_RECORD_COUNT,
                });
            }
            self.history.push(record);
        }
        Ok(())
    }

    /// Finds a record by request id across the active slot and history.
    pub fn find(&self, request_id: &str) -> Option<&PromotionRecord> {
        if let Some(record) = self.active.as_ref() {
            if record.request_id == request_id {
                return Some(record);
            }
        }
        self.history
            .iter()
            .find(|record| record.request_id == request_id)
    }

    /// Serializes the section payload.
    ///
    /// Layout: presence byte, then the active record when present, then a `u32` history count and
    /// one record per archived entry.
    ///
    /// # Errors
    ///
    /// Propagates score and string-encoding failures plus [`NativeError::CountExceeded`].
    pub fn encode(&self) -> NativeResult<Vec<u8>> {
        if self.history.len() > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "promotion_history",
                declared: self.history.len(),
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut writer = FieldWriter::with_capacity(64 + self.history.len() * 200);
        match self.active.as_ref() {
            Some(record) => {
                writer.write_u8(1);
                write_record(&mut writer, record)?;
            }
            None => writer.write_u8(0),
        }

        writer.write_u32(self.history.len() as u32);
        for record in &self.history {
            write_record(&mut writer, record)?;
        }
        Ok(writer.finish())
    }

    /// Parses the section payload.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::UnknownDiscriminant`] for a bad presence byte,
    /// [`NativeError::CountExceeded`] for an implausible history count,
    /// [`NativeError::UnknownPromotionStatus`] for an unknown status,
    /// [`NativeError::NonFiniteScore`] for a non-finite score, and field-level errors for a
    /// truncated payload.
    pub fn decode(payload: &[u8]) -> NativeResult<Self> {
        let mut reader = FieldReader::new(payload);
        let active = match reader.read_u8("active_present")? {
            0 => None,
            1 => Some(read_record(&mut reader)?),
            other => {
                return Err(NativeError::UnknownDiscriminant {
                    field: "active_present",
                    value: other,
                })
            }
        };

        let declared = reader.read_u32("history_count")? as usize;
        if declared > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "promotion_history",
                declared,
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut history = Vec::with_capacity(declared.min(256));
        for _ in 0..declared {
            history.push(read_record(&mut reader)?);
        }

        reader.expect_exhausted(SECTION_TAG)?;
        Ok(Self { active, history })
    }
}

/// Writes one record: `u16`-prefixed request id, then the fixed body.
///
/// # Errors
///
/// Propagates request-id encoding failures and score validation.
fn write_record(writer: &mut FieldWriter, record: &PromotionRecord) -> NativeResult<()> {
    writer.write_string("request_id", &record.request_id)?;
    writer.write_bytes(&record.encode_body()?);
    Ok(())
}

/// Reads one record.
///
/// # Errors
///
/// Propagates field-level failures, unknown status, and non-finite scores.
fn read_record(reader: &mut FieldReader<'_>) -> NativeResult<PromotionRecord> {
    let request_id = reader.read_string("request_id")?;
    let candidate_oid = reader.read_oid("candidate_oid")?;
    let source_ref = reader.read_string("source_ref")?;
    let target_ref = reader.read_string("target_ref")?;
    let composite_score = reader.read_f64_bits("composite_score")?;
    let cai_index = reader.read_f64_bits("cai_index")?;
    let credible_interval_lower = reader.read_f64_bits("credible_interval_lower")?;

    if !composite_score.is_finite()
        || !cai_index.is_finite()
        || !credible_interval_lower.is_finite()
    {
        return Err(NativeError::NonFiniteScore);
    }

    let anti_gaming_passed = match reader.read_u8("anti_gaming_passed")? {
        0 => false,
        1 => true,
        other => {
            return Err(NativeError::UnknownDiscriminant {
                field: "anti_gaming_passed",
                value: other,
            })
        }
    };
    let status = PromotionStatus::from_u8(reader.read_u8("promotion_status")?)?;
    let created_at_ms = reader.read_i64("created_at_ms")?;
    let expires_at_ms = reader.read_i64("expires_at_ms")?;

    let nonce_slice = reader.take("challenge_nonce", CHALLENGE_NONCE_LEN)?;
    let mut challenge_nonce = [0u8; CHALLENGE_NONCE_LEN];
    challenge_nonce.copy_from_slice(nonce_slice);

    let agent_uid = reader.read_string("agent_uid")?;
    let summary = reader.read_string("summary")?;

    Ok(PromotionRecord {
        request_id,
        candidate_oid,
        source_ref,
        target_ref,
        composite_score,
        cai_index,
        credible_interval_lower,
        anti_gaming_passed,
        status,
        created_at_ms,
        expires_at_ms,
        challenge_nonce,
        agent_uid,
        summary,
    })
}

#[cfg(test)]
mod tests {
    use fg_core::models::Oid;

    use super::{PromSection, PromotionRecord, PromotionStatus, CHALLENGE_NONCE_LEN};
    use crate::error::NativeError;

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        Oid::from_bytes(raw)
    }

    fn record(request_id: &str, status: PromotionStatus) -> PromotionRecord {
        let mut nonce = [0u8; CHALLENGE_NONCE_LEN];
        nonce[0] = 0xAB;
        nonce[31] = 0xCD;
        PromotionRecord {
            request_id: request_id.to_owned(),
            candidate_oid: oid_from(1),
            source_ref: "refs/fractal/trunk".to_owned(),
            target_ref: "refs/heads/main".to_owned(),
            composite_score: 95.01,
            cai_index: 90.31,
            credible_interval_lower: 86.75,
            anti_gaming_passed: true,
            status,
            created_at_ms: 1_700_000_000_000,
            expires_at_ms: 1_700_003_600_000,
            challenge_nonce: nonce,
            agent_uid: "taxis-auditor".to_owned(),
            summary: "clean topology, zero-alloc boundary".to_owned(),
        }
    }

    #[test]
    fn status_byte_round_trips_for_every_variant() {
        for status in PromotionStatus::ALL {
            assert_eq!(
                PromotionStatus::from_u8(status.to_u8()).expect("decode"),
                status
            );
        }
    }

    #[test]
    fn rejects_unknown_status() {
        assert!(matches!(
            PromotionStatus::from_u8(9).expect_err("unknown must fail"),
            NativeError::UnknownPromotionStatus { status: 9 }
        ));
    }

    #[test]
    fn only_pending_holds_the_lease() {
        for status in PromotionStatus::ALL {
            assert_eq!(status.is_open(), status == PromotionStatus::Pending);
        }
    }

    #[test]
    fn round_trip_preserves_scores_bit_exactly() {
        let mut ledger = PromSection::new();
        let mut sample = record("promo-1", PromotionStatus::Pending);
        sample.composite_score = 1.0 / 3.0;
        sample.cai_index = -0.0;
        sample.credible_interval_lower = f64::MIN_POSITIVE;
        ledger.set_active(sample.clone());

        let decoded = PromSection::decode(&ledger.encode().expect("encode")).expect("decode");
        let found = decoded.active().expect("active");
        assert_eq!(
            found.composite_score.to_bits(),
            sample.composite_score.to_bits()
        );
        assert_eq!(found.cai_index.to_bits(), sample.cai_index.to_bits());
        assert_eq!(
            found.credible_interval_lower.to_bits(),
            sample.credible_interval_lower.to_bits()
        );
    }

    #[test]
    fn rejects_non_finite_score_on_encode() {
        let mut ledger = PromSection::new();
        let mut sample = record("promo-nan", PromotionStatus::Pending);
        sample.composite_score = f64::NAN;
        ledger.set_active(sample);
        assert!(matches!(
            ledger.encode().expect_err("NaN must fail"),
            NativeError::NonFiniteScore
        ));
    }

    #[test]
    fn rejects_non_finite_score_on_decode() {
        let mut ledger = PromSection::new();
        ledger.set_active(record("promo-2", PromotionStatus::Pending));
        let mut payload = ledger.encode().expect("encode");

        // Locate the composite score: after the presence byte, the request-id prefix and body,
        // the candidate id, and the two refs. Rewrite it to a quiet NaN bit pattern and confirm
        // the decoder refuses it rather than accepting a value no comparison can order.
        let nan_offset = find_first_nan_slot(&payload);
        payload[nan_offset..nan_offset + 8].copy_from_slice(&f64::NAN.to_bits().to_le_bytes());

        assert!(matches!(
            PromSection::decode(&payload).expect_err("NaN must fail"),
            NativeError::NonFiniteScore
        ));
    }

    /// Finds the byte offset of the composite score within an encoded single-record ledger.
    fn find_first_nan_slot(payload: &[u8]) -> usize {
        // presence (1) + request-id length (2) + "promo-2" (7) + candidate oid (20)
        // + source_ref (2 + 19) + target_ref (2 + 15) = the score starts here.
        let mut offset = 1 + 2 + "promo-2".len() + 20;
        let source_len = u16::from_le_bytes([payload[offset], payload[offset + 1]]) as usize;
        offset += 2 + source_len;
        let target_len = u16::from_le_bytes([payload[offset], payload[offset + 1]]) as usize;
        offset += 2 + target_len;
        offset
    }

    #[test]
    fn round_trip_preserves_active_and_history() {
        let mut ledger = PromSection::new();
        ledger.set_active(record("promo-active", PromotionStatus::Pending));
        ledger
            .record_history(record("promo-old", PromotionStatus::Rejected))
            .expect("record history");

        let decoded = PromSection::decode(&ledger.encode().expect("encode")).expect("decode");
        assert_eq!(decoded, ledger);
        assert_eq!(decoded.history_len(), 1);
        assert_eq!(
            decoded.active().map(|r| r.request_id.as_str()),
            Some("promo-active")
        );
    }

    #[test]
    fn archive_moves_active_into_history() {
        let mut ledger = PromSection::new();
        ledger.set_active(record("promo-3", PromotionStatus::Pending));
        ledger.archive_active().expect("archive");
        assert!(ledger.active().is_none());
        assert_eq!(ledger.history_len(), 1);
    }

    #[test]
    fn find_searches_active_and_history() {
        let mut ledger = PromSection::new();
        ledger.set_active(record("promo-active", PromotionStatus::Pending));
        ledger
            .record_history(record("promo-old", PromotionStatus::Rejected))
            .expect("record history");

        assert!(ledger.find("promo-active").is_some());
        assert!(ledger.find("promo-old").is_some());
        assert!(ledger.find("promo-missing").is_none());
    }

    #[test]
    fn empty_ledger_round_trips() {
        let empty = PromSection::new();
        let encoded = empty.encode().expect("encode");
        // presence byte + zero history count
        assert_eq!(encoded, vec![0u8, 0, 0, 0, 0]);
        let decoded = PromSection::decode(&encoded).expect("decode");
        assert!(decoded.active().is_none());
        assert_eq!(decoded.history_len(), 0);
    }

    #[test]
    fn rejects_bad_presence_byte() {
        let payload = [7u8, 0, 0, 0, 0];
        assert!(matches!(
            PromSection::decode(&payload).expect_err("bad presence must fail"),
            NativeError::UnknownDiscriminant { .. }
        ));
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut ledger = PromSection::new();
        ledger.set_active(record("promo-4", PromotionStatus::Pending));
        let mut payload = ledger.encode().expect("encode");
        payload.push(0x00);
        assert!(matches!(
            PromSection::decode(&payload).expect_err("trailing byte must fail"),
            NativeError::TruncatedRecord { tag: "PROM", .. }
        ));
    }
}
