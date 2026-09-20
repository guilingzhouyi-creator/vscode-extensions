/**
 * Module: Core Engine — Cache Key & Fingerprint Construction
 * File Path: src/core/cache-key.ts
 * Architecture Role: Stateless key-derivation module that is the single contract for the
 *   cache-key schema shared by the scanner, CacheStore, and worker-pool identity.
 * Dependencies & Triggers: Imports `crypto`, `fs`, `path`, core types, `TOOL_VERSION`, and
 *   traverse policy helpers; called from the Scanner's cache setup and `CacheStore`
 *   whenever L2 keys, analyzer descriptors, or a worker-pool fingerprint must be derived.
 * Responsibilities: Define `CACHE_FORMAT_VERSION`, analyzer/adapter version maps, and
 *   built-in module paths; canonicalize JSON deterministically; hash sha256; derive analyzer
 *   descriptors without loading modules; resolve adapter ids; hash custom-analyzer modules;
 *   build the full `FingerprintPayload` and its `fpHash`; format `l2Key`; and build the
 *   config-level pool fingerprint.
 * Exit Semantics & Design Rationale: Key derivation is deterministic and side-effect-free
 *   apart from `computeCustomHash` reading custom module files; that helper returns null
 *   when a module is unreadable so callers can disable L2 rather than reuse stale results;
 *   non-finite numbers serialize as null; adapter ids fall back to `typescript`. The payload
 *   includes every analysis-affecting factor so any code or config change simply leaves old
 *   keys unreachable, avoiding explicit invalidation.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ScanConfig, ParserKind } from './types';
import { TOOL_VERSION } from './config';
import { policyFromAnalyzers, fastPathEnabled, FAST_PATH_ANALYZERS } from './traverse';

/**
 * Warm-scan cache key construction (docs/01-architecture/02-pipeline-and-caching.md §B2).
 *
 * The L2 cache key is `v1:<fpHash>:<contentHash>` where:
 *   - contentHash = sha256 of the file's RAW bytes (not the utf8 string)
 *   - fpHash      = sha256(canonicalJson(FingerprintPayload))
 *
 * fpHash contains EVERY factor that can change the analysis output: tool version,
 * Node major version, adapter, adapter versions, projection policy, the ordered set of
 * enabled analyzers (with version / module path / merged-options hash), global thresholds,
 * the customAnalyzer hash, and the file extension. A change to any of these changes the
 * fpHash → the old keys simply become unreachable (full invalidation without an explicit
 * invalidate command).
 */

/** Cache format/serialization version — bump when the JSONL layout or key schema changes. */
export const CACHE_FORMAT_VERSION = 1;

/** Analyzer implementation versions (informational; bump when analyzer logic changes). */
export const ANALYZER_VERSIONS: Record<string, number> = {
    constants: 1,
    'large-file': 1,
    complexity: 1,
    governance: 1,
};

/** Adapter implementation versions (informational; bump when adapter logic changes). */
export const ADAPTER_VERSIONS: Record<string, number> = {
    typescriptAdapter: 1,
    oxcAdapter: 1,
    rustAdapter: 1,
    pythonAdapter: 1,
    multilang: 1,
};

/** Decimal radix for parsing the Node.js major version out of `process.versions.node`. */
const DECIMAL_RADIX = 10;

/** Adapter id for TypeScript/JavaScript-family files; also the default ParserKind. */
const TYPESCRIPT_ADAPTER_ID = 'typescript';

/** Built-in adapter module-path map (mirrors analyzer.ts BUILTIN_MODULE_PATHS). */
const BUILTIN_MODULE_PATHS: Record<string, string> = {
    constants: '../analyzers/constants',
    'large-file': '../analyzers/large-file',
    complexity: '../analyzers/complexity',
    governance: '../analyzers/governance',
};

/**
 * Serialize a value to canonical JSON with object keys sorted lexicographically, arrays kept
 * in order, and no insignificant whitespace. This shared canonicalization backs both cache
 * keys and tests (docs/01-architecture/02-pipeline-and-caching.md Appendix A); non-finite
 * numbers become `null` so hashes stay stable and JSON-compatible.
 *
 * @param obj - Value to serialize; callers should pass JSON-compatible data.
 * @returns Stable JSON text suitable for hashing, independent of object key insertion order.
 */
export function canonicalJson(obj: unknown): string {
    return stableStringify(obj);
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
        (k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]),
    );
    return '{' + parts.join(',') + '}';
}

/**
 * Compute the lowercase hex SHA-256 digest of a string or Buffer. Passing a Buffer hashes its
 * raw bytes, which is what content hashes decoded from disk require.
 *
 * @param input - UTF-8 text to hash, or raw bytes when a Buffer is supplied.
 * @returns 64-character lowercase hexadecimal digest.
 */
export function sha256Hex(input: string | Buffer): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

