/**
 * Module: Core Engine — Declarative Analyzer Registry & Plan Resolution
 * File Path: src/core/analyzer-registry.ts
 * Architecture Role: Registry/adapter layer between declarative config and scanner plan.
 * Dependencies & Triggers: Imports path, core types, AutoRefactorError, instantiateAnalyzer.
 * Responsibilities: Publish ResolvedAnalyzer and WorkerAnalyzerDesc; map built-in names
 *   to fresh analyzer factories and to worker module paths; load custom analyzers.
 * Exit Semantics & Design Rationale: Topological sort with cycle-breaking to keep engine robust.
 */
import { createRequire } from 'module';
import * as path from 'path';
import type { Analyzer, AnalyzerId, ScanConfig } from './types';
import { AutoRefactorError } from './logger';
import { instantiateAnalyzer } from './load-analyzer';
import { ERR_INVALID_CUSTOM_ANALYZER } from './router/sliceTypes';
import { ConstantsAnalyzer } from '../analyzers/constants';
import { LargeFileAnalyzer } from '../analyzers/large-file';
import { ComplexityAnalyzer } from '../analyzers/complexity';
import { GovernanceAnalyzer } from '../analyzers/governance';
import { DependencyGraphAnalyzer } from '../analyzers/dependency-graph';
import { SecretsAnalyzer } from '../analyzers/secrets';
import { ArchitectureAnalyzer } from '../analyzers/architecture';
import { PerformanceAnalyzer } from '../analyzers/performance';
import { CommentAnalyzer } from '../analyzers/comments';
import { HygieneAnalyzer } from '../analyzers/hygiene';
import { SecurityAnalyzer } from '../analyzers/security';
import { SimplifyAnalyzer } from '../analyzers/simplify';
import { PythonModernAnalyzer } from '../analyzers/python-modern';
import { TsModernAnalyzer } from '../analyzers/ts-modern';
import { RustModernAnalyzer } from '../analyzers/rust-modern';
import { GdscriptModernAnalyzer } from '../analyzers/gdscript-modern';
import { GoModernAnalyzer } from '../analyzers/go-modern';
import { DocsAnalyzer } from '../analyzers/docs';
import { DataArchitectureAnalyzer } from '../analyzers/data-architecture';
import { TestModernityAnalyzer } from '../analyzers/test-modernity';
import { DependencyLayoutAnalyzer } from '../analyzers/dependency-layout';
import { NamingAnalyzer } from '../analyzers/naming';
import { ShellLintAnalyzer } from '../analyzers/shell-lint';
import { StdlibAnalyzer } from '../analyzers/stdlib';
import { GdscriptGameAnalyzer } from '../analyzers/gdscript-game';
import { VscodeExtensionAnalyzer } from '../analyzers/vscode-extension';
import { GateArchitectureAnalyzer } from '../analyzers/gate-architecture';
import { FrontendAnalyzer } from '../analyzers/frontend';
import { ProductionHygieneAnalyzer } from '../analyzers/production-hygiene';
import { ClientExposureAnalyzer } from '../analyzers/client-exposure';

/** Resolved metadata and fresh instance factory for a declared analyzer. */
export interface ResolvedAnalyzer {
    name: AnalyzerId;
    instance: Analyzer;
    options: Record<string, any>;
    modulePath: string;
    factory: () => Analyzer;
}

/** Lightweight description of an analyzer passed to a worker thread. */
export interface WorkerAnalyzerDesc {
    name: string;
    modulePath: string;
    options: Record<string, any>;
}

type AnalyzerConstructor = new () => Analyzer;

const ANALYZER_MODULE_PREFIX = '../analyzers/';
const ANALYZER_NAMES_TEMPLATE = `
hygiene
shell-lint
large-file
secrets
security
comments
naming
constants
docs
production-hygiene
simplify
complexity
stdlib
ts-modern
python-modern
rust-modern
gdscript-modern
go-modern
frontend
performance
architecture
data-architecture
dependency-layout
dependency-graph
gate-architecture
gdscript-game
vscode-extension
client-exposure
test-modernity
governance
`.trim();

const ANALYZER_CLASSES: AnalyzerConstructor[] = [
    HygieneAnalyzer,
    ShellLintAnalyzer,
    LargeFileAnalyzer,
    SecretsAnalyzer,
    SecurityAnalyzer,
    CommentAnalyzer,
    NamingAnalyzer,
    ConstantsAnalyzer,
    DocsAnalyzer,
    ProductionHygieneAnalyzer,
    SimplifyAnalyzer,
    ComplexityAnalyzer,
    StdlibAnalyzer,
    TsModernAnalyzer,
    PythonModernAnalyzer,
    RustModernAnalyzer,
    GdscriptModernAnalyzer,
    GoModernAnalyzer,
    FrontendAnalyzer,
    PerformanceAnalyzer,
    ArchitectureAnalyzer,
    DataArchitectureAnalyzer,
    DependencyLayoutAnalyzer,
    DependencyGraphAnalyzer,
    GateArchitectureAnalyzer,
    GdscriptGameAnalyzer,
    VscodeExtensionAnalyzer,
    ClientExposureAnalyzer,
    TestModernityAnalyzer,
    GovernanceAnalyzer,
];

