/**
 * Module: Core Intelligence — Import, Dependency & External Resource Layout
 * File Path: src/core/intelligence/dependencyLayout.ts
 * Architecture Role: Multi-language layout validator and dependency topology analyzer;
 *   enforces canonical file structures, audits deferred imports, and governs external URLs.
 * Dependencies & Triggers: Core types (Issue, SemanticReviewDetail, SemanticEvidenceStep);
 *   invoked by DependencyLayoutAnalyzer.
 * Responsibilities:
 *   1. Enforce language-specific file layout matrices (DEP-ORD-001);
 *   2. Flag unjustified in-function imports while allowing audited exemptions (DEP-LAZ-001);
 *   3. Detect unmanaged hardcoded external URLs and endpoints (DEP-RES-001);
 *   4. Detect wildcard imports (DEP-WLD-001) and inverted dependency references (DEP-INV-001);
 *   5. Audit development-only dependency leakage into production code (DEP-DEV-001);
 *   6. Audit deprecated/unmaintained third-party packages (DEP-OBS-001);
 *   7. Audit unpinned and wildcard dependency versions in project manifests (DEP-PIN-001).
 * Exit Semantics & Design Rationale: Deterministic AST- and line-assisted analysis; returns
 *   structured issues conforming to the Section VII result model.
 */

import * as path from 'path';
import type { Issue, SemanticEvidenceStep } from '../types';
import type { ImportStatementInfo } from './dependencyLayoutHelpers';
import {
    auditFileLayoutOrder,
    auditImportHorizon,
    createDetail,
    pushLayoutIssue,
    findAncestorPackageManifest,
    readJsonSafely,
    extractLicenseFromManifest,
} from './dependencyLayoutHelpers';
import {
    checkKnownPackageVulnerability,
    parsePackageSpecifier,
} from './dependency-vulnerabilities';
import { auditLicenseCompliance } from './license-compliance';
import { checkDeprecatedPackage } from './deprecated-dependencies';
import type { ProjectManifestInventory } from './dependency-provenance';
import { isDevOnlyDependency, isUnpinnedVersion } from './dependency-provenance';

export { categorizeImport, extractExemptionReason } from './dependencyLayoutHelpers';
export type { ImportCategory, ImportStatementInfo } from './dependencyLayoutHelpers';

const SEVERITY_WARNING = 'warning';
const SEVERITY_ERROR = 'error';

const KIND_CALL = 'call';
const KIND_CONDITION = 'condition';
const KIND_VARIABLE = 'variable';

const MODULE_IMPORTS = 'imports';
const MODULE_DEPENDENCIES = 'dependencies';
const MODULE_RESOURCES = 'resources';
const MODULE_SECURITY = 'security';
const MODULE_GOVERNANCE = 'governance';
const MODULE_MAINTENANCE = 'maintenance';

const CATEGORY_STDLIB = 'stdlib';
const CATEGORY_THIRD_PARTY = 'third-party';

const CONFIDENCE_DEFAULT = 0.95;
const CONFIDENCE_HIGH = 1.0;

const LOW_LEVEL_FILE_RE = /(?:^|[/\\])(?:shared|utils|common)(?:[/\\]|$|\.)/i;
const HIGH_LEVEL_IMPORT_RE = /\/(?:domain|app|application)\//i;
const EXTERNAL_URL_RE = /^(?:https?|wss?):\/\//;

/** Descriptor of an external URL or resource reference. */
export interface ExternalResourceRef {
    file: string;
    line: number;
    urlOrPath: string;
    symbol: string;
    isManagedInRegistry: boolean;
}

/** Options controlling dependency and layout review. */
export interface DependencyLayoutOptions {
    enforceFileLayout?: boolean;
    allowAuditedInFunctionImports?: boolean;
    flagUnmanagedResources?: boolean;
    flagWildcards?: boolean;
    lazyImportExemptMarkers?: string[];
    flagPhantomDependencies?: boolean;
    flagVulnerableDependencies?: boolean;
    flagLicenseCompliance?: boolean;
    flagDevOnlyDependencies?: boolean;
    flagDeprecatedDependencies?: boolean;
    flagUnpinnedDependencies?: boolean;
    rootDir?: string;
    manifestDependencies?: Set<string>;
    manifestInventory?: ProjectManifestInventory;
    firstDeclarationLine?: number;
}

