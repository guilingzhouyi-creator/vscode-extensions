/**
 * Module: Core Engine — Module Dependency Graph & Reverse Impact Analysis
 * File Path: src/core/dependency-graph.ts
 * Architecture Role: In-memory post-scan graph service that is the single source of
 *                    reverse-import, cycle, and unused-export facts for pipeline passes.
 * Dependencies & Triggers: Imported by the API/pipeline post-scan passes, Review Cell impact
 *                    analysis, and cycle/export checks; consumes fs, path, normalizePath,
 *                    and ScanReport/ScanConfig/Issue types.
 * Responsibilities: Register modules from import/export regex parsing, keep reverse adjacency
 *                    and imported-symbol maps, compute transitive affected files and symbol
 *                    impact plans, expose forward edges/modules, run iterative three-color
 *                    cycle detection, and flag unused modules/exports when enabled.
 * Exit Semantics & Design Rationale: `runCyclePass` accumulates issues and warnings instead
 *                    of throwing: unreadable files are counted and excluded, `detectCycles`
 *                    false yields an empty result, reads are chunked for large reports, and
 *                    output is capped; regex indexing avoids a TypeScript AST dependency so
 *                    the pass stays cheap on large reports and safe in post-scan reuse.
 *
 * Module Dependency Graph & Reverse Impact Analyzer.
 * Constructs an in-memory Directed Acyclic Graph (DAG) over source file imports/exports:
 * - Maps which files import symbols from other files (reverse dependency lookup)
 * - Computes transitive impact sets when a file or exported symbol changes
 * - Operates in < 0.5ms query time for 1000+ files to supply Review Cell impact analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizePath } from './file-discovery';
import { PYTHON_STDLIB_MODULES } from './intelligence/python-stdlib';
import type { Issue, ScanConfig, ScanReport, Severity } from './types';
import { nativeCore } from './native/native-bridge';
import type { NativeGraphAnalysis } from './native/native-types';

/** Default maximum traversal depth for transitive affected-file queries. */
const DEFAULT_MAX_AFFECTED_DEPTH = 10;

/** Maximum exported symbols sampled into an unused-module detail payload. */
const EXPORTED_SYMBOL_DETAIL_LIMIT = 10;

/** Maximum unused exports reported per module before moving to the next module. */
const MAX_UNUSED_EXPORTS_PER_MODULE = 10;

/** Maximum importer files sampled into an unused-export detail payload. */
const IMPORTER_DETAIL_LIMIT = 5;

/** Default cap on import cycles reported per scan. */
const DEFAULT_MAX_CYCLES_REPORTED = 20;

/** Registered analyzer id, used as the config key and on every emitted issue. */
const DEPENDENCY_GRAPH_ANALYZER_ID = 'dependency-graph';

/** Arrow separator used to format circular dependency chain paths. */
const CYCLE_ARROW_SEPARATOR = ' -> ';

/**
 * Per-module inventory: the file's exported symbol names plus the normalized specifiers of
 * every module it imports; the graph keys these entries by extension-less normalized path.
 */
export interface ModuleExportInfo {
    exportedSymbols: Set<string>;
    importedModules: Set<string>; // resolved relative paths
}

/**
 * A single named-import site: the imported symbol, its optional local alias, the normalized
 * source file it resolved to, and the 1-based source line when the parser captured one.
 */
export interface ImportedSymbolRef {
    symbol: string;
    alias?: string;
    sourceFile: string;
    line?: number;
}

/**
 * Result of a symbol-level impact query: the normalized target, the changed symbols, the
 * downstream files that directly import at least one of them, each impacted import site, and
 * a human-readable refactor plan (empty when no changed symbols were supplied).
 */
export interface SymbolImpactAnalysis {
    targetFile: string;
    changedSymbols: string[];
    affectedFiles: string[];
    impactedImportSites: Array<{
        importerFile: string;
        importedSymbol: string;
        alias?: string;
        line?: number;
    }>;
    suggestedRefactorPlan: string[];
}

