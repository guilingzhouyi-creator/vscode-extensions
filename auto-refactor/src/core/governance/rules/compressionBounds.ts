/**
 * Module: Core Engine — Governance Rules — Compression Bounds
 * File Path: src/core/governance/rules/compressionBounds.ts
 * Architecture Role: File-level and node-level rule provider exporting the CMP-* rule family
 *     for GovernanceAnalyzer: GiantExpressionRule (CMP-EXP-001), SingleLineMultiSemanticRule
 *     (CMP-LIN-001), CallbackDepthRule (CMP-CAL-001), and CognitiveDensityRule (CMP-DEN-001).
 * Dependencies & Triggers: Imports shared governance types only; checkFile runs during
 *     governance-enabled scan, CI, and daemon executions.
 * Responsibilities: Enforce lower bounds on code compression to prevent cognitive overload: reject
 *     deeply nested/chained ternaries, single-line multi-statement packings, callback hell, and
 *     excessive operator token density. Every rule reads `ctx.masked` and never re-derives a
 *     cleaned line, so comment prose, string literals and regex bodies cannot be mistaken for code.
 * Exit Semantics & Design Rationale: checkFile returns null when clean and violation records
 *     otherwise; it never throws and findings guide developers toward readable decompressed code.
 *     The family is declared for TypeScript/JavaScript only: its anchors (`;` statements, `? :`
 *     ternaries, `=>` callbacks) do not exist in the other supported languages, and a rule must not
 *     claim a scope no fixture proves.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';
import { safeRegexMatch } from '../../../utils/safe-regex';

/** Category shared by every compression lower bounds rule. */
const MAINTAINABILITY_CATEGORY = 'maintainability';

/** Languages this family is declared for as an immutable set library. */
const CMP_SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set(['typescript', 'javascript']);

/** Languages this family is declared for in the GovernanceRule SPI contract. */
const CMP_LANGUAGES: string[] = Array.from(CMP_SUPPORTED_LANGUAGES);

/** Branch count at which a ternary chain is considered unreadable. */
const MAX_TERNARY_BRANCHES = 3;

/** Logical operator count at which a boolean chain is considered unreadable. */
const MAX_LOGICAL_OPERATORS = 5;

/** Callback nesting depth at which the chain is reported. */
const MAX_CALLBACK_DEPTH = 3;

/** Minimum non-blank code length for the density heuristic to be meaningful. */
const DENSITY_MIN_LENGTH = 20;

/** Maximum non-blank code length considered by the density heuristic. */
const DENSITY_MAX_LENGTH = 120;

/** Operator-to-character ratio at which a dense expression is reported. */
const DENSITY_THRESHOLD = 0.22;

/** Operator count below which density is not considered. */
const DENSITY_MIN_OPERATORS = 8;

/** Strong bitwise operator characters counted toward density pre-gating. */
const STRONG_BITWISE_RE = /<<|>>|\^|~/;

/** Any operator character or digraph counted toward cognitive density. */
const OPERATOR_RE = /[&|^~]|<<|>>|\+|-|\*|\/|%|\?|:/g;

/** Declaration heads whose lines are declarations, not compressible expressions. */
const DECLARATION_PREFIX_RE =
    /^\s*(?:type\s+[A-Za-z0-9_$]+\s*=|interface\s+[A-Za-z0-9_$]+|import\s+|export\s+(?:type|interface)\b)/;

const MULTI_TERNARY_RE = /\?[^:]+\?[^:]+:/;

