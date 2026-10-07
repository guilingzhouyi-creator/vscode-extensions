/**
 * Module: Core Preflight — Lightweight Audit Indexing System
 * File Path: src/core/preflight/audit-index.ts
 * Architecture Role: Builds sub-millisecond shallow index AuditIndex(f) without deep AST,
 *   full call graph unfolding, or heavy rule loading.
 * Dependencies & Triggers: Consumes file-role-inference; called by preflight controller,
 *   scope decider, and sparse activator.
 * Responsibilities:
 *   1. Extract file classification, architectural role, and language in sub-millisecond time.
 *   2. Compute shallow ELOC metrics (physical, non-blank, logic estimation).
 *   3. Parse direct import/export symbols via fast regex without AST overhead.
 *   4. Assess inherent risk and security sensitivity based on role, fan-in, and keywords.
 *   5. Assemble frozen immutable AuditIndexEntry for review scheduling.
 * Exit Semantics & Design Rationale: Never throws; deterministic; handles missing files gracefully;
 *   returns frozen structures to prevent shared mutable state.
 */

import * as path from 'path';
import {
    inferFineGrainedFileRole,
    type FineGrainedFileRole,
} from '../intelligence/file-role-inference';

/** File broad categorization */
export type FileAuditType =
    'source' | 'test' | 'config' | 'doc' | 'script' | 'generated' | 'asset' | 'gate';

/** Supported language kind */
export type LanguageKind =
    | 'typescript'
    | 'javascript'
    | 'rust'
    | 'gdscript'
    | 'python'
    | 'go'
    | 'shell'
    | 'json'
    | 'yaml'
    | 'markdown'
    | 'unknown';

/** Direct dependency and export slice */
export interface DependencySlice {
    readonly imports: readonly string[];
    readonly exports: readonly string[];
    readonly fanIn: number;
    readonly fanOut: number;
}

/** Risk profile calculated for the file */
export interface FileRiskProfile {
    readonly inherentRisk: number; // [0.0, 1.0]
    readonly isHighFanIn: boolean;
    readonly isSecuritySensitive: boolean;
    readonly isTerminologySensitive: boolean;
    readonly historicalDefectDensity: number;
}

/** Review history summary */
export interface FileAuditHistory {
    readonly lastReviewedAt?: number;
    readonly recentFindingCount: number;
    readonly recentRuleIds: readonly string[];
}

/** Complete lightweight preflight index entry for a single file */
export interface AuditIndexEntry {
    readonly filePath: string;
    readonly type: FileAuditType;
    readonly role: FineGrainedFileRole;
    readonly lang: LanguageKind;
    readonly eloc: {
        readonly physicalLines: number;
        readonly nonBlankLines: number;
        readonly estimatedEloc: number;
    };
    readonly deps: DependencySlice;
    readonly risk: FileRiskProfile;
    readonly history: FileAuditHistory;
    readonly indexedAt: number;
}

