/**
 * Module: Core Engine — Post-Scan Suppression Index & Inline Directive Pass
 * File Path: src/core/reporting/post-scan-suppressions.ts
 * Architecture Role: Indexes configured suppression rules and evaluates inline directives against
 *   raw ScanReport findings during post-scan finalization.
 * Dependencies & Triggers: fs, path, file-discovery, aliases, finding-confidence-arbiter; called
 *   by reportFinalizer.finalizeReport before arbitration and score refresh.
 * Responsibilities: Pre-index rules by analyzer, match glob/rule/symbol filters, and apply
 *   inline comment suppressions or rule downgrades in place.
 * Exit Semantics & Design Rationale: Purely mutates matched issues' `suppression` and `severity`;
 *   returns suppressed issue count so caller decides whether to recompute summary metrics.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Issue, ScanReport, SuppressionRule } from '../types';
import { globToRegExp } from '../file-discovery';
import { areAliasForms } from '../rules/aliases';
import {
    FindingConfidenceArbiter,
    INLINE_DIRECTIVE_PATTERN,
} from '../scoring/finding-confidence-arbiter';

const SYMBOL_DOT_PREFIX = '.';
const EMPTY_STRING = '';
const EMPTY_SUPPRESSIONS: readonly SuppressionRule[] = Object.freeze([]);

/** Pre-indexed fast lookup structure for suppression rules. */
interface SuppressionIndex {
    readonly candidateRulesByAnalyzer: Map<string, SuppressionRule[]>;
    readonly generalRules: SuppressionRule[];
    readonly fileMatcherByRule: Map<SuppressionRule, RegExp>;
}

/**
 * Builds an indexed suppression lookup structure for O(1) analyzer bucketing.
 *
 * @param suppressions - Declared list of suppression rules.
 * @returns Pre-indexed suppression maps.
 */
function buildSuppressionIndex(suppressions: readonly SuppressionRule[]): SuppressionIndex {
    const rulesByAnalyzer = new Map<string, SuppressionRule[]>();
    const generalRules: SuppressionRule[] = [];
    const orderIndexByRule = new Map<SuppressionRule, number>();
    const fileMatcherByRule = new Map<SuppressionRule, RegExp>();

    suppressions.forEach((rule, index) => {
        orderIndexByRule.set(rule, index);
        if (rule.matchFile) {
            fileMatcherByRule.set(rule, globToRegExp(rule.matchFile.replace(/\\/g, '/')));
        }
        if (rule.matchAnalyzer) {
            const bucket = rulesByAnalyzer.get(rule.matchAnalyzer) ?? [];
            bucket.push(rule);
            rulesByAnalyzer.set(rule.matchAnalyzer, bucket);
        } else {
            generalRules.push(rule);
        }
    });

    const candidateRulesByAnalyzer = new Map<string, SuppressionRule[]>();
    for (const analyzer of rulesByAnalyzer.keys()) {
        const combinedRules = [
            ...(rulesByAnalyzer.get(analyzer) ?? EMPTY_SUPPRESSIONS),
            ...generalRules,
        ];
        combinedRules.sort(
            (firstRule, secondRule) =>
                (orderIndexByRule.get(firstRule) ?? 0) - (orderIndexByRule.get(secondRule) ?? 0),
        );
        candidateRulesByAnalyzer.set(analyzer, combinedRules);
    }
    generalRules.sort(
        (firstRule, secondRule) =>
            (orderIndexByRule.get(firstRule) ?? 0) - (orderIndexByRule.get(secondRule) ?? 0),
    );
    return { candidateRulesByAnalyzer, generalRules, fileMatcherByRule };
}

