/**
 * Module: Core Intelligence — Dependency Layout Helpers
 * File Path: src/core/intelligence/dependencyLayoutHelpers.ts
 * Architecture Role: Import categorization and exemption parsing for the dependency-layout pack.
 * Dependencies & Triggers: the same imports as ./dependencyLayout; re-exported by that module so
 *   existing callers keep their single import path.
 * Responsibilities: Classify an import specifier and read its exemption reason comment.
 * Exit Semantics & Design Rationale: Pure helpers with no I/O; the analyzer keeps traversal,
 *   option defaults, and severity policy.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';

/** Import category id for a language standard-library module. */
const CATEGORY_STDLIB = 'stdlib';
/** Import category id for a third-party package. */
const CATEGORY_THIRD_PARTY = 'third-party';
/** Import category id for a first-party module shared across domains. */
const CATEGORY_INTERNAL_SHARED = 'internal-shared';
/** Import category id for a relative in-tree module. */
const CATEGORY_LOCAL = 'local';

const PRIORITY_STDLIB = 1;
const PRIORITY_THIRD_PARTY = 2;
const PRIORITY_INTERNAL_SHARED = 3;
const PRIORITY_LOCAL = 4;

const CATEGORY_PRIORITY: Record<ImportCategory, number> = Object.freeze({
    [CATEGORY_STDLIB]: PRIORITY_STDLIB,
    [CATEGORY_THIRD_PARTY]: PRIORITY_THIRD_PARTY,
    [CATEGORY_INTERNAL_SHARED]: PRIORITY_INTERNAL_SHARED,
    [CATEGORY_LOCAL]: PRIORITY_LOCAL,
});

const RULE_VERSION = '1.0.0';
const CONFIG_VERSION = '0.3.0';
const ANALYZER_ID = 'dependency-layout';
const DOMAIN_ID = 'dependency-layout';
const END_COLUMN = 80;
const CONFIDENCE_DEFAULT = 0.95;
const CONFIDENCE_HIGH = 1.0;
const CONFIDENCE_RELAXED = 0.9;
const SEVERITY_INFO = 'info';
const SEVERITY_WARNING = 'warning';
const KIND_CONDITION = 'condition';
const MODULE_LAYOUT = 'layout';

/**
 * Category an import specifier falls into for the dependency-layout report.
 */
export type ImportCategory =
    | typeof CATEGORY_STDLIB
    | typeof CATEGORY_THIRD_PARTY
    | typeof CATEGORY_INTERNAL_SHARED
    | typeof CATEGORY_LOCAL;

/**
 * Exemption reason for justified in-function imports.
 */
export type ExemptionReason = 'lazy' | 'optional' | 'platform' | 'cycle-breaker';

/**
 * Descriptor of an import or dependency reference in source code.
 */
export interface ImportStatementInfo {
    file: string;
    line: number;
    rawText: string;
    moduleSpecifier: string;
    category: ImportCategory;
    isInsideFunction: boolean;
    hasAuditExemption: boolean;
    exemptionReason?: ExemptionReason;
    isWildcard: boolean;
    isTypeOnly?: boolean;
}

import { GO_CORE_PACKAGES, NODE_CORE_MODULES } from './dependency-provenance';
import { PYTHON_STDLIB_MODULES } from './python-stdlib';

/** Exemption marker mapping from trigger tokens to canonical exemption reasons. */
export const EXEMPTION_MARKER_MAP: ReadonlyMap<string, ExemptionReason> = new Map([
    ['@lazy', 'lazy'],
    ['deferred load', 'lazy'],
    ['@optional', 'optional'],
    ['optional dependency', 'optional'],
    ['@platform', 'platform'],
    ['platform-specific', 'platform'],
    ['cycle', 'cycle-breaker'],
    ['break circular', 'cycle-breaker'],
]);

/** Precompiled composite regular expression for audited exemption markers. */
const EXEMPTION_REGEX =
    /@lazy|deferred load|@optional|optional dependency|@platform|platform-specific|break circular|cycle/i;

