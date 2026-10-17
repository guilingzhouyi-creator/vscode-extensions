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
import { TOOL_VERSION } from './config/config';
import { policyFromAnalyzers, fastPathEnabled, FAST_PATH_ANALYZERS } from './ast/traverse';

/** Canonical tool version identity string. */
export { TOOL_VERSION };

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

/** Module path constant for constants analyzer. */
const MODULE_PATH_CONSTANTS = '../analyzers/constants';

/** Module path constant for large-file analyzer. */
const MODULE_PATH_LARGE_FILE = '../analyzers/large-file';

/** Module path constant for complexity analyzer. */
const MODULE_PATH_COMPLEXITY = '../analyzers/complexity';

/** Module path constant for governance analyzer. */
const MODULE_PATH_GOVERNANCE = '../analyzers/governance';

/** Built-in adapter module-path map (mirrors analyzer.ts BUILTIN_MODULE_PATHS). */
const BUILTIN_MODULE_PATHS: Record<string, string> = {
    constants: MODULE_PATH_CONSTANTS,
    'large-file': MODULE_PATH_LARGE_FILE,
    complexity: MODULE_PATH_COMPLEXITY,
    governance: MODULE_PATH_GOVERNANCE,
};

/** Null byte delimiter for multi-part hashing. */
const NULL_BYTE_DELIMITER = '\u0000';

/** Default fallback severity for unsupported file languages. */
const DEFAULT_UNSUPPORTED_SEVERITY = 'error';

/**
 * Serialize a value to canonical JSON with object keys sorted lexicographically, arrays kept
 * in order, and no insignificant whitespace. This shared canonicalization backs both cache
 * keys and tests (docs/01-architecture/02-pipeline-and-caching.md Appendix A); non-finite
 * numbers become `null` so hashes stay stable and JSON-compatible.
 *
 * @param serializeTarget - Value to serialize; callers should pass JSON-compatible data.
 * @returns Stable JSON text suitable for hashing, independent of object key insertion order.
 */
export function getCanonicalJson(serializeTarget: unknown): string {
    if (serializeTarget === null || typeof serializeTarget !== 'object') {
        if (typeof serializeTarget === 'number' && !Number.isFinite(serializeTarget)) {
            return 'null';
        }
        return JSON.stringify(serializeTarget);
    }
    if (Array.isArray(serializeTarget)) {
        return '[' + serializeTarget.map(getCanonicalJson).join(',') + ']';
    }
    const sortedKeys = Object.keys(serializeTarget as Record<string, unknown>).sort();
    const entryPairs = sortedKeys.map(
        (keyName) =>
            JSON.stringify(keyName) +
            ':' +
            getCanonicalJson((serializeTarget as Record<string, unknown>)[keyName]),
    );
    return '{' + entryPairs.join(',') + '}';
}

/** Backward-compatible export alias for canonicalJson. */
export const canonicalJson = getCanonicalJson;

/**
 * Compute the lowercase hex SHA-256 digest of a string or Buffer. Passing a Buffer hashes its
 * raw bytes, which is what content hashes decoded from disk require.
 *
 * @param input - UTF-8 text to hash, or raw bytes when a Buffer is supplied.
 * @returns 64-character lowercase hexadecimal digest.
 */
export function computeSha256Hex(input: string | Buffer): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

/** Backward-compatible export alias for sha256Hex. */
export const sha256Hex = computeSha256Hex;

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
 * Merges configured thresholds with analyzer options.
 *
 * @param thresholds - Configured thresholds map.
 * @param options - Optional analyzer options map.
 * @returns Combined options record.
 */
function mergeAnalyzerOptions(
    thresholds: ScanConfig['thresholds'],
    options?: Record<string, unknown>,
): Record<string, unknown> {
    if (!options) {
        return thresholds ? { ...thresholds } : {};
    }
    return { ...thresholds, ...options };
}

/**
 * Collects fingerprints of built-in registered analyzers.
 *
 * @param analyzers - Configured analyzers record.
 * @param thresholds - Global threshold settings.
 * @param descs - Output array of analyzer descriptors.
 * @param seen - Set tracking already seen analyzer names for deduplication.
 */