interface SingleImportIssueConfig {
    rule: string;
    severity: 'info' | 'warning' | 'error';
    imp: ImportStatementInfo;
    evidenceKind: SemanticEvidenceStep['kind'];
    evidenceDesc: string;
    currentBehavior: string;
    triggerCondition: string;
    risk: string;
    suggestedFix: string;
    verificationMethod: string;
    message: string;
    suggestion: string;
    language: string;
    moduleName?: string;
    confidence?: number;
}

function reportSingleImportIssue(issues: Issue[], config: SingleImportIssueConfig): void {
    const detail = createDetail({
        language: config.language,
        module: config.moduleName ?? MODULE_IMPORTS,
        symbol: config.imp.moduleSpecifier,
        currentBehavior: config.currentBehavior,
        evidence: [
            {
                kind: config.evidenceKind,
                description: config.evidenceDesc,
                file: config.imp.file,
                line: config.imp.line,
            },
        ],
        triggerCondition: config.triggerCondition,
        risk: config.risk,
        suggestedFix: config.suggestedFix,
        verificationMethod: config.verificationMethod,
        file: config.imp.file,
    });
    pushLayoutIssue(issues, {
        rule: config.rule,
        severity: config.severity,
        loc: config.imp,
        message: config.message,
        suggestion: config.suggestion,
        detail,
        confidence: config.confidence,
    });
}

interface RuleFormatPayload {
    evidenceDesc: string;
    currentBehavior: string;
    message: string;
    suggestion: string;
    suggestedFix?: string;
    verificationMethod?: string;
    risk?: string;
    triggerCondition?: string;
}

interface StaticRuleDescriptor {
    readonly rule: string;
    readonly severity: 'info' | 'warning' | 'error';
    readonly moduleName: string;
    readonly evidenceKind: SemanticEvidenceStep['kind'];
    readonly triggerCondition: string;
    readonly risk: string;
    readonly verificationMethod: string;
    readonly suggestedFix?: string;
    readonly confidence?: number;
    readonly defaultFormat?: (imp: ImportStatementInfo) => RuleFormatPayload;
}

