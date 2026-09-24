/**
 * Module: Core Engine - Governance Rules - Maintainability
 * File Path: src/core/governance/rules/maintainability.ts
 * Architecture Role: File-level rule provider exporting InheritanceDepthRule,
 *     DomainDecouplingRule, and DataClumpsRule; GovernanceAnalyzer calls each checkFile once
 *     per file in finalize().
 * Dependencies & Triggers: Imports shared governance types; capability gating requires
 *     supportsClassInheritance for depth checks, while path gates restrict decoupling checks to
 *     domain/domains trees and non-CLI core paths during every governance-enabled scan.
 * Responsibilities: InheritanceDepthRule flags TS/GDScript extends whose superclass names contain
 *     Sub, Derived or Child, and rejects GDScript domain/backend classes extending UI node types;
 *     DomainDecouplingRule reports imports of forbidden presentation/framework packages;
 *     DataClumpsRule flags functions with excessive discrete parameters (>= 5).
 * Exit Semantics & Design Rationale: checkFile returns null for skipped or clean files and a
 *     violation list otherwise; it never throws and findings are non-fixable.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';

const MAINTAINABILITY_CATEGORY = 'maintainability';
const RISK_CRITICAL = 'critical' as const;
const RISK_MEDIUM = 'medium' as const;
const SEVERITY_ERR = 'error' as const;
const SEVERITY_WARN = 'warning' as const;
const SEVERITY_INFO_LEVEL = 'info' as const;

const EXTENDS_RE = /\bclass\s+([a-zA-Z0-9_$]+)\s+extends\s+([a-zA-Z0-9_$.]+)/;
const GD_EXTENDS_RE = /^\s*extends\s+([a-zA-Z0-9_$.]+)/;

const FORBIDDEN_IMPORTS = [
    'react',
    'vue',
    'electron',
    'vscode',
    'express',
    'koa',
    'commander',
    'yargs',
];

const FORBIDDEN_IMPORT_PATTERNS = FORBIDDEN_IMPORTS.map((pkg) => ({
    pkg,
    re: new RegExp(`(?:from|require\\s*\\()\\s*['"]${pkg}['"]`),
}));

const KEYWORD_EXTENDS = 'extends';

const SUBCLASS_HEURISTIC_RE = /(?:Sub|Derived|Child)/;
const UI_NODES_SET = new Set(['Control', 'Node2D', 'Node3D', 'CanvasItem']);
const IMPORT_KEYWORD_RE = /\b(?:from|require)\b/;
const EXTENDS_KEYWORD_RE = /\bextends\b/;

const FUNC_START_RE =
    /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(|(?:export\s+)?const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(/;
const PY_GD_FUNC_RE = /(?:def|func)\s+([a-zA-Z0-9_$]+)\s*\(/;
const DEFAULT_MAX_PARAMS = 5;
const MAX_PARAM_LOOKAHEAD_LINES = 20;

const OPEN_BRACKETS = new Set(['(', '<', '{', '[']);
const CLOSE_BRACKETS = new Set([')', '>', '}', ']']);

function toPascalCase(name: string): string {
    if (!name) return 'Function';
    return name[0].toUpperCase() + name.slice(1);
}

function countTopLevelParams(paramStr: string): number {
    const trimmed = paramStr.trim();
    if (!trimmed) return 0;
    let depth = 0;
    let commas = 0;
    for (let j = 0; j < trimmed.length; j++) {
        const c = trimmed[j];
        if (OPEN_BRACKETS.has(c)) {
            depth++;
        } else if (CLOSE_BRACKETS.has(c)) {
            depth--;
        } else if (c === ',' && depth === 0) {
            commas++;
        }
    }
    const trailingAdjust = trimmed.endsWith(',') && commas > 0 ? -1 : 0;
    return commas + 1 + trailingAdjust;
}

/**
 * Checks a line for forbidden framework imports and appends violations.
 */
