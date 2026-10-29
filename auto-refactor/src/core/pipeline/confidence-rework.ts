/**
 * Module: Core Engine — Confidence-Gated Targeted Rework
 * File Path: src/core/pipeline/confidence-rework.ts
 * Architecture Role: The retry arm of the asymmetric pipeline. A bounded FastTrack scan prunes
 *   the AST to a window, so its verdict on a finding near the window edge is a guess dressed as
 *   a result. This module decides which of those findings are worth a second, wider look and what
 *   changed evidence that second look must supply — instead of the two options the pipeline had
 *   before: trust the guess, or rescan the whole file.
 * Dependencies & Triggers: consumes Issue and EscalationEvent; called by
 *   ./dualTrackPipeline between the bounded fast scan and the deep track.
 * Responsibilities:
 *   1. Select the findings whose evidence is too weak to ship and cheap enough to re-examine.
 *   2. Assign each one the strategy that can actually change its verdict, rather than repeating
 *      the identical scan that produced it.
 *   3. Reconcile the re-audit into confirmed / refuted verdicts and report the refutations as
 *      SPECULATIVE_INVALIDATION escalations.
 * Exit Semantics & Design Rationale: Pure planning, no I/O, never throws; the caller owns the
 *   scan call. Rework is bounded to one extra pass by construction — a deterministically wrong
 *   analyzer does not become right on the third attempt, and an unbounded retry loop would turn
 *   a 15 ms fast track into the deep track it exists to avoid.
 *
 * The DSpark edit-step scheduler is deliberately NOT reused here. It scores proposed replacement
 * *text* for syntax balance and complexity trend; a finding has no replacement text, so feeding
 * one to it would produce a number that looks like a confidence and means nothing. The honest
 * analogue of its "prune the doomed branch" idea is the selection predicate below: a finding is
 * retried only when a different scan would genuinely see different code.
 */

import type { Issue } from '../types';
import { SEVERITY_ERROR } from '../types';
import type { EscalationEvent } from './escalationChannel';

/** Rework strategy: re-scan the same slice with a wider line window. */
export const REWORK_WIDEN_CONTEXT = 'widen-context';

/** Rework strategy: re-scan unbounded so a domain-level rule can see its whole enclosing symbol. */
export const REWORK_DEEPEN_AST = 'deepen-ast';

/** Rework strategy: re-scan with the analyzers the sparse router left out. */
export const REWORK_SWAP_ANALYZER_SET = 'swap-analyzer-set';

/** Rework strategy: defer the finding to evidence this process cannot gather itself. */
export const REWORK_DEFER_EXTERNAL_EVIDENCE = 'defer-external-evidence';

/** Why a finding is being re-examined; each value implies a different second scan. */
export type ReworkStrategy =
    | typeof REWORK_WIDEN_CONTEXT
    | typeof REWORK_DEEPEN_AST
    | typeof REWORK_SWAP_ANALYZER_SET
    | typeof REWORK_DEFER_EXTERNAL_EVIDENCE;

/** A finding selected for a second look. */
export interface ReworkCandidate {
    /** Finding to re-examine; the original object, not a copy. */
    readonly issue: Issue;
    /** Analyzer whose verdict must be reproduced or contradicted. */
    readonly analyzer: string;
    /** Rule whose presence or absence decides the outcome. */
    readonly rule: string;
    /** Confidence the fast track attached, before rework. */
    readonly confidence: number;
    /** Second scan this candidate needs. */
    readonly strategy: ReworkStrategy;
}

/** Everything the rework planner needs about one bounded fast scan. */
export interface ReworkPlanInput {
    /** Findings the bounded scan produced for one file. */
    readonly issues: readonly Issue[];
    /** Confidence below which a finding is considered unproven. */
    readonly confidenceThreshold: number;
    /** Whether this scan was bounded; an unbounded scan has nothing wider to look at. */
    readonly wasBounded: boolean;
    /**
     * Analyzers the sparse router left out of this scan.
     *
     * A low-confidence finding on a sparsely routed file is frequently a symptom of a rule that
     * did not run at all, which no amount of widening the window will reveal.
     */
    readonly skippedAnalyzers?: readonly string[];
}