const RULE_DESCRIPTOR_MAP: Readonly<Record<string, StaticRuleDescriptor>> = Object.freeze({
    'DEP-LAZ-001': {
        rule: 'DEP-LAZ-001',
        severity: SEVERITY_WARNING,
        moduleName: MODULE_IMPORTS,
        evidenceKind: KIND_CALL,
        triggerCondition: 'Import inside function lacking @lazy/@optional tag',
        risk: 'Hides module coupling and risks hidden circular dependencies.',
        verificationMethod: 'Verify import lives in top-level header or carries exemption tag.',
        suggestedFix: 'Hoist import to top-level, or annotate with exemption.',
        defaultFormat: (imp: ImportStatementInfo) => ({
            evidenceDesc: `In-function import '${imp.rawText}' without audit tag`,
            currentBehavior: `Ad-hoc in-function import '${imp.rawText}' executed at runtime.`,
            message: `Unjustified in-function import '${imp.moduleSpecifier}': hoist or declare exemption.`,
            suggestion: 'Move import to top-level or annotate with @lazy/@optional justification.',
        }),
    },
    'DEP-WLD-001': {
        rule: 'DEP-WLD-001',
        severity: SEVERITY_WARNING,
        moduleName: MODULE_IMPORTS,
        evidenceKind: KIND_CALL,
        triggerCondition: 'Wildcard import used in production source code',
        risk: 'Pollutes local namespace and obscures dependency tracking.',
        verificationMethod: 'Verify named imports replace wildcard.',
        suggestedFix: 'Import only explicitly required named symbols.',
        confidence: CONFIDENCE_HIGH,
        defaultFormat: (imp: ImportStatementInfo) => ({
            evidenceDesc: `Wildcard import: '${imp.rawText}'`,
            currentBehavior: `Importing all symbols from '${imp.moduleSpecifier}' via wildcard.`,
            message: `Wildcard import from '${imp.moduleSpecifier}': prefer explicit named imports.`,
            suggestion: 'Replace wildcard with explicit named symbol imports.',
        }),
    },
    'DEP-INV-001': {
        rule: 'DEP-INV-001',
        severity: SEVERITY_ERROR,
        moduleName: MODULE_DEPENDENCIES,
        evidenceKind: KIND_CONDITION,
        triggerCondition: 'Shared component imports higher-level domain/app module',
        risk: 'Creates inverted dependency cycles, preventing utility reuse.',
        verificationMethod: 'Verify low-level utilities have zero upper-layer dependencies.',
        suggestedFix: 'Invert dependency via dependency injection or relocate logic.',
        defaultFormat: (imp: ImportStatementInfo) => ({
            evidenceDesc: `Low-level file '${imp.file}' imports high-level '${imp.moduleSpecifier}'`,
            currentBehavior: `Low-level component '${imp.file}' inverts dependency by importing '${imp.moduleSpecifier}'.`,
            message: `Inverted dependency: low-level module '${imp.file}' imports high-level '${imp.moduleSpecifier}'.`,
            suggestion: 'Extract shared contract or inject domain dependency from higher level.',
        }),
    },
    'DEP-PHANTOM-001': {
        rule: 'DEP-PHANTOM-001',
        severity: SEVERITY_WARNING,
        moduleName: MODULE_DEPENDENCIES,
        evidenceKind: KIND_CALL,
        triggerCondition:
            'Import of external third-party package not declared in package.json or project manifest',
        risk: 'Phantom dependencies cause non-deterministic builds and CI breakage in clean environments.',
        verificationMethod: 'Verify package is declared in project manifest.',
        confidence: CONFIDENCE_DEFAULT,
    },
    'DEP-LIC-001': {
        rule: 'DEP-LIC-001',
        severity: SEVERITY_WARNING,
        moduleName: MODULE_GOVERNANCE,
        evidenceKind: KIND_CONDITION,
        triggerCondition: 'Proprietary code importing viral copyleft (GPL/AGPL/SSPL) dependency',
        risk: 'Legal and compliance risk: copyleft license requires disclosing proprietary derivative source code.',
        verificationMethod:
            'Verify dependency license is permissive or approved under organizational policy.',
        confidence: CONFIDENCE_DEFAULT,
    },
    'DEP-DEV-001': {
        rule: 'DEP-DEV-001',
        severity: SEVERITY_WARNING,
        moduleName: MODULE_DEPENDENCIES,
        evidenceKind: KIND_CALL,
        triggerCondition: 'Runtime value import of devDependency in production code',
        risk: 'Production builds deployed without devDependencies will crash with missing module errors at runtime.',
        verificationMethod: "Verify package is in dependencies or converted to 'import type'.",
        confidence: CONFIDENCE_DEFAULT,
    },
    'DEP-OBS-001': {
        rule: 'DEP-OBS-001',
        severity: SEVERITY_WARNING,
        moduleName: MODULE_MAINTENANCE,
        evidenceKind: KIND_CALL,
        triggerCondition: 'Deprecated or unmaintained package imported in codebase',
        risk: 'Accumulates technical debt, prevents runtime upgrades, and poses unpatched vulnerability risks.',
        verificationMethod: 'Verify deprecated package is replaced with active alternative.',
        confidence: CONFIDENCE_HIGH,
    },
    'DEP-PIN-001': {
        rule: 'DEP-PIN-001',
        severity: SEVERITY_WARNING,
        moduleName: MODULE_MAINTENANCE,
        evidenceKind: KIND_CALL,
        triggerCondition: 'Unpinned or wildcard dependency version declaration',
        risk: 'Floating versions introduce unpredictable breaking changes and supply chain attack vectors.',
        verificationMethod: 'Verify package in package.json has a pinned exact or caret version.',
        confidence: CONFIDENCE_DEFAULT,
    },
    'DEP-VULN-001': {
        rule: 'DEP-VULN-001',
        severity: SEVERITY_ERROR,
        moduleName: MODULE_SECURITY,
        evidenceKind: KIND_CALL,
        triggerCondition: 'Known security vulnerability detected',
        risk: 'Supply chain security threat: potential backdoor or malicious payload.',
        verificationMethod: 'Verify package is removed, replaced, or upgraded to a safe version.',
        confidence: CONFIDENCE_HIGH,
    },
});

