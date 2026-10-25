//! Module: fg-object — Canonical Git Commit Codec
//! File Path: crates/fg-object/src/commit.rs
//! Architecture Role: Encapsulates pure Git commit object primitives with Dual-Faced
//!   payload serialization (Human-readable conventional sections +
//!   Machine-readable PraxisCardContext).
//! Dependencies & Triggers: Consumed by the commit materializer, the walker, and every command
//!   that resolves history.
//! Responsibilities: Serialize a commit payload in Git's exact byte layout and expose its fields.
//! Exit Semantics & Design Rationale:
//!   - Parent and tree ids are held as typed [`Oid`] values rather than hex strings. Storing the
//!     hex text alongside the typed value gives two sources for one fact, and they can disagree.
//!   - `oid()` returns the typed value object; `oid_hex()` is the display projection. There is no
//!     third `raw_oid` spelling.
//!
//! Domain Governance Rules: FGT-OBJ-001 (commit object codec), FGT-COR-001, FGT-PRF-001.

use fg_core::models::{
    compute_object_oid, raw_object, AgentCommitMeta, GitSignature, ObjectKind, Oid,
};

/// Pure Git Commit representation.
#[derive(Debug, Clone, PartialEq)]
pub struct GitCommit {
    tree_oid: Oid,
    parent_oids: Vec<Oid>,
    author: GitSignature,
    committer: GitSignature,
    message: String,
    agent_meta: Option<AgentCommitMeta>,
    oid: Oid,
}

impl GitCommit {
    /// Constructs and computes the object id for a new commit.
    pub fn new(
        tree_oid: Oid,
        parent_oids: Vec<Oid>,
        author: GitSignature,
        committer: GitSignature,
        message: impl Into<String>,
        agent_meta: Option<AgentCommitMeta>,
    ) -> Self {
        let message = message.into();
        let payload = Self::serialize_commit_payload(
            &tree_oid,
            &parent_oids,
            &author,
            &committer,
            &message,
            &agent_meta,
        );
        let oid = Self::compute_commit_oid(&payload);

        Self {
            tree_oid,
            parent_oids,
            author,
            committer,
            message,
            agent_meta,
            oid,
        }
    }

    /// Constructs a commit strictly from a proven [`fg_core::models::ValidatedCommitWitness`].
    pub fn from_witness(
        tree_oid: Oid,
        parent_oids: Vec<Oid>,
        author: GitSignature,
        committer: GitSignature,
        witness: &fg_core::models::ValidatedCommitWitness,
        agent_meta: Option<AgentCommitMeta>,
    ) -> Self {
        Self::new(
            tree_oid,
            parent_oids,
            author,
            committer,
            witness.raw_message.clone(),
            agent_meta,
        )
    }

    /// Returns the typed 20-byte object id of this commit.
    pub const fn oid(&self) -> &Oid {
        &self.oid
    }

    /// Returns the 40-character lowercase hexadecimal object id of this commit.
    pub fn oid_hex(&self) -> String {
        self.oid.to_hex()
    }

    /// Returns the root tree object id.
    pub const fn tree_oid(&self) -> &Oid {
        &self.tree_oid
    }

    /// Returns the parent commit object ids in order.
    pub fn parent_oids(&self) -> &[Oid] {
        &self.parent_oids
    }

    /// Returns the author signature.
    pub const fn author(&self) -> &GitSignature {
        &self.author
    }

    /// Returns the committer signature.
    pub const fn committer(&self) -> &GitSignature {
        &self.committer
    }

    /// Returns the commit message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Returns structured agent metadata when present.
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
        raw_object(ObjectKind::Commit, &payload)
    }

    /// Renders the commit payload in Git's canonical header order.
    ///
    /// The header order (`tree`, then each `parent`, then `author`, then `committer`, then a blank
    /// line) is part of the object identity: reordering headers changes the object id even though
    /// the parsed fields are identical. The message is copied verbatim after the blank line, because
    /// Git hashes exactly the bytes it read: appending a newline would change the object id for every
    /// message that does not already end in one.
    fn serialize_commit_payload(
        tree_oid: &Oid,
        parent_oids: &[Oid],
        author: &GitSignature,
        committer: &GitSignature,
        message: &str,
        agent_meta: &Option<AgentCommitMeta>,
    ) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(256 + message.len());
        use std::io::Write;
        let _ = writeln!(bytes, "tree {}", tree_oid.to_hex());
        for parent in parent_oids {
            let _ = writeln!(bytes, "parent {}", parent.to_hex());
        }
        let _ = writeln!(bytes, "author {}", author.to_git_line());
        let _ = writeln!(bytes, "committer {}", committer.to_git_line());
        bytes.push(b'\n');

        bytes.extend_from_slice(message.as_bytes());
        if let Some(meta) = agent_meta {
            if let Ok(json_str) = serde_json::to_string(meta) {
                bytes.extend_from_slice(b"\n\nPraxis-Agent-Meta: ");
                bytes.extend_from_slice(json_str.as_bytes());
            }
        }
        bytes
    }

    fn compute_commit_oid(payload: &[u8]) -> Oid {
        compute_object_oid(ObjectKind::Commit, payload)
    }
}
