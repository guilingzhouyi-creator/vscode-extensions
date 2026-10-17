/**
 * Module: Core Intelligence — Architecture Boundary Checks
 * File Path: src/core/intelligence/architectureBoundaryChecks.ts
 * Architecture Role: Per-file boundary checks used by the semantic architecture verifier.
 * Dependencies & Triggers: ../types, ../semanticTypes, ./semanticArchitecture (file descriptor
 *   and the forbidden-headless set); invoked by verifyArchitectureBoundaries per analyzed file.
 * Responsibilities: Report headless violations, cross-domain bypasses, mutable global coupling,
 *   layering illusions, and configuration leakage as structured architecture issues.
 * Exit Semantics & Design Rationale: Pure per-file checks that only push into the caller issue
 *   accumulator and never throw; traversal and option defaults stay with the caller.
 */

import type { Issue, Severity } from '../types';
import { SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR } from '../types';
import type { SemanticEvidenceStep, SemanticReviewDetail } from '../semantic-types';
import type { ArchitecturalFileInfo } from './semanticArchitecture';
import { FORBIDDEN_HEADLESS_IMPORTS } from './semanticArchitecture';

const [ACTIVE_SEV_ERROR, ACTIVE_SEV_WARN, ACTIVE_SEV_INFO] = [
    SEVERITY_ERROR,
    SEVERITY_WARNING,
    SEVERITY_INFO,
];

/** Evidence-chain step kind tags. */
const KIND_CALL: SemanticEvidenceStep['kind'] = 'call';
const KIND_VARIABLE: SemanticEvidenceStep['kind'] = 'variable';
const KIND_CONDITION: SemanticEvidenceStep['kind'] = 'condition';

/** Rule ids owned by this module. */
const RULE_ARCH_HDL_001 = 'ARCH-HDL-001';
const RULE_ARCH_BND_001 = 'ARCH-BND-001';
const RULE_ARCH_GLB_001 = 'ARCH-GLB-001';
const RULE_ARCH_DIR_003 = 'ARCH-DIR-003';
const RULE_ARCH_CFG_001 = 'ARCH-CFG-001';

/** Analyzer metadata constants. */
const ANALYZER_ARCHITECTURE = 'architecture';
const LANGUAGE_TYPESCRIPT = 'typescript';
const CODE_DOMAIN_BOUNDARIES = 'architecture-boundaries';
const RULE_VERSION = '1.0.0';
const CONFIG_VERSION = '0.3.0';
const DEFAULT_END_COLUMN = 80;

/** Domain and layer string constants. */
const LAYER_DOMAIN = 'domain';
const LAYER_TEST = 'test';

/** Path segment constants for private internal checks. */
const INTERNAL_PATH_SEGMENT = '/internal/';
const IMPL_PATH_SEGMENT = '/impl/';
const PRIVATE_PATH_SEGMENT = '/private/';

/** Symbol tokens for architecture boundary findings. */
const SYMBOL_GLOBAL_STATE = 'globalState';
const SYMBOL_LAYER_INVERSION = 'layer-inversion';
const SYMBOL_CONFIG_ACCESS = 'config-access';

/** Infrastructure layer keywords for layering illusion checks. */
const INFRA_KEYWORDS_TOKEN = 'infra,database,driver,repository';
const INFRA_KEYWORDS: readonly string[] = INFRA_KEYWORDS_TOKEN.split(',');

/**
 * Report whether an import reaches into a private internal subdirectory.
 *
 * @param spec - Import specifier being inspected.
 * @returns True when the specifier targets /internal/, /impl/, or /private/.
 */
function isPrivateInternalImport(spec: string): boolean {
    return (
        spec.includes(INTERNAL_PATH_SEGMENT) ||
        spec.includes(IMPL_PATH_SEGMENT) ||
        spec.includes(PRIVATE_PATH_SEGMENT)
    );
}

/** Tuple holding static boundary rule metadata to prevent flat property declaration clusters. */
type RuleSpecTuple = readonly [
    Severity,
    SemanticEvidenceStep['kind'],
    string, // triggerCondition
    string, // risk
    string, // suggestedFix
    string, // verificationMethod
    string, // suggestion
    number, // confidence
];

