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
import * as path from 'path';
import type { Analyzer, AnalyzerContext, Issue, ArchitectureLayer } from '../core/types';
import { inferDirectorySemantic } from '../core/profiler/projectProfiler';
import { ArchitectureMessages } from '../core/messages/architecture';
import { FORBIDDEN_HEADLESS_IMPORTS } from '../core/intelligence/semanticArchitecture';

interface ArchitectureOptions {
    enforceCleanLayers?: boolean;
    layers?: Record<string, ArchitectureLayer>;
    forbiddenDomainImports?: string[];
    allowSkipLayers?: boolean;
    securityLevel?: import('../core/types').SecurityLevel;
    checkDtoCredentialLeakage?: boolean;
    enforceHeadless?: boolean;
    flagCrossDomainBypass?: boolean;
    flagMutableGlobalCoupling?: boolean;
    flagLayeringIllusions?: boolean;
    flagConfigLeakage?: boolean;
}

interface SpecifierInfo {
    raw: string;
    isExternal: boolean;
    resolvedPath?: string;
}

const DEFAULT_FORBIDDEN_DOMAIN_IMPORTS = [
    // Web & UI frameworks
    'express',
    'koa',
    'fastify',
    'react',
    'vue',
    '@angular',
    'svelte',
    'django',
    'fastapi',
    'flask',
    'actix_web',
    'actix-web',
    'axum',
    'tokio',
    'godot',
    'vscode',
    'electron',
    // Database & ORM drivers
    'pg',
    'mysql',
    'mysql2',
    'sqlite3',
    'typeorm',
    'prisma',
    'mongoose',
    'sequelize',
    'sqlalchemy',
    'diesel',
    'sqlx',
    // Low-level runtime I/O
    'fs',
    'net',
    'http',
    'https',
    'child_process',
    'subprocess',
    'socket',
];

/**
 * Polyglot import and module reference extractors:
 * 1. TS/JS: import ... from '...', require('...'), import('...')
 * 2. GDScript: preload("res://..."), load("res://..."), extends "res://..."
 * 3. Python: from .pkg.module import ..., from pkg.module import ..., import pkg.module
 * 4. Rust: use crate::pkg::module, use super::pkg::module
 */
