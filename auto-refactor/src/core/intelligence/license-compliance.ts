/**
 * Module: Core Engine — SPDX License Compliance & Copyleft Auditor
 * File Path: src/core/intelligence/license-compliance.ts
 * Architecture Role: Software license governance auditor assessing commercial and
 *   compliance risk, with specialized viral and weak copyleft detection.
 * Dependencies & Triggers: Consumes SPDX identifiers and compound expressions;
 *   invoked by governance evaluators and dependency provenance scanners.
 * Responsibilities:
 *   1. Classify SPDX license identifiers into permissive, weak copyleft,
 *      viral copyleft, or unapproved;
 *   2. Identify viral copyleft obligations (AGPL-3.0, GPL-2.0, GPL-3.0, SSPL-1.0);
 *   3. Audit compliance against configurable organizational policies.
 * Exit Semantics & Design Rationale: Never throws; deterministic classification
 *   with fallback to unapproved for unrecognized identifiers.
 */

/**
 * Four-tier classification of open source and proprietary software licenses
 * based on commercial distribution obligations and reciprocal copyleft constraints.
 */
export type LicenseCategory = 'permissive' | 'weak_copyleft' | 'viral_copyleft' | 'unapproved';

/**
 * Organizational license compliance policy settings.
 */
export interface LicensePolicy {
    /** Permitted license categories (defaults to ['permissive']) */
    readonly allowedCategories?: readonly LicenseCategory[];
    /** Explicit whitelist of approved SPDX identifiers */
    readonly allowedLicenses?: readonly string[];
    /** Explicit blacklist of strictly prohibited SPDX identifiers */
    readonly blockedLicenses?: readonly string[];
    /** Whether weak copyleft licenses (e.g. LGPL, MPL) are accepted (default: false) */
    readonly allowWeakCopyleft?: boolean;
    /** Whether viral copyleft licenses must be strictly rejected (default: true) */
    readonly blockViralCopyleft?: boolean;
}

/**
 * Comprehensive compliance audit outcome report for an audited license expression.
 */
export interface LicenseAuditResult {
    /** Original SPDX expression audited */
    readonly spdxExpression: string;
    /** Normalized primary SPDX identifier */
    readonly normalizedSpdx: string;
    /** Categorical classification */
    readonly category: LicenseCategory;
    /** Whether license complies with active policy */
    readonly compliant: boolean;
    /** Whether license imposes viral copyleft obligations */
    readonly isViralCopyleft: boolean;
    /** Risk severity level */
    readonly riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none';
    /** Human-readable rationale for audit decision */
    readonly reason: string;
    /** Specific policy violation descriptions, if any */
    readonly violations: readonly string[];
    /** Actionable remediation recommendation */
    readonly remediation?: string;
}

/** Known permissive SPDX identifiers */
const PERMISSIVE_LICENSES: ReadonlySet<string> = new Set([
    'MIT',
    'MIT-0',
    'APACHE-2.0',
    'APACHE-1.1',
    'BSD-2-CLAUSE',
    'BSD-3-CLAUSE',
    'BSD-4-CLAUSE',
    '0BSD',
    'ISC',
    'UNLICENSE',
    'CC0-1.0',
    'WTFPL',
    'ZLIB',
    'ARTISTIC-2.0',
    'BLUEOAK-1.0.0',
    'PYTHON-2.0',
    'POSTGRESQL',
    'X11',
]);

/** Known weak copyleft SPDX identifiers */
const WEAK_COPYLEFT_LICENSES: ReadonlySet<string> = new Set([
    'LGPL-2.0',
    'LGPL-2.0+',
    'LGPL-2.0-ONLY',
    'LGPL-2.0-OR-LATER',
    'LGPL-2.1',
    'LGPL-2.1+',
    'LGPL-2.1-ONLY',
    'LGPL-2.1-OR-LATER',
    'LGPL-3.0',
    'LGPL-3.0+',
    'LGPL-3.0-ONLY',
    'LGPL-3.0-OR-LATER',
    'MPL-1.0',
    'MPL-1.1',
    'MPL-2.0',
    'CDDL-1.0',
    'CDDL-1.1',
    'EPL-1.0',
    'EPL-2.0',
    'IPL-1.0',
    'CPL-1.0',
]);

