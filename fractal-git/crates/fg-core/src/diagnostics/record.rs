//! Module: fg-core::diagnostics::record — Structured Diagnostic Record
//! File Path: crates/fg-core/src/diagnostics/record.rs
//! Architecture Role: Declares the structured diagnostic record schema for passive commercial logging.
//! Dependencies & Triggers: Consumed by fg-core::diagnostics and rotating sinks.
//! Responsibilities: Serde serialization for OpenTelemetry and JSONL compliance.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::sync::OnceLock;

/// Standardized commercial diagnostic record serialized as JSON Lines (JSONL).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiagnosticRecord {
    /// RFC 3339 / ISO 8601 UTC timestamp with microsecond precision.
    pub timestamp: String,
    /// Canonical log level in uppercase ("TRACE", "DEBUG", "INFO", "WARN", "ERROR").
    pub level: String,
    /// Originating subsystem / target path.
    pub target: String,
    /// Optional semantic event identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    /// Unique correlation trace identifier.
    pub trace_id: String,
    /// Operating system process identifier.
    pub pid: u32,
    /// Product edition.
    pub edition: &'static str,
    /// Active CLI subcommand if registered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subcommand: Option<String>,
    /// Sanitized human message.
    pub message: String,
    /// Extracted governance rule ID if present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
    /// Optional structured attribute payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attributes: Option<serde_json::Value>,
}

static TRACE_ID: OnceLock<String> = OnceLock::new();

/// Returns the stable correlation trace ID for this process.
pub fn trace_id() -> &'static str {
    TRACE_ID.get_or_init(|| {
        std::env::var("TAXIS_TRACE_ID").unwrap_or_else(|_| {
            let pid = std::process::id();
            let now = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
            format!("tx-{pid}-{now:x}")
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_id_starts_with_prefix_and_contains_pid() {
        let tid = trace_id();
        assert!(tid.starts_with("tx-"), "trace ID must start with tx-: {tid}");
        let pid = std::process::id();
        assert!(
            tid.contains(&pid.to_string()),
            "trace ID must contain process ID: {tid}"
        );
    }

    #[test]
    fn diagnostic_record_serializes_to_standard_jsonl() {
        let record = DiagnosticRecord {
            timestamp: "2026-11-05T00:15:30.123456Z".to_string(),
            level: "WARN".to_string(),
            target: "fg_gate::commit_guard".to_string(),
            event: Some("policy_rejection".to_string()),
            trace_id: "tx-test-123".to_string(),
            pid: 1234,
            edition: "engineering",
            subcommand: Some("commit".to_string()),
            message: "Header length must be at least 15 characters".to_string(),
            rule_id: Some("FGT-MSG-001".to_string()),
            attributes: Some(serde_json::json!({ "exit_code": 1 })),
        };

        let serialized = serde_json::to_string(&record).expect("must serialize");
        assert!(serialized.contains("\"timestamp\":\"2026-11-05T00:15:30.123456Z\""));
        assert!(serialized.contains("\"level\":\"WARN\""));
        assert!(serialized.contains("\"rule_id\":\"FGT-MSG-001\""));
        assert!(serialized.contains("\"event\":\"policy_rejection\""));
        assert!(serialized.contains("\"exit_code\":1"));
    }
}
