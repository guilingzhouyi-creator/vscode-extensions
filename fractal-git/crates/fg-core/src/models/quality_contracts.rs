//! Module: fg-core — Generated Quality DTOs
//! File Path: crates/fg-core/src/models/quality_contracts.rs
//! Architecture Role: Typed wire documents derived from quality-evidence.schema.json.
//! Dependencies & Triggers: Serde and sync-quality-evidence.js.
//! Responsibilities: Preserve closed wire shapes without claiming semantic validity.
//! Exit Semantics & Design Rationale: Regenerate; do not edit. Validation is a separate boundary.

/// Protocol major version; structural validation accepts exactly v1.
pub type SchemaVersion = u32;

/// Bounded portable identity string; it conveys no authorization.
pub type Identifier = String;

/// Repository path claim; the snapshot reader separately checks confinement.
pub type RepoPath = String;

/// Wire discriminator restricted by the schema to "sm3".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum DigestAlgorithm {
    #[serde(rename = "sm3")]
    Sm3,
}

/// Explicit SM3 digest namespace and complete lowercase content identity.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Digest {
    pub algorithm: DigestAlgorithm,
    pub value: String,
}

/// Wire discriminator restricted by the schema to "git-sha1".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum GitObjectAlgorithm {
    #[serde(rename = "git-sha1")]
    GitSha1,
}

/// Complete Git SHA-1 object identity, distinct from evidence digest identities.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitObject {
    pub algorithm: GitObjectAlgorithm,
    pub value: String,
}

/// Repository, candidate tree and manifest claims bound to one review.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnapshotIdentity {
    #[serde(rename = "repositoryId")]
    pub repository_id: Identifier,
    pub tree: GitObject,
    #[serde(rename = "manifestDigest")]
    pub manifest_digest: Digest,
}

/// Wire discriminator restricted by the schema to "initial".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BaselineInitialStrategy {
    #[serde(rename = "initial")]
    Initial,
}

/// initial baseline with 0..=0 distinct parent identities.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaselineInitial {
    pub strategy: BaselineInitialStrategy,
    pub parents: Vec<GitObject>,
}

/// Wire discriminator restricted by the schema to "parent".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BaselineParentStrategy {
    #[serde(rename = "parent")]
    Parent,
}

/// parent baseline with 1..=1 distinct parent identities.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaselineParent {
    pub strategy: BaselineParentStrategy,
    pub parents: Vec<GitObject>,
}

/// Wire discriminator restricted by the schema to "explicit".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BaselineExplicitStrategy {
    #[serde(rename = "explicit")]
    Explicit,
}

/// explicit baseline with 1..=1 distinct parent identities.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaselineExplicit {
    pub strategy: BaselineExplicitStrategy,
    pub parents: Vec<GitObject>,
}

/// Wire discriminator restricted by the schema to "merge".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BaselineMergeStrategy {
    #[serde(rename = "merge")]
    Merge,
}

/// merge baseline with 2..=64 distinct parent identities.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaselineMerge {
    pub strategy: BaselineMergeStrategy,
    pub parents: Vec<GitObject>,
}

/// Explicit comparison strategy with schema-bounded distinct parent identities.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum Baseline {
    Initial(BaselineInitial),
    Parent(BaselineParent),
    Explicit(BaselineExplicit),
    Merge(BaselineMerge),
}

/// Full operation, snapshot, baseline and policy/configuration binding claims.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewBinding {
    #[serde(rename = "reviewId")]
    pub review_id: Identifier,
    #[serde(rename = "operationId")]
    pub operation_id: Identifier,
    pub snapshot: SnapshotIdentity,
    pub baseline: Baseline,
    #[serde(rename = "policyDigest")]
    pub policy_digest: Digest,
    #[serde(rename = "configurationDigest")]
    pub configuration_digest: Digest,
    #[serde(rename = "requiredCapabilitiesDigest")]
    pub required_capabilities_digest: Digest,
}

/// Portable failure details without exception objects or implicit success.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewFailure {
    pub code: Identifier,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
}

/// Wire discriminator restricted by the schema to "analysis", "trajectory-comparison", "test-execution", "mutation-execution", "holdout-validation".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ProvenanceSource {
    #[serde(rename = "analysis")]
    Analysis,
    #[serde(rename = "trajectory-comparison")]
    TrajectoryComparison,
    #[serde(rename = "test-execution")]
    TestExecution,
    #[serde(rename = "mutation-execution")]
    MutationExecution,
    #[serde(rename = "holdout-validation")]
    HoldoutValidation,
}

/// Declared observation source and sample identities; execution still needs verification.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Provenance {
    pub source: ProvenanceSource,
    #[serde(rename = "sampleIds")]
    pub sample_ids: Vec<Identifier>,
}

