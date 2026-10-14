/**
 * Module: Static Analysis Engine — Architecture Boundary Rules
 * File Path: src/analyzers/architecture.ts
 * Architecture Role: Polyglot, line-oriented analyzer adapter that reports Clean Architecture
 *   violations — layer inversions and domain leaks — as canonical Issue records
 * Dependencies & Triggers: `path`, ../core/types, inferDirectorySemantic, ArchitectureMessages;
 *   triggered when the declarative `analyzers.architecture` entry is enabled by CLI / CI /
 *   daemon scans, and also through the standalone analyze() contract
 * Responsibilities: Resolve a file's layer from options, profile semantics and path heuristics;
 *   extract imports for TS/JS, GDScript, Python, Rust, Go, JVM and C#; flag forbidden domain
 *   frameworks (ARCH-LEAK-001), DTO credential leaks at full security (ARCH-LEAK-002) and
 *   direction breaches (ARCH-DIR-001/002); exempt test, tooling and shared layers
 * Exit Semantics & Design Rationale: Deterministic line scan returning [] when enforcement is
 *   disabled or the layer is exempt; it never throws, so one malformed file cannot abort the
 *   scan. Polyglot extraction keeps one rule engine for every language, while allowSkipLayers
 *   and checkDtoCredentialLeakage let teams stage adoption rather than flip an all-or-nothing
 *   gate.
 */
import type {
    Analyzer,
    AnalyzerContext,
    Issue,
    ArchitectureLayer,
    Severity,
    AgentActionType,
} from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR, SEVERITY_INFO } from '../core/types';
import { inferDirectorySemantic } from '../core/profiler/projectProfiler';
import { ArchitectureMessages } from '../core/messages/architecture';
import { FORBIDDEN_HEADLESS_IMPORTS } from '../core/intelligence/semanticArchitecture';
import { auditDispatchComplexity } from '../core/rules/evolution/dispatchComplexityRule';
import { auditTemplateComplexity } from '../core/rules/evolution/template-complexity-rule';
import { auditConfigDrivenArchitecture } from '../core/architecture/config-driven-architecture';
import { auditFacadeGovernance } from '../core/architecture/facade-governance-evaluator';
import {
    extractSpecifiers,
    type SpecifierInfo,
} from '../core/architecture/import-specifier-extractor';

/**
 * Threshold keys the architecture rules additionally read from the global `thresholds` block.
 */
interface ArchitectureThresholds {
    /** Extra package names the headless boundary check must reject. */
    headlessDisallowedImports?: string[];
}

/**
 * Configuration options governing Clean Architecture layer boundary enforcement.
 * Controls domain leak detection, skip-layer tolerance, and framework isolation invariants.
 */
interface ArchitectureOptions {
    enforceCleanLayers?: boolean;
    layers?: Record<string, ArchitectureLayer>;
    forbiddenDomainImports?: string[];
    allowSkipLayers?: boolean;
    securityLevel?: import('../core/types').SecurityLevel;
    checkDtoCredentialLeakage?: boolean;
    enforceHeadless?: boolean;
    headlessDisallowedImports?: string[];
    flagCrossDomainBypass?: boolean;
    flagMutableGlobalCoupling?: boolean;
    flagLayeringIllusions?: boolean;
    flagConfigLeakage?: boolean;
    protectedConfigKeywords?: string[];
    flagDispatchComplexity?: boolean;
    flagTemplateComplexity?: boolean;
}

/**
 * Execution state bundle passed through the architecture audit pipeline.
 * Encapsulates layer boundaries, active options, collected violations,
 * and forbidden module indices.
 */
interface ArchitectureAuditContext {
    file: string;
    currentLayer: ArchitectureLayer;
    ctx: AnalyzerContext;
    opts: ArchitectureOptions;
    forbiddenModules: Set<string>;
    issues: Issue[];
    customHeadlessSet?: Set<string>;
}

/**
 * Normalized target descriptor for an imported dependency undergoing layer boundary checks.
 */
interface LayerDependencyAuditTarget {
    spec: SpecifierInfo;
    resolvedPath: string;
    targetLayer: ArchitectureLayer;
    lineIdx: number;
}

/**
 * Intermediate issue creation draft specifying position, severity, message,
 * and actionable remediation.
 */
interface IssueDraft {
    lineIdx: number;
    rule: string;
    message: string;
    severity: Severity;
    detail: Record<string, any>;
    suggestion?: string;
}