const RULE_SPECS_MAP: ReadonlyMap<string, RuleSpecTuple> = new Map([
    [
        RULE_ARCH_HDL_001,
        [
            ACTIVE_SEV_ERROR,
            KIND_CALL,
            'Core business logic or headless engine depends on UI / IDE presentation framework',
            'Destroys headless execution capability, prevents automated CI testing, and binds business rules to UI lifecycle.',
            'Decouple core domain logic from UI framework; emit events or return pure data structures instead.',
            'Verify module executes in a headless Node or CLI environment without UI dependencies.',
            'Remove UI dependency from core logic; interact through headless interfaces or events.',
            1.0,
        ],
    ],
    [
        RULE_ARCH_BND_001,
        [
            ACTIVE_SEV_WARN,
            KIND_CALL,
            'Import path reaches into /internal/, /impl/, or /private/ subdirectories of another domain',
            'Couples calling code to private implementation details, preventing internal refactoring.',
            'Import through the domain public API barrel or export interface.',
            'Verify imports reference only index or public export interfaces.',
            'Depend on public domain facades or interfaces rather than private internal modules.',
            0.95,
        ],
    ],
    [
        RULE_ARCH_GLB_001,
        [
            ACTIVE_SEV_WARN,
            KIND_VARIABLE,
            'Module exports or mutates global mutable variables across architectural boundaries',
            'Creates hidden temporal coupling, race conditions in concurrent execution, and untestable global side effects.',
            'Encapsulate mutable state in explicit class instances passed via dependency injection.',
            'Verify module state is isolated per instance without global static mutations.',
            'Replace shared global mutable state with scoped instance dependency injection.',
            0.9,
        ],
    ],
    [
        RULE_ARCH_DIR_003,
        [
            ACTIVE_SEV_ERROR,
            KIND_CONDITION,
            'Domain model imports infrastructure or database components directly',
            'Inverted dependency direction makes business domain dependent on persistent infrastructure mechanisms.',
            'Define an interface in the domain layer and implement it in infrastructure (Dependency Inversion Principle).',
            'Verify domain layer has zero imports pointing to infrastructure layer.',
            'Invert dependency using interfaces defined in the domain layer.',
            0.95,
        ],
    ],
    [
        RULE_ARCH_CFG_001,
        [
            ACTIVE_SEV_INFO,
            KIND_VARIABLE,
            'Domain logic references environment variables or raw configuration files directly',
            'Domain logic becomes dependent on deployment environment settings and cannot be tested with pure in-memory models.',
            'Inject configuration values as typed domain parameters or options objects.',
            'Verify domain entity constructors accept strongly typed options instead of reading environment.',
            'Inject typed configuration via constructor arguments or factory parameters.',
            0.9,
        ],
    ],
]);
/** Narrative template holding textual descriptions for a boundary finding. */
type NarrativeTuple = readonly [string, string, string];

/**
 * Returns finding narrative texts for a specific boundary rule.
 */
function getBoundaryFindingNarrative(
    ruleId: string,
    filePath: string,
    symbol: string,
): NarrativeTuple {
    if (ruleId === RULE_ARCH_HDL_001) {
        return [
            `Pure domain / headless file imports UI framework '${symbol}'`,
            `Headless architecture violation: core logic in '${filePath}' imports presentation dependency '${symbol}'.`,
            `Headless / domain module '${filePath}' binds directly to presentation framework '${symbol}'.`,
        ];
    }
    if (ruleId === RULE_ARCH_BND_001) {
        return [
            `Direct import of internal private implementation: '${symbol}'`,
            `Cross-domain internal bypass: '${filePath}' imports private module '${symbol}'.`,
            `File '${filePath}' bypasses public domain facade to access internal private module '${symbol}'.`,
        ];
    }
    if (ruleId === RULE_ARCH_GLB_001) {
        return [
            `Module-level mutable global state detected in '${filePath}'`,
            `Implicit shared mutable global state in '${filePath}'.`,
            'Exposing shared mutable state across module boundaries.',
        ];
    }
    if (ruleId === RULE_ARCH_DIR_003) {
        return [
            `Domain file '${filePath}' directly imports infrastructure layer`,
            `Structural layering illusion: domain file '${filePath}' directly imports infrastructure.`,
            'Clean architecture dependency inversion: domain entity depends on outer infrastructure layer.',
        ];
    }
    return [
        `Direct environment or configuration access in pure domain file '${filePath}'`,
        `Configuration leakage: domain file '${filePath}' reads environment or config directly.`,
        'Reading process.env or disk config directly in domain model.',
    ];
}

interface ReviewDetailInputs {
    readonly domainName: string;
    readonly symbol: string;
    readonly filePath: string;
    readonly behaviorText: string;
    readonly evidence: SemanticEvidenceStep[];
    readonly spec: RuleSpecTuple;
}

