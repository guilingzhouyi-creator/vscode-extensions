/**
 * Module: Core Scoring — Finding Tier Policy Resolution
 * File Path: src/core/scoring/finding-tier-policy.ts
 * Architecture Role: Owns the single decision that turns one finding into a tier, a confidence
 *   and a blocking verdict. Extracted from the arbiter facade so the arbiter can stay an
 *   orchestrator (suppression lookup, calibration lookup, slice pruning, batch aggregation) while
 *   the policy itself — which is the part reviewers argue about — lives in one auditable place.
 * Dependencies & Triggers: consumes ExecutablePatch, FindingConfidenceTier, RuleLifecycleState and
 *   the tier constants from ./finding-confidence-arbiter, plus CalibratedConfidence from
 *   ./confidence-calibration; consumed by FindingConfidenceArbiter.arbitrateFinding.
 * Responsibilities:
 *   1. Resolve the tier from prescriptive evidence, an executable patch, or neither.
 *   2. Apply the rule lifecycle (active/canary/experimental/quarantined/deprecated) to blocking
 *      authority, so revoking a block is always an explicit, auditable decision.
 *   3. Enforce the severity floor: an `error` claim on an active rule keeps blocking authority
 *      even when the tier rules would have downgraded it.
 *   4. Render a rationale that names the provenance of the confidence rather than only its value.
 * Exit Semantics & Design Rationale: Pure functions over value inputs; no I/O, no clock, no global
 *   state, so the same finding always resolves to the same tier. The severity floor is
 *   deliberately one-directional — it can restore blocking but never create it — because a policy
 *   that could escalate a warning into a block would turn tier inference into a second gate.
 */

import type { Issue } from '../types';
import type { CalibratedConfidence } from './confidence-calibration';
import type {
    ExecutablePatch,
    FindingConfidenceTier,
    RuleLifecycleState,
} from './finding-confidence-arbiter';
import {
    CONFIDENCE_ACTIONABLE_DEFAULT,
    CONFIDENCE_ACTIONABLE_FLOOR,
    CONFIDENCE_PRESCRIPTIVE,
    LIFECYCLE_ACTIVE,
    LIFECYCLE_CANARY,
    LIFECYCLE_DEPRECATED,
    LIFECYCLE_EXPERIMENTAL,
    LIFECYCLE_QUARANTINED,
    TIER_ACTIONABLE,
    TIER_ADVISORY,
    TIER_PRESCRIPTIVE,
} from './finding-confidence-arbiter';

/** Severity token an analyzer uses to claim a finding must not ship. */
const SEVERITY_ERROR_STR = 'error';

/**
 * Resolved policy for one finding: the tier, the score, and whether it blocks.
 */
export interface ArbitratedPolicy {
    /** Tier the finding was placed in. */
    tier: FindingConfidenceTier;
    /** Score in [0, 1] carrying the provenance described by `rationale`. */
    confidence: number;
    /** Whether this finding objects to the gate. */
    mustBlock: boolean;
    /** Mechanically applicable patch, when the tier is Actionable. */
    patch?: ExecutablePatch;
    /** Explanation naming both the decision and the evidence behind it. */
    rationale: string;
    /** True when an inline suppression expired and blocking was restored because of it. */
    isSuppressionExpired: boolean;
    /** True when a lifecycle state (not a tier rule) removed the blocking authority. */
    isQuarantined: boolean;
}

/** Minimal shape the policy needs from an inline-suppression evaluation. */
export interface SuppressionOutcome {
    /** Whether a directive silenced the finding. */
    isSuppressed: boolean;
    /** Whether a TTL-bounded directive has passed its expiry date. */
    isExpired?: boolean;
    /** Expiry date string, when bounded. */
    expiryDate?: string;
}

/** Result of matching a finding against the prescriptive rule set. */
export interface PrescriptiveMatch {
    /** Whether the finding qualifies as deterministic proof. */
    isMatch: boolean;
    /** Why it qualified. */
    rationale: string;
}

/** Tunables the policy resolves against; supplied by the arbiter's options. */
export interface TierPolicyOptions {
    /** Minimum confidence for the Actionable tier. */
    actionableConfidenceFloor: number;
    /** Baseline confidence for the Advisory tier. */
    advisoryConfidenceDefault: number;
}

/**
 * Resolves the policy for a finding whose inline suppression has expired.
 *
 * An expired suppression is an explicit governance signal: the reviewer asked for a temporary
 * waiver and the clock ran out, so blocking is restored at proof confidence regardless of what
 * the tier rules would otherwise say.
 *
 * @param patch - Executable patch attached to the finding, if any.
 * @param suppression - Suppression outcome carrying the expiry date.
 * @returns Policy with blocking restored.
 */
export function resolveExpiredSuppressionPolicy(
    patch: ExecutablePatch | undefined,
    suppression: SuppressionOutcome,
): ArbitratedPolicy {
    return {
        tier: TIER_PRESCRIPTIVE,
        confidence: CONFIDENCE_PRESCRIPTIVE,
        mustBlock: true,
        rationale: `[SUPPRESSION EXPIRED: Inlined suppression expired on ${suppression.expiryDate}. Immediate remediation required.]`,
        ...(patch ? { patch } : {}),
        isSuppressionExpired: true,
        isQuarantined: false,
    };
}

