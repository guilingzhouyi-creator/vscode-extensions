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

const LOW_LEVEL_FILE_RE = /(?:^|[/\\])(?:shared|utils|common)(?:[/\\]|$|\.)/i;
const HIGH_LEVEL_IMPORT_RE = /\/(?:domain|app|application)\//i;
const EXTERNAL_URL_RE = /^(?:https?|wss?):\/\//;

const CATEGORY_PRIORITY: Record<ImportCategory, number> = {
    stdlib: 1,
    'third-party': 2,
    'internal-shared': 3,
    local: 4,
};

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

function createDetail(p: DetailParams): SemanticReviewDetail {
    return {
        language: p.language,
        module: p.module,
        symbol: p.symbol,
        codeDomain: DOMAIN_ID,
        currentBehavior: p.currentBehavior,
        semanticEvidenceChain: p.evidence,
        triggerCondition: p.triggerCondition,
        risk: p.risk,
        blastRadius: [p.file],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: p.suggestedFix,
        impactedCallers: [],
        impactedTests: [],
        verificationMethod: p.verificationMethod,
        ruleVersion: RULE_VERSION,
        configVersion: CONFIG_VERSION,
        canAutofix: p.canAutofix ?? false,
    };
}

function singleStep(
    kind: SemanticEvidenceStep['kind'],
    description: string,
    file: string,
    line: number,
    symbol?: string,
): SemanticEvidenceStep[] {
    return [{ kind, description, file, line, symbol }];
}

function pushLayoutIssue(
    issues: Issue[],
    rule: string,
    severity: 'info' | 'warning' | 'error',
    loc: { file: string; line: number },
    message: string,
    suggestion: string,
    detail: SemanticReviewDetail,
    confidence = 0.95,
): void {
    issues.push({
        id: `${ANALYZER_ID}:${rule}:${loc.file}:${loc.line}`,
        analyzer: ANALYZER_ID,
        rule,
        severity,
        message,
        location: {
            file: loc.file,
            start: { line: loc.line, column: 1 },
            end: { line: loc.line, column: END_COLUMN },
        },
        detail,
        suggestion,
        evidence: { confidence, requiresRuntime: false },
    });
}

function reportSingleImportIssue(
    issues: Issue[],
    rule: string,
    severity: 'info' | 'warning' | 'error',
    imp: ImportStatementInfo,
    evidenceKind: SemanticEvidenceStep['kind'],
    evidenceDesc: string,
    currentBehavior: string,
    triggerCondition: string,
    risk: string,
    suggestedFix: string,
    verificationMethod: string,
    message: string,
    suggestion: string,
    language: string,
    moduleName = 'imports',
    confidence = 0.95,
): void {
    const evidence = singleStep(evidenceKind, evidenceDesc, imp.file, imp.line);
    const detail = createDetail({
        language,
        module: moduleName,
        symbol: imp.moduleSpecifier,
        currentBehavior,
        evidence,
        triggerCondition,
        risk,
        suggestedFix,
        verificationMethod,
        file: imp.file,
    });
    pushLayoutIssue(issues, rule, severity, imp, message, suggestion, detail, confidence);
}

function auditInFunctionImports(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (!imp.isInsideFunction || imp.hasAuditExemption) continue;
        reportSingleImportIssue(
            issues,
            'DEP-LAZ-001',
            'warning',
            imp,
            'call',
            `In-function import '${imp.rawText}' without audit tag`,
            `Ad-hoc in-function import '${imp.rawText}' executed at runtime.`,
            'Import inside function lacking @lazy/@optional tag',
            'Hides module coupling and risks hidden circular dependencies.',
            'Hoist import to top-level, or annotate with exemption.',
            'Verify import lives in top-level header or carries exemption tag.',
            `Unjustified in-function import '${imp.moduleSpecifier}': hoist or declare exemption.`,
            'Move import to top-level or annotate with @lazy/@optional justification.',
            language,
        );
    }
}