/** Regex patterns for shallow import extraction */
const IMPORT_PATTERNS: Record<string, RegExp> = {
    ts_js: /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g,
    py: /(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g,
    rust: /use\s+([\w:]+)/g,
    gdscript: /(?:preload\s*\(\s*['"]([^'"]+)['"]\s*\)|load\s*\(\s*['"]([^'"]+)['"]\s*\))/g,
    shell: /(?:source|\.)\s+([^\s;&]+)/g,
};

/** Regex patterns for shallow export extraction */
const EXPORT_PATTERNS: Record<string, RegExp> = {
    ts_js: /export\s+(?:default\s+)?(?:class|interface|type|enum|const|function|let|var)\s+([a-zA-Z0-9_$]+)/g,
    py: /def\s+([a-zA-Z0-9_]+)\s*\(|class\s+([a-zA-Z0-9_]+)\s*[:(]/g,
    rust: /pub\s+(?:fn|struct|enum|trait|type|const)\s+([a-zA-Z0-9_]+)/g,
    gdscript: /(?:var|const|func)\s+([a-zA-Z0-9_]+)/g,
};

/** Security sensitive token patterns */
const SECURITY_KEYWORD_PATTERN =
    /(?:password|secret|token|credential|private_key|api_key|cipher|crypt|oauth|auth_header)/i;

/** Extension to language mapping table */
const EXTENSION_LANGUAGE_MAP: Record<string, LanguageKind> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.rs': 'rust',
    '.gd': 'gdscript',
    '.py': 'python',
    '.go': 'go',
    '.sh': 'shell',
    '.bash': 'shell',
    '.ps1': 'shell',
    '.json': 'json',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.md': 'markdown',
    '.html': 'javascript',
    '.htm': 'javascript',
    '.vue': 'typescript',
    '.svelte': 'typescript',
};

const CONFIG_EXTS = new Set(['.json', '.yaml', '.yml']);
const SCRIPT_EXTS = new Set(['.sh', '.bash', '.ps1']);
const ASSET_EXTS = new Set(['.png', '.svg', '.tscn', '.tres']);

/**
 * Resolves language from file extension.
 *
 * @param filePath - Target file path.
 * @returns Inferred LanguageKind identifier.
 */
export function resolveLanguageFromPath(filePath: string): LanguageKind {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_LANGUAGE_MAP[ext] || 'unknown';
}

/**
 * Resolves broad file audit type from path and role.
 *
 * @param filePath - Target file path.
 * @param role - Inferred architectural role.
 * @returns Resolved FileAuditType category.
 */
export function resolveFileAuditType(filePath: string, role: FineGrainedFileRole): FileAuditType {
    if (role === 'gate_infrastructure') return 'gate';
    if (role === 'test_suite') return 'test';
    if (role === 'auto_generated') return 'generated';
    if (role === 'config_constant') return 'config';

    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    const ext = path.extname(norm);

    if (norm.includes('/test/') || norm.includes('/tests/')) return 'test';
    if (norm.includes('/dist/') || norm.includes('/out/')) return 'generated';
    if (ext === '.md' || norm.includes('/docs/')) return 'doc';
    if (CONFIG_EXTS.has(ext)) return 'config';
    if (SCRIPT_EXTS.has(ext) || norm.includes('/scripts/')) return 'script';
    if (ASSET_EXTS.has(ext)) return 'asset';
    return 'source';
}

/** Extracts direct import target paths via fast lexical regex */
function extractDirectImports(content: string, lang: LanguageKind): string[] {
    const results = new Set<string>();
    const patternKey = lang === 'typescript' || lang === 'javascript' ? 'ts_js' : lang;
    const regex = IMPORT_PATTERNS[patternKey];

    if (!regex) return [];

    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(content);
    while (match !== null) {
        const target = match[1] || match[2];
        if (target && target.trim().length > 0) {
            results.add(target.trim());
        }
        match = regex.exec(content);
    }
    return Array.from(results);
}

/** Extracts shallow exported symbols via fast lexical regex */
function extractExportedSymbols(content: string, lang: LanguageKind): string[] {
    const results = new Set<string>();
    const patternKey = lang === 'typescript' || lang === 'javascript' ? 'ts_js' : lang;
    const regex = EXPORT_PATTERNS[patternKey];

    if (!regex) return [];

    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(content);
    while (match !== null) {
        const symbol = match[1] || match[2];
        if (symbol && symbol.trim().length > 0) {
            results.add(symbol.trim());
        }
        match = regex.exec(content);
    }
    return Array.from(results);
}

interface ShallowElocResult {
    physicalLines: number;
    nonBlankLines: number;
    estimatedEloc: number;
    commentLines: number;
}

/** Computes shallow ELOC metrics without heavy parsing */
function computeShallowEloc(content: string): ShallowElocResult {
    const lines = content.split(/\r?\n/);
    const physicalLines = lines.length;
    let nonBlankLines = 0;
    let commentLines = 0;

    for (const l of lines) {
        const trimmed = l.trim();
        if (trimmed.length === 0) continue;
        nonBlankLines++;
        if (
            trimmed.startsWith('//') ||
            trimmed.startsWith('#') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*')
        ) {
            commentLines++;
        }
    }

    const estimatedEloc = Math.max(0, nonBlankLines - commentLines);
    return { physicalLines, nonBlankLines, estimatedEloc, commentLines };
}

/** Base risk weights per fine-grained role */
const ROLE_BASE_RISK: Record<FineGrainedFileRole, number> = {
    core_trunk: 0.6,
    algorithm_computation: 0.5,
    rules_registry: 0.45,
    config_constant: 0.3,
    test_suite: 0.15,
    auto_generated: 0.05,
    business_module: 0.2,
    shared_library: 0.2,
    gate_infrastructure: 0.9,
};

/** Computes file inherent risk factor */
function evaluateFileRisk(
    role: FineGrainedFileRole,
    isSecSensitive: boolean,
    eloc: number,
): number {
    let score = ROLE_BASE_RISK[role] ?? 0.2;
    if (isSecSensitive) score += 0.35;
    if (eloc > 500) score += 0.15;
    return Math.min(1.0, Math.round(score * 100) / 100);
}

/**
 * Builds lightweight preflight audit index for a single file.
 * Sub-millisecond execution guarantee (zero full AST parsing).
 *
 * @param filePath - Target file path.
 * @param content - File content string.
 * @param fanIn - Optional known fan-in count from dependency cache.
 * @returns Frozen AuditIndexEntry.
 */
export function buildFileAuditIndex(filePath: string, content: string, fanIn = 0): AuditIndexEntry {
    const roleInference = inferFineGrainedFileRole(filePath, content);
    const lang = resolveLanguageFromPath(filePath);
    const type = resolveFileAuditType(filePath, roleInference.role);
    const eloc = computeShallowEloc(content);

    const imports = extractDirectImports(content, lang);
    const exports = extractExportedSymbols(content, lang);

    const isSecuritySensitive =
        SECURITY_KEYWORD_PATTERN.test(content) || filePath.toLowerCase().includes('secret');
    const isHighFanIn = fanIn >= 5;
    const inherentRisk = evaluateFileRisk(
        roleInference.role,
        isSecuritySensitive,
        eloc.estimatedEloc,
    );

    const deps: DependencySlice = Object.freeze({
        imports: Object.freeze(imports),
        exports: Object.freeze(exports),
        fanIn,
        fanOut: imports.length,
    });

    const isTerminologySensitive =
        type === 'doc' ||
        roleInference.role === 'gate_infrastructure' ||
        (eloc.nonBlankLines > 0 && eloc.commentLines / eloc.nonBlankLines >= 0.15);

    const risk: FileRiskProfile = Object.freeze({
        inherentRisk,
        isHighFanIn,
        isSecuritySensitive,
        isTerminologySensitive,
        historicalDefectDensity: 0.0,
    });

    const history: FileAuditHistory = Object.freeze({
        recentFindingCount: 0,
        recentRuleIds: Object.freeze([]),
    });

    return Object.freeze({
        filePath,
        type,
        role: roleInference.role,
        lang,
        eloc: Object.freeze(eloc),
        deps,
        risk,
        history,
        indexedAt: Date.now(),
    });
}

/**
 * Preflight Audit Index Cache and Repository Indexer.
 */
export class PreflightAuditIndexStore {
    private readonly indexMap = new Map<string, AuditIndexEntry>();

    /** Adds or updates an entry in memory */
    public set(entry: AuditIndexEntry): void {
        this.indexMap.set(entry.filePath, entry);
    }

    /** Gets an index entry by path */
    public get(filePath: string): AuditIndexEntry | undefined {
        return this.indexMap.get(filePath);
    }

    /** Checks if path is indexed */
    public has(filePath: string): boolean {
        return this.indexMap.has(filePath);
    }

    /** Returns total indexed file count */
    public get size(): number {
        return this.indexMap.size;
    }

    /** Clears all indexed entries */
    public clear(): void {
        this.indexMap.clear();
    }

    /** Returns all indexed entries */
    public getAllEntries(): AuditIndexEntry[] {
        return Array.from(this.indexMap.values());
    }

    /**
     * Batch index files with fan-in resolution.
     *
     * @param fileContents - Map of filePath to content string.
     * @returns Array of indexed entries.
     */
    public batchIndex(fileContents: Map<string, string>): AuditIndexEntry[] {
        // Count raw fan-in occurrences by destination target
        const fanInCounts = new Map<string, number>();
        for (const [fPath, content] of fileContents.entries()) {
            const lang = resolveLanguageFromPath(fPath);
            const rawImports = extractDirectImports(content, lang);
            for (const imp of rawImports) {
                const targetKey = imp.toLowerCase();
                fanInCounts.set(targetKey, (fanInCounts.get(targetKey) || 0) + 1);
            }
        }

        // Construct frozen index entries with computed fan-in metrics
        const results: AuditIndexEntry[] = [];
        for (const [fPath, content] of fileContents.entries()) {
            const baseName = path.basename(fPath, path.extname(fPath)).toLowerCase();
            const fanIn = fanInCounts.get(baseName) || fanInCounts.get(fPath.toLowerCase()) || 0;
            const entry = buildFileAuditIndex(fPath, content, fanIn);
            this.set(entry);
            results.push(entry);
        }

        return results;
    }
}
