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
];

/**
 * Translate a repo-relative path glob into an anchored RegExp for include/exclude matching.
 * `**` crosses separators, a leading double-star plus slash matches zero or more path segments,
 * `*` stops at `/`, `?` matches one non-separator character, and regex metacharacters escape.
 *
 * @param glob - Glob pattern using POSIX `/` separators (callers normalize paths first).
 * @returns A new case-sensitive RegExp anchored with `^` and `$`; never null.
 */
export function globToRegExp(glob: string): RegExp {
    let re = '';
    let i = 0;
    while (i < glob.length) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                i += 2;
                if (glob[i] === '/') {
                    // Double-star plus slash: match zero or more whole path segments.
                    re += '(?:.*/)?';
                    i++;
                } else {
                    // Bare double-star: match anything, including path separators.
                    re += '.*';
                }
            } else {
                re += '[^/]*';
                i++;
            }
        } else if (c === '?') {
            re += '[^/]';
            i++;
        } else if ('.+^${}()|[]\\'.includes(c)) {
            re += '\\' + c;
            i++;
        } else {
            re += c;
            i++;
        }
    }
    return new RegExp('^' + re + '$');
}

/**
 * Test a relative path against every pattern in order, short-circuiting on the first match.
 *
 * @param patterns - Anchored regexes from globToRegExp; an empty list matches nothing.
 * @param p - Repo-relative POSIX path to test.
 * @returns True when at least one pattern accepts `p`, false otherwise.
 */
export function matchAny(patterns: RegExp[], p: string): boolean {
    return patterns.some((rx) => rx.test(p));
}

/**
 * Normalize path separators and drive letters consistently across platforms.
 *
 * @param p - Path using either platform separator; existing `/` separators pass through.
 * @returns `p` with all separators switched to `/` and a Windows drive letter lower-cased.
 */
export function normalizePath(p: string): string {
    const norm = p.split(path.sep).join('/');
    // On Windows, normalize drive letter to lowercase (e.g. C:/ -> c:/) for uniform cache keys
    if (/^[A-Za-z]:\//.test(norm)) {
        return norm[0].toLowerCase() + norm.slice(1);
    }
    return norm;
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

    while (dirQueue.length > 0) {
        const dir = dirQueue.shift()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            // Ignored for unreadable / permission-denied directories
            continue;
        }

        for (const e of entries) {
            const abs = path.join(dir, e.name);
            const rel = path.relative(absRoot, abs).split(path.sep).join('/');

            if (e.isDirectory()) {
                if (matchAny(excludeRx, rel) || matchAny(excludeRx, e.name)) continue;
                if (gitignore && gitignore(rel)) continue;
                dirQueue.push(abs);
            } else if (e.isFile()) {
                if (!matchAny(includeRx, rel)) continue;
                if (matchAny(excludeRx, rel)) continue;
                if (gitignore && gitignore(rel)) continue;
                const ext = path.extname(e.name).toLowerCase();
                if (!DEFAULT_EXT.includes(ext)) continue;
                results.push(rel);
            }
        }
    }

    return results.sort();
}
