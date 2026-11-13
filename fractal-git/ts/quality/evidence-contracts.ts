/**
 * Module: Taxis Quality — Generated Contract
 * File Path: ts/quality/evidence-contracts.ts
 * Architecture Role: Read-only wire types derived from the authoritative JSON Schema.
 * Dependencies & Triggers: Generated from quality-evidence.schema.json.
 * Responsibilities: Preserve the single source contract for TypeScript consumers.
 * Exit Semantics & Design Rationale: Regenerate with sync-quality-evidence.js; never edit manually.
 */
export type SchemaVersion = 1;

export type Identifier = string;

export type RepoPath = string;

export type Digest = {
    readonly "algorithm": "sm3";
    readonly "value": string;
};

export type GitObject = {
    readonly "algorithm": "git-sha1";
    readonly "value": string;
};

export type SnapshotIdentity = {
    readonly "repositoryId": Identifier;
    readonly "tree": GitObject;
    readonly "manifestDigest": Digest;
};

export type Baseline = ({
    readonly "strategy": "initial";
    readonly "parents": ReadonlyArray<GitObject>;
}) | ({
    readonly "strategy": "parent";
    readonly "parents": ReadonlyArray<GitObject>;
}) | ({
    readonly "strategy": "explicit";
    readonly "parents": ReadonlyArray<GitObject>;
}) | ({
    readonly "strategy": "merge";
    readonly "parents": ReadonlyArray<GitObject>;
});

export type ReviewBinding = {
    readonly "reviewId": Identifier;
    readonly "operationId": Identifier;
    readonly "snapshot": SnapshotIdentity;
    readonly "baseline": Baseline;
    readonly "policyDigest": Digest;
    readonly "configurationDigest": Digest;
    readonly "requiredCapabilitiesDigest": Digest;
};

export type ReviewFailure = {
    readonly "code": Identifier;
    readonly "message": string;
    readonly "retryable"?: boolean;
};

export type Provenance = {
    readonly "source": "analysis" | "trajectory-comparison" | "test-execution" | "mutation-execution" | "holdout-validation";
    readonly "sampleIds": ReadonlyArray<Identifier>;
};

export type Unmeasured = {
    readonly "status": "unmeasured";
    readonly "reason": string;
};

export type NotApplicable = {
    readonly "status": "not-applicable";
    readonly "reason": string;
};

export type FailedMeasurement = {
    readonly "status": "failed";
    readonly "error": ReviewFailure;
};

export type MeasuredNumber = {
    readonly "status": "measured";
    readonly "value": number;
    readonly "provenance": Provenance;
};

export type TrialCounts = {
    readonly "passed": number;
    readonly "total": number;
};

export type MeasuredTrials = {
    readonly "status": "measured";
    readonly "value": TrialCounts;
    readonly "provenance": Provenance;
};

export type NumberMeasurement = (MeasuredNumber) | (Unmeasured) | (NotApplicable) | (FailedMeasurement);

export type TrialMeasurement = (MeasuredTrials) | (Unmeasured) | (NotApplicable) | (FailedMeasurement);

export type ScorePercent = number;

export type FiniteScalar = number;

export type TenDimensions = {
    readonly "architectureConsistency": ScorePercent;
    readonly "semanticPurity": ScorePercent;
    readonly "codeSecurity": ScorePercent;
    readonly "performanceEfficiency": ScorePercent;
    readonly "standardization": ScorePercent;
    readonly "modernity": ScorePercent;
    readonly "maintainability": ScorePercent;
    readonly "commentQuality": ScorePercent;
    readonly "duplication": ScorePercent;
    readonly "techDebtRisk": ScorePercent;
    readonly "compositeScore": ScorePercent;
    readonly "grade": string;
};

export type QuantMetrics = {
    readonly "rcr": FiniteScalar;
    readonly "erq": FiniteScalar;
    readonly "ddr": FiniteScalar;
    readonly "edb95": FiniteScalar;
    readonly "ptd": FiniteScalar;
    readonly "dsi": FiniteScalar;
    readonly "rcd": FiniteScalar;
    readonly "ehl": FiniteScalar;
    readonly "workspaceHealthScore": ScorePercent;
    readonly "autonomyRate": number;
    readonly "polyglotIndex": ScorePercent;
    readonly "sqaleMinutes": FiniteScalar;
    readonly "tdr": FiniteScalar;
    readonly "confidence": number;
};

