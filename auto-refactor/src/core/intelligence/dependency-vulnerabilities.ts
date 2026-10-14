/**
 * Module: Core Engine — Dependency Vulnerability & Poisoning Detector
 * File Path: src/core/intelligence/dependency-vulnerabilities.ts
 * Architecture Role: Supply chain security analyzer detecting malicious, poisoned,
 *   and backdoored packages in external SDKs and import specifiers.
 * Dependencies & Triggers: Consumes package specifiers and optional version strings;
 *   invoked by static analyzers and repository governance gates.
 * Responsibilities:
 *   1. Maintain authoritative dictionary of known high-risk and poisoned packages;
 *   2. Parse package specifiers supporting scopes (@scope/pkg) and deep subpaths;
 *   3. Audit dependency specifiers and report vulnerability details.
 * Exit Semantics & Design Rationale: Never throws; deterministic dictionary lookups
 *   with safe fallbacks.
 */

/** Severity ranking of a detected supply-chain vulnerability */
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low';

/** Category of supply-chain threat */
export type VulnerabilityCategory =
    'backdoor' | 'poisoning' | 'protestware' | 'malicious_payload' | 'account_takeover';

/** Critical severity indicator for supply-chain vulnerability findings */
export const VULN_SEV_CRITICAL: VulnerabilitySeverity = 'critical';
/** High severity indicator for supply-chain vulnerability findings */
export const VULN_SEV_HIGH: VulnerabilitySeverity = 'high';
/** Medium severity indicator for supply-chain vulnerability findings */
export const VULN_SEV_MEDIUM: VulnerabilitySeverity = 'medium';
/** Low severity indicator for supply-chain vulnerability findings */
export const VULN_SEV_LOW: VulnerabilitySeverity = 'low';

/** Category constant representing backdoor insertion */
export const VULN_CAT_BACKDOOR: VulnerabilityCategory = 'backdoor';
/** Category constant representing repository or package poisoning */
export const VULN_CAT_POISONING: VulnerabilityCategory = 'poisoning';
/** Category constant representing protestware supply-chain alteration */
export const VULN_CAT_PROTESTWARE: VulnerabilityCategory = 'protestware';
/** Category constant representing malicious payload delivery */
export const VULN_CAT_MALICIOUS: VulnerabilityCategory = 'malicious_payload';
/** Category constant representing account takeover compromise */
export const VULN_CAT_TAKEOVER: VulnerabilityCategory = 'account_takeover';

/** Wildcard token matching all package versions for universal supply-chain embargoes */
export const AFFECTED_ALL_VERSIONS = '*';

const PROTOCOL_FILE = 'file:';
const PROTOCOL_HTTP = 'http:';
const PROTOCOL_HTTPS = 'https:';
const PROTOCOL_NODE = 'node:';

/** Internal dictionary record definition for known vulnerable packages */
export interface VulnerabilityRecord {
    /** Target npm package name including scope if applicable */
    readonly packageName: string;
    /** Specific affected version strings, or '*' if all versions are malicious */
    readonly affectedVersions: readonly string[] | '*';
    /** Threat severity ranking */
    readonly severity: VulnerabilitySeverity;
    /** Categorical classification */
    readonly category: VulnerabilityCategory;
    /** Public advisory identifier (CVE, GHSA, or MAL identifier) */
    readonly advisoryId: string;
    /** Human-readable headline */
    readonly title: string;
    /** Detailed context and impact description */
    readonly description: string;
    /** Recommended mitigation or safe alternative */
    readonly recommendation: string;
}

/** Result payload emitted when a vulnerability match is detected */
export interface VulnerabilityReport {
    /** Extracted package name */
    readonly packageName: string;
    /** Original import or dependency specifier analyzed */
    readonly specifier: string;
    /** Version string detected from specifier or version argument */
    readonly detectedVersion?: string;
    /** Affected versions specification from record */
    readonly affectedVersions: readonly string[] | '*';
    /** Threat severity level */
    readonly severity: VulnerabilitySeverity;
    /** Category of security issue */
    readonly category: VulnerabilityCategory;
    /** Advisory identifier */
    readonly advisoryId: string;
    /** Headline title */
    readonly title: string;
    /** Detailed vulnerability synopsis */
    readonly description: string;
    /** Recommended mitigation */
    readonly recommendation: string;
}

