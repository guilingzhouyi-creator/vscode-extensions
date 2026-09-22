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

/**
 * Languages this family is declared for.
 *
 * Narrower than `ALL_LANGUAGES` on purpose: the detectors below key on C-family syntax, so
 * declaring Python/GDScript/Rust would advertise coverage the implementation cannot deliver.
 */
const CMP_LANGUAGES: string[] = ['typescript', 'javascript'];

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

/**
 * Operators that unambiguously perform bit manipulation.
 *
 * Bare `&` and `|` are deliberately excluded: in TypeScript they also spell intersection/union
 * types and in Rust they spell pattern alternation, so requiring a strong operator keeps type-level
 * syntax out of the rule. Accepted cost: a line whose only bitwise work is `&`/`|` is not reported;
 * a missed match is preferred over a wrong suggestion.
 */
const STRONG_BITWISE_RE = /<<|>>|\^|~/;

/** Any operator character or digraph counted toward cognitive density. */
const OPERATOR_RE = /[&|^~]|<<|>>|\+|-|\*|\/|%|\?|:/g;

/** Declaration heads whose lines are declarations, not compressible expressions. */
const DECLARATION_PREFIX_RE =
    /^\s*(?:type\s+[A-Za-z0-9_$]+\s*=|interface\s+[A-Za-z0-9_$]+|import\s+|export\s+(?:type|interface)\b)/;

/**
 * Count occurrences of a single character without allocating.
 *
 * A `String.match` with a global pattern builds an array of every match before the caller can look
 * at the count; an `indexOf` walk answers the same question allocation-free, which matters because
 * the callers below run per line over the whole corpus.
 *
 * @param text - Text to scan.
 * @param char - Single character to count.
 * @returns Number of occurrences.
 */