const CALLBACK_KEYWORD_RE = /=>|\bfunction\b/;
const DECLARED_FUNCTION_RE =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+[a-zA-Z0-9_$]+|(?:public|private|protected|static)\s+[a-zA-Z0-9_$]+\s*\()/;
const CALLBACK_OPEN_RE =
    /(?:(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*\{|\bfunction\s*(?:[a-zA-Z0-9_$]+)?\s*\([^)]*\)\s*\{)/;

const CHAR_SEMICOLON = 59;
const CHAR_OPEN_BRACE = 123;
const CHAR_CLOSE_BRACE = 125;
const SEMICOLON_RE = /;/;

/** Operator trigger characters for giant expressions. */
const GIANT_TRIGGER_CHARS: ReadonlySet<string> = new Set(['?', '&', '|']);

/** Reserved executable statement keywords targeting packed single-line statements. */
const EXECUTABLE_STATEMENT_KEYWORDS: ReadonlySet<string> = new Set([
    'const',
    'let',
    'var',
    'return',
    'throw',
    'if',
    'while',
    'await',
    'yield',
]);

const CALL_EXPRESSION_RE = /[a-zA-Z0-9_$]+\s*\(/;

/**
 * Evaluates whether a line contains candidate giant expression operators via set lookup.
 */
function hasGiantTriggerChar(line: string): boolean {
    for (let j = 0; j < line.length; j++) {
        if (GIANT_TRIGGER_CHARS.has(line[j])) return true;
    }
    return false;
}

/**
 * Checks whether operator counts on a line cross the minimum heuristic thresholds.
 */
function hasCandidateOperatorCounts(code: string): boolean {
    let qCount = 0;
    let hasColon = false;
    let logicalOpChars = 0;
    for (let j = 0; j < code.length; j++) {
        const ch = code.charCodeAt(j);
        if (ch === 63) qCount++;
        else if (ch === 58) hasColon = true;
        else if (ch === 38 || ch === 124) logicalOpChars++;
    }
    return (qCount >= 2 && hasColon) || logicalOpChars >= MAX_LOGICAL_OPERATORS;
}

/**
 * Categorizes whether a giant expression is a nested ternary or unbounded logical chain.
 */
function classifyGiantExpression(
    code: string,
): { isNestedTernary: boolean; isUnboundedLogical: boolean } | null {
    const withoutOptional = code.replace(/\?\./g, '  ').replace(/\?\?/g, '  ');
    const clean = withoutOptional.replace(/[a-zA-Z0-9_$]+\s*\?\s*:/g, '  ');

    const ternaryMatches = clean.match(/\?[^:]+:/g) || [];
    const logicalMatches = clean.match(/&&|\|\|/g) || [];

    const isNestedTernary =
        ternaryMatches.length >= MAX_TERNARY_BRANCHES ||
        (ternaryMatches.length >= 2 && MULTI_TERNARY_RE.test(clean));
    const isUnboundedLogical = logicalMatches.length >= MAX_LOGICAL_OPERATORS;

    if (!isNestedTernary && !isUnboundedLogical) return null;
    return { isNestedTernary, isUnboundedLogical };
}

/**
 * Evaluates a single code line for giant nested ternary or boolean chain violations.
 */
function evaluateGiantExpressionLine(
    raw: string,
    code: string,
    lineIndex: number,
): GovernanceViolation | null {
    if (!hasCandidateOperatorCounts(code)) return null;
    const kind = classifyGiantExpression(code);
    if (!kind) return null;

    return {
        ruleId: 'CMP-EXP-001',
        message: kind.isNestedTernary
            ? 'Giant nested ternary expression exceeds readable lower bounds.'
            : 'Unbounded boolean logical chain with excessive operators exceeds cognitive threshold.',
        line: lineIndex + 1,
        column: raw.search(/\S/) + 1,
        suggestion: kind.isNestedTernary
            ? 'Refactor nested ternary expressions into named pure functions, early-return guard clauses, or lookup tables.'
            : 'Extract complex logical chains into semantic boolean predicates or helper functions.',
        fixable: false,
        evidence: {
            confidence: 0.9,
            requiresRuntime: false,
        },
    };
}

/**
 * CMP-EXP-001: Giant Unbounded Expression Rule.
 * Rejects giant expressions packed with deeply nested ternaries or long logical chains.
 */
export const GiantExpressionRule: GovernanceRule = {
    id: 'CMP-EXP-001',
    name: 'Giant Unbounded Expression Compression',
    category: MAINTAINABILITY_CATEGORY,
    severity: 'warning',
    risk: 'medium',
    languages: CMP_LANGUAGES,
    rationale:
        'Giant expressions with deeply nested ternaries or long unparenthesized logical chains create cognitive overload and obscure branching logic.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const violations: GovernanceViolation[] = [];
        const masked = ctx.masked;
        const len = ctx.lines.length;

        for (let i = 0; i < len; i++) {
            const line = masked[i];
            if (!line || !hasGiantTriggerChar(line)) continue;
            const code = line.trim();
            if (!code || DECLARATION_PREFIX_RE.test(code)) continue;

            const violation = evaluateGiantExpressionLine(ctx.lines[i], code, i);
            if (violation) violations.push(violation);
        }

        return violations.length > 0 ? violations : null;
    },
};

/**
 * Scans code line for semicolon frequency and bounding indices.
 */
function countSemicolons(code: string): { count: number; firstIndex: number; lastIndex: number } {
    let count = 0;
    let firstIndex = -1;
    let lastIndex = -1;
    for (let i = 0; i < code.length; i++) {
        if (code.charCodeAt(i) === CHAR_SEMICOLON) {
            if (firstIndex === -1) firstIndex = i;
            lastIndex = i;
            count++;
        }
    }
    return { count, firstIndex, lastIndex };
}

/**
 * Checks whether a semicolon-delimited segment constitutes an executable statement.
 */
function isExecutableStatementPart(part: string): boolean {
    if (CALL_EXPRESSION_RE.test(part)) return true;
    const tokens = part.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/);
    if (!tokens) return false;
    for (let i = 0; i < tokens.length; i++) {
        if (EXECUTABLE_STATEMENT_KEYWORDS.has(tokens[i])) return true;
    }
    return false;
}

/**
 * Checks whether all parts of a packed line are case/default labels.
 */
function areAllSwitchClauses(parts: string[]): boolean {
    for (let i = 0; i < parts.length; i++) {
        if (!/^(case\s+|default:)/.test(parts[i])) return false;
    }
    return true;
}

/**
 * Evaluates a masked code line for multi-statement packing on a single line.
 */
function evaluateSingleLineStatement(
    raw: string,
    code: string,
    lineIndex: number,
): GovernanceViolation | null {
    if (!code) return null;

    const semi = countSemicolons(code);
    if (semi.count === 0) return null;
    const hasMultiple =
        semi.firstIndex !== semi.lastIndex || code.slice(semi.firstIndex + 1).trim().length > 0;
    if (!hasMultiple) return null;

    if (/^for\s*(?:await\s*)?\(/.test(code)) return null;
    if (DECLARATION_PREFIX_RE.test(code)) return null;

    const statementCode = (code.indexOf('{') !== -1 ? code.replace(/\{[^}]*\}/g, '{}') : code)
        .trim()
        .replace(/;$/, '');
    const semiParts = statementCode
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

    if (semiParts.length < 2) return null;
    if (areAllSwitchClauses(semiParts)) return null;

    let executableCount = 0;
    for (let i = 0; i < semiParts.length; i++) {
        if (isExecutableStatementPart(semiParts[i])) {
            executableCount++;
        }
    }
    if (executableCount < 2) return null;

    return {
        ruleId: 'CMP-LIN-001',
        message: 'Single line packs multiple executable statements or side effects.',
        line: lineIndex + 1,
        column: raw.search(/\S/) + 1,
        suggestion:
            'Split multiple executable statements or side-effects onto separate lines following single responsibility per line.',
        fixable: false,
        evidence: {
            confidence: 0.95,
            requiresRuntime: false,
        },
    };
}

/**
 * CMP-LIN-001: Single-Line Multi-Semantic Statement Rule.
 * Rejects packing multiple executable statements or mutations onto a single line.
 */
export const SingleLineMultiSemanticRule: GovernanceRule = {
    id: 'CMP-LIN-001',
    name: 'Packed Line Multi-Statement Compression',
    category: MAINTAINABILITY_CATEGORY,
    severity: 'warning',
    risk: 'medium',
    languages: CMP_LANGUAGES,
    rationale:
        'Cramming multiple distinct statements or side-effects onto a single line impairs stack traces, debug stepping, and code readability.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const violations: GovernanceViolation[] = [];
        const masked = ctx.masked;
        const len = ctx.lines.length;

        for (let i = 0; i < len; i++) {
            const line = masked[i];
            if (!line || !SEMICOLON_RE.test(line)) continue;
            const code = line.trim();
            if (!code) continue;

            const violation = evaluateSingleLineStatement(ctx.lines[i], code, i);
            if (violation) violations.push(violation);
        }

        return violations.length > 0 ? violations : null;
    },
};