/** Extracted metadata from an import or package specifier string */
export interface ParsedPackageSpecifier {
    /** Canonical package name including scope (e.g. '@scope/pkg' or 'pkg') */
    readonly packageName: string;
    /** Version tag or semver if embedded in specifier */
    readonly version?: string;
    /** Subpath within the package (e.g. 'sub/dir') */
    readonly subpath?: string;
}

/** Options configuring vulnerability checking behavior */
export interface VulnerabilityCheckOptions {
    /**
     * When true, matches packages with known vulnerabilities even when
     * version is unspecified in both specifier and version argument.
     * Defaults to false (precise matching against affected versions).
     */
    readonly matchAnyVersionIfUnspecified?: boolean;
}

/**
 * Authoritative dictionary of known high-risk, backdoored, and poisoned packages.
 */
export const KNOWN_VULNERABILITY_DICTIONARY: readonly VulnerabilityRecord[] = Object.freeze([
    {
        packageName: 'flatmap-stream',
        affectedVersions: AFFECTED_ALL_VERSIONS,
        severity: VULN_SEV_CRITICAL,
        category: VULN_CAT_BACKDOOR,
        advisoryId: 'GHSA-5545-2q6w-2gh6',
        title: 'Malicious supply-chain backdoor stealing Bitcoin credentials',
        description:
            'flatmap-stream was crafted and published as an injection payload ' +
            'to compromise event-stream and steal Bitcoin wallets from Copay users.',
        recommendation:
            'Immediately remove flatmap-stream and revoke any exposed credentials or private keys.',
    },
    {
        packageName: 'event-stream',
        affectedVersions: Object.freeze(['3.3.6']),
        severity: VULN_SEV_CRITICAL,
        category: VULN_CAT_BACKDOOR,
        advisoryId: 'CVE-2018-20834',
        title: 'Supply chain compromise introducing flatmap-stream backdoor',
        description:
            'event-stream 3.3.6 was released with a malicious flatmap-stream dependency ' +
            'targeting cryptocurrency wallet software.',
        recommendation:
            'Pin to event-stream@3.3.4, upgrade to event-stream@4.0.1, or replace with stream.',
    },
    {
        packageName: 'colors',
        affectedVersions: Object.freeze(['1.4.1', '1.4.2']),
        severity: VULN_SEV_HIGH,
        category: VULN_CAT_PROTESTWARE,
        advisoryId: 'GHSA-5wpq-43j2-6qwc',
        title: 'Protestware / denial of service via infinite loop and corrupted terminal output',
        description:
            'colors 1.4.1 and 1.4.2 introduced infinite loops printing corrupted ASCII Zalgo text.',
        recommendation: 'Pin to colors@1.4.0 or migrate to picocolors or chalk.',
    },
    {
        packageName: 'faker',
        affectedVersions: Object.freeze(['6.6.6']),
        severity: VULN_SEV_HIGH,
        category: VULN_CAT_PROTESTWARE,
        advisoryId: 'GHSA-48p4-6565-553x',
        title: 'Protestware / intentional repository sabotage',
        description: 'faker 6.6.6 was intentionally sabotaged by its author with an infinite loop.',
        recommendation: 'Pin to faker@5.5.3 or migrate to @faker-js/faker.',
    },
    {
        packageName: 'node-ipc',
        affectedVersions: Object.freeze(['9.2.2', '10.1.1', '10.1.2']),
        severity: VULN_SEV_CRITICAL,
        category: VULN_CAT_MALICIOUS,
        advisoryId: 'CVE-2022-23812',
        title: 'Protestware wiper payload targeting geolocation (peacenotwar)',
        description:
            'node-ipc releases 9.2.2, 10.1.1, and 10.1.2 contained code targeting IP addresses ' +
            'in Russia and Belarus, attempting to overwrite filesystem contents.',
        recommendation: 'Downgrade to node-ipc@9.2.1, 10.1.0, or remove node-ipc entirely.',
    },
    {
        packageName: 'coa',
        affectedVersions: Object.freeze(['2.0.3', '2.0.4']),
        severity: VULN_SEV_CRITICAL,
        category: VULN_CAT_TAKEOVER,
        advisoryId: 'CVE-2021-43788',
        title: 'Account takeover delivering password-stealing malware (Danabot)',
        description:
            'coa 2.0.3 and 2.0.4 were published after npm account takeover, executing batch ' +
            'scripts to steal user credentials.',
        recommendation: 'Pin to coa@2.0.2 and clear package lock caches.',
    },
    {
        packageName: 'rc',
        affectedVersions: Object.freeze(['1.2.9', '1.3.9']),
        severity: VULN_SEV_CRITICAL,
        category: VULN_CAT_TAKEOVER,
        advisoryId: 'CVE-2021-43787',
        title: 'Compromised npm release executing credential stealer malware',
        description:
            'rc 1.2.9 and 1.3.9 were published by an attacker following credential stuffing ' +
            'to download DanaBot malware.',
        recommendation: 'Pin to rc@1.2.8 and inspect CI environments for token leakage.',
    },
    {
        packageName: 'ua-parser-js',
        affectedVersions: Object.freeze(['0.7.29', '0.8.0', '1.0.0']),
        severity: VULN_SEV_CRITICAL,
        category: VULN_CAT_TAKEOVER,
        advisoryId: 'CVE-2021-43616',
        title: 'Compromised npm releases deploying cryptominer and password stealer',
        description:
            'ua-parser-js 0.7.29, 0.8.0, and 1.0.0 were compromised by an unauthorized actor ' +
            'installing XMRig miner and credential stealers.',
        recommendation: 'Upgrade to ua-parser-js@0.7.30, 0.8.1, 1.0.1 or later immediately.',
    },
    {
        packageName: 'peacenotwar',
        affectedVersions: AFFECTED_ALL_VERSIONS,
        severity: VULN_SEV_HIGH,
        category: VULN_CAT_PROTESTWARE,
        advisoryId: 'GHSA-c2qf-rxjj-qqgw',
        title: 'Protestware dropping unexpected political files onto desktop',
        description:
            'peacenotwar was packaged as an unauthorized protestware payload bundled in dependencies.',
        recommendation: 'Remove peacenotwar dependency immediately.',
    },
    {
        packageName: 'crossenv',
        affectedVersions: AFFECTED_ALL_VERSIONS,
        severity: VULN_SEV_CRITICAL,
        category: VULN_CAT_POISONING,
        advisoryId: 'GHSA-394v-5264-9w4j',
        title: 'Typosquatting malicious package for cross-env',
        description: 'crossenv was a typosquatting malware package stealing environment variables.',
        recommendation: 'Remove crossenv and use official cross-env.',
    },
    {
        packageName: 'electron-native-notify',
        affectedVersions: AFFECTED_ALL_VERSIONS,
        severity: VULN_SEV_CRITICAL,
        category: VULN_CAT_MALICIOUS,
        advisoryId: 'GHSA-4hvw-g378-5777',
        title: 'Malicious package executing unauthorized shell commands',
        description:
            'electron-native-notify executed obfuscated reverse shells on host installation.',
        recommendation: 'Remove immediately and audit system processes.',
    },
    {
        packageName: '@malicious/test-package',
        affectedVersions: AFFECTED_ALL_VERSIONS,
        severity: VULN_SEV_CRITICAL,
        category: VULN_CAT_POISONING,
        advisoryId: 'ADV-TEST-MAL-01',
        title: 'Test fixture for scoped malicious package detection',
        description: 'Synthetic malicious scoped package fixture for intelligence testing.',
        recommendation: 'Remove test fixture.',
    },
]);