interface ActionableSpec {
    action: AgentActionType;
    code: string;
    safeToAutomate: boolean;
    templateSnippet: string;
}

/** Rule identifier constants */
const RULE_FACADE = 'ARCH-FAC-001';
const RULE_FACADE_LEGACY = 'facade-without-payload';
const RULE_TRAMPOLINE = 'ARCH-ABS-001';
const RULE_TRAMPOLINE_LEGACY = 'trampoline-export';
const RULE_DOMAIN_LEAK = 'ARCH-LEAK-001';
const RULE_DOMAIN_LEAK_LEGACY = 'layer-inversion';
const RULE_DIRECTION_BREACH = 'ARCH-DIR-001';
const RULE_DIRECTION_BREACH_LEGACY = 'cyclic-dependency';
const RULE_SKIP_LAYER = 'ARCH-DIR-002';
const RULE_LAYERING_ILLUSION = 'ARCH-DIR-003';
const RULE_MUTABLE_GLOBAL = 'ARCH-GLB-001';
const RULE_CONFIG_LEAK = 'ARCH-CFG-001';
const RULE_DTO_CREDENTIAL_LEAK = 'ARCH-LEAK-002';
const RULE_HEADLESS_BREACH = 'ARCH-HDL-001';
const RULE_BOUNDARY_BYPASS = 'ARCH-BND-001';
const RULE_PARSER_COUPLING = 'ARCH-DEC-002';

/** Actionable code and action constants */
const CODE_ACTION_FACADE = 'AR:ARC:001';
const CODE_ACTION_TRAMPOLINE = 'AR:ARC:002';
const CODE_ACTION_INVERT = 'AR:ARC:003';
const CODE_ACTION_DECOMPOSE = 'AR:ARC:004';

const ACTION_DECOUPLE: AgentActionType = 'decouple_facade';
const ACTION_REPLACE: AgentActionType = 'replace_token';
const ACTION_NARROW: AgentActionType = 'narrow_scope';
const ACTION_DECOMPOSE: AgentActionType = 'decompose_module';

/** Actionable template snippets */
const SNIPPET_FACADE = 'export const ModuleFacade = Object.freeze({ ... });';
const SNIPPET_TRAMPOLINE = '// Melt single-target trampoline; import directly from source';
const SNIPPET_INVERT = '// Invert dependency via interface or port/adapter';
const SNIPPET_DECOMPOSE = '// Extract shared contracts to domain-level shared module';

const createActionSpec = (
    action: AgentActionType,
    code: string,
    templateSnippet: string,
): ActionableSpec => ({
    action,
    code,
    safeToAutomate: false,
    templateSnippet,
});

const ACTION_SPEC_FACADE = createActionSpec(ACTION_DECOUPLE, CODE_ACTION_FACADE, SNIPPET_FACADE);
const ACTION_SPEC_TRAMPOLINE = createActionSpec(
    ACTION_REPLACE,
    CODE_ACTION_TRAMPOLINE,
    SNIPPET_TRAMPOLINE,
);
const ACTION_SPEC_INVERT = createActionSpec(ACTION_NARROW, CODE_ACTION_INVERT, SNIPPET_INVERT);
const ACTION_SPEC_DECOMPOSE = createActionSpec(
    ACTION_DECOMPOSE,
    CODE_ACTION_DECOMPOSE,
    SNIPPET_DECOMPOSE,
);

const ARCH_ACTIONABLE_MAP: Record<string, ActionableSpec> = {
    [RULE_FACADE]: ACTION_SPEC_FACADE,
    [RULE_FACADE_LEGACY]: ACTION_SPEC_FACADE,
    [RULE_TRAMPOLINE]: ACTION_SPEC_TRAMPOLINE,
    [RULE_TRAMPOLINE_LEGACY]: ACTION_SPEC_TRAMPOLINE,
    [RULE_DOMAIN_LEAK]: ACTION_SPEC_INVERT,
    [RULE_DOMAIN_LEAK_LEGACY]: ACTION_SPEC_INVERT,
    [RULE_DIRECTION_BREACH]: ACTION_SPEC_DECOMPOSE,
    [RULE_DIRECTION_BREACH_LEGACY]: ACTION_SPEC_DECOMPOSE,
};

/** Diagnostic suggestion prose constants */
const SUGGEST_MUTABLE_GLOBAL =
    'Encapsulate mutable state in class instances via dependency injection.';
