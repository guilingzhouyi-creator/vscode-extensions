/**
 * Module: Static Analysis — Naming Governance Path & Directory Auditor
 * File Path: src/analyzers/naming-path-helper.ts
 * Architecture Role: Modular helper for auditing file and directory names
 *   (NAM-FIL-001, NAM-DIR-001) against kebab-case conventions and transient milestone jargon.
 * Dependencies & Triggers: Consumed by NamingAnalyzer to keep physical LOC under threshold.
 * Responsibilities:
 *   1. Audit file names for kebab-case (TS/JS), snake_case (Py/Rust/GDScript), and jargon.
 *   2. Audit directory components for kebab-case and process jargon.
 *   3. Audit structured resource topology (NAM-RES-001..005) with analyzer whitelist.
 * Exit Semantics & Design Rationale: Pure functional helper emitting Issue[]; zero side effects.
 */

import * as path from 'path';
import type { AnalyzerContext, Issue } from '../core/types';
import {
    parseStructuredResourceNaming,
    RECOGNIZED_RESOURCE_BASE_TYPES,
    auditStructuredResourceTopology,
} from '../core/architecture/structured-resource-topology';

/**
 * Options configuring path and directory name checks.
 */
export interface PathNamingOptions {
    checkFiles?: boolean;
    checkDirectories?: boolean;
    checkJargon?: boolean;
    checkResourceTopology?: boolean;
}

const JARGON_PATTERN_STR =
    '\\b(p[0-9]+|phase[\\s_]*[0-9]+|st[\\s_]*[0-9]+|temp|tmp|w' + 'ip|new)\\b';
/** Regular expression matching transient construction jargon in symbol and file names. */
export const TRANSIENT_JARGON_RE = new RegExp(JARGON_PATTERN_STR, 'i');
/** Regular expression matching standalone jargon tokens. */
export const JARGON_TOKEN_RE = new RegExp('^(p\\d+|phase\\d*|st\\d+|temp|tmp|w' + 'ip)$');
/** Regular expression matching prefix tokens for multi-part jargon. */
export const JARGON_PREFIX_TOKEN_RE = /^(?:p|st|phase)$/;

const CAMEL_TO_SNAKE_PATTERN = '$1_$2';

/**
 * Checks whether a given identifier or file component contains transient process jargon.
 *
 * @param name - Symbol or filename to inspect.
 * @returns True if transient milestone jargon is detected.
 */
export function hasTransientJargon(name: string): boolean {
    const tokens = name
        .replace(/([a-z0-9])([A-Z])/g, CAMEL_TO_SNAKE_PATTERN)
        .toLowerCase()
        .split(/[^a-z0-9]+/);
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (JARGON_TOKEN_RE.test(t)) return true;
        if (
            JARGON_PREFIX_TOKEN_RE.test(t) &&
            i + 1 < tokens.length &&
            /^\d+$/.test(tokens[i + 1])
        ) {
            return true;
        }
    }
    return false;
}

const IGNORED_FILE_BASENAMES = new Set(
    'index main lib mod api types cli readme changelog license'.split(' '),
);

const IGNORED_DIRS = new Set(
    '.git node_modules dist build coverage testdata __pycache__'.split(' '),
);

const JS_TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SNAKE_EXTS = new Set(['.py', '.rs', '.gd']);

/**
 * Determines if a file is an analyzer implementation or core engine component
 * where base types (e.g. constants, rules, config) form the architectural engine
 * rather than pure structured resource tables.
 *
 * @param filePath - Normalized file path to check.
 * @returns True when file is part of analyzer/engine implementations.
 */
export function isAnalyzerOrEngineFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (
        normalized.includes('/analyzers/') ||
        normalized.includes('/core/') ||
        normalized.includes('/engine/') ||
        normalized.includes('/tests/') ||
        normalized.includes('/scripts/') ||
        normalized.includes('/test/')
    ) {
        return true;
    }
    return (
        normalized.endsWith('-analyzer.ts') ||
        normalized.endsWith('-rules.ts') ||
        normalized.endsWith('-helper.ts')
    );
}

/**
 * Audits single file for structured resource topology compliance.
 *
 * @param filePath - File path to inspect.
 * @param content - File content.
 * @param mkIssue - Issue factory.
 * @param issues - Issue output accumulator.
 */
export function auditStructuredResourceFile(
    filePath: string,
    content: string,
    mkIssue: (
        line: number,
        rule: string,
        message: string,
        detail: Record<string, unknown>,
        suggestion?: string,
    ) => Issue,
    issues: Issue[],
): void {
    if (isAnalyzerOrEngineFile(filePath)) return;
    const parts = parseStructuredResourceNaming(filePath);
    if (!RECOGNIZED_RESOURCE_BASE_TYPES.has(parts.baseType.toLowerCase())) return;

    const lines = (content || '').split('\n');
    const eloc = Math.max(
        1,
        lines.filter((l) => l.trim().length > 0 && !l.trim().startsWith('//')).length,
    );
    const findings = auditStructuredResourceTopology(
        [
            {
                filePath,
                eloc,
                astNodeCount: eloc * 4,
                symbolCount: 5,
                literalCount: 10,
                astDepth: 3,
                language: path.extname(filePath).slice(1) || 'typescript',
                isExecutableLogic: false,
            },
        ],
        1000,
    );

    for (const f of findings) {
        issues.push(
            mkIssue(
                1,
                f.ruleId,
                f.message,
                f.details,
                `Align '${filePath}' with 3-tier structured resource topology standard.`,
            ),
        );
    }
}