function auditWildcardImports(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (!imp.isWildcard) continue;
        reportSingleImportIssue(
            issues,
            'DEP-WLD-001',
            'warning',
            imp,
            'call',
            `Wildcard import: '${imp.rawText}'`,
            `Importing all symbols from '${imp.moduleSpecifier}' via wildcard.`,
            'Wildcard import used in production source code',
            'Pollutes local namespace and obscures dependency tracking.',
            'Import only explicitly required named symbols.',
            'Verify named imports replace wildcard.',
            `Wildcard import from '${imp.moduleSpecifier}': prefer explicit named imports.`,
            'Replace wildcard with explicit named symbol imports.',
            language,
            'imports',
            1.0,
        );
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
        reportSingleImportIssue(
            issues,
            'DEP-INV-001',
            'error',
            imp,
            'condition',
            `Low-level file '${imp.file}' imports high-level '${imp.moduleSpecifier}'`,
            `Low-level component '${imp.file}' inverts dependency by importing '${imp.moduleSpecifier}'.`,
            'Shared component imports higher-level domain/app module',
            'Creates inverted dependency cycles, preventing utility reuse.',
            'Invert dependency via dependency injection or relocate logic.',
            'Verify low-level utilities have zero upper-layer dependencies.',
            `Inverted dependency: low-level module '${imp.file}' imports high-level '${imp.moduleSpecifier}'.`,
            'Extract shared contract or inject domain dependency from higher level.',
            language,
            'dependencies',
        );
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
        const cur = topLevel[i];
        const next = topLevel[i + 1];
        if (CATEGORY_PRIORITY[cur.category] <= CATEGORY_PRIORITY[next.category]) continue;
        const evidence = singleStep(
            'condition',
            `'${cur.moduleSpecifier}' (${cur.category}) precedes '${next.moduleSpecifier}' (${next.category})`,
            cur.file,
            next.line,
        );
        const detail = createDetail({
            language,
            module: 'layout',
            symbol: next.moduleSpecifier,
            currentBehavior: `Import ordering inversion: '${cur.category}' placed before '${next.category}'.`,
            evidence,
            triggerCondition: 'Import group order does not follow canonical sequence',
            risk: 'Violates repository layout conventions.',
            suggestedFix: 'Reorder imports: standard library first, third-party, then local.',
            verificationMethod: 'Verify import groups follow canonical ordering.',
            file: cur.file,
            canAutofix: true,
        });
        pushLayoutIssue(
            issues,
            'DEP-ORD-001',
            'info',
            next,
            `Import layout order violation: '${next.moduleSpecifier}' should precede '${cur.category}'.`,
            'Sort import groups into Stdlib -> ThirdParty -> InternalShared -> Local.',
            detail,
            0.9,
        );
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
        const evidence = singleStep(
            'variable',
            `Raw external URL '${res.urlOrPath}' embedded directly in code`,
            res.file,
            res.line,
            res.symbol,
        );
        const detail = createDetail({
            language,
            module: 'resources',
            symbol: res.symbol,
            currentBehavior: `Raw unmanaged remote endpoint '${res.urlOrPath}' hardcoded.`,
            evidence,
            triggerCondition: 'Hardcoded HTTP/WebSocket URL string detected in business code',
            risk: 'Prevents environment-specific routing and rotation.',
            suggestedFix: 'Move remote URLs into configuration or service registry.',
            verificationMethod: 'Verify endpoint is injected via configuration schema.',
            file: res.file,
        });
        pushLayoutIssue(
            issues,
            'DEP-RES-001',
            'warning',
            res,
            `Unmanaged external URL '${res.urlOrPath}' hardcoded in '${res.symbol}': move to config.`,
            'Externalize endpoint URL to configuration or resource registry.',
            detail,
        );
    }
}

const PKG_LICENSE_CACHE = new Map<string, string | null>();
const PKG_VERSION_CACHE = new Map<string, string | null>();

/** Known host-provided or ambient modules exempt from phantom dependency flags */
const KNOWN_AMBIENT_MODULES: ReadonlySet<string> = new Set(['vscode', 'electron']);

function resolvePackageLicense(rootDir: string, packageName: string): string | null {
    const cacheKey = `${rootDir}::${packageName}`;
    if (PKG_LICENSE_CACHE.has(cacheKey)) {
        return PKG_LICENSE_CACHE.get(cacheKey) ?? null;
    }
    let cur = rootDir;
    for (let i = 0; i < 3; i++) {
        const pkgJsonPath = path.join(cur, 'node_modules', packageName, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
            try {
                const raw = fs.readFileSync(pkgJsonPath, 'utf8');
                const data = JSON.parse(raw);
                let lic: string | null =
                    typeof data.license === 'string'
                        ? data.license
                        : typeof data.license === 'object' && data.license?.type
                          ? data.license.type
                          : null;
                if (
                    !lic &&
                    data.licenses &&
                    Array.isArray(data.licenses) &&
                    data.licenses[0]?.type
                ) {
                    lic = data.licenses[0].type;
                }
                PKG_LICENSE_CACHE.set(cacheKey, lic);
                return lic;
            } catch {
                // best-effort: ignored and falls back to next directory level
            }
        }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }
    PKG_LICENSE_CACHE.set(cacheKey, null);
    return null;
}

