/**
 * Module: Core Engine - Governance Rules - Standardization
 * File Path: src/core/governance/rules/standardization.ts
 * Architecture Role: Rule provider exporting the file-level RedundantBooleanRule (GOV-STD-001)
 *     and ModernConstructRule (GOV-STD-002); the governance registry wires both
 *     into the shared GovernanceAnalyzer pipeline.
 * Dependencies & Triggers: Imports GovernanceRule, GovernanceViolation and
 *     RuleEvaluationContext from ../types; checkFile runs from finalize during
 *     any governance-enabled CLI, CI or daemon scan.
 * Responsibilities: GOV-STD-001 scans a file's lines for single-line TS/JS
 *     `if (...) return true; else return false;` and Python/GDScript `if x: return true` plus
 *     `else: return false` pairs, emitting fixable simplifications; GOV-STD-002 flags TS/JS
 *     `var` declarations and GDScript `pass` lines left after a non-colon statement, skipping
 *     comment lines, and proposes let/const or removal.
 * Exit Semantics & Design Rationale: both hooks return null when clean and a violation array
 *     otherwise, never throwing or mutating input; findings carry 1-based positions and
 *     suggested patches so callers can auto-fix safely. Fewer boolean branches and dead
 *     constructs lower cognitive load and keep the codebase idiomatic, which is why these two
 *     rules are marked fixable.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';
import { isToolOrTestScript } from '../pathScope';
import { getRule } from '../../rules/registry';

const IF_TRUE_RE = /^\s*if\s+(.+?)\s*:\s*return\s+true\s*$/i;
const ELSE_FALSE_RE = /^\s*else\s*:\s*return\s+false\s*$/i;
const TS_IF_TRUE_RE =
    /^\s*if\s*\((.+?)\)\s*(?:\{\s*)?return\s+true;?\s*\}?\s*else\s*(?:\{\s*)?return\s+false;?\s*\}?/i;
const VAR_RE = /^\s*\bvar\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/;
const RETURN_TRUE_RE = /return\s+[Tt]rue/;

/**
 * Checks a line for redundant boolean return patterns.
 */
function checkBooleanRedundancyLine(
    line: string,
    lineIndex: number,
    lines: string[],
    violations: GovernanceViolation[],
): void {
    if (!RETURN_TRUE_RE.test(line)) return;

    // Single line TS/JS: if (x) return true; else return false;
    const mTs = line.match(TS_IF_TRUE_RE);
    if (mTs) {
        const cond = mTs[1].trim();
        violations.push({
            ruleId: 'GOV-STD-001',
            message: `Redundant boolean check: \`if (${cond}) return true; else return false;\` can be simplified to \`return ${cond};\``,
            line: lineIndex + 1,
            column: line.search(/\S/) + 1,
            suggestion: `Replace with: return ${cond};`,
            fixable: true,
            suggestedPatch: `return ${cond};`,
        });
        return;
    }

    // Multi-line GDScript / Pythonic: if x: return true \n else: return false
    const mGd = line.match(IF_TRUE_RE);
    if (mGd && lineIndex + 1 < lines.length) {
        const nextLine = lines[lineIndex + 1];
        if (ELSE_FALSE_RE.test(nextLine)) {
            const cond = mGd[1].trim();
            violations.push({
                ruleId: 'GOV-STD-001',
                message: `Redundant boolean check: \`if ${cond}: return true\` can be simplified to \`return ${cond}\``,
                line: lineIndex + 1,
                column: line.search(/\S/) + 1,
                suggestion: `Replace with: return ${cond}`,
                fixable: true,
                suggestedPatch: `return ${cond}`,
            });
        }
    }
}

/**
 * GOV-STD-001: Redundant Boolean Logic (SIM-DED-001 generalized).
 * Replaces `if (x) return true; else return false;` with `return Boolean(x);` or `return x;`.
 */
export const RedundantBooleanRule: GovernanceRule = {
    id: 'GOV-STD-001',
    name: 'Redundant Boolean Logic Simplification',
    category: 'standardization',
    severity: 'warning',
    risk: 'low',
    rationale:
        'Redundant if-then-else returning boolean literals increases cyclomatic complexity and mental overhead.',
    isFixable: true,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes('return true') && !ctx.content.includes('return True')) {
            return null;
        }

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        for (let i = 0; i < lines.length; i++) {
            checkBooleanRedundancyLine(lines[i], i, lines, violations);
        }

        return violations.length > 0 ? violations : null;
    },
};

const KEYWORD_PASS = 'pass';

/**
 * Checks a TypeScript/JavaScript line for outdated `var` declarations.
 */
function checkModernJsTsLine(
    line: string,
    lineIndex: number,
    violations: GovernanceViolation[],
): void {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    const m = line.match(VAR_RE);
    if (!m) return;

    violations.push({
        ruleId: 'GOV-STD-002',
        message: `Outdated \`var\` keyword used for \`${m[1]}\`. Use modern \`let\` or \`const\` instead.`,
        line: lineIndex + 1,
        column: m.index != null ? m.index + 1 : 1,
        suggestion: `Replace \`var\` with \`const\` (if unassigned) or \`let\`.`,
        fixable: true,
        suggestedPatch: line.replace(/\bvar\b/, 'let'),
    });
}

