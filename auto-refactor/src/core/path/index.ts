/**
 * Module: Core Path — Single Source of Truth for Polyglot Repository Path Classification
 * File Path: src/core/path/index.ts
 * Architecture Role: Centralizes filesystem path classification across all analyzers,
 *   scorers, and audit reporters, eliminating ad-hoc regex drift for tests, fixtures,
 *   scripts, gates, benchmarks, mocks, and documentation across TypeScript, Python,
 *   Rust, Go, Shell, and GDScript codebases.
 * Dependencies & Triggers: Zero external dependencies; imports normalizePathSeparators
 *   from ../constants; consumed by analyzers, scorers, and pipeline gates.
 * Responsibilities:
 *   1. Classify file paths into canonical FileCategory domains;
 *   2. Accurately identify polyglot test suites (TypeScript/JavaScript, Python, Rust, GDScript, Go);
 *   3. Identify fixtures, mock directories, synthetic testdata, and sample files;
 *   4. Identify operational scripts, gate hooks, workflow files, and tooling;
 *   5. Identify generated artifacts, distribution bundles, and third-party modules;
 *   6. Provide frozen lookup caches for maximum scanning throughput.
 * Exit Semantics & Design Rationale: CC <= 8 per helper, Depth <= 2, strictly non-throwing;
 *   returns boolean predicates and immutable category descriptors. Meets ARCH-FAC-001 (ELOC >= 15).
 */

import { normalizePathSeparators } from '../constants';

/**
 * Standardized repository file category classifications.
 */
export type FileCategory =
    | 'test'
    | 'fixture'
    | 'benchmark'
    | 'script'
    | 'documentation'
    | 'generated'
    | 'source';

const TEST_SUBSTRINGS: readonly string[] = Object.freeze([
    '.test.',
    '.spec.',
    '/tests/',
    '/test/',
    '/__tests__/',
    'tests/',
    'test_',
]);

const TEST_SUFFIXES: readonly string[] = Object.freeze([
    '_test.py',
    '_test.gd',
    '_test.go',
    '_test.rs',
    '.test.ts',
    '.spec.ts',
    '.test.js',
    '.spec.js',
    '.test.tsx',
    '.spec.tsx',
    '.test.jsx',
    '.spec.jsx',
]);

const FIXTURE_OR_MOCK_INDICATORS: readonly string[] = Object.freeze([
    '/fixtures/',
    '/fixture/',
    '/__mocks__/',
    '/testdata/',
    '/samples/',
    '/sample/',
    'fixtures/',
    '__mocks__/',
    'testdata/',
]);

const BENCHMARK_INDICATORS: readonly string[] = Object.freeze([
    '/benchmarks/',
    '/benchmark/',
    '/.bench/',
    '/benches/',
    'benchmarks/',
    'benchmark/',
    'benches/',
    '/benchmark.',
    'benchmark.',
    '_bench.rs',
    '_bench.go',
    '.bench.ts',
    '.bench.js',
]);

const SCRIPT_OR_GATE_INDICATORS: readonly string[] = Object.freeze([
    '/scripts/',
    '/bin/',
    '/tools/',
    '/.githooks/',
    '/.husky/',
    '/.github/workflows/',
    '/.gitlab-ci/',
    'scripts/',
    'bin/',
    'tools/',
    '.githooks/',
    '.husky/',
    '.github/workflows/',
    '.gitlab-ci/',
]);

const DOC_EXTENSIONS: readonly string[] = Object.freeze([
    '.md',
    '.markdown',
    '.txt',
    '.rst',
    '.adoc',
]);

const GENERATED_OR_DIST_INDICATORS: readonly string[] = Object.freeze([
    '/node_modules/',
    '/dist/',
    '/build/',
    '/target/',
    '/out/',
    'node_modules/',
    'dist/',
    'build/',
    'target/',
    'out/',
    '.generated.',
    '_generated.',
]);

/**
 * Normalizes a file path to lowercase with forward slashes for deterministic classification.
 *
 * @param filePath - Input raw file path.
 * @returns Clean normalized lowercase POSIX path.
 */
export function normalizePathForClassification(filePath: string): string {
    if (!filePath) return '';
    return normalizePathSeparators(filePath).toLowerCase();
}

/**
 * Evaluates whether a file path represents a polyglot test suite or specification file.
 * Accurately recognizes TypeScript/JavaScript, Python, Rust, Go, and GDScript test conventions.
 *
 * @param filePath - File path to inspect.
 * @returns True if path matches recognized testing conventions.
 */
