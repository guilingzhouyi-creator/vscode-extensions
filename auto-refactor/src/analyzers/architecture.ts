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
import type { Analyzer, AnalyzerContext, Issue, ArchitectureLayer, Severity } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import { inferDirectorySemantic } from '../core/profiler/projectProfiler';
import { ArchitectureMessages } from '../core/messages/architecture';
import { FORBIDDEN_HEADLESS_IMPORTS } from '../core/intelligence/semanticArchitecture';
import { auditDispatchComplexity } from '../core/rules/evolution/dispatchComplexityRule';
import { auditTemplateComplexity } from '../core/rules/evolution/template-complexity-rule';
import { auditConfigDrivenArchitecture } from '../core/architecture/config-driven-architecture';
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

const DEFAULT_FORBIDDEN_DOMAIN_IMPORTS = (
    'express koa fastify react vue @angular svelte django fastapi flask ' +
    'actix_web actix-web axum tokio godot vscode electron pg mysql mysql2 sqlite3 ' +
    'typeorm prisma mongoose sequelize sqlalchemy diesel sqlx fs net http https ' +
    'child_process subprocess socket'
).split(' ');

const DISALLOWED_PARSER_PACKAGES = ['oxc-parser', '@babel/parser', 'tree-sitter', 'ts-morph/dist'];

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
    return issues;
}

function matchUserLayer(
    norm: string,
    layers?: Record<string, ArchitectureLayer>,
): ArchitectureLayer | null {
    if (!layers) return null;
    for (const [pattern, layer] of Object.entries(layers)) {
        if (norm.includes(pattern)) return layer;
    }
    return null;
}

