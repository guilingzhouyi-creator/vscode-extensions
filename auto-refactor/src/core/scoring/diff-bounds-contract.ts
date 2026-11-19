/**
 * Module: Core Scoring — Differential Semantic Bounds Contract Loader
 * File Path: src/core/scoring/diff-bounds-contract.ts
 * Architecture Role: Loads and validates the SSOT differential bounds JSON contract
 *   (`scripts/common/diff-bounds-contract.json`), providing fail-closed shape validation
 *   and packaged-build fallback defaults without circular module dependencies.
 * Dependencies & Triggers: Consumes Node.js fs/path; imported as a pure leaf by
 *   diff-bounds-governor and diff-bounds-batch.
 * Responsibilities:
 *   1. Define the canonical DiffBoundsContractShape and DEFAULT_DIFF_BOUNDS_CONTRACT;
 *   2. Recursively validate loaded JSON fields against DEFAULT_DIFF_BOUNDS_CONTRACT;
 *   3. Export the resolved DIFF_BOUNDS_CONTRACT singleton for scoring modules.
 * Exit Semantics & Design Rationale: Leaf module with zero upstream scoring imports;
 *   prevents circular ESM initialization hazards; CC <= 15; max-len <= 100.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DiffBoundsContractShape {
    readonly fileAddBands: {
        readonly newFile: { readonly ceiling: number };
        readonly existingFile: { readonly ceiling: number };
        readonly refactorWitness: { readonly ceiling: number };
    };
    readonly testFileAddBands: {
        readonly newFile: { readonly ceiling: number };
        readonly existingFile: { readonly ceiling: number };
        readonly refactorWitness: { readonly ceiling: number };
    };
    readonly fileDelBands: {
        readonly plain: { readonly ceiling: number };
        readonly witnessed: { readonly ceiling: number };
    };
    readonly expansionPolicy: {
        readonly defaultFileLocBudget: number;
        readonly minExpansionAllowanceLoc: number;
        readonly maxExpansionLocRatio: number;
        readonly minDeletionAllowanceLoc: number;
        readonly maxDeletionFractionErosion: number;
        readonly refactorWitnessMinDelEloc: number;
        readonly witnessCoverageRatio: number;
        readonly crossFileRefactorMinDelEloc: number;
        readonly crossFileRefactorDelRatio: number;
    };
    readonly densityBands: {
        readonly minPhysAddSampleWidth: number;
        readonly substantiveRatio: { readonly floor: number; readonly target: number };
        readonly tspr: { readonly target: number };
        readonly tsprVouchForDensity: number;
    };
    readonly batchBands: {
        readonly add: { readonly ceiling: number };
        readonly del: { readonly ceiling: number };
        readonly refactorWitnessAddCeiling: number;
        readonly deletionTurnoverWeight: number;
        readonly testBatchWeight: number;
    };
    readonly empiricalAdmission: {
        readonly turnoverFloor: number;
        readonly turnoverCap: number;
        readonly minTrajectorySamples: number;
        readonly trajectoryWindowSize: number;
        readonly jeffreysPriorAlpha: number;
        readonly jeffreysPriorBeta: number;
        readonly jeffreysDefaultPosterior: number;
        readonly stdDevDiscountFactor: number;
        readonly maxNoiseCeiling: number;
    };
    readonly ledgers: {
        readonly taxisRelative: string;
        readonly taxisLegacyRelative: string;
        readonly autoRefactorRelative: string;
    };
}

export const DEFAULT_DIFF_BOUNDS_CONTRACT: DiffBoundsContractShape = {
    fileAddBands: {
        newFile: { ceiling: 240 },
        existingFile: { ceiling: 180 },
        refactorWitness: { ceiling: 260 },
    },
    testFileAddBands: {
        newFile: { ceiling: 360 },
        existingFile: { ceiling: 260 },
        refactorWitness: { ceiling: 380 },
    },
    fileDelBands: {
        plain: { ceiling: 120 },
        witnessed: { ceiling: 360 },
    },
    expansionPolicy: {
        defaultFileLocBudget: 900,
        minExpansionAllowanceLoc: 60,
        maxExpansionLocRatio: 0.35,
        minDeletionAllowanceLoc: 10,
        maxDeletionFractionErosion: 0.4,
        refactorWitnessMinDelEloc: 10,
        witnessCoverageRatio: 0.7,
        crossFileRefactorMinDelEloc: 30,
        crossFileRefactorDelRatio: 0.6,
    },
    densityBands: {
        minPhysAddSampleWidth: 10,
        substantiveRatio: { floor: 0.45, target: 0.6 },
        tspr: { target: 0.4 },
        tsprVouchForDensity: 0.85,
    },
    batchBands: {
        add: { ceiling: 540 },
        del: { ceiling: 360 },
        refactorWitnessAddCeiling: 720,
        deletionTurnoverWeight: 0.8,
        testBatchWeight: 0.5,
    },
    empiricalAdmission: {
        turnoverFloor: 3.0,
        turnoverCap: 25.0,
        minTrajectorySamples: 3,
        trajectoryWindowSize: 20,
        jeffreysPriorAlpha: 0.5,
        jeffreysPriorBeta: 0.5,
        jeffreysDefaultPosterior: 0.5,
        stdDevDiscountFactor: 0.5,
        maxNoiseCeiling: 4.0,
    },
    ledgers: {
        taxisRelative: '.taxis/telemetry/admission_ledger.ndjson',
        taxisLegacyRelative: '.git/telemetry/admission_ledger.ndjson',
        autoRefactorRelative: '.auto-refactor-cache/admission-turnover-ledger.ndjson',
    },
};

/**
 * Validates every required contract leaf before exposing numeric parameters to governance.
 *
 * @param value - Parsed candidate contract subtree or leaf.
 * @param expected - Reference default subtree or leaf defining shape and type.
 * @returns True when every required leaf satisfies type and range invariants.
 */
export function matchesContractShape(value: unknown, expected: unknown): boolean {
    if (typeof expected === 'number') {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    }
    if (typeof expected === 'string') {
        return typeof value === 'string' && value.trim().length > 0;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const fields = value as Record<string, unknown>;
    for (const [key, expectedField] of Object.entries(expected as Record<string, unknown>)) {
        if (!matchesContractShape(fields[key], expectedField)) return false;
    }
    return true;
}

const readUtf8Sync = fs['readFileSync'];

/**
 * Loads and validates `scripts/common/diff-bounds-contract.json`, falling back when unbundled.
 *
 * @returns Validated differential bounds contract configuration.
 */
export function loadDiffBoundsContract(): DiffBoundsContractShape {
    const candidatePaths = [
        path.resolve(__dirname, '../../../../scripts/common/diff-bounds-contract.json'),
        path.resolve(__dirname, '../../../../../scripts/common/diff-bounds-contract.json'),
        path.resolve(process.cwd(), 'scripts/common/diff-bounds-contract.json'),
        path.resolve(process.cwd(), '../scripts/common/diff-bounds-contract.json'),
    ];
    const resolvedPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
    if (!resolvedPath) return DEFAULT_DIFF_BOUNDS_CONTRACT;

    const raw = readUtf8Sync(resolvedPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!matchesContractShape(parsed, DEFAULT_DIFF_BOUNDS_CONTRACT)) {
        throw new Error('Differential bounds contract has invalid or missing fields.');
    }
    return parsed as DiffBoundsContractShape;
}

/** Loaded differential bounds contract governing commit and diff density budgets. */
export const DIFF_BOUNDS_CONTRACT: DiffBoundsContractShape = loadDiffBoundsContract();
