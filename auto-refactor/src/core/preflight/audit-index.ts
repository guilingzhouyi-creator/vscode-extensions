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

/** High fan-in threshold triggering elevated dependency risk. */
const HIGH_FAN_IN_THRESHOLD = 5;

/** ELOC threshold above which files incur size-based risk penalty. */
const LARGE_ELOC_THRESHOLD = 500;

/** Security-sensitive keyword risk penalty increment. */
const SECURITY_RISK_PENALTY = 0.35;

/** Large file size risk penalty increment. */
const LARGE_ELOC_PENALTY = 0.15;

/** Comment ratio threshold qualifying file for terminology sensitivity. */
const COMMENT_RATIO_THRESHOLD = 0.15;

/** Precision scaling multiplier for rounding risk percentages. */
const PERCENT_SCALE = 100;

/** Baseline risk score fallback when role is unmapped. */
const BASE_RISK_DEFAULT = 0.2;

/** Audit categorization type constants. */
const AUDIT_TYPE_SOURCE: FileAuditType = 'source';
const AUDIT_TYPE_TEST: FileAuditType = 'test';
const AUDIT_TYPE_CONFIG: FileAuditType = 'config';
const AUDIT_TYPE_DOC: FileAuditType = 'doc';
const AUDIT_TYPE_SCRIPT: FileAuditType = 'script';
const AUDIT_TYPE_GENERATED: FileAuditType = 'generated';
const AUDIT_TYPE_ASSET: FileAuditType = 'asset';
const AUDIT_TYPE_GATE: FileAuditType = 'gate';

/** Language identifier constants. */
const LANGUAGE_TYPESCRIPT: LanguageKind = 'typescript';
const LANGUAGE_JAVASCRIPT: LanguageKind = 'javascript';
const LANGUAGE_UNKNOWN: LanguageKind = 'unknown';

/** Architectural role identifier constants. */
const ROLE_GATE_INFRASTRUCTURE = 'gate_infrastructure';
const ROLE_TEST_SUITE = 'test_suite';
const ROLE_AUTO_GENERATED = 'auto_generated';
const ROLE_CONFIG_CONSTANT = 'config_constant';

/** Path segment discrimination markers. */
const PATH_TEST_SEGMENT = '/test/';
const PATH_TESTS_SEGMENT = '/tests/';
const PATH_DIST_SEGMENT = '/dist/';
const PATH_OUT_SEGMENT = '/out/';
const PATH_DOCS_SEGMENT = '/docs/';
const PATH_SCRIPTS_SEGMENT = '/scripts/';
const EXTENSION_MARKDOWN = '.md';
const KEYWORD_SECRET = 'secret';

/** Pattern cache lookup key constants. */
const PATTERN_KEY_TS_JS = 'ts_js';
const PATTERN_KEY_PYTHON = 'py';
const PATTERN_KEY_RUST = 'rust';
const PATTERN_KEY_GDSCRIPT = 'gdscript';
const PATTERN_KEY_SHELL = 'shell';

/** ASCII character code for hash (#). */
const CHAR_CODE_HASH = 35;

/** ASCII character code for asterisk (*). */
const CHAR_CODE_STAR = 42;

/** Regex patterns for shallow import extraction. */
const IMPORT_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
    [PATTERN_KEY_TS_JS]:
        /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g,
    [PATTERN_KEY_PYTHON]: /(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g,
    [PATTERN_KEY_RUST]: /use\s+([\w:]+)/g,
    [PATTERN_KEY_GDSCRIPT]:
        /(?:preload\s*\(\s*['"]([^'"]+)['"]\s*\)|load\s*\(\s*['"]([^'"]+)['"]\s*\))/g,
    [PATTERN_KEY_SHELL]: /(?:source|\.)\s+([^\s;&]+)/g,
});

