/**
 * Module: Core Engine — Dependency Graph Traversal & Cycle Detection
 * File Path: src/core/dependency-graph-traversal.ts
 * Architecture Role: Graph traversal algorithms (iterative 3-color DFS cycle detection,
 *   unused export auditing, and post-scan cycle pass).
 * Dependencies & Triggers: Consumed by ./dependency-graph.ts.
 * Responsibilities:
 *   1. Iterative 3-color DFS cycle detection (findImportCycles).
 *   2. Glob to regex conversion for entry points (globToRegex).
 *   3. Unused module and export auditing with batched file I/O (auditUnusedExports).
 *   4. Diagnostic logging and issue packaging (runCyclePass).
 * Exit Semantics & Design Rationale: Bounded execution with deterministic sorted node ordering.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Issue, ScanConfig, ScanReport, Severity } from './types';
import type { ModuleDependencyGraph } from './dependency-graph';
import { detectGraphCycles } from './algorithms/graph';

const EXPORTED_SYMBOL_DETAIL_LIMIT = 10;
const MAX_UNUSED_EXPORTS_PER_MODULE = 10;
const IMPORTER_DETAIL_LIMIT = 5;
const DEFAULT_MAX_CYCLES_REPORTED = 20;
const DEPENDENCY_GRAPH_ANALYZER_ID = 'dependency-graph';
const CYCLE_ARROW_SEPARATOR = ' -> ';

/**
 * Convert a minimal glob into an anchored RegExp for entry whitelists.
 *
 * @param glob - Glob pattern using POSIX separators.
 * @returns An anchored RegExp.
 */
export function globToRegex(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
}

/**
 * Detects import cycles using an iterative three-color DFS (WHITE=0, GRAY=1, BLACK=2).
 *
 * Algorithm Invariants & Complexity Bounds:
 *   - Precondition: `edges` keys and values must be normalized POSIX relative file paths.
 *   - Invariant: Traversal is strictly iterative; stack depth is physically bounded by the total
 *     unique module count (|V|), completely eliminating call-stack overflow hazards.
 *   - Degradation Guard: Emitted cycles are downstream bounded during pass execution to prevent
 *     diagnostic explosion on densely cyclic graphs.
 *
 * @param edges - Forward adjacency map from a normalized file to its normalized imports.
 * @returns Every cycle found, each as a node path whose last element repeats the first.
 */
export function findImportCycles(edges: Map<string, Set<string>>): string[][] {
    const sortedAdjacency = new Map<string, string[]>();
    const sortedNexts = (nodeName: string): string[] => {
        let cached = sortedAdjacency.get(nodeName);
        if (!cached) {
            cached = [...(edges.get(nodeName) ?? [])].sort();
            sortedAdjacency.set(nodeName, cached);
        }
        return cached;
    };

    return detectGraphCycles([...edges.keys()].sort(), sortedNexts);
}

/**
 * Analyzer configuration options for import cycle and unused export detection.
 */
export interface CyclePassOptions {
    detectCycles?: boolean;
    cycleSeverity?: Severity;
    maxCyclesReported?: number;
    detectUnusedExports?: boolean;
    entryGlobs?: string[];
    unusedSeverity?: Severity;
}

async function readSingleFileSafe(
    rootDir: string,
    filePath: string,
): Promise<readonly [string, string] | null> {
    try {
        return [
            filePath,
            await fs.promises.readFile(path.join(rootDir, filePath), 'utf8'),
        ] as const;
    } catch {
        return null;
    }
}

function applyReadResults(
    results: Array<readonly [string, string] | null>,
    graph: ModuleDependencyGraph,
    contents: Map<string, string>,
): number {
    let failures = 0;
    for (const resultItem of results) {
        if (!resultItem) {
            failures++;
            continue;
        }
        contents.set(resultItem[0], resultItem[1]);
        graph.registerFromContent(resultItem[0], resultItem[1]);
    }
    return failures;
}

async function readFilesBatched(
    files: string[],
    rootDir: string,
    graph: ModuleDependencyGraph,
    contents: Map<string, string>,
): Promise<number> {
    const READ_WINDOW = 64;
    let failures = 0;
    for (let i = 0; i < files.length; i += READ_WINDOW) {
        const chunk = files.slice(i, i + READ_WINDOW);
        const results = await Promise.all(
            chunk.map((filePath) => readSingleFileSafe(rootDir, filePath)),
        );
        failures += applyReadResults(results, graph, contents);
    }
    return failures;
}