function emitDescribedImportIssue(
    issues: Issue[],
    ruleId: string,
    imp: ImportStatementInfo,
    language: string,
    customPayload?: RuleFormatPayload,
): void {
    const desc = RULE_DESCRIPTOR_MAP[ruleId];
    if (!desc) return;
    const formatted = customPayload || (desc.defaultFormat ? desc.defaultFormat(imp) : null);
    if (!formatted) return;

    reportSingleImportIssue(issues, {
        rule: desc.rule,
        severity: desc.severity,
        imp,
        evidenceKind: desc.evidenceKind,
        evidenceDesc: formatted.evidenceDesc,
        currentBehavior: formatted.currentBehavior,
        triggerCondition: formatted.triggerCondition ?? desc.triggerCondition,
        risk: formatted.risk ?? desc.risk,
        suggestedFix: formatted.suggestedFix ?? desc.suggestedFix ?? '',
        verificationMethod: formatted.verificationMethod ?? desc.verificationMethod,
        message: formatted.message,
        suggestion: formatted.suggestion,
        language,
        moduleName: desc.moduleName,
        confidence: desc.confidence,
    });
}

function auditInFunctionImports(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (!imp.isInsideFunction || imp.hasAuditExemption) continue;
        emitDescribedImportIssue(issues, 'DEP-LAZ-001', imp, language);
    }
}

function auditWildcardImports(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (!imp.isWildcard) continue;
        emitDescribedImportIssue(issues, 'DEP-WLD-001', imp, language);
    }
}

function auditInvertedDependencies(
    imports: ImportStatementInfo[],
    isLowLevelFile: boolean,
    language: string,
    issues: Issue[],
): void {
    if (!isLowLevelFile) return;
    for (const imp of imports) {
        if (!HIGH_LEVEL_IMPORT_RE.test(imp.moduleSpecifier)) continue;
        emitDescribedImportIssue(issues, 'DEP-INV-001', imp, language);
    }
}

function auditExternalResources(
    resources: ExternalResourceRef[],
    language: string,
    issues: Issue[],
): void {
    for (const res of resources) {
        if (res.isManagedInRegistry || !EXTERNAL_URL_RE.test(res.urlOrPath)) continue;
        const detail = createDetail({
            language,
            module: MODULE_RESOURCES,
            symbol: res.symbol,
            currentBehavior: `Raw unmanaged remote endpoint '${res.urlOrPath}' hardcoded.`,
            evidence: [
                {
                    kind: KIND_VARIABLE,
                    description: `Raw external URL '${res.urlOrPath}' embedded directly in code`,
                    file: res.file,
                    line: res.line,
                    symbol: res.symbol,
                },
            ],
            triggerCondition: 'Hardcoded HTTP/WebSocket URL string detected in business code',
            risk: 'Prevents environment-specific routing and rotation.',
            suggestedFix: 'Move remote URLs into configuration or service registry.',
            verificationMethod: 'Verify endpoint is injected via configuration schema.',
            file: res.file,
        });
        pushLayoutIssue(issues, {
            rule: 'DEP-RES-001',
            severity: SEVERITY_WARNING,
            loc: res,
            message: `Unmanaged external URL '${res.urlOrPath}' hardcoded in '${res.symbol}': move to config.`,
            suggestion: 'Externalize endpoint URL to configuration or resource registry.',
            detail,
        });
    }
}

const PKG_KEY_TO_LICENSE_MAP = new Map<string, string | null>();
const PKG_KEY_TO_VERSION_MAP = new Map<string, string | null>();

/** Known host-provided or ambient modules exempt from phantom dependency flags */
const KNOWN_AMBIENT_MODULES: ReadonlySet<string> = new Set(['vscode', 'electron']);

/**
 * Resolves license metadata for an external package across ancestor node_modules directories.
 */
function resolvePackageLicense(rootDir: string, packageName: string): string | null {
    const cacheKey = `${rootDir}::${packageName}`;
    if (PKG_KEY_TO_LICENSE_MAP.has(cacheKey)) {
        return PKG_KEY_TO_LICENSE_MAP.get(cacheKey) ?? null;
    }
    const lic = extractLicenseFromManifest(findAncestorPackageManifest(rootDir, packageName));
    PKG_KEY_TO_LICENSE_MAP.set(cacheKey, lic);
    return lic;
}

/**
 * Resolves installed or declared version for a given package name.
 */
