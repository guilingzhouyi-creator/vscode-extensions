/**
 * Module: Core Engine - Governance Rules - Type System
 * File Path: src/core/governance/rules/typeSystem.ts
 * Architecture Role: Rule provider exporting ExplicitTypingRule (GOV-TYP-001),
 *     FunctionSignatureCompletenessRule (GOV-TYP-002), UnsafeAnyRule (GOV-TYP-003),
 *     ContractForcedEscapeRule (GOV-TYP-004) and UnsafePropertyPenetrationRule (GOV-TYP-005).
 * Dependencies & Triggers: Imports GovernanceRule, GovernanceViolation and
 *     RuleEvaluationContext from ../types plus NodeKind from ../../multilang; checkFile rules
 *     run from GovernanceAnalyzer.finalize, checkNode from visit(), during governance-enabled
 *     CLI, CI or daemon scans filtered by the resolved language capability profile.
 * Responsibilities: Enforce strong typing across GDScript, Python and TypeScript; eliminate
 *     weak variable assignments, unannotated return types, naked any annotations,
 *     forced undefined/null as any escape hatches, and unsafe property penetrations.
 * Exit Semantics & Design Rationale: Every hook returns null when the language is unsupported,
 *     the node does not apply or the file is clean, and a violation array otherwise; none
 *     throw or mutate shared state. Capability gating runs first so untyped languages stay silent.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';
import { SEVERITY_WARNING } from '../../types';

/** Category token shared across all type system governance rules. */
const TYPE_SYSTEM_CATEGORY = 'type_system';
const RISK_MEDIUM = 'medium';

/**
 * GOV-TYP-001: Explicit Strong Typing & Type Inference (ADV-TYP-001 generalized).
 * Enforces explicit type annotations or static inference in typed languages.
 */
