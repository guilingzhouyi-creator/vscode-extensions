/**
 * Module: Core Intelligence — Boundary Discipline & Anti-Utils Governance Engine
 * File Path: src/core/intelligence/boundary-discipline-engine.ts
 * Architecture Role: Architectural cleanliness and anti-over-abstraction guardian
 *   that eradicates monolithic junk-drawer utility files and prevents harmful cycles.
 * Dependencies & Triggers: Consumes Issue schema and dimensionLiterals; invoked during
 *   architecture and boundary discipline audit passes.
 * Responsibilities: Enforce anti-utils discipline (ARCH-UTL-001); route common logic into
 *   the four canonical destination streams (algorithms, constants, policies, foundation);
 *   intercept spurious indirection and cyclic cross-domain sharing (ARCH-ABS-001).
 * Exit Semantics & Design Rationale: Deterministic AST and symbol cohesion analysis without
 *   disk I/O. Guarantees deduplication never degrades into fragile god objects or cycles.
 */

import type { Issue } from '../types';
import { SEVERITY_WARNING } from '../types';
import {
    ANALYZER_ARCHITECTURE,
    RULE_ARCH_UTL_001,
    RULE_ARCH_ABS_001,
} from '../scoring/dimensionLiterals';

/**
 * 4 Canonical Destination Streams for Reusable Logic.
 */
export type DestinationStream =
    | 'algorithm_operator_library'
    | 'constant_registry_library'
    | 'rule_policy_module'
    | 'foundation_capability_layer';

/**
 * Descriptor of an exported utility or helper function analyzed for destination routing.
 */
export interface UtilitySymbolDescriptor {
    name: string;
    line: number;
    category:
        'math' | 'constant' | 'validation_rule' | 'formatting' | 'io_transport' | 'domain_dto';
    suggestedStream: DestinationStream;
    isPure: boolean;
}

/**
 * Descriptor of a file inspected for utility anti-patterns.
 */
export interface UtilityFileInspectionContext {
    filePath: string;
    loc: number;
    exportedSymbols: UtilitySymbolDescriptor[];
    distinctCategoryCount: number;
    isGenericUtilityName: boolean;
    hasCyclicDependencies: boolean;
    delegationHopDepth: number;
}

/**
 * Result of boundary discipline and anti-utils evaluation.
 */
export interface BoundaryDisciplineResult {
    evaluatedFiles: number;
    issues: Issue[];
}

const GENERIC_UTIL_NAME_PATTERN =
    /(?:^|\/|\\)(?:utils?|helpers?|common|tools?|misc|shared-utils?)(?:\.[a-zA-Z0-9]+)?$/i;

/**
 * Determines whether a file path represents a generic catch-all utility name.
 *
 * @param filePath - Physical or normalized file path.
 * @returns True if path matches catch-all utility naming.
 */
export function isGenericUtilityFilePath(filePath: string): boolean {
    const base = filePath.replace(/\\/g, '/');
    return GENERIC_UTIL_NAME_PATTERN.test(base);
}

/**
 * Classifies an exported routine into one of the four canonical destination streams.
 *
 * @param name - Symbol name.
 * @param _isPure - Purity state.
 * @returns Inferred destination stream and category.
 */
export function routeSymbolDestination(
    name: string,
    _isPure: boolean,
): { stream: DestinationStream; category: UtilitySymbolDescriptor['category'] } {
    const lower = name.toLowerCase();

    // 1. Math / Numerical / Geometry
    if (
        /^(?:calc|math|matrix|clamp|lerp|vector|sin|cos|round|smooth|distance|dot|cross)/i.test(
            lower,
        ) ||
        /(?:math|calc|matrix|lerp)/i.test(lower)
    ) {
        return { stream: 'algorithm_operator_library', category: 'math' };
    }

    // 2. Constants / Enums / Protocol Codes
    if (
        /^[A-Z0-9_]{3,}$/.test(name) ||
        /^(?:DEFAULT_|MAX_|MIN_|CONFIG_|ERR_|CODE_|STATUS_)/.test(name)
    ) {
        return { stream: 'constant_registry_library', category: 'constant' };
    }

    // 3. Rules / Validation / Policy
    if (
        /^(?:validate|verify|check|assert|isallowed|canexecute|evaluaterule)/i.test(lower) ||
        lower.endsWith('rule') ||
        lower.endsWith('policy')
    ) {
        return { stream: 'rule_policy_module', category: 'validation_rule' };
    }

    // 4. Default: Foundation Capability / Formatters
    return { stream: 'foundation_capability_layer', category: 'formatting' };
}