const SUGGEST_CONFIG_LEAK =
    'Inject strongly-typed configuration parameters into domain constructors.';
const SUGGEST_HEADLESS = 'Decouple core domain logic from UI/IDE presentation frameworks.';
const SUGGEST_BOUNDARY_BYPASS =
    'Import through public module facade rather than private directories.';
const SUGGEST_LAYERING_ILLUSION = 'Invert dependency using interfaces defined in the domain.';

/** Diagnostic message formatters */
const formatMutableGlobalMsg = (file: string): string =>
    `Implicit shared mutable global state exported in '${file}'.`;

const formatConfigLeakMsg = (file: string): string =>
    `Configuration leakage: domain model in '${file}' reads environment directly.`;

const formatHeadlessMsg = (file: string, raw: string): string =>
    `Headless architecture violation: domain logic in '${file}' imports presentation framework '${raw}'.`;

const formatBoundaryBypassMsg = (file: string, raw: string): string =>
    `Cross-domain internal boundary bypass: '${file}' imports private module '${raw}'.`;

const formatLayeringIllusionMsg = (file: string, targetPath: string): string =>
    `Structural layering illusion: domain entity '${file}' directly imports infrastructure '${targetPath}'.`;

/** ASCII character codes */
const CARRIAGE_RETURN_CHAR_CODE = 13;
const NEWLINE_CHAR_CODE = 10;

/** Architecture layer names */
const LAYER_DOMAIN = 'domain';
const LAYER_INTERFACE = 'interface';
const LAYER_APPLICATION = 'application';
const LAYER_INFRASTRUCTURE = 'infrastructure';
const LAYER_TEST = 'test';
const LAYER_TOOLING = 'tooling';
const LAYER_SHARED = 'shared';

const EXEMPT_LAYERS = new Set<ArchitectureLayer>([LAYER_TEST, LAYER_TOOLING, LAYER_SHARED]);

/** Analyzer archetype tokens */
const ARCH_STDLIB = 'stdlib';
const ARCH_SYSTEMS_RUNTIME = 'systems_runtime';

/** Analyzer metadata */
const ANALYZER_NAME = 'architecture' as const;

/** Security and credential tokens */
const SEC_LEVEL_FULL = 'full';
const SEC_LEVEL_BASIC = 'basic';
const FIELD_FALLBACK_CREDENTIAL = 'credential';

/** Regular expression patterns */
const RE_SENSITIVE_FIELD =
    /\b(?:passwordHash|passwordSalt|secretKey|clientSecret|privateKey|authToken)\s*[:=]/i;
const RE_EXPORT_LET = /^\s*export\s+let\s+[A-Za-z0-9_$]+/;
const RE_CONFIG_ACCESS = /process\.env|fs\.readFileSync/;
const RE_PRIVATE_PATH = /\/(?:internal|impl|private)\//;
const RE_ANALYZER_OR_DOMAIN = /analyzer|domain/;
const RE_INTERFACE_LAYER_HINT = /(?:dto|api|controller|view|contract|facade)/i;

const DEFAULT_FORBIDDEN_DEPS = (
    'express koa fastify react vue @angular svelte django fastapi flask ' +
    'actix_web actix-web axum tokio godot vscode electron pg mysql mysql2 sqlite3 ' +
    'typeorm prisma mongoose sequelize sqlalchemy diesel sqlx fs net http https ' +
    'child_process subprocess socket'
).split(' ');

const DISALLOWED_PARSER_PACKAGES = 'oxc-parser @babel/parser tree-sitter ts-morph/dist'.split(' ');

function shouldSkipArchitectureAnalysis(
    opts: ArchitectureOptions,
    ctx: AnalyzerContext,
    currentLayer: ArchitectureLayer,
): boolean {
    if (opts.enforceCleanLayers === false) return true;
    const arch = ctx.config?.archetype;
    if (arch === ARCH_STDLIB || arch === ARCH_SYSTEMS_RUNTIME) return true;
    return EXEMPT_LAYERS.has(currentLayer);
}

function applyActionableSuggestions(issues: Issue[]): void {
    for (const iss of issues) {
        if (!iss.actionable && ARCH_ACTIONABLE_MAP[iss.rule]) {
            const mapped = ARCH_ACTIONABLE_MAP[iss.rule];
            iss.actionable = {
                action: mapped.action,
                code: mapped.code,
                safeToAutomate: mapped.safeToAutomate,
                templateSnippet: mapped.templateSnippet,
            };
        }
    }
}

