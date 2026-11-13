/**
 * Module: Fractal Git — Cascading Child Branch Derivation
 * File Path: ts/cli/branch-derivation.ts
 * Architecture Role: Synthesizes D/F-safe canonical child branches strictly from parent tiers.
 * Dependencies & Triggers: Consumes `../constants` and `./branch-parser`; re-exported via `commands.ts`.
 * Responsibilities: Enforce parent->child tier rules, cell whitelist checks, and forbidden scratch blocks.
 * Exit Semantics & Design Rationale: Throws descriptive errors on invalid tiers or legacy 4-segment parents.
 */

import {
    FACADE_TYPES,
    FRACTAL_REF,
    MAX_BRANCH_SEGMENT_LEN,
    RECOGNIZED_CELLS,
} from '../constants';
import {
    hasForbiddenBranchPrefix,
    isValidKebabSegment,
    normalizeCellId,
    parseFractalCoordinate,
    TIER_CARD,
    TIER_CELL,
    TIER_SYSTEM_TRUNK,
    TIER_TRUNK,
} from './branch-parser';

function assertStrictSlug(role: string, value: string): string {
    const trimmed = value.trim();
    if (!isValidKebabSegment(trimmed)) {
        throw new Error(
            `${role} '${trimmed}' must use lowercase ASCII kebab-case (1..=${MAX_BRANCH_SEGMENT_LEN} bytes)`,
        );
    }
    if (hasForbiddenBranchPrefix(trimmed)) {
        throw new Error(`${role} '${trimmed}' uses a prohibited scratch prefix (temp/tmp/wip)`);
    }
    return trimmed;
}

function deriveFromSystemTrunk(childSlug: string, facadeType?: string): string {
    if (facadeType) {
        throw new Error('--facade <type> can only be used when deriving a card branch from cell/<cell>/main');
    }
    if (childSlug.trim() !== 'integration') {
        throw new Error("System trunk ('main'/'master') can only derive 'integration'");
    }
    return 'integration';
}

function deriveFromTrunk(childSlug: string, facadeType?: string): string {
    if (facadeType) {
        throw new Error('--facade <type> can only be used when deriving a card branch from cell/<cell>/main');
    }
    const normalized = normalizeCellId(assertStrictSlug('cell', childSlug));
    if (!(RECOGNIZED_CELLS as readonly string[]).includes(normalized)) {
        throw new Error(`Unrecognized domain cell '${normalized}'; allowed: ${RECOGNIZED_CELLS.join(', ')}`);
    }
    return `cell/${normalized}/main`;
}

function deriveFromCellMain(cellId: string, childSlug: string, facadeType?: string): string {
    const canonicalCell = normalizeCellId(assertStrictSlug('cell', cellId));
    if (!(RECOGNIZED_CELLS as readonly string[]).includes(canonicalCell)) {
        throw new Error(`Unrecognized domain cell '${canonicalCell}'`);
    }
    const cleanSlug = assertStrictSlug('card', childSlug);
    if (!facadeType) {
        return `cell/${canonicalCell}/card/${cleanSlug}/${FRACTAL_REF.CARD_CANONICAL_LEAF}`;
    }
    if (!(FACADE_TYPES as readonly string[]).includes(facadeType)) {
        throw new Error(`Unsupported facade type '${facadeType}'; allowed: ${FACADE_TYPES.join(', ')}`);
    }
    return `${facadeType}/${canonicalCell}/${cleanSlug}`;
}

/**
 * Deterministically synthesizes the canonical child branch name directly under `parentRef`.
 */
export function deriveChildBranch(
    parentRef: string,
    childSlug: string,
    facadeType?: string,
): string {
    const parent = parseFractalCoordinate(parentRef);
    if (!parent) {
        throw new Error(`Parent branch '${parentRef}' is not a valid fractal coordinate`);
    }
    if (parent.tier === TIER_SYSTEM_TRUNK) {
        return deriveFromSystemTrunk(childSlug, facadeType);
    }
    if (parent.tier === TIER_TRUNK) {
        return deriveFromTrunk(childSlug, facadeType);
    }
    if (parent.tier === TIER_CELL && parent.cellId) {
        return deriveFromCellMain(parent.cellId, childSlug, facadeType);
    }
    if (parent.tier === TIER_CARD && parent.cellId && parent.cardId) {
        if (facadeType) {
            throw new Error('--facade <type> cannot be used when deriving a Tier 4 subagent branch');
        }
        if (parent.isLegacyFourSegmentCard) {
            throw new Error(
                `Cannot derive subagent under D/F-colliding 4-segment card branch '${parentRef}'; migrate to '${parent.canonicalShortBranch}'`,
            );
        }
        const subSlug = assertStrictSlug('subagent', childSlug);
        return `cell/${parent.cellId}/card/${parent.cardId}/sub/${subSlug}`;
    }
    throw new Error(`Branch '${parentRef}' (tier ${parent.tier}) is a terminal leaf and cannot derive child branches`);
}