/**
 * Determines whether a code line initiates a nested inline callback closure.
 */
function opensCallbackClosure(code: string): boolean {
    if (!CALLBACK_KEYWORD_RE.test(code)) return false;
    if (DECLARED_FUNCTION_RE.test(code)) return false;
    return CALLBACK_OPEN_RE.test(code);
}

/**
 * Calculates net indentation and scope balance adjustments from braces.
 */
function calculateNetBraceDepth(code: string, currentDepth: number): number {
    let opens = 0;
    let closes = 0;
    for (let j = 0; j < code.length; j++) {
        const c = code.charCodeAt(j);
        if (c === CHAR_CLOSE_BRACE) closes++;
        else if (c === CHAR_OPEN_BRACE) opens++;
    }
    if (closes > opens && currentDepth > 0) {
        return Math.max(0, currentDepth - (closes - opens));
    }
    return currentDepth;
}

/**
 * Formats a callback nesting depth violation record.
 */
function createCallbackDepthViolation(
    raw: string,
    lineIndex: number,
    depth: number,
): GovernanceViolation {
    return {
        ruleId: 'CMP-CAL-001',
        message: `Callback nesting depth (${depth}) exceeds lower maintainability bounds.`,
        line: lineIndex + 1,
        column: raw.search(/\S/) + 1,
        suggestion:
            'Reduce callback nesting depth: convert to async/await, flatten Promise chains, or extract named functions.',
        fixable: false,
        evidence: {
            confidence: 0.85,
            requiresRuntime: false,
        },
    };
}