/// Wire discriminator restricted by the schema to "unmeasured".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum UnmeasuredStatus {
    #[serde(rename = "unmeasured")]
    Unmeasured,
}

/// Absence of measurement with an explicit reason, never a numeric fallback.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Unmeasured {
    pub status: UnmeasuredStatus,
    pub reason: String,
}

/// Wire discriminator restricted by the schema to "not-applicable".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NotApplicableStatus {
    #[serde(rename = "not-applicable")]
    NotApplicable,
}

/// Declared non-applicability; policy permission requires separate verification.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotApplicable {
    pub status: NotApplicableStatus,
    pub reason: String,
}

/// Wire discriminator restricted by the schema to "failed".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum FailedMeasurementStatus {
    #[serde(rename = "failed")]
    Failed,
}

/// A failed observation retaining structured failure details.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FailedMeasurement {
    pub status: FailedMeasurementStatus,
    pub error: ReviewFailure,
}

/// Wire discriminator restricted by the schema to "measured".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum MeasuredNumberStatus {
    #[serde(rename = "measured")]
    Measured,
}

/// Finite measured value with provenance; zero remains an actual measurement.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeasuredNumber {
    pub status: MeasuredNumberStatus,
    pub value: f64,
    pub provenance: Provenance,
}

/// Actual trial count claims; semantic checks must verify identities and denominators.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrialCounts {
    pub passed: u64,
    pub total: u64,
}

/// Wire discriminator restricted by the schema to "measured".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum MeasuredTrialsStatus {
    #[serde(rename = "measured")]
    Measured,
}

/// Trial counts with provenance, distinct from static test-text inspection.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeasuredTrials {
    pub status: MeasuredTrialsStatus,
    pub value: TrialCounts,
    pub provenance: Provenance,
}

/// Lossless union of numeric observation and explicit absence/failure states.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum NumberMeasurement {
    MeasuredNumber(MeasuredNumber),
    Unmeasured(Unmeasured),
    NotApplicable(NotApplicable),
    FailedMeasurement(FailedMeasurement),
}

/// Lossless union of counted trials and explicit absence/failure states.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum TrialMeasurement {
    MeasuredTrials(MeasuredTrials),
    Unmeasured(Unmeasured),
    NotApplicable(NotApplicable),
    FailedMeasurement(FailedMeasurement),
}

/// Independent quality, testing, mutation and generalization observations.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Measurements {
    #[serde(rename = "qualityDelta")]
    pub quality_delta: NumberMeasurement,
    pub generalization: NumberMeasurement,
    pub tests: TrialMeasurement,
    pub mutations: TrialMeasurement,
    #[serde(rename = "performanceMs")]
    pub performance_ms: NumberMeasurement,
}

/// Execution track state; a pending or failed track cannot prove completion.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum TrackStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "complete")]
    Complete,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "not-required")]
    NotRequired,
}

/// Wire discriminator restricted by the schema to "supported", "executed", "not-applicable", "unsupported", "failed", "degraded".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum CapabilityCoverageStatus {
    #[serde(rename = "supported")]
    Supported,
    #[serde(rename = "executed")]
    Executed,
    #[serde(rename = "not-applicable")]
    NotApplicable,
    #[serde(rename = "unsupported")]
    Unsupported,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "degraded")]
    Degraded,
}

/// One declared analyzer/language capability outcome with policy context.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapabilityCoverage {
    pub analyzer: Identifier,
    pub capability: Identifier,
    pub language: Identifier,
    pub required: bool,
    pub status: CapabilityCoverageStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(rename = "policyAllowsNotApplicable")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy_allows_not_applicable: Option<bool>,
}

/// Wire discriminator restricted by the schema to "queued", "running", "partial", "complete", "failed", "cancelled", "superseded".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ExecutionStatus {
    #[serde(rename = "queued")]
    Queued,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "partial")]
    Partial,
    #[serde(rename = "complete")]
    Complete,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "superseded")]
    Superseded,
}

/// Separate fast and deep execution states; routing is not execution.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionTracks {
    pub fast: TrackStatus,
    pub deep: TrackStatus,
}

/// Declared execution, required capability coverage and failure observations.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Execution {
    #[serde(rename = "schemaVersion")]
    pub schema_version: SchemaVersion,
    #[serde(rename = "reviewId")]
    pub review_id: Identifier,
    pub status: ExecutionStatus,
    pub coverage: Vec<CapabilityCoverage>,
    pub tracks: ExecutionTracks,
    pub failures: Vec<ReviewFailure>,
}

/// Engine revision and configuration identity used for an evidence claim.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EngineVersion {
    pub id: Identifier,
    pub version: String,
    #[serde(rename = "configurationDigest")]
    pub configuration_digest: Digest,
}

