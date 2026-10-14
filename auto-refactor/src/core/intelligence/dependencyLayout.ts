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

import * as fs from 'fs';
import * as path from 'path';
import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';
import type { ImportCategory, ImportStatementInfo } from './dependencyLayoutHelpers';
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

const RULE_VERSION = '1.0.0';
const CONFIG_VERSION = '0.3.0';
const ANALYZER_ID = 'dependency-layout';
const DOMAIN_ID = 'dependency-layout';
const END_COLUMN = 80;

const SEVERITY_WARNING = 'warning';
const SEVERITY_ERROR = 'error';
const SEVERITY_INFO = 'info';

const KIND_CALL = 'call';
const KIND_CONDITION = 'condition';
const KIND_VARIABLE = 'variable';

const MODULE_IMPORTS = 'imports';
const MODULE_DEPENDENCIES = 'dependencies';
const MODULE_LAYOUT = 'layout';
const MODULE_RESOURCES = 'resources';
const MODULE_SECURITY = 'security';
const MODULE_GOVERNANCE = 'governance';
const MODULE_MAINTENANCE = 'maintenance';

const CATEGORY_STDLIB = 'stdlib';
const CATEGORY_THIRD_PARTY = 'third-party';
const CATEGORY_INTERNAL_SHARED = 'internal-shared';
const CATEGORY_LOCAL = 'local';

const PRIORITY_STDLIB = 1;
const PRIORITY_THIRD_PARTY = 2;
const PRIORITY_INTERNAL_SHARED = 3;
const PRIORITY_LOCAL = 4;

const MAX_ANCESTOR_SEARCH_DEPTH = 3;
const CONFIDENCE_DEFAULT = 0.95;
const CONFIDENCE_HIGH = 1.0;
const CONFIDENCE_RELAXED = 0.9;

const LOW_LEVEL_FILE_RE = /(?:^|[/\\])(?:shared|utils|common)(?:[/\\]|$|\.)/i;
const HIGH_LEVEL_IMPORT_RE = /\/(?:domain|app|application)\//i;
const EXTERNAL_URL_RE = /^(?:https?|wss?):\/\//;

const CATEGORY_PRIORITY: Record<ImportCategory, number> = Object.freeze({
    [CATEGORY_STDLIB]: PRIORITY_STDLIB,
    [CATEGORY_THIRD_PARTY]: PRIORITY_THIRD_PARTY,
    [CATEGORY_INTERNAL_SHARED]: PRIORITY_INTERNAL_SHARED,
    [CATEGORY_LOCAL]: PRIORITY_LOCAL,
});

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
}

interface DetailParams {
    language: string;
    module: string;
    symbol: string;
    currentBehavior: string;
    evidence: SemanticEvidenceStep[];
    triggerCondition: string;
    risk: string;
    suggestedFix: string;
    verificationMethod: string;
    file: string;
    canAutofix?: boolean;
}

function createDetail(params: DetailParams): SemanticReviewDetail {
    return {
        language: params.language,
        module: params.module,
        symbol: params.symbol,
        codeDomain: DOMAIN_ID,
        currentBehavior: params.currentBehavior,
        semanticEvidenceChain: params.evidence,
        triggerCondition: params.triggerCondition,
        risk: params.risk,
        blastRadius: [params.file],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: params.suggestedFix,
        impactedCallers: [],
        impactedTests: [],
        verificationMethod: params.verificationMethod,
        ruleVersion: RULE_VERSION,
        configVersion: CONFIG_VERSION,
        canAutofix: params.canAutofix ?? false,
    };
}

interface StepContext {
    kind: SemanticEvidenceStep['kind'];
    description: string;
    file: string;
    line: number;
    symbol?: string;
}

function buildSingleStep(ctx: StepContext): SemanticEvidenceStep[] {
    return [{ kind: ctx.kind, description: ctx.description, file: ctx.file, line: ctx.line, symbol: ctx.symbol }];
}

interface LayoutIssuePayload {
    rule: string;
    severity: 'info' | 'warning' | 'error';
    loc: { file: string; line: number };
    message: string;
    suggestion: string;
    detail: SemanticReviewDetail;
    confidence?: number;
}

