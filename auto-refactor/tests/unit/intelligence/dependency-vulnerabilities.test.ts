/**
 * Module: Unit Tests — Dependency Vulnerabilities & License Compliance
 * File Path: tests/unit/intelligence/dependency-vulnerabilities.test.ts
 * Architecture Role: Unit test suite validating supply-chain security checks,
 *   package specifier parsing, poisoning detection, and SPDX license compliance auditing.
 * Test Type: Unit test suite
 */
import { describe, it, expect } from 'vitest';
import {
    checkKnownPackageVulnerability,
    parsePackageSpecifier,
    extractPackageName,
    isKnownMaliciousPackage,
    getKnownVulnerabilities,
    getVulnerabilityRecord,
} from '../../../src/core/intelligence/dependency-vulnerabilities';
import {
    classifySpdxLicense,
    isViralCopyleft,
    isWeakCopyleft,
    isPermissive,
    auditLicenseCompliance,
    DEFAULT_LICENSE_POLICY,
} from '../../../src/core/intelligence/license-compliance';

describe('dependency-vulnerabilities — Package specifier parsing', () => {
    it('parses standard unscoped package without version', () => {
        const parsed = parsePackageSpecifier('flatmap-stream');
        expect(parsed).toEqual({
            packageName: 'flatmap-stream',
            version: undefined,
            subpath: undefined,
        });
    });

    it('parses unscoped package with version tag', () => {
        const parsed = parsePackageSpecifier('event-stream@3.3.6');
        expect(parsed).toEqual({
            packageName: 'event-stream',
            version: '3.3.6',
            subpath: undefined,
        });
    });

    it('parses unscoped package with subpath', () => {
        const parsed = parsePackageSpecifier('colors/safe');
        expect(parsed).toEqual({
            packageName: 'colors',
            version: undefined,
            subpath: 'safe',
        });
    });

    it('parses unscoped package with version and subpath', () => {
        const parsed = parsePackageSpecifier('colors@1.4.1/safe');
        expect(parsed).toEqual({
            packageName: 'colors',
            version: '1.4.1',
            subpath: 'safe',
        });
    });

    it('parses scoped package without version', () => {
        const parsed = parsePackageSpecifier('@scope/pkg');
        expect(parsed).toEqual({
            packageName: '@scope/pkg',
            version: undefined,
            subpath: undefined,
        });
    });

    it('parses scoped package with deep subpaths', () => {
        const parsed = parsePackageSpecifier('@scope/pkg/deep/nested/subpath');
        expect(parsed).toEqual({
            packageName: '@scope/pkg',
            version: undefined,
            subpath: 'deep/nested/subpath',
        });
    });

    it('parses scoped package with version and deep subpaths', () => {
        const parsed = parsePackageSpecifier('@scope/pkg@2.1.0/deep/nested/module');
        expect(parsed).toEqual({
            packageName: '@scope/pkg',
            version: '2.1.0',
            subpath: 'deep/nested/module',
        });
    });

    it('rejects relative, absolute, protocol, and node builtin specifiers', () => {
        expect(parsePackageSpecifier('./local/file')).toBeNull();
        expect(parsePackageSpecifier('../parent/file')).toBeNull();
        expect(parsePackageSpecifier('/root/file')).toBeNull();
        expect(parsePackageSpecifier('node:fs')).toBeNull();
        expect(parsePackageSpecifier('https://example.com/pkg')).toBeNull();
        expect(parsePackageSpecifier('')).toBeNull();
        expect(parsePackageSpecifier('   ')).toBeNull();
    });

    it('extractPackageName extracts canonical package name accurately', () => {
        expect(extractPackageName('@angular/core@15.0.0/testing')).toBe('@angular/core');
        expect(extractPackageName('koa/lib/application')).toBe('koa');
        expect(extractPackageName('event-stream@3.3.6')).toBe('event-stream');
        expect(extractPackageName('./local/module')).toBeNull();
    });
});

