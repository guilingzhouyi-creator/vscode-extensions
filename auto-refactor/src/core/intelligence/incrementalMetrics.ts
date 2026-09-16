/**
 * Module: Core Intelligence — Incremental Maintainability Metrics
 * File Path: src/core/intelligence/incrementalMetrics.ts
 * Architecture Role: Metrics behind the consumer CI gate: effective LOC, external coupling, a
 *     complexity proxy, duplicated lines, and the weighted maintainability delta that rejects a
 *     change deleting lines while raising coupling.
 * Dependencies & Triggers: Shared source-mask and line-hash primitives plus node builtins only;
 *     called by `templates/consumer/run.mjs --coupling-gate`, re-exported through `api.ts`, and
 *     asserted by `scripts/validate-data-flow.js`.
 * Responsibilities: Mask content whose language is unknown, count code lines and dependencies from
 *     that view, count duplicated lines on the shared hash substrate, and combine the four deltas
 *     into one verdict with documented weights.
 * Exit Semantics & Design Rationale: Pure and total; never throws. Every metric runs on the masked
 *     view so prose cannot inflate a count, relative specifiers are excluded from coupling because
 *     a local extraction is not coupling growth, and the maintainability floor is opt-in so no
 *     existing consumer is re-gated without declaring a policy. Split out of `dataFlow.ts` when
 *     that module crossed this repository's own large-file fail threshold.
 */
import { maskSourceText, type SourceMaskConfig } from '../sourceMask';
import { computeLineStartsAndHashes, getLine } from '../editDiff';

/**
 * Mask applied to content whose language is unknown.
 *
 * The incremental metrics receive raw text without a path, so they use the C-family syntax (the
 * majority of scanned sources) plus a `#` line-comment check applied separately. Quotes, templates
 * and regex literals are all blanked so prose cannot inflate a complexity or LOC count.
 */
const LEXICAL_PROXY_MASK: SourceMaskConfig = {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/' },
    quoteChars: '\'"`',
    multilineTemplates: true,
    regexLiterals: true,
};

/** A whole line that is a `#` comment (Python/GDScript/shell), which the C-family mask leaves. */
const HASH_COMMENT_LINE_RE = /^\s*#/;

/** Relative specifiers point at modules inside the same project; they are not external coupling. */
const RELATIVE_SPECIFIER_RE = /^\.{1,2}(?:\/|$)/;

/** `from "specifier"` on an import/export statement. */
const FROM_SPECIFIER_RE = /\bfrom\s+['"]([^'"]+)['"]/g;

/** `require("specifier")` / `import("specifier")`. */
const CALL_SPECIFIER_RE = /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Leading keyword of a matched specifier pattern, used to prove the match starts in code. */
const LEADING_WORD_RE = /^[A-Za-z_$]+/;

/** A file's raw and masked lines, built once and shared by every metric in this module. */
interface MetricsView {
    /** Raw lines, used where the literal text is the answer (specifier names). */
    raw: string[];
    /** Same-length masked lines, used where code structure is the answer. */
    masked: string[];
}

/**
 * Build the shared view for one file.
 *
 * `maskSourceText` already returns the raw lines alongside the masked ones, so one call yields both
 * views for every metric below and no second split of the content is needed. Sharing the view is
 * what keeps a single comparison from masking the same file once per metric.
 *
 * @param content - Full file content.
 * @returns Raw and masked lines, indexed alike.
 */
function metricsView(content: string): MetricsView {
    return maskSourceText(content, LEXICAL_PROXY_MASK);
}

/**
 * Extract unique module dependencies from an already-built view.
 *
 * The scan is line by line and a match is accepted only when its KEYWORD survives in the masked
 * view, which proves the match starts in code rather than inside a comment or a string literal. The
 * previous whole-file pattern put `[\s\S]*?` between `import` and `from`, so it could bridge a
 * statement boundary; per-line anchoring removes that class entirely.
 *
 * @param view - Raw and masked lines for one file.
 * @returns Distinct module specifiers, in first-seen order.
 */
function dependenciesOf(view: MetricsView): string[] {
    const deps = new Set<string>();
    for (let i = 0; i < view.raw.length; i += 1) {
        for (const pattern of [FROM_SPECIFIER_RE, CALL_SPECIFIER_RE]) {
            collectSpecifiers(view.raw[i], view.masked[i] ?? '', pattern, deps);
        }
    }
    return Array.from(deps);
}

/**
 * Collect the specifiers one pattern matches on one line.
 *
 * @param rawLine - Raw source line, which still holds the quoted specifier text.
 * @param maskedLine - Masked counterpart used to prove the keyword is code.
 * @param pattern - Global specifier pattern to run.
 * @param out - Collector receiving the distinct specifiers.
 */