function shouldFlagConfigLeakage(opts: ArchitectureOptions, ctx: AnalyzerContext): boolean {
    if (opts.flagConfigLeakage !== undefined) {
        return Boolean(opts.flagConfigLeakage);
    }
    const thresholds = ctx.config?.thresholds as unknown as Record<string, unknown> | undefined;
    return Boolean(thresholds?.flagConfigLeakage);
}

function auditEvolutionRules(
    content: string,
    file: string,
    ctx: AnalyzerContext,
    opts: ArchitectureOptions,
): Issue[] {
    const issues: Issue[] = [];
    if (opts.flagDispatchComplexity !== false) {
        issues.push(...auditDispatchComplexity(content, file, ctx));
    }
    if (opts.flagTemplateComplexity !== false) {
        issues.push(...auditTemplateComplexity(content, file, ctx));
    }
    const facadeResult = auditFacadeGovernance(file, content);
    if (facadeResult.issues.length > 0) {
        issues.push(...facadeResult.issues);
    }
    return issues;
}

function buildPathSegmentSet(norm: string): Set<string> {
    const segments = norm.split('/');
    const set = new Set<string>();
    const len = segments.length;
    for (let i = 0; i < len; i++) {
        let current = segments[i];
        set.add(current);
        addStrippedExtension(current, set);
        for (let j = i + 1; j < len; j++) {
            current = `${current}/${segments[j]}`;
            set.add(current);
            addStrippedExtension(current, set);
        }
    }
    return set;
}

function addStrippedExtension(auditTarget: string, set: Set<string>): void {
    const dotIdx = auditTarget.lastIndexOf('.');
    if (dotIdx > 0) {
        set.add(auditTarget.slice(0, dotIdx));
    }
}

function matchUserLayer(
    norm: string,
    layers?: Record<string, ArchitectureLayer>,
): ArchitectureLayer | null {
    if (!layers) return null;
    const pathSet = buildPathSegmentSet(norm);
    for (const [pattern, layer] of Object.entries(layers)) {
        if (pathSet.has(pattern)) return layer;
    }
    return null;
}

function buildDirectorySegmentSet(norm: string): Set<string> {
    const segments = norm.split('/');
    const dirSet = new Set<string>();
    const count = segments.length;
    for (let i = 0; i < count; i++) {
        let current = segments[i];
        if (i < count - 1) {
            dirSet.add(current);
        }
        for (let j = i + 1; j < count - 1; j++) {
            current = `${current}/${segments[j]}`;
            dirSet.add(current);
        }
    }
    return dirSet;
}

function matchDirectorySemantics(
    norm: string,
    semantics?: Record<string, ArchitectureLayer>,
): ArchitectureLayer | null {
    if (!semantics) return null;
    const dirSet = buildDirectorySegmentSet(norm);
    for (const [dir, layer] of Object.entries(semantics)) {
        if (dirSet.has(dir)) {
            return layer;
        }
    }
    return null;
}

/**
 * Enforce declarative Clean Architecture boundaries for a single source file.
 *
 * The analyzer resolves the file's layer from explicit options, profile semantics and
 * fallback path heuristics, then inspects imports and module references for forbidden
 * domain frameworks, DTO credential leaks and direction breaches. It is a line-oriented
 * polyglot adapter (TS/JS, GDScript, Python, Rust, Go, JVM and C#) so one rule engine
 * serves every supported language.
 *
 * Contract: produces canonical `Issue` records for ARCH-LEAK-001/002, ARCH-DIR-001/002
 * and skip-layer penetration. Inputs are the parsed `SourceFile` plus
 * `AnalyzerContext.content`, `filePath`, `config.securityLevel` and `options`
 * (`enforceCleanLayers`, `layers`, `forbiddenDomainImports`, `allowSkipLayers`,
 * `securityLevel`, `checkDtoCredentialLeakage`). Output is an issue list with 1-based
 * source locations, or an empty array when enforcement is disabled or the file belongs
 * to an exempt test, tooling or shared layer.
 * Edge cases: files matching no configured layer fall back to path heuristics; DTO leak
 * checks only run at `full` security unless explicitly enabled; unknown import syntax
 * yields no issue rather than a crash.
 * Failure semantics: deterministic, pure per-file scan that never throws, so one
 * malformed file cannot abort a multi-file scan.
 */
export class ArchitectureAnalyzer implements Analyzer {
    readonly name = ANALYZER_NAME;

