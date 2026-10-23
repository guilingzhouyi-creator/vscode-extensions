/**
 * Module: Core Intelligence — Lingering Empty Directory Audit
 * File Path: src/core/intelligence/empty-directory-audit.ts
 * Architecture Role: Directory-level companion to the per-file hygiene analyzer. The physical
 *   hygiene matrix has eight dimensions; seven of them are properties of a file, so the hygiene
 *   analyzer reaches them one file at a time. A lingering empty directory is a property of the
 *   tree, so it needs a whole-tree view that only the post-scan channel has.
 * Dependencies & Triggers: Node fs/path plus core types; invoked by the report finalizer's
 *   full-scope post-scan channel when the hygiene analyzer is enabled.
 * Responsibilities:
 *   1. Walk the scan root iteratively (no recursion, no unbounded stack growth).
 *   2. Report every directory whose remaining entries are all ignored as HYG-DIR-001.
 *   3. Honour the same ignore/exemption vocabulary the workspace hygiene gate uses, so both
 *      surfaces agree on what counts as empty instead of drifting apart.
 * Exit Semantics & Design Rationale: Total and non-throwing; an unreadable directory is skipped
 *   rather than aborting the audit, matching the file walker. The read barrier is deliberately
 *   synchronous and one-shot per scan: the audit runs once per full scan, after file analysis has
 *   already finished, so it never sits on a per-file hot path.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Issue, Severity } from '../types';
import { ANALYZER_HYGIENE } from '../scoring/dimensionLiterals';

/** Rule identifier for a lingering empty directory inside the active tree. */
export const RULE_HYG_DIR_001 = 'HYG-DIR-001';

/** Severity carried by a lingering empty directory finding. */
export const EMPTY_DIRECTORY_SEVERITY: Severity = 'error';

/**
 * Directory names that are never descended into and never counted as content.
 *
 * A directory holding only build output, a virtual environment, or a cache is not "empty" in the
 * sense this rule cares about: the entries are regenerable, so reporting them would ask a
 * developer to delete something the next build recreates. The list mirrors the workspace hygiene
 * gate so the engine and the gate cannot disagree about the same tree.
 */
export const EMPTY_DIRECTORY_IGNORED_NAMES: readonly string[] = Object.freeze([
    'node_modules',
    '.git',
    'dist',
    'out',
    'build',
    'coverage',
    'target',
    '.godot',
    '.cargo-lock',
    '.mypy_cache',
    '.dsh-plugin-download',
    '.workbuddy',
    '.commandcode',
    '.auto-refactor',
    '.auto-refactor-cache',
    '.refactor-trajectory',
    '.gemini',
    '.audit-logs',
    'archive',
    '.corpus',
    '.diff-corpus',
    '.rust-corpus',
    '.equivalence-corpus',
    '.equivalence-rust-corpus',
    '.bench-corpus',
    'tmp',
    'temp',
    '.praxis',
    '.venv',
    'venv',
]);

/** Path prefixes whose whole subtree is exempt from the empty-directory rule. */
export const EMPTY_DIRECTORY_EXEMPT_PREFIXES: readonly string[] = Object.freeze(['archive/']);

/** Path segments that mark a fixture or sample corpus rather than live source. */
export const EMPTY_DIRECTORY_EXEMPT_SEGMENTS: readonly string[] = Object.freeze([
    'fixtures',
    'testdata',
]);

/** Lookup form of {@link EMPTY_DIRECTORY_EXEMPT_SEGMENTS}, so segment tests stay O(1). */
const EXEMPT_SEGMENT_SET: ReadonlySet<string> = new Set(EMPTY_DIRECTORY_EXEMPT_SEGMENTS);

/** Options narrowing the audit for one scan. */
export interface EmptyDirectoryAuditOptions {
    /** Extra directory names treated as absent, layered on top of the built-in list. */
    ignoredDirectoryNames?: readonly string[];
    /** Extra path prefixes exempted from the rule, in POSIX form without a leading slash. */
    exemptPathPrefixes?: readonly string[];
}

/**
 * Normalizes a caller-supplied directory name or glob into an ignore-set candidate.
 *
 * Only bare directory names are usable here: `dist` can be matched by name, `**\/dist/**` cannot,
 * because the walk decides membership before it knows the full relative path. Globs are dropped
 * rather than translated, so a mis-shaped exclude entry widens the audit instead of silently
 * disabling it.
 *
 * @param candidate - Raw `exclude` entry or explicit ignore name.
 * @returns The trimmed name when it is a bare directory name, otherwise null.
 */