/** Outcome of one candidate after the second scan. */
export interface ReworkOutcome {
    /** Candidate that was re-examined. */
    readonly candidate: ReworkCandidate;
    /** CONFIRMED when the rule still fires, REFUTED when the wider scan cleared it. */
    readonly verdict: 'confirmed' | 'refuted';
}

/** Aggregate rework counters, so a caller can report what the second pass actually changed. */
export interface ReworkSummary {
    /** Findings selected for a second look. */
    readonly evaluated: number;
    /** Findings the wider scan reproduced. */
    readonly confirmed: number;
    /** Findings the wider scan cleared and which were therefore dropped. */
    readonly refuted: number;
}

/** Token for a finding the wider scan reproduced. */
export const VERDICT_CONFIRMED = 'confirmed';

/** Token for a finding the wider scan cleared. */
export const VERDICT_REFUTED = 'refuted';

/**
 * Confidence assumed for a finding whose analyzer reported none.
 *
 * Below the rework threshold on purpose: silence is not evidence. An analyzer that never states
 * how sure it is has not earned the benefit of the doubt, and the cost of re-checking one finding
 * in a bounded window is far below the cost of a reviewer chasing a hallucinated defect.
 */
const DEFAULT_UNREPORTED_CONFIDENCE = 0.5;

/** Rule-id prefix shared by the complexity rule family. */
const RULE_PREFIX_COMPLEXITY = 'CPX-';

/** Analyzer id that owns whole-symbol measurements. */
const ANALYZER_COMPLEXITY = 'complexity';

/** Default factor by which a widen-context rework expands the bounded window on each side. */
export const DEFAULT_WINDOW_EXPANSION_FACTOR = 2;

/**
 * Resolves confidence the same way the arbiter does when a rule has no outcome history: the
 * analyzer's own report, or the neutral 0.5 when it reported nothing at all.
 *
 * Duplicating the fallback instead of importing the arbiter keeps this module from depending on
 * the whole confidence stack for one number, and the two must agree because both answer "what do
 * we believe when we know nothing".
 *
 * @param issue - Finding whose confidence to resolve.
 * @returns Confidence in the unit interval.
 */
export function resolveIssueConfidence(issue: Issue): number {
    const reported = issue.evidence?.confidence;
    if (typeof reported === 'number' && Number.isFinite(reported)) {
        return Math.min(1, Math.max(0, reported));
    }
    return DEFAULT_UNREPORTED_CONFIDENCE;
}

/**
 * Grows a bounded line window around its own centre.
 *
 * Clamped at line 1 because the scanner's window is 1-based and a negative start would be
 * rejected by every consumer; the end is left uncapped because the file length is not known here
 * and an over-long end is harmless to a range reader.
 *
 * @param bounds - Original 1-based [first, last] bounds.
 * @param factor - Multiplier applied to each side's distance from the window edges.
 * @returns Expanded bounds.
 */
export function expandWindow(
    bounds: readonly [number, number],
    factor: number = DEFAULT_WINDOW_EXPANSION_FACTOR,
): readonly [number, number] {
    const [first, last] = bounds;
    const span = Math.max(0, last - first);
    const growth = Math.ceil(span * Math.max(1, factor) - span);
    return [Math.max(1, first - growth), last + growth];
}

/**
 * Picks the strategy that can actually change a bounded scan's verdict.
 *
 * Whole-symbol facts (complexity, file volume) cannot be settled by a wider window at all — they
 * need the enclosing domain, so they get the unbounded pass. A finding whose analyzer already
 * declared that only runtime evidence can settle it is deferred rather than rescanned: widening
 * the window re-reads the same absence of dynamic information, so a local retry would spend a
 * second scan to reproduce the first verdict. A sparsely routed scan that skipped analyzers is
 * answered by running them, because the likeliest reason a finding under-reports is that a
 * corroborating rule never ran. Everything else is a genuine window-edge artefact, which
 * widening fixes for a fraction of the cost of a full re-scan.
 *
 * Selection order matters: an analyzer sets `requiresRuntime` because the question is dynamic,
 * which outranks how wide the window was, so the deferral is tested before the skipped-analyzer
 * swap even though both can be true.
 *
 * @param issue - Finding being re-examined.
 * @param hasSkippedAnalyzers - Whether the first scan omitted analyzers that could corroborate.
 * @returns Strategy for the second scan.
 */