function createBoundaryIssue(
    rule: typeof RULE_ARCH_UTL_001 | typeof RULE_ARCH_ABS_001,
    filePath: string,
    message: string,
    detail: Record<string, unknown>,
    suggestion: string,
): Issue {
    return {
        id: `architecture:${rule}:${filePath}:1`,
        analyzer: ANALYZER_ARCHITECTURE,
        rule,
        severity: SEVERITY_WARNING,
        message,
        location: {
            file: filePath,
            start: { line: 1, column: 1 },
            end: { line: 1, column: 80 },
        },
        detail,
        suggestion,
    };
}

function evaluateGodUtilityRisk(ctx: UtilityFileInspectionContext): Issue | null {
    const isJunkDrawer =
        (ctx.isGenericUtilityName && ctx.distinctCategoryCount >= 3) ||
        ctx.distinctCategoryCount >= 4;

    if (!isJunkDrawer) {
        return null;
    }

    const categories = [...new Set(ctx.exportedSymbols.map((s) => s.category))].join(', ');
    return createBoundaryIssue(
        RULE_ARCH_UTL_001,
        ctx.filePath,
        `Monolithic god-object utility anti-pattern detected in "${ctx.filePath}": file aggregates ` +
            `${ctx.exportedSymbols.length} disparate symbols across ${ctx.distinctCategoryCount} distinct categories [${categories}].`,
        {
            distinctCategoryCount: ctx.distinctCategoryCount,
            symbolCount: ctx.exportedSymbols.length,
            categories,
        },
        'Decompose catch-all utility into four canonical destinations: algorithms, constants, policy rules, and foundation.',
    );
}

function evaluateOverAbstractionRisk(ctx: UtilityFileInspectionContext): Issue | null {
    if (ctx.delegationHopDepth < 3 && !ctx.hasCyclicDependencies) {
        return null;
    }

    const reason = ctx.hasCyclicDependencies
        ? 'sharing abstraction creates circular dependencies across domain boundaries'
        : `spurious delegation indirection chain depth (${ctx.delegationHopDepth} hops) yields negative net cognitive value`;

    return createBoundaryIssue(
        RULE_ARCH_ABS_001,
        ctx.filePath,
        `Harmful over-abstraction detected in "${ctx.filePath}": ${reason}.`,
        {
            delegationHopDepth: ctx.delegationHopDepth,
            hasCyclicDependencies: ctx.hasCyclicDependencies,
        },
        'Inline trivial forwarding hops or permit localized implementations to prevent cyclic coupling.',
    );
}

/**
 * Evaluates a utility file context for god-object junk-drawer anti-patterns and over-abstraction.
 *
 * @param ctx - File inspection context.
 * @returns Emitted boundary discipline issues.
 */
export function evaluateUtilityFile(ctx: UtilityFileInspectionContext): Issue[] {
    const issues: Issue[] = [];
    const godUtil = evaluateGodUtilityRisk(ctx);
    if (godUtil) issues.push(godUtil);

    const overAbs = evaluateOverAbstractionRisk(ctx);
    if (overAbs) issues.push(overAbs);

    return issues;
}

/**
 * Audits repository-wide boundary discipline and anti-utils cleanliness.
 *
 * @param files - Inspection contexts for candidate files.
 * @returns Comprehensive boundary discipline result.
 */
export function auditBoundaryDiscipline(
    files: UtilityFileInspectionContext[],
): BoundaryDisciplineResult {
    const issues: Issue[] = [];
    for (const f of files) {
        issues.push(...evaluateUtilityFile(f));
    }

    return {
        evaluatedFiles: files.length,
        issues,
    };
}
