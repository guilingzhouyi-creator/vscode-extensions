/**
 * Module: Core Governance — Path Scope Helpers
 * File Path: src/core/governance/pathScope.ts
 * Architecture Role: One definition of "does this file live under that directory" for every rule
 *     that exempts a corpus by layout, so the guards behave identically whether the engine hands
 *     the rule an absolute path or a repository-relative one.
 * Dependencies & Triggers: Pure string work; imported by the governance rules that carry path
 *     exemptions (debug logging, sanitization, exception safety, file structure).
 * Responsibilities: Normalize separators and test directory membership by SEGMENT, tolerating a
 *     leading slash, a trailing slash, and a relative path that carries neither.
 * Exit Semantics & Design Rationale: Pure and total; never throws. Segment matching exists because
 *     the obvious `path.includes('/scripts/')` silently never matches a relative path such as
 *     `scripts/bench.js` — the guard is then dead code that looks correct, which is how this
 *     repository came to carry 472 debug-logging findings on its own scripts.
 */

/**
 * Split a path into its non-empty segments on either separator style.
 *
 * @param filePath - Path in any separator style, absolute or relative.
 * @returns Lowercased path segments in order.
 */
function segmentsOf(filePath: string): string[] {
    return filePath
        .replace(/\\/g, '/')
        .split('/')
        .filter((segment) => segment.length > 0);
}

/**
 * Test whether a path lives inside a directory, matching whole segments.
 *
 * `pathHasSegment('scripts/a.js', 'scripts')` is true, and so is
 * `pathHasSegment('/repo/scripts/a.js', 'scripts')`, while `pathHasSegment('myscripts/a.js',
 * 'scripts')` is false — a substring test would have accepted the last one.
 *
 * @param filePath - Path to test, absolute or relative, either separator style.
 * @param directory - Directory name to look for, with or without surrounding slashes.
 * @returns True when any path segment equals the directory name.
 */
export function pathHasSegment(filePath: string, directory: string): boolean {
    const wanted = directory.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (wanted.length === 0) return false;
    return segmentsOf(filePath).some((segment) => segment.toLowerCase() === wanted);
}

/**
 * Test whether the file name ends with one of the given suffixes.
 *
 * @param filePath - Path to test, in any separator style.
 * @param suffixes - File-name suffixes to accept.
 * @returns True when the last segment ends with any suffix.
 */
export function fileNameEndsWith(filePath: string, suffixes: readonly string[]): boolean {
    const segments = segmentsOf(filePath);
    if (segments.length === 0) return false;
    const name = segments[segments.length - 1];
    return suffixes.some((suffix) => name.endsWith(suffix));
}

/**
 * Common directory segments indicating automated tests, benchmarks, fixtures, or sample code.
 */
export const TEST_OR_FIXTURE_SEGMENTS = [
    'tests',
    'test',
    'testdata',
    'benchmarks',
    'fixtures',
] as const;

/**
 * Common directory segments indicating maintenance, tooling, or deployment scripts.
 */
export const TOOL_SCRIPT_SEGMENTS = ['scripts', 'bin', 'tools'] as const;

/**
 * Tests whether a path belongs to automated tests, benchmarks, or fixture corpora.
 *
 * @param filePath - Path to test, absolute or relative.
 * @returns True when the path resides inside test or fixture directories.
 */
export function isTestOrFixturePath(filePath: string): boolean {
    return TEST_OR_FIXTURE_SEGMENTS.some((segment) => pathHasSegment(filePath, segment));
}

/**
 * Tests whether a path belongs to tooling or repository maintenance scripts.
 *
 * @param filePath - Path to test, absolute or relative.
 * @returns True when the path resides inside tooling script directories.
 */
export function isToolScriptPath(filePath: string): boolean {
    return TOOL_SCRIPT_SEGMENTS.some((segment) => pathHasSegment(filePath, segment));
}

/**
 * Tests whether a path belongs to tooling scripts, test suites, or fixture corpora
 * rather than production runtime code.
 *
 * @param filePath - Path to test, absolute or relative.
 * @returns True when the file is non-production tooling or test code.
 */
export function isToolOrTestScript(filePath: string): boolean {
    return isTestOrFixturePath(filePath) || isToolScriptPath(filePath);
}
