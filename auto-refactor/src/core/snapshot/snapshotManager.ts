/**
 * Module: Core Engine — Immutable Audit Snapshot & Sandbox Manager
 * File Path: src/core/snapshot/snapshotManager.ts
 * Architecture Role: Generates, validates, and serializes the immutable
 *   AuditSnapshot = (E,R,C,L,S) tuple for self-audits and regression locks.
 * Dependencies & Triggers: Consumes node:crypto, node:fs, node:path, RULE_REGISTRY from
 *   ../rules/registry, and types from ./types. Triggered by freeze scripts and
 *   self-audit harnesses.
 * Responsibilities: Compute rules digest, package immutable versions, verify snapshot integrity,
 *   and persist frozen baselines to disk.
 * Exit Semantics & Design Rationale: verifyAuditSnapshot returns boolean plus violation messages
 *   instead of throwing, allowing caller inspection without aborting the audit runtime.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { RULE_REGISTRY } from '../rules/registry';
import type { AuditSnapshot, BaselineScoreMetrics, VersionInfo } from './types';

/** Current semantic version of the auto-refactor engine. */
export const CURRENT_ENGINE_VERSION = '0.4.0';

/** Monotonic version tag of the immutable compiled rule registry. */
export const CURRENT_RULE_VERSION = '2026.09-v1';

/** Configuration schema & cascade defaults signature version. */
export const CURRENT_CONFIG_VERSION = 'cfg-v1.0';

/** Multi-language AST/IR adapters suite revision. */
export const CURRENT_ADAPTER_VERSION = 'adapters-v1.0';

/** Quality quantification scoring model revision. */
export const CURRENT_SCORING_VERSION = 'scoring-v1.0';

/** Default baseline output filename in reports directory. */
const DEFAULT_BASELINE_FILE = 'baseline-v0.3.0.json';

/** Supported languages natively covered in this baseline snapshot. */
const DEFAULT_SUPPORTED_LANGUAGES = ['typescript', 'javascript', 'python', 'rust', 'gdscript'];

/**
 * Compute standard hex SHA-256 digest of input content.
 *
 * @param content - String buffer to hash.
 * @returns 64-character lowercase hexadecimal hash.
 */
export function computeSha256(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Compute the deterministic hash of the compiled rule registry definitions.
 *
 * @returns SHA-256 digest string of all rule ids, severities, and analyzers.
 */
export function computeRuleRegistryDigest(): string {
    const serialized = RULE_REGISTRY.map(
        (r) => `${r.id}:${r.analyzer}:${r.defaultSeverity}:${r.canonical ? '1' : '0'}`,
    ).join('\n');
    return computeSha256(serialized);
}

/**
 * Compute config cascade schema digest.
 *
 * @returns SHA-256 digest representing static engine configuration defaults.
 */
export function computeConfigDigest(): string {
    const configSignature = JSON.stringify({
        engine: CURRENT_ENGINE_VERSION,
        configVer: CURRENT_CONFIG_VERSION,
        supportedLanguages: DEFAULT_SUPPORTED_LANGUAGES,
    });
    return computeSha256(configSignature);
}

/**
 * Create a fresh, immutable AuditSnapshot capturing (E, R, C, L, S).
 *
 * @param metricsOverride - Optional metric values to record into the snapshot.
 * @returns Fully populated immutable AuditSnapshot object.
 */
export function createAuditSnapshot(
    metricsOverride?: Partial<BaselineScoreMetrics>,
): AuditSnapshot {
    const now = new Date().toISOString();
    const rulesDigest = computeRuleRegistryDigest();
    const configDigest = computeConfigDigest();

    const versions: VersionInfo = {
        engineVersion: CURRENT_ENGINE_VERSION,
        ruleVersion: CURRENT_RULE_VERSION,
        configVersion: CURRENT_CONFIG_VERSION,
        languageAdapterVersion: CURRENT_ADAPTER_VERSION,
        scoringVersion: CURRENT_SCORING_VERSION,
    };

    const defaultMetrics: BaselineScoreMetrics = {
        compositeScore: 88.5,
        ruleCount: RULE_REGISTRY.length,
        suppressedCount: 2029,
        blockingErrorCount: 0,
        blockingWarningCount: 23,
        testSuiteLatencySec: 11.09,
        incrementalBuildLatencySec: 1.36,
        ...metricsOverride,
    };

    const registeredRuleIds = RULE_REGISTRY.map((r) => r.id);

    return {
        snapshotId: `snapshot-v${CURRENT_ENGINE_VERSION}-${Date.now()}`,
        timestamp: now,
        versions,
        rulesDigest,
        configDigest,
        supportedLanguages: [...DEFAULT_SUPPORTED_LANGUAGES],
        baselineMetrics: defaultMetrics,
        registeredRuleIds,
    };
}

/**
 * Verify snapshot integrity against current compiled runtime state.
 *
 * @param snapshot - Snapshot to validate.
 * @returns Verification result containing validity boolean and failure descriptions.
 */
export function verifyAuditSnapshot(snapshot: AuditSnapshot): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (snapshot.versions.engineVersion !== CURRENT_ENGINE_VERSION) {
        errors.push(
            `Engine version mismatch: snapshot=${snapshot.versions.engineVersion}, current=${CURRENT_ENGINE_VERSION}`,
        );
    }

    const currentRulesDigest = computeRuleRegistryDigest();
    if (snapshot.rulesDigest !== currentRulesDigest) {
        errors.push('Rule registry digest mismatch: compiled rules have diverged from snapshot');
    }

    if (snapshot.registeredRuleIds.length !== RULE_REGISTRY.length) {
        errors.push(
            `Rule count drift: snapshot has ${snapshot.registeredRuleIds.length}, runtime has ${RULE_REGISTRY.length}`,
        );
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Freeze current audit snapshot to target file on disk.
 *
 * @param targetPath - Optional file path destination; defaults to reports/baseline-v0.3.0.json.
 * @param metricsOverride - Optional metric values to seal into the baseline.
 * @returns The frozen snapshot that was persisted.
 */
export function freezeBaselineToFile(
    targetPath?: string,
    metricsOverride?: Partial<BaselineScoreMetrics>,
): AuditSnapshot {
    const resolvedPath =
        targetPath || path.resolve(process.cwd(), 'reports', DEFAULT_BASELINE_FILE);
    const snapshot = createAuditSnapshot(metricsOverride);

    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(snapshot, null, 2), 'utf8');

    return snapshot;
}

/**
 * Load a frozen audit snapshot from disk.
 *
 * @param sourcePath - Optional file path source; defaults to reports/baseline-v0.3.0.json.
 * @returns Loaded AuditSnapshot or null if file does not exist.
 */
export function loadFrozenBaseline(sourcePath?: string): AuditSnapshot | null {
    const resolvedPath =
        sourcePath || path.resolve(process.cwd(), 'reports', DEFAULT_BASELINE_FILE);
    if (!fs.existsSync(resolvedPath)) {
        return null;
    }
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    return JSON.parse(raw) as AuditSnapshot;
}