function resolvePackageVersion(rootDir: string | undefined, packageName: string): string | null {
    if (!rootDir) {
        return null;
    }
    const cacheKey = `${rootDir}::${packageName}`;
    if (PKG_KEY_TO_VERSION_MAP.has(cacheKey)) {
        return PKG_KEY_TO_VERSION_MAP.get(cacheKey) ?? null;
    }

    const manifest = findAncestorPackageManifest(rootDir, packageName);
    let ver = typeof manifest?.version === 'string' ? manifest.version : null;
    if (!ver) {
        const rootManifest = readJsonSafely(path.join(rootDir, 'package.json'));
        const declared =
            rootManifest?.dependencies?.[packageName] ||
            rootManifest?.devDependencies?.[packageName] ||
            rootManifest?.optionalDependencies?.[packageName];
        ver = typeof declared === 'string' ? declared : null;
    }

    PKG_KEY_TO_VERSION_MAP.set(cacheKey, ver);
    return ver;
}

/**
 * Normalizes a raw import specifier string to its base package name,
 * correctly handling scoped packages (@scope/pkg) and node: prefixes.
 */
function extractPackageName(specifier: string): string {
    const parsed = parsePackageSpecifier(specifier);
    if (parsed) return parsed.packageName;
    const clean = specifier.trim().replace(/^node:/, '');
    if (clean.startsWith('@')) {
        const parts = clean.split('/');
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : clean;
    }
    return clean.split('/')[0];
}

/**
 * Checks whether an import specifier is a relative path, root path,
 * path alias (~/, @/, #), or engine protocol (res://).
 */
function isExemptPathOrAlias(specifier: string): boolean {
    return (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        specifier.startsWith('@/') ||
        specifier.startsWith('~/') ||
        specifier.startsWith('#') ||
        specifier.startsWith('res://')
    );
}

/**
 * Extracts a unique third-party package name from an import statement,
 * skipping exempt paths/aliases and recording seen packages to prevent duplicates.
 */
function extractUniqueThirdPartyPackage(
    imp: ImportStatementInfo,
    seenPackages: Set<string>,
): string | null {
    if (imp.category !== CATEGORY_THIRD_PARTY || isExemptPathOrAlias(imp.moduleSpecifier)) {
        return null;
    }
    const pkgName = extractPackageName(imp.moduleSpecifier);
    if (!pkgName || seenPackages.has(pkgName)) {
        return null;
    }
    seenPackages.add(pkgName);
    return pkgName;
}

/**
 * Audits third-party dependency imports against known vulnerability
 * databases (CVE/GHSA advisories).
 */
function auditVulnerableDependencies(
    imports: ImportStatementInfo[],
    rootDir: string | undefined,
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (imp.category !== CATEGORY_THIRD_PARTY || isExemptPathOrAlias(imp.moduleSpecifier))
            continue;

        const pkgName = extractPackageName(imp.moduleSpecifier);
        const resolvedVer = resolvePackageVersion(rootDir, pkgName) ?? undefined;

        const vuln = checkKnownPackageVulnerability(imp.moduleSpecifier, resolvedVer, {
            matchAnyVersionIfUnspecified: true,
        });
        if (!vuln) continue;

        emitDescribedImportIssue(issues, 'DEP-VULN-001', imp, language, {
            evidenceDesc: `Compromised package '${vuln.packageName}': ${vuln.title} (${vuln.advisoryId})`,
            currentBehavior: `Import of compromised or backdoored package '${vuln.packageName}'.`,
            triggerCondition: `Known security vulnerability detected: ${vuln.description}`,
            risk: `Supply chain security threat (${vuln.severity}): potential backdoor or malicious payload.`,
            suggestedFix: vuln.recommendation,
            message: `Supply chain security violation: import of compromised package '${vuln.packageName}' (${vuln.advisoryId}): ${vuln.title}.`,
            suggestion: vuln.recommendation,
        });
    }
}

/**
 * Checks whether a third-party package name is declared in manifest
 * dependencies or host ambient modules.
 */
function isManifestDeclaredPackage(pkgName: string, manifestDeps: ReadonlySet<string>): boolean {
    if (KNOWN_AMBIENT_MODULES.has(pkgName) || manifestDeps.has(pkgName)) {
        return true;
    }
    const lower = pkgName.toLowerCase();
    if (manifestDeps.has(lower) || manifestDeps.has(`@types/${pkgName}`)) {
        return true;
    }
    const snake = pkgName.replace(/-/g, '_');
    const kebab = pkgName.replace(/_/g, '-');
    return manifestDeps.has(snake) || manifestDeps.has(kebab);
}

