/**
 * Module: Core Intelligence — Context-Aware Elastic Complexity Budget Engine
 * File Path: src/core/intelligence/elastic-complexity-budget.ts
 * Architecture Role: Evaluates functions and files against dynamic, context-aware complexity
 *   budgets instead of brittle fixed dead ends, granting algorithmic exemptions for justified code.
 * Dependencies & Triggers: Consumes NormalizedNode, Issue, and dimensionLiterals; invoked by
 *   ComplexityAnalyzer during traversal and post-scan validation.
 * Responsibilities: Compute language, role, domain, and clarity budget multipliers; enforce
 *   function-level, file-level, and module-level constraints; emit CPX-BUD-001 and CPX-JST-001.
 * Exit Semantics & Design Rationale: Deterministic AST inspection without disk I/O.
 *   Prevents harmful forced refactoring of clean state machines and algorithmic kernels.
 */

import type { Issue } from '../types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../types';
import {
    ANALYZER_COMPLEXITY,
    RULE_CPX_BUD_001,
    RULE_CPX_JST_001,
} from '../scoring/dimensionLiterals';
import type { SystemTopologyRole } from '../architecture/types';

/**
 * Multiplier factors and context for evaluating a function's elastic complexity budget.
 */
export interface FunctionComplexityContext {
    name: string;
    filePath: string;
    language: string;
    cc: number;
    loc: number;
    maxDepth: number;
    startLine: number;
    startColumn: number;
    role?: SystemTopologyRole;
    isHotPath?: boolean;
    hasDocContract?: boolean;
    isStateOrAlgorithm?: boolean;
}

/**
 * Result of elastic complexity budget evaluation.
 */
export interface ElasticBudgetEvaluation {
    isExceeded: boolean;
    isUnjustified: boolean;
    effectiveWarn: number;
    effectiveFail: number;
    multipliers: {
        language: number;
        role: number;
        domain: number;
        clarity: number;
    };
    hasAlgorithmicProof: boolean;
    issues: Issue[];
}

/**
 * Language-specific base thresholds.
 */
const LANGUAGE_BASE_THRESHOLDS: Record<string, { warn: number; fail: number }> = {
    typescript: { warn: 12, fail: 20 },
    javascript: { warn: 12, fail: 20 },
    python: { warn: 12, fail: 20 },
    rust: { warn: 16, fail: 26 },
    gdscript: { warn: 14, fail: 22 },
};

function computeRoleMultiplier(role?: string): number {
    if (role === 'tool_script' || role === 'test_suite') return 1.4;
    if (role === 'infrastructure') return 1.25;
    if (role === 'application_cli' || role === 'adapter') return 0.8;
    return 1.0;
}

const ALGO_KEYWORDS = [
    'parse',
    'visit',
    'traverse',
    'token',
    'decode',
    'encode',
    'diff',
    'sort',
    'calc',
    'matrix',
];

function isMathOrAlgorithm(name: string, isStateOrAlgorithm?: boolean): boolean {
    if (isStateOrAlgorithm) return true;
    const lower = name.toLowerCase();
    return ALGO_KEYWORDS.some((kw) => lower.includes(kw));
}

function computeClarityMultiplier(maxDepth: number): number {
    if (maxDepth <= 2) return 1.3;
    if (maxDepth >= 5) return 0.7;
    return 1.0;
}

const LANGUAGE_CANONICAL_MAP: Readonly<Record<string, string>> = {
    ts: 'typescript',
    tsx: 'typescript',
    typescript: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    javascript: 'javascript',
    py: 'python',
    python: 'python',
    rs: 'rust',
    rust: 'rust',
    gd: 'gdscript',
    gdscript: 'gdscript',
};

/**
 * Normalizes language tags or file extensions to canonical language keys.
 *
 * @param langOrExt - Raw language identifier or physical file extension.
 * @returns Standardized language identifier for budget indexing.
 */
export function normalizeLanguageTag(langOrExt: string): string {
    const lower = langOrExt.toLowerCase().trim();
    return LANGUAGE_CANONICAL_MAP[lower] ?? lower;
}

function computeBudgetThresholds(
    fn: FunctionComplexityContext,
    defaultWarn: number,
    defaultFail: number,
) {
    const langKey = normalizeLanguageTag(fn.language);
    const base = LANGUAGE_BASE_THRESHOLDS[langKey] ?? { warn: defaultWarn, fail: defaultFail };
    const langMultiplier = base.warn / 12;
    const roleMultiplier = computeRoleMultiplier(fn.role);
    const isAlgo = isMathOrAlgorithm(fn.name, fn.isStateOrAlgorithm);
    const domainMultiplier = isAlgo ? 1.35 : 1.0;
    const clarityMultiplier = computeClarityMultiplier(fn.maxDepth);

    const totalMultiplier = langMultiplier * roleMultiplier * domainMultiplier * clarityMultiplier;
    const effectiveWarn = Math.max(8, Math.min(35, Math.round(base.warn * totalMultiplier)));
    const effectiveFail = Math.max(14, Math.min(50, Math.round(base.fail * totalMultiplier)));
    const hasAlgorithmicProof = Boolean((isAlgo || fn.hasDocContract) && fn.maxDepth <= 3);

    return {
        multipliers: {
            language: langMultiplier,
            role: roleMultiplier,
            domain: domainMultiplier,
            clarity: clarityMultiplier,
        },
        totalMultiplier,
        effectiveWarn,
        effectiveFail,
        hasAlgorithmicProof,
    };
}