function buildBuiltinFactories(): Record<string, () => Analyzer> {
    const factories: Record<string, () => Analyzer> = {};
    const names = ANALYZER_NAMES_TEMPLATE.split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
    names.forEach((name, index) => {
        const Ctor = ANALYZER_CLASSES[index];
        if (Ctor) {
            factories[name] = () => new Ctor();
        }
    });
    return Object.freeze(factories);
}

/** Built-in analyzer factories dictionary. */
export const BUILTIN_FACTORIES: Record<string, () => Analyzer> = buildBuiltinFactories();

function buildBuiltinModulePaths(): Record<string, string> {
    const paths: Record<string, string> = {};
    const names = ANALYZER_NAMES_TEMPLATE.split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
    names.forEach((analyzerName) => {
        paths[analyzerName] = `${ANALYZER_MODULE_PREFIX}${analyzerName}`;
    });
    return Object.freeze(paths);
}

/** Built-in analyzer worker module path map. */
export const BUILTIN_MODULE_PATHS: Record<string, string> = buildBuiltinModulePaths();

const dynamicRequire = createRequire(__filename);

function loadExternalAnalyzer(
    decl: { name: string; module: string },
    baseDir: string,
): { analyzer: Analyzer; modulePath: string } {
    const modPath = path.isAbsolute(decl.module) ? decl.module : path.resolve(baseDir, decl.module);

    const mod = dynamicRequire(modPath);
    let analyzer: Analyzer;
    try {
        analyzer = instantiateAnalyzer(mod, decl.name);
    } catch (_e) {
        throw new AutoRefactorError(
            `${ERR_INVALID_CUSTOM_ANALYZER} custom analyzer "${decl.name}" does not export a valid Analyzer from ${modPath}`,
            'MODULE_NOT_FOUND',
        );
    }
    return { analyzer, modulePath: modPath };
}

function computeTopologicalSort(plan: ResolvedAnalyzer[]): ResolvedAnalyzer[] {
    const visited = new Set<string>();
    const inProgress = new Set<string>();
    const analyzerByNameMap = new Map<string, ResolvedAnalyzer>();
    plan.forEach((item) => analyzerByNameMap.set(item.name, item));
    const orderedPlan: ResolvedAnalyzer[] = [];

    const visit = (analyzerItem: ResolvedAnalyzer) => {
        if (visited.has(analyzerItem.name)) return;
        if (inProgress.has(analyzerItem.name)) return;
        inProgress.add(analyzerItem.name);
        const dependsOn = analyzerItem.instance.dependsOn;
        if (dependsOn) {
            dependsOn.forEach((dep) => {
                const dependentItem = analyzerByNameMap.get(dep);
                if (dependentItem) visit(dependentItem);
            });
        }
        inProgress.delete(analyzerItem.name);
        visited.add(analyzerItem.name);
        orderedPlan.push(analyzerItem);
    };

    plan.forEach((analyzerItem) => visit(analyzerItem));
    return orderedPlan;
}

function resolveBuiltinAnalyzers(
    config: ScanConfig,
    plan: ResolvedAnalyzer[],
    seen: Set<string>,
): void {
    const analyzers = config.analyzers;
    if (!analyzers) return;
    const baseThresholds = config.thresholds || {};

    for (const name of Object.keys(analyzers)) {
        const decl = analyzers[name];
        if (!decl || decl.enabled === false) continue;
        const factory = BUILTIN_FACTORIES[name];
        if (factory) {
            plan.push({
                name,
                instance: factory(),
                options: decl.options ? { ...baseThresholds, ...decl.options } : baseThresholds,
                modulePath: BUILTIN_MODULE_PATHS[name],
                factory,
            });
            seen.add(name);
        }
    }
}

function resolveCustomAnalyzers(
    config: ScanConfig,
    baseDir: string,
    plan: ResolvedAnalyzer[],
    seen: Set<string>,
): void {
    const customAnalyzers = config.customAnalyzers;
    if (!customAnalyzers) return;
    for (const c of customAnalyzers) {
        if (c.enabled === false || seen.has(c.name)) continue;
        if (!c.signals || !Array.isArray(c.signals) || c.signals.length === 0 || !c.track) {
            throw new Error(
                `${ERR_INVALID_CUSTOM_ANALYZER} Custom analyzer '${c.name}' must declare 'signals' and 'track' (Fail-Closed, N-08)`,
            );
        }
        const { analyzer, modulePath } = loadExternalAnalyzer(c, baseDir);
        const customModulePath = modulePath;
        plan.push({
            name: c.name,
            instance: analyzer,
            options: { ...config.thresholds, ...(c.options || {}) },
            modulePath,
            factory: () => {
                const mod = dynamicRequire(customModulePath);
                return instantiateAnalyzer(mod, c.name);
            },
        });
        seen.add(c.name);
    }
}

/**
 * Resolves declarative analyzer configuration into an ordered execution plan.
 *
 * @param config - Scan configuration specifying enabled analyzers and overrides.
 * @param baseDir - Base directory used for resolving custom analyzer paths.
 * @returns Array of resolved analyzers sorted topologically by dependencies.
 */
export function resolveAnalyzers(config: ScanConfig, baseDir: string): ResolvedAnalyzer[] {
    const plan: ResolvedAnalyzer[] = [];
    const seen = new Set<string>();

    resolveBuiltinAnalyzers(config, plan, seen);
    resolveCustomAnalyzers(config, baseDir, plan, seen);

    return computeTopologicalSort(plan);
}
