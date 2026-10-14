/**
 * Module: Core Intelligence — Context-Aware Elastic Complexity Budget Engine
 * File Path: src/core/intelligence/elastic-complexity-budget.ts
 * Architecture Role: Evaluates functions and files against dynamic, context-aware complexity
 *   budgets instead of brittle fixed dead ends, granting algorithmic exemptions for justified code.
 * Dependencies & Triggers: Consumes NormalizedNode, Issue, and dimensionLiterals; invoked by
 *   ComplexityAnalyzer during traversal and post-scan validation.
 * Responsibilities: Compute language, role, domain, clarity, and blast radius budget multipliers;
 *   enforce function-level, file-level, and module-level constraints;
 *   emit CPX-BUD-001 and CPX-JST-001.
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
    isExported?: boolean;
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
        blastRadius: number;
    };
    hasAlgorithmicProof: boolean;
    issues: Issue[];
}

const DEFAULT_WARN_THRESHOLD = 12;
const DEFAULT_FAIL_THRESHOLD = 20;
const RUST_WARN_THRESHOLD = 16;
const RUST_FAIL_THRESHOLD = 26;
const GDSCRIPT_WARN_THRESHOLD = 14;
const GDSCRIPT_FAIL_THRESHOLD = 22;

const ROLE_TOOL_SCRIPT = 'tool_script';
const ROLE_TEST_SUITE = 'test_suite';
const ROLE_INFRASTRUCTURE = 'infrastructure';
const ROLE_APPLICATION_CLI = 'application_cli';
const ROLE_ADAPTER = 'adapter';

const MULTIPLIER_TOOL_TEST = 1.4;
const MULTIPLIER_INFRA = 1.25;
const MULTIPLIER_CLI_ADAPTER = 0.8;
const MULTIPLIER_DEFAULT = 1.0;

const CLARITY_SHALLOW_DEPTH_LIMIT = 2;
const CLARITY_SHALLOW_MULTIPLIER = 1.3;
const CLARITY_DEEP_DEPTH_LIMIT = 5;
const CLARITY_DEEP_MULTIPLIER = 0.7;

const BLAST_RADIUS_MAX_DEPTH = 3;
const BLAST_RADIUS_LOW_MULTIPLIER = 1.2;

const DOMAIN_ALGO_MULTIPLIER = 1.35;

const EFFECTIVE_WARN_MIN = 8;
const EFFECTIVE_WARN_MAX = 35;
const EFFECTIVE_FAIL_MIN = 14;
const EFFECTIVE_FAIL_MAX = 50;

const UNJUSTIFIED_CC_THRESHOLD = 14;
const UNJUSTIFIED_DEPTH_THRESHOLD = 4;

const FILE_BUDGET_MIN = 60;
const FILE_BUDGET_LOC_UNIT = 500;
const FILE_BUDGET_CC_PER_UNIT = 80;
const FILE_BUDGET_MIN_FUNCTIONS = 4;

const LANG_TYPESCRIPT = 'typescript';
const LANG_JAVASCRIPT = 'javascript';
const LANG_PYTHON = 'python';
const LANG_RUST = 'rust';
const LANG_GDSCRIPT = 'gdscript';

/**
 * Language-specific base thresholds.
 */
const LANGUAGE_BASE_THRESHOLDS: Record<string, { warn: number; fail: number }> = {
    [LANG_TYPESCRIPT]: { warn: DEFAULT_WARN_THRESHOLD, fail: DEFAULT_FAIL_THRESHOLD },
    [LANG_JAVASCRIPT]: { warn: DEFAULT_WARN_THRESHOLD, fail: DEFAULT_FAIL_THRESHOLD },
    [LANG_PYTHON]: { warn: DEFAULT_WARN_THRESHOLD, fail: DEFAULT_FAIL_THRESHOLD },
    [LANG_RUST]: { warn: RUST_WARN_THRESHOLD, fail: RUST_FAIL_THRESHOLD },
    [LANG_GDSCRIPT]: { warn: GDSCRIPT_WARN_THRESHOLD, fail: GDSCRIPT_FAIL_THRESHOLD },
};