/**
 * Applies a rule lifecycle state to a prescriptive match.
 *
 * Each state answers one question: may this rule still block? `quarantined` and `deprecated` say
 * no outright; `canary` and `experimental` say "report it, do not act on it yet". The distinction
 * is carried in the rationale so a reader can tell a trial rule from a withdrawn one.
 *
 * @param lifecycleState - State recorded for the rule.
 * @param prescriptive - Prescriptive match result.
 * @param patch - Executable patch attached to the finding, if any.
 * @param options - Confidence tunables.
 * @returns Policy honouring the lifecycle state.
 */
function applyLifecycle(
    lifecycleState: RuleLifecycleState,
    prescriptive: PrescriptiveMatch,
    patch: ExecutablePatch | undefined,
    options: TierPolicyOptions,
): ArbitratedPolicy {
    const nonBlockingTier = patch ? TIER_ACTIONABLE : TIER_ADVISORY;
    const nonBlockingConfidence = patch
        ? options.actionableConfidenceFloor
        : options.advisoryConfidenceDefault;

    if (lifecycleState === LIFECYCLE_QUARANTINED) {
        return {
            tier: nonBlockingTier,
            confidence: nonBlockingConfidence,
            mustBlock: false,
            rationale: `[TRICORDER QUARANTINE: Rule is quarantined due to elevated developer suppression ratio; prescriptive blocking revoked] ${prescriptive.rationale}`,
            isSuppressionExpired: false,
            isQuarantined: true,
            ...(patch ? { patch } : {}),
        };
    }

    if (lifecycleState === LIFECYCLE_DEPRECATED) {
        return {
            tier: nonBlockingTier,
            confidence: nonBlockingConfidence,
            mustBlock: false,
            rationale: `[DEPRECATED RULE: Rule scheduled for deprecation; prescriptive blocking disabled] ${prescriptive.rationale}`,
            isSuppressionExpired: false,
            isQuarantined: true,
            ...(patch ? { patch } : {}),
        };
    }

    if (lifecycleState === LIFECYCLE_CANARY || lifecycleState === LIFECYCLE_EXPERIMENTAL) {
        return {
            tier: nonBlockingTier,
            confidence: nonBlockingConfidence,
            mustBlock: false,
            rationale: `[${lifecycleState.toUpperCase()} RULE: Non-blocking trial evaluation] ${prescriptive.rationale}`,
            isSuppressionExpired: false,
            isQuarantined: true,
            ...(patch ? { patch } : {}),
        };
    }

    return {
        tier: TIER_PRESCRIPTIVE,
        confidence: CONFIDENCE_PRESCRIPTIVE,
        mustBlock: true,
        rationale: prescriptive.rationale,
        isSuppressionExpired: false,
        isQuarantined: false,
        ...(patch ? { patch } : {}),
    };
}

/**
 * Resolves the policy for a finding that matched the prescriptive rule set.
 *
 * @param prescriptive - Prescriptive match result.
 * @param lifecycleState - State recorded for the rule.
 * @param patch - Executable patch attached to the finding, if any.
 * @param options - Confidence tunables.
 * @returns Policy honouring both the match and the lifecycle state.
 */
export function resolvePrescriptivePolicy(
    prescriptive: PrescriptiveMatch,
    lifecycleState: RuleLifecycleState,
    patch: ExecutablePatch | undefined,
    options: TierPolicyOptions,
): ArbitratedPolicy {
    return applyLifecycle(lifecycleState, prescriptive, patch, options);
}

/**
 * Resolves the policy for a finding with no prescriptive evidence.
 *
 * Two questions decide the outcome. Does it carry a patch — that is, can a machine settle it
 * without judgement? And what does the calibration posterior say about the rule? A patched finding
 * lands in Actionable bounded by `[floor, ceiling]`; an unpatched one lands in Advisory below the
 * actionable floor. Both bounds matter: the ceiling stops an unobserved rule from claiming
 * certainty, and the advisory cap stops an advisory finding from outranking a fixable one.
 *
 * The floor applies only while the rule is unobserved, and that asymmetry is the whole point of
 * calibration. A floor is a stand-in for missing evidence — "we know nothing, so assume the fix is
 * usable". Once a posterior says the fix is mostly rejected, holding it at the floor would make
 * rejections unable to demote anything, which is the reverse of what a posterior is for. So a
 * patch attached to a rule the evidence rejects lands in Advisory with that evidence's own number,
 * and the patch travels with it so a reviewer still sees the proposed fix.
 *
 * @param patch - Executable patch attached to the finding, if any.
 * @param calibrated - Calibration record for the rule, when observed.
 * @param options - Confidence tunables.
 * @returns Policy for the Actionable or Advisory tier.
 */