/** Known viral copyleft reciprocal SPDX identifiers */
const VIRAL_COPYLEFT_LICENSES: ReadonlySet<string> = new Set([
    'AGPL-1.0',
    'AGPL-1.0-ONLY',
    'AGPL-1.0-OR-LATER',
    'AGPL-3.0',
    'AGPL-3.0+',
    'AGPL-3.0-ONLY',
    'AGPL-3.0-OR-LATER',
    'GPL-1.0',
    'GPL-1.0+',
    'GPL-1.0-ONLY',
    'GPL-1.0-OR-LATER',
    'GPL-2.0',
    'GPL-2.0+',
    'GPL-2.0-ONLY',
    'GPL-2.0-OR-LATER',
    'GPL-3.0',
    'GPL-3.0+',
    'GPL-3.0-ONLY',
    'GPL-3.0-OR-LATER',
    'SSPL-1.0',
    'EUPL-1.1',
    'EUPL-1.2',
    'OSL-3.0',
    'CC-BY-SA-3.0',
    'CC-BY-SA-4.0',
    'CPAL-1.0',
]);

/** Default corporate governance license policy */
export const DEFAULT_LICENSE_POLICY: LicensePolicy = Object.freeze({
    allowedCategories: Object.freeze<LicenseCategory[]>(['permissive']),
    allowedLicenses: Object.freeze([]),
    blockedLicenses: Object.freeze([]),
    allowWeakCopyleft: false,
    blockViralCopyleft: true,
});

/**
 * Strips parentheses, prefixes, and normalizes capitalization.
 *
 * @param spdx - Raw SPDX license identifier or expression token
 * @returns Cleaned uppercase token
 */
function normalizeToken(spdx: string): string {
    return spdx.trim().replace(/^\(+/, '').replace(/\)+$/, '').trim().toUpperCase();
}

/**
 * Checks whether an individual normalized token is viral copyleft.
 *
 * @param token - Cleaned uppercase token
 * @returns True if token matches viral copyleft patterns
 */
function isViralToken(token: string): boolean {
    if (VIRAL_COPYLEFT_LICENSES.has(token)) {
        return true;
    }
    // Pattern matches for versioned or suffixed variants (e.g. GPL-3.0-WITH-...)
    return (
        /^(AGPL|GPL|SSPL|EUPL|OSL)(?:-[0-9]+(?:\.[0-9]+)?)?(?:-ONLY|-OR-LATER|\+)?(?:-WITH-.*)?$/.test(
            token,
        ) && !token.startsWith('LGPL')
    );
}

/**
 * Checks whether an individual normalized token is weak copyleft.
 *
 * @param token - Cleaned uppercase token
 * @returns True if token matches weak copyleft patterns
 */
function isWeakToken(token: string): boolean {
    if (WEAK_COPYLEFT_LICENSES.has(token)) {
        return true;
    }
    return (
        /^LGPL(?:-[0-9]+(?:\.[0-9]+)?)?(?:-ONLY|-OR-LATER|\+)?$/.test(token) ||
        /^MPL(?:-[0-9]+(?:\.[0-9]+)?)?$/.test(token) ||
        /^CDDL(?:-[0-9]+(?:\.[0-9]+)?)?$/.test(token) ||
        /^EPL(?:-[0-9]+(?:\.[0-9]+)?)?$/.test(token)
    );
}

/**
 * Checks whether an individual normalized token is permissive.
 *
 * @param token - Cleaned uppercase token
 * @returns True if token matches permissive patterns
 */
function isPermissiveToken(token: string): boolean {
    if (PERMISSIVE_LICENSES.has(token)) {
        return true;
    }
    return /^(MIT|APACHE|BSD|ISC|0BSD|ZLIB)/.test(token);
}

/**
 * Classifies an individual SPDX license identifier token into a LicenseCategory.
 *
 * @param token - Cleaned uppercase SPDX identifier
 * @returns LicenseCategory classification
 */
function classifySingleToken(token: string): LicenseCategory {
    if (!token) {
        return 'unapproved';
    }
    if (isViralToken(token)) {
        return 'viral_copyleft';
    }
    if (isWeakToken(token)) {
        return 'weak_copyleft';
    }
    if (isPermissiveToken(token)) {
        return 'permissive';
    }
    return 'unapproved';
}

/**
 * Classifies an SPDX license identifier or compound expression into a LicenseCategory.
 *
 * Handles compound expressions with OR (disjunctive/dual) and AND (conjunctive).
 *
 * @param licenseSpdx - Raw SPDX license identifier or expression
 * @returns Classified LicenseCategory
 */