function checkLineForbiddenImports(
    line: string,
    lineIndex: number,
    violations: GovernanceViolation[],
): void {
    for (const { pkg, re } of FORBIDDEN_IMPORT_PATTERNS) {
        if (re.test(line)) {
            violations.push({
                ruleId: 'GOV-MNT-002',
                message: `Core domain module imports presentation/framework package \`${pkg}\`.`,
                line: lineIndex + 1,
                column: 1,
                suggestion: `Decouple domain logic from \`${pkg}\` using ports-and-adapters (dependency inversion).`,
                fixable: false,
            });
            break;
        }
    }
}

/**
 * Scans lines for forbidden framework imports and collects violation records.
 */
function findForbiddenImportViolations(lines: string[]): GovernanceViolation[] {
    const violations: GovernanceViolation[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!IMPORT_KEYWORD_RE.test(line)) continue;
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        checkLineForbiddenImports(line, i, violations);
    }
    return violations;
}

/**
 * Checks a line for inheritance depth violations and appends findings.
 */
function checkExtendsLine(
    line: string,
    lineIndex: number,
    isDomainOrBackend: boolean,
    violations: GovernanceViolation[],
): void {
    const m = line.match(EXTENDS_RE);
    if (m) {
        const className = m[1];
        const superName = m[2];
        if (SUBCLASS_HEURISTIC_RE.test(superName)) {
            violations.push({
                ruleId: 'GOV-MNT-001',
                message: `Class \`${className}\` extends \`${superName}\`, potentially exceeding max inheritance depth of 2.`,
                line: lineIndex + 1,
                column: m.index != null ? m.index + 1 : 1,
                suggestion:
                    'Refactor deep class hierarchy into single domain class + composition strategy pattern.',
                fixable: false,
            });
        }
    }

    const mGd = line.match(GD_EXTENDS_RE);
    if (mGd && isDomainOrBackend) {
        const superName = mGd[1];
        if (UI_NODES_SET.has(superName)) {
            violations.push({
                ruleId: 'GOV-MNT-001',
                message: `Domain model extends presentation node \`${superName}\`. Pure domain classes must extend RefCounted.`,
                line: lineIndex + 1,
                column: mGd.index != null ? mGd.index + 1 : 1,
                suggestion:
                    'Change base class to `RefCounted` and decouple presentation via EventBus.',
                fixable: false,
            });
        }
    }
}

/**
 * Collects parameter text across lines until the closing parenthesis.
 */
function extractParameterText(
    lines: string[],
    startLineIdx: number,
    openParenIdx: number,
): string | null {
    let accumulated = lines[startLineIdx].slice(openParenIdx + 1);
    let depth = 1;
    for (let j = 0; j < accumulated.length; j++) {
        const ch = accumulated[j];
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) return accumulated.slice(0, j);
        }
    }

    const maxLine = Math.min(lines.length, startLineIdx + MAX_PARAM_LOOKAHEAD_LINES);
    for (let k = startLineIdx + 1; k < maxLine; k++) {
        const line = lines[k];
        for (let j = 0; j < line.length; j++) {
            const ch = line[j];
            if (ch === '(') depth++;
            else if (ch === ')') {
                depth--;
                if (depth === 0) {
                    accumulated += ' ' + line.slice(0, j);
                    return accumulated;
                }
            }
        }
        accumulated += ' ' + line;
    }
    return null;
}