    analyze(sf: import('typescript').SourceFile, ctx: AnalyzerContext): Issue[] {
        void sf;
        const opts = (ctx.options || {}) as ArchitectureOptions;
        const file = ctx.filePath.replace(/\\/g, '/');
        const currentLayer = this.resolveLayer(file, opts, ctx);
        if (shouldSkipArchitectureAnalysis(opts, ctx, currentLayer)) {
            return [];
        }

        const issues: Issue[] = [];
        issues.push(...auditEvolutionRules(ctx.content || '', file, ctx, opts));

        const forbiddenList = opts.forbiddenDomainImports || DEFAULT_FORBIDDEN_DEPS;
        const auditCtx: ArchitectureAuditContext = {
            file,
            currentLayer,
            ctx,
            opts,
            forbiddenModules: new Set(forbiddenList),
            issues,
        };

        this.scanSourceLines(ctx.content || '', auditCtx);

        if (shouldFlagConfigLeakage(opts, ctx)) {
            const cfgResult = auditConfigDrivenArchitecture([
                {
                    filePath: file,
                    content: ctx.content || '',
                    isDomainCore: currentLayer === LAYER_DOMAIN,
                },
            ]);
            issues.push(...cfgResult.issues);
        }

        applyActionableSuggestions(issues);
        return issues;
    }

    private scanSourceLines(content: string, auditCtx: ArchitectureAuditContext): void {
        const thresholdHeadless = (
            auditCtx.ctx.config?.thresholds as ArchitectureThresholds | undefined
        )?.headlessDisallowedImports;
        const customHeadless = auditCtx.opts.headlessDisallowedImports ?? thresholdHeadless;
        auditCtx.customHeadlessSet = customHeadless ? new Set(customHeadless) : undefined;

        const len = content.length;
        if (len === 0) return;

        let lineStart = 0;
        let lineIdx = 0;

        for (let i = 0; i <= len; i++) {
            const isEnd = i === len;
            if (!isEnd && content.charCodeAt(i) !== NEWLINE_CHAR_CODE) {
                continue;
            }
            if (isEnd && lineStart >= len) {
                break;
            }
            let sliceEnd = i;
            if (
                sliceEnd > lineStart &&
                content.charCodeAt(sliceEnd - 1) === CARRIAGE_RETURN_CHAR_CODE
            ) {
                sliceEnd--;
            }

            const lineText = content.slice(lineStart, sliceEnd);
            const trimmed = lineText.trim();

            const specifiers = extractSpecifiers(lineText, trimmed, auditCtx.file);
            this.auditSpecifiers(specifiers, lineIdx, auditCtx);
            this.checkGlobalAndConfigViolations(lineText, trimmed, lineIdx, auditCtx);

            lineIdx++;
            lineStart = i + 1;
        }
    }

    private checkMutableGlobalState(
        lineText: string,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        const flagGlobal =
            auditCtx.opts.flagMutableGlobalCoupling ??
            auditCtx.ctx.config.thresholds?.flagMutableGlobalCoupling ??
            false;
        if (flagGlobal && RE_EXPORT_LET.test(lineText)) {
            auditCtx.issues.push(
                this.createIssue(auditCtx.ctx, {
                    lineIdx,
                    rule: RULE_MUTABLE_GLOBAL,
                    message: formatMutableGlobalMsg(auditCtx.file),
                    severity: SEVERITY_WARNING,
                    detail: { file: auditCtx.file, line: lineIdx + 1 },
                    suggestion: SUGGEST_MUTABLE_GLOBAL,
                }),
            );
        }
    }

    private checkDirectConfigAccess(
        trimmed: string,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        const flagConfig =
            auditCtx.opts.flagConfigLeakage ??
            auditCtx.ctx.config.thresholds?.flagConfigLeakage ??
            false;
        if (!flagConfig || auditCtx.currentLayer !== LAYER_DOMAIN) return;

        const customConfigKws =
            auditCtx.opts.protectedConfigKeywords ??
            auditCtx.ctx.config.thresholds?.protectedConfigKeywords;
        const hasCustomKeywordAccess = Boolean(
            customConfigKws && customConfigKws.some((keyword: string) => trimmed.includes(keyword)),
        );
        const hasDirectConfigAccess = RE_CONFIG_ACCESS.test(trimmed) || hasCustomKeywordAccess;
        if (hasDirectConfigAccess) {
            auditCtx.issues.push(
                this.createIssue(auditCtx.ctx, {
                    lineIdx,
                    rule: RULE_CONFIG_LEAK,
                    message: formatConfigLeakMsg(auditCtx.file),
                    severity: SEVERITY_INFO,
                    detail: { file: auditCtx.file, line: lineIdx + 1 },
                    suggestion: SUGGEST_CONFIG_LEAK,
                }),
            );
        }
    }

