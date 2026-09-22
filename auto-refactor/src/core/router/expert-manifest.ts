/**
 * Module: Core Router — MoE Expert Manifest Single Source of Truth
 * File Path: src/core/router/expert-manifest.ts
 * Architecture Role: Single source of truth for all analyzer/expert capabilities, signals,
 *   execution tracks, steady-state costs, weights, and fallback strategies.
 * Dependencies & Triggers: C-01, C-02, N-08; imported by sparseRuleRouter and guard harnesses.
 * Responsibilities:
 *   1. Declare normative capabilities of every builtin and future expert.
 *   2. Enforce security family fallback restrictions (prohibiting 'skip').
 *   3. Generate category and archetype activation matrices dynamically via pure functions.
 * Exit Semantics & Design Rationale: Exits cleanly; pure functions and immutable data structures
 *   with zero side effects, zero I/O, and deterministic execution.
 */

import {
    ANALYZER_CONSTANTS,
    ANALYZER_LARGE_FILE,
    ANALYZER_COMPLEXITY,
    ANALYZER_GOVERNANCE,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_SECRETS,
    ANALYZER_ARCHITECTURE,
    ANALYZER_PERFORMANCE,
    ANALYZER_COMMENTS,
    ANALYZER_HYGIENE,
    ANALYZER_SECURITY,
    ANALYZER_SIMPLIFY,
    ANALYZER_PYTHON_MODERN,
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    ANALYZER_DOCS,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_NAMING,
} from '../scoring/dimensionLiterals';

const TRACK_FAST = 'fast' as const;
const TRACK_DEEP = 'deep' as const;
const _TRACK_OFF = 'off' as const;

/**
 * Execution track declaring whether an expert participates in synchronous FastTrack
 * latency budget (<15ms) or asynchronous DeepTrack pipeline.
 */
export type ExecutionTrack = typeof TRACK_FAST | typeof TRACK_DEEP | typeof _TRACK_OFF;

const FALLBACK_ESCALATE_DEEP = 'escalate-deep' as const;
const FALLBACK_BLOCK = 'block' as const;
const FALLBACK_SKIP = 'skip' as const;

/**
 * Fallback strategy when budget is exceeded or expert is bypassed.
 * Security family experts are strictly forbidden from declaring 'skip'.
 */
export type FallbackStrategy =
    typeof FALLBACK_ESCALATE_DEEP | typeof FALLBACK_BLOCK | typeof FALLBACK_SKIP;

const SIG_LITERAL = 'LITERAL' as const;
const SIG_GENERAL_CODE = 'GENERAL_CODE' as const;
const SIG_INTERFACE_SIGNATURE = 'INTERFACE_SIGNATURE' as const;
const SIG_CONTROL_FLOW = 'CONTROL_FLOW' as const;
const SIG_IMPORT_EXPORT = 'IMPORT_EXPORT' as const;
const _SIG_TYPE_DECLARATION = 'TYPE_DECLARATION' as const;
const _SIG_COMMENT_ONLY = 'COMMENT_ONLY' as const;
const SIG_COMMENT_DOC_ONLY = 'COMMENT_DOC_ONLY' as const;
const SIG_DOC_COMMENT = 'DOC_COMMENT' as const;
const _SIG_CONCURRENCY = 'CONCURRENCY' as const;
const _SIG_DATA_STRUCTURE = 'DATA_STRUCTURE' as const;
const SIG_NON_SOURCE = 'NON_SOURCE' as const;
const SIG_INSTRUCTION_SURFACE = 'INSTRUCTION_SURFACE' as const;
const SIG_MANIFEST = 'MANIFEST' as const;
const SIG_CONFIG_SECURITY = 'CONFIG_SECURITY' as const;
const SIG_IO = 'IO' as const;
const SIG_DELETION = 'DELETION' as const;
const SIG_ASYNC = 'ASYNC' as const;
const SIG_AGENT_METADATA = 'AGENT_METADATA' as const;
const _SIG_UNKNOWN = 'UNKNOWN' as const;