function auditPhantomDependencies(
    imports: ImportStatementInfo[],
    manifestDeps: Set<string>,
    language: string,
    issues: Issue[],
): void {
    if (!manifestDeps || manifestDeps.size === 0) return;
    const seenPhantomPackages = new Set<string>();

    for (const imp of imports) {
        if (imp.category !== CATEGORY_THIRD_PARTY || isExemptPathOrAlias(imp.moduleSpecifier))
            continue;

        const pkgName = extractPackageName(imp.moduleSpecifier);
        if (!pkgName || seenPhantomPackages.has(pkgName)) continue;
        seenPhantomPackages.add(pkgName);

        if (isManifestDeclaredPackage(pkgName, manifestDeps)) {
            continue;
        }

        emitDescribedImportIssue(issues, 'DEP-PHANTOM-001', imp, language, {
            evidenceDesc: `Undeclared external package '${pkgName}' imported without manifest declaration`,
            currentBehavior: `External package '${pkgName}' imported in '${imp.file}' but missing from project manifests.`,
            suggestedFix: `Add '${pkgName}' to dependencies/devDependencies in package.json, or replace with local module.`,
            message: `Phantom dependency: '${pkgName}' is imported in '${imp.file}' but not declared in project manifest.`,
            suggestion: `Add '${pkgName}' to dependencies in package.json or project manifest.`,
        });
    }
}

interface LicenseAuditContext {
    rootDir: string;
    language: string;
    seenPackages: Set<string>;
    issues: Issue[];
}

/**
 * Audits a single import against legal license compliance and copyleft propagation risks.
 */
function checkSingleLicenseViolation(imp: ImportStatementInfo, ctx: LicenseAuditContext): void {
    const pkgName = extractUniqueThirdPartyPackage(imp, ctx.seenPackages);
    if (!pkgName) {
        return;
    }

    const lic = resolvePackageLicense(ctx.rootDir, pkgName);
    if (!lic) {
        return;
    }

    const audit = auditLicenseCompliance(lic);
    if (!audit.isViralCopyleft && audit.compliant) {
        return;
    }

    const remediation =
        audit.remediation ||
        `Replace '${pkgName}' with a permissively licensed alternative (MIT/Apache-2.0).`;

    emitDescribedImportIssue(ctx.issues, 'DEP-LIC-001', imp, ctx.language, {
        evidenceDesc: `External dependency '${pkgName}' carries restrictive/copyleft license '${lic}'`,
        currentBehavior: `Dependency '${pkgName}' is governed by '${lic}' which imposes copyleft distribution obligations.`,
        suggestedFix: remediation,
        message: `License compliance violation: dependency '${pkgName}' uses restrictive copyleft license '${lic}'.`,
        suggestion: remediation,
    });
}

function auditDependencyLicenses(
    imports: ImportStatementInfo[],
    rootDir: string,
    language: string,
    issues: Issue[],
): void {
    if (!rootDir) return;
    const seenLicensePackages = new Set<string>();
    const ctx: LicenseAuditContext = {
        rootDir,
        language,
        seenPackages: seenLicensePackages,
        issues,
    };

    for (const imp of imports) {
        checkSingleLicenseViolation(imp, ctx);
    }
}

const TEST_OR_TOOLING_PATTERN =
    /(?:^|[/\\])(?:tests?|fixtures?|mocks?|scripts?|benchmarks?|sample|tooling)(?:[/\\]|$)|(?:\.test|\.spec)\.[a-z0-9]+$/i;

/**
 * Returns true if the given file path matches test, fixture, mock,
 * benchmark, or tooling conventions.
 */
function isTestOrToolingFile(filePath: string): boolean {
    return TEST_OR_TOOLING_PATTERN.test(filePath.replace(/\\/g, '/'));
}

interface DevDepsAuditContext {
    inventory: ProjectManifestInventory | undefined;
    filePath: string;
    language: string;
    issues: Issue[];
}

/**
 * Audits runtime production code imports to ensure development-only dependencies
 * are not leaked into production runtime paths (DEP-DEV-001).
 */
