/**
 * Module: Core Scoring — Autonomy Scan State & Provenance Primitives
 * File Path: src/core/scoring/autonomy-scan-state.ts
 * Architecture Role: Shared vocabulary for the in-house autonomy index: the mutable per-scan
 *   accounting record plus the file-classification predicates (test fixture, production SDK,
 *   critical path) that both the file walker and the symbol-reference classifier need.
 * Dependencies & Triggers: Consumes dependency-provenance and import-profiler; imported by
 *   `autonomy-scorer` and `autonomy-reference-scan`.
 * Responsibilities:
 *   1. Declare `AutonomyScanState`, the single mutable accumulator both scan phases write to;
 *   2. Classify a file as test/fixture, and an import as a production external SDK;
 *   3. Record one external SDK call while keeping the per-package inventory consistent;
 *   4. Expose the critical-path predicate so both phases agree on what is mission-critical.
 * Exit Semantics & Design Rationale: Pure predicates and one explicit accumulator mutation; no
 *   I/O, no throwing. The predicates live here rather than in the walker so the reference scan
 *   cannot drift into a second, subtly different definition of "test file" or "production SDK".
 */

import {
    isDevOnlyDependency,
    type ProjectManifestInventory,
} from '../intelligence/dependency-provenance';
import { extractModulePackageName } from '../intelligence/import-profiler';

/** Import provenance: resolved inside the project tree. */
export const KIND_INTERNAL = 'internal';
/** Import provenance: language standard library or platform built-in. */
export const KIND_STDLIB = 'stdlib';
/** Import provenance: third-party package resolved through a manifest. */
export const KIND_EXTERNAL_SDK = 'external_sdk';
/** File provenance: a vendored third-party bundle committed into the tree. */
export const PROVENANCE_IN_TREE_VENDOR = 'in_tree_vendor';
/** File provenance: machine-generated output checked in for convenience. */
export const PROVENANCE_GENERATED = 'generated';
/** File role: a computational algorithm kernel. */
export const ROLE_ALGORITHM_COMPUTATION = 'algorithm_computation';
/** File role: the project's core trunk (entry wiring and shared domain model). */
export const ROLE_CORE_TRUNK = 'core_trunk';
/** File role: an ordinary business module. */
export const ROLE_BUSINESS_MODULE = 'business_module';

/** Bytes read from a file when no in-memory content is available (512 KiB). */
export const MAX_AUTONOMY_FILE_READ_BYTES = 524288;
/** Leading slice inspected when classifying provenance and role from the header. */
export const HEADER_PREVIEW_SLICE_500 = 500;

const TEST_FILE_OR_FIXTURE_PATTERN =
    /(?:^|[\\/])(?:tests?|__tests__|testing|spec|fixtures?)[\\/]|[\\/][a-z0-9_.-]+(?:\.test|\.spec)\.[a-z0-9]+$|(?:^|[\\/])scripts[\\/](?:validate|test|bench)[-_][a-z0-9_.-]+\.[a-z0-9]+$/i;

const TEST_HARNESS_PACKAGES: ReadonlySet<string> = new Set([
    'vitest',
    'jest',
    'mocha',
    'chai',
    'supertest',
    'sinon',
    'jasmine',
    'pytest',
    'unittest',
    '@types/jest',
    '@types/mocha',
    '@types/node',
    '@vitest/runner',
    '@vitest/utils',
    '@vitest/expect',
    '@vitest/spy',
]);

/** Pattern identifying mission-critical runtime, security, crypto, and architecture roots. */
export const CRITICAL_PATH_PATTERN =
    /(?:auth|crypto|security|cipher|token|signature|hash|tls|ssl|secret|rbac|permission|runtime|kernel|dispatch|protocol|driver|syscall|gateway|bootstrap|main\b)/i;

/**
 * Mutable accounting record for one autonomy scan.
 *
 * Both phases write here: the file walker accumulates provenance and effective LOC, while the
 * symbol-reference classifier overwrites the call counters with true AST call references. Keeping
 * one record means the composite synthesis cannot read a half-updated view.
 */