/** Evaluates whether an individual issue matches any active suppression rule. */
function matchSuppression(issue: Issue, index: SuppressionIndex): SuppressionRule | undefined {
    const symbol =
        typeof issue.detail?.function === 'string'
            ? issue.detail.function
            : typeof issue.detail?.name === 'string'
              ? issue.detail.name
              : EMPTY_STRING;
    const candidates = index.candidateRulesByAnalyzer.get(issue.analyzer) ?? index.generalRules;
    const normalizedFilePath = issue.location.file.replace(/\\/g, '/');

    return candidates.find(
        (rule) =>
            (!rule.matchFile || index.fileMatcherByRule.get(rule)!.test(normalizedFilePath)) &&
            (!rule.matchRule || areAliasForms(issue.rule, rule.matchRule)) &&
            (!rule.matchSymbol ||
                symbol === rule.matchSymbol ||
                symbol.endsWith(SYMBOL_DOT_PREFIX + rule.matchSymbol)),
    );
}

async function resolveFileDirectiveLines(
    file: string | undefined,
    rootDir: string,
    retainedSource: ReadonlyMap<string, string> | undefined,
    fileCache: Map<string, string[] | null>,
    allowHostRead: boolean,
): Promise<string[] | null> {
    if (!file) return null;
    if (fileCache.has(file)) return fileCache.get(file) ?? null;
    let content = retainedSource?.get(file);
    if (content === undefined && allowHostRead) {
        const fullPath = path.isAbsolute(file) ? file : path.resolve(rootDir, file);
        content = await fs.promises.readFile(fullPath, 'utf8').catch(() => undefined);
    }
    const lines = content && INLINE_DIRECTIVE_PATTERN.test(content) ? content.split('\n') : null;
    fileCache.set(file, lines);
    return lines;
}

function applySingleIssueSuppression(
    issue: Issue,
    fileLines: string[] | null,
    arbiter: FindingConfidenceArbiter,
    index: SuppressionIndex | null,
): boolean {
    if (issue.suppression) {
        return true;
    }
    if (fileLines) {
        const inlineCheck = arbiter.checkInlineSuppression(issue, fileLines);
        if (inlineCheck.isSuppressed) {
            issue.suppression = {
                reason: inlineCheck.reason || 'Suppressed via inline comment directive',
                downgraded: false,
            };
            return true;
        }
    }

    if (!index) {
        return false;
    }

    const matchedRule = matchSuppression(issue, index);
    if (!matchedRule) {
        return false;
    }

    issue.suppression = {
        reason: matchedRule.reason,
        downgraded: Boolean(matchedRule.downgradeTo),
    };
    if (matchedRule.downgradeTo) {
        issue.severity = matchedRule.downgradeTo;
    }
    return true;
}

function prepareSuppressionPass(
    report: ScanReport,
    suppressions: readonly SuppressionRule[],
    rootDir: string,
): { arbiter: FindingConfidenceArbiter; index: SuppressionIndex | null } | null {
    if (!report || !Array.isArray(report.issues) || !rootDir) {
        return null;
    }
    const arbiter = new FindingConfidenceArbiter();
    const index = suppressions.length > 0 ? buildSuppressionIndex(suppressions) : null;
    return { arbiter, index };
}

/**
 * Applies configured suppression rules and inline directives to all issues in the report.
 *
 * @param report - Scan report undergoing suppression filtering.
 * @param suppressions - Suppression rule collection.
 * @param rootDir - Workspace root directory for resolving relative file paths.
 * @param retainedSource - Optional retained source text map from the active scanner.
 * @param allowHostRead - Whether host disk reads are permitted when retained source misses.
 * @returns Total count of suppressed issues (sequential; requires external
 *   synchronization on shared report).
 */
export async function applySuppressions(
    report: ScanReport,
    suppressions: readonly SuppressionRule[],
    rootDir: string,
    retainedSource?: ReadonlyMap<string, string>,
    allowHostRead = true,
): Promise<number> {
    const passState = prepareSuppressionPass(report, suppressions, rootDir);
    if (!passState) {
        return 0;
    }
    const { arbiter, index } = passState;
    let suppressedCount = 0;
    const fileCache = new Map<string, string[] | null>();

    for (const issue of report.issues) {
        const fileLines = await resolveFileDirectiveLines(
            issue.location?.file,
            rootDir,
            retainedSource,
            fileCache,
            allowHostRead,
        );
        if (applySingleIssueSuppression(issue, fileLines, arbiter, index)) {
            suppressedCount++;
        }
    }
    return suppressedCount;
}