function parsePythonImportStatement(
    line: string,
    out: Array<{ module: string; names: string[] }>,
): boolean {
    const importMatch = /^import[ \t]+([^\n#]+)/.exec(line);
    if (!importMatch) return false;
    for (const part of importMatch[1].split(',')) {
        const name = part
            .trim()
            .split(/\s+as\s+/)[0]
            .trim();
        if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(name)) {
            out.push({ module: name, names: [] });
        }
    }
    return true;
}

function parsePythonFromImportStatement(
    line: string,
    out: Array<{ module: string; names: string[] }>,
): void {
    const fromMatch =
        /^from[ \t]+(\.+|\.*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]+import[ \t]+([^\n#]*)/.exec(line);
    if (!fromMatch) return;
    const names = fromMatch[2]
        .replace(/[()]/g, ' ')
        .split(',')
        .map((name) =>
            name
                .trim()
                .split(/\s+as\s+/)[0]
                .trim(),
        )
        .filter((name) => /^[A-Za-z_]\w*$/.test(name));
    out.push({ module: fromMatch[1], names });
}

/**
 * Extract module-level Python import targets: `import a.b, c.d` and `from .pkg import name`.
 *
 * Only column-zero statements become edges. Function-local (indented) imports are deliberately
 * skipped because lazy imports exist precisely to break import cycles — counting them would
 * fabricate cycles that Python never has. Lines inside triple-quoted strings (module/class/
 * function docstrings) are skipped through a small quote-state scan, so an example `import` in a
 * docstring never becomes a dependency.
 *
 * @param content - Raw Python source text.
 * @returns One entry per statement: the dotted module specifier plus names pulled by `from`.
 */
function collectPythonImports(content: string): Array<{ module: string; names: string[] }> {
    const out: Array<{ module: string; names: string[] }> = [];
    let inTriple: string | null = null;
    for (const rawLine of content.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        const marker = line.includes('"""') ? '"""' : line.includes("'''") ? "'''" : null;
        const markerCount = marker ? line.split(marker).length - 1 : 0;
        if (inTriple !== null) {
            if (marker === inTriple && markerCount % 2 === 1) inTriple = null;
            continue;
        }
        if (marker && markerCount % 2 === 1) {
            inTriple = marker;
            continue;
        }

        if (parsePythonImportStatement(line, out)) {
            continue;
        }
        parsePythonFromImportStatement(line, out);
    }
    return out;
}

function cloneStringSet(set: Set<string>): Set<string> {
    return new Set(set);
}

function extractImportedPaths(content: string): string[] {
    const importedPaths: string[] = [];
    const importRegex =
        /(?:import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]|export\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)|require\(['"]([^'"]+)['"]\))/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
        const specifier = match[1] || match[2] || match[3] || match[4];
        if (
            specifier &&
            (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/'))
        ) {
            importedPaths.push(specifier);
        }
    }
    return importedPaths;
}

function extractExportedSymbols(content: string): string[] {
    const exportedSymbols: string[] = [];
    const exportDeclRegex =
        /export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
    let match: RegExpExecArray | null;
    while ((match = exportDeclRegex.exec(content)) !== null) {
        if (match[1]) exportedSymbols.push(match[1]);
    }
    return exportedSymbols;
}

function parseNamedImportParts(rawSymbols: string, resolved: string): ImportedSymbolRef[] {
    const refs: ImportedSymbolRef[] = [];
    const parts = rawSymbols.split(',');
    for (const p of parts) {
        const item = p.trim();
        if (!item) continue;
        const asMatch = item.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
        if (asMatch) {
            refs.push({ symbol: asMatch[1], alias: asMatch[2], sourceFile: resolved });
        } else {
            const symMatch = item.match(/^([A-Za-z0-9_$]+)$/);
            if (symMatch) {
                refs.push({ symbol: symMatch[1], sourceFile: resolved });
            }
        }
    }
    return refs;
}

/**
 * In-memory module dependency graph over normalized, extension-less file paths.
 * It keeps forward module imports/exports, reverse adjacency, and named-import sites;
 * callers populate it via `registerFromContent`/`registerModule`, then query transitive
 * impact and inventory or feed `getForwardEdges()` into cycle detection — all after
 * population completes, without further filesystem access.
 */
export class ModuleDependencyGraph {
    /** file -> { exportedSymbols, importedModules } */
    private readonly modules: Map<string, ModuleExportInfo> = new Map();
    /** targetFile -> Set of files that directly import targetFile (Reverse Adjacency List) */
    private readonly reverseDeps: Map<string, Set<string>> = new Map();
    /** importerNormFile -> (resolvedTargetNormFile -> ImportedSymbolRef[]) */
    private readonly importedSymbolsMap: Map<string, Map<string, ImportedSymbolRef[]>> = new Map();

    private norm(p: string): string {
        return normalizePath(p).replace(/\.(ts|tsx|js|jsx|d\.ts)$/, '');
    }

    /**
     * Register or update a module's imports and exports.
     */
    registerModule(
        filePath: string,
        importedPaths: string[],
        exportedSymbols: string[] = [],
    ): void {
        const normFile = this.norm(filePath);
        const existing = this.modules.get(normFile);

        // Clean up old reverse deps if updating
        if (existing) {
            for (const imp of existing.importedModules) {
                this.reverseDeps.get(imp)?.delete(normFile);
            }
        }

        const resolvedImports = new Set<string>();
        for (const imp of importedPaths) {
            const resolved = this.resolveImportPath(normFile, imp);
            resolvedImports.add(resolved);
            this.getOrCreateReverseSet(resolved).add(normFile);
        }

        this.modules.set(normFile, {
            exportedSymbols: new Set(exportedSymbols),
            importedModules: resolvedImports,
        });
    }

    private getOrCreateReverseSet(resolved: string): Set<string> {
        let revSet = this.reverseDeps.get(resolved);
        if (!revSet) {
            revSet = new Set<string>();
            this.reverseDeps.set(resolved, revSet);
        }
        return revSet;
    }

    private extractAndRecordNamedImports(filePath: string, content: string): void {
        const namedImportRegex = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
        const normFile = this.norm(filePath);
        let targetMap = this.importedSymbolsMap.get(normFile);
        if (!targetMap) {
            targetMap = new Map();
            this.importedSymbolsMap.set(normFile, targetMap);
        }
        let match: RegExpExecArray | null;
        while ((match = namedImportRegex.exec(content)) !== null) {
            const rawSymbols = match[1];
            const specifier = match[2];
            if (
                specifier &&
                (specifier.startsWith('.') ||
                    specifier.startsWith('/') ||
                    specifier.startsWith('@/'))
            ) {
                const resolved = this.resolveImportPath(normFile, specifier);
                let refs = targetMap.get(resolved);
                if (!refs) {
                    refs = [];
                    targetMap.set(resolved, refs);
                }
                const parsed = parseNamedImportParts(rawSymbols, resolved);
                for (let i = 0; i < parsed.length; i++) {
                    refs.push(parsed[i]);
                }
            }
        }
    }

    /**
     * Fast regex-based module parser for extracting import specifiers without full AST overhead.
     */
    registerFromContent(filePath: string, content: string): void {
        // Python has its own statement grammar (`import a.b` / `from .pkg import name`) and its
        // own resolution rules (packages, `__init__.py`, relative dots); route it to the Python
        // branch instead of the TS/JS specifier regex.
        if (filePath.endsWith('.py')) {
            this.registerPythonModule(filePath, content);
            return;
        }

        const importedPaths = extractImportedPaths(content);
        const exportedSymbols = extractExportedSymbols(content);
        this.extractAndRecordNamedImports(filePath, content);
        this.registerModule(filePath, importedPaths, exportedSymbols);
    }

    /**
     * Whole-graph topological and SCC analysis via nativeCore (Rust Tarjan SCC operator).
     * Returns detected cycle components, Kahn's topological order, and acyclic status.
     */
    public analyzeTopologicalStructure(): NativeGraphAnalysis {
        const edgeTuples: [string, string][] = [];
        for (const [file, info] of this.modules) {
            for (const imp of info.importedModules) {
                edgeTuples.push([file, imp]);
            }
        }
        return nativeCore.analyzeDependencyGraph(edgeTuples);
    }

    /**
     * Forward edges (normalized file -> resolved imports) for whole-graph consumers.
     * Powers the pipeline-level import-cycle detection (api.ts post-scan pass) — the
     * per-file analyzer contract cannot see the full graph without breaking the
     * incremental cache contract.
     */
    getForwardEdges(): Map<string, Set<string>> {
        const out = new Map<string, Set<string>>();
        for (const [file, info] of this.modules) {
            out.set(file, cloneStringSet(info.importedModules));
        }
        return out;
    }

    /**
     * Module-level export/import inventory (normalized keys) for whole-graph consumers —
     * powers the unused-export post-scan pass (exported symbol names + who imports whom).
     */
    getModules(): Array<{ file: string; exportedSymbols: string[]; importedModules: string[] }> {
        const out: Array<{ file: string; exportedSymbols: string[]; importedModules: string[] }> =
            [];
        for (const [file, info] of this.modules) {
            out.push({
                file,
                exportedSymbols: [...info.exportedSymbols],
                importedModules: [...info.importedModules],
            });
        }
        return out;
    }

    /**
     * Compute the full set of downstream files affected by changes to `changedFile`
     * (transitive reverse closure).
     * Uses O(N) pointer-based queue to eliminate O(N^2) Array.prototype.shift reallocations.
     */
    getAffectedFiles(changedFile: string, maxDepth: number = DEFAULT_MAX_AFFECTED_DEPTH): string[] {
        const normFile = this.norm(changedFile);
        const affected = new Set<string>();
        const queue: Array<{ file: string; depth: number }> = [{ file: normFile, depth: 0 }];
        const visited = new Set<string>([normFile]);
        let head = 0;

        while (head < queue.length) {
            const current = queue[head++];
            if (current.depth >= maxDepth) continue;

            const directDependents = this.reverseDeps.get(current.file);
            if (directDependents) {
                for (const dep of directDependents) {
                    if (!visited.has(dep)) {
                        visited.add(dep);
                        affected.add(dep);
                        queue.push({ file: dep, depth: current.depth + 1 });
                    }
                }
            }
        }

        return Array.from(affected);
    }

    /**
     * Symbol-level impact analysis: computes exactly which downstream files and call sites
     * are impacted by changes to specified exported symbols, generating an actionable
     * refactoring plan.
     */
    getSymbolImpact(targetFile: string, changedSymbols: string[]): SymbolImpactAnalysis {
        const normTarget = this.norm(targetFile);
        const symbolSet = new Set(changedSymbols);
        const affectedFilesSet = new Set<string>();
        const impactedImportSites: SymbolImpactAnalysis['impactedImportSites'] = [];

        const directDependents = this.reverseDeps.get(normTarget) || new Set<string>();
        for (const importer of directDependents) {
            const targetMap = this.importedSymbolsMap.get(importer);
            const refs = targetMap?.get(normTarget) || [];
            for (const ref of refs) {
                if (symbolSet.has(ref.symbol)) {
                    affectedFilesSet.add(importer);
                    impactedImportSites.push({
                        importerFile: importer,
                        importedSymbol: ref.symbol,
                        alias: ref.alias,
                        line: ref.line,
                    });
                }
            }
        }

        const suggestedRefactorPlan: string[] = [];
        if (changedSymbols.length > 0) {
            suggestedRefactorPlan.push(
                `[Step 1] Update definition and contract of [${changedSymbols.join(', ')}] in ${targetFile}`,
            );
            for (const site of impactedImportSites) {
                suggestedRefactorPlan.push(
                    `[Step 2] In ${site.importerFile}: adjust usage of '${site.importedSymbol}'${site.alias ? ` (aliased as '${site.alias}')` : ''} to align with updated signature.`,
                );
            }
            suggestedRefactorPlan.push(
                `[Step 3] Run targeted test verification across ${affectedFilesSet.size} affected downstream consumer(s).`,
            );
        }

        return {
            targetFile: normTarget,
            changedSymbols,
            affectedFiles: Array.from(affectedFilesSet),
            impactedImportSites,
            suggestedRefactorPlan,
        };
    }

    /**
     * Resolve a relative import specifier against the importing file's directory.
     */
    private resolveImportPath(importingFile: string, specifier: string): string {
        const dir = path.dirname(importingFile);
        return this.norm(path.join(dir, specifier));
    }

    /**
     * Python branch of `registerFromContent`: module-level import statements become graph edges,
     * so circular-import detection covers Python packages.
     *
     * Exported symbols stay empty on purpose — Python has no export keyword, and treating every
     * public `def`/`class` as an export makes route handlers, CLI commands and plugin hooks look
     * like unused exports. The TS/JS unused-export pass therefore keeps its current scope.
     *
     * @param filePath - Scanned file path (root-relative or absolute, POSIX or Windows form).
     * @param content - Raw Python source text.
     */
    private registerPythonModule(filePath: string, content: string): void {
        const normFile = this.norm(filePath);
        const dir = path.dirname(normFile);
        const specifiers: string[] = [];
        for (const statement of collectPythonImports(content)) {
            for (const target of this.resolvePythonImport(normFile, statement)) {
                const relativeSpecifier = path.relative(dir, target).replace(/\\/g, '/');
                if (relativeSpecifier) specifiers.push(relativeSpecifier);
            }
        }
        this.registerModule(filePath, specifiers, []);
    }

    /**
     * Resolve one Python import statement to candidate module files.
     *
     * Absolute specifiers are anchored on the first segment that also appears in the importing
     * file's own directory path (so `app.services.bar` from `app/routes/x.py` resolves to
     * `app/services/bar.py`, while a third-party `flask` yields nothing). Relative specifiers
     * walk up one package per extra dot, matching Python's `from ..pkg import name` semantics.
     * Both the module file and its package initializer are returned, and for `from pkg import a`
     * the submodule interpretation `pkg.a` is included as well — unresolved candidates simply
     * never match a registered module, so extra edges are harmless.
     *
     * @param importingFile - Normalized path of the importing module.
     * @param statement - Specifier plus names from `collectPythonImports`.
     * @param statement.module - Dotted module specifier (`app.services.bar`, `.local`, `..utils`).
     * @param statement.names - Names pulled by a `from ... import` statement (empty for `import`).
     * @returns Candidate module paths (with `.py` / `__init__.py` suffixes), root-relative.
     */
    private resolvePythonImport(
        importingFile: string,
        statement: { module: string; names: string[] },
    ): string[] {
        const dirSegments = path
            .dirname(importingFile)
            .split('/')
            .filter((segment) => segment && segment !== '.');
        const dots = /^\.+/.exec(statement.module)?.[0].length ?? 0;
        let baseSegments: string[];
        let tailSegments: string[];
        if (dots > 0) {
            const trimmed = statement.module.slice(dots);
            baseSegments = dirSegments.slice(0, Math.max(0, dirSegments.length - (dots - 1)));
            tailSegments = trimmed ? trimmed.split('.') : [];
        } else {
            const parts = statement.module.split('.');
            if (PYTHON_STDLIB_MODULES.has(parts[0])) return [];
            const anchor = dirSegments.indexOf(parts[0]);
            if (anchor < 0) return [];
            baseSegments = dirSegments.slice(0, anchor).concat(parts);
            tailSegments = [];
        }
        const targets: string[] = [];
        const push = (segments: string[]): void => {
            if (segments.length === 0) return;
            const stem = segments.join('/');
            targets.push(`${stem}.py`, `${stem}/__init__.py`);
        };
        push(baseSegments.concat(tailSegments));
        for (const name of statement.names) push(baseSegments.concat(tailSegments, [name]));
        return targets.filter((target) => target !== importingFile);
    }

    /** Total number of indexed modules */
    size(): number {
        return this.modules.size;
    }

    /** Clear all graph state */
    clear(): void {
        this.modules.clear();
        this.reverseDeps.clear();
    }
}

/**
 * Convert a minimal glob into an anchored RegExp for entry whitelists: `**` spans path
 * separators, `*` stays within one segment and `?` matches any single character. Every other
 * regex metacharacter is escaped, so the pattern matches literal text.
 *
 * @param glob - Glob pattern using POSIX separators; no filesystem resolution is performed.
 * @returns An anchored RegExp that must be tested against an explicit file path (and any
 *   candidate extension); a pattern with no wildcard matches only itself.
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
 * Detect import cycles with an iterative three-color DFS (WHITE/GRAY/BLACK).
 *
 * Nodes and adjacency entries are sorted, so the output is deterministic and matches the
 * recursive formulation while the explicit frame stack keeps traversal depth independent of
 * the V8 call-stack limit. Each reported cycle lists consecutive nodes and repeats the first
 * node at the end to close the loop.
 *
 * @param edges - Forward adjacency map from a normalized file to its normalized imports;
 *   only map keys are used as DFS roots, while target-only nodes are still examined as
 *   neighbors.
 * @returns Every cycle found, each as a node path whose last element repeats the first; an
 *   empty array when the graph is acyclic.
 */
export function findImportCycles(edges: Map<string, Set<string>>): string[][] {
    const WHITE = 0,
        GRAY = 1,
        BLACK = 2;
    const color = new Map<string, number>();
    const cycles: string[][] = [];
    const sortedAdjacency = new Map<string, string[]>();
    const sortedNexts = (n: string): string[] => {
        let cached = sortedAdjacency.get(n);
        if (!cached) {
            cached = [...(edges.get(n) ?? [])].sort();
            sortedAdjacency.set(n, cached);
        }
        return cached;
    };

    for (const start of [...edges.keys()].sort()) {
        // Unvisited nodes are absent from `color`, so the default MUST be WHITE;
        // defaulting to BLACK would skip the entire traversal for that node.
        if ((color.get(start) ?? WHITE) !== WHITE) continue;
        color.set(start, GRAY);
        const path: string[] = [start];
        const stack: Array<{ node: string; nexts: string[]; idx: number }> = [
            { node: start, nexts: sortedNexts(start), idx: 0 },
        ];
        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            if (top.idx >= top.nexts.length) {
                color.set(top.node, BLACK);
                stack.pop();
                path.pop();
                continue;
            }
            const next = top.nexts[top.idx++];
            const c = color.get(next) ?? WHITE;
            if (c === GRAY) {
                const at = path.indexOf(next);
                cycles.push([...path.slice(at), next]);
            } else if (c === WHITE) {
                color.set(next, GRAY);
                path.push(next);
                stack.push({ node: next, nexts: sortedNexts(next), idx: 0 });
            }
        }
    }
    return cycles;
}