function createReviewDetail(inputs: ReviewDetailInputs): SemanticReviewDetail {
    const [, , triggerCondition, risk, suggestedFix, verificationMethod] = inputs.spec;
    return {
        language: LANGUAGE_TYPESCRIPT,
        module: inputs.domainName,
        symbol: inputs.symbol,
        codeDomain: CODE_DOMAIN_BOUNDARIES,
        currentBehavior: inputs.behaviorText,
        semanticEvidenceChain: inputs.evidence,
        triggerCondition,
        risk,
        blastRadius: [inputs.filePath],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix,
        impactedCallers: [],
        impactedTests: [],
        verificationMethod,
        ruleVersion: RULE_VERSION,
        configVersion: CONFIG_VERSION,
        canAutofix: false,
    };
}

/**
 * Builds a standardized architecture boundary issue.
 */
function buildBoundaryIssue(ruleId: string, file: ArchitecturalFileInfo, symbol: string): Issue {
    const spec = RULE_SPECS_MAP.get(ruleId);
    if (!spec) {
        throw new Error(`Unregistered boundary rule: ${ruleId}`);
    }
    const [severity, evidenceKind, , , , , suggestion, confidence] = spec;

    const [evidenceDesc, messageText, behaviorText] = getBoundaryFindingNarrative(
        ruleId,
        file.filePath,
        symbol,
    );

    const evidence: SemanticEvidenceStep[] = [
        {
            kind: evidenceKind,
            description: evidenceDesc,
            file: file.filePath,
            line: 1,
        },
    ];

    const detail = createReviewDetail({
        domainName: file.domainName,
        symbol,
        filePath: file.filePath,
        behaviorText,
        evidence,
        spec,
    });

    return {
        id: `architecture:${ruleId}:${file.filePath}:1`,
        analyzer: ANALYZER_ARCHITECTURE,
        rule: ruleId,
        severity,
        message: messageText,
        location: {
            file: file.filePath,
            start: { line: 1, column: 1 },
            end: { line: 1, column: DEFAULT_END_COLUMN },
        },
        detail,
        suggestion,
        evidence: {
            confidence,
            requiresRuntime: false,
        },
    };
}

/**
 * Headless architecture violation (ARCH-HDL-001): a domain file imports a UI framework.
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param enforceHeadless - Whether this check is enabled by the caller options.
 */
export function checkHeadlessImports(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    enforceHeadless: boolean,
): void {
    if (!enforceHeadless || (!file.isHeadless && file.inferredLayer !== LAYER_DOMAIN)) {
        return;
    }

    for (const imp of file.imports) {
        if (FORBIDDEN_HEADLESS_IMPORTS.has(imp)) {
            issues.push(buildBoundaryIssue(RULE_ARCH_HDL_001, file, imp));
        }
    }
}

/**
 * Cross-domain boundary bypass (ARCH-BND-001): an import reaches into an internal path.
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param flagBypass - Whether this check is enabled by the caller options.
 */
export function checkCrossDomainBypass(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    flagBypass: boolean,
): void {
    if (!flagBypass) {
        return;
    }

    for (const imp of file.imports) {
        if (isPrivateInternalImport(imp)) {
            issues.push(buildBoundaryIssue(RULE_ARCH_BND_001, file, imp));
        }
    }
}

/**
 * Shared mutable global state coupling (ARCH-GLB-001).
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param flagGlobal - Whether this check is enabled by the caller options.
 */
export function checkMutableGlobalCoupling(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    flagGlobal: boolean,
): void {
    if (flagGlobal && file.hasGlobalMutableState && file.inferredLayer !== LAYER_TEST) {
        issues.push(buildBoundaryIssue(RULE_ARCH_GLB_001, file, SYMBOL_GLOBAL_STATE));
    }
}

/**
 * Structural layering illusion (ARCH-DIR-003).
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param flagIllusions - Whether this check is enabled by the caller options.
 */
export function checkLayeringIllusion(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    flagIllusions: boolean,
): void {
    if (!flagIllusions || file.inferredLayer !== LAYER_DOMAIN) {
        return;
    }

    const hasInfraImport = file.imports.some((imp) =>
        INFRA_KEYWORDS.some((keyword) => imp.includes(keyword)),
    );
    if (hasInfraImport) {
        issues.push(buildBoundaryIssue(RULE_ARCH_DIR_003, file, SYMBOL_LAYER_INVERSION));
    }
}

/**
 * Direct configuration access in a pure domain (ARCH-CFG-001).
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param flagConfig - Whether this check is enabled by the caller options.
 */
export function checkConfigLeakage(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    flagConfig: boolean,
): void {
    if (flagConfig && file.inferredLayer === LAYER_DOMAIN && file.hasDirectConfigAccess) {
        issues.push(buildBoundaryIssue(RULE_ARCH_CFG_001, file, SYMBOL_CONFIG_ACCESS));
    }
}
