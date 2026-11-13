//! Module: taxis_cmd::daemon_scheduler — Audit Ref Routing, Report Queries & CLI Parsers
//! File Path: src/bin/taxis_cmd/daemon_scheduler/ref_queries.rs
//! Architecture Role: Maps workspace/cell/card references to dedicated Fractal Audit Tree peers,
//!   reads latest audit artifacts from ODB, resolves authority secrets, and parses archetypes.
//! Dependencies & Triggers: Used across `daemon`, `audit_cmd`, `promotion`, and `scheduler`.
//! Responsibilities: Guarantee non-reentrant audit-ref classification and offline ODB queries.
//! Exit Semantics & Design Rationale: Zero filesystem writes when reading audit reports.

use std::path::Path;

use fg_algorithms::scoring::ProjectArchetype;
use fg_core::error::FractalResult;
use fg_core::models::AuthoritySecret;
use fg_gate::authority::resolve_authority_secret;
use fg_topology::audit_tree::AuditTreeMaterializer;
use fg_topology::refs::FractalRef;
use fractal_git::constants::refs::REF_AUDIT_PREFIX;
use fractal_git::server::IpcMessage;
use fractal_git::LooseOdb;

const TELEMETRY_REF_PREFIX: &str = "refs/fractal/telemetry/";

/// Checks whether a reference update targets `refs/fractal/audit/*` or `refs/fractal/telemetry/*`.
#[must_use]
pub fn is_self_owned_audit_or_telemetry_ref(ref_name: &str) -> bool {
    ref_name.starts_with(REF_AUDIT_PREFIX) || ref_name.starts_with(TELEMETRY_REF_PREFIX)
}

/// Maps any workspace or agent branch ref to its dedicated worktree-free [`FractalRef`] audit peer.
#[must_use]
pub fn resolve_audit_target_ref(source_ref: Option<&str>) -> FractalRef {
    let Some(raw) = source_ref else {
        return FractalRef::AuditTrunk;
    };
    if raw.starts_with(REF_AUDIT_PREFIX) {
        if let Some(parsed) = FractalRef::parse(raw) {
            return parsed;
        }
    }
    if let Some(parsed) = FractalRef::parse(raw) {
        if let Some(counterpart) = parsed.audit_counterpart() {
            return counterpart;
        }
    }
    FractalRef::AuditTrunk
}

/// Reads the latest sealed report artifacts directly from `refs/fractal/audit/...` in ODB.
///
/// # Errors
///
/// Propagates ref validation or ODB object decoding failures.
pub fn query_latest_audit_report(
    git_dir: &Path,
    source_ref: Option<&str>,
) -> FractalResult<IpcMessage> {
    let odb = LooseOdb::new(git_dir);
    let audit_ref = resolve_audit_target_ref(source_ref);
    let ref_name = audit_ref.to_git_ref();
    let commit_oid = audit_ref.read_oid(git_dir)?;
    let Some(head_oid) = commit_oid else {
        return Ok(IpcMessage::AuditReportResponse {
            found: false,
            audit_ref: Some(ref_name),
            commit_oid: None,
            evidence_json: None,
            receipt_json: None,
            aas_json: None,
        });
    };
    let evidence_json = read_utf8_artifact(&odb, git_dir, &audit_ref, "evidence/analysis.json")?;
    let receipt_json = read_utf8_artifact(&odb, git_dir, &audit_ref, "receipt/trusted.json")?;
    let aas_json = read_utf8_artifact(&odb, git_dir, &audit_ref, "reports/aas-v1.json")?;
    Ok(IpcMessage::AuditReportResponse {
        found: evidence_json.is_some() || aas_json.is_some(),
        audit_ref: Some(ref_name),
        commit_oid: Some(head_oid.to_hex()),
        evidence_json,
        receipt_json,
        aas_json,
    })
}

fn read_utf8_artifact(
    odb: &LooseOdb,
    git_dir: &Path,
    audit_ref: &FractalRef,
    rel_path: &str,
) -> FractalResult<Option<String>> {
    let maybe_bytes =
        AuditTreeMaterializer::read_audit_artifact(odb, git_dir, audit_ref, rel_path)?;
    Ok(maybe_bytes.and_then(|bytes| String::from_utf8(bytes).ok()))
}

pub(crate) fn resolve_or_ephemeral_secret(git_dir: &Path) -> FractalResult<AuthoritySecret> {
    if let Ok(secret) = resolve_authority_secret(git_dir) {
        return Ok(secret);
    }
    let seed = format!(
        "taxis-ephemeral-daemon:{}:{}",
        git_dir.display(),
        std::process::id()
    );
    let key_bytes = fg_core::crypto::sm3_hash(seed.as_bytes());
    AuthoritySecret::from_bytes(&key_bytes)
}

/// Parses `--archetype <name>` CLI flag into a unified [`ProjectArchetype`].
#[must_use]
pub fn parse_archetype_flag(args: &[String]) -> ProjectArchetype {
    let raw = args
        .windows(2)
        .find(|pair| pair[0] == "--archetype")
        .map(|pair| pair[1].as_str())
        .or_else(|| args.iter().find_map(|arg| arg.strip_prefix("--archetype=")));
    match raw {
        Some("systems" | "systems-runtime" | "fractal-git") => ProjectArchetype::SystemsRuntime,
        Some("game" | "webgames") => ProjectArchetype::Game,
        Some("library" | "lib") => ProjectArchetype::Library,
        Some("stdlib") => ProjectArchetype::Stdlib,
        Some("web") => ProjectArchetype::Web,
        _ => ProjectArchetype::DefaultBalanced,
    }
}