async function populateGraphFromFiles(
    files: string[],
    rootDir: string,
    graph: ModuleDependencyGraph,
    contents: Map<string, string>,
    warnings: string[],
): Promise<void> {
    const readFailures = await readFilesBatched(files, rootDir, graph, contents);
    if (readFailures > 0) {
        warnings.push(
            `dependency-graph: ${readFailures} file(s) unreadable, excluded from cycle analysis`,
        );
    }
}

function getOrCreateImporterSet(map: Map<string, Set<string>>, key: string): Set<string> {
    let set = map.get(key);
    if (!set) {
        set = new Set<string>();
        map.set(key, set);
    }
    return set;
}

function buildImportersMap(forward: Map<string, Set<string>>): Map<string, Set<string>> {
    const importers = new Map<string, Set<string>>();
    for (const [from, nexts] of forward) {
        for (const nextNode of nexts) {
            getOrCreateImporterSet(importers, nextNode).add(from);
        }
    }
    return importers;
}

function getImporterTokens(
    filePath: string,
    contents: Map<string, string>,
    tokenCache: Map<string, Set<string>>,
): Set<string> | undefined {
    let tokens = tokenCache.get(filePath);
    if (!tokens) {
        const fileContent = contents.get(filePath);
        if (fileContent === undefined) return undefined;
        tokens = new Set(fileContent.match(/\b[A-Za-z0-9_$]+\b/g) ?? []);
        tokenCache.set(filePath, tokens);
    }
    return tokens;
}