const JS_IMPORT_RE =
    /(?:import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?|export\s+(?:[\s\S]*?from\s+)?|import\(|require\()['"]([^'"]+)['"]/g;

const GDSCRIPT_IMPORT_RE =
    /(?:(?:preload|load)\s*\(\s*['"](?:res:\/\/)?([^'"]+)['"]\s*\)|extends\s+['"](?:res:\/\/)?([^'"]+)['"])/g;

const PYTHON_FROM_IMPORT_RE = /^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/;

const RUST_USE_RE = /^\s*use\s+(?:crate|super)::([A-Za-z0-9_:]+)/;

const GO_IMPORT_RE = /^\s*(?:import\s+)?['"]([^'"]+)['"]/;

const JAVA_IMPORT_RE = /^\s*import\s+(?:static\s+)?([A-Za-z0-9_.]+);?/;

const CSHARP_USING_RE = /^\s*using\s+([A-Za-z0-9_.]+);/;

/** ASCII code of carriage return, stripped from CRLF line endings before per-line analysis. */
const CARRIAGE_RETURN_CHAR_CODE = 13;

/** Clean Architecture layer name for domain code, used in comparisons and path prefixes. */
const ARCHITECTURE_LAYER_DOMAIN = 'domain';

/** Clean Architecture layer name for interface/adapter code (the outermost layer). */
const ARCHITECTURE_LAYER_INTERFACE = 'interface';

/** Issue severity for hard boundary violations such as framework leaks and inversions. */
const SEVERITY_ERROR = 'error';

/** Issue severity for advisory boundary findings such as allowed skip-layer penetrations. */
const SEVERITY_WARNING = 'warning';

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
        const opts = (ctx.options || {}) as ArchitectureOptions;
        if (opts.enforceCleanLayers === false) {
            return [];
        }

        const file = ctx.filePath.replace(/\\/g, '/');
        const currentLayer = this.resolveLayer(file, opts, ctx);

        // Tests and tooling are exempt from domain-layer inversion rules
        if (currentLayer === 'test' || currentLayer === 'tooling' || currentLayer === 'shared') {
            return [];
        }

        const issues: Issue[] = [];
        const forbiddenModules = new Set(
            opts.forbiddenDomainImports || DEFAULT_FORBIDDEN_DOMAIN_IMPORTS,
        );

        const content = ctx.content || '';
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

            // Check DTO credential exposure in export contracts
            this.checkDtoLeakage(trimmed, file, currentLayer, lineIdx, ctx, opts, issues);

            // Collect and audit referenced module specifiers
            const specifiers = this.extractSpecifiers(lineText, trimmed, file);
            this.auditSpecifiers(
                specifiers,
                file,
                currentLayer,
                lineIdx,
                ctx,
                opts,
                forbiddenModules,
                issues,
            );

            // Check shared mutable global state (ARCH-GLB-001)
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

            // Check direct environment or disk config access in domain (ARCH-CFG-001)
            const flagConfig =
                opts.flagConfigLeakage ?? ctx.config.thresholds?.flagConfigLeakage ?? false;
            if (
                flagConfig &&
                currentLayer === ARCHITECTURE_LAYER_DOMAIN &&
                (trimmed.includes('process.env') || trimmed.includes('fs.readFileSync'))
            ) {
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

            lineIdx++;
            lineStart = nextStart;
        }

        return issues;
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

    private extractJsSpecifiers(lineText: string, file: string, specifiers: SpecifierInfo[]): void {
        JS_IMPORT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = JS_IMPORT_RE.exec(lineText)) !== null) {
            if (m[1]) {
                const raw = m[1];
                const isRelative =
                    raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('@/');
                specifiers.push({
                    raw,
                    isExternal: !isRelative,
                    resolvedPath: isRelative
                        ? path.posix.normalize(path.posix.join(path.posix.dirname(file), raw))
                        : undefined,
                });
            }
        }
    }

    private extractGdScriptSpecifiers(lineText: string, specifiers: SpecifierInfo[]): void {
        GDSCRIPT_IMPORT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = GDSCRIPT_IMPORT_RE.exec(lineText)) !== null) {
            const raw = m[1] || m[2];
            if (raw) {
                specifiers.push({
                    raw,
                    isExternal: false,
                    resolvedPath: raw.replace(/\.(gd|tscn)$/, ''),
                });
            }
        }
    }

    private extractPythonSpecifiers(
        trimmed: string,
        file: string,
        specifiers: SpecifierInfo[],
    ): void {
        const pyMatch = trimmed.match(PYTHON_FROM_IMPORT_RE);
        if (!pyMatch) return;
        const mod = pyMatch[1] || pyMatch[2];
        if (!mod) return;
        const isRelative = mod.startsWith('.');
        const cleanMod = mod.replace(/^\.+/, '').replace(/\./g, '/');
        specifiers.push({
            raw: mod,
            isExternal:
                !isRelative &&
                !mod.startsWith('app') &&
                !mod.startsWith(ARCHITECTURE_LAYER_DOMAIN) &&
                !mod.startsWith('infra'),
            resolvedPath: isRelative
                ? path.posix.normalize(path.posix.join(path.posix.dirname(file), cleanMod))
                : cleanMod,
        });
    }

    private extractRustSpecifiers(trimmed: string, specifiers: SpecifierInfo[]): void {
        const rustMatch = trimmed.match(RUST_USE_RE);
        if (rustMatch && rustMatch[1]) {
            specifiers.push({
                raw: rustMatch[1],
                isExternal: false,
                resolvedPath: rustMatch[1].replace(/::/g, '/'),
            });
        }
    }

    private extractGoSpecifiers(trimmed: string, specifiers: SpecifierInfo[]): void {
        const goMatch = trimmed.match(GO_IMPORT_RE);
        if (goMatch && goMatch[1]) {
            specifiers.push({
                raw: goMatch[1],
                isExternal: !goMatch[1].includes('.'),
                resolvedPath: goMatch[1],
            });
        }
    }

    private extractJvmSpecifiers(trimmed: string, specifiers: SpecifierInfo[]): void {
        const jvmMatch = trimmed.match(JAVA_IMPORT_RE);
        if (jvmMatch && jvmMatch[1]) {
            specifiers.push({
                raw: jvmMatch[1],
                isExternal:
                    jvmMatch[1].startsWith('java.') ||
                    jvmMatch[1].startsWith('javax.') ||
                    jvmMatch[1].startsWith('kotlin.'),
                resolvedPath: jvmMatch[1].replace(/\./g, '/'),
            });
        }
    }

    private extractCSharpSpecifiers(trimmed: string, specifiers: SpecifierInfo[]): void {
        const csMatch = trimmed.match(CSHARP_USING_RE);
        if (csMatch && csMatch[1]) {
            specifiers.push({
                raw: csMatch[1],
                isExternal: csMatch[1].startsWith('System.') || csMatch[1].startsWith('Microsoft.'),
                resolvedPath: csMatch[1].replace(/\./g, '/'),
            });
        }
    }

    private extractSpecifiers(lineText: string, trimmed: string, file: string): SpecifierInfo[] {
        const specifiers: SpecifierInfo[] = [];
        this.extractJsSpecifiers(lineText, file, specifiers);
        this.extractGdScriptSpecifiers(lineText, specifiers);

        if (file.endsWith('.py')) {
            this.extractPythonSpecifiers(trimmed, file, specifiers);
        } else if (file.endsWith('.rs')) {
            this.extractRustSpecifiers(trimmed, specifiers);
        } else if (file.endsWith('.go')) {
            this.extractGoSpecifiers(trimmed, specifiers);
        } else if (file.endsWith('.java') || file.endsWith('.kt') || file.endsWith('.kts')) {
            this.extractJvmSpecifiers(trimmed, specifiers);
        } else if (file.endsWith('.cs')) {
            this.extractCSharpSpecifiers(trimmed, specifiers);
        }

        return specifiers;
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
            );
            this.auditCrossDomainBypass(spec, file, lineIdx, ctx, opts, issues);
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
     * auditDomainImports audit step.
     *
     * @param spec - Specifier being audited.
     * @param file - Repository-relative path of the importing file.
     * @param currentLayer - Layer inferred for the importing file.
     * @param lineIdx - Line index of the import statement.
     * @param ctx - Analyzer context of the current file.
     * @param opts - Architecture options resolved for this file.
     * @param forbiddenModules - Forbidden module set from the options.
     * @param issues - Issue accumulator the violations are pushed into.
     */
    private auditDomainImports(
        spec: SpecifierInfo,
        file: string,
        currentLayer: ArchitectureLayer,
        lineIdx: number,
        ctx: AnalyzerContext,
        opts: ArchitectureOptions,
        forbiddenModules: Set<string>,
        issues: Issue[],
    ): void {
        if (currentLayer === ARCHITECTURE_LAYER_DOMAIN) {
            const basePkg = spec.raw.startsWith('@')
                ? spec.raw.split('/').slice(0, 2).join('/')
                : spec.raw.split('/')[0];
            if (forbiddenModules.has(basePkg) || forbiddenModules.has(spec.raw)) {
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

            // Headless architecture boundary check (ARCH-HDL-001)
            const enforceHeadless =
                opts.enforceHeadless ?? ctx.config.thresholds?.enforceHeadless ?? false;
            if (
                enforceHeadless &&
                (FORBIDDEN_HEADLESS_IMPORTS.has(basePkg) ||
                    FORBIDDEN_HEADLESS_IMPORTS.has(spec.raw))
            ) {
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
                targetLayer === 'application' ||
                targetLayer === 'infrastructure' ||
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
                if (flagIllusions && targetLayer === 'infrastructure') {
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
        if (currentLayer === 'application' && targetLayer === ARCHITECTURE_LAYER_INTERFACE) {
            const descriptor = ArchitectureMessages.APPLICATION_LAYER_BREACH(
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
        }
    }

    /**
     * auditInterfaceSkipLayer audit step.
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
        // Rule 3: Interface should not directly bypass Application to Infrastructure
        // (Skip-Layer)
        if (currentLayer === ARCHITECTURE_LAYER_INTERFACE && targetLayer === 'infrastructure') {
            if (!opts.allowSkipLayers) {
                const descriptor = ArchitectureMessages.SKIP_LAYER_PENETRATION(
                    targetLayer,
                    resolvedPath,
                );
                issues.push(
                    this.mkIssue(
                        ctx,
                        lineIdx,
                        'ARCH-DIR-002',
                        descriptor.message,
                        SEVERITY_WARNING,
                        {
                            fromLayer: currentLayer,
                            toLayer: targetLayer,
                            targetPath: resolvedPath,
                        },
                        descriptor.suggestion,
                    ),
                );
            }
        }
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined as any, ctx);
    }

    private resolveLayer(
        filePath: string,
        opts: ArchitectureOptions,
        ctx: AnalyzerContext,
    ): ArchitectureLayer {
        const norm = filePath.replace(/\\/g, '/');

        // Check user layer overrides first
        if (opts.layers) {
            for (const [pattern, layer] of Object.entries(opts.layers)) {
                if (norm.includes(pattern)) return layer;
            }
        }

        // Check project profile directory semantics
        if (ctx.config.profile?.directorySemantics) {
            for (const [dir, layer] of Object.entries(ctx.config.profile.directorySemantics)) {
                if (norm.startsWith(dir + '/') || norm.includes('/' + dir + '/')) {
                    return layer;
                }
            }
        }

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
        severity: 'info' | typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
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
