/**
 * Module: Core Engine - Governance Rules - Maintainability
 * File Path: src/core/governance/rules/maintainability.ts
 * Architecture Role: File-level rule provider exporting InheritanceDepthRule and
 *     DomainDecouplingRule; GovernanceAnalyzer calls each checkFile once per file in finalize().
 * Dependencies & Triggers: Imports shared governance types; capability gating requires
 *     supportsClassInheritance for depth checks, while path gates restrict decoupling checks to
 *     domain/domains trees and non-CLI core paths during every governance-enabled scan.
 * Responsibilities: InheritanceDepthRule flags TS/GDScript extends whose superclass names contain
 *     Sub, Derived or Child, and rejects GDScript domain/backend classes extending UI node types;
 *     DomainDecouplingRule reports imports of forbidden presentation/framework packages such as
 *     react, vue, electron, vscode, express, koa, commander and yargs.
 * Exit Semantics & Design Rationale: checkFile returns null for skipped or clean files and a
 *     violation list otherwise; it never throws and findings are non-fixable. Composition and
 *     ports-and-adapters are preferred because deep inheritance is fragile and framework coupling
 *     would make the core domain unportable.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';

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
 * GOV-MNT-001: Excessive Class Inheritance Depth (SIM-INH-001 generalized).
 * Limits class inheritance depth to <= 2 (Composition over Inheritance).
 */
export const InheritanceDepthRule: GovernanceRule = {
    id: 'GOV-MNT-001',
    name: 'Class Inheritance Depth Constraint (<= 2)',
    category: 'maintainability',
    severity: 'warning',
    risk: 'medium',
    rationale:
        'Deep class inheritance hierarchies (> 2 levels) introduce fragile base class problems; composition is preferred.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.capabilities.supportsClassInheritance) return null;
        if (!ctx.content.includes(KEYWORD_EXTENDS)) return null;

        const violations: GovernanceViolation[] = [];
        // RAW view on purpose: this family matches module specifiers and layer paths, which live
        // INSIDE string literals that the masked view blanks. Masking made GOV-MNT-002 stop firing
        // on its own fixture (caught by validate-governance check 5).
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
    category: 'maintainability',
    severity: 'error',
    risk: 'critical',
    rationale:
        'Domain layer must remain clean and portable; importing UI or CLI presentation frameworks introduces severe coupling.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const p = ctx.filePath.replace(/\\/g, '/').toLowerCase();
        // Only check files explicitly in domain, core, or model directories
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