function pushLayoutIssue(issues: Issue[], payload: LayoutIssuePayload): void {
    const confidence = payload.confidence ?? CONFIDENCE_DEFAULT;
    issues.push({
        id: `${ANALYZER_ID}:${payload.rule}:${payload.loc.file}:${payload.loc.line}`,
        analyzer: ANALYZER_ID,
        rule: payload.rule,
        severity: payload.severity,
        message: payload.message,
        location: {
            file: payload.loc.file,
            start: { line: payload.loc.line, column: 1 },
            end: { line: payload.loc.line, column: END_COLUMN },
        },
        detail: payload.detail,
        suggestion: payload.suggestion,
        evidence: { confidence, requiresRuntime: false },
    });
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
    const evidence = buildSingleStep({
        kind: config.evidenceKind,
        description: config.evidenceDesc,
        file: config.imp.file,
        line: config.imp.line,
    });
    const detail = createDetail({
        language: config.language,
        module: config.moduleName ?? MODULE_IMPORTS,
        symbol: config.imp.moduleSpecifier,
        currentBehavior: config.currentBehavior,
        evidence,
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

function auditInFunctionImports(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (!imp.isInsideFunction || imp.hasAuditExemption) continue;
        reportSingleImportIssue(issues, {
            rule: 'DEP-LAZ-001',
            severity: SEVERITY_WARNING,
            imp,
            evidenceKind: KIND_CALL,
            evidenceDesc: `In-function import '${imp.rawText}' without audit tag`,
            currentBehavior: `Ad-hoc in-function import '${imp.rawText}' executed at runtime.`,
            triggerCondition: 'Import inside function lacking @lazy/@optional tag',
            risk: 'Hides module coupling and risks hidden circular dependencies.',
            suggestedFix: 'Hoist import to top-level, or annotate with exemption.',
            verificationMethod: 'Verify import lives in top-level header or carries exemption tag.',
            message: `Unjustified in-function import '${imp.moduleSpecifier}': hoist or declare exemption.`,
            suggestion: 'Move import to top-level or annotate with @lazy/@optional justification.',
            language,
        });
    }
}

function auditWildcardImports(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (!imp.isWildcard) continue;
        reportSingleImportIssue(issues, {
            rule: 'DEP-WLD-001',
            severity: SEVERITY_WARNING,
            imp,
            evidenceKind: KIND_CALL,
            evidenceDesc: `Wildcard import: '${imp.rawText}'`,
            currentBehavior: `Importing all symbols from '${imp.moduleSpecifier}' via wildcard.`,
            triggerCondition: 'Wildcard import used in production source code',
            risk: 'Pollutes local namespace and obscures dependency tracking.',
            suggestedFix: 'Import only explicitly required named symbols.',
            verificationMethod: 'Verify named imports replace wildcard.',
            message: `Wildcard import from '${imp.moduleSpecifier}': prefer explicit named imports.`,
            suggestion: 'Replace wildcard with explicit named symbol imports.',
            language,
            moduleName: MODULE_IMPORTS,
            confidence: CONFIDENCE_HIGH,
        });
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
        reportSingleImportIssue(issues, {
            rule: 'DEP-INV-001',
            severity: SEVERITY_ERROR,
            imp,
            evidenceKind: KIND_CONDITION,
            evidenceDesc: `Low-level file '${imp.file}' imports high-level '${imp.moduleSpecifier}'`,
            currentBehavior: `Low-level component '${imp.file}' inverts dependency by importing '${imp.moduleSpecifier}'.`,
            triggerCondition: 'Shared component imports higher-level domain/app module',
            risk: 'Creates inverted dependency cycles, preventing utility reuse.',
            suggestedFix: 'Invert dependency via dependency injection or relocate logic.',
            verificationMethod: 'Verify low-level utilities have zero upper-layer dependencies.',
            message: `Inverted dependency: low-level module '${imp.file}' imports high-level '${imp.moduleSpecifier}'.`,
            suggestion: 'Extract shared contract or inject domain dependency from higher level.',
            language,
            moduleName: MODULE_DEPENDENCIES,
        });
    }
}

function auditFileLayoutOrder(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    if (imports.length <= 1) return;
    const topLevel = imports.filter((imp) => !imp.isInsideFunction);
    for (let i = 0; i < topLevel.length - 1; i++) {
        const currentImport = topLevel[i];
        const nextImport = topLevel[i + 1];
        if (CATEGORY_PRIORITY[currentImport.category] <= CATEGORY_PRIORITY[nextImport.category]) continue;
        const evidence = buildSingleStep({
            kind: KIND_CONDITION,
            description: `'${currentImport.moduleSpecifier}' (${currentImport.category}) precedes '${nextImport.moduleSpecifier}' (${nextImport.category})`,
            file: currentImport.file,
            line: nextImport.line,
        });
        const detail = createDetail({
            language,
            module: MODULE_LAYOUT,
            symbol: nextImport.moduleSpecifier,
            currentBehavior: `Import ordering inversion: '${currentImport.category}' placed before '${nextImport.category}'.`,
            evidence,
            triggerCondition: 'Import group order does not follow canonical sequence',
            risk: 'Violates repository layout conventions.',
            suggestedFix: 'Reorder imports: standard library first, third-party, then local.',
            verificationMethod: 'Verify import groups follow canonical ordering.',
            file: currentImport.file,
            canAutofix: true,
        });
        pushLayoutIssue(issues, {
            rule: 'DEP-ORD-001',
            severity: SEVERITY_INFO,
            loc: nextImport,
            message: `Import layout order violation: '${nextImport.moduleSpecifier}' should precede '${currentImport.category}'.`,
            suggestion: 'Sort import groups into Stdlib -> ThirdParty -> InternalShared -> Local.',
            detail,
            confidence: CONFIDENCE_RELAXED,
        });
        break;
    }
}

function auditExternalResources(
    resources: ExternalResourceRef[],
    language: string,
    issues: Issue[],
): void {
    for (const res of resources) {
        if (res.isManagedInRegistry || !EXTERNAL_URL_RE.test(res.urlOrPath)) continue;
        const evidence = buildSingleStep({
            kind: KIND_VARIABLE,
            description: `Raw external URL '${res.urlOrPath}' embedded directly in code`,
            file: res.file,
            line: res.line,
            symbol: res.symbol,
        });
        const detail = createDetail({
            language,
            module: MODULE_RESOURCES,
            symbol: res.symbol,
            currentBehavior: `Raw unmanaged remote endpoint '${res.urlOrPath}' hardcoded.`,
            evidence,
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

function extractLicenseFromPackageJson(pkgJsonPath: string): string | null {
    if (!fs.existsSync(pkgJsonPath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(pkgJsonPath, 'utf8');
        const parsedPkgJson = JSON.parse(raw);
        if (typeof parsedPkgJson.license === 'string') {
            return parsedPkgJson.license;
        }
        if (typeof parsedPkgJson.license === 'object' && parsedPkgJson.license?.type) {
            return parsedPkgJson.license.type;
        }
        if (Array.isArray(parsedPkgJson.licenses) && parsedPkgJson.licenses[0]?.type) {
            return parsedPkgJson.licenses[0].type;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Resolves license metadata for an external package across ancestor node_modules directories.
 */
function resolvePackageLicense(rootDir: string, packageName: string): string | null {
    const cacheKey = `${rootDir}::${packageName}`;
    if (PKG_KEY_TO_LICENSE_MAP.has(cacheKey)) {
        return PKG_KEY_TO_LICENSE_MAP.get(cacheKey) ?? null;
    }
    let currentDir = rootDir;
    for (let i = 0; i < MAX_ANCESTOR_SEARCH_DEPTH; i++) {
        const pkgJsonPath = path.join(currentDir, 'node_modules', packageName, 'package.json');
        const lic = extractLicenseFromPackageJson(pkgJsonPath);
        if (lic) {
            PKG_KEY_TO_LICENSE_MAP.set(cacheKey, lic);
            return lic;
        }
        const parent = path.dirname(currentDir);
        if (parent === currentDir) {
            break;
        }
        currentDir = parent;
    }
    PKG_KEY_TO_LICENSE_MAP.set(cacheKey, null);
    return null;
}

/**
 * Safely extracts package version string from a package.json file.
 */
function extractVersionFromPackageJson(pkgJsonPath: string): string | null {
    if (!fs.existsSync(pkgJsonPath)) {
        return null;
    }
    try {
        const parsedVersionJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        return typeof parsedVersionJson.version === 'string' ? parsedVersionJson.version : null;
    } catch {
        return null;
    }
}

/**
 * Resolves package version declaration from root package.json manifests.
 */
function resolveVersionFromRootManifest(rootDir: string, packageName: string): string | null {
    const rootPkg = path.join(rootDir, 'package.json');
    if (!fs.existsSync(rootPkg)) {
        return null;
    }
    try {
        const manifestData = JSON.parse(fs.readFileSync(rootPkg, 'utf8'));
        const ver =
            manifestData.dependencies?.[packageName] ||
            manifestData.devDependencies?.[packageName] ||
            manifestData.optionalDependencies?.[packageName];
        return typeof ver === 'string' ? ver : null;
    } catch {
        return null;
    }
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

    // 1. Try node_modules/<packageName>/package.json (up to 3 levels)
    let currentDir = rootDir;
    for (let i = 0; i < MAX_ANCESTOR_SEARCH_DEPTH; i++) {
        const pkgJsonPath = path.join(currentDir, 'node_modules', packageName, 'package.json');
        const ver = extractVersionFromPackageJson(pkgJsonPath);
        if (ver) {
            PKG_KEY_TO_VERSION_MAP.set(cacheKey, ver);
            return ver;
        }
        const parent = path.dirname(currentDir);
        if (parent === currentDir) {
            break;
        }
        currentDir = parent;
    }

    // 2. Try root package.json declared dependencies
    const manifestVer = resolveVersionFromRootManifest(rootDir, packageName);
    if (manifestVer) {
        PKG_KEY_TO_VERSION_MAP.set(cacheKey, manifestVer);
        return manifestVer;
    }

    PKG_KEY_TO_VERSION_MAP.set(cacheKey, null);
    return null;
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
        if (imp.category !== CATEGORY_THIRD_PARTY) continue;
        if (isExemptPathOrAlias(imp.moduleSpecifier)) continue;

        const pkgName = extractPackageName(imp.moduleSpecifier);
        const resolvedVer = resolvePackageVersion(rootDir, pkgName) ?? undefined;

        const vuln = checkKnownPackageVulnerability(imp.moduleSpecifier, resolvedVer, {
            matchAnyVersionIfUnspecified: true,
        });
        if (!vuln) continue;

        reportSingleImportIssue(issues, {
            rule: 'DEP-VULN-001',
            severity: SEVERITY_ERROR,
            imp,
            evidenceKind: KIND_CALL,
            evidenceDesc: `Compromised package '${vuln.packageName}': ${vuln.title} (${vuln.advisoryId})`,
            currentBehavior: `Import of compromised or backdoored package '${vuln.packageName}'.`,
            triggerCondition: `Known security vulnerability detected: ${vuln.description}`,
            risk: `Supply chain security threat (${vuln.severity}): potential backdoor or malicious payload.`,
            suggestedFix: vuln.recommendation,
            verificationMethod: 'Verify package is removed, replaced, or upgraded to a safe version.',
            message: `Supply chain security violation: import of compromised package '${vuln.packageName}' (${vuln.advisoryId}): ${vuln.title}.`,
            suggestion: vuln.recommendation,
            language,
            moduleName: MODULE_SECURITY,
            confidence: CONFIDENCE_HIGH,
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
        if (imp.category !== CATEGORY_THIRD_PARTY) continue;
        if (isExemptPathOrAlias(imp.moduleSpecifier)) continue;

        const pkgName = extractPackageName(imp.moduleSpecifier);
        if (!pkgName || seenPhantomPackages.has(pkgName)) continue;
        seenPhantomPackages.add(pkgName);

        if (isManifestDeclaredPackage(pkgName, manifestDeps)) {
            continue;
        }

        reportSingleImportIssue(issues, {
            rule: 'DEP-PHANTOM-001',
            severity: SEVERITY_WARNING,
            imp,
            evidenceKind: KIND_CALL,
            evidenceDesc: `Undeclared external package '${pkgName}' imported without manifest declaration`,
            currentBehavior: `External package '${pkgName}' imported in '${imp.file}' but missing from project manifests.`,
            triggerCondition: 'Import of external third-party package not declared in package.json or project manifest',
            risk: 'Phantom dependencies cause non-deterministic builds and CI breakage in clean environments.',
            suggestedFix: `Add '${pkgName}' to dependencies/devDependencies in package.json, or replace with local module.`,
            verificationMethod: `Verify '${pkgName}' is declared in project manifest.`,
            message: `Phantom dependency: '${pkgName}' is imported in '${imp.file}' but not declared in project manifest.`,
            suggestion: `Add '${pkgName}' to dependencies in package.json or project manifest.`,
            language,
            moduleName: MODULE_DEPENDENCIES,
            confidence: CONFIDENCE_DEFAULT,
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
function checkSingleLicenseViolation(
    imp: ImportStatementInfo,
    ctx: LicenseAuditContext,
): void {
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

    reportSingleImportIssue(ctx.issues, {
        rule: 'DEP-LIC-001',
        severity: SEVERITY_WARNING,
        imp,
        evidenceKind: KIND_CONDITION,
        evidenceDesc: `External dependency '${pkgName}' carries restrictive/copyleft license '${lic}'`,
        currentBehavior: `Dependency '${pkgName}' is governed by '${lic}' which imposes copyleft distribution obligations.`,
        triggerCondition: 'Proprietary code importing viral copyleft (GPL/AGPL/SSPL) dependency',
        risk: 'Legal and compliance risk: copyleft license requires disclosing proprietary derivative source code.',
        suggestedFix:
            audit.remediation ||
            `Replace '${pkgName}' with a permissively licensed alternative (MIT/Apache-2.0).`,
        verificationMethod: 'Verify dependency license is permissive or approved under organizational policy.',
        message: `License compliance violation: dependency '${pkgName}' uses restrictive copyleft license '${lic}'.`,
        suggestion:
            audit.remediation ||
            `Replace '${pkgName}' with a permissively licensed alternative (MIT/Apache-2.0).`,
        language: ctx.language,
        moduleName: MODULE_GOVERNANCE,
        confidence: CONFIDENCE_DEFAULT,
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
    const ctx: LicenseAuditContext = { rootDir, language, seenPackages: seenLicensePackages, issues };

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
            reportSingleImportIssue(ctx.issues, {
                rule: 'DEP-DEV-001',
                severity: SEVERITY_WARNING,
                imp,
                evidenceKind: KIND_CALL,
                evidenceDesc: `Development-only package '${pkgName}' imported in production code`,
                currentBehavior: `Package '${pkgName}' is declared in devDependencies but imported at runtime in production file '${imp.file}'.`,
                triggerCondition: 'Runtime value import of devDependency in production code',
                risk: 'Production builds deployed without devDependencies will crash with missing module errors at runtime.',
                suggestedFix: `Move '${pkgName}' to dependencies in package.json, or switch to 'import type' if used solely for type annotations.`,
                verificationMethod: `Verify '${pkgName}' is in dependencies or converted to 'import type'.`,
                message: `Dev-only dependency leakage: '${pkgName}' is declared in devDependencies but imported in production file '${imp.file}'.`,
                suggestion: `Move '${pkgName}' to dependencies in package.json, or convert import to 'import type'.`,
                language: ctx.language,
                moduleName: MODULE_DEPENDENCIES,
                confidence: CONFIDENCE_DEFAULT,
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
    reportSingleImportIssue(issues, {
        rule: 'DEP-OBS-001',
        severity: SEVERITY_WARNING,
        imp,
        evidenceKind: KIND_CALL,
        evidenceDesc: `Deprecated package '${targetPkg}' imported: ${deprecatedInfo.reason}`,
        currentBehavior: `Importing deprecated package '${targetPkg}'. Recommended modern replacement: ${deprecatedInfo.replacement}.`,
        triggerCondition: 'Deprecated or unmaintained package imported in codebase',
        risk: 'Accumulates technical debt, prevents runtime upgrades, and poses unpatched vulnerability risks.',
        suggestedFix: deprecatedInfo.remediation,
        verificationMethod: `Verify '${targetPkg}' is replaced with ${deprecatedInfo.replacement}.`,
        message: `Deprecated dependency: '${targetPkg}' is deprecated (${deprecatedInfo.reason}). Prefer ${deprecatedInfo.replacement}.`,
        suggestion: deprecatedInfo.remediation,
        language,
        moduleName: MODULE_MAINTENANCE,
        confidence: CONFIDENCE_HIGH,
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
function auditSingleUnpinnedImport(
    imp: ImportStatementInfo,
    ctx: UnpinnedAuditContext,
): void {
    const pkgName = extractUniqueThirdPartyPackage(imp, ctx.seenPackages);
    if (!pkgName) {
        return;
    }

    const normPkg = pkgName.toLowerCase();
    const ver = ctx.inventory.versionSpecs?.get(pkgName) || ctx.inventory.versionSpecs?.get(normPkg);
    if (!ver || !isUnpinnedVersion(ver)) {
        return;
    }

    reportSingleImportIssue(ctx.issues, {
        rule: 'DEP-PIN-001',
        severity: SEVERITY_WARNING,
        imp,
        evidenceKind: KIND_CALL,
        evidenceDesc: `Unpinned/wildcard version '${ver}' declared for package '${pkgName}' in manifest`,
        currentBehavior: `Package '${pkgName}' has unpinned version requirement '${ver}' in project manifest.`,
        triggerCondition: 'Unpinned or wildcard dependency version declaration',
        risk: 'Floating versions introduce unpredictable breaking changes and supply chain attack vectors.',
        suggestedFix: `Pin '${pkgName}' to an exact or semver-caret range (e.g. ^1.2.3) in project manifest.`,
        verificationMethod: `Verify '${pkgName}' is pinned to a concrete version in manifest.`,
        message: `Unpinned dependency version: '${pkgName}' uses '${ver}'. Pin to exact or semver-caret range.`,
        suggestion: `Pin '${pkgName}' to an exact or semver-caret range in project manifest.`,
        language: ctx.language,
        moduleName: MODULE_DEPENDENCIES,
        confidence: CONFIDENCE_DEFAULT,
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
    const ctx: UnpinnedAuditContext = { inventory, language, seenPackages: seenUnpinnedPackages, issues };
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
function auditSyntaxLayoutPasses(
    ctx: SyntaxLayoutContext,
    issues: Issue[],
): void {
    auditInFunctionImports(ctx.imports, ctx.language, issues);
    if (ctx.options.flagWildcards ?? true) {
        auditWildcardImports(ctx.imports, ctx.language, issues);
    }
    const firstFile = ctx.imports[0]?.file ?? '';
    const isLowLevel = LOW_LEVEL_FILE_RE.test(firstFile);
    auditInvertedDependencies(ctx.imports, isLowLevel, ctx.language, issues);
    if (ctx.options.enforceFileLayout ?? true) {
        auditFileLayoutOrder(ctx.imports, ctx.language, issues);
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
function auditSemanticLayoutPasses(
    ctx: SemanticLayoutContext,
    issues: Issue[],
): void {
    if (ctx.options.flagVulnerableDependencies ?? true) {
        auditVulnerableDependencies(ctx.imports, ctx.options.rootDir, ctx.language, issues);
    }
    if ((ctx.options.flagPhantomDependencies ?? true) && ctx.options.manifestDependencies) {
        auditPhantomDependencies(ctx.imports, ctx.options.manifestDependencies, ctx.language, issues);
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