/**
 * Normalized mutation signals derived from diff analysis for sparse routing.
 */
export type MutationSignal =
    | typeof SIG_LITERAL
    | typeof SIG_GENERAL_CODE
    | typeof SIG_INTERFACE_SIGNATURE
    | typeof SIG_CONTROL_FLOW
    | typeof SIG_IMPORT_EXPORT
    | typeof _SIG_TYPE_DECLARATION
    | typeof _SIG_COMMENT_ONLY
    | typeof SIG_COMMENT_DOC_ONLY
    | typeof SIG_DOC_COMMENT
    | typeof _SIG_CONCURRENCY
    | typeof _SIG_DATA_STRUCTURE
    | typeof SIG_NON_SOURCE
    | typeof SIG_INSTRUCTION_SURFACE
    | typeof SIG_MANIFEST
    | typeof SIG_CONFIG_SECURITY
    | typeof SIG_IO
    | typeof SIG_DELETION
    | typeof SIG_ASYNC
    | typeof SIG_AGENT_METADATA
    | typeof _SIG_UNKNOWN;

/**
 * Normative capability manifest for a single MoE expert analyzer.
 */
export interface ExpertManifestEntry {
    id: string;
    signals: readonly string[];
    track: ExecutionTrack;
    steadyCostUs: number;
    weight: number;
    fallback: FallbackStrategy;
    isSecurityFamily?: boolean;
    description?: string;
}

/**
 * Canonical registry of all built-in expert manifests.
 * Single source of truth (C-01 & C-02).
 */