function resolvePackageVersion(rootDir: string | undefined, packageName: string): string | null {
    if (!rootDir) return null;
    const cacheKey = `${rootDir}::${packageName}`;
    if (PKG_VERSION_CACHE.has(cacheKey)) {
        return PKG_VERSION_CACHE.get(cacheKey) ?? null;
    }

    // 1. Try node_modules/<packageName>/package.json (up to 3 levels)
    let cur = rootDir;
    for (let i = 0; i < 3; i++) {
        const pkgJsonPath = path.join(cur, 'node_modules', packageName, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
                if (typeof data.version === 'string') {
                    PKG_VERSION_CACHE.set(cacheKey, data.version);
                    return data.version;
                }
            } catch {
                // best-effort: ignored and continues search in parent directory
            }
        }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }

    // 2. Try root package.json declared dependencies
    try {
        const rootPkg = path.join(rootDir, 'package.json');
        if (fs.existsSync(rootPkg)) {
            const data = JSON.parse(fs.readFileSync(rootPkg, 'utf8'));
            const ver =
                data.dependencies?.[packageName] ||
                data.devDependencies?.[packageName] ||
                data.optionalDependencies?.[packageName];
            if (typeof ver === 'string') {
                PKG_VERSION_CACHE.set(cacheKey, ver);
                return ver;
            }
        }
    } catch {
        // best-effort: ignored when root manifest is missing or invalid
    }

    PKG_VERSION_CACHE.set(cacheKey, null);
    return null;
}

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

function auditVulnerableDependencies(
    imports: ImportStatementInfo[],
    rootDir: string | undefined,
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (imp.category !== 'third-party') continue;
        if (isExemptPathOrAlias(imp.moduleSpecifier)) continue;

        const pkgName = extractPackageName(imp.moduleSpecifier);
        const resolvedVer = resolvePackageVersion(rootDir, pkgName) ?? undefined;

        const vuln = checkKnownPackageVulnerability(imp.moduleSpecifier, resolvedVer, {
            matchAnyVersionIfUnspecified: true,
        });
        if (!vuln) continue;

        reportSingleImportIssue(
            issues,
            'DEP-VULN-001',
            'error',
            imp,
            'call',
            `Compromised package '${vuln.packageName}': ${vuln.title} (${vuln.advisoryId})`,
            `Import of compromised or backdoored package '${vuln.packageName}'.`,
            `Known security vulnerability detected: ${vuln.description}`,
            `Supply chain security threat (${vuln.severity}): potential backdoor or malicious payload.`,
            vuln.recommendation,
            'Verify package is removed, replaced, or upgraded to a safe version.',
            `Supply chain security violation: import of compromised package '${vuln.packageName}' (${vuln.advisoryId}): ${vuln.title}.`,
            vuln.recommendation,
            language,
            'security',
            1.0,
        );
    }
}

function auditPhantomDependencies(
    imports: ImportStatementInfo[],
    manifestDeps: Set<string>,
    language: string,
    issues: Issue[],
): void {
    if (!manifestDeps || manifestDeps.size === 0) return;
    const seenPackages = new Set<string>();

    for (const imp of imports) {
        if (imp.category !== 'third-party') continue;
        if (isExemptPathOrAlias(imp.moduleSpecifier)) continue;

        const pkgName = extractPackageName(imp.moduleSpecifier);
        if (!pkgName || seenPackages.has(pkgName)) continue;
        seenPackages.add(pkgName);

        // Check whether package name is declared in manifest dependencies or is ambient host API
        const isDeclared =
            KNOWN_AMBIENT_MODULES.has(pkgName) ||
            manifestDeps.has(pkgName) ||
            manifestDeps.has(pkgName.toLowerCase()) ||
            manifestDeps.has(`@types/${pkgName}`) ||
            manifestDeps.has(pkgName.replace(/-/g, '_')) ||
            manifestDeps.has(pkgName.replace(/_/g, '-'));

        if (!isDeclared) {
            reportSingleImportIssue(
                issues,
                'DEP-PHANTOM-001',
                'warning',
                imp,
                'call',
                `Undeclared external package '${pkgName}' imported without manifest declaration`,
                `External package '${pkgName}' imported in '${imp.file}' but missing from project manifests.`,
                'Import of external third-party package not declared in package.json or project manifest',
                'Phantom dependencies cause non-deterministic builds and CI breakage in clean environments.',
                `Add '${pkgName}' to dependencies/devDependencies in package.json, or replace with local module.`,
                `Verify '${pkgName}' is declared in project manifest.`,
                `Phantom dependency: '${pkgName}' is imported in '${imp.file}' but not declared in project manifest.`,
                `Add '${pkgName}' to dependencies in package.json or project manifest.`,
                language,
                'dependencies',
                0.95,
            );
        }
    }
}