function auditDevelopmentDependencies(
    imports: ImportStatementInfo[],
    ctx: DevDepsAuditContext,
): void {
    if (!ctx.inventory || isTestOrToolingFile(ctx.filePath)) {
        return;
    }

    const seenDevPackages = new Set<string>();

    for (const imp of imports) {
        // Type-only imports do not emit runtime dependencies and are exempted
        if (/^\s*import\s+type\b/.test(imp.rawText)) {
            continue;
        }

        const pkgName = extractUniqueThirdPartyPackage(imp, seenDevPackages);
        if (!pkgName) continue;

        if (isDevOnlyDependency(pkgName, ctx.inventory)) {
            emitDescribedImportIssue(ctx.issues, 'DEP-DEV-001', imp, ctx.language, {
                evidenceDesc: `Development-only package '${pkgName}' imported in production code`,
                currentBehavior: `Package '${pkgName}' is declared in devDependencies but imported at runtime in production file '${imp.file}'.`,
                suggestedFix: `Move '${pkgName}' to dependencies in package.json, or switch to 'import type' if used solely for type annotations.`,
                message: `Dev-only dependency leakage: '${pkgName}' is declared in devDependencies but imported in production file '${imp.file}'.`,
                suggestion: `Move '${pkgName}' to dependencies in package.json, or convert import to 'import type'.`,
            });
        }
    }
}

/**
 * Audits a single import statement for deprecated package usage.
 */
function auditSingleDeprecatedImport(
    imp: ImportStatementInfo,
    language: string,
    seenPackages: Set<string>,
    issues: Issue[],
): void {
    if (imp.category !== CATEGORY_THIRD_PARTY && imp.category !== CATEGORY_STDLIB) {
        return;
    }
    if (isExemptPathOrAlias(imp.moduleSpecifier)) {
        return;
    }

    const pkgName = extractPackageName(imp.moduleSpecifier);
    if (!pkgName || seenPackages.has(pkgName)) {
        return;
    }
    seenPackages.add(pkgName);

    const dotIdx = pkgName.indexOf('.');
    let deprecatedInfo = checkDeprecatedPackage(pkgName);
    if (!deprecatedInfo && dotIdx !== -1) {
        deprecatedInfo = checkDeprecatedPackage(pkgName.slice(0, dotIdx));
    }
    if (!deprecatedInfo) {
        return;
    }

    const targetPkg = deprecatedInfo.packageName;
    emitDescribedImportIssue(issues, 'DEP-OBS-001', imp, language, {
        evidenceDesc: `Deprecated package '${targetPkg}' imported: ${deprecatedInfo.reason}`,
        currentBehavior: `Importing deprecated package '${targetPkg}'. Recommended modern replacement: ${deprecatedInfo.replacement}.`,
        suggestedFix: deprecatedInfo.remediation,
        message: `Deprecated dependency: '${targetPkg}' is deprecated (${deprecatedInfo.reason}). Prefer ${deprecatedInfo.replacement}.`,
        suggestion: deprecatedInfo.remediation,
    });
}

function auditDeprecatedDependencies(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    const seenDeprecatedPackages = new Set<string>();
    for (const imp of imports) {
        auditSingleDeprecatedImport(imp, language, seenDeprecatedPackages, issues);
    }
}

interface UnpinnedAuditContext {
    inventory: ProjectManifestInventory;
    language: string;
    seenPackages: Set<string>;
    issues: Issue[];
}

/**
 * Audits a single import statement for unpinned or wildcard version constraints in manifests.
 */
function auditSingleUnpinnedImport(imp: ImportStatementInfo, ctx: UnpinnedAuditContext): void {
    const pkgName = extractUniqueThirdPartyPackage(imp, ctx.seenPackages);
    if (!pkgName) {
        return;
    }

    const normPkg = pkgName.toLowerCase();
    const ver =
        ctx.inventory.versionSpecs?.get(pkgName) || ctx.inventory.versionSpecs?.get(normPkg);
    if (!ver || !isUnpinnedVersion(ver)) {
        return;
    }

    emitDescribedImportIssue(ctx.issues, 'DEP-PIN-001', imp, ctx.language, {
        evidenceDesc: `Unpinned/wildcard version '${ver}' declared for package '${pkgName}' in manifest`,
        currentBehavior: `Package '${pkgName}' has unpinned version requirement '${ver}' in project manifest.`,
        suggestedFix: `Pin '${pkgName}' to an exact or semver-caret range (e.g. ^1.2.3) in project manifest.`,
        verificationMethod: `Verify '${pkgName}' is pinned to a concrete version in manifest.`,
        message: `Unpinned dependency version: '${pkgName}' uses '${ver}'. Pin to exact or semver-caret range.`,
        suggestion: `Pin '${pkgName}' to an exact or semver-caret range in project manifest.`,
    });
}