function resolveStrategy(issue: Issue, hasSkippedAnalyzers: boolean): ReworkStrategy {
    if (issue.rule.toUpperCase().startsWith(RULE_PREFIX_COMPLEXITY)) return REWORK_DEEPEN_AST;
    if (issue.analyzer === ANALYZER_COMPLEXITY) return REWORK_DEEPEN_AST;
    if (issue.evidence?.requiresRuntime === true) return REWORK_DEFER_EXTERNAL_EVIDENCE;
    if (hasSkippedAnalyzers) return REWORK_SWAP_ANALYZER_SET;
    return REWORK_WIDEN_CONTEXT;
}

/**
 * Selects the findings of a bounded scan that deserve a second look.
 *
 * Three exclusions, each for a stated reason. Error-severity findings are excluded because the
 * severity floor makes them blocking regardless of what a second scan proves, so reworking them
 * changes nothing a consumer sees. Findings at or above the threshold are excluded because the
 * first scan already answered them. And an unbounded scan is excluded wholesale because widening
 * an unbounded window is a no-op — running it again would only reproduce the same bytes.
 *
 * Cross-file candidates are still planned, because the deep track needs to know a finding is
 * waiting on it; the caller decides not to run a local scan for them.
 *
 * @param input - Findings, threshold, boundedness and the analyzers the router skipped.
 * @returns Candidates in scan order, so the rework pass is deterministic.
 */
export function planRework(input: ReworkPlanInput): ReworkCandidate[] {
    if (!input.wasBounded) return [];
    const skipped = input.skippedAnalyzers ?? [];
    const hasSkippedAnalyzers = skipped.length > 0;
    const candidates: ReworkCandidate[] = [];
    for (const issue of input.issues) {
        if (issue.severity === SEVERITY_ERROR) continue;
        const confidence = resolveIssueConfidence(issue);
        if (confidence >= input.confidenceThreshold) continue;
        candidates.push({
            issue,
            analyzer: issue.analyzer,
            rule: issue.rule,
            confidence,
            strategy: resolveStrategy(issue, hasSkippedAnalyzers),
        });
    }
    return candidates;
}

/**
 * Collects the analyzers a rework pass has to run.
 *
 * Running only the producing analyzers is what keeps the retry affordable: re-running every
 * analyzer over the file would cost the full fast track again for a handful of findings. The
 * skipped set is added only when some candidate asked for a swap, because otherwise the retry
 * would pay for analyzers nothing in the plan asked to hear from.
 *
 * @param candidates - Planned candidates.
 * @param skippedAnalyzers - Analyzers the first scan omitted.
 * @returns Deduplicated analyzer ids, in first-seen order.
 */
export function collectReworkAnalyzers(
    candidates: readonly ReworkCandidate[],
    skippedAnalyzers: readonly string[] = [],
): string[] {
    const analyzers: string[] = [];
    const seen = new Set<string>();
    let wantsSwap = false;
    for (const candidate of candidates) {
        if (candidate.strategy === REWORK_DEFER_EXTERNAL_EVIDENCE) continue;
        if (candidate.strategy === REWORK_SWAP_ANALYZER_SET) wantsSwap = true;
        if (seen.has(candidate.analyzer)) continue;
        seen.add(candidate.analyzer);
        analyzers.push(candidate.analyzer);
    }
    if (!wantsSwap) return analyzers;
    for (const skippedAnalyzer of skippedAnalyzers) {
        if (seen.has(skippedAnalyzer)) continue;
        seen.add(skippedAnalyzer);
        analyzers.push(skippedAnalyzer);
    }
    return analyzers;
}

/**
 * Reports whether any candidate still needs a local re-scan.
 *
 * @param candidates - Planned candidates.
 * @returns True when at least one candidate is settled by evidence this process can gather.
 */
export function hasLocalRework(candidates: readonly ReworkCandidate[]): boolean {
    for (const candidate of candidates) {
        if (candidate.strategy !== REWORK_DEFER_EXTERNAL_EVIDENCE) return true;
    }
    return false;
}

