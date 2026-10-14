/**
 * Module: Core Scoring — 4D Elastic Compatibility Arbiter
 * File Path: src/core/scoring/elastic-compatibility-arbiter.ts
 * Architecture Role: Evaluates compatibility boundaries, fan-in thresholds, sunset schedules,
 *   and physical location traits (perimeter vs hotpath) to calculate dynamic severity and
 *   penalty multipliers for backward compatibility shims, fallback chains, and deprecated usages.
 * Dependencies & Triggers: Consumes Severity from ../types; invoked by backwardShimRule,
 *   fallback-chain-matcher, and deprecated-usage-visitor during AST analysis.
 * Responsibilities:
 *   1. Evaluate Fan-In elasticity (leaf <=1: error 1.0; internal 2..4: warn 0.6; public >=5);
 *   2. Enforce sunset retirement deadlines (expired: error 2.0; transition: info/warn 0.2~0.5);
 *   3. Enforce physical location invariants (perimeter relaxed; hotpath vetoes as error 2.0);
 *   4. Zero transient heap allocation in high-frequency scoring paths with flat control flow.
 * Exit Semantics & Design Rationale: Pure, deterministic function; returns
 *   structured ElasticEvaluationResult with quantified severity, penalty multiplier,
 *   envelope category, and technical rationale.
 */

import type { Severity } from '../types';
import { SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR } from '../types';

/**
 * Input evaluation context for the 4D elastic compatibility arbiter.
 */
export interface ElasticContext {
    /** Fan-in invocation count or dependent callers count */
    fanIn: number;
    /**
     * Whether symbol is located at the architectural perimeter (API entrypoint, adapter, gateway)
     */
    isPerimeter?: boolean;
    /** Whether symbol is located in core business domain or performance hotpath */
    isHotPath?: boolean;
    /** Current version of the system/module, e.g. '1.2.0' */
    currentVersion?: string;
    /** Explicit sunset version declared for deprecation retirement, e.g. '2.0.0' */
    sunsetVersion?: string;
    /** Optional rule identifier being evaluated */
    ruleId?: string;
    /** Optional symbol or function identifier */
    symbolName?: string;
}

/**
 * Category envelope classification for compatibility lifecycle.
 */
export type ElasticEnvelopeType =
    'private_leaf' | 'internal_shared' | 'public_api' | 'hotpath_violation' | 'perimeter_relaxed';

/**
 * Quantified arbitration verdict returned by the elastic arbiter.
 */
export interface ElasticEvaluationResult {
    /** Evaluated severity level: 'info' | 'warning' | 'error' */
    severity: Severity;
    /** Multiplier applied to dimension score deduction (0.0 ~ 2.0+) */
    penaltyMultiplier: number;
    /** Envelope classification */
    envelope: ElasticEnvelopeType;
    /** Human-readable technical justification for the arbiter decision */
    rationale: string;
    /** Version distance until sunset retirement (null if no sunset specified) */
    versionsUntilSunset: number | null;
}

/**
 * Fast SemVer parser returning [major, minor, patch] tuple or null if unparseable.
 *
 * @param v - Version string to parse.
 * @returns 3-tuple of integers or null.
 */
function parseSemVer(v: string | undefined): [number, number, number] | null {
    if (!v) return null;
    const clean = v.charCodeAt(0) === 118 || v.charCodeAt(0) === 86 ? v.slice(1) : v;
    const parts = clean.split('.');
    if (parts.length === 0) return null;
    const major = parseInt(parts[0], 10);
    const minor = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    const patch = parts.length > 2 ? parseInt(parts[2], 10) : 0;
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) return null;
    return [major, minor, patch];
}

/**
 * Calculates version difference (sunset - current) in terms of release distance.
 *
 * @param current - Current system version tuple.
 * @param sunset - Scheduled sunset version tuple.
 * @returns Positive if future, negative if expired, zero if identical.
 */
function calculateVersionDistance(
    current: [number, number, number],
    sunset: [number, number, number],
): number {
    const majorDiff = sunset[0] - current[0];
    if (majorDiff !== 0) return majorDiff;
    const minorDiff = sunset[1] - current[1];
    if (minorDiff !== 0) return minorDiff;
    return sunset[2] - current[2] > 0 ? 0.1 : sunset[2] < current[2] ? -0.1 : 0;
}

