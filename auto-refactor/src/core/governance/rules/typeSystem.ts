/**
 * Module: Core Engine - Governance Rules - Type System
 * File Path: src/core/governance/rules/typeSystem.ts
 * Architecture Role: Rule provider exporting ExplicitTypingRule (GOV-TYP-001),
 *     FunctionSignatureCompletenessRule (GOV-TYP-002), UnsafeAnyRule (GOV-TYP-003),
 *     ContractForcedEscapeRule (GOV-TYP-004), UnsafePropertyPenetrationRule (GOV-TYP-005),
 *     and ExportExplicitTypeRule (GOV-TYP-006).
 * Dependencies & Triggers: Imports GovernanceRule, GovernanceViolation and
 *     RuleEvaluationContext from ../types; helpers from ./type-system-helpers.
 * Responsibilities: Enforce strong typing across GDScript, Python and TypeScript; eliminate
 *     weak variable assignments, unannotated return types, naked any annotations,
 *     forced escape hatches, unsafe property penetrations, and missing exported return types.
 * Exit Semantics & Design Rationale: Every hook returns null when the language is unsupported,
 *     the node does not apply or the file is clean, and a violation array otherwise.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';
import { SEVERITY_WARNING } from '../../types';
import { NodeKind } from '../../multilang';
import {
    TYPE_SYSTEM_CATEGORY,
    RISK_MEDIUM,
    checkGdWeakVarLine,
    checkPythonFunctionReturnTypes,
    checkGdFunctionSignature,
    checkUnsafeAny,
    checkExportedFunctionReturnTypes,
} from './type-system-helpers';

const RULE_ID_GOV_TYP_004 = 'GOV-TYP-004';
const RULE_ID_GOV_TYP_005 = 'GOV-TYP-005';
const RISK_HIGH = 'high';
const EXPORT_KEYWORD = 'export';
const FORCED_ESCAPE_RE = /\b(?:undefined|null)\s+as\s+any\b/;
const PROPERTY_PENETRATION_RE = /\(\s*([a-zA-Z0-9_$]+)\s+as\s+any\s*\)\s*(?:\.|\?\.|\b\[)/;
const ESLINT_DISABLE_RE = /eslint-disable/;

/**
 * Scans masked lines for regex matches and formats governance violations.
 *
 * @param lines - Masked source lines.
 * @param pattern - Regular expression to test.
 * @param ruleId - Rule ID to emit.
 * @param messageFn - Formatter for violation message.
 * @param suggestion - Remediation advice.
 * @returns List of detected violations.
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
 *
 * @param id - Governance rule ID.
 * @param name - Human-readable rule name.
 * @param risk - Risk level.
 * @param rationale - Architectural justification.
 * @param pattern - Pattern to search for.
 * @param messageFn - Formatter for violation message.
 * @param suggestion - Remediation guidance.
 * @param trigger - Fast text trigger substring (necessary condition).
 * @returns Configured GovernanceRule instance.
 */
function createTypeGovernanceRule(
    id: 'GOV-TYP-004' | 'GOV-TYP-005',
    name: string,
    risk: 'medium' | 'high',
    rationale: string,
    pattern: RegExp,
    messageFn: (m: RegExpExecArray) => string,
    suggestion: string,
    trigger: string,
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
        textTrigger: trigger,
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
    targetKinds: [NodeKind.Function, NodeKind.Method],
    checkNode(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.capabilities.supportsStaticTyping) return null;
        if (!ctx.node.functionLike) return null;

        const lang = ctx.capabilities.languageId;
        const startLine = ctx.node.start?.line;
        if (!startLine || startLine > ctx.masked.length) return null;

        const signatureLine = ctx.masked[startLine - 1];

        if (lang === 'gdscript') {
            const violation = checkGdFunctionSignature(signatureLine, startLine);
            if (violation) return [violation];
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
    risk: RISK_HIGH,
    rationale: 'Naked `any` bypasses the entire compiler type checker, leaking type instability.',
    isFixable: false,
    languages: ['typescript'],
    textTrigger: 'any',
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes('any')) return null;

        const violations: GovernanceViolation[] = [];
        checkUnsafeAny(ctx.masked, violations);
        return violations.length > 0 ? violations : null;
    },
};

/**
 * GOV-TYP-004: Contract-Forced Escape Hatch / ISP Violation.
 */
export const ContractForcedEscapeRule: GovernanceRule = createTypeGovernanceRule(
    RULE_ID_GOV_TYP_004,
    'Contract-Forced Escape Hatch Elimination',
    RISK_MEDIUM,
    'Passing or assigning `undefined as any` indicates an ISP violation. Design optional parameters instead.',
    FORCED_ESCAPE_RE,
    () => 'Avoid `undefined as any` or `null as any`; refactor interface to optional type (`?`).',
    'Update the target parameter signature to allow `undefined` or use interface segregation.',
    'as any',
);

/**
 * GOV-TYP-005: Unsafe Property Penetration.
 */
export const UnsafePropertyPenetrationRule: GovernanceRule = createTypeGovernanceRule(
    RULE_ID_GOV_TYP_005,
    'Unsafe Property Penetration Elimination',
    RISK_HIGH,
    'Accessing properties via `(expr as any).prop` bypasses compiler type safety.',
    PROPERTY_PENETRATION_RE,
    (m) => `Unsafe property penetration on \`${m[1]}\` via \`as any\`. Use standard type guards.`,
    'Use standard type guards before accessing properties.',
    'as any',
);

/**
 * GOV-TYP-006: Exported Symbol Explicit Return Type Protection.
 * Enforces explicit return type annotations on exported functions and arrow functions.
 */
export const ExportExplicitTypeRule: GovernanceRule = {
    id: 'GOV-TYP-006',
    name: 'Exported Symbol Explicit Return Type Protection',
    category: TYPE_SYSTEM_CATEGORY,
    severity: SEVERITY_WARNING,
    risk: RISK_MEDIUM,
    rationale:
        'Exported symbols without explicit return types leak internal implementation details and lead to unstable public API contracts across package boundaries.',
    isFixable: false,
    languages: ['typescript'],
    textTrigger: EXPORT_KEYWORD,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes(EXPORT_KEYWORD)) return null;

        const violations: GovernanceViolation[] = [];
        checkExportedFunctionReturnTypes(ctx.masked, ctx.filePath, violations);
        return violations.length > 0 ? violations : null;
    },
};

/**
 * Collection of all type system governance rules for bulk registration.
 */
export const TYPE_SYSTEM_GOVERNANCE_RULES: readonly GovernanceRule[] = [
    ExplicitTypingRule,
    FunctionSignatureCompletenessRule,
    UnsafeAnyRule,
    ContractForcedEscapeRule,
    UnsafePropertyPenetrationRule,
    ExportExplicitTypeRule,
];