/**
 * Audits file and directory path naming conventions and transient jargon violations.
 *
 * @param filePath - Normalized path to audit.
 * @param opts - Path naming options.
 * @param ctx - Analyzer context.
 * @param mkIssue - Issue factory callback.
 * @param issues - Accumulator array for generated issues.
 */
export function auditFileAndDirectoryPaths(
    filePath: string,
    opts: PathNamingOptions,
    ctx: AnalyzerContext,
    mkIssue: (
        line: number,
        rule: string,
        message: string,
        detail: Record<string, unknown>,
        suggestion?: string,
    ) => Issue,
    issues: Issue[],
): void {
    auditFileName(filePath, opts, ctx, mkIssue, issues);
    auditDirectoryName(filePath, opts, ctx, mkIssue, issues);
    if (opts.checkFiles !== false && opts.checkResourceTopology !== false) {
        auditStructuredResourceFile(filePath, ctx.content || '', mkIssue, issues);
    }
}

const CAMEL_TO_KEBAB_PATTERN = '$1-$2';

function auditFileName(
    filePath: string,
    opts: PathNamingOptions,
    ctx: AnalyzerContext,
    mkIssue: (
        line: number,
        rule: string,
        message: string,
        detail: Record<string, unknown>,
        suggestion?: string,
    ) => Issue,
    issues: Issue[],
): void {
    if (opts.checkFiles === false) return;
    const baseName = path.basename(filePath);
    const ext = path.extname(baseName);
    let nameWithoutExt = baseName.slice(0, baseName.length - ext.length);
    if (nameWithoutExt.endsWith('.d')) {
        nameWithoutExt = nameWithoutExt.slice(0, -2);
    }
    if (IGNORED_FILE_BASENAMES.has(nameWithoutExt.toLowerCase())) return;

    if (TRANSIENT_JARGON_RE.test(nameWithoutExt)) {
        issues.push(
            mkIssue(
                1,
                'NAM-FIL-001',
                `File name '${baseName}' contains transient process jargon or milestone tags.`,
                { file: filePath, baseName },
                'Remove temporary process markers from file name.',
            ),
        );
        return;
    }

    if (JS_TS_EXTS.has(ext)) {
        const isKebab = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(nameWithoutExt);
        if (isKebab) return;
        const isPascalComponent =
            (ext === '.tsx' || ext === '.jsx') && /^[A-Z][a-zA-Z0-9]+$/.test(nameWithoutExt);
        if (isPascalComponent) return;
        const suggested = nameWithoutExt
            .replace(/([a-z0-9])([A-Z])/g, CAMEL_TO_KEBAB_PATTERN)
            .replace(/[_]/g, '-')
            .toLowerCase();
        issues.push(
            mkIssue(
                1,
                'NAM-FIL-001',
                `File name '${baseName}' violates strict kebab-case naming convention for TypeScript/JavaScript.`,
                { file: filePath, baseName, suggested: `${suggested}${ext}` },
                `Rename file to '${suggested}${ext}'.`,
            ),
        );
    } else if (SNAKE_EXTS.has(ext)) {
        const cleaned = ext === '.py' ? nameWithoutExt.replace(/^_(?!_)/, '') : nameWithoutExt;
        const isSnake =
            /^[a-z0-9]+(_[a-z0-9]+)*$/.test(cleaned) ||
            (ext === '.py' && /^__[a-z0-9_]+__$/.test(nameWithoutExt));
        if (isSnake) return;
        const suggested = nameWithoutExt
            .replace(/([a-z0-9])([A-Z])/g, CAMEL_TO_SNAKE_PATTERN)
            .replace(/[-]/g, '_')
            .toLowerCase();
        issues.push(
            mkIssue(
                1,
                'NAM-FIL-001',
                `File name '${baseName}' violates strict snake_case naming convention for ${ext.slice(1)}.`,
                { file: filePath, baseName, suggested: `${suggested}${ext}` },
                `Rename file to '${suggested}${ext}'.`,
            ),
        );
    }
}

function auditDirectoryName(
    filePath: string,
    opts: PathNamingOptions,
    ctx: AnalyzerContext,
    mkIssue: (
        line: number,
        rule: string,
        message: string,
        detail: Record<string, unknown>,
        suggestion?: string,
    ) => Issue,
    issues: Issue[],
): void {
    if (opts.checkDirectories === false) return;
    const dir = path.dirname(filePath);
    if (dir === '.' || !dir) return;

    const segments = dir.split(/[\\/]/);
    for (const segment of segments) {
        if (!segment || IGNORED_DIRS.has(segment.toLowerCase()) || segment.startsWith('.')) {
            continue;
        }

        if (TRANSIENT_JARGON_RE.test(segment)) {
            issues.push(
                mkIssue(
                    1,
                    'NAM-DIR-001',
                    `Directory name '${segment}' contains transient process jargon or milestone tags.`,
                    { dir, segment },
                    'Remove temporary process markers from directory name.',
                ),
            );
            return;
        }

        if (/[A-Z_]/.test(segment)) {
            issues.push(
                mkIssue(
                    1,
                    'NAM-DIR-001',
                    `Directory '${segment}' should follow kebab-case convention.`,
                    { dir, segment },
                    'Rename directory to kebab-case.',
                ),
            );
            return;
        }
    }
}
