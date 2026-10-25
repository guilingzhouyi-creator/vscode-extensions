//! Module: fg-gate — Authority Secret Resolution Facade
//! File Path: crates/fg-gate/src/authority.rs
//! Architecture Role: Resolves the HMAC authority secret from the environment or
//!   repository config so pre-receive and hook gates can verify human credentials.
//! Dependencies & Triggers: Consumed by taxis commit/authority/verify commands and
//!   by the UAC promotion gate.
//! Responsibilities: Environment/config precedence and fail-closed secret construction.
//! Exit Semantics & Design Rationale: A missing or malformed secret is a typed
//!   rejection, never a silently disabled check.
//!
//! Domain Governance Rules: FGT-GAT-001 (gate enforcement), FGT-COR-001, GUARD-VAR-001.

use std::path::Path;

use fg_core::error::FractalResult;

pub use fg_core::models::authority::{
    current_unix_seconds, AuthorityClaims, AuthoritySecret, AUTHORITY_REMEDIATION,
    AUTHORITY_SECRET_ENV,
};

use crate::git_hook::read_core_authority_secret;

/// Resolves the authority secret for a repository's git directory.
///
/// Precedence: `TAXIS_AUTHORITY_SECRET` environment variable, then
/// `core.authoritysecret` from `<git-dir>/config`. Absence is a hard error.
pub fn resolve_authority_secret(git_dir: &Path) -> FractalResult<AuthoritySecret> {
    let env_value = std::env::var(AUTHORITY_SECRET_ENV).ok();
    let config_value = read_core_authority_secret(&git_dir.join("config"));
    AuthoritySecret::from_env_or_config(env_value.as_deref(), config_value.as_deref())
}
