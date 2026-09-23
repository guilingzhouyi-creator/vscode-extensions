/**
 * Module: Core Engine - Governance Rules - Type System
 * File Path: src/core/governance/rules/typeSystem.ts
 * Architecture Role: Rule provider exporting ExplicitTypingRule (GOV-TYP-001),
 *     FunctionSignatureCompletenessRule (GOV-TYP-002) and UnsafeAnyRule (GOV-TYP-003), plus
 *     shared GDScript/Python signature regexes; the governance registry wires all three rules.
 * Dependencies & Triggers: Imports GovernanceRule, GovernanceViolation and
 *     RuleEvaluationContext from ../types plus NodeKind from ../../multilang; checkFile rules
 *     run from GovernanceAnalyzer.finalize, checkNode from visit(), during governance-enabled
 *     CLI, CI or daemon scans filtered by the resolved language capability profile.
 * Responsibilities: GOV-TYP-001 flags GDScript `var name =` assignments lacking a type
 *     annotation or `:=` inference, skipping Variant-ambiguous right-hand sides such as null,
 *     empty literals, dynamic get() calls and bare index/field access; GOV-TYP-002 requires
 *     return annotations on GDScript functions and Python `def` signatures, scanning
 *     multi-line parameter lists; GOV-TYP-003 flags naked `any` annotations and casts in
 *     TypeScript, skipping comment lines and lines carrying an eslint-disable pragma.
 * Exit Semantics & Design Rationale: every hook returns null when the language is unsupported,
 *     the node does not apply or the file is clean, and a violation array otherwise; none
 *     throw or mutate shared state. Only GOV-TYP-001 marks findings fixable and attaches a
 *     `:=` patch; GOV-TYP-002 and GOV-TYP-003 report non-fixable findings. Capability gating
 *     runs first so untyped languages stay silent, while explicit annotations are demanded
 *     because inference around Variant or any erases compiler guarantees.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';

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
    category: 'type_system',
    severity: 'warning',
    risk: 'medium',
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
    category: 'type_system',
    severity: 'warning',
    risk: 'medium',
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
    category: 'type_system',
    severity: 'warning',
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