/** Lookup table from lowercased marker tokens to canonical exemption reasons. */
const EXEMPTION_LOOKUP: Record<string, ExemptionReason> = {
    '@lazy': 'lazy',
    'deferred load': 'lazy',
    '@optional': 'optional',
    'optional dependency': 'optional',
    '@platform': 'platform',
    'platform-specific': 'platform',
    'break circular': 'cycle-breaker',
    cycle: 'cycle-breaker',
};

function categorizeTsJsImport(specifier: string): ImportCategory {
    if (specifier.startsWith('node:')) return CATEGORY_STDLIB;
    const clean = specifier.replace(/^node:/, '');
    const base = clean.split('/')[0];
    if (NODE_CORE_MODULES.has(clean) || NODE_CORE_MODULES.has(base)) return CATEGORY_STDLIB;
    if (specifier.startsWith('./') || specifier.startsWith('../')) return CATEGORY_LOCAL;
    if (specifier.startsWith('@shared/') || specifier.includes('/common/')) {
        return CATEGORY_INTERNAL_SHARED;
    }
    return CATEGORY_THIRD_PARTY;
}

function categorizePythonImport(specifier: string): ImportCategory {
    const firstSegment = specifier.split('.')[0];
    if (PYTHON_STDLIB_MODULES.has(firstSegment)) return CATEGORY_STDLIB;
    if (specifier.startsWith('.')) return CATEGORY_LOCAL;
    return CATEGORY_THIRD_PARTY;
}

function categorizeRustImport(specifier: string): ImportCategory {
    if (
        specifier.startsWith('std::') ||
        specifier.startsWith('core::') ||
        specifier.startsWith('alloc::') ||
        specifier.startsWith('proc_macro::')
    ) {
        return CATEGORY_STDLIB;
    }
    if (specifier.startsWith('crate::') || specifier.startsWith('super::')) {
        return CATEGORY_LOCAL;
    }
    return CATEGORY_THIRD_PARTY;
}

function categorizeGoImport(specifier: string): ImportCategory {
    const firstSegment = specifier.split('/')[0];
    if (GO_CORE_PACKAGES.has(firstSegment)) return CATEGORY_STDLIB;
    if (specifier.startsWith('.')) return CATEGORY_LOCAL;
    return CATEGORY_THIRD_PARTY;
}

/**
 * Determine import category based on language and module specifier.
 *
 * @param specifier - Import target path or package name.
 * @param language - Target programming language.
 * @returns Categorized import classification.
 */
export function categorizeImport(specifier: string, language: string): ImportCategory {
    switch (language) {
        case 'typescript':
        case 'javascript':
            return categorizeTsJsImport(specifier);
        case 'python':
            return categorizePythonImport(specifier);
        case 'rust':
            return categorizeRustImport(specifier);
        case 'go':
            return categorizeGoImport(specifier);
        case 'gdscript':
            return CATEGORY_LOCAL;
        default:
            return CATEGORY_THIRD_PARTY;
    }
}

/** Maximum capacity of precompiled custom exemption regex cache (bounded LRU). */
const CUSTOM_EXEMPTION_CACHE_CAPACITY = 50;

/** LRU cache map for compiled composite custom exemption marker regexes. */
const customExemptionRegexCache = new Map<string, RegExp>();

/**
 * Retrieve or compile a composite regular expression for custom exemption markers.
 * Caches compiled regex in a bounded Map to eliminate per-call regex compilation
 * and inner loop includes (PRF-ALG-002).
 *
 * @param customExemptions - Array of custom exemption token strings.
 * @returns Precompiled RegExp or null if empty.
 */