function auditUnpinnedDependencies(
    imports: ImportStatementInfo[],
    inventory: ProjectManifestInventory | undefined,
    language: string,
    issues: Issue[],
): void {
    if (!inventory?.versionSpecs || inventory.versionSpecs.size === 0) {
        return;
    }

    const seenUnpinnedPackages = new Set<string>();
    const ctx: UnpinnedAuditContext = {
        inventory,
        language,
        seenPackages: seenUnpinnedPackages,
        issues,
    };
    for (const imp of imports) {
        auditSingleUnpinnedImport(imp, ctx);
    }
}

interface SyntaxLayoutContext {
    imports: ImportStatementInfo[];
    resources: ExternalResourceRef[];
    language: string;
    options: DependencyLayoutOptions;
}

/**
 * Executes syntactic and topological file layout audit passes.
 */
function auditSyntaxLayoutPasses(ctx: SyntaxLayoutContext, issues: Issue[]): void {
    auditInFunctionImports(ctx.imports, ctx.language, issues);
    if (ctx.options.flagWildcards ?? true) {
        auditWildcardImports(ctx.imports, ctx.language, issues);
    }
    const firstFile = ctx.imports[0]?.file ?? '';
    const isLowLevel = LOW_LEVEL_FILE_RE.test(firstFile);
    auditInvertedDependencies(ctx.imports, isLowLevel, ctx.language, issues);
    if (ctx.options.enforceFileLayout ?? true) {
        auditFileLayoutOrder(ctx.imports, ctx.language, issues);
        auditImportHorizon(ctx.imports, ctx.options.firstDeclarationLine, ctx.language, issues);
    }
    if (ctx.options.flagUnmanagedResources ?? true) {
        auditExternalResources(ctx.resources, ctx.language, issues);
    }
}

interface SemanticLayoutContext {
    imports: ImportStatementInfo[];
    firstFile: string;
    language: string;
    options: DependencyLayoutOptions;
}

/**
 * Executes supply chain, licensing, and package manifest semantic audit passes.
 */
function auditSemanticLayoutPasses(ctx: SemanticLayoutContext, issues: Issue[]): void {
    if (ctx.options.flagVulnerableDependencies ?? true) {
        auditVulnerableDependencies(ctx.imports, ctx.options.rootDir, ctx.language, issues);
    }
    if ((ctx.options.flagPhantomDependencies ?? true) && ctx.options.manifestDependencies) {
        auditPhantomDependencies(
            ctx.imports,
            ctx.options.manifestDependencies,
            ctx.language,
            issues,
        );
    }
    if ((ctx.options.flagLicenseCompliance ?? true) && ctx.options.rootDir) {
        auditDependencyLicenses(ctx.imports, ctx.options.rootDir, ctx.language, issues);
    }
    if ((ctx.options.flagDevOnlyDependencies ?? true) && ctx.options.manifestInventory) {
        auditDevelopmentDependencies(ctx.imports, {
            inventory: ctx.options.manifestInventory,
            filePath: ctx.firstFile,
            language: ctx.language,
            issues,
        });
    }
    if (ctx.options.flagDeprecatedDependencies ?? true) {
        auditDeprecatedDependencies(ctx.imports, ctx.language, issues);
    }
    if ((ctx.options.flagUnpinnedDependencies ?? true) && ctx.options.manifestInventory) {
        auditUnpinnedDependencies(ctx.imports, ctx.options.manifestInventory, ctx.language, issues);
    }
}

/**
 * Analyze imports and external resource references across a file.
 *
 * @param imports - Collected import statements.
 * @param resources - Discovered external URL/resource strings.
 * @param language - Programming language of the target file.
 * @param options - Tunable layout options.
 * @returns Array of issues strictly following Section VII schema.
 */
export function analyzeDependencyLayout(
    imports: ImportStatementInfo[],
    resources: ExternalResourceRef[] = [],
    language: string,
    options: DependencyLayoutOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    auditSyntaxLayoutPasses({ imports, resources, language, options }, issues);
    const firstFile = imports[0]?.file ?? '';
    auditSemanticLayoutPasses({ imports, firstFile, language, options }, issues);
    return issues;
}