describe('dependency-vulnerabilities — Malicious and poisoned package detection', () => {
    it('identifies universally poisoned package (flatmap-stream)', () => {
        expect(isKnownMaliciousPackage('flatmap-stream')).toBe(true);

        const report = checkKnownPackageVulnerability('flatmap-stream');
        expect(report).not.toBeNull();
        expect(report?.packageName).toBe('flatmap-stream');
        expect(report?.severity).toBe('critical');
        expect(report?.category).toBe('backdoor');
        expect(report?.affectedVersions).toBe('*');
        expect(report?.advisoryId).toBe('GHSA-5545-2q6w-2gh6');

        // Works with subpath and any version
        const subpathReport = checkKnownPackageVulnerability('flatmap-stream/index.js', '0.1.1');
        expect(subpathReport).not.toBeNull();
        expect(subpathReport?.packageName).toBe('flatmap-stream');
    });

    it('detects event-stream@3.3.6 backdoor injection', () => {
        const reportWithSpecifier = checkKnownPackageVulnerability('event-stream@3.3.6');
        expect(reportWithSpecifier).not.toBeNull();
        expect(reportWithSpecifier?.severity).toBe('critical');
        expect(reportWithSpecifier?.advisoryId).toBe('CVE-2018-20834');

        const reportWithArg = checkKnownPackageVulnerability('event-stream', '3.3.6');
        expect(reportWithArg).not.toBeNull();
        expect(reportWithArg?.detectedVersion).toBe('3.3.6');

        // Benign versions are not flagged
        expect(checkKnownPackageVulnerability('event-stream', '3.3.4')).toBeNull();
        expect(checkKnownPackageVulnerability('event-stream@4.0.1')).toBeNull();

        // Unspecified version defaults to null, but flags when matchAnyVersionIfUnspecified is true
        expect(checkKnownPackageVulnerability('event-stream')).toBeNull();
        const unspecifiedMatch = checkKnownPackageVulnerability('event-stream', undefined, {
            matchAnyVersionIfUnspecified: true,
        });
        expect(unspecifiedMatch).not.toBeNull();
    });

    it('detects colors@1.4.1 and colors@1.4.2 protestware sabotage', () => {
        const v141 = checkKnownPackageVulnerability('colors@1.4.1');
        expect(v141).not.toBeNull();
        expect(v141?.category).toBe('protestware');

        const v142 = checkKnownPackageVulnerability('colors/safe', '1.4.2');
        expect(v142).not.toBeNull();
        expect(v142?.detectedVersion).toBe('1.4.2');

        // Safe version colors@1.4.0
        expect(checkKnownPackageVulnerability('colors', '1.4.0')).toBeNull();
    });

    it('detects faker@6.6.6 protestware sabotage', () => {
        expect(checkKnownPackageVulnerability('faker@6.6.6')).not.toBeNull();
        expect(checkKnownPackageVulnerability('faker', '6.6.6')).not.toBeNull();
        expect(checkKnownPackageVulnerability('faker', '5.5.3')).toBeNull();
    });

    it('detects node-ipc@9.2.2/10.1.1/10.1.2 wiper payloads', () => {
        expect(checkKnownPackageVulnerability('node-ipc@9.2.2')).not.toBeNull();
        expect(checkKnownPackageVulnerability('node-ipc', '10.1.1')).not.toBeNull();
        expect(checkKnownPackageVulnerability('node-ipc@10.1.2')).not.toBeNull();
        expect(checkKnownPackageVulnerability('node-ipc', '9.2.1')).toBeNull();
    });

    it('detects coa@2.0.3/2.0.4 hijacked releases', () => {
        expect(checkKnownPackageVulnerability('coa@2.0.3')).not.toBeNull();
        expect(checkKnownPackageVulnerability('coa', '2.0.4')).not.toBeNull();
        expect(checkKnownPackageVulnerability('coa', '2.0.2')).toBeNull();
    });

    it('detects rc@1.2.9/1.3.9 credential stealer', () => {
        expect(checkKnownPackageVulnerability('rc@1.2.9')).not.toBeNull();
        expect(checkKnownPackageVulnerability('rc', '1.3.9')).not.toBeNull();
        expect(checkKnownPackageVulnerability('rc', '1.2.8')).toBeNull();
    });

    it('detects ua-parser-js@0.7.29 compromised cryptominer release', () => {
        const report = checkKnownPackageVulnerability('ua-parser-js@0.7.29');
        expect(report).not.toBeNull();
        expect(report?.advisoryId).toBe('CVE-2021-43616');
        expect(checkKnownPackageVulnerability('ua-parser-js', '0.7.30')).toBeNull();
    });

    it('detects scoped malicious test package with deep subpaths', () => {
        const report = checkKnownPackageVulnerability('@malicious/test-package/deep/subpath');
        expect(report).not.toBeNull();
        expect(report?.packageName).toBe('@malicious/test-package');
    });

    it('returns null for benign standard packages', () => {
        expect(checkKnownPackageVulnerability('lodash', '4.17.21')).toBeNull();
        expect(checkKnownPackageVulnerability('react', '18.2.0')).toBeNull();
        expect(checkKnownPackageVulnerability('@types/node', '20.11.0')).toBeNull();
    });

    it('exposes dictionary inspection utilities', () => {
        const dict = getKnownVulnerabilities();
        expect(dict.length).toBeGreaterThan(5);
        expect(getVulnerabilityRecord('colors')).not.toBeNull();
        expect(getVulnerabilityRecord('nonexistent-pkg')).toBeNull();
    });
});

