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
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
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

interface ArchitectureAuditContext {
    file: string;
    currentLayer: ArchitectureLayer;
    ctx: AnalyzerContext;
    opts: ArchitectureOptions;
    forbiddenModules: Set<string>;
    issues: Issue[];
    customHeadlessSet?: Set<string>;
}

interface LayerDependencyAuditTarget {
    spec: SpecifierInfo;
    resolvedPath: string;
    targetLayer: ArchitectureLayer;
    lineIdx: number;
}

const DEFAULT_FORBIDDEN_DOMAIN_IMPORTS = (
    'express koa fastify react vue @angular svelte django fastapi flask ' +
    'actix_web actix-web axum tokio godot vscode electron pg mysql mysql2 sqlite3 ' +
    'typeorm prisma mongoose sequelize sqlalchemy diesel sqlx fs net http https ' +
    'child_process subprocess socket'
).split(' ');

const DISALLOWED_PARSER_PACKAGES = ['oxc-parser', '@babel/parser', 'tree-sitter', 'ts-morph/dist'];

const ARCH_ACTIONABLE_MAP: Record<
    string,
    { action: AgentActionType; code: string; safeToAutomate: boolean; templateSnippet: string }
> = {
    'ARCH-FAC-001': {
        action: 'decouple_facade',
        code: 'AR:ARC:001',
        safeToAutomate: false,
        templateSnippet: 'export const ModuleFacade = Object.freeze({ ... });',
    },
    'facade-without-payload': {
        action: 'decouple_facade',
        code: 'AR:ARC:001',
        safeToAutomate: false,
        templateSnippet: 'export const ModuleFacade = Object.freeze({ ... });',
    },
    'ARCH-ABS-001': {
        action: 'replace_token',
        code: 'AR:ARC:002',
        safeToAutomate: false,
        templateSnippet: '// Melt single-target trampoline; import directly from source',
    },
    'trampoline-export': {
        action: 'replace_token',
        code: 'AR:ARC:002',
        safeToAutomate: false,
        templateSnippet: '// Melt single-target trampoline; import directly from source',
    },
    'ARCH-LEAK-001': {
        action: 'narrow_scope',
        code: 'AR:ARC:003',
        safeToAutomate: false,
        templateSnippet: '// Invert dependency via interface or port/adapter',
    },
    'layer-inversion': {
        action: 'narrow_scope',
        code: 'AR:ARC:003',
        safeToAutomate: false,
        templateSnippet: '// Invert dependency via interface or port/adapter',
    },
    'ARCH-DIR-001': {
        action: 'decompose_module',
        code: 'AR:ARC:004',
        safeToAutomate: false,
        templateSnippet: '// Extract shared contracts to domain-level shared module',
    },
    'cyclic-dependency': {
        action: 'decompose_module',
        code: 'AR:ARC:004',
        safeToAutomate: false,
        templateSnippet: '// Extract shared contracts to domain-level shared module',
    },
};

/** ASCII code of carriage return, stripped from CRLF line endings before per-line analysis. */
const CARRIAGE_RETURN_CHAR_CODE = 13;

/** Clean Architecture layer name for domain code, used in comparisons and path prefixes. */
const ARCHITECTURE_LAYER_DOMAIN = 'domain';

/** Clean Architecture layer name for interface/adapter code (the outermost layer). */
const ARCHITECTURE_LAYER_INTERFACE = 'interface';

/** Clean Architecture layer name for application code. */
const ARCHITECTURE_LAYER_APPLICATION = 'application';

/** Clean Architecture layer name for infrastructure code. */
const ARCHITECTURE_LAYER_INFRASTRUCTURE = 'infrastructure';

function isExemptLayer(layer: ArchitectureLayer): boolean {
    return layer === 'test' || layer === 'tooling' || layer === 'shared';
}

function shouldSkipArchitectureAnalysis(
    opts: ArchitectureOptions,
    ctx: AnalyzerContext,
    currentLayer: ArchitectureLayer,
): boolean {
    if (opts.enforceCleanLayers === false) return true;
    const arch = ctx.config?.archetype;
    if (arch === 'stdlib' || arch === 'systems_runtime') return true;
    return isExemptLayer(currentLayer);
}

