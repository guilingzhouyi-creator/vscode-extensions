//! Module: fg-core — Git Signature Model
//! File Path: crates/fg-core/src/models/signature.rs
//! Architecture Role: Encapsulates standard Git author/committer identity lines.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitSignature {
    pub name: String,
    pub email: String,
    pub timestamp_sec: i64,
    pub tz_offset: String,
}

impl GitSignature {
    pub fn new(name: impl Into<String>, email: impl Into<String>, timestamp_sec: i64) -> Self {
        Self {
            name: name.into(),
            email: email.into(),
            timestamp_sec,
            tz_offset: "+0000".to_string(),
        }
    }

    pub fn for_agent(agent_uid: &str, cell_id: &str, timestamp_sec: i64) -> Self {
        Self {
            name: format!("{}:{}", cell_id, agent_uid),
            email: format!("{}@{}.praxis.local", agent_uid, cell_id),
            timestamp_sec,
            tz_offset: "+0000".to_string(),
        }
    }

    pub fn to_git_line(&self) -> String {
        format!(
            "{} <{}> {} {}",
            self.name, self.email, self.timestamp_sec, self.tz_offset
        )
    }
}