/**
 * Evaluates the 4D elastic compatibility envelope for a given symbol context.
 *
 * @param context - The invocation context containing fan-in, location flags, and versioning.
 * @returns Structured arbitration verdict with severity, multiplier, envelope, and rationale.
 */
export function evaluateElasticEnvelope(context: ElasticContext): ElasticEvaluationResult {
    const {
        fanIn,
        isPerimeter = false,
        isHotPath = false,
        currentVersion,
        sunsetVersion,
    } = context;

    // 1. Hotpath one-vote veto: any compatibility shim or fallback cascade
    // on hotpath is strictly error
    if (isHotPath) {
        return {
            severity: SEVERITY_ERROR,
            penaltyMultiplier: 2.0,
            envelope: 'hotpath_violation',
            rationale:
                'Hotpath performance barrier: backward compatibility shim or fallback cascade on critical execution path is vetoed as error.',
            versionsUntilSunset: null,
        };
    }

    // 2. Private leaf (Fan-in <= 1): absolute zero elasticity
    if (fanIn <= 1) {
        if (isPerimeter) {
            return {
                severity: SEVERITY_WARNING,
                penaltyMultiplier: 0.5,
                envelope: 'perimeter_relaxed',
                rationale:
                    'Perimeter private leaf allows transitional accommodation with softened penalty.',
                versionsUntilSunset: null,
            };
        }
        return {
            severity: SEVERITY_ERROR,
            penaltyMultiplier: 1.0,
            envelope: 'private_leaf',
            rationale: 'Private leaf symbol with fanIn <= 1 has zero compatibility elasticity.',
            versionsUntilSunset: null,
        };
    }

    // 3. Internal shared (2 <= Fan-in <= 4): single version grace
    if (fanIn <= 4) {
        if (isPerimeter) {
            return {
                severity: SEVERITY_INFO,
                penaltyMultiplier: 0.3,
                envelope: 'perimeter_relaxed',
                rationale: 'Perimeter internal shared symbol grants relaxed transition tolerance.',
                versionsUntilSunset: null,
            };
        }
        return {
            severity: SEVERITY_WARNING,
            penaltyMultiplier: 0.6,
            envelope: 'internal_shared',
            rationale: 'Internal shared symbol (fanIn 2..4) grants single-version grace period.',
            versionsUntilSunset: null,
        };
    }

    // 4. Public interface (Fan-in >= 5)
    const curSem = parseSemVer(currentVersion);
    const sunSem = parseSemVer(sunsetVersion);

    // Missing sunset schedule on public API triggers escalation to error
    if (!sunSem) {
        return {
            severity: SEVERITY_ERROR,
            penaltyMultiplier: 2.0,
            envelope: 'public_api',
            rationale: 'Public API symbol (fanIn >= 5) lacks required sunset deprecation schedule.',
            versionsUntilSunset: null,
        };
    }

    if (!curSem) {
        return {
            severity: SEVERITY_WARNING,
            penaltyMultiplier: 0.5,
            envelope: 'public_api',
            rationale:
                'Public API symbol has sunset schedule but current system version is unverified.',
            versionsUntilSunset: 1,
        };
    }

    const dist = calculateVersionDistance(curSem, sunSem);

    // Sunset expired: currentVersion >= sunsetVersion (dist <= 0)
    if (dist <= 0) {
        return {
            severity: SEVERITY_ERROR,
            penaltyMultiplier: 2.0,
            envelope: 'public_api',
            rationale: `Public API deprecation has expired past scheduled sunset version (${sunsetVersion} <= ${currentVersion}).`,
            versionsUntilSunset: dist,
        };
    }

    // Compliant transition window (dist >= 2 versions)
    if (dist >= 2) {
        return {
            severity: SEVERITY_INFO,
            penaltyMultiplier: isPerimeter ? 0.2 : 0.3,
            envelope: isPerimeter ? 'perimeter_relaxed' : 'public_api',
            rationale: `Public API deprecation is within compliant transition window (${dist} versions until sunset ${sunsetVersion}).`,
            versionsUntilSunset: dist,
        };
    }

    // Approaching sunset (dist == 1 version)
    return {
        severity: isPerimeter ? SEVERITY_INFO : SEVERITY_WARNING,
        penaltyMultiplier: isPerimeter ? 0.3 : 0.5,
        envelope: isPerimeter ? 'perimeter_relaxed' : 'public_api',
        rationale: `Public API deprecation is approaching sunset version (${dist} version until sunset ${sunsetVersion}).`,
        versionsUntilSunset: dist,
    };
}