    private checkGlobalAndConfigViolations(
        lineText: string,
        trimmed: string,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        this.checkMutableGlobalState(lineText, lineIdx, auditCtx);
        this.checkDirectConfigAccess(trimmed, lineIdx, auditCtx);
        this.checkDtoLeakage(trimmed, lineIdx, auditCtx);
    }

    private checkDtoLeakage(
        trimmed: string,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        const secLevel =
            auditCtx.opts.securityLevel || auditCtx.ctx.config.securityLevel || SEC_LEVEL_BASIC;
        if (
            (secLevel === SEC_LEVEL_FULL || auditCtx.opts.checkDtoCredentialLeakage) &&
            (auditCtx.currentLayer === LAYER_DOMAIN ||
                auditCtx.currentLayer === LAYER_APPLICATION ||
                auditCtx.currentLayer === LAYER_INTERFACE)
        ) {
            if (RE_SENSITIVE_FIELD.test(trimmed)) {
                const matched = RE_SENSITIVE_FIELD.exec(trimmed);
                const field = matched
                    ? matched[0].replace(/[:=]/g, '').trim()
                    : FIELD_FALLBACK_CREDENTIAL;
                const descriptor = ArchitectureMessages.PUBLIC_DTO_CREDENTIAL_LEAK(field);
                auditCtx.issues.push(
                    this.createIssue(auditCtx.ctx, {
                        lineIdx,
                        rule: RULE_DTO_CREDENTIAL_LEAK,
                        message: descriptor.message,
                        severity: SEVERITY_ERROR,
                        detail: { file: auditCtx.file, layer: auditCtx.currentLayer, field },
                        suggestion: descriptor.suggestion,
                    }),
                );
            }
        }
    }

    private auditSpecifiers(
        specifiers: SpecifierInfo[],
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        for (const spec of specifiers) {
            this.auditDomainImports(spec, lineIdx, auditCtx);
            this.auditCrossDomainBypass(spec, lineIdx, auditCtx);
            this.auditPolyglotAdapterDecoupling(spec, lineIdx, auditCtx);
            if (!spec.resolvedPath) continue;

            const targetLayer = this.resolveLayer(spec.resolvedPath, auditCtx.opts, auditCtx.ctx);
            if (EXEMPT_LAYERS.has(targetLayer)) {
                continue;
            }

            const depTarget: LayerDependencyAuditTarget = {
                spec,
                resolvedPath: spec.resolvedPath,
                targetLayer,
                lineIdx,
            };
            this.auditDomainDependency(depTarget, auditCtx);
            this.auditApplicationDependency(depTarget, auditCtx);
            this.auditInterfaceSkipLayer(depTarget, auditCtx);
        }
    }

    private checkFrameworkLeak(
        spec: SpecifierInfo,
        basePkg: string,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        if (!auditCtx.forbiddenModules.has(basePkg) && !auditCtx.forbiddenModules.has(spec.raw)) {
            return;
        }
        const descriptor = ArchitectureMessages.DOMAIN_FRAMEWORK_LEAK(spec.raw);
        auditCtx.issues.push(
            this.createIssue(auditCtx.ctx, {
                lineIdx,
                rule: RULE_DOMAIN_LEAK,
                message: descriptor.message,
                severity: SEVERITY_ERROR,
                detail: { file: auditCtx.file, layer: auditCtx.currentLayer, specifier: spec.raw },
                suggestion: descriptor.suggestion,
            }),
        );
    }