function collectBuiltinDescs(
    analyzers:
        | Record<string, { enabled?: boolean; options?: Record<string, unknown> } | undefined>
        | undefined,
    thresholds: ScanConfig['thresholds'],
    descs: FingerprintAnalyzerDesc[],
    seen: Set<string>,
): void {
    if (!analyzers) {
        return;
    }
    for (const [name, decl] of Object.entries(analyzers)) {
        if (!decl || decl.enabled === false) continue;
        const version = ANALYZER_VERSIONS[name];
        if (version === undefined) continue;
        descs.push({
            name,
            version,
            modulePath: BUILTIN_MODULE_PATHS[name] || `../analyzers/${name}`,
            options: mergeAnalyzerOptions(thresholds, decl.options),
            legacy: false,
        });
        seen.add(name);
    }
}

interface CustomAnalyzerCollectorContext {
    readonly customAnalyzers:
        | Array<{
              name: string;
              module: string;
              enabled?: boolean;
              options?: Record<string, unknown>;
          }>
        | undefined;
    readonly thresholds: ScanConfig['thresholds'];
    readonly baseDir: string | undefined;
    readonly descs: FingerprintAnalyzerDesc[];
    readonly seen: Set<string>;
}

function collectCustomDescs(context: CustomAnalyzerCollectorContext): void {
    const { customAnalyzers, thresholds, baseDir, descs, seen } = context;
    if (!customAnalyzers || customAnalyzers.length === 0) {
        return;
    }
    for (const customEntry of customAnalyzers) {
        if (customEntry.enabled === false || seen.has(customEntry.name)) continue;
        const modPath = path.isAbsolute(customEntry.module)
            ? customEntry.module
            : path.resolve(baseDir || process.cwd(), customEntry.module);
        descs.push({
            name: customEntry.name,
            version: 1,
            modulePath: modPath,
            options: mergeAnalyzerOptions(thresholds, customEntry.options),
            legacy: true,
        });
        seen.add(customEntry.name);
    }
}

function readCustomModuleBuffer(modulePath: string): Buffer | null {
    try {
        const read = fs.readFileSync;
        return read(modulePath);
    } catch {
        return null;
    }
}

/**
 * Collects normalized fingerprint descriptors for all enabled built-in and custom analyzers.
 *
 * @param config - Scan configuration supplying enabled analyzers and thresholds.
 * @returns Array of fingerprint descriptors used for cache validation.
 */
export function getFingerprintAnalyzerDescs(config: ScanConfig): FingerprintAnalyzerDesc[] {
    const descs: FingerprintAnalyzerDesc[] = [];
    const seen = new Set<string>();
    collectBuiltinDescs(config.analyzers, config.thresholds, descs, seen);
    collectCustomDescs({
        customAnalyzers: config.customAnalyzers,
        thresholds: config.thresholds,
        baseDir: config.baseDir,
        descs,
        seen,
    });
    return descs;
}

/** Backward-compatible export alias for fingerprintAnalyzerDescs. */
export const fingerprintAnalyzerDescs = getFingerprintAnalyzerDescs;

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
export function getAdapterIdFor(rel: string, parser: ParserKind = TYPESCRIPT_ADAPTER_ID): string {
    const ext = path.extname(rel).toLowerCase();
    const tsFamily = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    if (tsFamily.includes(ext)) {
        return parser === 'oxc' ? 'oxc' : TYPESCRIPT_ADAPTER_ID;
    }
    return ext === '.rs' ? 'rust' : TYPESCRIPT_ADAPTER_ID;
}

/** Backward-compatible export alias for adapterIdFor. */
export const adapterIdFor = getAdapterIdFor;

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
    for (const desc of descs) {
        if (!desc.legacy) continue; // only external plug-ins participate in the custom hash
        const content = readCustomModuleBuffer(desc.modulePath);
        if (!content) return null;
        parts.push(desc.modulePath);
        parts.push(computeSha256Hex(content));
        parts.push(getCanonicalJson(desc.options));
    }
    return parts.length === 0 ? null : computeSha256Hex(parts.join(NULL_BYTE_DELIMITER));
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
 * Optional options bag for buildFingerprintPayload to avoid parameter expansion.
 */
export interface FingerprintPayloadOptions {
    readonly descs?: FingerprintAnalyzerDesc[];
    readonly customHash?: string | null;
}