/**
 * Checks a GDScript line for redundant `pass` statements in non-empty blocks.
 */
function checkGdscriptPassLine(
    lines: string[],
    i: number,
    violations: GovernanceViolation[],
): void {
    const line = lines[i].trim();
    const prevLine = lines[i - 1].trim();
    if (line === KEYWORD_PASS && prevLine && !prevLine.endsWith(':') && !prevLine.startsWith('#')) {
        violations.push({
            ruleId: 'GOV-STD-002',
            message: 'Redundant `pass` statement in non-empty code block.',
            line: i + 1,
            column: lines[i].search(/\bpass\b/) + 1,
            suggestion: 'Remove unnecessary `pass` statement.',
            fixable: true,
            suggestedPatch: '',
        });
    }
}

function collectModernJsTsViolations(
    ctx: RuleEvaluationContext,
    violations: GovernanceViolation[],
): void {
    if (!/\bvar\s+[a-zA-Z_$]/.test(ctx.content)) return;
    const lines = ctx.masked;
    for (let i = 0; i < lines.length; i++) {
        checkModernJsTsLine(lines[i], i, violations);
    }
}

function collectGdscriptViolations(
    ctx: RuleEvaluationContext,
    violations: GovernanceViolation[],
): void {
    if (!ctx.content.includes(KEYWORD_PASS)) return;
    const lines = ctx.masked;
    for (let i = 1; i < lines.length; i++) {
        checkGdscriptPassLine(lines, i, violations);
    }
}

/**
 * GOV-STD-002: Deprecated / Suboptimal Constructs.
 * Flags `var` in TS/JS and bare redundant `pass` in GDScript.
 */
export const ModernConstructRule: GovernanceRule = {
    id: 'GOV-STD-002',
    name: 'Modern Language Constructs & Anti-pattern Elimination',
    category: 'standardization',
    severity: 'warning',
    risk: 'low',
    rationale:
        'Legacy constructs (e.g. `var` in modern TS/JS, dead `pass` in GDScript) violate language idiomatic standards.',
    isFixable: true,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const violations: GovernanceViolation[] = [];
        const lang = ctx.capabilities.languageId;

        if (lang === 'typescript' || lang === 'javascript') {
            collectModernJsTsViolations(ctx, violations);
        } else if (lang === 'gdscript') {
            collectGdscriptViolations(ctx, violations);
        }

        return violations.length > 0 ? violations : null;
    },
};

const CANDIDATE_RULE_RE = /\b([A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{2,10}){1,3}-\d{3})\b/g;

const EXEMPT_RULE_CATALOG_RE =
    /(?:standardization|registry|dimensionLiterals|rule-catalog|builtin-rules|DOCS|dictionaries|def-use-chain|src\/core\/types)/i;
const EXEMPT_DIR_RE = /(?:^|\/)(?:rules|reports)(?:\/|$)/i;

function isExemptRuleCatalogPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return (
        EXEMPT_RULE_CATALOG_RE.test(normalized) ||
        EXEMPT_DIR_RE.test(normalized) ||
        isToolOrTestScript(filePath)
    );
}

/**
 * GOV-RUL-001: Rule Catalog Anti-Drift and Anti-Hallucination Guard.
 * Ensures all mentioned rule identifiers exist in the single-source rule catalog.
 */
export const RuleCatalogIntegrityRule: GovernanceRule = {
    id: 'GOV-RUL-001',
    name: 'Rule Catalog Anti-Drift and Anti-Hallucination Guard',
    category: 'standardization',
    severity: 'error',
    risk: 'high',
    rationale:
        'Referencing unregistered or hallucinated rule identifiers causes documentation drift and breaks single-source governance verification.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (isExemptRuleCatalogPath(ctx.filePath)) return null;
        if (!/-\d{3}\b/.test(ctx.content)) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.lines;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (
                line.includes('CANDIDATE_RULE_RE') ||
                line.includes('GOV-RUL-001') ||
                line.includes('RuleCatalogIntegrityRule')
            ) {
                continue;
            }
            let match: RegExpExecArray | null;
            CANDIDATE_RULE_RE.lastIndex = 0;
            while ((match = CANDIDATE_RULE_RE.exec(line)) !== null) {
                const candidateId = match[1];
                if (candidateId.startsWith('ADV-') || candidateId.startsWith('WT-')) {
                    continue;
                }
                const registered = getRule(candidateId);
                if (!registered) {
                    violations.push({
                        ruleId: 'GOV-RUL-001',
                        message: `Reference to unregistered rule ID \`${candidateId}\` detected. Possible rule drift or hallucination.`,
                        line: i + 1,
                        column: match.index + 1,
                        suggestion:
                            'Verify rule ID against scripts/common/rule-catalog.json and use registered rules only.',
                        fixable: false,
                    });
                }
            }
        }

        return violations.length > 0 ? violations : null;
    },
};
