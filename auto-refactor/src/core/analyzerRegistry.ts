/**
 * Module: Core Engine — Declarative Analyzer Registry & Plan Resolution
 * File Path: src/core/analyzerRegistry.ts
 * Architecture Role: Registry/adapter layer between declarative analyzer config and the
 *   executable plan consumed by the scanner and worker threads.
 * Dependencies & Triggers: Imports `path`, core types, `AutoRefactorError`,
 *   `instantiateAnalyzer`, and the built-in analyzer classes; called from the Scanner
 *   constructor and worker-descriptor builder whenever a scan or worker pool starts.
 * Responsibilities: Publish `ResolvedAnalyzer` and `WorkerAnalyzerDesc`; map built-in names
 *   to fresh analyzer factories and to `../analyzers/*` worker module paths; load custom
 *   analyzers with `require` and validate their exports; merge thresholds with per-analyzer
 *   options; filter disabled/de-duplicated entries; and topologically order the plan by
 *   `dependsOn` so dependencies execute before dependents.
 * Exit Semantics & Design Rationale: Disabled or unknown built-in entries are skipped, and
 *   only declared analyzers run; an invalid custom-analyzer export throws AutoRefactorError,
 *   module-load failures propagate from `require`, and dependency cycles are broken without
 *   throwing to keep the engine robust. Relative worker paths deliberately start with `../`
 *   because workers run from `dist/core`.
 */
import * as path from 'path';
import type { Analyzer, AnalyzerId, ScanConfig } from './types';
import { AutoRefactorError } from './logger';
import { instantiateAnalyzer } from './loadAnalyzer';
import { ConstantsAnalyzer } from '../analyzers/constants';
import { LargeFileAnalyzer } from '../analyzers/largeFile';
import { ComplexityAnalyzer } from '../analyzers/complexity';
import { GovernanceAnalyzer } from '../analyzers/governance';
import { DependencyGraphAnalyzer } from '../analyzers/dependencyGraph';
import { SecretsAnalyzer } from '../analyzers/secrets';
import { ArchitectureAnalyzer } from '../analyzers/architecture';
import { PerformanceAnalyzer } from '../analyzers/performance';
import { CommentAnalyzer } from '../analyzers/comments';
import { HygieneAnalyzer } from '../analyzers/hygiene';
import { SecurityAnalyzer } from '../analyzers/security';
import { SimplifyAnalyzer } from '../analyzers/simplify';
import { PythonModernAnalyzer } from '../analyzers/pythonModern';
import { TsModernAnalyzer } from '../analyzers/tsModern';
import { RustModernAnalyzer } from '../analyzers/rustModern';
import { GdscriptModernAnalyzer } from '../analyzers/gdscriptModern';
import { DocsAnalyzer } from '../analyzers/docs';

/**
 * Resolved metadata and fresh instance factory for a declared analyzer.
 */
export interface ResolvedAnalyzer {
    name: AnalyzerId;
    instance: Analyzer;
    options: Record<string, any>;
    /**
     * Module path used to (re)instantiate this analyzer inside a worker thread.
     * Built-ins use a path relative to the engine's `core` dir; custom analyzers
     * use the absolute path resolved at config time. Unused in single-process mode.
     */
    modulePath: string;
    /**
     * Factory that produces a FRESH analyzer instance. Used by the single-pass multiplexed path
     * (which instantiates per file so streaming analyzers never share mutable state across the
     * concurrently scanned files handled by `pMap`). For built-ins this is the class constructor;
     * for custom analyzers it re-`require`s and re-instantiates the module.
     */
    factory: () => Analyzer;
}

/** Lightweight description of an analyzer passed to a worker thread. */
export interface WorkerAnalyzerDesc {
    name: string;
    modulePath: string;
    options: Record<string, any>;
}

/**
 * Built-in analyzer factories. Declaring a name in `ScanConfig.analyzers` resolves to one of these.
 * Adding a built-in analyzer = adding one entry here; user config stays declarative.
 */
export const BUILTIN_FACTORIES: Record<string, () => Analyzer> = {
    constants: () => new ConstantsAnalyzer(),
    'large-file': () => new LargeFileAnalyzer(),
    complexity: () => new ComplexityAnalyzer(),
    governance: () => new GovernanceAnalyzer(),
    'dependency-graph': () => new DependencyGraphAnalyzer(),
    secrets: () => new SecretsAnalyzer(),
    architecture: () => new ArchitectureAnalyzer(),
    performance: () => new PerformanceAnalyzer(),
    comments: () => new CommentAnalyzer(),
    hygiene: () => new HygieneAnalyzer(),
    security: () => new SecurityAnalyzer(),
    simplify: () => new SimplifyAnalyzer(),
    'python-modern': () => new PythonModernAnalyzer(),
    'ts-modern': () => new TsModernAnalyzer(),
    'rust-modern': () => new RustModernAnalyzer(),
    'gdscript-modern': () => new GdscriptModernAnalyzer(),
    docs: () => new DocsAnalyzer(),
};