    private checkHeadlessBoundary(
        spec: SpecifierInfo,
        basePkg: string,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        const enforceHeadless =
            auditCtx.opts.enforceHeadless ??
            auditCtx.ctx.config.thresholds?.enforceHeadless ??
            false;
        if (!enforceHeadless) return;

        const isForbiddenHeadless =
            FORBIDDEN_HEADLESS_IMPORTS.has(basePkg) ||
            FORBIDDEN_HEADLESS_IMPORTS.has(spec.raw) ||
            Boolean(
                auditCtx.customHeadlessSet &&
                (auditCtx.customHeadlessSet.has(basePkg) ||
                    auditCtx.customHeadlessSet.has(spec.raw)),
            );

        if (isForbiddenHeadless) {
            auditCtx.issues.push(
                this.createIssue(auditCtx.ctx, {
                    lineIdx,
                    rule: RULE_HEADLESS_BREACH,
                    message: formatHeadlessMsg(auditCtx.file, spec.raw),
                    severity: SEVERITY_ERROR,
                    detail: {
                        file: auditCtx.file,
                        layer: auditCtx.currentLayer,
                        specifier: spec.raw,
                    },
                    suggestion: SUGGEST_HEADLESS,
                }),
            );
        }
    }

    private auditDomainImports(
        spec: SpecifierInfo,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        if (auditCtx.currentLayer !== LAYER_DOMAIN) return;
        const basePkg = spec.raw.startsWith('@')
            ? spec.raw.split('/').slice(0, 2).join('/')
            : spec.raw.split('/')[0];

        this.checkFrameworkLeak(spec, basePkg, lineIdx, auditCtx);
        this.checkHeadlessBoundary(spec, basePkg, lineIdx, auditCtx);
    }

    private auditCrossDomainBypass(
        spec: SpecifierInfo,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        const flagBypass =
            auditCtx.opts.flagCrossDomainBypass ??
            auditCtx.ctx.config.thresholds?.flagCrossDomainBypass ??
            false;
        if (flagBypass && RE_PRIVATE_PATH.test(spec.raw)) {
            auditCtx.issues.push(
                this.createIssue(auditCtx.ctx, {
                    lineIdx,
                    rule: RULE_BOUNDARY_BYPASS,
                    message: formatBoundaryBypassMsg(auditCtx.file, spec.raw),
                    severity: SEVERITY_WARNING,
                    detail: { file: auditCtx.file, specifier: spec.raw },
                    suggestion: SUGGEST_BOUNDARY_BYPASS,
                }),
            );
        }
    }

    private auditPolyglotAdapterDecoupling(
        spec: SpecifierInfo,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        const isAnalyzerOrDomain = RE_ANALYZER_OR_DOMAIN.test(auditCtx.file);
        if (!isAnalyzerOrDomain) return;

        const isDisallowed = DISALLOWED_PARSER_PACKAGES.some((pkg) => spec.raw.includes(pkg));
        if (isDisallowed) {
            const descriptor = ArchitectureMessages.POLYGLOT_PARSER_COUPLING(
                auditCtx.file,
                spec.raw,
            );
            auditCtx.issues.push(
                this.createIssue(auditCtx.ctx, {
                    lineIdx,
                    rule: RULE_PARSER_COUPLING,
                    message: descriptor.message,
                    severity: SEVERITY_WARNING,
                    detail: { file: auditCtx.file, specifier: spec.raw },
                    suggestion: descriptor.suggestion,
                }),
            );
        }
    }

    private auditDomainDependency(
        target: LayerDependencyAuditTarget,
        auditCtx: ArchitectureAuditContext,
    ): void {
        // Rule 1: Domain cannot depend on Application, Infrastructure, or Interface
        if (auditCtx.currentLayer === LAYER_DOMAIN) {
            if (
                target.targetLayer === LAYER_APPLICATION ||
                target.targetLayer === LAYER_INFRASTRUCTURE ||
                target.targetLayer === LAYER_INTERFACE
            ) {
                const descriptor = ArchitectureMessages.DOMAIN_INVERSION_BREACH(
                    auditCtx.currentLayer,
                    target.targetLayer,
                    target.resolvedPath,
                );
                this.pushDirectionIssue(auditCtx, target, RULE_DIRECTION_BREACH, descriptor);

                // Structural layering illusion (ARCH-DIR-003)
                const flagIllusions =
                    auditCtx.opts.flagLayeringIllusions ??
                    auditCtx.ctx.config.thresholds?.flagLayeringIllusions ??
                    false;
                if (flagIllusions && target.targetLayer === LAYER_INFRASTRUCTURE) {
                    auditCtx.issues.push(
                        this.createIssue(auditCtx.ctx, {
                            lineIdx: target.lineIdx,
                            rule: RULE_LAYERING_ILLUSION,
                            message: formatLayeringIllusionMsg(auditCtx.file, target.resolvedPath),
                            severity: SEVERITY_ERROR,
                            detail: {
                                fromLayer: auditCtx.currentLayer,
                                toLayer: target.targetLayer,
                                targetPath: target.resolvedPath,
                            },
                            suggestion: SUGGEST_LAYERING_ILLUSION,
                        }),
                    );
                }
            }
        }
    }