function collectSpecifiers(
    rawLine: string,
    maskedLine: string,
    pattern: RegExp,
    out: Set<string>,
): void {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(rawLine)) !== null) {
        const word = LEADING_WORD_RE.exec(match[0])?.[0] ?? '';
        if (maskedLine.slice(match.index, match.index + word.length) !== word) continue;
        out.add(match[1]);
    }
}

/**
 * Count distinct EXTERNAL dependencies in an already-built view.
 *
 * @param view - Raw and masked lines for one file.
 * @returns Count of distinct external module specifiers.
 */
function externalCouplingOf(view: MetricsView): number {
    return dependenciesOf(view).filter((dep) => !RELATIVE_SPECIFIER_RE.test(dep)).length;
}

/**
 * Count effective lines of code in an already-built view.
 *
 * @param view - Raw and masked lines for one file.
 * @returns Number of lines carrying code.
 */
function effectiveLocOf(view: MetricsView): number {
    let count = 0;
    for (const line of view.masked) {
        if (!line.trim()) continue;
        if (HASH_COMMENT_LINE_RE.test(line)) continue;
        count += 1;
    }
    return count;
}

/** Branch constructs counted by the complexity proxy. */
const BRANCH_RE = /\b(if|else\s+if|for|while|switch|case|catch|try)\b|\?|&&|\|\||\?\?/g;

/**
 * Compute the complexity proxy for an already-built view.
 *
 * @param view - Raw and masked lines for one file.
 * @returns Branch count plus one, never below one.
 */
function complexityProxyOf(view: MetricsView): number {
    const matches = view.masked.join('\n').match(BRANCH_RE);
    return 1 + (matches ? matches.length : 0);
}

/**
 * Extract unique module dependencies imported or required in source code.
 *
 * @param content - Full file content.
 * @returns Distinct module specifiers, in first-seen order.
 */
export function extractDependencies(content: string): string[] {
    return dependenciesOf(metricsView(content));
}

/**
 * Compute efferent coupling: the number of unique EXTERNAL dependencies.
 *
 * Relative specifiers are excluded on purpose. Counting them made a legitimate decomposition
 * (delete lines, extract a local module) look like increased coupling, so the incremental gate
 * rejected exactly the refactor it exists to encourage -- while the rejection rationale claimed to
 * be checking external coupling.
 *
 * @param content - Full file content.
 * @returns Count of distinct external module specifiers.
 */
export function computeCoupling(content: string): number {
    return externalCouplingOf(metricsView(content));
}

/**
 * Compute effective lines of code, excluding comments and blank lines.
 *
 * Runs on the masked view, so a block comment that shares a line with code no longer hides that
 * code (`/* note *​/ const y = 2;` counts), and prose inside a string never counts.
 *
 * @param content - Full file content.
 * @returns Number of lines carrying code.
 */
export function computeEffectiveLoc(content: string): number {
    return effectiveLocOf(metricsView(content));
}

/**
 * Compute a proxy cyclomatic complexity score by counting branching keywords.
 *
 * Runs on the masked view for the same reason as {@link computeEffectiveLoc}: a `?` or `&&` inside
 * a comment or string must not raise the score, since this value feeds the incremental gate.
 *
 * @param content - Full file content.
 * @returns Branch count plus one, never below one.
 */
export function computeComplexityProxy(content: string): number {
    return complexityProxyOf(metricsView(content));
}

/**
 * Weights of the maintainability delta.
 *
 * Documented, reviewable policy rather than tuned constants: coupling and duplication are weighted
 * above raw line count because they are the two properties that make future change expensive, and
 * line count is cheap to move without improving either. The absolute value is a RELATIVE indicator
 * within one project's history; it is not comparable across projects.
 */
const LOC_WEIGHT = 0.1;
/** Weight of a branch-count change (see {@link computeComplexityProxy}). */
const COMPLEXITY_WEIGHT = 0.5;
/** Weight of an external-dependency change (see {@link computeCoupling}). */
const COUPLING_WEIGHT = 2;
/** Weight of a duplicated-line change (see {@link countDuplicateLines}). */
const DUPLICATION_WEIGHT = 1;

/** Declared floors for the incremental gate. */
export interface IncrementalOptions {
    /** Maximum tolerated growth in external dependencies. */
    maxCouplingDelta?: number;
    /** Reject a change that deletes lines while raising external coupling (default true). */
    failOnNegativeLocWithIncreasedCoupling?: boolean;
    /**
     * Optional hard floor for `maintainabilityDelta`. Undefined keeps the previous verdict
     * behaviour, so an existing consumer is never re-gated without declaring a policy.
     */
    minMaintainabilityDelta?: number;
}

/**
 * Count repeated lines, using the shared line-hash substrate from `core/editDiff`.
 *
 * Reuses `computeLineStartsAndHashes` so this metric and the diff engine share one definition of a
 * line hash, instead of each reviewer deriving its own. Blank and whitespace-only lines are
 * excluded because they repeat trivially in every file and would swamp the signal.
 *
 * @param content - Full file content.
 * @returns Occurrences beyond the first, summed over every repeated non-blank line.
 */