function matchDirectorySemantics(
    norm: string,
    semantics?: Record<string, ArchitectureLayer>,
): ArchitectureLayer | null {
    if (!semantics) return null;
    for (const [dir, layer] of Object.entries(semantics)) {
        if (norm.startsWith(dir + '/') || norm.includes('/' + dir + '/')) {
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
        if (opts.enforceCleanLayers === false) {
            return [];
        }

        const file = ctx.filePath.replace(/\\/g, '/');
        const currentLayer = this.resolveLayer(file, opts, ctx);
        if (isExemptLayer(currentLayer)) {
            return [];
        }

        const issues: Issue[] = [];
        issues.push(...auditEvolutionaryArchitectureRules(ctx.content || '', file, ctx, opts));

        const forbiddenList = opts.forbiddenDomainImports || DEFAULT_FORBIDDEN_DOMAIN_IMPORTS;
        const forbiddenModules = new Set(forbiddenList);

        this.scanSourceLines(
            ctx.content || '',
            file,
            currentLayer,
            ctx,
            opts,
            forbiddenModules,
            issues,
        );

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

        return issues;
    }

    private scanSourceLines(
        content: string,
        file: string,
        currentLayer: ArchitectureLayer,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        forbiddenModules: Set<string>,
        issues: Issue[],
    ): void {
        const thresholdHeadless = (ctx.config.thresholds as ArchitectureThresholds | undefined)
            ?.headlessDisallowedImports;
        const customHeadless = opts.headlessDisallowedImports ?? thresholdHeadless;
        const customHeadlessSet = customHeadless ? new Set(customHeadless) : undefined;

        const len = content.length;
        let lineStart = 0;
        let lineIdx = 0;

        while (lineStart < len) {
            let lineEnd = content.indexOf('\n', lineStart);
            let nextStart: number;
            if (lineEnd === -1) {
                lineEnd = len;
                nextStart = len;
            } else {
                nextStart = lineEnd + 1;
                if (
                    lineEnd > lineStart &&
                    content.charCodeAt(lineEnd - 1) === CARRIAGE_RETURN_CHAR_CODE
                ) {
                    lineEnd--;
                }
            }

            const lineText = content.slice(lineStart, lineEnd);
            const trimmed = lineText.trim();

            this.checkDtoLeakage(trimmed, file, currentLayer, lineIdx, ctx, opts, issues);
            const specifiers = extractSpecifiers(lineText, trimmed, file);
            this.auditSpecifiers(
                specifiers,
                file,
                currentLayer,
                lineIdx,
                ctx,
                opts,
                forbiddenModules,
                issues,
                customHeadlessSet,
            );
            this.checkGlobalAndConfigViolations(
                lineText,
                trimmed,
                file,
                currentLayer,
                lineIdx,
                ctx,
                opts,
                issues,
            );

            lineIdx++;
            lineStart = nextStart;
        }
    }

    private checkMutableGlobalState(
        lineText: string,
        file: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        issues: Issue[],
    ): void {
        const flagGlobal =
            opts.flagMutableGlobalCoupling ??
            ctx.config.thresholds?.flagMutableGlobalCoupling ??
            false;
        if (flagGlobal && /^\s*export\s+let\s+[A-Za-z0-9_$]+/.test(lineText)) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'ARCH-GLB-001',
                    `Implicit shared mutable global state exported in '${file}'.`,
                    SEVERITY_WARNING,
                    { file, line: lineIdx + 1 },
                    'Encapsulate mutable state in class instances via dependency injection.',
                ),
            );
        }
    }

    private checkDirectConfigAccess(
        trimmed: string,
        file: string,
        currentLayer: ArchitectureLayer,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        issues: Issue[],
    ): void {
        const flagConfig =
            opts.flagConfigLeakage ?? ctx.config.thresholds?.flagConfigLeakage ?? false;
        if (!flagConfig || currentLayer !== ARCHITECTURE_LAYER_DOMAIN) return;

        const customConfigKws =
            opts.protectedConfigKeywords ?? ctx.config.thresholds?.protectedConfigKeywords;
        const hasDirectConfigAccess =
            trimmed.includes('process.env') ||
            trimmed.includes('fs.readFileSync') ||
            (customConfigKws && customConfigKws.some((kw: string) => trimmed.includes(kw)));
        if (hasDirectConfigAccess) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'ARCH-CFG-001',
                    `Configuration leakage: domain model in '${file}' reads environment directly.`,
                    'info',
                    { file, line: lineIdx + 1 },
                    'Inject strongly-typed configuration parameters into domain constructors.',
                ),
            );
        }
    }

    private checkGlobalAndConfigViolations(
        lineText: string,
        trimmed: string,
        file: string,
        currentLayer: ArchitectureLayer,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        issues: Issue[],
    ): void {
        this.checkMutableGlobalState(lineText, file, lineIdx, ctx, opts, issues);
        this.checkDirectConfigAccess(trimmed, file, currentLayer, lineIdx, ctx, opts, issues);
    }

    private checkDtoLeakage(
        trimmed: string,
        file: string,
        currentLayer: ArchitectureLayer,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        issues: Issue[],
    ): void {
        const secLevel = opts.securityLevel || ctx.config.securityLevel || 'basic';
        if (
            (secLevel === 'full' || opts.checkDtoCredentialLeakage) &&
            (currentLayer === ARCHITECTURE_LAYER_DOMAIN ||
                currentLayer === 'application' ||
                currentLayer === ARCHITECTURE_LAYER_INTERFACE)
        ) {
            const SENSITIVE_FIELD_RE =
                /\b(?:passwordHash|passwordSalt|secretKey|clientSecret|privateKey|authToken)\s*[:=]/i;
            if (SENSITIVE_FIELD_RE.test(trimmed)) {
                const matched = SENSITIVE_FIELD_RE.exec(trimmed);
                const field = matched ? matched[0].replace(/[:=]/g, '').trim() : 'credential';
                const descriptor = ArchitectureMessages.PUBLIC_DTO_CREDENTIAL_LEAK(field);
                issues.push(
                    this.mkIssue(
                        ctx,
                        lineIdx,
                        'ARCH-LEAK-002',
                        descriptor.message,
                        SEVERITY_ERROR,
                        { file, layer: currentLayer, field },
                        descriptor.suggestion,
                    ),
                );
            }
        }
    }

    private auditSpecifiers(
        specifiers: SpecifierInfo[],
        file: string,
        currentLayer: ArchitectureLayer,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        forbiddenModules: Set<string>,
        issues: Issue[],
        customHeadlessSet?: Set<string>,
    ): void {
        for (const spec of specifiers) {
            this.auditDomainImports(
                spec,
                file,
                currentLayer,
                lineIdx,
                ctx,
                opts,
                forbiddenModules,
                issues,
                customHeadlessSet,
            );
            this.auditCrossDomainBypass(spec, file, lineIdx, ctx, opts, issues);
            this.auditPolyglotAdapterDecoupling(spec, file, lineIdx, ctx, issues);
            if (spec.resolvedPath) {
                const targetLayer = this.resolveLayer(spec.resolvedPath, opts, ctx);
                if (
                    targetLayer === 'test' ||
                    targetLayer === 'tooling' ||
                    targetLayer === 'shared'
                ) {
                    continue;
                }

                this.auditDomainDependency(
                    spec,
                    spec.resolvedPath,
                    file,
                    currentLayer,
                    targetLayer,
                    lineIdx,
                    ctx,
                    opts,
                    issues,
                );
                this.auditApplicationDependency(
                    spec,
                    spec.resolvedPath,
                    file,
                    currentLayer,
                    targetLayer,
                    lineIdx,
                    ctx,
                    opts,
                    issues,
                );
                this.auditInterfaceSkipLayer(
                    spec,
                    spec.resolvedPath,
                    file,
                    currentLayer,
                    targetLayer,
                    lineIdx,
                    ctx,
                    opts,
                    issues,
                );
            }
        }
    }

    /**
     * checkFrameworkLeak audit step.
     *
     * @param spec - Specifier being audited.
     * @param basePkg - Base package name extracted from spec.
     * @param file - Repository-relative path of the importing file.
     * @param currentLayer - Layer inferred for the importing file.
     * @param lineIdx - Line index of the import statement.
     * @param ctx - Analyzer context of the current file.
     * @param forbiddenModules - Forbidden module set from the options.
     * @param issues - Issue accumulator the violations are pushed into.
     */
    private checkFrameworkLeak(
        spec: SpecifierInfo,
        basePkg: string,
        file: string,
        currentLayer: ArchitectureLayer,
        lineIdx: number,
        ctx: AnalyzerContext,
        forbiddenModules: Set<string>,
        issues: Issue[],
    ): void {
        if (!forbiddenModules.has(basePkg) && !forbiddenModules.has(spec.raw)) return;
        const descriptor = ArchitectureMessages.DOMAIN_FRAMEWORK_LEAK(spec.raw);
        issues.push(
            this.mkIssue(
                ctx,
                lineIdx,
                'ARCH-LEAK-001',
                descriptor.message,
                SEVERITY_ERROR,
                { file, layer: currentLayer, specifier: spec.raw },
                descriptor.suggestion,
            ),
        );
    }

    private checkHeadlessBoundary(
        spec: SpecifierInfo,
        basePkg: string,
        file: string,
        currentLayer: ArchitectureLayer,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        issues: Issue[],
        customHeadlessSet?: Set<string>,
    ): void {
        const enforceHeadless =
            opts.enforceHeadless ?? ctx.config.thresholds?.enforceHeadless ?? false;
        if (!enforceHeadless) return;

        const isForbiddenHeadless =
            FORBIDDEN_HEADLESS_IMPORTS.has(basePkg) ||
            FORBIDDEN_HEADLESS_IMPORTS.has(spec.raw) ||
            Boolean(
                customHeadlessSet &&
                (customHeadlessSet.has(basePkg) || customHeadlessSet.has(spec.raw)),
            );

        if (isForbiddenHeadless) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'ARCH-HDL-001',
                    `Headless architecture violation: domain logic in '${file}' imports presentation framework '${spec.raw}'.`,
                    SEVERITY_ERROR,
                    { file, layer: currentLayer, specifier: spec.raw },
                    'Decouple core domain logic from UI/IDE presentation frameworks.',
                ),
            );
        }
    }

    private auditDomainImports(
        spec: SpecifierInfo,
        file: string,
        currentLayer: ArchitectureLayer,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        forbiddenModules: Set<string>,
        issues: Issue[],
        customHeadlessSet?: Set<string>,
    ): void {
        if (currentLayer !== ARCHITECTURE_LAYER_DOMAIN) return;
        const basePkg = spec.raw.startsWith('@')
            ? spec.raw.split('/').slice(0, 2).join('/')
            : spec.raw.split('/')[0];

        this.checkFrameworkLeak(
            spec,
            basePkg,
            file,
            currentLayer,
            lineIdx,
            ctx,
            forbiddenModules,
            issues,
        );
        this.checkHeadlessBoundary(
            spec,
            basePkg,
            file,
            currentLayer,
            lineIdx,
            ctx,
            opts,
            issues,
            customHeadlessSet,
        );
    }

    /**
     * auditCrossDomainBypass audit step.
     *
     * @param spec - Specifier being audited.
     * @param file - Repository-relative path of the importing file.
     * @param lineIdx - Line index of the import statement.
     * @param ctx - Analyzer context of the current file.
     * @param opts - Architecture options resolved for this file.
     * @param issues - Issue accumulator the violations are pushed into.
     */
    private auditCrossDomainBypass(
        spec: SpecifierInfo,
        file: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        issues: Issue[],
    ): void {
        const flagBypass =
            opts.flagCrossDomainBypass ?? ctx.config.thresholds?.flagCrossDomainBypass ?? false;
        if (
            flagBypass &&
            (spec.raw.includes('/internal/') ||
                spec.raw.includes('/impl/') ||
                spec.raw.includes('/private/'))
        ) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'ARCH-BND-001',
                    `Cross-domain internal boundary bypass: '${file}' imports private module '${spec.raw}'.`,
                    SEVERITY_WARNING,
                    { file, specifier: spec.raw },
                    'Import through public module facade rather than private directories.',
                ),
            );
        }
    }

    /**
     * auditPolyglotAdapterDecoupling (ARCH-DEC-002).
     * Disallow direct concrete parser dependencies in analyzer or domain code.
     */
    private auditPolyglotAdapterDecoupling(
        spec: SpecifierInfo,
        file: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const isAnalyzerOrDomain =
            file.includes('analyzers/') || file.includes('analyzer') || file.includes('domain');
        if (!isAnalyzerOrDomain) return;

        const isDisallowed = DISALLOWED_PARSER_PACKAGES.some((pkg) => spec.raw.includes(pkg));
        if (isDisallowed) {
            const descriptor = ArchitectureMessages.POLYGLOT_PARSER_COUPLING(file, spec.raw);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'ARCH-DEC-002',
                    descriptor.message,
                    SEVERITY_WARNING,
                    { file, specifier: spec.raw },
                    descriptor.suggestion,
                ),
            );
        }
    }

    /**
     * auditDomainDependency audit step.
     *
     * @param spec - Specifier being audited.
     * @param resolvedPath - Resolved target path (narrowed by the caller).
     * @param file - Repository-relative path of the importing file.
     * @param currentLayer - Layer inferred for the importing file.
     * @param targetLayer - Layer inferred for the imported module.
     * @param lineIdx - Line index of the import statement.
     * @param ctx - Analyzer context of the current file.
     * @param opts - Architecture options resolved for this file.
     * @param issues - Issue accumulator the violations are pushed into.
     */
    private auditDomainDependency(
        spec: SpecifierInfo,
        resolvedPath: string,
        file: string,
        currentLayer: ArchitectureLayer,
        targetLayer: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        issues: Issue[],
    ): void {
        // Rule 1: Domain cannot depend on Application, Infrastructure, or Interface
        if (currentLayer === ARCHITECTURE_LAYER_DOMAIN) {
            if (
                targetLayer === ARCHITECTURE_LAYER_APPLICATION ||
                targetLayer === ARCHITECTURE_LAYER_INFRASTRUCTURE ||
                targetLayer === ARCHITECTURE_LAYER_INTERFACE
            ) {
                const descriptor = ArchitectureMessages.DOMAIN_INVERSION_BREACH(
                    currentLayer,
                    targetLayer,
                    resolvedPath,
                );
                issues.push(
                    this.mkIssue(
                        ctx,
                        lineIdx,
                        'ARCH-DIR-001',
                        descriptor.message,
                        SEVERITY_ERROR,
                        {
                            fromLayer: currentLayer,
                            toLayer: targetLayer,
                            targetPath: resolvedPath,
                        },
                        descriptor.suggestion,
                    ),
                );

                // Structural layering illusion (ARCH-DIR-003)
                const flagIllusions =
                    opts.flagLayeringIllusions ??
                    ctx.config.thresholds?.flagLayeringIllusions ??
                    false;
                if (flagIllusions && targetLayer === ARCHITECTURE_LAYER_INFRASTRUCTURE) {
                    issues.push(
                        this.mkIssue(
                            ctx,
                            lineIdx,
                            'ARCH-DIR-003',
                            `Structural layering illusion: domain entity '${file}' directly imports infrastructure '${resolvedPath}'.`,
                            SEVERITY_ERROR,
                            {
                                fromLayer: currentLayer,
                                toLayer: targetLayer,
                                targetPath: resolvedPath,
                            },
                            'Invert dependency using interfaces defined in the domain.',
                        ),
                    );
                }
            }
        }
    }

    /**
     * auditApplicationDependency audit step.
     */
    private auditApplicationDependency(
        spec: SpecifierInfo,
        resolvedPath: string,
        file: string,
        currentLayer: ArchitectureLayer,
        targetLayer: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        issues: Issue[],
    ): void {
        // Rule 2: Application cannot depend on Interface
        if (
            currentLayer === ARCHITECTURE_LAYER_APPLICATION &&
            targetLayer === ARCHITECTURE_LAYER_INTERFACE
        ) {
            const d = ArchitectureMessages.APPLICATION_LAYER_BREACH(targetLayer, resolvedPath);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'ARCH-DIR-001',
                    d.message,
                    SEVERITY_ERROR,
                    { fromLayer: currentLayer, toLayer: targetLayer, targetPath: resolvedPath },
                    d.suggestion,
                ),
            );
        }
    }

    /**
     * auditInterfaceSkipLayer audit step.
     */
    private auditInterfaceSkipLayer(
        spec: SpecifierInfo,
        resolvedPath: string,
        file: string,
        currentLayer: ArchitectureLayer,
        targetLayer: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        issues: Issue[],
    ): void {
        // Rule 3: Interface should not directly bypass Application to Infrastructure (Skip-Layer)
        if (
            currentLayer === ARCHITECTURE_LAYER_INTERFACE &&
            targetLayer === ARCHITECTURE_LAYER_INFRASTRUCTURE &&
            !opts.allowSkipLayers
        ) {
            const d = ArchitectureMessages.SKIP_LAYER_PENETRATION(targetLayer, resolvedPath);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'ARCH-DIR-002',
                    d.message,
                    SEVERITY_WARNING,
                    { fromLayer: currentLayer, toLayer: targetLayer, targetPath: resolvedPath },
                    d.suggestion,
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
        return {
            id: `${this.name}:${rule}:${file}:${line}`,
            analyzer: this.name,
            rule,
            severity,
            message,
            location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
            detail,
            suggestion,
        };
    }
}