    /**
     * Audits application layer import dependencies to enforce that Application
     * logic does not depend upward on Interface or presentation controllers.
     */
    private auditApplicationDependency(
        target: LayerDependencyAuditTarget,
        auditCtx: ArchitectureAuditContext,
    ): void {
        // Rule 2: Application cannot depend on Interface
        if (auditCtx.currentLayer === LAYER_APPLICATION && target.targetLayer === LAYER_INTERFACE) {
            const descriptor = ArchitectureMessages.APPLICATION_LAYER_BREACH(
                target.targetLayer,
                target.resolvedPath,
            );
            this.pushDirectionIssue(auditCtx, target, RULE_DIRECTION_BREACH, descriptor);
        }
    }

    /**
     * Audits interface layer imports to prevent bypass skipping application orchestrators
     * and binding directly to infrastructure components when skip-layering is prohibited.
     */
    private auditInterfaceSkipLayer(
        target: LayerDependencyAuditTarget,
        auditCtx: ArchitectureAuditContext,
    ): void {
        // Rule 3: Interface should not directly bypass Application to Infrastructure (Skip-Layer)
        if (
            auditCtx.currentLayer === LAYER_INTERFACE &&
            target.targetLayer === LAYER_INFRASTRUCTURE &&
            !auditCtx.opts.allowSkipLayers
        ) {
            const descriptor = ArchitectureMessages.SKIP_LAYER_PENETRATION(
                target.targetLayer,
                target.resolvedPath,
            );
            this.pushDirectionIssue(auditCtx, target, RULE_SKIP_LAYER, descriptor);
        }
    }

    /**
     * Pushes a directional boundary violation issue to the audit collection,
     * assigning severity according to the specific architectural rule breached.
     */
    private pushDirectionIssue(
        auditCtx: ArchitectureAuditContext,
        target: LayerDependencyAuditTarget,
        rule: string,
        descriptor: { message: string; suggestion?: string },
    ): void {
        const severity = rule === RULE_SKIP_LAYER ? SEVERITY_WARNING : SEVERITY_ERROR;
        auditCtx.issues.push(
            this.createIssue(auditCtx.ctx, {
                lineIdx: target.lineIdx,
                rule,
                message: descriptor.message,
                severity,
                detail: {
                    fromLayer: auditCtx.currentLayer,
                    toLayer: target.targetLayer,
                    targetPath: target.resolvedPath,
                },
                suggestion: descriptor.suggestion,
            }),
        );
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined as unknown as import('typescript').SourceFile, ctx);
    }

    /**
     * Resolves the canonical Clean Architecture layer for a given file path by evaluating
     * user-configured overrides, directory semantic profiles, and path naming heuristics.
     */
    private resolveLayer(
        filePath: string,
        opts: ArchitectureOptions,
        ctx: AnalyzerContext,
    ): ArchitectureLayer {
        const norm = filePath.replace(/\\/g, '/');

        const userLayer = matchUserLayer(norm, opts.layers);
        if (userLayer) return userLayer;

        const semanticLayer = matchDirectorySemantics(
            norm,
            ctx.config?.profile?.directorySemantics,
        );
        if (semanticLayer) return semanticLayer;

        if (RE_INTERFACE_LAYER_HINT.test(norm)) {
            return LAYER_INTERFACE;
        }

        return inferDirectorySemantic(filePath);
    }

    /**
     * Factory constructing a canonical Issue record enriched with actionable remediation
     * directives and standardized source location coordinates.
     */
    private createIssue(ctx: AnalyzerContext, draft: IssueDraft): Issue {
        const line = draft.lineIdx + 1;
        const file = ctx.filePath.replace(/\\/g, '/');
        const mapped = ARCH_ACTIONABLE_MAP[draft.rule];
        const actionable = mapped
            ? {
                  action: mapped.action,
                  code: mapped.code,
                  safeToAutomate: mapped.safeToAutomate,
                  templateSnippet: mapped.templateSnippet,
              }
            : undefined;
        return {
            id: `${this.name}:${draft.rule}:${file}:${line}`,
            analyzer: this.name,
            rule: draft.rule,
            severity: draft.severity,
            message: draft.message,
            location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
            detail: draft.detail,
            suggestion: draft.suggestion,
            actionable,
        };
    }
}