export function countDuplicateLines(content: string): number {
    const { starts, hashes } = computeLineStartsAndHashes(content);
    const counts = new Map<number, number>();
    for (let i = 0; i < hashes.length; i += 1) {
        if (!getLine(content, starts, i).trim()) continue;
        counts.set(hashes[i], (counts.get(hashes[i]) ?? 0) + 1);
    }
    let duplicated = 0;
    for (const count of counts.values()) {
        if (count > 1) duplicated += count - 1;
    }
    return duplicated;
}

/** Incremental metrics comparing two versions of a source file. */
export interface IncrementalMetrics {
    oldLoc: number;
    newLoc: number;
    effectiveLocDelta: number;
    oldComplexity: number;
    newComplexity: number;
    complexityDelta: number;
    oldCoupling: number;
    newCoupling: number;
    couplingDelta: number;
    oldDuplication: number;
    newDuplication: number;
    duplicationDelta: number;
    maintainabilityDelta: number;
    verdict: 'PASSED' | 'FAILED' | 'WARNING';
    rejectionRationale?: string;
}

/**
 * Compute incremental maintenance metrics between two versions of a source file.
 *
 * Enforces the architectural invariant: deleting lines of code must not result in increased
 * external coupling (rejecting the "deleted 500 lines but coupling increased" anti-pattern).
 *
 * @param oldContent - Content of the file before refactoring.
 * @param newContent - Content of the file after refactoring.
 * @param options - Thresholds and ratchet policy flags.
 * @returns Incremental metrics and pass/fail gate verdict.
 */
export function computeIncrementalMetrics(
    oldContent: string,
    newContent: string,
    options?: IncrementalOptions,
): IncrementalMetrics {
    // One mask per side, shared by every metric below. Calling the public metrics directly masked
    // the same content once per metric — measured at six full masks per comparison.
    const oldView = metricsView(oldContent);
    const newView = metricsView(newContent);

    const oldLoc = effectiveLocOf(oldView);
    const newLoc = effectiveLocOf(newView);
    const effectiveLocDelta = newLoc - oldLoc;

    const oldCoupling = externalCouplingOf(oldView);
    const newCoupling = externalCouplingOf(newView);
    const couplingDelta = newCoupling - oldCoupling;

    const oldComplexity = complexityProxyOf(oldView);
    const newComplexity = complexityProxyOf(newView);
    const complexityDelta = newComplexity - oldComplexity;

    const oldDuplication = countDuplicateLines(oldContent);
    const newDuplication = countDuplicateLines(newContent);
    const duplicationDelta = newDuplication - oldDuplication;

    const weighed =
        LOC_WEIGHT * effectiveLocDelta +
        COMPLEXITY_WEIGHT * complexityDelta +
        COUPLING_WEIGHT * couplingDelta +
        DUPLICATION_WEIGHT * duplicationDelta;
    const maintainabilityDelta = Number((-weighed).toFixed(2));

    const failOnNegativeLocWithIncreasedCoupling =
        options?.failOnNegativeLocWithIncreasedCoupling ?? true;
    const maxCouplingDelta = options?.maxCouplingDelta ?? 5;

    let verdict: 'PASSED' | 'FAILED' | 'WARNING' = 'PASSED';
    let rejectionRationale: string | undefined;

    if (failOnNegativeLocWithIncreasedCoupling && effectiveLocDelta < 0 && couplingDelta > 0) {
        verdict = 'FAILED';
        rejectionRationale =
            `Anti-pattern rejected: lines of code decreased by ${Math.abs(effectiveLocDelta)} ` +
            `but coupling increased by +${couplingDelta} (violates maintainability invariant: ` +
            `code deletion must not increase external coupling)`;
    } else if (couplingDelta > maxCouplingDelta) {
        verdict = 'FAILED';
        rejectionRationale = `Coupling delta +${couplingDelta} exceeded maximum threshold +${maxCouplingDelta}`;
    } else if (
        options?.minMaintainabilityDelta !== undefined &&
        maintainabilityDelta < options.minMaintainabilityDelta
    ) {
        verdict = 'FAILED';
        rejectionRationale =
            `Maintainability delta ${maintainabilityDelta} fell below the declared floor ` +
            `${options.minMaintainabilityDelta}`;
    } else if (couplingDelta > 0 && duplicationDelta > 0) {
        verdict = 'WARNING';
    } else if (couplingDelta > 0 && complexityDelta > 0) {
        verdict = 'WARNING';
    }

    return {
        oldLoc,
        newLoc,
        effectiveLocDelta,
        oldComplexity,
        newComplexity,
        complexityDelta,
        oldCoupling,
        newCoupling,
        couplingDelta,
        oldDuplication,
        newDuplication,
        duplicationDelta,
        maintainabilityDelta,
        verdict,
        rejectionRationale,
    };
}