/** Fingerprint description of one enabled analyzer (used to build the cache key). */
export interface FingerprintAnalyzerDesc {
    name: string;
    /** Analyzer implementation version (built-ins from ANALYZER_VERSIONS; custom = 1). */
    version: number;
    /** Module path used to (re)instantiate the analyzer. */
    modulePath: string;
    /** Merged options (global thresholds + per-analyzer options) — hashed into the key. */
    options: Record<string, any>;
    /** true when the analyzer has no `visit` hook (legacy `analyze` contract). */
    legacy: boolean;
}

/**
 * Derive deterministic analyzer descriptors WITHOUT loading any module. Order mirrors
 * resolveAnalyzers (built-ins in `config.analyzers` insertion order, then custom analyzers
 * appended), which for dependency-free built-ins equals the topological order. Used when no
 * resolved plan is available (standalone key tests, daemon warm path where the Scanner itself
 * resolves the plan); the scan pipeline passes the real resolved descriptors instead.
 *
 * @param config - Scan config whose enabled analyzer declarations and custom plugins are read.
 * @returns Descriptors for every enabled built-in/custom analyzer, in execution order;
 *          disabled declarations and unknown built-in names are omitted.
 */
export function fingerprintAnalyzerDescs(config: ScanConfig): FingerprintAnalyzerDesc[] {
    const descs: FingerprintAnalyzerDesc[] = [];
    const seen = new Set<string>();
    for (const [name, decl] of Object.entries(config.analyzers || {})) {
        if (!decl || decl.enabled === false) continue;
        const version = ANALYZER_VERSIONS[name];
        if (version === undefined) continue; // non-built-in name resolved via customAnalyzers below
        descs.push({
            name,
            version,
            modulePath: BUILTIN_MODULE_PATHS[name] || `../analyzers/${name}`,
            options: { ...config.thresholds, ...(decl.options || {}) },
            legacy: false,
        });
        seen.add(name);
    }
    for (const c of config.customAnalyzers || []) {
        if (c.enabled === false) continue;
        if (seen.has(c.name)) continue;
        const modPath = path.isAbsolute(c.module)
            ? c.module
            : path.resolve(config.baseDir || process.cwd(), c.module);
        descs.push({
            name: c.name,
            version: 1,
            modulePath: modPath,
            options: { ...config.thresholds, ...(c.options || {}) },
            legacy: true, // external plug-ins use the legacy analyze() contract by default
        });
        seen.add(c.name);
    }
    return descs;
}

/**
 * Resolve an adapter id without loading any adapter module, keeping the daemon main thread
 * typescript-free on pure-cache-hit paths. Mirrors adapters.adapterFor for the built-in
 * registry: parser 'oxc' wins for TS/JS-family extensions; `.rs` maps to rust; unknown
 * extensions fall back to typescript.
 *
 * @param rel - Repository-relative file path whose extension selects the adapter family.
 * @param parser - TS/JS-family parser preference; it is ignored for Rust and unknown types.
 * @returns Adapter id stored in cache fingerprints (`typescript`, `oxc`, or `rust`).
 */
export function adapterIdFor(rel: string, parser: ParserKind = TYPESCRIPT_ADAPTER_ID): string {
    const ext = path.extname(rel).toLowerCase();
    const tsFamily = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    if (tsFamily.includes(ext)) return parser === 'oxc' ? 'oxc' : TYPESCRIPT_ADAPTER_ID;
    if (ext === '.rs') return 'rust';
    return TYPESCRIPT_ADAPTER_ID;
}

/**
 * Hash the custom-analyzer modules that participate in L2 caching
 * (docs/01-architecture/02-pipeline-and-caching.md §B7): a sha256 over the ordered concat of
 * each custom plugin's absolute module path, raw module content hash, and canonical options.
 *
 * @param descs - Analyzer descriptors; only legacy (external plug-in) entries contribute.
 * @returns sha256 hex digest, or null when there are no custom analyzers or any module file is
 *          unreadable — callers must then treat L2 caching as disabled for safety.
 */
export function computeCustomHash(descs: FingerprintAnalyzerDesc[]): string | null {
    const parts: string[] = [];
    for (const d of descs) {
        if (!d.legacy) continue; // only external plug-ins participate in the custom hash
        let content: Buffer;
        try {
            content = fs.readFileSync(d.modulePath);
        } catch {
            return null;
        }
        parts.push(d.modulePath);
        parts.push(sha256Hex(content));
        parts.push(canonicalJson(d.options));
    }
    if (parts.length === 0) return null;
    return sha256Hex(parts.join('\u0000'));
}

/**
 * Fingerprint payload — the exact field list from
 * docs/01-architecture/02-pipeline-and-caching.md Appendix A.
 */
export interface FingerprintPayload {
    formatVersion: number;
    toolVersion: string;
    nodeMajor: number;
    adapterId: string;
    adapterVersions: Record<string, number>;
    projection: {
        fastPath: boolean;
        legacyCount: number;
        policyHash: string;
    };
    analyzers: {
        name: string;
        version: number;
        modulePath: string;
        optionsHash: string;
    }[];
    thresholds: Record<string, any>;
    customHash: string | null;
    fileExt: string;
    /**
     * Fail-closed guard severity for unparseable extensions. Part of the key so toggling it
     * invalidates cached results that embedded the previous LANG-UNSUPPORTED severity.
     */
    unsupportedLanguage: 'error' | 'warning' | 'off';
}