export function toIgnoredDirectoryName(candidate: string): string | null {
    const trimmed = candidate.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (trimmed === '' || /[*?[\]{}!]/.test(trimmed) || trimmed.includes('/')) return null;
    return trimmed;
}

/**
 * Builds the effective ignore set for one audit.
 *
 * @param extraNames - Additional raw names from the scan configuration.
 * @returns Frozen-by-convention set of directory names to skip.
 */
export function buildIgnoredDirectorySet(extraNames: readonly string[] = []): Set<string> {
    const ignored = new Set(EMPTY_DIRECTORY_IGNORED_NAMES);
    for (const candidate of extraNames) {
        const name = toIgnoredDirectoryName(candidate);
        if (name !== null) ignored.add(name);
    }
    return ignored;
}

/**
 * Decides whether a relative directory path is exempt from the empty-directory rule.
 *
 * @param relativeDirectory - POSIX relative path of the directory being judged.
 * @param exemptPrefixes - Prefixes whose subtree is exempt.
 * @returns True when the path must not be reported.
 */
export function isEmptyDirectoryExempt(
    relativeDirectory: string,
    exemptPrefixes: readonly string[] = EMPTY_DIRECTORY_EXEMPT_PREFIXES,
): boolean {
    if (relativeDirectory === '') return true;
    for (const prefix of exemptPrefixes) {
        if (relativeDirectory.startsWith(prefix)) return true;
    }
    const segments = relativeDirectory.split('/');
    for (const segment of segments) {
        if (EXEMPT_SEGMENT_SET.has(segment)) return true;
    }
    return false;
}

/**
 * Reads a directory's entries, treating an unreadable directory as absent.
 *
 * @param absoluteDirectory - Directory to inspect.
 * @returns Directory entries, or an empty list when access fails.
 */
function readEntries(absoluteDirectory: string): fs.Dirent[] {
    try {
        return fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
        return [];
    }
}

/**
 * Converts one empty directory into a reportable finding.
 *
 * @param relativeDirectory - POSIX relative path of the empty directory.
 * @returns The HYG-DIR-001 issue.
 */
function buildEmptyDirectoryIssue(relativeDirectory: string): Issue {
    return {
        id: `${ANALYZER_HYGIENE}:${RULE_HYG_DIR_001}:${relativeDirectory}:1`,
        analyzer: ANALYZER_HYGIENE,
        rule: RULE_HYG_DIR_001,
        severity: EMPTY_DIRECTORY_SEVERITY,
        message:
            `Directory '${relativeDirectory}' retains no entries once build output, caches, and ` +
            `ignored trees are excluded. Remove the directory, or give it content it is meant to hold.`,
        location: {
            file: relativeDirectory,
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 },
        },
        detail: {
            directory: relativeDirectory,
            kind: 'empty-directory',
        },
        suggestion:
            'Delete the lingering empty directory, or add the file it was created for and commit it.',
    };
}

/**
 * Audits a directory tree for directories that hold no live content.
 *
 * The walk is breadth-first over an explicit queue, so a deep tree cannot exhaust the call stack.
 * Symbolic links are never followed: a link cycle would otherwise turn the walk into an unbounded
 * traversal, and a linked directory is not owned by the scanned tree.
 *
 * @param root - Absolute scan root; every reported path is relative to it.
 * @param options - Ignore and exemption overrides for this scan.
 * @returns HYG-DIR-001 issues in walk order; empty when the tree carries no lingering directory.
 */
export function auditEmptyDirectories(
    root: string,
    options: EmptyDirectoryAuditOptions = {},
): Issue[] {
    const ignoredNames = buildIgnoredDirectorySet(options.ignoredDirectoryNames ?? []);
    const exemptPrefixes = options.exemptPathPrefixes ?? EMPTY_DIRECTORY_EXEMPT_PREFIXES;
    const resolvedRoot = path.resolve(root);
    const issues: Issue[] = [];
    const queue: string[] = [resolvedRoot];
    let queueHead = 0;

    while (queueHead < queue.length) {
        const absoluteDirectory = queue[queueHead++]!;
        const entries = readEntries(absoluteDirectory);
        const relativeDirectory = path.relative(resolvedRoot, absoluteDirectory).replace(/\\/g, '/');
        let liveEntryCount = 0;

        for (const entry of entries) {
            if (ignoredNames.has(entry.name)) continue;
            liveEntryCount++;
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
                queue.push(path.join(absoluteDirectory, entry.name));
            }
        }

        if (liveEntryCount === 0 && !isEmptyDirectoryExempt(relativeDirectory, exemptPrefixes)) {
            issues.push(buildEmptyDirectoryIssue(relativeDirectory));
        }
    }

    return issues;
}
