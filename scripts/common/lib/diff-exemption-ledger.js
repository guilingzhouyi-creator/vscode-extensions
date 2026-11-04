/**
 * Module: Governance Guard — Staged Differential Exemption Ledger
 * File Path: scripts/common/lib/diff-exemption-ledger.js
 * Architecture Role: Durable record of consecutive failures per identifier and of granted
 *   exemptions, so a repeated block can be told apart from a stalled one and a grant can be audited.
 * Dependencies & Triggers: Node fs/path and diff-bounds-policy.js; consumed by
 *   gate-differential-bounds.js and by validate-diff-exemption.js.
 * Responsibilities:
 *   1. Accumulate a per-identifier streak for each violation type across gate runs.
 *   2. Clear a streak when its identifier stops failing, so history cannot accumulate permanently.
 *   3. Grant an exemption only when every eligibility clause holds, and record the grant.
 *   4. Refuse a second grant for the same identifier and a grant beyond the per-batch quota.
 * Exit Semantics & Design Rationale: Every filesystem touch is fail-soft — an unreadable ledger is
 *   treated as empty and a failed write degrades to a no-grant rather than an exception, because a
 *   bookkeeping fault must never turn into a false pass. Streaks live in the ignored audit area
 *   because they describe local retry history; grants live in a tracked file because "no record
 *   means no exemption" only holds if the record travels with the commit it exempts. Each grant is
 *   stored with the measurement that justified it, so an auditor can recompute the decision.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
    EXEMPTION_POLICY,
    SUBSTANTIVE_RATIO_BAND,
    isNonExemptible,
} = require('./diff-bounds-policy');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_LEDGER_PATHS = Object.freeze({
    streakFile: path.join(REPO_ROOT, '.audit-logs', 'diff-streaks.json'),
    exemptionFile: path.join(REPO_ROOT, 'scripts', 'common', 'diff-exemptions.json'),
});
const ENCODING_UTF8 = 'utf8';
const EXEMPTION_SCHEMA_VERSION = 1;

/**
 * Exemption outcome discriminators.
 *
 * `GRANT_REUSED` distinguishes a live grant from a fresh one so the operator can see that the
 * identifier was already accepted rather than newly accepted, and `GRANT_EXHAUSTED` distinguishes a
 * spent grant whose measurement no longer clears the relaxed line from one that was never granted.
 */
const GRANT_GRANTED = 'granted';
const GRANT_REUSED = 'reused';
const GRANT_EXHAUSTED = 'exhausted';
const GRANT_QUOTA_EXHAUSTED = 'quota-exhausted';
const GRANT_INELIGIBLE = 'ineligible';

/**
 * Reads a JSON ledger, treating any unreadable state as empty.
 *
 * @param filePath - Ledger path.
 * @param fallback - Value used when the file is missing or malformed.
 * @returns Parsed ledger or the fallback.
 */
function readLedger(filePath, fallback) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, ENCODING_UTF8));
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Writes a ledger atomically, ignoring any failure.
 *
 * @param filePath - Ledger path.
 * @param value - Value to persist.
 * @returns True when the write landed.
 */
