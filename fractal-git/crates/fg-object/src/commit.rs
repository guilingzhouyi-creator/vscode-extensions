//! Module: fg-object — Canonical Git Commit Codec
//! File Path: crates/fg-object/src/commit.rs
//! Architecture Role: Encapsulates pure Git commit object primitives with Dual-Faced
//!   payload serialization (Human-readable conventional sections + Machine-readable PraxisCardContext).

use fg_core::models::{AgentCommitMeta, GitSignature, Oid};
use sha1::{Digest, Sha1};

/// Pure Git Commit representation.
#[derive(Debug, Clone, PartialEq)]
pub struct GitCommit {
    tree_oid: String,
    parent_oids: Vec<String>,
    author: GitSignature,
    committer: GitSignature,
    message: String,
    agent_meta: Option<AgentCommitMeta>,
    oid: String,
    raw_oid: Oid,
}

impl GitCommit {
    /// Constructs and computes OID for a new GitCommit.
    pub fn new(
        tree_oid: impl Into<String>,
        parent_oids: Vec<String>,
        author: GitSignature,
        committer: GitSignature,
        message: impl Into<String>,
        agent_meta: Option<AgentCommitMeta>,
    ) -> Self {
        let tree_oid = tree_oid.into();
        let message = message.into();
        let payload = Self::serialize_commit_payload(
            &tree_oid,
            &parent_oids,
            &author,
            &committer,
            &message,
            &agent_meta,
        );
        let raw_oid = Self::compute_commit_oid(&payload);
        let oid = raw_oid.to_hex();

        Self {
            tree_oid,
            parent_oids,
            author,
            committer,
            message,
            agent_meta,
            oid,
            raw_oid,
        }
    }

    /// Access the 40-character SHA-1 identifier of this commit.
    pub fn oid(&self) -> &str {
        &self.oid
    }

    /// Access the typed 20-byte Oid.
    pub fn raw_oid(&self) -> &Oid {
        &self.raw_oid
    }

    /// Access tree OID hex string.
    pub fn tree_oid(&self) -> &str {
        &self.tree_oid
    }

    /// Access parent commit OID hex strings.
    pub fn parent_oids(&self) -> &[String] {
        &self.parent_oids
    }

    /// Access author signature.
    pub fn author(&self) -> &GitSignature {
        &self.author
    }

    /// Access committer signature.
    pub fn committer(&self) -> &GitSignature {
        &self.committer
    }

    /// Access commit message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Access structured agent metadata if available.
    pub fn agent_meta(&self) -> Option<&AgentCommitMeta> {
        self.agent_meta.as_ref()
    }

    /// Returns the raw Git loose object format: `commit <size>\0<content>`
    pub fn to_raw_object(&self) -> Vec<u8> {
        let payload = Self::serialize_commit_payload(
            &self.tree_oid,
            &self.parent_oids,
            &self.author,
            &self.committer,
            &self.message,
            &self.agent_meta,
        );
        let header = format!("commit {}\0", payload.len());
        let mut raw = Vec::with_capacity(header.len() + payload.len());
        raw.extend_from_slice(header.as_bytes());
        raw.extend_from_slice(&payload);
        raw
    }

    fn serialize_commit_payload(
        tree_oid: &str,
        parent_oids: &[String],
        author: &GitSignature,
        committer: &GitSignature,
        message: &str,
        agent_meta: &Option<AgentCommitMeta>,
    ) -> Vec<u8> {
        let mut lines = Vec::new();
        lines.push(format!("tree {}", tree_oid));
        for parent in parent_oids {
            lines.push(format!("parent {}", parent));
        }
        lines.push(format!("author {}", author.to_git_line()));
        lines.push(format!("committer {}", committer.to_git_line()));
        lines.push("".to_string());

        // Body: Human message + embedded Dual-Faced machine JSON trailer
        let mut body = message.to_string();
        if let Some(meta) = agent_meta {
            if let Ok(json_str) = serde_json::to_string(meta) {
                body.push_str("\n\nPraxis-Agent-Meta: ");
                body.push_str(&json_str);
            }
        }
        lines.push(body);

        let content = lines.join("\n");
        let mut bytes = content.into_bytes();
        bytes.push(b'\n');
        bytes
    }

    fn compute_commit_oid(payload: &[u8]) -> Oid {
        let mut hasher = Sha1::new();
        hasher.update(format!("commit {}\0", payload.len()).as_bytes());
        hasher.update(payload);
        let hash: [u8; 20] = hasher.finalize().into();
        Oid::from_bytes(hash)
    }
}