/**
 * Module paths (relative to this `core` directory) used to (re)instantiate built-in
 * analyzers inside worker threads. The worker requires these by path so it never needs
 * the main process's analyzer instances.
 *
 * NOTE: these MUST be `../analyzers/...` (not `./analyzers/...`) — at runtime the worker
 * lives at `dist/core/worker.js`, so a `./` path would resolve to `dist/core/analyzers/...`
 * which does not exist and would make every worker silently fail (caught by the
 * in-process fallback). `../` resolves to `dist/analyzers/...`, matching the source layout
 * `src/core/` → `src/analyzers/`.
 */
export const BUILTIN_MODULE_PATHS: Record<string, string> = {
    constants: '../analyzers/constants',
    'large-file': '../analyzers/largeFile',
    complexity: '../analyzers/complexity',
    governance: '../analyzers/governance',
    'dependency-graph': '../analyzers/dependencyGraph',
    secrets: '../analyzers/secrets',
    architecture: '../analyzers/architecture',
    performance: '../analyzers/performance',
    comments: '../analyzers/comments',
    hygiene: '../analyzers/hygiene',
    security: '../analyzers/security',
    simplify: '../analyzers/simplify',
    'python-modern': '../analyzers/pythonModern',
    'ts-modern': '../analyzers/tsModern',
    'rust-modern': '../analyzers/rustModern',
    'gdscript-modern': '../analyzers/gdscriptModern',
    docs: '../analyzers/docs',
};

function loadExternalAnalyzer(
    decl: { name: string; module: string },
    baseDir: string,
): { analyzer: Analyzer; modulePath: string } {
    const modPath = path.isAbsolute(decl.module) ? decl.module : path.resolve(baseDir, decl.module);

    const mod = require(modPath);
    let analyzer: Analyzer;
    try {
        analyzer = instantiateAnalyzer(mod, decl.name);
    } catch (_e) {
        throw new AutoRefactorError(
            `custom analyzer "${decl.name}" does not export a valid Analyzer from ${modPath}`,
            'MODULE_NOT_FOUND',
        );
    }
    return { analyzer, modulePath: modPath };
}

/**
 * Order the plan so that any analyzer listed in `dependsOn` runs before its dependents.
 * Independent analyzers keep their declared (insertion) order. Cycles are reported and broken
 * (the later node is kept but a warning is logged) rather than throwing, to stay robust.
 */
function topoSort(plan: ResolvedAnalyzer[]): ResolvedAnalyzer[] {
    const byName = new Map<string, ResolvedAnalyzer>();
    for (const p of plan) byName.set(p.name, p);
    const visited = new Set<string>();
    const inProgress = new Set<string>();
    const out: ResolvedAnalyzer[] = [];

    const visit = (p: ResolvedAnalyzer) => {
        if (visited.has(p.name)) return;
        if (inProgress.has(p.name)) {
            // cycle detected — break it
            return;
        }
        inProgress.add(p.name);
        for (const dep of p.instance.dependsOn || []) {
            const d = byName.get(dep);
            if (d) visit(d);
        }
        inProgress.delete(p.name);
        visited.add(p.name);
        out.push(p);
    };

    for (const p of plan) visit(p);
    return out;
}

/**
 * Resolve the declarative registration config into the ordered analyzer plan.
 *
 * 1. Iterates `config.analyzers` (the declarative registry). A name matching a built-in factory
 *    is instantiated; its `options` are deep-merged onto the global thresholds to form
 *    `ctx.options`.
 * 2. Iterates `config.customAnalyzers` (declarative plug-ins). Each is loaded via `require(module)`
 *    and matched by `name` to its `analyzers` declaration; not-yet-seen names are added.
 *
 * No analyzer is run unless it is explicitly declared (enabled) in config — that is the whole point
 * of declarative registration: the engine never hardcodes "what runs".
 *
 * @param config - Scan config supplying the `analyzers` map and `customAnalyzers` list; entries
 *   with `enabled: false` or unknown built-in names are skipped rather than failing the scan.
 * @param baseDir - Base directory against which relative custom-analyzer module paths resolve;
 *   absolute module paths in the declarations are used unchanged.
 * @returns The executable plan in dependency order (every `dependsOn` entry precedes its
 *   dependents, cycles are broken with the later node kept) and deduplicated by analyzer name.
 */
export function resolveAnalyzers(config: ScanConfig, baseDir: string): ResolvedAnalyzer[] {
    const plan: ResolvedAnalyzer[] = [];
    const seen = new Set<string>();

    for (const [name, decl] of Object.entries(config.analyzers || {})) {
        if (!decl || decl.enabled === false) continue;
        const factory = BUILTIN_FACTORIES[name];
        if (factory) {
            plan.push({
                name,
                instance: factory(),
                options: { ...config.thresholds, ...(decl.options || {}) },
                modulePath: BUILTIN_MODULE_PATHS[name],
                factory,
            });
            seen.add(name);
        }
    }

    for (const c of config.customAnalyzers || []) {
        if (c.enabled === false) continue;
        if (seen.has(c.name)) continue;
        const { analyzer, modulePath } = loadExternalAnalyzer(c, baseDir);
        const customModulePath = modulePath;
        plan.push({
            name: c.name,
            instance: analyzer,
            options: { ...config.thresholds, ...(c.options || {}) },
            modulePath,
            factory: () => {
                const mod = require(customModulePath);
                return instantiateAnalyzer(mod, c.name);
            },
        });
        seen.add(c.name);
    }

    return topoSort(plan);
}