function countChars(text: string, char: string): number {
    let count = 0;
    let index = text.indexOf(char);
    while (index !== -1) {
        count += 1;
        index = text.indexOf(char, index + 1);
    }
    return count;
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

        for (let i = 0; i < ctx.lines.length; i++) {
            const raw = ctx.lines[i];
            // Only the masked view is trustworthy: it is the same length as the raw line, so
            // evidence columns stay correct while prose and literals are already blank.
            const code = (ctx.masked[i] ?? '').trim();
            if (!code || DECLARATION_PREFIX_RE.test(code)) continue;

            // Cheap gate ahead of the three allocation-heavy rewrites below. Without multiple `?`
            // or >= MAX_LOGICAL_OPERATORS boolean operators, the line cannot fire.
            const qCount = countChars(code, '?');
            const hasPossibleTernary = qCount >= 2 && code.includes(':');
            const logicalOpChars = countChars(code, '&') + countChars(code, '|');
            const hasPossibleLogical = logicalOpChars >= MAX_LOGICAL_OPERATORS;
            if (!hasPossibleTernary && !hasPossibleLogical) continue;

            const withoutOptional = code.replace(/\?\./g, '  ').replace(/\?\?/g, '  ');
            const clean = withoutOptional.replace(/[a-zA-Z0-9_$]+\s*\?\s*:/g, '  ');

            const ternaryMatches = clean.match(/\?[^:]+:/g) || [];
            const logicalMatches = clean.match(/&&|\|\|/g) || [];

            const isNestedTernary =
                ternaryMatches.length >= MAX_TERNARY_BRANCHES ||
                (ternaryMatches.length >= 2 && /\?[^:]+\?[^:]+:/.test(clean));
            const isLongLogicalChain = logicalMatches.length >= MAX_LOGICAL_OPERATORS;

            if (isNestedTernary || isLongLogicalChain) {
                violations.push({
                    ruleId: 'CMP-EXP-001',
                    message: isNestedTernary
                        ? 'Giant nested ternary expression exceeds readable lower bounds.'
                        : 'Unbounded boolean logical chain with excessive operators exceeds cognitive threshold.',
                    line: i + 1,
                    column: raw.search(/\S/) + 1,
                    suggestion:
                        'Split giant nested ternary or long logical chain into named intermediate variables or if-else statements.',
                    fixable: false,
                    evidence: {
                        confidence: 0.9,
                        requiresRuntime: false,
                    },
                });
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

/**
 * CMP-LIN-001: Single-Line Multi-Semantic Statement Rule.
 * Rejects packing multiple executable statements or mutations onto a single line.
 */
export const SingleLineMultiSemanticRule: GovernanceRule = {
    id: 'CMP-LIN-001',
    name: 'Single-Line Multi-Semantic Packing',
    category: MAINTAINABILITY_CATEGORY,
    severity: 'warning',
    risk: 'medium',
    languages: CMP_LANGUAGES,
    rationale:
        'Cramming multiple distinct statements or side-effects onto a single line impairs stack traces, debug stepping, and code readability.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const violations: GovernanceViolation[] = [];

        for (let i = 0; i < ctx.lines.length; i++) {
            const raw = ctx.lines[i];
            const code = (ctx.masked[i] ?? '').trim();
            if (!code) continue;
            // A `for` header carries two semicolons by design; the body is what the rule targets.
            if (/^for\s*(?:await\s*)?\(/.test(code)) continue;
            if (DECLARATION_PREFIX_RE.test(code)) continue;
            // Two statement parts require at least one semicolon, so a line without one can
            // never fire; skipping lines with <= 1 semicolon before brace-strip avoids
            // allocations per line.
            const firstSemi = code.indexOf(';');
            if (firstSemi === -1) continue;
            const hasMultiple =
                firstSemi !== code.lastIndexOf(';') || code.slice(firstSemi + 1).trim().length > 0;
            if (!hasMultiple) continue;

            // Strip inner type/object bodies like { a: string; b: number } before splitting.
            const statementCode = code
                .replace(/\{[^}]*\}/g, '{}')
                .trim()
                .replace(/;$/, '');
            const semiParts = statementCode
                .split(';')
                .map((s) => s.trim())
                .filter(Boolean);

            if (semiParts.length >= 2 && !semiParts.every((p) => /^(case\s+|default:)/.test(p))) {
                const executableParts = semiParts.filter((p) =>
                    /\b(?:const|let|var|return|throw|if|while|await|yield)\b|[a-zA-Z0-9_$]+\s*\(/.test(
                        p,
                    ),
                );
                if (executableParts.length >= 2) {
                    violations.push({
                        ruleId: 'CMP-LIN-001',
                        message:
                            'Single line packs multiple executable statements or side effects.',
                        line: i + 1,
                        column: raw.search(/\S/) + 1,
                        suggestion:
                            '将单行内的多个语句或副作用拆分为独立代码行，遵循单行单一语义原则。',
                        fixable: false,
                        evidence: {
                            confidence: 0.95,
                            requiresRuntime: false,
                        },
                    });
                }
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

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

        for (let i = 0; i < ctx.lines.length; i++) {
            const raw = ctx.lines[i];
            // Braces are counted on the masked view: a `{` inside a string or comment must not
            // shift the depth, which is what previously let the closing brace arrive early.
            const code = (ctx.masked[i] ?? '').trim();
            if (!code) continue;

            // The brace accounting below must still run for EVERY line, so only these two regex
            // tests are gated: a callback can only open on a line carrying `=>` or `function`.
            const mayOpenCallback = code.includes('=>') || code.includes('function');
            const isDeclaredFunction =
                mayOpenCallback &&
                /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+[a-zA-Z0-9_$]+|(?:public|private|protected|static)\s+[a-zA-Z0-9_$]+\s*\()/.test(
                    code,
                );
            const opensCallback =
                mayOpenCallback &&
                !isDeclaredFunction &&
                /(?:(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*\{|\bfunction\s*(?:[a-zA-Z0-9_$]+)?\s*\([^)]*\)\s*\{)/.test(
                    code,
                );

            if (opensCallback) {
                callbackDepth++;
                if (callbackDepth >= MAX_CALLBACK_DEPTH) {
                    violations.push({
                        ruleId: 'CMP-CAL-001',
                        message: `Callback nesting depth (${callbackDepth}) exceeds lower maintainability bounds.`,
                        line: i + 1,
                        column: raw.search(/\S/) + 1,
                        suggestion:
                            '降低回调嵌套深度：改用 async/await、Promise 链扁平化或抽取具名顶层函数。',
                        fixable: false,
                        // Nesting depth is a syntactic fact: no runtime observation can confirm or
                        // refute it, so this finding must not claim runtime evidence.
                        evidence: {
                            confidence: 0.85,
                            requiresRuntime: false,
                        },
                    });
                }
            }

            if (code.includes('}') || code.includes('{')) {
                const closes = countChars(code, '}');
                const opens = countChars(code, '{');
                if (closes > opens && callbackDepth > 0) {
                    const diff = Math.min(callbackDepth, closes - opens);
                    callbackDepth -= diff;
                }
            }
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
    if (!code || DECLARATION_PREFIX_RE.test(code)) return null;
    if (code.length < DENSITY_MIN_LENGTH) return null;
    if (!STRONG_BITWISE_RE.test(code)) return null;

    const nonWs = code.replace(/\s+/g, '');
    if (nonWs.length < DENSITY_MIN_LENGTH || nonWs.length > DENSITY_MAX_LENGTH) return null;

    const opMatches = code.match(OPERATOR_RE) || [];
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
        const violations: GovernanceViolation[] = [];

        for (let i = 0; i < ctx.lines.length; i++) {
            const raw = ctx.lines[i];
            const code = (ctx.masked[i] ?? '').trim();
            const violation = checkDensityLine(raw, code, i);
            if (violation) violations.push(violation);
        }

        return violations.length > 0 ? violations : null;
    },
};
