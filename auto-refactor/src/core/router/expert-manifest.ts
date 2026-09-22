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
    | typeof _SIG_UNKNOWN;

const COST_CONSTANTS = 45;
const COST_LARGE_FILE = 30;
const COST_COMPLEXITY = 120;
const COST_GOVERNANCE = 150;
const COST_DEPENDENCY_GRAPH = 250;
const COST_SECRETS = 40;
const COST_ARCHITECTURE = 200;
const COST_PERFORMANCE = 180;
const COST_COMMENTS = 50;
const COST_HYGIENE = 60;
const COST_SECURITY = 85;
const COST_SIMPLIFY = 70;
const COST_PYTHON_MODERN = 110;
const COST_TS_MODERN = 95;
const COST_RUST_MODERN = 90;
const COST_GDSCRIPT_MODERN = 85;
const COST_DOCS = 60;
const COST_DATA_ARCHITECTURE = 130;
const COST_TEST_MODERNITY = 140;
const COST_DEPENDENCY_LAYOUT = 160;
const COST_NAMING = 40;

const WEIGHT_CONSTANTS = 1.0;
const WEIGHT_LARGE_FILE = 1.2;
const WEIGHT_COMPLEXITY = 2.5;
const WEIGHT_GOVERNANCE = 3.0;
const WEIGHT_DEPENDENCY_GRAPH = 4.5;
const WEIGHT_SECRETS = 1.0;
const WEIGHT_ARCHITECTURE = 4.0;
const WEIGHT_PERFORMANCE = 3.5;
const WEIGHT_COMMENTS = 1.0;
const WEIGHT_HYGIENE = 1.2;
const WEIGHT_SECURITY = 2.0;
const WEIGHT_SIMPLIFY = 1.5;
const WEIGHT_PYTHON_MODERN = 2.2;
const WEIGHT_TS_MODERN = 2.0;
const WEIGHT_RUST_MODERN = 2.0;
const WEIGHT_GDSCRIPT_MODERN = 1.8;
const WEIGHT_DOCS = 1.2;
const WEIGHT_DATA_ARCHITECTURE = 2.8;
const WEIGHT_TEST_MODERNITY = 3.0;
const WEIGHT_DEPENDENCY_LAYOUT = 3.2;
const WEIGHT_NAMING = 1.0;

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
        steadyCostUs: COST_CONSTANTS,
        weight: WEIGHT_CONSTANTS,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Magic numbers and duplicate literal extraction',
    },
    {
        id: ANALYZER_LARGE_FILE,
        signals: [SIG_GENERAL_CODE, SIG_INTERFACE_SIGNATURE],
        track: TRACK_DEEP,
        steadyCostUs: COST_LARGE_FILE,
        weight: WEIGHT_LARGE_FILE,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Large file splitting and modularization',
    },
    {
        id: ANALYZER_COMPLEXITY,
        signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: COST_COMPLEXITY,
        weight: WEIGHT_COMPLEXITY,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Cyclomatic and cognitive complexity bounds',
    },
    {
        id: ANALYZER_GOVERNANCE,
        signals: [SIG_IMPORT_EXPORT, SIG_INTERFACE_SIGNATURE, SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_GOVERNANCE,
        weight: WEIGHT_GOVERNANCE,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Project norms and contract verification',
    },
    {
        id: ANALYZER_DEPENDENCY_GRAPH,
        signals: [SIG_IMPORT_EXPORT, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_DEPENDENCY_GRAPH,
        weight: WEIGHT_DEPENDENCY_GRAPH,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Dependency cycle and layering verification',
    },
    {
        id: ANALYZER_SECRETS,
        signals: [SIG_LITERAL, SIG_GENERAL_CODE, SIG_NON_SOURCE],
        track: TRACK_FAST,
        steadyCostUs: COST_SECRETS,
        weight: WEIGHT_SECRETS,
        fallback: FALLBACK_BLOCK,
        isSecurityFamily: true,
        description: 'High-entropy secret and credential detection',
    },
    {
        id: ANALYZER_ARCHITECTURE,
        signals: [SIG_IMPORT_EXPORT, SIG_INTERFACE_SIGNATURE, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_ARCHITECTURE,
        weight: WEIGHT_ARCHITECTURE,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Architecture boundaries and domain integrity',
    },
    {
        id: ANALYZER_PERFORMANCE,
        signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_PERFORMANCE,
        weight: WEIGHT_PERFORMANCE,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Loop allocations, pooling, and micro-benchmarks',
    },
    {
        id: ANALYZER_COMMENTS,
        signals: [SIG_DOC_COMMENT, SIG_COMMENT_DOC_ONLY, SIG_INTERFACE_SIGNATURE, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: COST_COMMENTS,
        weight: WEIGHT_COMMENTS,
        fallback: FALLBACK_SKIP,
        description: 'Contract documentation and comment hygiene',
    },
    {
        id: ANALYZER_HYGIENE,
        signals: [SIG_LITERAL, SIG_INTERFACE_SIGNATURE, SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: COST_HYGIENE,
        weight: WEIGHT_HYGIENE,
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
        steadyCostUs: COST_SECURITY,
        weight: WEIGHT_SECURITY,
        fallback: FALLBACK_BLOCK,
        isSecurityFamily: true,
        description: 'Injection, dynamic code execution, and security vulnerabilities',
    },
    {
        id: ANALYZER_SIMPLIFY,
        signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: COST_SIMPLIFY,
        weight: WEIGHT_SIMPLIFY,
        fallback: FALLBACK_SKIP,
        description: 'Control flow simplification and guard clause inversion',
    },
    {
        id: ANALYZER_PYTHON_MODERN,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_PYTHON_MODERN,
        weight: WEIGHT_PYTHON_MODERN,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Python modernization and standard library idioms',
    },
    {
        id: ANALYZER_TYPESCRIPT_MODERN,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_TS_MODERN,
        weight: WEIGHT_TS_MODERN,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'TypeScript modernization, strict typing, and ES idioms',
    },
    {
        id: ANALYZER_RUST_MODERN,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_RUST_MODERN,
        weight: WEIGHT_RUST_MODERN,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Rust idioms and memory safety checks',
    },
    {
        id: ANALYZER_GDSCRIPT_MODERN,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_GDSCRIPT_MODERN,
        weight: WEIGHT_GDSCRIPT_MODERN,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'GDScript typing and node lifecycle best practices',
    },
    {
        id: ANALYZER_DOCS,
        signals: [SIG_DOC_COMMENT, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_DOCS,
        weight: WEIGHT_DOCS,
        fallback: FALLBACK_SKIP,
        description: 'API documentation completeness and parity',
    },
    {
        id: ANALYZER_DATA_ARCHITECTURE,
        signals: [SIG_GENERAL_CODE, SIG_IO],
        track: TRACK_DEEP,
        steadyCostUs: COST_DATA_ARCHITECTURE,
        weight: WEIGHT_DATA_ARCHITECTURE,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Data model invariants, schemas, and nullability',
    },
    {
        id: ANALYZER_TEST_MODERNITY,
        signals: [SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_TEST_MODERNITY,
        weight: WEIGHT_TEST_MODERNITY,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Test effectiveness, anti-gaming, and tautology detection',
    },
    {
        id: ANALYZER_DEPENDENCY_LAYOUT,
        signals: [SIG_IMPORT_EXPORT, SIG_GENERAL_CODE],
        track: TRACK_DEEP,
        steadyCostUs: COST_DEPENDENCY_LAYOUT,
        weight: WEIGHT_DEPENDENCY_LAYOUT,
        fallback: FALLBACK_ESCALATE_DEEP,
        description: 'Package layout, workspace structure, and packaging',
    },
    {
        id: ANALYZER_NAMING,
        signals: [SIG_INTERFACE_SIGNATURE, SIG_GENERAL_CODE],
        track: TRACK_FAST,
        steadyCostUs: COST_NAMING,
        weight: WEIGHT_NAMING,
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
