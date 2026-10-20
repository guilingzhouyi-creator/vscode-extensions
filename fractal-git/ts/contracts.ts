/**
 * Module: Fractal Git — TypeScript Semantic Contracts
 * File Path: ts/contracts.ts
 * Architecture Role: Defines strong TypeScript interfaces, state enums, and data transfer
 *   objects bridging the Rust native kernel, LayerVFS, and Auto review gating system.
 * Dependencies & Triggers: Triggered when TS consumers interact with the fractal git facade.
 * Responsibilities: Specify types for fractal references, commit manifests, gating verdicts,
 *   and workspace lifecycle stages adhering to blueprint §4.2~§4.3.
 * Exit Semantics & Design Rationale: Pure type definitions; provides immutable interfaces and
 *   fail-fast structural typing for multi-agent worktree orchestration.
 */

import { GIT_FILE_MODE } from './constants';

/**
 * Task card identity context aligning with Praxis multi-agent execution.
 */
export interface PraxisCardContext {
    readonly cardId: string;
    readonly cellId: string;
    readonly agentUid: string;
    readonly role?: string;
}

/**
 * Valid reference tier classification in the self-similar fractal hierarchy.
 */
export type FractalTier = 'trunk' | 'cell_main' | 'card_worktree' | 'subagent_worktree';

/**
 * Structured descriptor for a Fractal Git reference pointer.
 */
export interface FractalRefDescriptor {
    readonly tier: FractalTier;
    readonly gitRef: string;
    readonly cellId?: string;
    readonly cardId?: string;
    readonly subagentId?: string;
}

/**
 * Dual-faced commit metadata embedded in serialized commits.
 */
export interface FractalCommitMeta {
    readonly cardContext: PraxisCardContext;
    readonly qualityScore: number;
    readonly gateStatus: 'approved' | 'rejected' | 'bypassed';
    readonly timestampMs: number;
    readonly astImpactSymbols?: readonly string[];
}

/**
 * File descriptor staged for materialization from LayerVFS into Git.
 */
export interface StagedFileEntry {
    readonly path: string;
    readonly mode: typeof GIT_FILE_MODE.REGULAR | typeof GIT_FILE_MODE.EXECUTABLE;
    readonly content: Uint8Array | string;
}

/**
 * Request payload for materializing a winning CAS snapshot into a canonical Git commit.
 */
export interface MaterializeCommitRequest {
    readonly targetRef: FractalRefDescriptor;
    readonly parentCommitOids: readonly string[];
    readonly files: readonly StagedFileEntry[];
    readonly message: string;
    readonly authorName: string;
    readonly authorEmail: string;
    readonly agentMeta?: FractalCommitMeta;
}

/**
 * Result returned upon successful atomic materialization.
 */
export interface MaterializeCommitResult {
    readonly commitOid: string;
    readonly treeOid: string;
    readonly targetRef: string;
    readonly durationMs: number;
}

/**
 * Quality gate verification verdict.
 */
export interface GateAuditVerdict {
    readonly passed: boolean;
    readonly score: number;
    readonly violations: readonly string[];
    readonly shouldEscalateToL3A: boolean;
    readonly auditDurationMs: number;
}

/**
 * Workspace reclamation result.
 */
export interface ReclamationSummary {
    readonly workspaceId: string;
    readonly targetRef: string;
    readonly physicalPathRemoved: boolean;
    readonly durationMs: number;
}