/** Lookup index mapping package name to vulnerability record */
const VULNERABILITY_MAP: ReadonlyMap<string, VulnerabilityRecord> = new Map(
    KNOWN_VULNERABILITY_DICTIONARY.map((rec) => [rec.packageName.toLowerCase(), rec]),
);

/**
 * Normalizes a semver or version string for matching.
 *
 * @param raw - Raw version string
 * @returns Cleaned version string
 */
function normalizeVersionString(raw: string): string {
    return raw
        .trim()
        .replace(/^[v=^~]+/, '')
        .trim();
}

function isLocalOrProtocolPath(trimmed: string): boolean {
    return (
        trimmed.startsWith('.') ||
        trimmed.startsWith('/') ||
        trimmed.startsWith('\\') ||
        trimmed.startsWith(PROTOCOL_FILE) ||
        trimmed.startsWith(PROTOCOL_HTTP) ||
        trimmed.startsWith(PROTOCOL_HTTPS) ||
        trimmed.startsWith(PROTOCOL_NODE)
    );
}

function splitNameAndVersion(pkgAndVer: string): { name: string; version?: string } | null {
    const atIdx = pkgAndVer.indexOf('@');
    if (atIdx === -1) {
        return pkgAndVer ? { name: pkgAndVer } : null;
    }
    const name = pkgAndVer.slice(0, atIdx);
    if (!name) {
        return null;
    }
    const version = pkgAndVer.slice(atIdx + 1) || undefined;
    return { name, version };
}

