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

/**
 * Scans lines for forbidden framework imports and collects violation records.
 */
function findForbiddenImportViolations(lines: string[]): GovernanceViolation[] {
    const violations: GovernanceViolation[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('from') && !line.includes('require')) continue;
        if (line.trim().startsWith('//') || line.trim().startsWith('#')) continue;

        for (const { pkg, re } of FORBIDDEN_IMPORT_PATTERNS) {
            if (line.includes(pkg) && re.test(line)) {
                violations.push({
                    ruleId: 'GOV-MNT-002',
                    message: `Core domain module imports presentation/framework package \`${pkg}\`.`,
                    line: i + 1,
                    column: 1,
                    suggestion: `Decouple domain logic from \`${pkg}\` using ports-and-adapters (dependency inversion).`,
                    fixable: false,
                });
                break;
            }
        }
    }
    return violations;
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

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes(KEYWORD_EXTENDS)) continue;
            if (line.trim().startsWith('//') || line.trim().startsWith('#')) continue;

            const m = line.match(EXTENDS_RE);
            if (m) {
                const className = m[1];
                const superName = m[2];
                // Heuristic: If superName is already a specific subclass (contains Sub/Derived
                // or known multi-level pattern)
                if (
                    superName.includes('Sub') ||
                    superName.includes('Derived') ||
                    superName.includes('Child')
                ) {
                    violations.push({
                        ruleId: 'GOV-MNT-001',
                        message: `Class \`${className}\` extends \`${superName}\`, potentially exceeding max inheritance depth of 2.`,
                        line: i + 1,
                        column: line.indexOf(KEYWORD_EXTENDS) + 1,
                        suggestion:
                            'Refactor deep class hierarchy into single domain class + composition strategy pattern.',
                        fixable: false,
                    });
                }
            }

            const mGd = line.match(GD_EXTENDS_RE);
            if (mGd) {
                const superName = mGd[1];
                const p = ctx.filePath.replace(/\\/g, '/');
                // If in backend/domain and extends a UI node type (ADV-DEC-001 in GDScript)
                if (p.includes('/domain') || p.includes('/backend/')) {
                    const UI_NODES = ['Control', 'Node2D', 'Node3D', 'CanvasItem', 'Control'];
                    if (UI_NODES.includes(superName)) {
                        violations.push({
                            ruleId: 'GOV-MNT-001',
                            message: `Domain model extends presentation node \`${superName}\`. Pure domain classes must extend RefCounted.`,
                            line: i + 1,
                            column: line.indexOf(KEYWORD_EXTENDS) + 1,
                            suggestion:
                                'Change base class to `RefCounted` and decouple presentation via EventBus.',
                            fixable: false,
                        });
                    }
                }
            }
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