/**
 * Analyzer configuration options for import cycle and unused export detection.
 */
interface CyclePassOptions {
    detectCycles?: boolean;
    cycleSeverity?: Severity;
    maxCyclesReported?: number;
    detectUnusedExports?: boolean;
    entryGlobs?: string[];
    unusedSeverity?: Severity;
}

async function readSingleFileSafe(rootDir: string, f: string): Promise<readonly [string, string] | null> {
    try {
        return [f, await fs.promises.readFile(path.join(rootDir, f), 'utf8')] as const;
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
    for (const r of results) {
        if (!r) {
            failures++;
            continue;
        }
        contents.set(r[0], r[1]);
        graph.registerFromContent(r[0], r[1]);
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
        const results = await Promise.all(chunk.map((f) => readSingleFileSafe(rootDir, f)));
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
        warnings.push(`dependency-graph: ${readFailures} file(s) unreadable, excluded from cycle analysis`);
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
        for (const n of nexts) {
            getOrCreateImporterSet(importers, n).add(from);
        }
    }
    return importers;
}

function getImporterTokens(
    f: string,
    contents: Map<string, string>,
    tokenCache: Map<string, Set<string>>,
): Set<string> | undefined {
    let tokens = tokenCache.get(f);
    if (!tokens) {
        const c = contents.get(f);
        if (c === undefined) return undefined;
        tokens = new Set(c.match(/\b[A-Za-z0-9_$]+\b/g) ?? []);
        tokenCache.set(f, tokens);
    }
    return tokens;
}

function auditModuleSymbols(
    mod: { file: string; exportedSymbols: string[] },
    importerFiles: string[],
    contents: Map<string, string>,
    importerTokenSets: Map<string, Set<string>>,
    severity: Severity,
    issues: Issue[],
): number {
    let flagged = 0;
    for (const sym of mod.exportedSymbols) {
        if (flagged >= MAX_UNUSED_EXPORTS_PER_MODULE) break;
        const used = importerFiles.some((f) => {
            const tokens = getImporterTokens(f, contents, importerTokenSets);
            return tokens === undefined ? true : tokens.has(sym);
        });
        if (!used) {
            issues.push({
                id: `dependency-graph:unused-export:${mod.file}:${sym}`,
                analyzer: DEPENDENCY_GRAPH_ANALYZER_ID,
                rule: 'unused-export',
                severity,
                message: `Exported symbol "${sym}" is not imported by any module (${mod.file}).`,
                location: { file: mod.file, start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
                detail: { symbol: sym, importers: importerFiles.slice(0, IMPORTER_DETAIL_LIMIT) },
                suggestion: 'Remove this export or add it to entryGlobs if it is an external entry point.',
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
    const isEntry = (f: string): boolean => entryRes.some((re) => ENTRY_EXTS.some((ext) => re.test(f + ext)));
    let unusedFlagged = 0;
    const unusedSeverity: Severity = opts.unusedSeverity ?? 'warning';

    for (const mod of graph.getModules()) {
        if (mod.exportedSymbols.length === 0) continue;
        if (isEntry(mod.file) || mod.file.endsWith('.d.ts')) continue;
        const importerFiles = [...(importers.get(mod.file) ?? [])];

        if (importerFiles.length === 0) {
            issues.push({
                id: `dependency-graph:unused-module:${mod.file}:1`,
                analyzer: DEPENDENCY_GRAPH_ANALYZER_ID,
                rule: 'unused-module',
                severity: unusedSeverity,
                message: `Module is not imported by any file and exports ${mod.exportedSymbols.length} symbol(s) (dead module candidate).`,
                location: { file: mod.file, start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
                detail: { exportedSymbols: mod.exportedSymbols.slice(0, EXPORTED_SYMBOL_DETAIL_LIMIT) },
                suggestion: 'Verify whether this is legacy dead code: remove, archive, or add to entryGlobs with justification.',
            });
            unusedFlagged++;
            continue;
        }

        unusedFlagged += auditModuleSymbols(mod, importerFiles, contents, importerTokenSets, unusedSeverity, issues);
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
    // Fast-path: check whole-graph acyclic state via Rust Tarjan SCC operator
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
            suggestion: 'Extract shared logic to a lower-layer module or invert dependency via interfaces.',
        });
    }
    if (cycles.length > cap) {
        warnings.push(`dependency-graph: ${cycles.length - cap} additional cycle(s) beyond report cap (${cap})`);
    }
}

/**
 * Post-scan pass that reports import cycles and, when enabled, unused modules/exports.
 */
export async function runCyclePass(
    report: ScanReport,
    config: ScanConfig,
    logger?: { info: (msg: string) => void },
    prebuilt?: ModuleDependencyGraph | null,
): Promise<{ issues: Issue[]; warnings: string[] }> {
    const issues: Issue[] = [];
    const warnings: string[] = [];
    const opts = (config.analyzers[DEPENDENCY_GRAPH_ANALYZER_ID]?.options || {}) as CyclePassOptions;
    if (opts.detectCycles === false) return { issues, warnings };

    const files = report.fileMetrics.map((m) => m.file);
    const usePrebuilt = prebuilt != null && opts.detectUnusedExports !== true;
    const graph = usePrebuilt ? prebuilt : new ModuleDependencyGraph();
    const contents = new Map<string, string>();

    if (!usePrebuilt) {
        await populateGraphFromFiles(files, config.root, graph, contents, warnings);
    }
    if (opts.detectUnusedExports === true) {
        auditUnusedExports(graph, contents, opts, issues, logger);
    }
    auditImportCycles(graph, opts, issues, warnings);

    return { issues, warnings };
}