export type Measurements = {
    readonly "qualityDelta": NumberMeasurement;
    readonly "generalization": NumberMeasurement;
    readonly "tests": TrialMeasurement;
    readonly "mutations": TrialMeasurement;
    readonly "performanceMs": NumberMeasurement;
    readonly "tenDimensions"?: TenDimensions;
    readonly "quantMetrics"?: QuantMetrics;
};

export type TrackStatus = "pending" | "running" | "complete" | "failed" | "not-required";

export type CapabilityCoverage = {
    readonly "analyzer": Identifier;
    readonly "capability": Identifier;
    readonly "language": Identifier;
    readonly "required": boolean;
    readonly "status": "supported" | "executed" | "not-applicable" | "unsupported" | "failed" | "degraded";
    readonly "reason"?: string;
    readonly "policyAllowsNotApplicable"?: boolean;
};

export type Execution = {
    readonly "schemaVersion": SchemaVersion;
    readonly "reviewId": Identifier;
    readonly "status": "queued" | "running" | "partial" | "complete" | "failed" | "cancelled" | "superseded";
    readonly "coverage": ReadonlyArray<CapabilityCoverage>;
    readonly "tracks": {
        readonly "fast": TrackStatus;
        readonly "deep": TrackStatus;
    };
    readonly "failures": ReadonlyArray<ReviewFailure>;
};

export type EngineVersion = {
    readonly "id": Identifier;
    readonly "version": string;
    readonly "configurationDigest": Digest;
};

export type Diagnostic = {
    readonly "id": string;
    readonly "analyzer": Identifier;
    readonly "rule": string;
    readonly "file": RepoPath;
    readonly "severity": "info" | "warning" | "error";
    readonly "message": string;
    readonly "startLine": number;
    readonly "startColumn": number;
    readonly "endLine": number;
    readonly "endColumn": number;
};

export type Timing = {
    readonly "queueMs": number;
    readonly "elapsedMs": number;
    readonly "outputTruncated": boolean;
    readonly "budgetExhausted": boolean;
};

export type ReviewRequest = {
    readonly "schemaVersion": SchemaVersion;
    readonly "kind": "review-request";
    readonly "binding": ReviewBinding;
    readonly "scope": ReadonlyArray<RepoPath>;
    readonly "deadlineAtMs": number;
    readonly "actorContext"?: {
        readonly "actorId": Identifier;
        readonly "cardId"?: Identifier;
        readonly "checkpointId"?: Identifier;
    };
};

export type AnalysisEvidence = {
    readonly "schemaVersion": SchemaVersion;
    readonly "kind": "analysis-evidence";
    readonly "binding": ReviewBinding;
    readonly "engines": ReadonlyArray<EngineVersion>;
    readonly "execution": Execution;
    readonly "diagnostics": ReadonlyArray<Diagnostic>;
    readonly "measurements": Measurements;
    readonly "timing": Timing;
};

export type ReceiptPayload = {
    readonly "binding": ReviewBinding;
    readonly "issuer": Identifier;
    readonly "keyId": Identifier;
    readonly "signatureAlgorithm": "hmac-sm3";
    readonly "requestDigest": Digest;
    readonly "evidenceDigest": Digest;
    readonly "previousEvidenceDigest": (Digest) | (null);
    readonly "decision": "approved" | "blocked" | "needs-review" | "unavailable";
    readonly "reasons": ReadonlyArray<string>;
    readonly "issuedAtMs": number;
    readonly "expiresAtMs": number;
};

export type TrustedReviewReceipt = {
    readonly "schemaVersion": SchemaVersion;
    readonly "kind": "trusted-review-receipt";
    readonly "payload": ReceiptPayload;
    readonly "signature": string;
};

export type QualityDocument = (ReviewRequest) | (AnalysisEvidence) | (TrustedReviewReceipt);
