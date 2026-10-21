//! Module: fg-core — Git Signature Model
//! File Path: crates/fg-core/src/models/signature.rs
//! Architecture Role: Encapsulates standard Git author/committer identity lines.

use serde::{Deserialize, Serialize};

/// Canonical Git identity signature representing author or committer metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitSignature {
    pub name: String,
    pub email: String,
    pub timestamp_sec: i64,
    pub tz_offset: String,
}

impl GitSignature {
    /// Constructs a standard Git signature with designated name, email, and UTC epoch timestamp.
    pub fn new(name: impl Into<String>, email: impl Into<String>, timestamp_sec: i64) -> Self {
        Self {
            name: name.into(),
            email: email.into(),
            timestamp_sec,
            tz_offset: "+0000".to_string(),
        }
    }

    /// Constructs an autonomous agent signature scoped to its containing cell.
    pub fn for_agent(agent_uid: &str, cell_id: &str, timestamp_sec: i64) -> Self {
        Self {
            name: format!("{}:{}", cell_id, agent_uid),
            email: format!("{}@{}.praxis.local", agent_uid, cell_id),
            timestamp_sec,
            tz_offset: "+0000".to_string(),
        }
    }

    /// Serializes the signature into standard Git identity line format: `name <email> time tz`.
    pub fn to_git_line(&self) -> String {
        format!(
            "{} <{}> {} {}",
            self.name, self.email, self.timestamp_sec, self.tz_offset
        )
    }
}