/** Regex patterns for shallow export extraction. */
const EXPORT_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
    [PATTERN_KEY_TS_JS]:
        /export\s+(?:default\s+)?(?:class|interface|type|enum|const|function|let|var)\s+([a-zA-Z0-9_$]+)/g,
    [PATTERN_KEY_PYTHON]: /def\s+([a-zA-Z0-9_]+)\s*\(|class\s+([a-zA-Z0-9_]+)\s*[:(]/g,
    [PATTERN_KEY_RUST]: /pub\s+(?:fn|struct|enum|trait|type|const)\s+([a-zA-Z0-9_]+)/g,
    [PATTERN_KEY_GDSCRIPT]: /(?:var|const|func)\s+([a-zA-Z0-9_]+)/g,
});

/** Security sensitive token patterns. */
const SECURITY_KEYWORD_PATTERN =
    /(?:password|secret|token|credential|private_key|api_key|cipher|crypt|oauth|auth_header)/i;

/** Compact extension to language mapping configuration. */
const EXTENSION_LANGUAGE_CONFIG =
    '.ts:typescript\n.tsx:typescript\n.mts:typescript\n.cts:typescript\n.js:javascript\n.jsx:javascript\n.mjs:javascript\n.cjs:javascript\n.rs:rust\n.gd:gdscript\n.py:python\n.go:go\n.sh:shell\n.bash:shell\n.ps1:shell\n.json:json\n.yml:yaml\n.yaml:yaml\n.md:markdown\n.html:javascript\n.htm:javascript\n.vue:typescript\n.svelte:typescript';

/** Parses compact template string into frozen Map. */
function parseExtensionLanguageMap(config: string): ReadonlyMap<string, LanguageKind> {
    const extensionLanguageMap = new Map<string, LanguageKind>();
    const lines = config.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const [extension, language] = trimmed.split(':');
        if (extension && language) {
            extensionLanguageMap.set(extension, language as LanguageKind);
        }
    }
    return extensionLanguageMap;
}

const EXTENSION_LANGUAGE_MAP: ReadonlyMap<string, LanguageKind> =
    parseExtensionLanguageMap(EXTENSION_LANGUAGE_CONFIG);

const CONFIG_EXTENSIONS_RAW = '.json|.yaml|.yml';
const SCRIPT_EXTENSIONS_RAW = '.sh|.bash|.ps1';
const ASSET_EXTENSIONS_RAW = '.png|.svg|.tscn|.tres';

const CONFIG_EXTENSIONS_SET: ReadonlySet<string> = new Set(CONFIG_EXTENSIONS_RAW.split('|'));
const SCRIPT_EXTENSIONS_SET: ReadonlySet<string> = new Set(SCRIPT_EXTENSIONS_RAW.split('|'));
const ASSET_EXTENSIONS_SET: ReadonlySet<string> = new Set(ASSET_EXTENSIONS_RAW.split('|'));

/** Base risk weights per fine-grained role in compact configuration format. */
const ROLE_BASE_RISK_CONFIG =
    'core_trunk:0.6\nalgorithm_computation:0.5\nrules_registry:0.45\nconfig_constant:0.3\ntest_suite:0.15\nauto_generated:0.05\nbusiness_module:0.2\nshared_library:0.2\ngate_infrastructure:0.9';

/** Parses role base risk configuration into frozen Map. */
function parseRoleBaseRiskMap(rawConfig: string): ReadonlyMap<string, number> {
    const roleRiskMap = new Map<string, number>();
    const lines = rawConfig.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const [roleName, riskValueStr] = trimmed.split(':');
        if (roleName && riskValueStr) {
            roleRiskMap.set(roleName, Number(riskValueStr));
        }
    }
    return roleRiskMap;
}

const ROLE_BASE_RISK_MAP: ReadonlyMap<string, number> = parseRoleBaseRiskMap(ROLE_BASE_RISK_CONFIG);

/**
 * Resolves language identifier from file path extension.
 *
 * @param filePath - Target file path string.
 * @returns Inferred LanguageKind identifier.
 */
export function getLanguageFromPath(filePath: string): LanguageKind {
    const extension = path.extname(filePath).toLowerCase();
    return EXTENSION_LANGUAGE_MAP.get(extension) || LANGUAGE_UNKNOWN;
}

/** Backward-compatible export alias. */
export const resolveLanguageFromPath = getLanguageFromPath;

/**
 * Resolves broad file audit type from path and role.
 *
 * @param filePath - Target file path string.
 * @param role - Inferred architectural role.
 * @returns Resolved FileAuditType category.
 */