function decorateActionableSuggestions(issues: Issue[]): void {
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

function auditEvolutionaryArchitectureRules(
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

function addStrippedExtension(item: string, set: Set<string>): void {
    const dotIdx = item.lastIndexOf('.');
    if (dotIdx > 0) {
        set.add(item.slice(0, dotIdx));
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
    name = 'architecture' as const;

    analyze(sf: import('typescript').SourceFile, ctx: AnalyzerContext): Issue[] {
        void sf;
        const opts = (ctx.options || {}) as ArchitectureOptions;
        const file = ctx.filePath.replace(/\\/g, '/');
        const currentLayer = this.resolveLayer(file, opts, ctx);
        if (shouldSkipArchitectureAnalysis(opts, ctx, currentLayer)) {
            return [];
        }

        const issues: Issue[] = [];
        issues.push(...auditEvolutionaryArchitectureRules(ctx.content || '', file, ctx, opts));

        const forbiddenList = opts.forbiddenDomainImports || DEFAULT_FORBIDDEN_DOMAIN_IMPORTS;
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
                    isDomainCore: currentLayer === 'domain',
                },
            ]);
            issues.push(...cfgResult.issues);
        }

        decorateActionableSuggestions(issues);
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
            if (!isEnd && content.charCodeAt(i) !== 10) {
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

            this.checkDtoLeakage(trimmed, lineIdx, auditCtx);
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
        if (flagGlobal && /^\s*export\s+let\s+[A-Za-z0-9_$]+/.test(lineText)) {
            auditCtx.issues.push(
                this.mkIssue(
                    auditCtx.ctx,
                    lineIdx,
                    'ARCH-GLB-001',
                    `Implicit shared mutable global state exported in '${auditCtx.file}'.`,
                    SEVERITY_WARNING,
                    { file: auditCtx.file, line: lineIdx + 1 },
                    'Encapsulate mutable state in class instances via dependency injection.',
                ),
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
        if (!flagConfig || auditCtx.currentLayer !== ARCHITECTURE_LAYER_DOMAIN) return;

        const customConfigKws =
            auditCtx.opts.protectedConfigKeywords ??
            auditCtx.ctx.config.thresholds?.protectedConfigKeywords;
        const hasDirectConfigAccess =
            trimmed.includes('process.env') ||
            trimmed.includes('fs.readFileSync') ||
            (customConfigKws && customConfigKws.some((kw: string) => trimmed.includes(kw)));
        if (hasDirectConfigAccess) {
            auditCtx.issues.push(
                this.mkIssue(
                    auditCtx.ctx,
                    lineIdx,
                    'ARCH-CFG-001',
                    `Configuration leakage: domain model in '${auditCtx.file}' reads environment directly.`,
                    'info',
                    { file: auditCtx.file, line: lineIdx + 1 },
                    'Inject strongly-typed configuration parameters into domain constructors.',
                ),
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
            auditCtx.opts.securityLevel || auditCtx.ctx.config.securityLevel || 'basic';
        if (
            (secLevel === 'full' || auditCtx.opts.checkDtoCredentialLeakage) &&
            (auditCtx.currentLayer === ARCHITECTURE_LAYER_DOMAIN ||
                auditCtx.currentLayer === 'application' ||
                auditCtx.currentLayer === ARCHITECTURE_LAYER_INTERFACE)
        ) {
            const SENSITIVE_FIELD_RE =
                /\b(?:passwordHash|passwordSalt|secretKey|clientSecret|privateKey|authToken)\s*[:=]/i;
            if (SENSITIVE_FIELD_RE.test(trimmed)) {
                const matched = SENSITIVE_FIELD_RE.exec(trimmed);
                const field = matched ? matched[0].replace(/[:=]/g, '').trim() : 'credential';
                const descriptor = ArchitectureMessages.PUBLIC_DTO_CREDENTIAL_LEAK(field);
                auditCtx.issues.push(
                    this.mkIssue(
                        auditCtx.ctx,
                        lineIdx,
                        'ARCH-LEAK-002',
                        descriptor.message,
                        SEVERITY_ERROR,
                        { file: auditCtx.file, layer: auditCtx.currentLayer, field },
                        descriptor.suggestion,
                    ),
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
            if (targetLayer === 'test' || targetLayer === 'tooling' || targetLayer === 'shared') {
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
        if (!auditCtx.forbiddenModules.has(basePkg) && !auditCtx.forbiddenModules.has(spec.raw))
            return;
        const descriptor = ArchitectureMessages.DOMAIN_FRAMEWORK_LEAK(spec.raw);
        auditCtx.issues.push(
            this.mkIssue(
                auditCtx.ctx,
                lineIdx,
                'ARCH-LEAK-001',
                descriptor.message,
                SEVERITY_ERROR,
                { file: auditCtx.file, layer: auditCtx.currentLayer, specifier: spec.raw },
                descriptor.suggestion,
            ),
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
                this.mkIssue(
                    auditCtx.ctx,
                    lineIdx,
                    'ARCH-HDL-001',
                    `Headless architecture violation: domain logic in '${auditCtx.file}' imports presentation framework '${spec.raw}'.`,
                    SEVERITY_ERROR,
                    { file: auditCtx.file, layer: auditCtx.currentLayer, specifier: spec.raw },
                    'Decouple core domain logic from UI/IDE presentation frameworks.',
                ),
            );
        }
    }

    private auditDomainImports(
        spec: SpecifierInfo,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        if (auditCtx.currentLayer !== ARCHITECTURE_LAYER_DOMAIN) return;
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
        if (
            flagBypass &&
            (spec.raw.includes('/internal/') ||
                spec.raw.includes('/impl/') ||
                spec.raw.includes('/private/'))
        ) {
            auditCtx.issues.push(
                this.mkIssue(
                    auditCtx.ctx,
                    lineIdx,
                    'ARCH-BND-001',
                    `Cross-domain internal boundary bypass: '${auditCtx.file}' imports private module '${spec.raw}'.`,
                    SEVERITY_WARNING,
                    { file: auditCtx.file, specifier: spec.raw },
                    'Import through public module facade rather than private directories.',
                ),
            );
        }
    }

    private auditPolyglotAdapterDecoupling(
        spec: SpecifierInfo,
        lineIdx: number,
        auditCtx: ArchitectureAuditContext,
    ): void {
        const isAnalyzerOrDomain =
            auditCtx.file.includes('analyzers/') ||
            auditCtx.file.includes('analyzer') ||
            auditCtx.file.includes('domain');
        if (!isAnalyzerOrDomain) return;

        const isDisallowed = DISALLOWED_PARSER_PACKAGES.some((pkg) => spec.raw.includes(pkg));
        if (isDisallowed) {
            const descriptor = ArchitectureMessages.POLYGLOT_PARSER_COUPLING(
                auditCtx.file,
                spec.raw,
            );
            auditCtx.issues.push(
                this.mkIssue(
                    auditCtx.ctx,
                    lineIdx,
                    'ARCH-DEC-002',
                    descriptor.message,
                    SEVERITY_WARNING,
                    { file: auditCtx.file, specifier: spec.raw },
                    descriptor.suggestion,
                ),
            );
        }
    }

    private auditDomainDependency(
        target: LayerDependencyAuditTarget,
        auditCtx: ArchitectureAuditContext,
    ): void {
        // Rule 1: Domain cannot depend on Application, Infrastructure, or Interface
        if (auditCtx.currentLayer === ARCHITECTURE_LAYER_DOMAIN) {
            if (
                target.targetLayer === ARCHITECTURE_LAYER_APPLICATION ||
                target.targetLayer === ARCHITECTURE_LAYER_INFRASTRUCTURE ||
                target.targetLayer === ARCHITECTURE_LAYER_INTERFACE
            ) {
                const descriptor = ArchitectureMessages.DOMAIN_INVERSION_BREACH(
                    auditCtx.currentLayer,
                    target.targetLayer,
                    target.resolvedPath,
                );
                auditCtx.issues.push(
                    this.mkIssue(
                        auditCtx.ctx,
                        target.lineIdx,
                        'ARCH-DIR-001',
                        descriptor.message,
                        SEVERITY_ERROR,
                        {
                            fromLayer: auditCtx.currentLayer,
                            toLayer: target.targetLayer,
                            targetPath: target.resolvedPath,
                        },
                        descriptor.suggestion,
                    ),
                );

                // Structural layering illusion (ARCH-DIR-003)
                const flagIllusions =
                    auditCtx.opts.flagLayeringIllusions ??
                    auditCtx.ctx.config.thresholds?.flagLayeringIllusions ??
                    false;
                if (flagIllusions && target.targetLayer === ARCHITECTURE_LAYER_INFRASTRUCTURE) {
                    auditCtx.issues.push(
                        this.mkIssue(
                            auditCtx.ctx,
                            target.lineIdx,
                            'ARCH-DIR-003',
                            `Structural layering illusion: domain entity '${auditCtx.file}' directly imports infrastructure '${target.resolvedPath}'.`,
                            SEVERITY_ERROR,
                            {
                                fromLayer: auditCtx.currentLayer,
                                toLayer: target.targetLayer,
                                targetPath: target.resolvedPath,
                            },
                            'Invert dependency using interfaces defined in the domain.',
                        ),
                    );
                }
            }
        }
    }

    private auditApplicationDependency(
        target: LayerDependencyAuditTarget,
        auditCtx: ArchitectureAuditContext,
    ): void {
        // Rule 2: Application cannot depend on Interface
        if (
            auditCtx.currentLayer === ARCHITECTURE_LAYER_APPLICATION &&
            target.targetLayer === ARCHITECTURE_LAYER_INTERFACE
        ) {
            const descriptor = ArchitectureMessages.APPLICATION_LAYER_BREACH(
                target.targetLayer,
                target.resolvedPath,
            );
            auditCtx.issues.push(
                this.mkIssue(
                    auditCtx.ctx,
                    target.lineIdx,
                    'ARCH-DIR-001',
                    descriptor.message,
                    SEVERITY_ERROR,
                    {
                        fromLayer: auditCtx.currentLayer,
                        toLayer: target.targetLayer,
                        targetPath: target.resolvedPath,
                    },
                    descriptor.suggestion,
                ),
            );
        }
    }

    private auditInterfaceSkipLayer(
        target: LayerDependencyAuditTarget,
        auditCtx: ArchitectureAuditContext,
    ): void {
        // Rule 3: Interface should not directly bypass Application to Infrastructure (Skip-Layer)
        if (
            auditCtx.currentLayer === ARCHITECTURE_LAYER_INTERFACE &&
            target.targetLayer === ARCHITECTURE_LAYER_INFRASTRUCTURE &&
            !auditCtx.opts.allowSkipLayers
        ) {
            const descriptor = ArchitectureMessages.SKIP_LAYER_PENETRATION(
                target.targetLayer,
                target.resolvedPath,
            );
            auditCtx.issues.push(
                this.mkIssue(
                    auditCtx.ctx,
                    target.lineIdx,
                    'ARCH-DIR-002',
                    descriptor.message,
                    SEVERITY_WARNING,
                    {
                        fromLayer: auditCtx.currentLayer,
                        toLayer: target.targetLayer,
                        targetPath: target.resolvedPath,
                    },
                    descriptor.suggestion,
                ),
            );
        }
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined as unknown as import('typescript').SourceFile, ctx);
    }

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

        if (/(?:dto|api|controller|view|contract|facade)/i.test(norm)) {
            return ARCHITECTURE_LAYER_INTERFACE;
        }

        return inferDirectorySemantic(filePath);
    }

    private mkIssue(
        ctx: AnalyzerContext,
        lineIdx: number,
        rule: string,
        message: string,
        severity: Severity,
        detail: Record<string, any>,
        suggestion?: string,
    ): Issue {
        const line = lineIdx + 1;
        const file = ctx.filePath.replace(/\\/g, '/');
        const mapped = ARCH_ACTIONABLE_MAP[rule];
        const actionable = mapped
            ? {
                  action: mapped.action,
                  code: mapped.code,
                  safeToAutomate: mapped.safeToAutomate,
                  templateSnippet: mapped.templateSnippet,
              }
            : undefined;
        return {
            id: `${this.name}:${rule}:${file}:${line}`,
            analyzer: this.name,
            rule,
            severity,
            message,
            location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
            detail,
            suggestion,
            actionable,
        };
    }
}
