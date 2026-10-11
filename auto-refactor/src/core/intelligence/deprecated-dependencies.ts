/**
 * Module: Core Intelligence — Deprecated & Legacy Dependency Registry
 * File Path: src/core/intelligence/deprecated-dependencies.ts
 * Architecture Role: Detects usage of abandoned, deprecated, or obsolete external packages
 *   and provides deterministic modern migration recommendations (DEP-OBS-001).
 * Dependencies & Triggers: Consumed by dependencyLayout and DependencyLayoutAnalyzer.
 * Responsibilities:
 *   1. Maintain canonical inventory of deprecated packages across Node.js, Python,
 *      and Go ecosystems;
 *   2. Identify deprecated dependency imports and attribute modern standard alternatives;
 *   3. Provide non-throwing lookup helpers with normalized package name matching.
 * Exit Semantics & Design Rationale: Pure in-memory dictionary lookup; never throws; returns null
 *   when package is not recognized as deprecated.
 */

/** Metadata descriptor for a known deprecated or abandoned package */
export interface DeprecatedPackageEntry {
    /** Canonical package identifier */
    packageName: string;
    /** Programming language ecosystem */
    ecosystem: 'javascript' | 'python' | 'go' | 'universal';
    /** Upstream deprecation reason or status */
    reason: string;
    /** Recommended modern standard replacement */
    replacement: string;
    /** Architectural guidance for remediation */
    remediation: string;
}

/** Registry of established deprecated packages and their modern replacements */
const DEPRECATED_PACKAGE_MAP: Readonly<Record<string, DeprecatedPackageEntry>> = Object.freeze({
    request: {
        packageName: 'request',
        ecosystem: 'javascript',
        reason: 'Deprecated by upstream maintainers since 2020 and receives no security updates.',
        replacement: 'fetch / undici / axios',
        remediation: 'Migrate to standard global fetch, undici, or axios for HTTP communication.',
    },
    querystring: {
        packageName: 'querystring',
        ecosystem: 'javascript',
        reason: 'Legacy Node.js built-in API declared officially deprecated.',
        replacement: 'URLSearchParams',
        remediation: 'Use WHATWG standard URLSearchParams for query string parsing and formatting.',
    },
    'node-uuid': {
        packageName: 'node-uuid',
        ecosystem: 'javascript',
        reason: 'Abandoned legacy package name superseded by the uuid package.',
        replacement: 'crypto.randomUUID() / uuid',
        remediation: 'Use native crypto.randomUUID() or the maintained uuid package.',
    },
    moment: {
        packageName: 'moment',
        ecosystem: 'javascript',
        reason: 'In permanent maintenance mode with significant mutable state and bundle overhead.',
        replacement: 'dayjs / date-fns / Intl',
        remediation:
            'Migrate to modern immutable alternatives such as dayjs, date-fns, or native Intl.',
    },
    'left-pad': {
        packageName: 'left-pad',
        ecosystem: 'javascript',
        reason: 'Obsolete micro-utility replaced by ECMAScript standard language built-ins.',
        replacement: 'String.prototype.padStart()',
        remediation: 'Use ECMAScript standard String.prototype.padStart() directly.',
    },
    colors: {
        packageName: 'colors',
        ecosystem: 'javascript',
        reason: 'Legacy terminal styling library with history of supply chain disruption.',
        replacement: 'picocolors / kleur / chalk',
        remediation:
            'Replace with zero-dependency lightweight alternatives such as picocolors or kleur.',
    },
    distutils: {
        packageName: 'distutils',
        ecosystem: 'python',
        reason: 'Deprecated in Python 3.10 and completely removed in Python 3.12.',
        replacement: 'setuptools / sysconfig',
        remediation:
            'Migrate build and configuration routines to setuptools or standard sysconfig.',
    },
    imp: {
        packageName: 'imp',
        ecosystem: 'python',
        reason: 'Deprecated in Python 3.4 in favor of importlib.',
        replacement: 'importlib',
        remediation: 'Use standard importlib for dynamic module import and introspection.',
    },
    optparse: {
        packageName: 'optparse',
        ecosystem: 'python',
        reason: 'Deprecated in favor of argparse since Python 2.7 / 3.2.',
        replacement: 'argparse',
        remediation: 'Migrate command-line argument parsing to the standard argparse module.',
    },
});

/**
 * Checks whether a package is a known deprecated or abandoned package.
 *
 * @param packageName - Package identifier to query (e.g. 'request', 'moment')
 * @returns DeprecatedPackageEntry if deprecated, or null if unflagged
 */
export function checkDeprecatedPackage(packageName: string): DeprecatedPackageEntry | null {
    if (!packageName || typeof packageName !== 'string') {
        return null;
    }
    const norm = packageName
        .trim()
        .toLowerCase()
        .replace(/^node:/, '');
    return DEPRECATED_PACKAGE_MAP[norm] ?? null;
}