function auditModuleSymbols(
    mod: { file: string; exportedSymbols: string[] },
    importerSet: ReadonlySet<string>,
    contents: Map<string, string>,
    importerTokenSets: Map<string, Set<string>>,
    severity: Severity,
    issues: Issue[],
): number {
    const combinedTokens = new Set<string>();
    for (const importerPath of importerSet) {
        const tokens = getImporterTokens(importerPath, contents, importerTokenSets);
        if (tokens === undefined) {
            return 0;
        }
        for (const tok of tokens) {
            combinedTokens.add(tok);
        }
    }

    let flagged = 0;
    for (const sym of mod.exportedSymbols) {
        if (flagged >= MAX_UNUSED_EXPORTS_PER_MODULE) break;
        if (!combinedTokens.has(sym)) {
            const sampleImporters = Array.from(importerSet).slice(0, IMPORTER_DETAIL_LIMIT);
            issues.push({
                id: `dependency-graph:unused-export:${mod.file}:${sym}`,
                analyzer: DEPENDENCY_GRAPH_ANALYZER_ID,
                rule: 'unused-export',
                severity,
                message: `Exported symbol "${sym}" is not imported by any module (${mod.file}).`,
                location: {
                    file: mod.file,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                detail: { symbol: sym, importers: sampleImporters },
                suggestion:
                    'Remove this export or add it to entryGlobs if it is an external entry point.',
            });
            flagged++;
        }
    }
    return flagged;
}

function auditUnusedExports(
    graph: ModuleDependencyGraph,
    contents: Map<string, string>,
    opts: CyclePassOptions,
    issues: Issue[],
    logger?: { info: (msg: string) => void },
): void {
    const entryRes = (opts.entryGlobs ?? []).map(globToRegex);
    const importers = buildImportersMap(graph.getForwardEdges());
    const importerTokenSets = new Map<string, Set<string>>();
    const ENTRY_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const isEntry = (filePath: string): boolean =>
        entryRes.some((regex) => ENTRY_EXTS.some((ext) => regex.test(filePath + ext)));
    let unusedFlagged = 0;
    const unusedSeverity: Severity = opts.unusedSeverity ?? 'warning';

    for (const mod of graph.getModules()) {
        if (mod.exportedSymbols.length === 0) continue;
        if (isEntry(mod.file) || mod.file.endsWith('.d.ts')) continue;
        const importerSet = importers.get(mod.file);

        if (!importerSet || importerSet.size === 0) {
            issues.push({
                id: `dependency-graph:unused-module:${mod.file}:1`,
                analyzer: DEPENDENCY_GRAPH_ANALYZER_ID,
                rule: 'unused-module',
                severity: unusedSeverity,
                message: `Module is not imported by any file and exports ${mod.exportedSymbols.length} symbol(s) (dead module candidate).`,
                location: {
                    file: mod.file,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                detail: {
                    exportedSymbols: mod.exportedSymbols.slice(0, EXPORTED_SYMBOL_DETAIL_LIMIT),
                },
                suggestion:
                    'Verify whether this is legacy dead code: remove, archive, or add to entryGlobs with justification.',
            });
            unusedFlagged++;
            continue;
        }

        unusedFlagged += auditModuleSymbols(
            mod,
            importerSet,
            contents,
            importerTokenSets,
            unusedSeverity,
            issues,
        );
    }
    if (unusedFlagged > 0 && logger) {
        logger.info(`dependency-graph: ${unusedFlagged} unused module/export issue(s)`);
    }
}

function auditImportCycles(
    graph: ModuleDependencyGraph,
    opts: CyclePassOptions,
    issues: Issue[],
    warnings: string[],
): void {
    const topo = graph.analyzeTopologicalStructure();
    if (topo.isAcyclic) return;
    const cycles = findImportCycles(graph.getForwardEdges());
    const cap = opts.maxCyclesReported ?? DEFAULT_MAX_CYCLES_REPORTED;
    const cycleSeverity: Severity = opts.cycleSeverity ?? 'error';
    for (const cyc of cycles.slice(0, cap)) {
        issues.push({
            id: `dependency-graph:import-cycle:${cyc[0]}:1`,
            analyzer: DEPENDENCY_GRAPH_ANALYZER_ID,
            rule: 'import-cycle',
            severity: cycleSeverity,
            message: `Circular dependency: ${cyc.join(CYCLE_ARROW_SEPARATOR)}`,
            location: { file: cyc[0], start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            detail: { cycle: cyc, length: cyc.length },
            suggestion:
                'Extract shared logic to a lower-layer module or invert dependency via interfaces.',
        });
    }
    if (cycles.length > cap) {
        warnings.push(
            `dependency-graph: ${cycles.length - cap} additional cycle(s) beyond report cap (${cap})`,
        );
    }
}

/**
 * Logger sink accepting diagnostic info messages from cycle detection.
 */
export type CyclePassLogger = { info: (msg: string) => void };

/**
 * Post-scan pass reporting import cycles and, when enabled, unused modules/exports.
 * Concurrency: Thread-safe async analysis pass operating on independent AST structures.
 *
 * @param report - Scan report whose file metrics define the analyzed file set.
 * @param config - Resolved scan configuration.
 * @param logger - Optional diagnostic sink.
 * @param prebuilt - Dependency graph reused from an earlier pass.
 * @param snapshotSource - Exact fixed input text; omitted retains directory file reads.
 * @returns Detected issues plus any diagnostic warnings.
 */
export async function runCyclePass(
    report: ScanReport,
    config: ScanConfig,
    logger?: CyclePassLogger,
    prebuilt?: ModuleDependencyGraph | null,
    snapshotSource?: ReadonlyMap<string, string>,
): Promise<{ issues: Issue[]; warnings: string[] }> {
    const issues: Issue[] = [];
    const warnings: string[] = [];
    const opts = (config.analyzers[DEPENDENCY_GRAPH_ANALYZER_ID]?.options ||
        {}) as CyclePassOptions;
    if (opts.detectCycles === false) return { issues, warnings };

    const files = report.fileMetrics.map((fileMetric) => fileMetric.file);
    const usePrebuilt = !snapshotSource && prebuilt != null && opts.detectUnusedExports !== true;
    const graph = resolveCyclePassGraph(prebuilt, usePrebuilt);
    const contents = new Map<string, string>();

    if (snapshotSource) {
        for (const file of files) {
            const content = snapshotSource.get(file);
            if (content === undefined)
                throw new Error(`snapshot dependency source missing: ${file}`);
            contents.set(file, content);
            graph.registerFromContent(file, content);
        }
    } else if (!usePrebuilt) {
        await populateGraphFromFiles(files, config.root, graph, contents, warnings);
    }
    if (opts.detectUnusedExports === true) {
        auditUnusedExports(graph, contents, opts, issues, logger);
    }
    auditImportCycles(graph, opts, issues, warnings);

    return { issues, warnings };
}

function resolveCyclePassGraph(
    prebuilt: ModuleDependencyGraph | null | undefined,
    usePrebuilt: boolean,
): ModuleDependencyGraph {
    if (usePrebuilt && prebuilt) return prebuilt;
    const { ModuleDependencyGraph: GraphClass } =
        require('./dependency-graph') as typeof import('./dependency-graph'); // @lazy break circular dependency
    return new GraphClass();
}
