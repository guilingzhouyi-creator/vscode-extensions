/**
 * Module: Core Engine - Governance Rules - Standardization
 * File Path: src/core/governance/rules/standardization.ts
 * Architecture Role: Rule provider exporting the node-level RedundantBooleanRule (GOV-STD-001)
 *     and the file-level ModernConstructRule (GOV-STD-002); the governance registry wires both
 *     into the shared GovernanceAnalyzer pipeline.
 * Dependencies & Triggers: Imports GovernanceRule, GovernanceViolation and
 *     RuleEvaluationContext from ../types plus NodeKind from ../../multilang; checkNode runs
 *     from GovernanceAnalyzer.visit for ControlFlow, Function and Method nodes, while
 *     checkFile runs from finalize during any governance-enabled CLI, CI or daemon scan.
 * Responsibilities: GOV-STD-001 scans a node's start-to-end line span for single-line TS/JS
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
import { NodeKind } from '../../multilang';

const IF_TRUE_RE = /^\s*if\s+(.+?)\s*:\s*return\s+true\s*$/i;
const ELSE_FALSE_RE = /^\s*else\s*:\s*return\s+false\s*$/i;
const TS_IF_TRUE_RE =
    /^\s*if\s*\((.+?)\)\s*(?:\{\s*)?return\s+true;?\s*\}?\s*else\s*(?:\{\s*)?return\s+false;?\s*\}?/i;
const VAR_RE = /^\s*\bvar\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/;

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
    checkNode(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes('return true') && !ctx.content.includes('return True')) {
            return null;
        }
        if (
            ctx.node.kind !== NodeKind.ControlFlow &&
            ctx.node.kind !== NodeKind.Function &&
            ctx.node.kind !== NodeKind.Method
        ) {
            return null;
        }

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        // Line-level pattern matching for boolean redundancy
        const startLine = ctx.node.start?.line ?? 1;
        const endLine = ctx.node.end?.line ?? lines.length;

        for (let i = startLine - 1; i < endLine && i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes('return true') && !line.includes('return True')) continue;

            // Single line TS/JS: if (x) return true; else return false;
            const mTs = line.match(TS_IF_TRUE_RE);
            if (mTs) {
                const cond = mTs[1].trim();
                violations.push({
                    ruleId: 'GOV-STD-001',
                    message: `Redundant boolean check: \`if (${cond}) return true; else return false;\` can be simplified to \`return ${cond};\``,
                    line: i + 1,
                    column: line.search(/\S/) + 1,
                    suggestion: `Replace with: return ${cond};`,
                    fixable: true,
                    suggestedPatch: `return ${cond};`,
                });
                continue;
            }

            // Multi-line GDScript / Pythonic: if x: return true \n else: return false
            const mGd = line.match(IF_TRUE_RE);
            if (mGd && i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                if (ELSE_FALSE_RE.test(nextLine)) {
                    const cond = mGd[1].trim();
                    violations.push({
                        ruleId: 'GOV-STD-001',
                        message: `Redundant boolean check: \`if ${cond}: return true\` can be simplified to \`return ${cond}\``,
                        line: i + 1,
                        column: line.search(/\S/) + 1,
                        suggestion: `Replace with: return ${cond}`,
                        fixable: true,
                        suggestedPatch: `return ${cond}`,
                    });
                }
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

const KEYWORD_PASS = 'pass';

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
        const lines = ctx.masked;
        const lang = ctx.capabilities.languageId;

        if (lang === 'typescript' || lang === 'javascript') {
            if (!ctx.content.includes('var')) return null;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.includes('var')) continue;
                if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
                const m = line.match(VAR_RE);
                if (m) {
                    violations.push({
                        ruleId: 'GOV-STD-002',
                        message: `Outdated \`var\` keyword used for \`${m[1]}\`. Use modern \`let\` or \`const\` instead.`,
                        line: i + 1,
                        column: line.indexOf('var') + 1,
                        suggestion: `Replace \`var\` with \`const\` (if unassigned) or \`let\`.`,
                        fixable: true,
                        suggestedPatch: line.replace(/\bvar\b/, 'let'),
                    });
                }
            }
        } else if (lang === 'gdscript') {
            if (!ctx.content.includes(KEYWORD_PASS)) return null;
            // Check for redundant pass after statements in a block
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                const prevLine = lines[i - 1].trim();
                if (
                    line === KEYWORD_PASS &&
                    prevLine &&
                    !prevLine.endsWith(':') &&
                    !prevLine.startsWith('#')
                ) {
                    violations.push({
                        ruleId: 'GOV-STD-002',
                        message: 'Redundant `pass` statement in non-empty code block.',
                        line: i + 1,
                        column: lines[i].indexOf(KEYWORD_PASS) + 1,
                        suggestion: 'Remove unnecessary `pass` statement.',
                        fixable: true,
                        suggestedPatch: '',
                    });
                }
            }
        }

        return violations.length > 0 ? violations : null;
    },
};