function inspectFunctionAtLine(
    line: string,
    lines: string[],
    lineIndex: number,
    threshold: number,
    violations: GovernanceViolation[],
): void {
    const m = line.match(FUNC_START_RE) || line.match(PY_GD_FUNC_RE);
    if (!m) return;

    const funcName = m[1] || m[2];
    if (!funcName || funcName === 'constructor') return;

    const openIdx = line.indexOf('(', m.index ?? 0);
    if (openIdx === -1) return;

    const paramText = extractParameterText(lines, lineIndex, openIdx);
    if (!paramText) return;

    const paramCount = countTopLevelParams(paramText);
    if (paramCount < threshold) return;

    const pascal = toPascalCase(funcName);
    violations.push({
        ruleId: 'GOV-DAT-001',
        message: `Function \`${funcName}\` declares ${paramCount} discrete parameters (threshold: ${threshold}). Excessive scalar parameters exhibit Data Clumps smell.`,
        line: lineIndex + 1,
        column: 1,
        suggestion: `Aggregate related parameters into a strongly-typed Context or Options interface (e.g. \`${pascal}Context\` or \`${pascal}Options\`).`,
        fixable: false,
    });
}

/**
 * GOV-MNT-001: Excessive Class Inheritance Depth (SIM-INH-001 generalized).
 * Limits class inheritance depth to <= 2 (Composition over Inheritance).
 */
export const InheritanceDepthRule: GovernanceRule = {
    id: 'GOV-MNT-001',
    name: 'Class Inheritance Depth Constraint (<= 2)',
    category: MAINTAINABILITY_CATEGORY,
    severity: SEVERITY_WARN,
    risk: RISK_MEDIUM,
    rationale:
        'Deep class inheritance hierarchies (> 2 levels) introduce fragile base class problems; composition is preferred.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.capabilities.supportsClassInheritance) return null;
        if (!ctx.content.includes(KEYWORD_EXTENDS)) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.lines;
        const normalizedPath = ctx.filePath.replace(/\\/g, '/');
        const isDomainOrBackend =
            normalizedPath.includes('/domain') || normalizedPath.includes('/backend/');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!EXTENDS_KEYWORD_RE.test(line)) continue;
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
            checkExtendsLine(line, i, isDomainOrBackend, violations);
        }

        return violations.length > 0 ? violations : null;
    },
};

/**
 * GOV-MNT-002: Pure Domain Model Framework & UI Decoupling (ADV-DEC-001 generalized).
 * Enforces unidirectional dependency flow: core domain models must not import UI /
 * framework packages.
 */
export const DomainDecouplingRule: GovernanceRule = {
    id: 'GOV-MNT-002',
    name: 'Pure Domain Model Framework Decoupling',
    category: MAINTAINABILITY_CATEGORY,
    severity: SEVERITY_ERR,
    risk: RISK_CRITICAL,
    rationale:
        'Domain layer must remain clean and portable; importing UI or CLI presentation frameworks introduces severe coupling.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const p = ctx.filePath.replace(/\\/g, '/').toLowerCase();
        const isDomain =
            p.includes('/domain/') ||
            p.includes('/domains/') ||
            (p.includes('/core/') && !p.includes('/cli/'));
        if (!isDomain) return null;

        if (!FORBIDDEN_IMPORTS.some((pkg) => ctx.content.includes(pkg))) return null;

        const violations = findForbiddenImportViolations(ctx.lines);
        return violations.length > 0 ? violations : null;
    },
};

/**
 * GOV-DAT-001: Data Clumps & Discrete Parameter Overload.
 * Flags functions declaring >= 5 discrete parameters, suggesting Context or Options interfaces.
 */
export const DataClumpsRule: GovernanceRule = {
    id: 'GOV-DAT-001',
    name: 'Data Clumps Parameter Convergence',
    category: MAINTAINABILITY_CATEGORY,
    severity: SEVERITY_INFO_LEVEL,
    risk: RISK_MEDIUM,
    rationale:
        'Functions with excessive discrete scalar parameters (>= 5) exhibit Data Clumps smell; parameters should be aggregated into a named Context or Options interface.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (/\.(d\.ts)$/.test(ctx.filePath)) return null;
        if (/(^|\/)(tests?|__tests__|fixtures?)\//.test(ctx.filePath)) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

            inspectFunctionAtLine(line, lines, i, DEFAULT_MAX_PARAMS, violations);
        }

        return violations.length > 0 ? violations : null;
    },
};