export function getOrCreateCustomExemptionRegex(
    customExemptions: readonly string[],
): RegExp | null {
    if (!customExemptions || customExemptions.length === 0) {
        return null;
    }
    const cacheKey = customExemptions.join('\0');
    const cachedRegex = customExemptionRegexCache.get(cacheKey);
    if (cachedRegex) {
        customExemptionRegexCache.delete(cacheKey);
        customExemptionRegexCache.set(cacheKey, cachedRegex);
        return cachedRegex;
    }

    const validTokens = customExemptions.filter((token) => token && token.trim().length > 0);
    if (validTokens.length === 0) {
        return null;
    }

    if (customExemptionRegexCache.size >= CUSTOM_EXEMPTION_CACHE_CAPACITY) {
        const oldestKey = customExemptionRegexCache.keys().next().value;
        if (oldestKey !== undefined) {
            customExemptionRegexCache.delete(oldestKey);
        }
    }

    const escapedPattern = validTokens
        .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const compiledRegex = new RegExp(escapedPattern, 'i');
    customExemptionRegexCache.set(cacheKey, compiledRegex);
    return compiledRegex;
}

/**
 * Inspect in-function import comments for audited exemption tags.
 *
 * @param surroundingComment - Leading or inline comment text.
 * @param customExemptions - Project-configured custom exemption marker strings.
 * @returns Exemption reason when justified, or undefined.
 */