/**
 * Reconciles candidates against the findings of the wider scan.
 *
 * Matching is by analyzer and rule, never by line: a wider window can shift the reported line of
 * a real finding, and a line-keyed comparison would then call the same defect both confirmed and
 * newly introduced. A candidate whose rule still appears anywhere in the wider result is
 * confirmed; everything else is refuted, because the wider scan had strictly more context and
 * still did not see it.
 *
 * Candidates deferred to external evidence are neither confirmed nor refuted: this pass has no
 * evidence on them, and inventing a verdict would be exactly the guess the rework exists to
 * remove.
 *
 * @param candidates - Candidates that were re-examined.
 * @param widerIssues - Every finding the wider scan produced for the file.
 * @returns One outcome per locally re-examined candidate, in candidate order.
 */
export function reconcileRework(
    candidates: readonly ReworkCandidate[],
    widerIssues: readonly Issue[],
): ReworkOutcome[] {
    const present = new Set<string>();
    for (const issue of widerIssues) present.add(`${issue.analyzer}\u0000${issue.rule}`);

    const outcomes: ReworkOutcome[] = [];
    for (const candidate of candidates) {
        if (candidate.strategy === REWORK_DEFER_EXTERNAL_EVIDENCE) continue;
        const key = `${candidate.analyzer}\u0000${candidate.rule}`;
        outcomes.push({
            candidate,
            verdict: present.has(key) ? VERDICT_CONFIRMED : VERDICT_REFUTED,
        });
    }
    return outcomes;
}

/**
 * Summarizes a rework pass for reporting.
 *
 * @param outcomes - Candidates and their verdicts.
 * @returns Evaluated, confirmed and refuted counters.
 */
export function summarizeRework(outcomes: readonly ReworkOutcome[]): ReworkSummary {
    let confirmed = 0;
    for (const outcome of outcomes) {
        if (outcome.verdict === VERDICT_CONFIRMED) confirmed += 1;
    }
    return {
        evaluated: outcomes.length,
        confirmed,
        refuted: outcomes.length - confirmed,
    };
}

/**
 * Projects refuted findings into escalation events.
 *
 * The event carries the refuted findings so a subscriber sees exactly which speculation the wider
 * evidence overturned. Severity is `info`: a refuted speculation is a working pipeline, not a
 * regression, and reporting it as an error would trip `hasBreaches` and make every gate that
 * reads it fail on a good outcome.
 *
 * @param outcomes - Candidates and their verdicts.
 * @param filePath - File the rework targeted.
 * @param timestamp - Event creation time in epoch milliseconds.
 * @returns One event per file when anything was refuted, empty otherwise.
 */
export function buildInvalidationEvents(
    outcomes: readonly ReworkOutcome[],
    filePath: string,
    timestamp: number,
): EscalationEvent[] {
    const refuted: Issue[] = [];
    for (const outcome of outcomes) {
        if (outcome.verdict === VERDICT_REFUTED) refuted.push(outcome.candidate.issue);
    }
    if (refuted.length === 0) return [];
    return [
        {
            type: 'SPECULATIVE_INVALIDATION',
            sourceFile: filePath,
            affectedFiles: [filePath],
            issues: refuted,
            severity: 'info',
            message:
                `Wider-context re-audit refuted ${refuted.length} low-confidence finding(s) ` +
                `in ${filePath}`,
            timestamp,
        },
    ];
}

/**
 * Removes refuted findings from the shipped set while leaving everything else untouched.
 *
 * Refutation drops the finding rather than downgrading it: a finding the wider scan could not
 * reproduce has no evidence left behind it, and keeping it as advisory would still spend a
 * reviewer's attention on a guess the pipeline itself disproved.
 *
 * @param issues - Findings of the bounded scan.
 * @param outcomes - Candidates and their verdicts.
 * @returns Findings to ship, in original order.
 */
export function dropRefutedFindings(
    issues: readonly Issue[],
    outcomes: readonly ReworkOutcome[],
): Issue[] {
    const refuted = new Set<Issue>();
    for (const outcome of outcomes) {
        if (outcome.verdict === VERDICT_REFUTED) refuted.add(outcome.candidate.issue);
    }
    if (refuted.size === 0) return [...issues];
    const kept: Issue[] = [];
    for (const issue of issues) {
        if (!refuted.has(issue)) kept.push(issue);
    }
    return kept;
}