export function resolveActionableOrAdvisoryPolicy(
    patch: ExecutablePatch | undefined,
    calibrated: CalibratedConfidence | undefined,
    options: TierPolicyOptions,
): ArbitratedPolicy {
    const observed = calibrated?.calibrated;
    if (patch && (observed === undefined || observed >= options.actionableConfidenceFloor)) {
        const bounded = Math.min(
            CONFIDENCE_ACTIONABLE_DEFAULT,
            observed ?? options.actionableConfidenceFloor,
        );
        return {
            tier: TIER_ACTIONABLE,
            confidence: Math.max(options.actionableConfidenceFloor, bounded),
            mustBlock: false,
            rationale: patchRationale(calibrated),
            patch,
            isSuppressionExpired: false,
            isQuarantined: false,
        };
    }
    return {
        tier: TIER_ADVISORY,
        confidence: Math.min(
            CONFIDENCE_ACTIONABLE_FLOOR - 0.01,
            observed ?? options.advisoryConfidenceDefault,
        ),
        mustBlock: false,
        rationale: patch ? rejectedPatchRationale(calibrated) : advisoryRationale(calibrated),
        ...(patch ? { patch } : {}),
        isSuppressionExpired: false,
        isQuarantined: false,
    };
}

/**
 * Enforces the severity floor over a resolved policy.
 *
 * Severity and tier answer different questions: severity is the analyzer's claim about loudness,
 * tier is the arbiter's verdict about usability, and this guard refuses to let the second silently
 * overrule the first. Revoking a blocking claim is a governance act that must travel the explicit,
 * auditable lifecycle path; inferring it from "no patch was attached" would let any
 * over-matching error rule go quiet, which is how a volume ceiling becomes decorative.
 *
 * Two outcomes, both informative. On an active rule the block is restored at proof confidence. On
 * a revoked lifecycle the block stays lifted but `isQuarantined` is set, so a consumer can tell
 * "the arbiter downgraded this" from "governance withdrew the rule's authority" — only the second
 * is a decision somebody signed off on.
 *
 * The guard is one-directional: it can restore blocking, never create it, so a warning-severity
 * advisory is untouched.
 *
 * @param policy - Verdict resolved from the tier rules.
 * @param issue - Finding being arbitrated.
 * @param lifecycleState - Rule lifecycle state gating the blocking authority.
 * @returns The original policy, or an annotated copy when an error claim was involved.
 */
export function enforceSeverityFloor(
    policy: ArbitratedPolicy,
    issue: Issue,
    lifecycleState: RuleLifecycleState,
): ArbitratedPolicy {
    if (policy.mustBlock) return policy;
    if (issue.severity !== SEVERITY_ERROR_STR) return policy;
    if (lifecycleState !== LIFECYCLE_ACTIVE) {
        return {
            ...policy,
            isQuarantined: true,
            rationale: `[LIFECYCLE ${lifecycleState.toUpperCase()}: blocking authority revoked, error severity retained for visibility] ${policy.rationale}`,
        };
    }
    return {
        ...policy,
        tier: TIER_PRESCRIPTIVE,
        confidence: CONFIDENCE_PRESCRIPTIVE,
        mustBlock: true,
        isQuarantined: false,
        rationale: `[SEVERITY FLOOR: analyzer reported error on an active rule; blocking authority retained] ${policy.rationale}`,
    };
}

/**
 * Renders the rationale for an Actionable finding.
 *
 * The text names the provenance so a reader cannot mistake an unverified self-report for an
 * adjudicated score — the distinction is the whole point of the calibration module.
 *
 * @param calibrated - Calibration record, when the rule has been observed.
 * @returns Rationale string.
 */
function patchRationale(calibrated?: CalibratedConfidence): string {
    if (!calibrated || calibrated.sampleSize === 0) {
        return 'Actionable finding with deterministic patch; rule uncalibrated, confidence held at the actionable floor';
    }
    return `Actionable finding with deterministic patch; confidence calibrated over ${calibrated.sampleSize} observations`;
}

/**
 * Renders the rationale for an Advisory finding.
 *
 * @param calibrated - Calibration record, when the rule has been observed.
 * @returns Rationale string.
 */
function advisoryRationale(calibrated?: CalibratedConfidence): string {
    if (!calibrated || calibrated.sampleSize === 0) {
        return 'Advisory suggestion; rule uncalibrated, no outcome evidence yet';
    }
    return `Advisory suggestion; confidence calibrated over ${calibrated.sampleSize} observations`;
}

/**
 * Renders the rationale for a finding whose patch was demoted by its own evidence.
 *
 * Kept distinct from the plain advisory rationale because the two call for different actions: a
 * plain advisory is "consider this", while this one is "we have a fix and the record says the fix
 * is usually wrong". A reader who saw the plain wording would apply the patch.
 *
 * @param calibrated - Calibration record for the rule.
 * @returns Rationale naming the demotion and its sample size.
 */
function rejectedPatchRationale(calibrated?: CalibratedConfidence): string {
    const samples = calibrated?.sampleSize ?? 0;
    return (
        `Patch withheld from the Actionable tier: the rule's observed outcomes put confidence ` +
        `below the actionable floor over ${samples} observations`
    );
}