export function extractExemptionReason(
    surroundingComment: string,
    customExemptions?: string[],
): ExemptionReason | undefined {
    if (!surroundingComment) {
        return undefined;
    }
    if (customExemptions && customExemptions.length > 0) {
        const customRegex = getOrCreateCustomExemptionRegex(customExemptions);
        if (customRegex && customRegex.test(surroundingComment)) {
            return 'lazy';
        }
    }
    const match = surroundingComment.match(EXEMPTION_REGEX);
    if (match) {
        return EXEMPTION_LOOKUP[match[0].toLowerCase()];
    }
    return undefined;
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

/**
 * Assembles a standardized SemanticReviewDetail payload for dependency layout diagnostics.
 * @param params Construction parameters describing the diagnostic metadata
 * @returns Fully populated SemanticReviewDetail descriptor
 */
export function createDetail(params: DetailParams): SemanticReviewDetail {
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

interface LayoutIssuePayload {
    rule: string;
    severity: 'info' | 'warning' | 'error';
    loc: { file: string; line: number };
    message: string;
    suggestion: string;
    detail: SemanticReviewDetail;
    confidence?: number;
}

/**
 * Emits a structured dependency layout diagnostic issue into the issues collector.
 * @param issues Mutable array of issues receiving the diagnostic record
 * @param payload Parameter payload specifying rule, severity, location, and metadata
 */
export function pushLayoutIssue(issues: Issue[], payload: LayoutIssuePayload): void {
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

/**
 * Validates canonical top-level import ordering
 * (stdlib -> third-party -> internal-shared -> local).
 * @param imports Collected import statements across the target file
 * @param language Source language identifier
 * @param issues Mutable issues collector receiving order violation records
 */
export function auditFileLayoutOrder(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    if (imports.length <= 1) return;
    const topLevel = imports.filter((imp) => !imp.isInsideFunction);
    for (let i = 0; i < topLevel.length - 1; i++) {
        const currentImport = topLevel[i];
        const nextImport = topLevel[i + 1];
        if (CATEGORY_PRIORITY[currentImport.category] <= CATEGORY_PRIORITY[nextImport.category])
            continue;
        const detail = createDetail({
            language,
            module: MODULE_LAYOUT,
            symbol: nextImport.moduleSpecifier,
            currentBehavior: `Import ordering inversion: '${currentImport.category}' placed before '${nextImport.category}'.`,
            evidence: [
                {
                    kind: KIND_CONDITION,
                    description: `'${currentImport.moduleSpecifier}' (${currentImport.category}) precedes '${nextImport.moduleSpecifier}' (${nextImport.category})`,
                    file: currentImport.file,
                    line: nextImport.line,
                },
            ],
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

/**
 * Audits whether top-level imports appear after non-import operational code statements.
 * @param imports Collected import statements across the target file
 * @param firstDeclarationLine Line number of the first substantive code declaration
 * @param language Source language identifier
 * @param issues Mutable issues collector receiving horizon violation records
 */
export function auditImportHorizon(
    imports: ImportStatementInfo[],
    firstDeclarationLine: number | undefined,
    language: string,
    issues: Issue[],
): void {
    if (!firstDeclarationLine || firstDeclarationLine <= 0) return;
    const topLevel = imports.filter((imp) => !imp.isInsideFunction);
    for (let i = 0; i < topLevel.length; i++) {
        const imp = topLevel[i];
        if (imp.line > firstDeclarationLine) {
            const detail = createDetail({
                language,
                module: MODULE_LAYOUT,
                symbol: imp.moduleSpecifier,
                currentBehavior: `Import statement declared after non-import declarations (line ${imp.line} > line ${firstDeclarationLine}).`,
                evidence: [
                    {
                        kind: KIND_CONDITION,
                        description: `Import '${imp.moduleSpecifier}' declared at line ${imp.line} breaches the import horizon (first declaration at line ${firstDeclarationLine})`,
                        file: imp.file,
                        line: imp.line,
                    },
                ],
                triggerCondition: 'Import statement declared after non-import declarations',
                risk: 'Violates top-down file layout and obscures module dependency horizons.',
                suggestedFix:
                    'Hoist all import statements to the top import block before types, constants, and functions.',
                verificationMethod:
                    'Verify import statements precede types, constants, and functions.',
                file: imp.file,
                canAutofix: true,
            });
            pushLayoutIssue(issues, {
                rule: 'DEP-ORD-002',
                severity: SEVERITY_WARNING,
                loc: imp,
                message: `Import statement horizon breach: '${imp.moduleSpecifier}' declared at line ${imp.line} after non-import declarations (first non-import statement at line ${firstDeclarationLine}).`,
                suggestion:
                    'Hoist all module-level import statements to the top import block before types, constants, and functions.',
                detail,
                confidence: CONFIDENCE_HIGH,
            });
        }
    }
}

const MAX_ANCESTOR_SEARCH_DEPTH = 3;

/**
 * Structural shape of a package.json manifest parsed from disk.
 */
export interface RawPackageManifest {
    name?: string;
    version?: string;
    license?: string | { type?: string };
    licenses?: Array<{ type?: string }>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    [key: string]: unknown;
}

/**
 * Safely reads and parses a JSON file, returning null if unreadable or invalid.
 * @param filePath Absolute or relative path to the JSON file
 * @returns Parsed JSON object, or null if reading or parsing failed
 */
export function readJsonSafely(filePath: string): RawPackageManifest | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as RawPackageManifest;
    } catch {
        return null;
    }
}

/**
 * Traverses parent directories to locate package.json for an installed package.
 * @param rootDir Starting directory for ancestor traversal
 * @param packageName Target npm package name to resolve
 * @returns Parsed package.json manifest, or null if not found
 */
export function findAncestorPackageManifest(
    rootDir: string,
    packageName: string,
): RawPackageManifest | null {
    let currentDir = rootDir;
    for (let i = 0; i < MAX_ANCESTOR_SEARCH_DEPTH; i++) {
        const manifest = readJsonSafely(
            path.join(currentDir, 'node_modules', packageName, 'package.json'),
        );
        if (manifest) {
            return manifest;
        }
        const parent = path.dirname(currentDir);
        if (parent === currentDir) {
            break;
        }
        currentDir = parent;
    }
    return null;
}

/**
 * Extracts normalized license identifier from a package.json manifest.
 * @param manifest Parsed package.json object or raw metadata
 * @returns Normalized license string, or null if absent
 */
export function extractLicenseFromManifest(
    manifest: RawPackageManifest | null | undefined,
): string | null {
    if (!manifest) return null;
    if (typeof manifest.license === 'string') return manifest.license;
    if (typeof manifest.license?.type === 'string') return manifest.license.type;
    if (Array.isArray(manifest.licenses) && manifest.licenses[0]?.type) {
        return manifest.licenses[0].type;
    }
    return null;
}