/**
 * Evaluates a masked code line for callback chain opening or closing.
 */
function evaluateCallbackLine(
    raw: string,
    code: string,
    lineIndex: number,
    currentDepth: number,
    violations: GovernanceViolation[],
): number {
    let depth = currentDepth;
    if (opensCallbackClosure(code)) {
        depth++;
        if (depth >= MAX_CALLBACK_DEPTH) {
            violations.push(createCallbackDepthViolation(raw, lineIndex, depth));
        }
    }
    return calculateNetBraceDepth(code, depth);
}

/**
 * CMP-CAL-001: Callback Chain Nesting Depth Rule.
 * Rejects deeply nested inline callbacks or promise closures (nesting depth >= 3).
 */
export const CallbackDepthRule: GovernanceRule = {
    id: 'CMP-CAL-001',
    name: 'Deep Callback Chain Nesting',
    category: MAINTAINABILITY_CATEGORY,
    severity: 'warning',
    risk: 'high',
    languages: CMP_LANGUAGES,
    rationale:
        'Deeply nested inline callback chains create callback hell, complicate exception propagation, and mask race conditions.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const violations: GovernanceViolation[] = [];
        let callbackDepth = 0;
        const masked = ctx.masked;
        const len = ctx.lines.length;

        for (let i = 0; i < len; i++) {
            const line = masked[i];
            if (!line) continue;
            if (callbackDepth === 0 && !CALLBACK_KEYWORD_RE.test(line)) {
                continue;
            }
            const code = line.trim();
            if (!code) continue;
            callbackDepth = evaluateCallbackLine(ctx.lines[i], code, i, callbackDepth, violations);
        }

        return violations.length > 0 ? violations : null;
    },
};

/**
 * Evaluates cognitive operator density for a single masked code line.
 */
function checkDensityLine(
    raw: string,
    code: string,
    lineIndex: number,
): GovernanceViolation | null {
    if (!code || code.length < DENSITY_MIN_LENGTH) return null;
    if (!STRONG_BITWISE_RE.test(code)) return null;
    if (DECLARATION_PREFIX_RE.test(code)) return null;

    const nonWs = code.replace(/\s+/g, '');
    if (nonWs.length < DENSITY_MIN_LENGTH || nonWs.length > DENSITY_MAX_LENGTH) return null;

    const opMatches = safeRegexMatch(code, OPERATOR_RE) || [];
    if (opMatches.length < DENSITY_MIN_OPERATORS) return null;

    const density = opMatches.length / nonWs.length;
    if (density < DENSITY_THRESHOLD) return null;

    const percent = (density * 100).toFixed(0);
    return {
        ruleId: 'CMP-DEN-001',
        message: `High cognitive token density (${percent}% operators) exceeds maintainability lower bounds.`,
        line: lineIndex + 1,
        column: raw.search(/\S/) + 1,
        suggestion:
            'Reduce cognitive density: introduce whitespace and named intermediate constants, decomposing dense expressions or bitwise operations.',
        fixable: false,
        evidence: {
            confidence: 0.8,
            requiresRuntime: false,
        },
    };
}

/**
 * CMP-DEN-001: Cognitive Token Density Rule.
 * Rejects excessive operator token density (dense bitwise/math packing without intermediate names).
 */
export const CognitiveDensityRule: GovernanceRule = {
    id: 'CMP-DEN-001',
    name: 'Cognitive Token Density Compression',
    category: MAINTAINABILITY_CATEGORY,
    severity: 'warning',
    risk: 'medium',
    languages: CMP_LANGUAGES,
    rationale:
        'Dense syntactic packing of bitwise, arithmetic and conditional operators without naming or spacing exceeds human cognitive chunking capacity.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!STRONG_BITWISE_RE.test(ctx.content)) return null;

        const violations: GovernanceViolation[] = [];
        const masked = ctx.masked;
        const len = ctx.lines.length;

        for (let i = 0; i < len; i++) {
            const line = masked[i];
            if (!line || line.length < DENSITY_MIN_LENGTH) continue;
            if (!STRONG_BITWISE_RE.test(line)) continue;
            const code = line.trim();
            const violation = checkDensityLine(ctx.lines[i], code, i);
            if (violation) violations.push(violation);
        }

        return violations.length > 0 ? violations : null;
    },
};