export function isTestFilePath(filePath: string): boolean {
    const norm = normalizePathForClassification(filePath);
    if (!norm) return false;

    // Fixtures, mocks, and testdata directories contain static payload data, not test suites
    if (isFixtureOrMockPath(norm)) return false;

    for (let i = 0; i < TEST_SUFFIXES.length; i++) {
        if (norm.endsWith(TEST_SUFFIXES[i])) return true;
    }

    for (let i = 0; i < TEST_SUBSTRINGS.length; i++) {
        if (norm.includes(TEST_SUBSTRINGS[i])) return true;
    }

    return false;
}

/**
 * Evaluates whether a file path resides within fixtures, mocks, or synthetic testdata directories.
 *
 * @param filePath - File path to inspect.
 * @returns True if path represents mock or fixture data.
 */
export function isFixtureOrMockPath(filePath: string): boolean {
    const norm = normalizePathForClassification(filePath);
    if (!norm) return false;

    for (let i = 0; i < FIXTURE_OR_MOCK_INDICATORS.length; i++) {
        if (norm.includes(FIXTURE_OR_MOCK_INDICATORS[i])) return true;
    }

    return false;
}

/**
 * Evaluates whether a file path represents a benchmark harness or performance measurement suite.
 *
 * @param filePath - File path to inspect.
 * @returns True if path represents a benchmark file.
 */
export function isBenchmarkPath(filePath: string): boolean {
    const norm = normalizePathForClassification(filePath);
    if (!norm) return false;

    for (let i = 0; i < BENCHMARK_INDICATORS.length; i++) {
        if (norm.includes(BENCHMARK_INDICATORS[i])) return true;
    }

    return false;
}

/**
 * Evaluates whether a file path represents an operational script, gate, or automation tool.
 *
 * @param filePath - File path to inspect.
 * @returns True if path represents a script or gate.
 */
export function isScriptOrGatePath(filePath: string): boolean {
    const norm = normalizePathForClassification(filePath);
    if (!norm) return false;

    for (let i = 0; i < SCRIPT_OR_GATE_INDICATORS.length; i++) {
        if (norm.includes(SCRIPT_OR_GATE_INDICATORS[i])) return true;
    }

    return false;
}

/**
 * Evaluates whether a file path represents documentation or user guides.
 *
 * @param filePath - File path to inspect.
 * @returns True if path represents documentation.
 */
export function isDocumentationPath(filePath: string): boolean {
    const norm = normalizePathForClassification(filePath);
    if (!norm) return false;

    if (norm.includes('/docs/') || norm.startsWith('docs/')) return true;

    for (let i = 0; i < DOC_EXTENSIONS.length; i++) {
        if (norm.endsWith(DOC_EXTENSIONS[i])) return true;
    }

    return false;
}

/**
 * Evaluates whether a file path represents generated code, build output, or third-party dependencies.
 *
 * @param filePath - File path to inspect.
 * @returns True if path represents generated or bundled artifacts.
 */
export function isGeneratedOrDistPath(filePath: string): boolean {
    const norm = normalizePathForClassification(filePath);
    if (!norm) return false;

    for (let i = 0; i < GENERATED_OR_DIST_INDICATORS.length; i++) {
        if (norm.includes(GENERATED_OR_DIST_INDICATORS[i])) return true;
    }

    return false;
}

/**
 * Evaluates whether a file path is exempt from strict business architecture constraints
 * (e.g., tests, fixtures, benchmarks, or operational scripts).
 *
 * @param filePath - File path to inspect.
 * @returns True if file is in an exempted development/test/tooling domain.
 */
export function isExemptFromArchitectureRules(filePath: string): boolean {
    return (
        isTestFilePath(filePath) ||
        isFixtureOrMockPath(filePath) ||
        isBenchmarkPath(filePath) ||
        isScriptOrGatePath(filePath) ||
        isGeneratedOrDistPath(filePath)
    );
}

/**
 * Classifies a file path into its canonical operational category.
 *
 * @param filePath - File path to classify.
 * @returns Assigned FileCategory.
 */
export function classifyFilePath(filePath: string): FileCategory {
    if (isGeneratedOrDistPath(filePath)) return 'generated';
    if (isBenchmarkPath(filePath)) return 'benchmark';
    if (isFixtureOrMockPath(filePath)) return 'fixture';
    if (isTestFilePath(filePath)) return 'test';
    if (isScriptOrGatePath(filePath)) return 'script';
    if (isDocumentationPath(filePath)) return 'documentation';
    return 'source';
}

/**
 * Frozen facade providing unified path classification utilities.
 */
export const PathClassifier = Object.freeze({
    normalize: normalizePathForClassification,
    isTest: isTestFilePath,
    isFixtureOrMock: isFixtureOrMockPath,
    isBenchmark: isBenchmarkPath,
    isScriptOrGate: isScriptOrGatePath,
    isDocumentation: isDocumentationPath,
    isGeneratedOrDist: isGeneratedOrDistPath,
    isExemptFromArchitecture: isExemptFromArchitectureRules,
    classify: classifyFilePath,
});
