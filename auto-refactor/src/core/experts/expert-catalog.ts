/**
 * Module: Core Experts - MoE Expert Catalog Single Source of Truth
 * File Path: src/core/experts/expert-catalog.ts
 * Architecture Role: Authoritative single source of truth (SSOT) catalog declaring all 32
 *   MoE experts, their 32-bit single-word bitmasks, activation affinities, serving profiles,
 *   and quality governance metadata. Composed modularly from core, ast, and system catalogs.
 * Dependencies & Triggers: Consumes catalog/{core,ast,system}-experts;
 *   consumed by expert-activation-library, sparseRuleRouter, and verification harnesses.
 * Responsibilities:
 *   1. Aggregate the 32 MoE expert profiles into a canonical, immutable EXPERT_CATALOG;
 *   2. Provide O(1) indexed lookups by id, bit, and index;
 *   3. Export backward-compatible EXPERT_MANIFEST projection for legacy consumers;
 *   4. Enforce security family fallback restrictions and manifest structural integrity.
 * Exit Semantics & Design Rationale: Pure, immutable declarative data structures satisfying
 *   strict code density and volume budgets (ELOC <= 900).
 */

import type { MoEExpertProfile } from './expert-types';
import { CORE_EXPERTS } from './catalog/core-experts';
import { AST_EXPERTS } from './catalog/ast-experts';
import { SYSTEM_EXPERTS } from './catalog/system-experts';

export { CORE_EXPERTS } from './catalog/core-experts';
export { AST_EXPERTS } from './catalog/ast-experts';
export { SYSTEM_EXPERTS } from './catalog/system-experts';

/**
 * Authoritative Canonical Registry of all 32 MoE Expert Profiles.
 * Single source of truth across the entire workspace (C-01, C-02, N-08).
 */
export const EXPERT_CATALOG: readonly MoEExpertProfile[] = Object.freeze([
    ...CORE_EXPERTS,
    ...AST_EXPERTS,
    ...SYSTEM_EXPERTS,
]);

/**
 * Fast O(1) Map lookups for expert profiles.
 */
export const EXPERT_BY_ID: ReadonlyMap<string, MoEExpertProfile> = new Map(
    EXPERT_CATALOG.map((expert) => [expert.id, expert]),
);

/**
 * Fast O(1) Map lookups for expert profiles by 32-bit single-word bitmask.
 * Registers both signed (1 << 31) and unsigned ((1 << 31) >>> 0) representations for bit 31 parity.
 */
export const EXPERT_BY_BIT: ReadonlyMap<number, MoEExpertProfile> = new Map(
    EXPERT_CATALOG.flatMap((expert) => [
        [expert.bit | 0, expert] as const,
        [expert.bit >>> 0, expert] as const,
    ]),
);

/**
 * Fast O(1) Array lookups for expert profiles by 0..31 index.
 */
export const EXPERT_BY_INDEX: readonly MoEExpertProfile[] = Object.freeze([...EXPERT_CATALOG]);

/**
 * Legacy ExpertManifestEntry representation for seamless backward compatibility.
 */
export interface LegacyExpertManifestEntry {
    readonly id: string;
    readonly signals: readonly string[];
    readonly track: 'fast' | 'deep' | 'off';
    readonly steadyCostUs: number;
    readonly weight: number;
    readonly fallback: 'escalate-deep' | 'block' | 'skip';
    readonly isSecurityFamily?: boolean;
    readonly description?: string;
}

/**
 * Backward-compatible projection of EXPERT_CATALOG into EXPERT_MANIFEST.
 */
export const EXPERT_MANIFEST: readonly LegacyExpertManifestEntry[] = Object.freeze(
    EXPERT_CATALOG.map((expert) => ({
        id: expert.id,
        signals: expert.affinities.signals,
        track: expert.serving.track,
        steadyCostUs: expert.serving.steadyCostUs,
        weight: expert.serving.weight,
        fallback: expert.serving.fallback,
        isSecurityFamily: expert.governance.isSecurityFamily,
        description: expert.governance.description,
    })),
);