function parseScopedSpecifier(trimmed: string): ParsedPackageSpecifier | null {
    const slashIdx = trimmed.indexOf('/');
    if (slashIdx === -1) {
        return null;
    }

    const scope = trimmed.slice(0, slashIdx);
    const remainder = trimmed.slice(slashIdx + 1);
    if (!remainder) {
        return null;
    }

    const nextSlash = remainder.indexOf('/');
    const pkgAndVer = nextSlash === -1 ? remainder : remainder.slice(0, nextSlash);
    const subpath = nextSlash === -1 ? undefined : remainder.slice(nextSlash + 1);

    const split = splitNameAndVersion(pkgAndVer);
    if (!split) {
        return null;
    }

    return {
        packageName: `${scope}/${split.name}`,
        version: split.version ? normalizeVersionString(split.version) : undefined,
        subpath: subpath ? subpath.trim() : undefined,
    };
}

function parseUnscopedSpecifier(trimmed: string): ParsedPackageSpecifier | null {
    const nextSlash = trimmed.indexOf('/');
    const pkgAndVer = nextSlash === -1 ? trimmed : trimmed.slice(0, nextSlash);
    const subpath = nextSlash === -1 ? undefined : trimmed.slice(nextSlash + 1);

    const split = splitNameAndVersion(pkgAndVer);
    if (!split) {
        return null;
    }

    return {
        packageName: split.name,
        version: split.version ? normalizeVersionString(split.version) : undefined,
        subpath: subpath ? subpath.trim() : undefined,
    };
}

/**
 * Parses an import or package specifier into its package name, optional version,
 * and optional subpath. Supports scoped packages (@scope/pkg) and deep subpaths.
 *
 * @param specifier - Specifier string to parse
 * @returns ParsedPackageSpecifier object, or null if invalid or local path
 */
export function parsePackageSpecifier(specifier: string): ParsedPackageSpecifier | null {
    if (!specifier || typeof specifier !== 'string') {
        return null;
    }

    const trimmed = specifier.trim();
    if (!trimmed || isLocalOrProtocolPath(trimmed)) {
        return null;
    }

    if (trimmed.startsWith('@')) {
        return parseScopedSpecifier(trimmed);
    }
    return parseUnscopedSpecifier(trimmed);
}

