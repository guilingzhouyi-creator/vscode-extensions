//! Module: fg-transport — Local Agent High-Speed IPC
//! File Path: crates/fg-transport/src/ipc.rs
//! Architecture Role: Length-prefixed binary frame codec for local autonomous agent loop IPC,
//!   enabling zero-network-overhead coordination between Praxis and Fractal Git engine.
//! Dependencies & Triggers: Consumed by Praxis coordination bridges and local agent daemons.
//! Responsibilities: Encode and decode structured IPC command frames over streaming buffers.
//! Exit Semantics & Design Rationale: Framing uses 4-byte big-endian length prefix; fails closed on malformed frames.
//!
//! Domain Governance Rules: FGT-TRN-001 (transport protocol), FGT-COR-001.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{ElevationAttestation, StagedPromotionRequest};
use serde::{Deserialize, Serialize};

use crate::{validate_ipc_frame_bounds, IPC_FRAME_HEADER_LEN};

/// File entry descriptor carried inside an IPC `Stage` or `Commit` command frame.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IpcStageEntry {
    /// Repository-relative slash-normalized file path.
    pub path: String,
    /// Canonical Git file mode string (`"100644"`, `"100755"`, `"120000"`, `"160000"`).
    pub mode: String,
    /// Optional UTF-8 payload (or submodule commit OID when mode is `"160000"`).
    #[serde(default)]
    pub content: Option<String>,
    /// Optional pre-computed 40-character hexadecimal object identifier.
    #[serde(default)]
    pub oid: Option<String>,
}

/// Structured execution receipt and latency telemetry emitted by the Taxis IPC daemon.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IpcDaemonReceipt {
    /// Executed IPC command label (`"ping"`, `"status"`, `"stage"`, `"commit"`, `"diff_slice"`).
    pub command: String,
    /// Whether the daemon completed the command without error.
    pub ok: bool,
    /// Execution latency measured in microseconds.
    pub latency_us: u64,
    /// Monotonic generation of the hot in-memory `RepoDocument` and `InMemoryIndexTree` snapshot.
    pub cache_generation: u64,
    /// Whether the request was served from the warm in-memory repository cache.
    pub cache_hit: bool,
    /// Resulting root Git tree OID (40-character hex) when applicable.
    #[serde(default)]
    pub tree_oid: Option<String>,
    /// Resulting Git commit OID (40-character hex) when applicable.
    #[serde(default)]
    pub commit_oid: Option<String>,
    /// Target Git reference inspected or advanced by the command.
    #[serde(default)]
    pub target_ref: Option<String>,
    /// Number of staged or diffed entries reported by the operation.
    pub entry_count: usize,
    /// Staged path entries or status lines produced by the command.
    #[serde(default)]
    pub entries: Vec<String>,
    /// Unified diff patch text or human-readable diagnostic summary.
    #[serde(default)]
    pub detail: String,
}

/// High-speed local IPC command envelope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "payload")]
pub enum IpcMessage {
    Ping {
        timestamp_ms: i64,
    },
    Pong {
        timestamp_ms: i64,
    },
    RequestRefOid {
        git_ref: String,
    },
    ResponseRefOid {
        git_ref: String,
        oid: Option<String>,
    },
    TriggerReclamation {
        workspace_id: String,
        git_ref: String,
    },
    ReclamationDone {
        workspace_id: String,
        success: bool,
    },
    RequestSystemPromotion {
        request: StagedPromotionRequest,
    },
    QueryActivePromotion,
    ResponseActivePromotion {
        active: Option<StagedPromotionRequest>,
    },
    SubmitElevationApproval {
        request_id: String,
        proof: ElevationAttestation,
    },
    SubmitElevationRejection {
        request_id: String,
        reason: String,
    },
    PromotionResult {
        request_id: String,
        success: bool,
        message: String,
    },
    Status {
        #[serde(default)]
        scope_prefix: Option<String>,
    },
    Stage {
        entries: Vec<IpcStageEntry>,
    },
    Commit {
        target_ref: String,
        #[serde(default)]
        parent_oids: Vec<String>,
        #[serde(default)]
        entries: Vec<IpcStageEntry>,
        message: String,
        author_name: String,
        author_email: String,
        #[serde(default)]
        timestamp_sec: Option<i64>,
        #[serde(default)]
        tz_offset: Option<String>,
    },
    DiffSlice {
        #[serde(default)]
        scope_prefix: Option<String>,
        #[serde(default)]
        base_oid: Option<String>,
        #[serde(default)]
        head_oid: Option<String>,
    },
    DaemonReceipt {
        receipt: IpcDaemonReceipt,
    },
    /// Authenticates a persistent local loopback TCP or UDS session using the runtime nonce token.
    HelloAuth {
        token: String,
    },
    /// Triggers asynchronous pure-Rust audit execution inside the persistent daemon scheduler.
    ScheduleAudit {
        #[serde(default)]
        target_ref: Option<String>,
        #[serde(default)]
        force: bool,
    },
    /// Queries runtime status of the daemon's built-in async audit scheduler.
    QueryAuditStatus,
    /// Reports built-in async audit scheduler status and latest sealed metrics.
    AuditStatus {
        active: bool,
        paused: bool,
        queued_jobs: usize,
        #[serde(default)]
        last_review_id: Option<String>,
        #[serde(default)]
        last_tree_oid: Option<String>,
        #[serde(default)]
        last_audit_commit_oid: Option<String>,
        #[serde(default)]
        last_composite_score: Option<f64>,
        #[serde(default)]
        last_decision: Option<String>,
        writes_audit_logs_dir: bool,
    },
    /// Requests the latest materialized evidence, receipt, and AAS JSON from `refs/fractal/audit/...`.
    QueryAuditReport {
        #[serde(default)]
        target_ref: Option<String>,
    },
    /// Carries materialized `AnalysisEvidence`, `TrustedReviewReceipt`, and AAS summary JSON strings.
    AuditReportResponse {
        found: bool,
        #[serde(default)]
        audit_ref: Option<String>,
        #[serde(default)]
        commit_oid: Option<String>,
        #[serde(default)]
        evidence_json: Option<String>,
        #[serde(default)]
        receipt_json: Option<String>,
        #[serde(default)]
        aas_json: Option<String>,
    },
}

