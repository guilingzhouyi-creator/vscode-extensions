import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ScanConfig, ParserKind } from './types';
import { TOOL_VERSION } from './config';
import { policyFromAnalyzers, fastPathEnabled, FAST_PATH_ANALYZERS } from './traverse';

/**
 * Warm-scan cache key construction (docs/warm-scan-design.md §B2).
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
};

/** Adapter implementation versions (informational; bump when adapter logic changes). */
export const ADAPTER_VERSIONS: Record<string, number> = {
  typescriptAdapter: 1,
  oxcAdapter: 1,
  rustAdapter: 1,
  multilang: 1,
};

/** Built-in adapter module-path map (mirrors analyzer.ts BUILTIN_MODULE_PATHS). */
const BUILTIN_MODULE_PATHS: Record<string, string> = {
  constants: '../analyzers/constants',
  'large-file': '../analyzers/largeFile',
  complexity: '../analyzers/complexity',
};

/**
 * Stable JSON serialization: object keys sorted lexicographically, no whitespace.
 * This is the shared canonicalization used by cache keys AND tests (docs/warm-scan-design.md
 * Appendix A). `undefined` values are dropped; non-finite numbers serialize as null
 * (matching JSON.stringify semantics, which is what the report itself produces).
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
  const parts = keys.map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]));
  return '{' + parts.join(',') + '}';
}

/** sha256 hex digest of a string or Buffer. */
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
 * Deterministic analyzer descriptors WITHOUT loading any module (built-in-only derivation).
 * Order mirrors resolveAnalyzers (built-ins in `config.analyzers` insertion order, then
 * custom analyzers appended), which for dependency-free built-ins equals the topological
 * order. Used when no resolved plan is available (standalone key tests, daemon warm path
 * where the plan is resolved by the Scanner itself). The scan pipeline passes the real
 * resolved descriptors so modulePath/options match the executed analyzers exactly.
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
    const modPath = path.isAbsolute(c.module) ? c.module : path.resolve(config.baseDir || process.cwd(), c.module);
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
 * Lightweight adapter-id resolution WITHOUT loading any adapter module (keeps the daemon
 * main thread typescript-free on pure-cache-hit paths). Mirrors adapters.adapterFor for
 * the built-in registry: parser 'oxc' wins for TS/JS-family extensions; .rs → rust;
 * unknown extensions fall back to typescript.
 */
export function adapterIdFor(rel: string, parser: ParserKind = 'typescript'): string {
  const ext = path.extname(rel).toLowerCase();
  const tsFamily = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  if (tsFamily.includes(ext)) return parser === 'oxc' ? 'oxc' : 'typescript';
  if (ext === '.rs') return 'rust';
  return 'typescript';
}

/** Custom-analyzer content hash (docs/warm-scan-design.md §B7): sha256 of ordered concat of
 *  module absolute path + module file content hash + plugin options. Returns null when any
 *  module file cannot be read (caller must then treat L2 as disabled for safety). */
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

/** Fingerprint payload — the exact field list from docs/warm-scan-design.md Appendix A. */
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
}

/**
 * Build the FingerprintPayload for one (adapterId, fileExt) combination.
 *
 * `descs` is optional: when provided (the scan pipeline passes its resolved plan) it is
 * used verbatim; otherwise built-in-only descriptors are derived from `config`. `customHash`
 * is only non-null when `--cache-custom` enabled the L2 path for custom analyzers.
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
    (adapterId === 'typescript' || adapterId === 'oxc');

  const analyzers = resolved.map((d) => ({
    name: d.name,
    version: d.version,
    modulePath: d.modulePath,
    optionsHash: sha256Hex(canonicalJson(d.options)),
  }));

  return {
    formatVersion: CACHE_FORMAT_VERSION,
    toolVersion: TOOL_VERSION,
    nodeMajor: parseInt(process.versions.node.split('.')[0], 10) || 0,
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
  };
}

/** fpHash = sha256(canonicalJson(FingerprintPayload)). */
export function fpHash(payload: FingerprintPayload): string {
  return sha256Hex(canonicalJson(payload));
}

/** L2 storage key = "v1:" + fpHash + ":" + contentHash. */
export function l2Key(fpHashValue: string, contentHash: string): string {
  return `v1:${fpHashValue}:${contentHash}`;
}

/**
 * Config-level pool fingerprint (docs/warm-scan-design.md §A3.1): identifies the analyzer
 * configuration a worker pool was built for. Intentionally adapter/file agnostic — a pool
 * serves every file of a scan; per-file adapter differences are resolved inside the worker.
 */
export function buildPoolFingerprint(
  config: ScanConfig,
  descs?: FingerprintAnalyzerDesc[],
): string {
  const resolved = descs && descs.length > 0 ? descs : fingerprintAnalyzerDescs(config);
  const payload = {
    toolVersion: TOOL_VERSION,
    nodeMajor: parseInt(process.versions.node.split('.')[0], 10) || 0,
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