function computeRoleMultiplier(role?: string): number {
    if (role === ROLE_TOOL_SCRIPT || role === ROLE_TEST_SUITE) return MULTIPLIER_TOOL_TEST;
    if (role === ROLE_INFRASTRUCTURE) return MULTIPLIER_INFRA;
    if (role === ROLE_APPLICATION_CLI || role === ROLE_ADAPTER) return MULTIPLIER_CLI_ADAPTER;
    return MULTIPLIER_DEFAULT;
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
    if (maxDepth <= CLARITY_SHALLOW_DEPTH_LIMIT) return CLARITY_SHALLOW_MULTIPLIER;
    if (maxDepth >= CLARITY_DEEP_DEPTH_LIMIT) return CLARITY_DEEP_MULTIPLIER;
    return MULTIPLIER_DEFAULT;
}

/**
 * Computes the blast-radius multiplier based on module-boundary visibility.
 * Private or internal helper functions with shallow control flow have a bounded
 * blast radius, qualifying for an elastic complexity allowance.
 *
 * @param isExported - Whether the function is exposed outside its module or class boundary.
 * @param maxDepth - Maximum nesting depth within the function body.
 * @returns Multiplier factor (1.20 for low-blast-radius private helpers, 1.0 otherwise).
 */
export function computeBlastRadiusMultiplier(isExported?: boolean, maxDepth?: number): number {
    if (isExported === false && (maxDepth === undefined || maxDepth <= BLAST_RADIUS_MAX_DEPTH)) {
        return BLAST_RADIUS_LOW_MULTIPLIER;
    }
    return MULTIPLIER_DEFAULT;
}

const LANGUAGE_CANONICAL_MAP: Readonly<Record<string, string>> = {
    ts: LANG_TYPESCRIPT,
    tsx: LANG_TYPESCRIPT,
    typescript: LANG_TYPESCRIPT,
    js: LANG_JAVASCRIPT,
    jsx: LANG_JAVASCRIPT,
    mjs: LANG_JAVASCRIPT,
    cjs: LANG_JAVASCRIPT,
    javascript: LANG_JAVASCRIPT,
    py: LANG_PYTHON,
    python: LANG_PYTHON,
    rs: LANG_RUST,
    rust: LANG_RUST,
    gd: LANG_GDSCRIPT,
    gdscript: LANG_GDSCRIPT,
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
    const langMultiplier = base.warn / DEFAULT_WARN_THRESHOLD;
    const roleMultiplier = computeRoleMultiplier(fn.role);
    const isAlgo = isMathOrAlgorithm(fn.name, fn.isStateOrAlgorithm);
    const domainMultiplier = isAlgo ? DOMAIN_ALGO_MULTIPLIER : MULTIPLIER_DEFAULT;
    const clarityMultiplier = computeClarityMultiplier(fn.maxDepth);
    const blastRadiusMultiplier = computeBlastRadiusMultiplier(fn.isExported, fn.maxDepth);

    const totalMultiplier =
        langMultiplier *
        roleMultiplier *
        domainMultiplier *
        clarityMultiplier *
        blastRadiusMultiplier;
    const effectiveWarn = Math.max(
        EFFECTIVE_WARN_MIN,
        Math.min(EFFECTIVE_WARN_MAX, Math.round(base.warn * totalMultiplier)),
    );
    const effectiveFail = Math.max(
        EFFECTIVE_FAIL_MIN,
        Math.min(EFFECTIVE_FAIL_MAX, Math.round(base.fail * totalMultiplier)),
    );
    const hasAlgorithmicProof = Boolean(
        (isAlgo || fn.hasDocContract) && fn.maxDepth <= BLAST_RADIUS_MAX_DEPTH,
    );

    return {
        multipliers: {
            language: langMultiplier,
            role: roleMultiplier,
            domain: domainMultiplier,
            clarity: clarityMultiplier,
            blastRadius: blastRadiusMultiplier,
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
    defaultWarn = DEFAULT_WARN_THRESHOLD,
    defaultFail = DEFAULT_FAIL_THRESHOLD,
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

    const isUnjustified =
        fn.cc >= UNJUSTIFIED_CC_THRESHOLD &&
        fn.maxDepth >= UNJUSTIFIED_DEPTH_THRESHOLD &&
        !hasAlgorithmicProof;
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
    const baseBudget = Math.max(
        FILE_BUDGET_MIN,
        Math.round((lineCount / FILE_BUDGET_LOC_UNIT) * FILE_BUDGET_CC_PER_UNIT),
    );

    if (totalCC > baseBudget && functionCCs.length >= FILE_BUDGET_MIN_FUNCTIONS) {
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