export function classifySpdxLicense(licenseSpdx: string): LicenseCategory {
    if (!licenseSpdx || typeof licenseSpdx !== 'string') {
        return 'unapproved';
    }

    const trimmed = licenseSpdx.trim();
    if (!trimmed) {
        return 'unapproved';
    }

    // Handle disjunctive dual licensing (e.g. "MIT OR GPL-3.0")
    if (/(?:\s+OR\s+|\)\s*OR\s*|\s*OR\s*\()/i.test(trimmed)) {
        const parts = trimmed.split(/(?:\s+OR\s+|\)\s*OR\s*|\s*OR\s*\()/i).map(normalizeToken);
        const categories = parts.map(classifySingleToken);

        // Under dual licensing, licensee may choose the most permissive available branch
        if (categories.includes('permissive')) {
            return 'permissive';
        }
        if (categories.includes('weak_copyleft')) {
            return 'weak_copyleft';
        }
        if (categories.includes('viral_copyleft')) {
            return 'viral_copyleft';
        }
        return 'unapproved';
    }

    // Handle conjunctive compound licensing (e.g. "MIT AND GPL-3.0")
    if (/(?:\s+AND\s+|\)\s*AND\s*|\s*AND\s*\()/i.test(trimmed)) {
        const parts = trimmed.split(/(?:\s+AND\s+|\)\s*AND\s*|\s*AND\s*\()/i).map(normalizeToken);
        const categories = parts.map(classifySingleToken);

        // Must satisfy all terms: most restrictive classification wins
        if (categories.includes('viral_copyleft')) {
            return 'viral_copyleft';
        }
        if (categories.includes('weak_copyleft')) {
            return 'weak_copyleft';
        }
        if (categories.includes('unapproved')) {
            return 'unapproved';
        }
        return 'permissive';
    }

    const token = normalizeToken(trimmed);
    return classifySingleToken(token);
}

/**
 * Checks whether an SPDX license identifier or expression imposes viral copyleft obligations
 * (e.g. AGPL-3.0, GPL-2.0, GPL-3.0, SSPL-1.0).
 *
 * @param licenseSpdx - SPDX license string or expression
 * @returns True if license is viral copyleft
 */
export function isViralCopyleft(licenseSpdx: string): boolean {
    if (!licenseSpdx || typeof licenseSpdx !== 'string') {
        return false;
    }

    const trimmed = licenseSpdx.trim();
    if (!trimmed) {
        return false;
    }

    // If expression contains OR with a permissive branch, viral obligations are avoidable
    if (/(?:\s+OR\s+|\)\s*OR\s*|\s*OR\s*\()/i.test(trimmed)) {
        const parts = trimmed.split(/(?:\s+OR\s+|\)\s*OR\s*|\s*OR\s*\()/i).map(normalizeToken);
        const hasPermissive = parts.some((p) => classifySingleToken(p) === 'permissive');
        if (hasPermissive) {
            return false;
        }
        return parts.some(isViralToken);
    }

    // If expression contains AND, viral copyleft on any branch infects the whole
    if (/(?:\s+AND\s+|\)\s*AND\s*|\s*AND\s*\()/i.test(trimmed)) {
        const parts = trimmed.split(/(?:\s+AND\s+|\)\s*AND\s*|\s*AND\s*\()/i).map(normalizeToken);
        return parts.some(isViralToken);
    }

    return isViralToken(normalizeToken(trimmed));
}

/**
 * Checks whether an SPDX license identifier represents a weak copyleft license (e.g. LGPL, MPL).
 *
 * @param licenseSpdx - SPDX license string
 * @returns True if license is weak copyleft
 */
export function isWeakCopyleft(licenseSpdx: string): boolean {
    return classifySpdxLicense(licenseSpdx) === 'weak_copyleft';
}

/**
 * Checks whether an SPDX license identifier represents a permissive open-source license.
 *
 * @param licenseSpdx - SPDX license string
 * @returns True if license is permissive
 */
export function isPermissive(licenseSpdx: string): boolean {
    return classifySpdxLicense(licenseSpdx) === 'permissive';
}

/**
 * Audits an SPDX license string against an organizational compliance policy.
 *
 * Evaluates viral copyleft risks, category approvals, and explicit allow/block lists.
 *
 * @param licenseSpdx - SPDX license identifier or expression
 * @param policy - Optional policy configuration (defaults to DEFAULT_LICENSE_POLICY)
 * @returns LicenseAuditResult detailing compliance status and risk factors
 */