export interface AutonomyScanState {
    proprietaryFiles: number;
    vendorFiles: number;
    generatedFiles: number;
    proprietaryEffectiveLoc: number;
    vendorEffectiveLoc: number;
    generatedEffectiveLoc: number;
    domainKernelEffectiveLoc: number;
    internalSymbolCalls: number;
    externalSdkCalls: number;
    stdlibCalls: number;
    criticalPathFiles: number;
    criticalPathInternalCalls: number;
    criticalPathExternalCalls: number;
    sdkCallCounts: Map<string, number>;
    sdkFileSets: Map<string, Set<string>>;
    currentSpecifiers?: string[];
}

/**
 * Whether a path belongs to a test suite, fixture corpus, or validation script.
 *
 * @param filePath - Project-relative or absolute file path.
 * @returns True when the file is test scaffolding rather than shipped behaviour.
 */
export function isTestOrFixtureFile(filePath: string): boolean {
    return TEST_FILE_OR_FIXTURE_PATTERN.test(filePath.replace(/\\/g, '/'));
}

/**
 * Whether an import specifier resolves to a production third-party dependency.
 *
 * Test scaffolding legitimately imports harness packages, and dev-only dependencies never ship,
 * so counting either as an external SDK call would understate a project's self-reliance.
 *
 * @param specOrPkg - Raw specifier or bare package name.
 * @param currentFile - File owning the import.
 * @param fileInv - Nearest manifest inventory, when one was found.
 * @returns True when the package is a shipped third-party dependency.
 */
export function isProductionExternalSdk(
    specOrPkg: string,
    currentFile: string,
    fileInv?: ProjectManifestInventory,
): boolean {
    const pkg = extractModulePackageName(specOrPkg);
    if (!pkg) return false;
    if (isTestOrFixtureFile(currentFile)) {
        if (TEST_HARNESS_PACKAGES.has(pkg) || TEST_HARNESS_PACKAGES.has(specOrPkg)) {
            return false;
        }
        if (!fileInv) return false;
        if (isDevOnlyDependency(pkg, fileInv)) {
            return false;
        }
        const norm = pkg.toLowerCase();
        const inProd =
            fileInv.prodDependencies.has(norm) ||
            fileInv.prodDependencies.has(pkg) ||
            fileInv.peerDependencies.has(norm) ||
            fileInv.peerDependencies.has(pkg);
        if (!inProd) {
            return false;
        }
    }
    return true;
}

/**
 * Whether a file sits on a mission-critical path.
 *
 * @param filePath - File path to classify.
 * @returns True when the file is shipped code whose name marks a critical concern.
 */
export function isCriticalPathFile(filePath: string): boolean {
    return !isTestOrFixtureFile(filePath) && CRITICAL_PATH_PATTERN.test(filePath);
}

/**
 * Record one external SDK call and keep the per-package inventory in step.
 *
 * @param state - Autonomy accumulator to update.
 * @param pkg - Bare package name that was called.
 * @param currentFile - File making the call.
 * @param isCritical - Whether the calling file is on a critical path.
 */
export function recordSdkCall(
    state: AutonomyScanState,
    pkg: string,
    currentFile: string,
    isCritical: boolean,
): void {
    state.externalSdkCalls++;
    if (isCritical) {
        state.criticalPathExternalCalls++;
    }
    state.sdkCallCounts.set(pkg, (state.sdkCallCounts.get(pkg) || 0) + 1);
    let files = state.sdkFileSets.get(pkg);
    if (!files) {
        files = new Set();
        state.sdkFileSets.set(pkg, files);
    }
    files.add(currentFile);
}

/**
 * Allocate a zeroed autonomy accumulator.
 *
 * @returns A fresh state record ready for the file walker.
 */
export function createAutonomyScanState(): AutonomyScanState {
    return {
        proprietaryFiles: 0,
        vendorFiles: 0,
        generatedFiles: 0,
        proprietaryEffectiveLoc: 0,
        vendorEffectiveLoc: 0,
        generatedEffectiveLoc: 0,
        domainKernelEffectiveLoc: 0,
        internalSymbolCalls: 0,
        externalSdkCalls: 0,
        stdlibCalls: 0,
        criticalPathFiles: 0,
        criticalPathInternalCalls: 0,
        criticalPathExternalCalls: 0,
        sdkCallCounts: new Map<string, number>(),
        sdkFileSets: new Map<string, Set<string>>(),
    };
}