export const EXPERT_MANIFEST: readonly ExpertManifestEntry[] = [
    {
        id: ANALYZER_CONSTANTS,
        signals: [SIG_LITERAL, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: 45,
        weight: 1.0,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Magic numbers and duplicate literal extraction',
    },
    {
        id: ANALYZER_LARGE_FILE,
        signals: [SIG_GENERAL_CODE, SIG_INTERFACE_SIGNATURE],
        track: TRACK_DEEP,
        steadyCostUs: 30,
        weight: 1.2,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Large file splitting and modularization',
    },
    {
        id: ANALYZER_COMPLEXITY,
        signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: 120,
        weight: 2.5,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Cyclomatic and cognitive complexity bounds',
    },
    {
        id: ANALYZER_GOVERNANCE,
        signals: [SIG_IMPORT_EXPORT, SIG_INTERFACE_SIGNATURE, SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 150,
        weight: 3.0,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Project norms and contract verification',
    },
    {
        id: ANALYZER_DEPENDENCY_GRAPH,
        signals: [SIG_IMPORT_EXPORT, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 250,
        weight: 4.5,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Dependency cycle and layering verification',
    },
    {
        id: ANALYZER_SECRETS,
        signals: [SIG_LITERAL, SIG_GENERAL_CODE, SIG_NON_SOURCE],
        track: TRACK_FAST,
        steadyCostUs: 40,
        weight: 1.0,
        fallback: FALLBACK_BLOCK,
        isSecurityFamily: true,
        description: 'High-entropy secret and credential detection',
    },
    {
        id: ANALYZER_ARCHITECTURE,
        signals: [SIG_IMPORT_EXPORT, SIG_INTERFACE_SIGNATURE, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 200,
        weight: 4.0,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Architecture boundaries and domain integrity',
    },
    {
        id: ANALYZER_PERFORMANCE,
        signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 180,
        weight: 3.5,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Loop allocations, pooling, and micro-benchmarks',
    },
    {
        id: ANALYZER_COMMENTS,
        signals: [SIG_DOC_COMMENT, SIG_COMMENT_DOC_ONLY, SIG_INTERFACE_SIGNATURE, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: 50,
        weight: 1.0,
        fallback: FALLBACK_SKIP,
        description: 'Contract documentation and comment hygiene',
    },
    {
        id: ANALYZER_HYGIENE,
        signals: [SIG_LITERAL, SIG_INTERFACE_SIGNATURE, SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: 60,
        weight: 1.2,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Dead code, duplicate blocks, and naming hygiene',
    },
    {
        id: ANALYZER_SECURITY,
        signals: [
            SIG_INTERFACE_SIGNATURE,
            SIG_CONTROL_FLOW,
            SIG_INSTRUCTION_SURFACE,
            SIG_MANIFEST,
            SIG_CONFIG_SECURITY,
            SIG_GENERAL_CODE,
        ],
        track: TRACK_FAST,
        steadyCostUs: 85,
        weight: 2.0,
        fallback: FALLBACK_BLOCK,
        isSecurityFamily: true,
        description: 'Injection, dynamic code execution, and security vulnerabilities',
    },
    {
        id: ANALYZER_SIMPLIFY,
        signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: 70,
        weight: 1.5,
        fallback: FALLBACK_SKIP,
        description: 'Control flow simplification and guard clause inversion',
    },
    {
        id: ANALYZER_PYTHON_MODERN,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 110,
        weight: 2.2,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Python modernization and standard library idioms',
    },
    {
        id: ANALYZER_TYPESCRIPT_MODERN,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 95,
        weight: 2.0,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'TypeScript modernization, strict typing, and ES idioms',
    },
    {
        id: ANALYZER_RUST_MODERN,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 90,
        weight: 2.0,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Rust idioms and memory safety checks',
    },
    {
        id: ANALYZER_GDSCRIPT_MODERN,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 85,
        weight: 1.8,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'GDScript typing and node lifecycle best practices',
    },
    {
        id: ANALYZER_DOCS,
        signals: [SIG_DOC_COMMENT, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 60,
        weight: 1.2,
        fallback: FALLBACK_SKIP,
        description: 'API documentation completeness and parity',
    },
    {
        id: ANALYZER_DATA_ARCHITECTURE,
        signals: [SIG_GENERAL_CODE, SIG_IO],
        track: TRACK_DEEP,
        steadyCostUs: 130,
        weight: 2.8,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Data model invariants, schemas, and nullability',
    },
    {
        id: ANALYZER_TEST_MODERNITY,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 140,
        weight: 3.0,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Test effectiveness, anti-gaming, and tautology detection',
    },
    {
        id: ANALYZER_DEPENDENCY_LAYOUT,
        signals: [SIG_IMPORT_EXPORT, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: 160,
        weight: 3.2,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Package layout, workspace structure, and packaging',
    },
    {
        id: ANALYZER_NAMING,
        signals: [SIG_INTERFACE_SIGNATURE, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: 40,
        weight: 1.0,
        fallback: FALLBACK_SKIP,
        description: 'Identifier and physical naming conventions',
    },
];

/**
 * Validate manifest integrity and normative constraints (C-01, C-02, C-04, N-08).
 *
 * @param manifest - List of expert manifests to validate.
 */
export function validateExpertManifest(manifest: readonly ExpertManifestEntry[]): void {
    const ids = new Set<string>();
    for (const entry of manifest) {
        if (ids.has(entry.id)) {
            throw new Error(`[DUPLICATE_EXPERT_ID] Duplicate expert id: ${entry.id}`);
        }
        ids.add(entry.id);

        if (!entry.signals || entry.signals.length === 0) {
            throw new Error(`[EMPTY_SIGNALS] Expert ${entry.id} must declare at least one signal`);
        }

        if (entry.steadyCostUs < 0) {
            throw new Error(`[INVALID_COST] Expert ${entry.id} steadyCostUs must be non-negative`);
        }

        if (entry.weight <= 0) {
            throw new Error(`[INVALID_WEIGHT] Expert ${entry.id} weight must be positive`);
        }

        // C-04: Security family strictly prohibited from fallback 'skip'
        if (entry.isSecurityFamily && entry.fallback === FALLBACK_SKIP) {
            throw new Error(
                `[SECURITY_FALLBACK_VIOLATION] Security expert ${entry.id} cannot declare fallback 'skip'`,
            );
        }
    }
}
import { deriveCategoryMatrix, deriveArchetypeMatrix } from './expert-matrices';
export { deriveCategoryMatrix, deriveArchetypeMatrix };
