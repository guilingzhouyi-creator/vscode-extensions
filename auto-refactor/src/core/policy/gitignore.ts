/**
 * Module: Core Engine — Pragmatic `.gitignore` Matcher
 * File Path: src/core/policy/gitignore.ts
 * Architecture Role: Optional ignore-rule adapter used by file discovery to exclude paths;
 *                    it implements a documented subset of the Git ignore specification.
 * Dependencies & Triggers: Called by scan setup and `collectFiles` with the scan root; reads
 *                    the root `.gitignore` once and returns a reusable path predicate.
 * Responsibilities: Parse comments/blanks, `!` negation, trailing-slash directory-only rules,
 *                    leading-slash anchoring, `*`/`**`/`?` globs, and slashless basename
 *                    matches; compile ordered Pattern rules and apply last-match-wins semantics.
 * Exit Semantics & Design Rationale: A missing/unreadable `.gitignore` or zero parsed patterns
 *                    returns `() => false` instead of throwing, so scanning is fail-open;
 *                    unsupported constructs (character classes, braces, star-star-slash) stay
 *                    out of scope because the explicit exclude list remains authoritative.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Pragmatic `.gitignore` matcher (a commonly-used subset of the git spec).
 *
 * Supported:
 *   - `#` comments and blank lines
 *   - `!` negation (last matching rule wins)
 *   - trailing `/`  => directory-only pattern (matches the dir and everything beneath it)
 *   - leading `/`   => anchored to the .gitignore's own directory (root of this matcher)
 *   - `*`           => matches within a single path segment
 *   - `**`          => matches across segments
 *   - `?`           => single non-separator char
 *   - a pattern with no `/` also matches a file's basename at any depth (e.g. `*.log`)
 *
 * NOT supported (deliberately out of scope for a lint tool): the "star-star-slash" prefix,
 * character classes [...], brace expansion, and the rarer precedence edge cases. For those,
 * the explicit exclude list remains the source of truth.
 */

interface Pattern {
    negated: boolean;
    dirOnly: boolean;
    slashless: boolean;
    regex: RegExp;
}

function globPatternBody(glob: string): string {
    let re = '';
    let i = 0;
    while (i < glob.length) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                re += '.*';
                i += 2;
                if (glob[i] === '/') i++; // consume separator after **
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
    return re;
}

/**
 * Convert a glob pattern into an anchored RegExp.
 *
 * @param glob - Glob pattern string.
 * @returns Anchored RegExp matching the pattern.
 */
export function globToRegExp(glob: string): RegExp {
    return new RegExp('^' + globPatternBody(glob) + '$');
}

/**
 * Build a predicate that returns true if `rel` (a path relative to `root`, using
 * forward slashes) should be ignored per the root `.gitignore`. If no `.gitignore`
 * exists, the predicate always returns false.
 *
 * The returned predicate is synchronous and stateless: the pattern list is parsed once and
 * then reused, so concurrent consumers may share it without locking or cross-call races.
 *
 * @param root - Directory whose `.gitignore` is read; a missing or unreadable file degrades
 *   to a never-ignore predicate instead of throwing.
 * @returns A predicate over root-relative POSIX paths; `true` means the path matches the
 *   effective last rule and is excluded, `false` means it stays visible to discovery.
 */
export function loadGitignore(root: string): (rel: string) => boolean {
    const giPath = path.join(root, '.gitignore');
    try {
        const lines = fs.readFileSync(giPath, 'utf8').split(/\r?\n/);
        return parseGitignoreLines(lines);
    } catch {
        return () => false;
    }
}

/**
 * Parse an array of .gitignore lines into a path predicate.
 *
 * @param lines - Array of gitignore pattern strings.
 * @returns Predicate over relative paths returning true if ignored.
 */
export function parseGitignoreLines(lines: string[]): (rel: string) => boolean {
    const patterns: Pattern[] = [];
    for (let raw of lines) {
        raw = raw.trim();
        if (!raw || raw.startsWith('#')) continue;
        let negated = false;
        if (raw.startsWith('!')) {
            negated = true;
            raw = raw.slice(1).trim();
        }
        let dirOnly = false;
        if (raw.endsWith('/')) {
            dirOnly = true;
            raw = raw.slice(0, -1);
        }
        const hadLeadingSlash = raw.startsWith('/');
        if (hadLeadingSlash) raw = raw.slice(1); // anchor to this dir
        const slashless = !hadLeadingSlash && !raw.includes('/');
        const body = globPatternBody(raw);
        const regex = slashless
            ? new RegExp('(^|/)' + body + '(/.*)?$')
            : new RegExp('^' + body + '(/.*)?$');
        patterns.push({ negated, dirOnly, slashless, regex });
    }

    if (patterns.length === 0) return () => false;

    return (rel: string): boolean => {
        const norm = rel.split(path.sep).join('/');
        let ignored = false;
        for (const p of patterns) {
            if (p.regex.test(norm)) {
                ignored = !p.negated;
            }
        }
        return ignored;
    };
}
