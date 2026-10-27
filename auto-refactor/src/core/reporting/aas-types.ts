/**
 * Module: Core Reporting — Agent Audit Schema (AAS v1.0) Contracts
 * File Path: src/core/reporting/aas-types.ts
 * Architecture Role: Strongly-typed wire format and API contract for Agent-Native
 *   audit reports, designed for high LLM readability and maximum token economy.
 * Dependencies & Triggers: Consumes QualityDimension, Severity from ../types;
 *   consumed by aas-reporter.ts, reporterRegistry.ts, and external Agents.
 * Responsibilities:
 *   1. Define AAS-v1 protocol identifier and headline verdict/health envelopes.
 *   2. Define file-grouped defect records with inline code anchors and fix recipes.
 *   3. Define topological ordering categories (L1_CONTRACT -> L5_GOVERNANCE).
 * Exit Semantics & Design Rationale: Type declarations only; CC = 0, zero runtime overhead.
 */

/** Protocol schema identifier for AAS v1.0 reports. */
export const AAS_SCHEMA_ID = 'aas-v1';

/** Executive audit verdict category: PASS, WARN, or BLOCK. */
export type AasVerdict = 'PASS' | 'WARN' | 'BLOCK';

/** Severity tier mapped to Agent automated remediation prioritization. */
export type AasSeverity = 'BLOCK' | 'WARN' | 'INFO';

/** Counter summary of scanned files and detected defects by severity. */
export interface AasCounts {
    /** Total scanned files */
    readonly files: number;
    /** Total detected defects */
    readonly total: number;
    /** Blocking error count */
    readonly errors: number;
    /** Warning count */
    readonly warns: number;
    /** Info count */
    readonly info: number;
    /** Suppressed defects count */
    readonly suppressed?: number;
}

/** Executive health block containing composite score, letter grade, and CAI. */
export interface AasHealth {
    /** Composite quality score (0..100) or null when unmeasured */
    readonly score: number | null;
    /** Standard letter grade (A+, A, B, C, D, F, N/A) */
    readonly grade: string;
    /** Code autonomy index (CAI) percentage */
    readonly cai?: number;
    /** Effective code density ratio (0.0 .. 1.0) */
    readonly density?: number;
    /** 5D Riemannian manifold and tensor density summary */
    readonly tensorSummary?: {
        readonly compositeDensity: number;
        readonly averageTspr: number;
        readonly averagePor: number;
        readonly averageColumnDensity: number;
        readonly averageSpatialDensity?: number;
        readonly averageMahalanobisDistance?: number;
    };
    /** Aggregate counter summary */
    readonly counts: AasCounts;
}

/** Bottleneck entry ranking rules by composite score point loss. */
export interface AasBottleneck {
    /** Offending rule identifier */
    readonly rule: string;
    /** Dimension key or name */
    readonly dim?: string;
    /** Total point loss from this rule */
    readonly loss: number;
    /** Number of violations */
    readonly count: number;
}

/** Exact text range replacement for programmatic patch application. */
export interface AasExactPatch {
    readonly range: {
        readonly startLine: number;
        readonly startCol: number;
        readonly endLine: number;
        readonly endCol: number;
    };
    readonly replacementText: string;
}

/** Actionable remediation recipe advising machine-actionable repair steps. */
export interface AasFixRecipe {
    /** Action verb (e.g. lift_allocation, split_function, extract_constant) */
    readonly action: string;
    /** Suggested patch operator or exact range replacement */
    readonly patch?: string | AasExactPatch;
    /** Code template or replacement snippet */
    readonly template?: string;
    /** Whether safe to automate without human supervision */
    readonly safeToAutomate?: boolean;
}

/** Actionable defect item associated with a specific code location. */
export interface AasDefectRecord {
    /** 1-based start line */
    readonly line: number;
    /** 1-based start column (optional) */
    readonly col?: number;
    /** Canonical rule ID (catalogued SSOT) */
    readonly rule: string;
    /** Severity mapped to Agent prioritization tier */
    readonly sev: AasSeverity;
    /** Factual technical violation message */
    readonly msg: string;
    /** Compact 1-2 line anchor code context with '> ' highlighting line */
    readonly anchor?: string;
    /** Deterministic remediation recipe if available */
    readonly fix?: AasFixRecipe;
    /** Localized qualitative verification command (omitted when identical to root defaultVerify) */
    readonly verify?: string;
    /** Originating analyzer name if explicitly requested */
    readonly analyzer?: string;
    /** Whether this defect is newly introduced compared to the baseline */
    readonly isNew?: boolean;
}

/** Configuration options governing AAS report serialization and token budgeting. */
export interface AasReportOptions {
    /** Maximum number of files to include in output */
    readonly maxFiles?: number;
    /** Maximum defects per file */
    readonly maxDefectsPerFile?: number;
    /** Maximum total defects across all files */
    readonly maxTotalDefects?: number;
    /** Include info-level findings (defaults to false to conserve tokens) */
    readonly includeInfo?: boolean;
    /** Compress diagnostic messages into high-efficiency token sentences (defaults to true) */
    readonly compressSentences?: boolean;
    /** Include analyzer name per defect (defaults to false to conserve tokens) */
    readonly includeAnalyzer?: boolean;
    /** Default project test command hoisted to root (defaults to 'npm test') */
    readonly defaultVerify?: string;
    /** Context line radius for anchor code slice (defaults to 1 for token economy) */
    readonly contextRadius?: number;
    /** Base repository root directory for resolving file contents */
    readonly baseDir?: string;
    /** Custom file reader for anchor code extraction */
    readonly fileReader?: (relativePath: string) => string | undefined;
    /** Override headline score block with aggregated numbers */
    readonly healthOverride?: {
        readonly score?: number | null;
        readonly grade?: string;
        readonly cai?: number;
        readonly density?: number;
        readonly tensorSummary?: {
            readonly compositeDensity: number;
            readonly averageTspr: number;
            readonly averagePor: number;
            readonly averageColumnDensity: number;
            readonly averageSpatialDensity?: number;
            readonly averageMahalanobisDistance?: number;
        };
    };
}

/** Complete Agent-Native audit report payload adhering to AAS v1.0. */
export interface AgentAuditReport {
    /** Protocol discriminator: 'aas-v1' */
    readonly schema: typeof AAS_SCHEMA_ID;
    /** Tool name: 'auto-refactor' */
    readonly tool: string;
    /** Tool version */
    readonly version: string;
    /** ISO timestamp */
    readonly timestamp: string;
    /** Scanned workspace / root path */
    readonly root: string;
    /** Executive verdict */
    readonly verdict: AasVerdict;
    /** Executive health metrics */
    readonly health: AasHealth;
    /** Default qualitative verification command for entire workspace / project */
    readonly defaultVerify?: string;
    /** Ten-dimensional quality indices if computed */
    readonly dimensions?: Partial<Record<string, number>>;
    /** Top quality bottlenecks */
    readonly bottlenecks: readonly AasBottleneck[];
    /** Architectural topology layer mapping: layer -> affected file paths */
    readonly topology: Partial<Record<string, readonly string[]>>;
    /** File-grouped actionable defect records */
    readonly files: Record<string, readonly AasDefectRecord[]>;
    /** Count of omitted findings due to emission cap */
    readonly truncated?: number;
    /** Optional summary warnings / notes */
    readonly notes?: readonly string[];
}