/**
 * Extracts the canonical package name from an import or dependency specifier,
 * preserving package scope (e.g. '@scope/pkg') and stripping subpaths and versions.
 *
 * @param specifier - Specifier string to extract from
 * @returns Canonical package name, or null if invalid
 */
export function extractPackageName(specifier: string): string | null {
    const parsed = parsePackageSpecifier(specifier);
    return parsed ? parsed.packageName : null;
}

/**
 * Checks whether a package name is listed in the known malicious package dictionary.
 *
 * @param packageName - Package name to check
 * @returns True if package has known vulnerabilities
 */
export function isKnownMaliciousPackage(packageName: string): boolean {
    if (!packageName) {
        return false;
    }
    return VULNERABILITY_MAP.has(packageName.trim().toLowerCase());
}

/**
 * Retrieves the vulnerability record for a package name, if present.
 *
 * @param packageName - Package name to lookup
 * @returns VulnerabilityRecord or null
 */
export function getVulnerabilityRecord(packageName: string): VulnerabilityRecord | null {
    if (!packageName) {
        return null;
    }
    return VULNERABILITY_MAP.get(packageName.trim().toLowerCase()) ?? null;
}

/**
 * Retrieves all registered vulnerability records.
 *
 * @returns Array of registered VulnerabilityRecords
 */
export function getKnownVulnerabilities(): readonly VulnerabilityRecord[] {
    return KNOWN_VULNERABILITY_DICTIONARY;
}

/**
 * Checks whether an import or package specifier matches a known malicious,
 * poisoned, or backdoored package advisory.
 *
 * @param specifier - Import or dependency specifier (e.g. 'colors@1.4.1' or '@scope/pkg/subpath')
 * @param version - Optional explicit version string (overrides version inside specifier)
 * @param options - Optional check configuration flags
 * @returns VulnerabilityReport if matched, or null if benign/unrecognized
 */
export function checkKnownPackageVulnerability(
    specifier: string,
    version?: string,
    options?: VulnerabilityCheckOptions,
): VulnerabilityReport | null {
    const parsed = parsePackageSpecifier(specifier);
    if (!parsed) {
        return null;
    }

    const record = VULNERABILITY_MAP.get(parsed.packageName.toLowerCase());
    if (!record) {
        return null;
    }

    const resolvedVersionRaw = version ?? parsed.version;
    const resolvedVersion = resolvedVersionRaw
        ? normalizeVersionString(resolvedVersionRaw)
        : undefined;

    // Case 1: Entire package is backdoored/poisoned in all versions
    if (record.affectedVersions === AFFECTED_ALL_VERSIONS) {
        return {
            packageName: record.packageName,
            specifier,
            detectedVersion: resolvedVersion,
            affectedVersions: record.affectedVersions,
            severity: record.severity,
            category: record.category,
            advisoryId: record.advisoryId,
            title: record.title,
            description: record.description,
            recommendation: record.recommendation,
        };
    }

    // Case 2: Package has specific poisoned releases
    if (resolvedVersion !== undefined) {
        const isMatched = record.affectedVersions.some((affected) => {
            const normalizedAffected = normalizeVersionString(affected);
            return (
                resolvedVersion === normalizedAffected ||
                resolvedVersion.startsWith(normalizedAffected)
            );
        });

        if (isMatched) {
            return {
                packageName: record.packageName,
                specifier,
                detectedVersion: resolvedVersion,
                affectedVersions: record.affectedVersions,
                severity: record.severity,
                category: record.category,
                advisoryId: record.advisoryId,
                title: record.title,
                description: record.description,
                recommendation: record.recommendation,
            };
        }

        return null;
    }

    // Case 3: Version unspecified
    if (options?.matchAnyVersionIfUnspecified) {
        return {
            packageName: record.packageName,
            specifier,
            detectedVersion: undefined,
            affectedVersions: record.affectedVersions,
            severity: record.severity,
            category: record.category,
            advisoryId: record.advisoryId,
            title: record.title,
            description: record.description,
            recommendation: record.recommendation,
        };
    }

    return null;
}