export function auditLicenseCompliance(
    licenseSpdx: string,
    policy: LicensePolicy = DEFAULT_LICENSE_POLICY,
): LicenseAuditResult {
    const raw = licenseSpdx || '';
    const trimmed = raw.trim();

    if (!trimmed) {
        return {
            spdxExpression: raw,
            normalizedSpdx: '',
            category: 'unapproved',
            compliant: false,
            isViralCopyleft: false,
            riskLevel: 'high',
            reason: 'Missing or unspecified license identifier.',
            violations: ['License identifier is empty or missing.'],
            remediation: 'Declare an approved SPDX license identifier in package manifest.',
        };
    }

    const normalized = normalizeToken(trimmed);
    const category = classifySpdxLicense(trimmed);
    const viral = isViralCopyleft(trimmed);

    const allowedCategories = policy.allowedCategories ??
        DEFAULT_LICENSE_POLICY.allowedCategories ?? ['permissive'];
    const allowedLicenses = (policy.allowedLicenses ?? []).map((l) => normalizeToken(l));
    const blockedLicenses = (policy.blockedLicenses ?? []).map((l) => normalizeToken(l));
    const allowWeakCopyleft = policy.allowWeakCopyleft ?? false;
    const blockViralCopyleft = policy.blockViralCopyleft ?? true;

    const violations: string[] = [];

    // 1. Explicit blacklist takes absolute precedence
    if (blockedLicenses.includes(normalized)) {
        violations.push(`License "${trimmed}" is explicitly blocked by policy.`);
        return {
            spdxExpression: trimmed,
            normalizedSpdx: normalized,
            category,
            compliant: false,
            isViralCopyleft: viral,
            riskLevel: 'critical',
            reason: `License "${trimmed}" is on the prohibited license blacklist.`,
            violations,
            remediation: 'Remove dependency or replace with an approved alternative.',
        };
    }

    // 2. Explicit whitelist approval
    if (allowedLicenses.includes(normalized)) {
        return {
            spdxExpression: trimmed,
            normalizedSpdx: normalized,
            category,
            compliant: true,
            isViralCopyleft: viral,
            riskLevel: viral ? 'medium' : 'none',
            reason: `License "${trimmed}" is explicitly approved by policy whitelist.`,
            violations: [],
        };
    }

    // 3. Viral copyleft strict rejection
    if (viral && blockViralCopyleft) {
        violations.push(
            `Viral copyleft license "${trimmed}" imposes reciprocal distribution requirements.`,
        );
        return {
            spdxExpression: trimmed,
            normalizedSpdx: normalized,
            category,
            compliant: false,
            isViralCopyleft: true,
            riskLevel: 'critical',
            reason:
                `Viral copyleft license "${trimmed}" poses severe intellectual property ` +
                'and closed-source enclosure risks.',
            violations,
            remediation:
                'Replace dependency with a permissively licensed alternative (MIT/Apache-2.0) ' +
                'or negotiate commercial terms.',
        };
    }

    // 4. Weak copyleft evaluation
    if (category === 'weak_copyleft') {
        const isAllowed = allowWeakCopyleft || allowedCategories.includes('weak_copyleft');
        if (isAllowed) {
            return {
                spdxExpression: trimmed,
                normalizedSpdx: normalized,
                category,
                compliant: true,
                isViralCopyleft: false,
                riskLevel: 'low',
                reason:
                    `Weak copyleft license "${trimmed}" is permitted; isolate via dynamic linking ` +
                    'and preserve library modifications.',
                violations: [],
            };
        }

        violations.push(
            `Weak copyleft license "${trimmed}" is not approved under standard permissive policy.`,
        );
        return {
            spdxExpression: trimmed,
            normalizedSpdx: normalized,
            category,
            compliant: false,
            isViralCopyleft: false,
            riskLevel: 'medium',
            reason: `Weak copyleft license "${trimmed}" requires policy exception or dynamic linking review.`,
            violations,
            remediation:
                'Ensure module is linked dynamically without modifications, or request policy exception.',
        };
    }

    // 5. Permissive category evaluation
    if (category === 'permissive') {
        if (allowedCategories.includes('permissive')) {
            return {
                spdxExpression: trimmed,
                normalizedSpdx: normalized,
                category,
                compliant: true,
                isViralCopyleft: false,
                riskLevel: 'none',
                reason: `Permissive license "${trimmed}" complies with corporate policy.`,
                violations: [],
            };
        }

        violations.push(`Permissive license "${trimmed}" is excluded by category policy.`);
        return {
            spdxExpression: trimmed,
            normalizedSpdx: normalized,
            category,
            compliant: false,
            isViralCopyleft: false,
            riskLevel: 'medium',
            reason: `License category "permissive" is not in allowed categories list.`,
            violations,
            remediation: 'Add permissive category to allowed policy categories.',
        };
    }

    // 6. Unapproved or unrecognized license
    violations.push(`License "${trimmed}" is unrecognized or unapproved for commercial use.`);
    return {
        spdxExpression: trimmed,
        normalizedSpdx: normalized,
        category: 'unapproved',
        compliant: false,
        isViralCopyleft: false,
        riskLevel: 'high',
        reason: `Unrecognized or proprietary license "${trimmed}" lacks commercial clearance.`,
        violations,
        remediation: 'Clarify licensing terms with package authors or seek legal review.',
    };
}
