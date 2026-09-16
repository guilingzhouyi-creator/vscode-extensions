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
            // In GDScript: property or var declarations without `: Type` or `:=`
            // e.g. `var x = 10` or `var x` (property level)
            // Improvement: Skip Variant-ambiguous RHS where `:=` would infer Variant and
            // trigger check-gdscript error.
            // Such cases require explicit `var x: Type =` instead of `:=`.
            const GD_WEAK_VAR_RE =
                /^\s*(?:@\w+\s+)?(?:static\s+)?var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)/;
            const VARIANT_RHS_RE = /^\s*(null|\[\]|\{\}|Variant)/;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.trim().startsWith('#')) continue;
                const m = line.match(GD_WEAK_VAR_RE);
                if (m) {
                    const rhs = line.slice((m.index ?? 0) + m[0].length).trim();
                    // Skip Variant-ambiguous RHS: `d.get(`, `.get(`, `null`, `[]`, `{}`
                    const isVariantAmbiguous =
                        VARIANT_RHS_RE.test(rhs) ||
                        rhs.startsWith('d.get(') ||
                        rhs.includes('.get(') ||
                        (rhs.includes('get(') && rhs.includes('Variant')) ||
                        // Heuristic: `var x = some_dict[key]` or `var x = array[idx]` often Variant
                        (/^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*[\[.]/.test(rhs) &&
                            !rhs.includes('GameConfig.') &&
                            !rhs.includes('DeterministicRNG.') &&
                            !rhs.includes('UniqueIdGenerator.'));
                    if (isVariantAmbiguous) continue;
                    violations.push({
                        ruleId: 'GOV-TYP-001',
                        message: `Variable \`${m[1]}\` uses implicit loose assignment (\`var =\`). Use explicit declaration (\`: Type =\`) or static inference (\`:=\`).`,
                        line: i + 1,
                        column: line.indexOf('var') + 1,
                        suggestion: `Change to \`var ${m[1]} := ...\` or provide an explicit type annotation.`,
                        fixable: true,
                        suggestedPatch: line.replace(
                            /var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/,
                            'var $1 :=',
                        ),
                    });
                }
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

const GD_FUNC_RE = /^\s*(?:static\s+)?func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?!->)\s*:/;
const PY_FUNC_START_RE = /^\s*(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
const PY_RETURN_TYPE_RE = /\)\s*->\s*[^:]+:/;

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
        'Unannotated function signatures compromise API boundaries and allow unintended type drift.',
    isFixable: false,
    checkNode(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.capabilities.supportsStaticTyping) return null;
        if (!ctx.node.functionLike) return null;

        const lang = ctx.capabilities.languageId;
        const startLine = ctx.node.start?.line;
        if (!startLine || startLine > ctx.masked.length) return null;

        const signatureLine = ctx.masked[startLine - 1];

        if (lang === 'gdscript') {
            // In GDScript: `func name(...) -> Type:`
            const m = signatureLine.match(GD_FUNC_RE);
            if (m && !m[1].startsWith('_')) {
                return [
                    {
                        ruleId: 'GOV-TYP-002',
                        message: `Function \`${m[1]}\` lacks explicit return type annotation (\`-> Type\`).`,
                        line: startLine,
                        column: signatureLine.indexOf('func') + 1,
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
        const lang = ctx.capabilities.languageId;

        if (lang === 'python') {
            const violations: GovernanceViolation[] = [];
            const lines = ctx.masked;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.trim().startsWith('#')) continue;
                const match = PY_FUNC_START_RE.exec(line);
                if (!match) continue;

                const funcName = match[1];
                let sigText = '';
                let depth = 0;
                let matchedEnd = false;
                let endLine = i;

                for (let j = i; j < lines.length; j++) {
                    const l = lines[j];
                    const commentIdx = l.indexOf('#');
                    const codePart = commentIdx >= 0 ? l.slice(0, commentIdx) : l;

                    for (let c = 0; c < codePart.length; c++) {
                        const ch = codePart[c];
                        if (ch === '(' || ch === '[' || ch === '{') depth++;
                        else if (ch === ')' || ch === ']' || ch === '}') depth--;
                    }
                    sigText += ' ' + codePart.trim();
                    if (depth <= 0 && codePart.includes(':')) {
                        matchedEnd = true;
                        endLine = j;
                        break;
                    }
                }

                if (matchedEnd) {
                    const hasReturnType = PY_RETURN_TYPE_RE.test(sigText);
                    if (!hasReturnType) {
                        violations.push({
                            ruleId: 'GOV-TYP-002',
                            message: `Function \`${funcName}\` lacks explicit return type annotation (\`-> Type\`).`,
                            line: i + 1,
                            column: line.indexOf('def') + 1,
                            suggestion: `Add explicit return type: \`def ${funcName}(...) -> None:\` or appropriate type.`,
                            fixable: false,
                        });
                    }
                    i = endLine; // Jump cursor over multi-line parameter definitions
                }
            }

            return violations.length > 0 ? violations : null;
        }

        return null;
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
        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        const ANY_RE = /:\s*\bany\b|\bas\s+any\b/;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
            // Exclude generic declarations or third-party wrappers
            if (ANY_RE.test(line) && !line.includes('eslint-disable')) {
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