function auditDependencyLicenses(
    imports: ImportStatementInfo[],
    rootDir: string,
    language: string,
    issues: Issue[],
): void {
    if (!rootDir) return;
    const seenPackages = new Set<string>();

    for (const imp of imports) {
        if (imp.category !== 'third-party') continue;
        if (isExemptPathOrAlias(imp.moduleSpecifier)) continue;

        const pkgName = extractPackageName(imp.moduleSpecifier);
        if (!pkgName || seenPackages.has(pkgName)) continue;
        seenPackages.add(pkgName);

        const lic = resolvePackageLicense(rootDir, pkgName);
        if (!lic) continue;

        const audit = auditLicenseCompliance(lic);
        if (audit.isViralCopyleft || !audit.compliant) {
            reportSingleImportIssue(
                issues,
                'DEP-LIC-001',
                'warning',
                imp,
                'condition',
                `External dependency '${pkgName}' carries restrictive/copyleft license '${lic}'`,
                `Dependency '${pkgName}' is governed by '${lic}' which imposes copyleft distribution obligations.`,
                'Proprietary code importing viral copyleft (GPL/AGPL/SSPL) dependency',
                'Legal and compliance risk: copyleft license requires disclosing proprietary derivative source code.',
                audit.remediation ||
                    `Replace '${pkgName}' with a permissively licensed alternative (MIT/Apache-2.0).`,
                'Verify dependency license is permissive or approved under organizational policy.',
                `License compliance violation: dependency '${pkgName}' uses restrictive copyleft license '${lic}'.`,
                audit.remediation ||
                    `Replace '${pkgName}' with a permissively licensed alternative (MIT/Apache-2.0).`,
                language,
                'governance',
                0.95,
            );
        }
    }
}

const TEST_OR_TOOLING_PATTERN =
    /(?:^|[/\\])(?:tests?|fixtures?|mocks?|scripts?|benchmarks?|sample|tooling)(?:[/\\]|$)|(?:\.test|\.spec)\.[a-z0-9]+$/i;

function isTestOrToolingFile(filePath: string): boolean {
    return TEST_OR_TOOLING_PATTERN.test(filePath.replace(/\\/g, '/'));
}

function auditDevelopmentDependencies(
    imports: ImportStatementInfo[],
    inventory: ProjectManifestInventory | undefined,
    filePath: string,
    language: string,
    issues: Issue[],
): void {
    if (!inventory || isTestOrToolingFile(filePath)) {
        return;
    }

    const seenPackages = new Set<string>();

    for (const imp of imports) {
        if (imp.category !== 'third-party') continue;
        if (isExemptPathOrAlias(imp.moduleSpecifier)) continue;

        // Type-only imports do not emit runtime dependencies and are exempted
        if (/^\s*import\s+type\b/.test(imp.rawText)) {
            continue;
        }

        const pkgName = extractPackageName(imp.moduleSpecifier);
        if (!pkgName || seenPackages.has(pkgName)) continue;
        seenPackages.add(pkgName);

        if (isDevOnlyDependency(pkgName, inventory)) {
            reportSingleImportIssue(
                issues,
                'DEP-DEV-001',
                'warning',
                imp,
                'call',
                `Development-only package '${pkgName}' imported in production code`,
                `Package '${pkgName}' is declared in devDependencies but imported at runtime in production file '${imp.file}'.`,
                'Runtime value import of devDependency in production code',
                'Production builds deployed without devDependencies will crash with missing module errors at runtime.',
                `Move '${pkgName}' to dependencies in package.json, or switch to 'import type' if used solely for type annotations.`,
                `Verify '${pkgName}' is in dependencies or converted to 'import type'.`,
                `Dev-only dependency leakage: '${pkgName}' is declared in devDependencies but imported in production file '${imp.file}'.`,
                `Move '${pkgName}' to dependencies in package.json, or convert import to 'import type'.`,
                language,
                'dependencies',
                0.95,
            );
        }
    }
}

