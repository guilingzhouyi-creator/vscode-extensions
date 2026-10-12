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
const OPTIONAL_CHAIN_RE = /\?\./g;
const NULLISH_COALESCING_RE = /\?\?/g;
const ELVIS_OPERATOR_RE = /[a-zA-Z0-9_$]+\s*\?\s*:/g;
const TERNARY_PATTERN_RE = /\?[^:]+:/g;
const LOGICAL_CHAIN_RE = /&&|\|\|/g;
const FOR_LOOP_PREFIX_RE = /^for\s*(?:await\s*)?\(/;
const SWITCH_CLAUSE_PREFIX_RE = /^(?:case\s+|default:)/;

const CALLBACK_KEYWORD_RE = /=>|\bfunction\b/;
const DECLARED_FUNCTION_RE =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+[a-zA-Z0-9_$]+|(?:public|private|protected|static)\s+[a-zA-Z0-9_$]+\s*\()/;
const CALLBACK_OPEN_RE =
    /(?:(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*\{|\bfunction\s*(?:[a-zA-Z0-9_$]+)?\s*\([^)]*\)\s*\{)/;

const CHAR_SEMICOLON = 59;
const CHAR_OPEN_BRACE = 123;
const CHAR_CLOSE_BRACE = 125;

const RULE_GIANT_EXP = 'CMP-EXP-001';
const RULE_SINGLE_LINE = 'CMP-LIN-001';
const RULE_CALLBACK_DEPTH = 'CMP-CAL-001';
const RULE_COGNITIVE_DENSITY = 'CMP-DEN-001';

const TOKEN_ARROW = '=>';
const TOKEN_FUNCTION = 'function';
const TOKEN_LOGICAL_AND = '&&';
const TOKEN_LOGICAL_OR = '||';
const TOKEN_SHL = '<<';
const TOKEN_SHR = '>>';
const TOKEN_BIT_XOR = '^';
const TOKEN_BIT_NOT = '~';
const TOKEN_QUESTION = '?';
const TOKEN_COLON = ':';
const TOKEN_OPEN_BRACE = '{';
const TOKEN_CLOSE_BRACE = '}';

/** Operator trigger characters for giant expressions. */
const GIANT_TRIGGER_CHARS: ReadonlySet<string> = new Set([TOKEN_QUESTION, '&', '|']);
const GIANT_TRIGGER_LIST: readonly string[] = Array.from(GIANT_TRIGGER_CHARS);

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
const TOKEN_SEMICOLON = ';';

const CHAR_AMPERSAND = 38;
const CHAR_PIPE = 124;
const CHAR_SPACE = 32;

/**
 * Checks whether a line has at least two question marks and a colon.
 */
function hasLineTernaryCandidate(line: string): boolean {
    if (!line.includes(TOKEN_QUESTION) || !line.includes(TOKEN_COLON)) return false;
    const firstQ = line.indexOf(TOKEN_QUESTION);
    return line.indexOf(TOKEN_QUESTION, firstQ + 1) > firstQ;
}

/**
 * Counts `&` and `|` characters on a line to bound logical operator count.
 */
function countLogicalOperatorChars(line: string): number {
    let count = 0;
    for (let j = 0; j < line.length; j++) {
        const ch = line.charCodeAt(j);
        if (ch === CHAR_AMPERSAND || ch === CHAR_PIPE) {
            count++;
        }
    }
    return count;
}

/**
 * Checks whether a line has enough logical operator characters to reach `MAX_LOGICAL_OPERATORS`.
 */
function hasLineLogicalCandidate(line: string, hasAnd: boolean, hasOr: boolean): boolean {
    const matchesAnd = hasAnd && line.includes(TOKEN_LOGICAL_AND);
    const matchesOr = hasOr && line.includes(TOKEN_LOGICAL_OR);
    if (!matchesAnd && !matchesOr) return false;
    return countLogicalOperatorChars(line) >= MAX_LOGICAL_OPERATORS * 2;
}

/**
 * Checks whether operator counts on a line cross the minimum heuristic thresholds.
 */
function hasCandidateOperatorCounts(
    line: string,
    hasTernary: boolean,
    hasAnd: boolean,
    hasOr: boolean,
): boolean {
    if (hasTernary && hasLineTernaryCandidate(line)) return true;
    return (hasAnd || hasOr) && hasLineLogicalCandidate(line, hasAnd, hasOr);
}

/**
 * Categorizes whether a giant expression is a nested ternary or unbounded logical chain.
 */
function classifyGiantExpression(
    code: string,
): { isNestedTernary: boolean; isUnboundedLogical: boolean } | null {
    let isNestedTernary = false;
    let isUnboundedLogical = false;

    if (hasLineTernaryCandidate(code)) {
        const withoutOptional = code
            .replace(OPTIONAL_CHAIN_RE, '  ')
            .replace(NULLISH_COALESCING_RE, '  ');
        const clean = withoutOptional.replace(ELVIS_OPERATOR_RE, '  ');
        const ternaryMatches = clean.match(TERNARY_PATTERN_RE);
        const count = ternaryMatches ? ternaryMatches.length : 0;
        if (count >= MAX_TERNARY_BRANCHES || (count >= 2 && MULTI_TERNARY_RE.test(clean))) {
            isNestedTernary = true;
        }
    }

    if (countLogicalOperatorChars(code) >= MAX_LOGICAL_OPERATORS * 2) {
        LOGICAL_CHAIN_RE.lastIndex = 0;
        let logicalCount = 0;
        while (LOGICAL_CHAIN_RE.exec(code) !== null) {
            logicalCount++;
            if (logicalCount >= MAX_LOGICAL_OPERATORS) {
                isUnboundedLogical = true;
                break;
            }
        }
    }

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
    const kind = classifyGiantExpression(code);
    if (!kind) return null;

    return {
        ruleId: RULE_GIANT_EXP,
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
    id: RULE_GIANT_EXP,
    name: 'Giant Unbounded Expression Compression',
    category: MAINTAINABILITY_CATEGORY,
    severity: 'warning',
    risk: 'medium',
    languages: CMP_LANGUAGES,
    textTrigger: GIANT_TRIGGER_LIST,
    rationale:
        'Giant expressions with deeply nested ternaries or long unparenthesized logical chains create cognitive overload and obscure branching logic.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const hasTernary = hasLineTernaryCandidate(ctx.content);
        const hasAnd = ctx.content.includes(TOKEN_LOGICAL_AND);
        const hasOr = ctx.content.includes(TOKEN_LOGICAL_OR);
        if (!hasTernary && !hasAnd && !hasOr) return null;

        const violations: GovernanceViolation[] = [];
        const masked = ctx.masked;
        const len = ctx.lines.length;

        for (let i = 0; i < len; i++) {
            const line = masked[i];
            if (!line || !hasCandidateOperatorCounts(line, hasTernary, hasAnd, hasOr)) continue;
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
        if (!SWITCH_CLAUSE_PREFIX_RE.test(parts[i])) return false;
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
    if (code.charCodeAt(0) === 102 /* 'f' */ && FOR_LOOP_PREFIX_RE.test(code)) return null;
    if (DECLARATION_PREFIX_RE.test(code)) return null;

    const semi = countSemicolons(code);
    if (semi.count === 0) return null;
    const hasMultiple =
        semi.firstIndex !== semi.lastIndex || code.slice(semi.firstIndex + 1).trim().length > 0;
    if (!hasMultiple) return null;

    const statementCode = (
        code.includes(TOKEN_OPEN_BRACE) ? code.replace(/\{[^}]*\}/g, '{}') : code
    )
        .trim()
        .replace(/;$/, '');
    const semiParts = statementCode
        .split(TOKEN_SEMICOLON)
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
        ruleId: RULE_SINGLE_LINE,
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
 * Checks whether a line has any non-whitespace character after the first semicolon.
 */
function hasPackedSemicolonCandidate(line: string): boolean {
    if (!line.includes(TOKEN_SEMICOLON)) return false;
    for (let i = line.indexOf(TOKEN_SEMICOLON) + 1; i < line.length; i++) {
        if (line.charCodeAt(i) > CHAR_SPACE) return true;
    }
    return false;
}

/**
 * CMP-LIN-001: Single-Line Multi-Semantic Statement Rule.
 * Rejects packing multiple executable statements or mutations onto a single line.
 */
export const SingleLineMultiSemanticRule: GovernanceRule = {
    id: RULE_SINGLE_LINE,
    name: 'Packed Line Multi-Statement Compression',
    category: MAINTAINABILITY_CATEGORY,
    severity: 'warning',
    risk: 'medium',
    languages: CMP_LANGUAGES,
    textTrigger: TOKEN_SEMICOLON,
    rationale:
        'Cramming multiple distinct statements or side-effects onto a single line impairs stack traces, debug stepping, and code readability.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes(TOKEN_SEMICOLON)) return null;
        const violations: GovernanceViolation[] = [];
        const masked = ctx.masked;
        const len = ctx.lines.length;

        for (let i = 0; i < len; i++) {
            const line = masked[i];
            if (!line || !hasPackedSemicolonCandidate(line)) continue;
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
    if (!code.includes(TOKEN_OPEN_BRACE)) return false;
    if (!code.includes(TOKEN_ARROW) && !code.includes(TOKEN_FUNCTION)) return false;
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
        ruleId: RULE_CALLBACK_DEPTH,
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
 * Fast line-level pre-filter for callback nesting depth tracking.
 */
function shouldSkipCallbackLine(
    line: string,
    callbackDepth: number,
    hasArrow: boolean,
    hasFn: boolean,
): boolean {
    const hasOpenBrace = line.includes(TOKEN_OPEN_BRACE);
    if (callbackDepth === 0) {
        if (!hasOpenBrace) return true;
        return (
            !(hasArrow && line.includes(TOKEN_ARROW)) && !(hasFn && line.includes(TOKEN_FUNCTION))
        );
    }
    return !hasOpenBrace && !line.includes(TOKEN_CLOSE_BRACE);
}

/**
 * CMP-CAL-001: Callback Chain Nesting Depth Rule.
 * Rejects deeply nested inline callbacks or promise closures (nesting depth >= 3).
 */
export const CallbackDepthRule: GovernanceRule = {
    id: RULE_CALLBACK_DEPTH,
    name: 'Deep Callback Chain Nesting',
    category: MAINTAINABILITY_CATEGORY,
    severity: 'warning',
    risk: 'high',
    languages: CMP_LANGUAGES,
    textTrigger: [TOKEN_ARROW, TOKEN_FUNCTION],
    rationale:
        'Deeply nested inline callback chains create callback hell, complicate exception propagation, and mask race conditions.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const hasArrow = ctx.content.includes(TOKEN_ARROW);
        const hasFn = ctx.content.includes(TOKEN_FUNCTION);
        if (!hasArrow && !hasFn) {
            return null;
        }
        const violations: GovernanceViolation[] = [];
        let callbackDepth = 0;
        const masked = ctx.masked;
        const len = ctx.lines.length;

        for (let i = 0; i < len; i++) {
            const line = masked[i];
            if (!line || shouldSkipCallbackLine(line, callbackDepth, hasArrow, hasFn)) continue;
            const code = line.trim();
            if (!code) continue;
            callbackDepth = evaluateCallbackLine(ctx.lines[i], code, i, callbackDepth, violations);
        }

        return violations.length > 0 ? violations : null;
    },
};

const BIT_XOR = 1;
const BIT_NOT = 2;
const BIT_SHL = 4;
const BIT_SHR = 8;

/**
 * Computes a bitmask of strong bitwise operators present in the file text.
 */
function computeStrongBitwiseMask(content: string): number {
    return (
        (content.includes(TOKEN_BIT_XOR) ? BIT_XOR : 0) |
        (content.includes(TOKEN_BIT_NOT) ? BIT_NOT : 0) |
        (content.includes(TOKEN_SHL) ? BIT_SHL : 0) |
        (content.includes(TOKEN_SHR) ? BIT_SHR : 0)
    );
}

/**
 * Checks whether a line contains any strong bitwise operator indicated by `mask`.
 */
function hasLineStrongBitwise(line: string, mask: number): boolean {
    return (
        ((mask & BIT_XOR) !== 0 && line.includes(TOKEN_BIT_XOR)) ||
        ((mask & BIT_NOT) !== 0 && line.includes(TOKEN_BIT_NOT)) ||
        ((mask & BIT_SHL) !== 0 && line.includes(TOKEN_SHL)) ||
        ((mask & BIT_SHR) !== 0 && line.includes(TOKEN_SHR))
    );
}

/**
 * Counts non-whitespace characters in a string without heap allocations.
 */
function countNonWhitespace(str: string): number {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > CHAR_SPACE) count++;
    }
    return count;
}

/**
 * Counts operators matching OPERATOR_RE in a string without allocating arrays.
 */
function countOperators(code: string): number {
    OPERATOR_RE.lastIndex = 0;
    let count = 0;
    while (OPERATOR_RE.exec(code) !== null) {
        count++;
    }
    return count;
}

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

    const nonWsLen = countNonWhitespace(code);
    if (nonWsLen < DENSITY_MIN_LENGTH || nonWsLen > DENSITY_MAX_LENGTH) return null;

    const opCount = countOperators(code);
    if (opCount < DENSITY_MIN_OPERATORS) return null;

    const density = opCount / nonWsLen;
    if (density < DENSITY_THRESHOLD) return null;

    const percent = (density * 100).toFixed(0);
    return {
        ruleId: RULE_COGNITIVE_DENSITY,
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
    id: RULE_COGNITIVE_DENSITY,
    name: 'Cognitive Token Density Compression',
    category: MAINTAINABILITY_CATEGORY,
    severity: 'warning',
    risk: 'medium',
    languages: CMP_LANGUAGES,
    textTrigger: [TOKEN_SHL, TOKEN_SHR, TOKEN_BIT_XOR, TOKEN_BIT_NOT],
    rationale:
        'Dense syntactic packing of bitwise, arithmetic and conditional operators without naming or spacing exceeds human cognitive chunking capacity.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const mask = computeStrongBitwiseMask(ctx.content);
        if (mask === 0) return null;

        const violations: GovernanceViolation[] = [];
        const masked = ctx.masked;
        const len = ctx.lines.length;

        for (let i = 0; i < len; i++) {
            const line = masked[i];
            if (!line || line.length < DENSITY_MIN_LENGTH) continue;
            if (!hasLineStrongBitwise(line, mask)) continue;
            const code = line.trim();
            const violation = checkDensityLine(ctx.lines[i], code, i);
            if (violation) violations.push(violation);
        }

        return violations.length > 0 ? violations : null;
    },
};