/**
 * Build the FingerprintPayload for one (adapterId, fileExt) combination.
 *
 * `descs` is optional: when provided (the scan pipeline passes its resolved plan) it is used
 * verbatim; otherwise descriptors are derived from `config`. `customHash` is only non-null
 * when `--cache-custom` enabled the L2 path for custom analyzers.
 *
 * @param config - Resolved scan config supplying thresholds and fallback descriptors.
 * @param adapterId - Adapter identity for this file family (typescript/oxc/rust).
 * @param fileExt - Lower-case file extension recorded in the payload.
 * @param descs - Optional resolved analyzer plan; derived from `config` when omitted or empty.
 * @param customHash - Optional custom-analyzer hash; null disables custom L2 entries.
 * @returns Fingerprint payload whose canonical hash forms the stable per-file cache key.
 */
export function buildFingerprintPayload(
    config: ScanConfig,
    adapterId: string,
    fileExt: string,
    descs?: FingerprintAnalyzerDesc[],
    customHash: string | null = null,
): FingerprintPayload {
    const resolved = descs && descs.length > 0 ? descs : fingerprintAnalyzerDescs(config);
    const legacyCount = resolved.filter((d) => d.legacy).length;
    const streamingNames = resolved.filter((d) => !d.legacy).map((d) => d.name);
    const policy = policyFromAnalyzers(streamingNames);
    const fastPath =
        fastPathEnabled() &&
        legacyCount === 0 &&
        streamingNames.every((n) => FAST_PATH_ANALYZERS.has(n)) &&
        (adapterId === TYPESCRIPT_ADAPTER_ID || adapterId === 'oxc');

    const analyzers = resolved.map((d) => ({
        name: d.name,
        version: d.version,
        modulePath: d.modulePath,
        optionsHash: sha256Hex(canonicalJson(d.options)),
    }));

    return {
        formatVersion: CACHE_FORMAT_VERSION,
        toolVersion: TOOL_VERSION,
        nodeMajor: parseInt(process.versions.node.split('.')[0], DECIMAL_RADIX) || 0,
        adapterId,
        adapterVersions: { ...ADAPTER_VERSIONS },
        projection: {
            fastPath,
            legacyCount,
            policyHash: sha256Hex(canonicalJson(policy)),
        },
        analyzers,
        thresholds: config.thresholds as Record<string, any>,
        customHash,
        fileExt,
        unsupportedLanguage: config.unsupportedLanguage ?? 'error',
    };
}

/**
 * Derive the fingerprint hash `sha256(canonicalJson(payload))` that names one analysis
 * configuration; any payload change simply makes all old L2 keys unreachable.
 *
 * @param payload - Complete fingerprint payload built by `buildFingerprintPayload`.
 * @returns 64-character lowercase hex fingerprint hash.
 */
export function fpHash(payload: FingerprintPayload): string {
    return sha256Hex(canonicalJson(payload));
}

/**
 * Compose the versioned L2 storage key from a configuration fingerprint and a file content
 * hash, joined after the `v1` schema prefix; both parts must be stable hex digests for
 * cross-run reuse to work across processes.
 *
 * @param fpHashValue - Fingerprint hash of the analysis configuration.
 * @param contentHash - SHA-256 hash of the file's raw bytes.
 * @returns Versioned L2 cache key.
 */
export function l2Key(fpHashValue: string, contentHash: string): string {
    return `v1:${fpHashValue}:${contentHash}`;
}

/**
 * Build the config-level pool fingerprint
 * (docs/01-architecture/02-pipeline-and-caching.md §A3.1): identifies the analyzer
 * configuration a worker pool was built for. Intentionally adapter/file agnostic — one pool
 * serves every file of a scan, and per-file adapter differences are resolved inside a worker.
 *
 * @param config - Resolved scan config whose parser, thresholds, and analyzers identify the pool.
 * @param descs - Optional resolved analyzer plan; derived from `config` when omitted or empty.
 * @returns Hex fingerprint shared by all workers built for this configuration.
 */
export function buildPoolFingerprint(
    config: ScanConfig,
    descs?: FingerprintAnalyzerDesc[],
): string {
    const resolved = descs && descs.length > 0 ? descs : fingerprintAnalyzerDescs(config);
    const payload = {
        toolVersion: TOOL_VERSION,
        nodeMajor: parseInt(process.versions.node.split('.')[0], DECIMAL_RADIX) || 0,
        parser: config.parser,
        analyzers: resolved.map((d) => ({
            name: d.name,
            version: d.version,
            modulePath: d.modulePath,
            optionsHash: sha256Hex(canonicalJson(d.options)),
        })),
        thresholds: config.thresholds as Record<string, any>,
        customHash: computeCustomHash(resolved),
    };
    return sha256Hex(canonicalJson(payload));
}