describe('license-compliance — SPDX Classification & Viral Copyleft Detection', () => {
    it('classifies permissive licenses correctly', () => {
        const permissiveList = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD'];
        for (const lic of permissiveList) {
            expect(classifySpdxLicense(lic)).toBe('permissive');
            expect(isPermissive(lic)).toBe(true);
            expect(isViralCopyleft(lic)).toBe(false);
            expect(isWeakCopyleft(lic)).toBe(false);
        }
    });

    it('classifies weak copyleft licenses correctly', () => {
        const weakList = ['LGPL-2.1', 'LGPL-3.0', 'MPL-2.0', 'CDDL-1.0', 'EPL-2.0'];
        for (const lic of weakList) {
            expect(classifySpdxLicense(lic)).toBe('weak_copyleft');
            expect(isWeakCopyleft(lic)).toBe(true);
            expect(isViralCopyleft(lic)).toBe(false);
            expect(isPermissive(lic)).toBe(false);
        }
    });

    it('identifies viral copyleft licenses (AGPL-3.0, GPL-2.0, GPL-3.0, SSPL-1.0)', () => {
        const viralList = [
            'AGPL-3.0',
            'AGPL-3.0-only',
            'AGPL-3.0-or-later',
            'GPL-2.0',
            'GPL-2.0-only',
            'GPL-2.0+',
            'GPL-3.0',
            'GPL-3.0-only',
            'GPL-3.0-or-later',
            'SSPL-1.0',
            'EUPL-1.2',
        ];
        for (const lic of viralList) {
            expect(classifySpdxLicense(lic)).toBe('viral_copyleft');
            expect(isViralCopyleft(lic)).toBe(true);
            expect(isPermissive(lic)).toBe(false);
        }
    });

    it('classifies unapproved and proprietary licenses', () => {
        expect(classifySpdxLicense('UNLICENSED')).toBe('unapproved');
        expect(classifySpdxLicense('Proprietary')).toBe('unapproved');
        expect(classifySpdxLicense('CC-BY-NC-4.0')).toBe('unapproved');
        expect(classifySpdxLicense('')).toBe('unapproved');
    });

    it('handles compound dual-licensing (OR expressions)', () => {
        // Under OR licensing, licensee can choose the permissive branch
        expect(classifySpdxLicense('MIT OR GPL-3.0')).toBe('permissive');
        expect(isViralCopyleft('MIT OR GPL-3.0')).toBe(false);

        // Weak copyleft OR viral copyleft allows choosing weak copyleft
        expect(classifySpdxLicense('MPL-2.0 OR GPL-3.0')).toBe('weak_copyleft');
    });

    it('handles conjunctive compound licensing (AND expressions)', () => {
        // Under AND licensing, all restrictions apply (viral infects the whole)
        expect(classifySpdxLicense('MIT AND GPL-3.0')).toBe('viral_copyleft');
        expect(isViralCopyleft('MIT AND GPL-3.0')).toBe(true);
    });
});

describe('license-compliance — Compliance Policy Auditing', () => {
    it('audits permissive licenses as compliant under default policy', () => {
        const mitAudit = auditLicenseCompliance('MIT');
        expect(mitAudit.compliant).toBe(true);
        expect(mitAudit.riskLevel).toBe('none');
        expect(mitAudit.category).toBe('permissive');
        expect(mitAudit.isViralCopyleft).toBe(false);
        expect(mitAudit.violations).toHaveLength(0);

        const apacheAudit = auditLicenseCompliance('Apache-2.0');
        expect(apacheAudit.compliant).toBe(true);
        expect(apacheAudit.riskLevel).toBe('none');
    });

    it('flags viral copyleft licenses as critical non-compliant by default', () => {
        const viralLicenses = ['AGPL-3.0', 'GPL-2.0', 'GPL-3.0', 'SSPL-1.0'];
        for (const lic of viralLicenses) {
            const audit = auditLicenseCompliance(lic);
            expect(audit.compliant).toBe(false);
            expect(audit.isViralCopyleft).toBe(true);
            expect(audit.riskLevel).toBe('critical');
            expect(audit.category).toBe('viral_copyleft');
            expect(audit.violations.length).toBeGreaterThan(0);
            expect(audit.remediation).toBeDefined();
        }
    });

    it('flags weak copyleft as medium risk when allowWeakCopyleft is false', () => {
        const audit = auditLicenseCompliance('MPL-2.0', DEFAULT_LICENSE_POLICY);
        expect(audit.compliant).toBe(false);
        expect(audit.category).toBe('weak_copyleft');
        expect(audit.riskLevel).toBe('medium');
    });

    it('approves weak copyleft when policy explicitly permits it', () => {
        const audit = auditLicenseCompliance('LGPL-3.0', {
            allowWeakCopyleft: true,
        });
        expect(audit.compliant).toBe(true);
        expect(audit.category).toBe('weak_copyleft');
        expect(audit.riskLevel).toBe('low');
    });

    it('respects explicit license whitelist overriding category restrictions', () => {
        const audit = auditLicenseCompliance('GPL-3.0', {
            allowedLicenses: ['GPL-3.0'],
        });
        expect(audit.compliant).toBe(true);
        expect(audit.category).toBe('viral_copyleft');
    });

    it('enforces explicit blacklist strictly', () => {
        const audit = auditLicenseCompliance('MIT', {
            blockedLicenses: ['MIT'],
        });
        expect(audit.compliant).toBe(false);
        expect(audit.riskLevel).toBe('critical');
        expect(audit.violations.some((v) => v.includes('blocked by policy'))).toBe(true);
    });

    it('handles empty or missing license input safely', () => {
        const audit = auditLicenseCompliance('');
        expect(audit.compliant).toBe(false);
        expect(audit.category).toBe('unapproved');
        expect(audit.riskLevel).toBe('high');
    });
});