/// Wire discriminator restricted by the schema to "info", "warning", "error".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum DiagnosticSeverity {
    #[serde(rename = "info")]
    Info,
    #[serde(rename = "warning")]
    Warning,
    #[serde(rename = "error")]
    Error,
}

/// Bounded static finding with source analyzer and repository location.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Diagnostic {
    pub id: String,
    pub analyzer: Identifier,
    pub rule: String,
    pub file: RepoPath,
    pub severity: DiagnosticSeverity,
    pub message: String,
    #[serde(rename = "startLine")]
    pub start_line: u64,
    #[serde(rename = "startColumn")]
    pub start_column: u64,
    #[serde(rename = "endLine")]
    pub end_line: u64,
    #[serde(rename = "endColumn")]
    pub end_column: u64,
}

/// Execution timing claims with safe integer bounds.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Timing {
    #[serde(rename = "queueMs")]
    pub queue_ms: f64,
    #[serde(rename = "elapsedMs")]
    pub elapsed_ms: f64,
    #[serde(rename = "outputTruncated")]
    pub output_truncated: bool,
    #[serde(rename = "budgetExhausted")]
    pub budget_exhausted: bool,
}

/// Wire discriminator restricted by the schema to "review-request".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ReviewRequestKind {
    #[serde(rename = "review-request")]
    ReviewRequest,
}

/// Actor correlation claim; it does not grant authority.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewRequestActorContext {
    #[serde(rename = "actorId")]
    pub actor_id: Identifier,
    #[serde(rename = "cardId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card_id: Option<Identifier>,
    #[serde(rename = "checkpointId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<Identifier>,
}

/// Structural request envelope; permissions are independently resolved by Taxis.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: SchemaVersion,
    pub kind: ReviewRequestKind,
    pub binding: ReviewBinding,
    pub scope: Vec<RepoPath>,
    #[serde(rename = "deadlineAtMs")]
    pub deadline_at_ms: u64,
    #[serde(rename = "actorContext")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_context: Option<ReviewRequestActorContext>,
}

/// Wire discriminator restricted by the schema to "analysis-evidence".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum AnalysisEvidenceKind {
    #[serde(rename = "analysis-evidence")]
    AnalysisEvidence,
}

/// Structural analysis envelope; semantic completion is verified separately.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnalysisEvidence {
    #[serde(rename = "schemaVersion")]
    pub schema_version: SchemaVersion,
    pub kind: AnalysisEvidenceKind,
    pub binding: ReviewBinding,
    pub engines: Vec<EngineVersion>,
    pub execution: Execution,
    pub diagnostics: Vec<Diagnostic>,
    pub measurements: Measurements,
    pub timing: Timing,
}

/// Wire discriminator restricted by the schema to "hmac-sm3".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ReceiptPayloadSignatureAlgorithm {
    #[serde(rename = "hmac-sm3")]
    HmacSm3,
}

/// Wire discriminator restricted by the schema to "approved", "blocked", "needs-review", "unavailable".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ReceiptPayloadDecision {
    #[serde(rename = "approved")]
    Approved,
    #[serde(rename = "blocked")]
    Blocked,
    #[serde(rename = "needs-review")]
    NeedsReview,
    #[serde(rename = "unavailable")]
    Unavailable,
}

/// Complete authority binding and decision included in receipt signing bytes.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptPayload {
    pub binding: ReviewBinding,
    pub issuer: Identifier,
    #[serde(rename = "keyId")]
    pub key_id: Identifier,
    #[serde(rename = "signatureAlgorithm")]
    pub signature_algorithm: ReceiptPayloadSignatureAlgorithm,
    #[serde(rename = "requestDigest")]
    pub request_digest: Digest,
    #[serde(rename = "evidenceDigest")]
    pub evidence_digest: Digest,
    #[serde(rename = "previousEvidenceDigest")]
    pub previous_evidence_digest: Option<Digest>,
    pub decision: ReceiptPayloadDecision,
    pub reasons: Vec<String>,
    #[serde(rename = "issuedAtMs")]
    pub issued_at_ms: u64,
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: u64,
}

/// Wire discriminator restricted by the schema to "trusted-review-receipt".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum TrustedReviewReceiptKind {
    #[serde(rename = "trusted-review-receipt")]
    TrustedReviewReceipt,
}

/// Receipt wire envelope; parsing establishes neither issuer trust nor approval.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustedReviewReceipt {
    #[serde(rename = "schemaVersion")]
    pub schema_version: SchemaVersion,
    pub kind: TrustedReviewReceiptKind,
    pub payload: ReceiptPayload,
    pub signature: String,
}

/// Typed wire envelopes; only the structural parser enforces all schema constraints.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum QualityDocument {
    ReviewRequest(Box<ReviewRequest>),
    AnalysisEvidence(Box<AnalysisEvidence>),
    TrustedReviewReceipt(Box<TrustedReviewReceipt>),
}
