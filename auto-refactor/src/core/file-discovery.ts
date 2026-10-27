/**
 * Module: Core Engine — Filesystem Discovery & Path Normalization
 * File Path: src/core/file-discovery.ts
 * Architecture Role: Shared discovery and path-normalization utility used by scan entry points
 *                    and cache keys; it owns no policy beyond include/exclude matching.
 * Dependencies & Triggers: Called during CLI/API scan startup, daemon/cache warm paths, and
 *                    gitignore/dependency traversal; depends only on Node fs and path.
 * Responsibilities: Expose the DEFAULT_EXT allow-list, translate `**`/`*`/`?` globs to
 *                    anchored RegExp, test include/exclude pattern sets, normalize separators
 *                    and Windows drive letters, and walk directories iteratively with sorted,
 *                    deterministic repo-relative POSIX output.
 * Exit Semantics & Design Rationale: `collectFiles` skips unreadable or permission-denied
 *                    directories rather than aborting, so a single inaccessible folder cannot
 *                    fail a scan; an explicit FIFO queue replaces recursion to bound call-stack
 *                    use, and sorting makes scan/cache output reproducible.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Lower-case extension allow-list accepted by the filesystem walker. Files whose extension is
 * not listed here are skipped even when an include glob matches, so discovery and analyzers stay
 * aligned on the set of source languages the engine can parse.
 */
export const DEFAULT_EXT: readonly string[] = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.rs',
    '.gd',
    '.py',
    '.go',
    '.sh',
    '.bash',
    '.zsh',
    '.ps1',
    '.psm1',
    '.psd1',
    '.md',
    '.yml',
    '.yaml',
];

function consumeAsterisk(glob: string, i: number): { token: string; nextIndex: number } {
    if (glob[i + 1] !== '*') {
        return { token: '[^/]*', nextIndex: i + 1 };
    }
    if (glob[i + 2] === '/') {
        return { token: '(?:.*/)?', nextIndex: i + 3 };
    }
    return { token: '.*', nextIndex: i + 2 };
}

/**
 * Translate a repo-relative path glob into an anchored RegExp for include/exclude matching.
 * `**` crosses separators, a leading double-star plus slash matches zero or more path segments,
 * `*` stops at `/`, `?` matches one non-separator character, and regex metacharacters escape.
 *
 * @param glob - Glob pattern using POSIX `/` separators (callers normalize paths first).
 * @returns A new case-sensitive RegExp anchored with `^` and `$`; never null.
 */
export function globToRegExp(glob: string): RegExp {
    let regexPattern = '';
    let i = 0;
    while (i < glob.length) {
        const char = glob[i];
        if (char === '*') {
            const consumed = consumeAsterisk(glob, i);
            regexPattern += consumed.token;
            i = consumed.nextIndex;
        } else if (char === '?') {
            regexPattern += '[^/]';
            i++;
        } else if ('.+^${}()|[]\\'.includes(char)) {
            regexPattern += '\\' + char;
            i++;
        } else {
            regexPattern += char;
            i++;
        }
    }
    return new RegExp('^' + regexPattern + '$');
}

/**
 * Test a relative path against every pattern in order, short-circuiting on the first match.
 *
 * @param patterns - Anchored regexes from globToRegExp; an empty list matches nothing.
 * @param targetPath - Repo-relative POSIX path to test.
 * @returns True when at least one pattern accepts `targetPath`, false otherwise.
 */
export function matchAny(patterns: RegExp[], targetPath: string): boolean {
    return patterns.some((regex) => regex.test(targetPath));
}

/**
 * Normalize path separators and drive letters consistently across platforms.
 *
 * @param inputPath - Path using either platform separator; existing `/` separators pass through.
 * @returns `inputPath` with all separators switched to `/` and a Windows drive letter lower-cased.
 */
export function normalizePath(inputPath: string): string {
    const norm = inputPath.split(path.sep).join('/');
    // On Windows, normalize drive letter to lowercase (e.g. C:/ -> c:/) for uniform cache keys
    if (/^[A-Za-z]:\//.test(norm)) {
        return norm[0].toLowerCase() + norm.slice(1);
    }
    return norm;
}

function shouldTraverseDirectory(
    rel: string,
    dirName: string,
    excludeRx: RegExp[],
    gitignore: ((rel: string) => boolean) | null,
): boolean {
    if (matchAny(excludeRx, rel) || matchAny(excludeRx, dirName)) return false;
    return !gitignore || !gitignore(rel);
}

function shouldIncludeFile(
    rel: string,
    fileName: string,
    includeRx: RegExp[],
    excludeRx: RegExp[],
    gitignore: ((rel: string) => boolean) | null,
): boolean {
    if (!matchAny(includeRx, rel) || matchAny(excludeRx, rel)) return false;
    if (gitignore && gitignore(rel)) return false;
    const ext = path.extname(fileName).toLowerCase();
    return DEFAULT_EXT.includes(ext);
}

/**
 * Reads directory entries safely, returning an empty list for unreadable
 * or inaccessible directories.
 *
 * @param dir - Absolute path of directory to inspect.
 * @returns Array of dirent items, or empty array if access fails.
 */
function readDirectoryEntries(dir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

/**
 * Dispatches a single directory entry into the traversal queue or results list.
 *
 * @param entry - Filesystem directory entry to evaluate.
 * @param dir - Current directory path containing entry.
 * @param absRoot - Root directory being traversed.
 * @param includeRx - Include regex patterns.
 * @param excludeRx - Exclude regex patterns.
 * @param gitignore - Optional gitignore predicate.
 * @param dirQueue - FIFO queue of directories to traverse.
 * @param results - Accumulated output list of matched files.
 */
function dispatchDiscoveryEntry(
    entry: fs.Dirent,
    dir: string,
    absRoot: string,
    includeRx: RegExp[],
    excludeRx: RegExp[],
    gitignore: ((rel: string) => boolean) | null,
    dirQueue: string[],
    results: string[],
): void {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(absRoot, abs).split(path.sep).join('/');

    if (entry.isDirectory() && shouldTraverseDirectory(rel, entry.name, excludeRx, gitignore)) {
        dirQueue.push(abs);
        return;
    }

    if (entry.isFile() && shouldIncludeFile(rel, entry.name, includeRx, excludeRx, gitignore)) {
        results.push(rel);
    }
}

/**
 * Iterative filesystem walker for discovering participating source files.
 * Replaces recursive traversal with an explicit FIFO directory queue,
 * eliminating call stack consumption and providing deterministic sorted output.
 * Unreadable or permission-denied directories are skipped instead of aborting the walk.
 *
 * @param absRoot - Absolute directory to walk; every result is relative to this root.
 * @param includeRx - Anchored allow-list regexes; a file must match at least one to be returned.
 * @param excludeRx - Anchored deny-list regexes tested against rel paths and directory names.
 * @param gitignore - Optional predicate that returns true to skip a rel path; null disables it.
 * @returns Sorted repo-relative POSIX paths of readable, included source files.
 */
export function collectFiles(
    absRoot: string,
    includeRx: RegExp[],
    excludeRx: RegExp[],
    gitignore: ((rel: string) => boolean) | null,
): string[] {
    const results: string[] = [];
    const dirQueue: string[] = [absRoot];
    let queueHead = 0;

    while (queueHead < dirQueue.length) {
        const dir = dirQueue[queueHead++]!;
        const entries = readDirectoryEntries(dir);

        for (const entry of entries) {
            dispatchDiscoveryEntry(
                entry,
                dir,
                absRoot,
                includeRx,
                excludeRx,
                gitignore,
                dirQueue,
                results,
            );
        }
    }

    return results.sort();
}