function auditDeprecatedDependencies(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    const seenPackages = new Set<string>();

    for (const imp of imports) {
        if (imp.category !== 'third-party' && imp.category !== 'stdlib') continue;
        if (isExemptPathOrAlias(imp.moduleSpecifier)) continue;

        const pkgName = extractPackageName(imp.moduleSpecifier);
        if (!pkgName || seenPackages.has(pkgName)) continue;
        seenPackages.add(pkgName);

        let deprecatedInfo = checkDeprecatedPackage(pkgName);
        if (!deprecatedInfo && pkgName.includes('.')) {
            deprecatedInfo = checkDeprecatedPackage(pkgName.split('.')[0]);
        }
        if (!deprecatedInfo) continue;

        const targetPkg = deprecatedInfo.packageName;
        reportSingleImportIssue(
            issues,
            'DEP-OBS-001',
            'warning',
            imp,
            'call',
            `Deprecated package '${targetPkg}' imported: ${deprecatedInfo.reason}`,
            `Importing deprecated package '${targetPkg}'. Recommended modern replacement: ${deprecatedInfo.replacement}.`,
            'Deprecated or unmaintained package imported in codebase',
            'Accumulates technical debt, prevents runtime upgrades, and poses unpatched vulnerability risks.',
            deprecatedInfo.remediation,
            `Verify '${targetPkg}' is replaced with ${deprecatedInfo.replacement}.`,
            `Deprecated dependency: '${targetPkg}' is deprecated (${deprecatedInfo.reason}). Prefer ${deprecatedInfo.replacement}.`,
            deprecatedInfo.remediation,
            language,
            'maintenance',
            1.0,
        );
    }
}

function auditUnpinnedDependencies(
    imports: ImportStatementInfo[],
    inventory: ProjectManifestInventory | undefined,
    language: string,
    issues: Issue[],
): void {
    if (!inventory || !inventory.versionSpecs || inventory.versionSpecs.size === 0) {
        return;
    }

    const seenPackages = new Set<string>();

    for (const imp of imports) {
        if (imp.category !== 'third-party') continue;
        if (isExemptPathOrAlias(imp.moduleSpecifier)) continue;

        const pkgName = extractPackageName(imp.moduleSpecifier);
        if (!pkgName || seenPackages.has(pkgName)) continue;
        seenPackages.add(pkgName);

        const normPkg = pkgName.toLowerCase();
        const ver = inventory.versionSpecs.get(pkgName) || inventory.versionSpecs.get(normPkg);
        if (!ver) continue;

        if (isUnpinnedVersion(ver)) {
            reportSingleImportIssue(
                issues,
                'DEP-PIN-001',
                'warning',
                imp,
                'call',
                `Unpinned/wildcard version '${ver}' declared for package '${pkgName}' in manifest`,
                `Package '${pkgName}' has unpinned version requirement '${ver}' in project manifest.`,
                'Unpinned or wildcard dependency version declaration',
                'Floating versions introduce unpredictable breaking changes and supply chain attack vectors.',
                `Pin '${pkgName}' to an exact or semver-caret range (e.g. ^1.2.3) in project manifest.`,
                `Verify '${pkgName}' is pinned to a concrete version in manifest.`,
                `Unpinned dependency version: '${pkgName}' uses '${ver}'. Pin to exact or semver-caret range.`,
                `Pin '${pkgName}' to an exact or semver-caret range in project manifest.`,
                language,
                'dependencies',
                0.95,
            );
        }
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
    auditInFunctionImports(imports, language, issues);
    if (options.flagWildcards ?? true) {
        auditWildcardImports(imports, language, issues);
    }
    const firstFile = imports[0]?.file ?? '';
    const isLowLevel = LOW_LEVEL_FILE_RE.test(firstFile);
    auditInvertedDependencies(imports, isLowLevel, language, issues);
    if (options.enforceFileLayout ?? true) {
        auditFileLayoutOrder(imports, language, issues);
    }
    if (options.flagUnmanagedResources ?? true) {
        auditExternalResources(resources, language, issues);
    }
    if (options.flagVulnerableDependencies ?? true) {
        auditVulnerableDependencies(imports, options.rootDir, language, issues);
    }
    if ((options.flagPhantomDependencies ?? true) && options.manifestDependencies) {
        auditPhantomDependencies(imports, options.manifestDependencies, language, issues);
    }
    if ((options.flagLicenseCompliance ?? true) && options.rootDir) {
        auditDependencyLicenses(imports, options.rootDir, language, issues);
    }
    if ((options.flagDevOnlyDependencies ?? true) && options.manifestInventory) {
        auditDevelopmentDependencies(
            imports,
            options.manifestInventory,
            firstFile,
            language,
            issues,
        );
    }
    if (options.flagDeprecatedDependencies ?? true) {
        auditDeprecatedDependencies(imports, language, issues);
    }
    if ((options.flagUnpinnedDependencies ?? true) && options.manifestInventory) {
        auditUnpinnedDependencies(imports, options.manifestInventory, language, issues);
    }
    return issues;
}