const GD_WEAK_VAR_RE = /^\s*(?:@\w+\s+)?(?:static\s+)?var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)/;
const VARIANT_RHS_RE = /^\s*(null|\[\]|\{\}|Variant)/;
const VARIANT_CALL_RE = /\.get\(|\bget\(.*Variant|Variant.*get\(/;
const VARIANT_COLLECTION_ACCESS_RE = /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*[\[.]/;
const NON_VARIANT_SINGLETONS_RE = /(?:GameConfig|DeterministicRNG|UniqueIdGenerator)\./;
const ANY_KEYWORD_RE = /\bany\b/;
const ESLINT_DISABLE_RE = /eslint-disable/;

/**
 * Evaluates a single line for GDScript weak variable assignment.
 */
function checkGdWeakVarLine(
    line: string,
    lineIndex: number,
    violations: GovernanceViolation[],
): void {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return;
    const m = line.match(GD_WEAK_VAR_RE);
    if (!m) return;

    const rhs = line.slice((m.index ?? 0) + m[0].length).trim();
    const isVariantAmbiguous =
        VARIANT_RHS_RE.test(rhs) ||
        rhs.startsWith('d.get(') ||
        VARIANT_CALL_RE.test(rhs) ||
        (VARIANT_COLLECTION_ACCESS_RE.test(rhs) && !NON_VARIANT_SINGLETONS_RE.test(rhs));
    if (isVariantAmbiguous) return;

    violations.push({
        ruleId: 'GOV-TYP-001',
        message: `Variable \`${m[1]}\` uses implicit loose assignment (\`var =\`). Use explicit declaration (\`: Type =\`) or static inference (\`:=\`).`,
        line: lineIndex + 1,
        column: (m.index ?? 0) + 1,
        suggestion: `Change to \`var ${m[1]} := ...\` or provide an explicit type annotation.`,
        fixable: true,
        suggestedPatch: line.replace(/var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/, 'var $1 :='),
    });
}

/**
 * GOV-TYP-001: Explicit Strong Typing & Type Inference (ADV-TYP-001 generalized).
 * Enforces explicit type annotations or static inference in typed languages.
 */
export const ExplicitTypingRule: GovernanceRule = {
    id: 'GOV-TYP-001',
    name: 'Explicit Strong Typing and Static Inference',
    category: TYPE_SYSTEM_CATEGORY,
    severity: SEVERITY_WARNING,
    risk: RISK_MEDIUM,
    rationale:
        'Implicit loose typing hides type errors at runtime and weakens static safety guarantees.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.capabilities.supportsStaticTyping) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;
        const lang = ctx.capabilities.languageId;

        if (lang === 'gdscript') {
            for (let i = 0; i < lines.length; i++) {
                checkGdWeakVarLine(lines[i], i, violations);
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

const GD_FUNC_RE = /^\s*(?:static\s+)?func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?!->)\s*:/;
const PY_FUNC_START_RE = /^\s*(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
const PY_RETURN_TYPE_RE = /\)\s*->\s*[^:]+:/;

const ANY_RE = /:\s*\bany\b|\bas\s+any\b/;

/**
 * Computes the paren/bracket balance delta for a code segment.
 */
function computeParenDelta(codePart: string): number {
    let delta = 0;
    for (let c = 0; c < codePart.length; c++) {
        const ch = codePart[c];
        if (ch === '(' || ch === '[' || ch === '{') delta++;
        else if (ch === ')' || ch === ']' || ch === '}') delta--;
    }
    return delta;
}

/**
 * Extracts and parses a Python function signature across multiple lines.
 */
function parsePythonFunctionSignature(
    lines: string[],
    startIndex: number,
): { sigText: string; matchedEnd: boolean; endLine: number } {
    let sigText = '';
    let depth = 0;
    let matchedEnd = false;
    let endLine = startIndex;

    for (let j = startIndex; j < lines.length; j++) {
        const l = lines[j];
        const hashIdx = l.search(/#/);
        const codePart = hashIdx >= 0 ? l.slice(0, hashIdx) : l;

        depth += computeParenDelta(codePart);
        sigText += ' ' + codePart.trim();
        if (depth <= 0 && /:/.test(codePart)) {
            matchedEnd = true;
            endLine = j;
            break;
        }
    }
    return { sigText, matchedEnd, endLine };
}

/**
 * Scans Python code lines for unannotated function return types.
 */
function checkPythonFunctionReturnTypes(lines: string[], violations: GovernanceViolation[]): void {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('#')) continue;
        const match = PY_FUNC_START_RE.exec(line);
        if (!match) continue;

        const funcName = match[1];
        const { sigText, matchedEnd, endLine } = parsePythonFunctionSignature(lines, i);
        if (!matchedEnd) continue;

        i = endLine; // Jump cursor over multi-line parameter definitions
        if (!PY_RETURN_TYPE_RE.test(sigText)) {
            violations.push({
                ruleId: 'GOV-TYP-002',
                message: `Function \`${funcName}\` lacks explicit return type annotation (\`-> Type\`).`,
                line: i + 1,
                column: match.index != null ? match.index + 1 : 1,
                suggestion: `Add explicit return type: \`def ${funcName}(...) -> None:\` or appropriate type.`,
                fixable: false,
            });
        }
    }
}

/**
 * GOV-TYP-002: Function Signature Completeness (ADV-TYP-002 generalized).
 * Enforces return type annotations on public/exported functions.
 */
export const FunctionSignatureCompletenessRule: GovernanceRule = {
    id: 'GOV-TYP-002',
    name: 'Function Signature Parameter & Return Type Completeness',
    category: TYPE_SYSTEM_CATEGORY,
    severity: SEVERITY_WARNING,
    risk: RISK_MEDIUM,
    rationale:
        'Missing return type annotations on functions degrade API contracts and compiler static analysis.',
    isFixable: false,
    languages: ['gdscript', 'python'],
    checkNode(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.capabilities.supportsStaticTyping) return null;
        if (!ctx.node.functionLike) return null;

        const lang = ctx.capabilities.languageId;
        const startLine = ctx.node.start?.line;
        if (!startLine || startLine > ctx.masked.length) return null;

        const signatureLine = ctx.masked[startLine - 1];

        if (lang === 'gdscript') {
            const m = signatureLine.match(GD_FUNC_RE);
            if (m && !m[1].startsWith('_')) {
                return [
                    {
                        ruleId: 'GOV-TYP-002',
                        message: `Function \`${m[1]}\` lacks explicit return type annotation (\`-> Type\`).`,
                        line: startLine,
                        column: m.index != null ? m.index + 1 : 1,
                        suggestion: `Add explicit return type: \`func ${m[1]}(...) -> void:\` or appropriate type.`,
                        fixable: false,
                    },
                ];
            }
        }

        return null;
    },
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.capabilities.supportsStaticTyping) return null;
        if (ctx.capabilities.languageId !== 'python') return null;

        const violations: GovernanceViolation[] = [];
        checkPythonFunctionReturnTypes(ctx.masked, violations);
        return violations.length > 0 ? violations : null;
    },
};

/**
 * GOV-TYP-003: Unsafe Any / Escape Hatch Elimination.
 * Flags naked `any` in TypeScript.
 */
export const UnsafeAnyRule: GovernanceRule = {
    id: 'GOV-TYP-003',
    name: 'Unsafe Any Escape Hatch Elimination',
    category: TYPE_SYSTEM_CATEGORY,
    severity: SEVERITY_WARNING,
    risk: 'high',
    rationale: 'Naked `any` bypasses the entire compiler type checker, leaking type instability.',
    isFixable: false,
    languages: ['typescript'],
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes('any')) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!ANY_KEYWORD_RE.test(line)) continue;
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
            // Exclude generic declarations or third-party wrappers
            if (ANY_RE.test(line) && !ESLINT_DISABLE_RE.test(line)) {
                violations.push({
                    ruleId: 'GOV-TYP-003',
                    message:
                        'Avoid naked `any` type annotations; prefer `unknown` or specific union types.',
                    line: i + 1,
                    column: line.search(ANY_RE) + 1,
                    suggestion:
                        'Replace with a strongly-typed interface, generic parameter, or `unknown`.',
                    fixable: false,
                });
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

const FORCED_ESCAPE_RE = /\b(?:undefined|null)\s+as\s+any\b/;
const PROPERTY_PENETRATION_RE = /\(\s*([a-zA-Z0-9_$]+)\s+as\s+any\s*\)\s*(?:\.|\?\.|\b\[)/;

/**
 * Scans masked lines for regex matches and formats governance violations.
 */
function scanLinePatternViolations(
    lines: string[],
    pattern: RegExp,
    ruleId: 'GOV-TYP-004' | 'GOV-TYP-005',
    messageFn: (m: RegExpExecArray) => string,
    suggestion: string,
): GovernanceViolation[] {
    const violations: GovernanceViolation[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (ESLINT_DISABLE_RE.test(line)) continue;

        const match = pattern.exec(line);
        if (match) {
            violations.push({
                ruleId,
                message: messageFn(match),
                line: i + 1,
                column: match.index + 1,
                suggestion,
                fixable: false,
            });
        }
    }
    return violations;
}

/**
 * Factory for creating TypeScript pattern-matching governance rules.
 */
function createTypeGovernanceRule(
    id: 'GOV-TYP-004' | 'GOV-TYP-005',
    name: string,
    risk: 'medium' | 'high',
    rationale: string,
    pattern: RegExp,
    messageFn: (m: RegExpExecArray) => string,
    suggestion: string,
): GovernanceRule {
    return {
        id,
        name,
        category: TYPE_SYSTEM_CATEGORY,
        severity: SEVERITY_WARNING,
        risk,
        rationale,
        isFixable: false,
        languages: ['typescript'],
        checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
            if (!ctx.content.includes('as any')) return null;
            const violations = scanLinePatternViolations(
                ctx.masked,
                pattern,
                id,
                messageFn,
                suggestion,
            );
            return violations.length > 0 ? violations : null;
        },
    };
}

/**
 * GOV-TYP-004: Contract-Forced Escape Hatch / ISP Violation.
 * Flags passing or assigning `undefined as any` or `null as any` to force interface compliance.
 */
export const ContractForcedEscapeRule: GovernanceRule = createTypeGovernanceRule(
    'GOV-TYP-004',
    'Contract-Forced Escape Hatch Elimination',
    RISK_MEDIUM,
    'Passing or assigning `undefined as any` or `null as any` indicates an Interface Segregation Principle (ISP) violation. Design optional union parameters (`param?: Type`) or split interfaces instead.',
    FORCED_ESCAPE_RE,
    () =>
        'Avoid `undefined as any` or `null as any`; refactor interface to optional type (`?`) or split into specific interfaces.',
    'Update the target parameter signature to allow `undefined` or use interface segregation.',
);

/**
 * GOV-TYP-005: Unsafe Property Penetration.
 * Flags accessing properties through `(expr as any).prop` or `(expr as any)?.prop`.
 */
export const UnsafePropertyPenetrationRule: GovernanceRule = createTypeGovernanceRule(
    'GOV-TYP-005',
    'Unsafe Property Penetration Elimination',
    'high',
    'Accessing properties via `(expr as any).prop` bypasses compiler type safety and indicates missing type narrowing guards or proper domain entity types.',
    PROPERTY_PENETRATION_RE,
    (m) =>
        `Unsafe property penetration on \`${m[1]}\` via \`as any\`. Use standard type guards or narrowing.`,
    'Use standard type guards (e.g. `ts.isXxx()`, `in` operator, or custom predicate) before accessing properties.',
);