function writeLedger(filePath, value) {
    const staging = `${filePath}.tmp-${process.pid}`;
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`, ENCODING_UTF8);
        fs.renameSync(staging, filePath);
        return true;
    } catch {
        try {
            fs.rmSync(staging, { force: true });
        } catch {
            /* staging cleanup is best-effort; the original ledger is untouched */
        }
        return false;
    }
}

/**
 * Builds the streak key that scopes a counter to one identifier and one violation type.
 *
 * @param filePath - Repository-relative file path, or '.' for a batch-scoped identifier.
 * @param violationType - Violation discriminator.
 * @returns Stable ledger key.
 */
function streakKey(filePath, violationType) {
    return `${filePath}::${violationType}`;
}

/**
 * Resolves the band an exemption request is measured against.
 *
 * Only a target deficit has one. A floor breach on either band means the content is invalid, which
 * is answered by writing real code rather than by moving a threshold, so returning null for every
 * other type keeps those violations unexemptible by construction instead of by a list that drifts.
 *
 * @param violationType - Violation discriminator.
 * @returns Band descriptor, or null when the type carries no exemption band.
 */
function bandForViolation(violationType) {
    return violationType === 'SUBSTANTIVE_TARGET_DEFICIT' ? SUBSTANTIVE_RATIO_BAND : null;
}

/**
 * Returns the density line a grant relaxes.
 *
 * A grant relaxes the target, never the floor. The floor states the content is invalid and no
 * exemption may reach it; the target states the content is valid but too thin to review, which is a
 * judgement a recorded grant may settle. Relaxing the floor instead would make the clause vacuous
 * whenever the measured value already cleared it.
 *
 * @param band - Density band the violation was measured against.
 * @returns Relaxed line the measurement must still clear.
 */
function relaxedLineFor(band) {
    const lowered = Math.round((band.target - EXEMPTION_POLICY.maxDrop) * 1e6) / 1e6;
    return Math.max(band.floor, lowered);
}

/**
 * Evaluates whether an existing grant still covers a measurement.
 *
 * Reuse exists because a committed grant must survive a fresh clone: on a new checkout the streak
 * ledger is empty, so waiting for a fresh streak would permanently re-block a file whose exemption
 * was already reviewed and committed alongside it.
 *
 * @param grant - Recorded grant.
 * @param measured - Current measurement.
 * @returns True when the grant still covers the measurement.
 */
function isGrantStillCovering(grant, measured) {
    if (typeof grant.relaxedLine !== 'number') return false;
    return measured >= grant.relaxedLine;
}

/**
 * Creates a ledger bound to a specific pair of files.
 *
 * Binding the paths at construction rather than reading module-level constants is what makes the
 * self-test able to exercise grants in a temporary directory without touching the repository.
 *
 * @param paths - Object carrying `streakFile` and `exemptionFile`.
 * @returns Ledger operations scoped to those files.
 */
function createLedger(paths = DEFAULT_LEDGER_PATHS) {
    /**
     * Reads every recorded streak.
     *
     * @returns Map from streak key to consecutive failure count.
     */
    function loadStreaks() {
        const raw = readLedger(paths.streakFile, {});
        const streaks = new Map();
        for (const [key, value] of Object.entries(raw)) {
            if (typeof value === 'number' && value > 0) streaks.set(key, value);
        }
        return streaks;
    }

    /**
     * Rewrites the streak ledger from the violations of this run.
     *
     * Only identifiers that still fail keep a counter, which is what makes a streak mean
     * "consecutive": an identifier that stops failing resets to zero rather than resuming from its
     * historical maximum.
     *
     * @param currentViolations - Violations emitted by this gate run.
     * @returns The persisted streak map.
     */
    function recordRunStreaks(currentViolations) {
        const previous = loadStreaks();
        const next = {};
        for (const violation of currentViolations) {
            const identifier = violation.file ?? '.';
            const key = streakKey(identifier, violation.type);
            next[key] = (previous.get(key) ?? 0) + 1;
        }
        writeLedger(paths.streakFile, next);
        return next;
    }

    /**
     * Reads every granted exemption.
     *
     * The grants live under a `grants` key alongside `schemaVersion`, so reading the top level would
     * silently return nothing and make both the lifetime cap and reuse inert. A legacy flat layout
     * is still honoured so an older ledger is not read as empty.
     *
     * @returns Map from grant key to its grant record.
     */
    function loadExemptions() {
        const raw = readLedger(paths.exemptionFile, {});
        const source = raw.grants && typeof raw.grants === 'object' ? raw.grants : raw;
        const grants = new Map();
        for (const [grantKey, record] of Object.entries(source)) {
            if (record && typeof record === 'object' && record.path) grants.set(grantKey, record);
        }
        return grants;
    }

    /**
     * Collects the eligibility clauses an exemption request fails.
     *
     * Returning the reasons rather than a boolean lets the gate print exactly which clause refused
     * the request, so a maintainer is never told only "ineligible".
     *
     * @param request - Request enriched with `bandFloor` and `eligibilityValue`.
     * @returns Human-readable clause descriptions; empty when every clause holds.
     */
    function collectIneligibilityReasons(request) {
        const reasons = [];
        const policy = EXEMPTION_POLICY;

        if (isNonExemptible(request.violationType)) {
            reasons.push(`${request.violationType} is structural and cannot be exempted`);
        }
        if (request.bandFloor === null) {
            reasons.push(`${request.violationType} carries no exemption band`);
        }
        if (request.streak < policy.minStreak) {
            reasons.push(
                `the block streak is ${request.streak}, below the required ${policy.minStreak}`,
            );
        }
        if (!request.isNew) {
            reasons.push('only a newly added file may be exempted');
        }
        if (request.physAdd >= policy.maxNewFilePhysAdd) {
            reasons.push(
                `the file adds ${request.physAdd} physical lines, at or above the ${policy.maxNewFilePhysAdd}-line scope`,
            );
        }

        if (request.bandTarget !== null) {
            const relaxedLine = relaxedLineFor({ target: request.bandTarget, floor: request.bandFloor });
            if (request.eligibilityValue < relaxedLine) {
                reasons.push(
                    `measured ${request.eligibilityValue.toFixed(3)} is below the relaxed line ${relaxedLine.toFixed(3)}`,
                );
            }
        }
        return reasons;
    }

    /**
     * Evaluates and, when eligible, records an exemption.
     *
     * @param request - Request carrying `file`, `violationType`, `ruleId`, `isNew`, `physAdd`,
     *   `streak`, `measured`, and optionally `eligibilityValue`, `batchGrantedCount`, `reason`.
     * @returns One of the GRANT_* discriminators together with the refusal reasons.
     */
    function requestExemption(request) {
        const existing = loadExemptions();
        const band = bandForViolation(request.violationType);
        const grantKey = streakKey(request.file, request.violationType);
        const measured = request.eligibilityValue ?? request.measured;

        const heldGrant = existing.get(grantKey);
        if (heldGrant) {
            return isGrantStillCovering(heldGrant, measured)
                ? { outcome: GRANT_REUSED, reasons: [], record: heldGrant }
                : {
                      outcome: GRANT_EXHAUSTED,
                      reasons: [
                          `the recorded exemption relaxes the target to ${heldGrant.relaxedLine.toFixed(
                              3,
                          )} and the measurement is ${measured.toFixed(3)}`,
                      ],
                  };
        }

        const enriched = {
            ...request,
            bandFloor: band ? band.floor : null,
            bandTarget: band ? band.target : null,
            eligibilityValue: measured,
        };
        const reasons = collectIneligibilityReasons(enriched);

        const alreadyGrantedThisBatch = request.batchGrantedCount ?? 0;
        if (
            reasons.length === 0 &&
            alreadyGrantedThisBatch >= EXEMPTION_POLICY.maxPerBatch
        ) {
            return {
                outcome: GRANT_QUOTA_EXHAUSTED,
                reasons: [
                    `this commit already exempted ${alreadyGrantedThisBatch} identifier(s); the quota is ${EXEMPTION_POLICY.maxPerBatch}`,
                ],
            };
        }
        if (reasons.length > 0) return { outcome: GRANT_INELIGIBLE, reasons };

        const record = {
            path: request.file,
            violationType: request.violationType,
            rule: request.ruleId,
            measured,
            floor: band.floor,
            target: band.target,
            relaxedLine: relaxedLineFor(band),
            reason: request.reason ?? 'short-module-header',
            streak: request.streak,
            grantedAt: new Date().toISOString(),
        };
        const previous = readLedger(paths.exemptionFile, {});
        const next = {
            schemaVersion: EXEMPTION_SCHEMA_VERSION,
            grants: { ...(previous.grants ?? {}), [grantKey]: record },
        };
        if (!writeLedger(paths.exemptionFile, next)) {
            return {
                outcome: GRANT_INELIGIBLE,
                reasons: ['the exemption ledger could not be written'],
            };
        }
        return { outcome: GRANT_GRANTED, reasons: [], record };
    }

    return {
        paths,
        loadStreaks,
        recordRunStreaks,
        loadExemptions,
        collectIneligibilityReasons,
        requestExemption,
    };
}

/** Ledger bound to the repository's own files. */
const defaultLedger = createLedger(DEFAULT_LEDGER_PATHS);

module.exports = {
    REPO_ROOT,
    DEFAULT_LEDGER_PATHS,
    ENCODING_UTF8,
    EXEMPTION_SCHEMA_VERSION,
    GRANT_GRANTED,
    GRANT_REUSED,
    GRANT_EXHAUSTED,
    GRANT_INELIGIBLE,
    GRANT_QUOTA_EXHAUSTED,
    streakKey,
    bandForViolation,
    relaxedLineFor,
    isGrantStillCovering,
    createLedger,
    ...defaultLedger,
};