export function getFileAuditType(filePath: string, role: FineGrainedFileRole): FileAuditType {
    switch (role) {
        case ROLE_GATE_INFRASTRUCTURE:
            return AUDIT_TYPE_GATE;
        case ROLE_TEST_SUITE:
            return AUDIT_TYPE_TEST;
        case ROLE_AUTO_GENERATED:
            return AUDIT_TYPE_GENERATED;
        case ROLE_CONFIG_CONSTANT:
            return AUDIT_TYPE_CONFIG;
        default:
            break;
    }

    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
    const extension = path.extname(normalizedPath);

    if (normalizedPath.includes(PATH_TEST_SEGMENT) || normalizedPath.includes(PATH_TESTS_SEGMENT)) {
        return AUDIT_TYPE_TEST;
    }
    if (normalizedPath.includes(PATH_DIST_SEGMENT) || normalizedPath.includes(PATH_OUT_SEGMENT)) {
        return AUDIT_TYPE_GENERATED;
    }
    if (extension === EXTENSION_MARKDOWN || normalizedPath.includes(PATH_DOCS_SEGMENT)) {
        return AUDIT_TYPE_DOC;
    }
    if (CONFIG_EXTENSIONS_SET.has(extension)) return AUDIT_TYPE_CONFIG;
    if (SCRIPT_EXTENSIONS_SET.has(extension) || normalizedPath.includes(PATH_SCRIPTS_SEGMENT)) {
        return AUDIT_TYPE_SCRIPT;
    }
    if (ASSET_EXTENSIONS_SET.has(extension)) return AUDIT_TYPE_ASSET;
    return AUDIT_TYPE_SOURCE;
}

/** Backward-compatible export alias. */
export const resolveFileAuditType = getFileAuditType;

/** Extracts direct import target paths via fast lexical regex */
function getDirectImports(content: string, lang: LanguageKind): string[] {
    const importTargets = new Set<string>();
    const patternKey =
        lang === LANGUAGE_TYPESCRIPT || lang === LANGUAGE_JAVASCRIPT ? PATTERN_KEY_TS_JS : lang;
    const regex = IMPORT_PATTERNS[patternKey];

    if (!regex) return [];

    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(content);
    while (match !== null) {
        const target = match[1] || match[2];
        if (target && target.trim().length > 0) {
            importTargets.add(target.trim());
        }
        match = regex.exec(content);
    }
    return Array.from(importTargets);
}

/** Extracts shallow exported symbols via fast lexical regex */
function getExportedSymbols(content: string, lang: LanguageKind): string[] {
    const exportedSymbols = new Set<string>();
    const patternKey =
        lang === LANGUAGE_TYPESCRIPT || lang === LANGUAGE_JAVASCRIPT ? PATTERN_KEY_TS_JS : lang;
    const regex = EXPORT_PATTERNS[patternKey];

    if (!regex) return [];

    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(content);
    while (match !== null) {
        const symbol = match[1] || match[2];
        if (symbol && symbol.trim().length > 0) {
            exportedSymbols.add(symbol.trim());
        }
        match = regex.exec(content);
    }
    return Array.from(exportedSymbols);
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

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        nonBlankLines++;
        const firstChar = trimmed.charCodeAt(0);
        if (
            firstChar === 35 ||
            firstChar === 42 ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*')
        ) {
            commentLines++;
        }
    }

    const estimatedEloc = Math.max(0, nonBlankLines - commentLines);
    return { physicalLines, nonBlankLines, estimatedEloc, commentLines };
}

