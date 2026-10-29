/**
 * Module: Core Scoring — Confidence Model Asset
 * File Path: src/core/scoring/confidence-model-asset.ts
 * Architecture Role: Versioning and provenance for the adjudication model. A confidence score is
 *   only auditable if the report that carries it names the exact evidence and thresholds that
 *   produced it; without that, two reports disagreeing about the same finding are indistinguishable
 *   from a regression and a model change.
 * Dependencies & Triggers: consumes the calibration corpus statistics and the arbiter's tier
 *   thresholds; called by the arbitration pass to stamp provenance and by the offline training
 *   exporter to snapshot the deployed model.
 * Responsibilities:
 *   1. Describe the deployed model as one canonical, digest-carrying document.
 *   2. Derive the digest from the model's own content, so a changed threshold or count cannot
 *      keep the previous version tag.
 *   3. Keep the description backend-agnostic: it records thresholds and outcomes, never the name
 *      of a specific analyzer family.
 * Exit Semantics & Design Rationale: Pure and total; no I/O, no clock reads, never throws. The
 *   document carries `version` independently of `digest` on purpose — the version states which
 *   schema and which calibration semantics are in force, the digest states which evidence — so a
 *   consumer can tell "same rules, new evidence" from "new rules".
 */

import { sha256Hex } from '../cache-key';
import { fingerprintCorpus } from './calibration-corpus';
import type { RuleCalibrationStats } from './confidence-calibration';
import {
    CALIBRATION_SHRINKAGE_ANCHOR,
    DEFAULT_CALIBRATION_BIN_COUNT,
    JEFFREYS_PRIOR,
} from './confidence-calibration';

/** Schema version of the model asset document itself. */
export const CONFIDENCE_MODEL_SCHEMA_VERSION = 'confidence-model/v1';

/** Fixed tier thresholds the deployed arbor applies, recorded so a report can be re-read later. */
export interface ConfidenceModelThresholds {
    /** Observation count at which the posterior and the analyzer's own score weigh equally. */
    readonly shrinkageAnchor: number;
    /** Jeffreys prior mass added to each outcome count. */
    readonly jeffreysPrior: number;
    /** Equal-width bins used by the expected calibration error. */
    readonly calibrationBinCount: number;
    /** Rule id to tier map the report was judged with, when one was supplied. */
    readonly ruleTiers?: Readonly<Record<string, string>>;
}

/** One deployed model version, as written to disk or embedded in a report. */
export interface ConfidenceModelAsset {
    /** Schema tag of the document. */
    readonly schema: typeof CONFIDENCE_MODEL_SCHEMA_VERSION;
    /** Digest over the evidence and thresholds below; changes whenever either changes. */
    readonly digest: string;
    /** Number of rules carrying observed outcomes. */
    readonly calibratedRuleCount: number;
    /** Total observations behind every rule, the sample size of the whole model. */
    readonly observationCount: number;
    /** Per-rule outcome counts, sorted by rule id so the document is canonical. */
    readonly rules: readonly RuleCalibrationStats[];
    /** Thresholds in force when this model was deployed. */
    readonly thresholds: ConfidenceModelThresholds;
}

/**
 * Computes the digest that identifies one model state.
 *
 * Built from the sorted rules and every threshold, not from the serialized document: a field
 * added to the document must not silently change the identity of models that are otherwise
 * identical, and a threshold change must change it even though no rule did.
 *
 * @param rules - Accepted per-rule statistics, in any order.
 * @param thresholds - Thresholds in force.
 * @returns 16-character digest of the model state.
 */
function computeModelDigest(
    rules: readonly RuleCalibrationStats[],
    thresholds: ConfidenceModelThresholds,
): string {
    const tierEntries = Object.entries(thresholds.ruleTiers ?? {}).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
    );
    const canonical = [
        `anchor=${thresholds.shrinkageAnchor}`,
        `prior=${thresholds.jeffreysPrior}`,
        `bins=${thresholds.calibrationBinCount}`,
        `corpus=${fingerprintCorpus(rules)}`,
        ...tierEntries.map(([rule, tier]) => `${rule}=${tier}`),
    ].join('\n');
    return sha256Hex(canonical).slice(0, 16);
}

/**
 * Describes the deployed adjudication model.
 *
 * @param stats - Per-rule outcome counts actually used for arbitration.
 * @param thresholds - Thresholds in force; omitted fields fall back to the module constants.
 * @returns Canonical, digest-carrying model description.
 */
export function buildConfidenceModelAsset(
    stats: readonly RuleCalibrationStats[],
    thresholds: Partial<ConfidenceModelThresholds> = {},
): ConfidenceModelAsset {
    const resolved: ConfidenceModelThresholds = {
        shrinkageAnchor: thresholds.shrinkageAnchor ?? CALIBRATION_SHRINKAGE_ANCHOR,
        jeffreysPrior: thresholds.jeffreysPrior ?? JEFFREYS_PRIOR,
        calibrationBinCount: thresholds.calibrationBinCount ?? DEFAULT_CALIBRATION_BIN_COUNT,
        ...(thresholds.ruleTiers ? { ruleTiers: thresholds.ruleTiers } : {}),
    };
    const rules = [...stats].sort((left, right) =>
        left.rule < right.rule ? -1 : left.rule > right.rule ? 1 : 0,
    );
    let observationCount = 0;
    for (const entry of rules) {
        observationCount += entry.truePositives + entry.falsePositives;
    }
    return {
        schema: CONFIDENCE_MODEL_SCHEMA_VERSION,
        digest: computeModelDigest(rules, resolved),
        calibratedRuleCount: rules.length,
        observationCount,
        rules,
        thresholds: resolved,
    };
}

/**
 * Reports whether two model assets describe the same deployed model.
 *
 * Used to decide whether a stored calibration artifact is still current: comparing schemas alone
 * would call every v1 model identical, and comparing digests alone would reject a document that
 * was merely re-serialized.
 *
 * @param left - First asset, or undefined when no model was deployed.
 * @param right - Second asset, or undefined.
 * @returns True when both exist and share a schema and digest.
 */
export function isSameConfidenceModel(
    left: ConfidenceModelAsset | undefined,
    right: ConfidenceModelAsset | undefined,
): boolean {
    if (!left || !right) return false;
    return left.schema === right.schema && left.digest === right.digest;
}