function parseFingerprintOptionalArgs(
    optionalArgs: [(FingerprintAnalyzerDesc[] | FingerprintPayloadOptions)?, (string | null)?],
): { descs?: FingerprintAnalyzerDesc[]; customHash: string | null } {
    const firstOptional = optionalArgs[0];
    if (firstOptional && !Array.isArray(firstOptional) && typeof firstOptional === 'object') {
        return {
            descs: firstOptional.descs,
            customHash: firstOptional.customHash ?? null,
        };
    }
    return {
        descs: firstOptional as FingerprintAnalyzerDesc[] | undefined,
        customHash: optionalArgs[1] ?? null,
    };
}

function isFastPathEligible(
    legacyCount: number,
    streamingNames: string[],
    adapterId: string,
): boolean {
    if (!fastPathEnabled() || legacyCount !== 0) return false;
    if (adapterId !== TYPESCRIPT_ADAPTER_ID && adapterId !== 'oxc') return false;
    return streamingNames.every((analyzerName) => FAST_PATH_ANALYZERS.has(analyzerName));
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
 * @param optionalArgs - Optional descriptors array, options object, and custom hash.
 * @returns Fingerprint payload whose canonical hash forms the stable per-file cache key.
 */
export function buildFingerprintPayload(
    config: ScanConfig,
    adapterId: string,
    fileExt: string,
    ...optionalArgs: [(FingerprintAnalyzerDesc[] | FingerprintPayloadOptions)?, (string | null)?]
): FingerprintPayload {
    const parsed = parseFingerprintOptionalArgs(optionalArgs);
    const resolved =
        parsed.descs && parsed.descs.length > 0
            ? parsed.descs
            : getFingerprintAnalyzerDescs(config);
    const legacyCount = resolved.filter((desc) => desc.legacy).length;
    const streamingNames = resolved.filter((desc) => !desc.legacy).map((desc) => desc.name);
    const policy = policyFromAnalyzers(streamingNames);
    const fastPath = isFastPathEligible(legacyCount, streamingNames, adapterId);

    const analyzers = resolved.map((desc) => ({
        name: desc.name,
        version: desc.version,
        modulePath: desc.modulePath,
        optionsHash: computeSha256Hex(getCanonicalJson(desc.options)),
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
            policyHash: computeSha256Hex(getCanonicalJson(policy)),
        },
        analyzers,
        thresholds: config.thresholds as Record<string, any>,
        customHash: parsed.customHash,
        fileExt,
        unsupportedLanguage: config.unsupportedLanguage ?? DEFAULT_UNSUPPORTED_SEVERITY,
    };
}

/**
 * Derive the fingerprint hash `sha256(canonicalJson(payload))` that names one analysis
 * configuration; any payload change simply makes all old L2 keys unreachable.
 *
 * @param payload - Complete fingerprint payload built by `buildFingerprintPayload`.
 * @returns 64-character lowercase hex fingerprint hash.
 */
export function computeFingerprintHash(payload: FingerprintPayload): string {
    return computeSha256Hex(getCanonicalJson(payload));
}

/** Backward-compatible export alias for fpHash. */
export const fpHash = computeFingerprintHash;

/**
 * Compose the versioned L2 storage key from a configuration fingerprint and a file content
 * hash, joined after the `v1` schema prefix; both parts must be stable hex digests for
 * cross-run reuse to work across processes.
 *
 * @param fpHashValue - Fingerprint hash of the analysis configuration.
 * @param contentHash - SHA-256 hash of the file's raw bytes.
 * @returns Versioned L2 cache key.
 */
export function computeL2Key(fpHashValue: string, contentHash: string): string {
    return `v1:${fpHashValue}:${contentHash}`;
}

/** Backward-compatible export alias for l2Key. */
export const l2Key = computeL2Key;

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
    const resolved = descs && descs.length > 0 ? descs : getFingerprintAnalyzerDescs(config);
    const payload = {
        toolVersion: TOOL_VERSION,
        nodeMajor: parseInt(process.versions.node.split('.')[0], DECIMAL_RADIX) || 0,
        parser: config.parser,
        analyzers: resolved.map((desc) => ({
            name: desc.name,
            version: desc.version,
            modulePath: desc.modulePath,
            optionsHash: computeSha256Hex(getCanonicalJson(desc.options)),
        })),
        thresholds: config.thresholds as Record<string, any>,
        customHash: computeCustomHash(resolved),
    };
    return computeSha256Hex(getCanonicalJson(payload));
}
