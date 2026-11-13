/**
 * Module: Fractal Git — Five-Tier Branch Coordinate Parser
 * File Path: ts/cli/branch-parser.ts
 * Architecture Role: Structural parser and kebab-case validator for five-tier fractal branches.
 * Dependencies & Triggers: Consumes constants from `../constants`; re-exported via `ts/cli/commands.ts`.
 * Responsibilities: Classify system trunk, integration trunk, cell main, canonical/legacy cards,
 *   facade branches, and subagent leaves without relying on substring heuristics.
 * Exit Semantics & Design Rationale: Pure functions with CC <= 15 and Depth <= 4.
 */

import {
    CELL_ALIASES,
    FACADE_TYPES,
    FORBIDDEN_BRANCH_PREFIXES,
    FRACTAL_REF,
    MAX_BRANCH_SEGMENT_LEN,
    PROTECTED_SYSTEM_TRUNKS,
} from '../constants';

/** Tier 0 representing repository system trunks (`main`/`master`). */
export const TIER_SYSTEM_TRUNK = 'system_trunk' as const;
/** Tier 1 trunk representing integration mainline. */
export const TIER_TRUNK = 'trunk' as const;
/** Tier 2 representing cell-level integration mainlines. */
export const TIER_CELL = 'cell' as const;
/** Tier 3 representing individual task card references. */
export const TIER_CARD = 'card' as const;
/** Tier 4 representing subagent ephemeral references. */
export const TIER_SUB = 'sub' as const;

/** Union of supported reference hierarchy tiers in Fractal Git. */
export type FractalRefTier =
    | typeof TIER_SYSTEM_TRUNK
    | typeof TIER_TRUNK
    | typeof TIER_CELL
    | typeof TIER_CARD
    | typeof TIER_SUB;

/** Structured parsed coordinate for one branch or fractal ref. */
export interface ParsedFractalCoordinate {
    readonly tier: FractalRefTier;
    readonly cellId?: string;
    readonly cardId?: string;
    readonly subagentId?: string;
    readonly canonicalShortBranch: string;
    readonly isLegacyFourSegmentCard: boolean;
}

const HEADS_PREFIX = 'refs/heads/';
const KEBAB_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Checks whether `segment` is strictly lowercase ASCII `kebab-case` within length limit. */
export function isValidKebabSegment(segment: string): boolean {
    if (segment.length === 0 || segment.length > MAX_BRANCH_SEGMENT_LEN) {
        return false;
    }
    return KEBAB_PATTERN.test(segment);
}

/** Normalizes a cell alias into its canonical workspace identifier. */
export function normalizeCellId(rawCell: string): string {
    const trimmed = rawCell.trim();
    const mapped = (CELL_ALIASES as Record<string, string>)[trimmed];
    return mapped ?? trimmed;
}

/** Checks whether a branch segment starts with or equals a prohibited scratch prefix. */
export function hasForbiddenBranchPrefix(segment: string): boolean {
    const lower = segment.toLowerCase();
    for (const prefix of FORBIDDEN_BRANCH_PREFIXES) {
        if (lower === prefix || lower.startsWith(`${prefix}-`) || lower.startsWith(`${prefix}/`)) {
            return true;
        }
    }
    return false;
}

function stripRefPrefix(rawRef: string): string {
    const trimmed = rawRef.trim();
    if (trimmed.startsWith(HEADS_PREFIX)) {
        return trimmed.slice(HEADS_PREFIX.length);
    }
    if (trimmed.startsWith(FRACTAL_REF.PREFIX)) {
        return trimmed.slice(FRACTAL_REF.PREFIX.length);
    }
    return trimmed;
}

function parseCellBranchSegments(segments: readonly string[]): ParsedFractalCoordinate | null {
    if (segments[0] !== 'cell') {
        return null;
    }
    const cellId = segments[1];
    if (segments.length === 3 && segments[2] === 'main') {
        return {
            tier: TIER_CELL,
            cellId,
            canonicalShortBranch: `cell/${cellId}/main`,
            isLegacyFourSegmentCard: false,
        };
    }
    if (segments.length === 5 && segments[2] === 'card' && segments[4] === FRACTAL_REF.CARD_CANONICAL_LEAF) {
        const cardId = segments[3];
        return {
            tier: TIER_CARD,
            cellId,
            cardId,
            canonicalShortBranch: `cell/${cellId}/card/${cardId}/${FRACTAL_REF.CARD_CANONICAL_LEAF}`,
            isLegacyFourSegmentCard: false,
        };
    }
    if (segments.length === 4 && segments[2] === 'card') {
        const cardId = segments[3];
        return {
            tier: TIER_CARD,
            cellId,
            cardId,
            canonicalShortBranch: `cell/${cellId}/card/${cardId}/${FRACTAL_REF.CARD_CANONICAL_LEAF}`,
            isLegacyFourSegmentCard: true,
        };
    }
    if (segments.length === 6 && segments[2] === 'card' && segments[4] === 'sub') {
        const cardId = segments[3];
        const subagentId = segments[5];
        return {
            tier: TIER_SUB,
            cellId,
            cardId,
            subagentId,
            canonicalShortBranch: `cell/${cellId}/card/${cardId}/sub/${subagentId}`,
            isLegacyFourSegmentCard: false,
        };
    }
    return null;
}

/** Structurally parses a Git or fractal branch reference into 5-tier coordinates. */
export function parseFractalCoordinate(refName: string): ParsedFractalCoordinate | null {
    const bare = stripRefPrefix(refName);
    if (!bare || bare.startsWith('/') || bare.endsWith('/') || bare.includes('//')) {
        return null;
    }
    if ((PROTECTED_SYSTEM_TRUNKS as readonly string[]).includes(bare)) {
        return { tier: TIER_SYSTEM_TRUNK, canonicalShortBranch: bare, isLegacyFourSegmentCard: false };
    }
    if (bare === 'integration' || bare === 'trunk') {
        return { tier: TIER_TRUNK, canonicalShortBranch: 'integration', isLegacyFourSegmentCard: false };
    }
    const segments = bare.split('/');
    const cellCoord = parseCellBranchSegments(segments);
    if (cellCoord) {
        return cellCoord;
    }
    if (segments.length === 3 && (FACADE_TYPES as readonly string[]).includes(segments[0])) {
        const cardId = `${segments[0]}-${segments[2]}`;
        return {
            tier: TIER_CARD,
            cellId: segments[1],
            cardId,
            canonicalShortBranch: `cell/${segments[1]}/card/${cardId}/${FRACTAL_REF.CARD_CANONICAL_LEAF}`,
            isLegacyFourSegmentCard: false,
        };
    }
    return null;
}

/** Derives the reference hierarchy tier using structural segment parsing. */
export function parseFractalTier(refName: string): FractalRefTier {
    const parsed = parseFractalCoordinate(refName);
    return parsed ? parsed.tier : TIER_TRUNK;
}