function createBudgetExceededIssue(
    fn: FunctionComplexityContext,
    effectiveWarn: number,
    effectiveFail: number,
    totalMultiplier: number,
    hasAlgorithmicProof: boolean,
    multipliers: Record<string, number>,
): Issue {
    const severity = fn.cc >= effectiveFail ? SEVERITY_ERROR : SEVERITY_WARNING;
    return {
        id: `complexity:${RULE_CPX_BUD_001}:${fn.filePath}:${fn.startLine}`,
        analyzer: ANALYZER_COMPLEXITY,
        rule: RULE_CPX_BUD_001,
        severity,
        message:
            `Function "${fn.name}" has cyclomatic complexity ${fn.cc}, exceeding its ` +
            `elastic budget of ${effectiveWarn} (maxDepth: ${fn.maxDepth}, multiplier: ${totalMultiplier.toFixed(2)}).`,
        location: {
            file: fn.filePath,
            start: { line: fn.startLine, column: fn.startColumn },
            end: { line: fn.startLine, column: fn.startColumn + 40 },
        },
        detail: {
            function: fn.name,
            cc: fn.cc,
            effectiveWarn,
            effectiveFail,
            maxDepth: fn.maxDepth,
            hasAlgorithmicProof,
            multipliers,
        },
        suggestion: hasAlgorithmicProof
            ? 'Consider converting flat decision cascades into a lookup table or strategy map.'
            : 'Decompose mixed responsibilities and extract nested conditionals into helper functions.',
    };
}

function createUnjustifiedNestingIssue(fn: FunctionComplexityContext): Issue {
    return {
        id: `complexity:${RULE_CPX_JST_001}:${fn.filePath}:${fn.startLine}`,
        analyzer: ANALYZER_COMPLEXITY,
        rule: RULE_CPX_JST_001,
        severity: SEVERITY_WARNING,
        message:
            `Unjustified runaway complexity in "${fn.name}": complexity ${fn.cc} ` +
            `with deep control flow nesting depth ${fn.maxDepth} lacks algorithmic or state-machine justification.`,
        location: {
            file: fn.filePath,
            start: { line: fn.startLine, column: fn.startColumn },
            end: { line: fn.startLine, column: fn.startColumn + 40 },
        },
        detail: {
            function: fn.name,
            cc: fn.cc,
            maxDepth: fn.maxDepth,
            reason: 'Deeply nested procedural branch soup without specification contract',
        },
        suggestion:
            'Refactor procedural nesting with early returns, guard clauses, or a state machine pattern.',
    };
}

/**
 * Evaluates the elastic complexity budget for a single function.
 *
 * @param fn - Function complexity context and AST metrics.
 * @param defaultWarn - Fallback warning threshold (default 12).
 * @param defaultFail - Fallback failure threshold (default 20).
 * @returns Elastic budget evaluation with effective thresholds and emitted issues.
 */
export function evaluateElasticComplexityBudget(
    fn: FunctionComplexityContext,
    defaultWarn = 12,
    defaultFail = 20,
): ElasticBudgetEvaluation {
    const issues: Issue[] = [];
    const thresholds = computeBudgetThresholds(fn, defaultWarn, defaultFail);
    const { totalMultiplier, effectiveWarn, effectiveFail, hasAlgorithmicProof, multipliers } =
        thresholds;

    const isExceeded = fn.cc >= effectiveWarn;
    if (isExceeded) {
        issues.push(
            createBudgetExceededIssue(
                fn,
                effectiveWarn,
                effectiveFail,
                totalMultiplier,
                hasAlgorithmicProof,
                multipliers,
            ),
        );
    }

    const isUnjustified = fn.cc >= 14 && fn.maxDepth >= 4 && !hasAlgorithmicProof;
    if (isUnjustified) {
        issues.push(createUnjustifiedNestingIssue(fn));
    }

    return {
        isExceeded,
        isUnjustified,
        effectiveWarn,
        effectiveFail,
        multipliers,
        hasAlgorithmicProof,
        issues,
    };
}

/**
 * Evaluates file-level cumulative complexity budget across all functions.
 *
 * @param filePath - Physical file path.
 * @param lineCount - Total line count of the file.
 * @param functionCCs - Array of cyclomatic complexity numbers for functions in this file.
 * @returns Optional issue if cumulative complexity exceeds the file budget.
 */
export function evaluateFileCumulativeBudget(
    filePath: string,
    lineCount: number,
    functionCCs: number[],
): Issue | null {
    if (functionCCs.length === 0) return null;
    const totalCC = functionCCs.reduce((sum, c) => sum + c, 0);
    // Dynamic file budget: base 80 CC per 500 LOC
    const baseBudget = Math.max(60, Math.round((lineCount / 500) * 80));

    if (totalCC > baseBudget && functionCCs.length >= 4) {
        return {
            id: `complexity:${RULE_CPX_BUD_001}:${filePath}:file-budget`,
            analyzer: ANALYZER_COMPLEXITY,
            rule: RULE_CPX_BUD_001,
            severity: SEVERITY_WARNING,
            message:
                `File cumulative complexity budget exceeded: "${filePath}" has total CC ` +
                `${totalCC} across ${functionCCs.length} functions (file budget: ${baseBudget}).`,
            location: {
                file: filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 80 },
            },
            detail: { totalCC, baseBudget, functionCount: functionCCs.length, lineCount },
            suggestion:
                'Consider splitting this high-complexity module along cohesive domain boundaries.',
        };
    }
    return null;
}