/** Computes file inherent risk factor */
function evaluateFileRisk(
    role: FineGrainedFileRole,
    isSecSensitive: boolean,
    eloc: number,
): number {
    let score = ROLE_BASE_RISK_MAP.get(role) ?? BASE_RISK_DEFAULT;
    if (isSecSensitive) score += SECURITY_RISK_PENALTY;
    if (eloc > LARGE_ELOC_THRESHOLD) score += LARGE_ELOC_PENALTY;
    return Math.min(1.0, Math.round(score * PERCENT_SCALE) / PERCENT_SCALE);
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
    const lang = getLanguageFromPath(filePath);
    const type = getFileAuditType(filePath, roleInference.role);
    const eloc = computeShallowEloc(content);

    const imports = getDirectImports(content, lang);
    const exports = getExportedSymbols(content, lang);

    const isSecuritySensitive =
        SECURITY_KEYWORD_PATTERN.test(content) || filePath.toLowerCase().includes(KEYWORD_SECRET);
    const isHighFanIn = fanIn >= HIGH_FAN_IN_THRESHOLD;
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
        type === AUDIT_TYPE_DOC ||
        roleInference.role === ROLE_GATE_INFRASTRUCTURE ||
        (eloc.nonBlankLines > 0 &&
            eloc.commentLines / eloc.nonBlankLines >= COMMENT_RATIO_THRESHOLD);

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

    /**
     * Adds or updates an entry in the in-memory index store.
     *
     * @param entry - Target audit index entry to store.
     */
    public setEntry(entry: AuditIndexEntry): void {
        if (!entry || !entry.filePath) return;
        this.indexMap.set(entry.filePath, entry);
    }

    /**
     * Gets an index entry by file path with input validation.
     *
     * @param filePath - Target file path string.
     * @returns AuditIndexEntry if found, otherwise undefined.
     */
    public getEntry(filePath: string): AuditIndexEntry | undefined {
        return filePath ? this.indexMap.get(filePath) : undefined;
    }

    /**
     * Checks if file path is registered in the index with input validation.
     *
     * @param filePath - Target file path string.
     * @returns True if file path exists in index.
     */
    public hasEntry(filePath: string): boolean {
        return filePath ? this.indexMap.has(filePath) : false;
    }

    /**
     * Returns total indexed file count.
     */
    public get size(): number {
        return this.indexMap.size;
    }

    /**
     * Resets and clears all indexed entries from memory.
     * @override interface implementation - resets in-memory index state
     */
    public clear(): void {
        this.indexMap.clear();
    }

    /**
     * Returns all indexed entries.
     *
     * @returns Array of all registered audit index entries.
     */
    public getAllEntries(): AuditIndexEntry[] {
        return Array.from(this.indexMap.values());
    }

    /**
     * Batch index files with fan-in resolution.
     *
     * @param fileContents - Map of filePath to content string.
     * @returns Array of indexed entries.
     */
    public indexBatch(fileContents: Map<string, string>): AuditIndexEntry[] {
        // Count raw fan-in occurrences by destination target
        const fanInCountMap = new Map<string, number>();
        for (const [filePathKey, content] of fileContents.entries()) {
            const lang = getLanguageFromPath(filePathKey);
            const rawImports = getDirectImports(content, lang);
            for (const imp of rawImports) {
                const targetKey = imp.toLowerCase();
                const currentCount = fanInCountMap.get(targetKey) ?? 0;
                fanInCountMap.set(targetKey, currentCount + 1);
            }
        }

        // Construct frozen index entries with computed fan-in metrics
        const indexEntries: AuditIndexEntry[] = [];
        for (const [filePathKey, content] of fileContents.entries()) {
            const baseName = path.basename(filePathKey, path.extname(filePathKey)).toLowerCase();
            const fanIn =
                fanInCountMap.get(baseName) || fanInCountMap.get(filePathKey.toLowerCase()) || 0;
            const entry = buildFileAuditIndex(filePathKey, content, fanIn);
            this.setEntry(entry);
            indexEntries.push(entry);
        }

        return indexEntries;
    }

    /** Backward-compatible delegation property for set. */
    public set = (entry: AuditIndexEntry): void => {
        this.setEntry(entry);
    };

    /** Backward-compatible delegation property for get. */
    public get = (filePath: string): AuditIndexEntry | undefined => this.getEntry(filePath);

    /** Backward-compatible delegation property for has. */
    public has = (filePath: string): boolean => this.hasEntry(filePath);

    /** Backward-compatible delegation property for batchIndex. */
    public batchIndex = (fileContents: Map<string, string>): AuditIndexEntry[] =>
        this.indexBatch(fileContents);
}