/// Length-prefixed binary frame encoder/decoder.
pub struct IpcCodec;

impl IpcCodec {
    /// Encodes an IPC message into a 4-byte length-prefixed JSON byte stream.
    ///
    /// # Errors
    ///
    /// Propagates JSON serialization errors and rejects frames exceeding
    /// [`crate::MAX_IPC_FRAME_PAYLOAD_BYTES`].
    pub fn encode(msg: &IpcMessage) -> FractalResult<Vec<u8>> {
        let json_bytes = serde_json::to_vec(msg)?;
        let validated_len = validate_ipc_frame_bounds(json_bytes.len())?;
        let len_u32 = u32::try_from(validated_len).map_err(|_| {
            FractalError::ObjectCodec("IPC frame length overflowed u32 header".to_owned())
        })?;
        let len_header = len_u32.to_be_bytes();
        let mut frame = Vec::with_capacity(IPC_FRAME_HEADER_LEN + validated_len);
        frame.extend_from_slice(&len_header);
        frame.extend_from_slice(&json_bytes);
        Ok(frame)
    }

    /// Decodes a length-prefixed frame from raw bytes.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] if the declared length violates frame bounds, or
    /// [`FractalError::Json`] if the payload is malformed JSON.
    pub fn decode(bytes: &[u8]) -> FractalResult<Option<(IpcMessage, usize)>> {
        if bytes.len() < IPC_FRAME_HEADER_LEN {
            return Ok(None);
        }

        let mut len_bytes = [0u8; IPC_FRAME_HEADER_LEN];
        len_bytes.copy_from_slice(&bytes[..IPC_FRAME_HEADER_LEN]);
        let payload_len = u32::from_be_bytes(len_bytes) as usize;
        let validated_len = validate_ipc_frame_bounds(payload_len)?;

        if bytes.len() < IPC_FRAME_HEADER_LEN + validated_len {
            return Ok(None);
        }

        let msg: IpcMessage = serde_json::from_slice(
            &bytes[IPC_FRAME_HEADER_LEN..IPC_FRAME_HEADER_LEN + validated_len],
        )?;
        Ok(Some((msg, IPC_FRAME_HEADER_LEN + validated_len)))
    }

    /// Decodes all complete length-prefixed frames present in `stream`, returning the messages
    /// and total consumed byte count.
    ///
    /// # Errors
    ///
    /// Propagates frame bound or JSON deserialization errors on any malformed frame.
    pub fn decode_stream(stream: &[u8]) -> FractalResult<(Vec<IpcMessage>, usize)> {
        let mut decoded_frames = Vec::with_capacity(4);
        let mut cursor = 0usize;
        while cursor < stream.len() {
            let Some((message, consumed)) = Self::decode(&stream[cursor..])? else {
                break;
            };
            decoded_frames.push(message);
            cursor += consumed;
        }
        Ok((decoded_frames, cursor))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_audit_and_auth_frames_round_trip() {
        let frames = [
            IpcMessage::HelloAuth {
                token: String::from("0123abcd"),
            },
            IpcMessage::ScheduleAudit {
                target_ref: Some(String::from("refs/heads/main")),
                force: true,
            },
            IpcMessage::QueryAuditStatus,
            IpcMessage::AuditStatus {
                active: true,
                paused: false,
                queued_jobs: 1,
                last_review_id: Some(String::from("rev-001")),
                last_tree_oid: Some(String::from("1111111111111111111111111111111111111111")),
                last_audit_commit_oid: Some(String::from(
                    "2222222222222222222222222222222222222222",
                )),
                last_composite_score: Some(98.45),
                last_decision: Some(String::from("approved")),
                writes_audit_logs_dir: false,
            },
            IpcMessage::QueryAuditReport {
                target_ref: Some(String::from("refs/fractal/audit/trunk")),
            },
            IpcMessage::AuditReportResponse {
                found: true,
                audit_ref: Some(String::from("refs/fractal/audit/trunk")),
                commit_oid: Some(String::from("3333333333333333333333333333333333333333")),
                evidence_json: Some(String::from("{}")),
                receipt_json: Some(String::from("{}")),
                aas_json: Some(String::from("{}")),
            },
        ];

        for msg in &frames {
            let encoded = IpcCodec::encode(msg).expect("encode audit frame");
            let (decoded, consumed) = IpcCodec::decode(&encoded)
                .expect("decode audit frame")
                .expect("complete frame");
            assert_eq!(consumed, encoded.len());
            assert_eq!(&decoded, msg);
        }
    }
}
