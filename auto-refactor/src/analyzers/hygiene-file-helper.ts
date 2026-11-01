/**
 * Module: Static Analysis — File Hygiene and Naming Audit Helper
 * File Path: src/analyzers/hygiene-file-helper.ts
 * Architecture Role: Dedicated sub-module for hygiene analyzer auditing file-level basics,
 *   empty files, BOM, line endings, clutter files, and file/directory naming conventions.
 * Dependencies & Triggers: Consumes AnalyzerContext and Issue types; triggered by
 *   HygieneAnalyzer.analyze() per file.
 * Responsibilities:
 *   1. Detect empty files (HYG-EMP-001) and comment-only hollow files (HYG-EMP-002);
 *   2. Detect UTF-8 BOM byte-order marks (HYG-BOM-001);
 *   3. Enforce trailing newline conventions (HYG-TRL-001);
 *   4. Enforce OS-specific line endings CRLF vs LF (HYG-EOL-001);
 *   5. Detect temporary/log clutter files (HYG-CLT-001);
 *   6. Audit file and directory naming conventions kebab-case vs snake_case
 *      (HYG-NAM-001, EXT-DIR-001).
 * Exit Semantics & Design Rationale: Deterministic pure helper functions returning boolean
 *   or appending Issue objects; never throws; CC <= 10 per function.
 */

import * as path from 'path';
import type { AnalyzerContext, Issue } from '../core/types';
import { HygieneMessages } from '../core/messages';
import { createLineIssue } from '../core/rules/diagnostic-catalog';

const ANALYZER_HYGIENE = 'hygiene';
const SEVERITY_ERROR = 'error' as const;
const SEVERITY_WARNING = 'warning' as const;
const SEVERITY_INFO = 'info' as const;

const EOL_CRLF = 'CRLF';
const EOL_LF = 'LF';

const ROOT_SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
    '.js',
    '.ts',
    '.mjs',
    '.cjs',
    '.py',
    '.sh',
    '.ps1',
    '.bat',
    '.cmd',
]);

const EXEMPT_ROOT_BASENAMES: ReadonlySet<string> = new Set([
    'index.ts',
    'index.js',
    'main.ts',
    'main.js',
    'app.ts',
    'app.js',
    'cli.ts',
    'cli.js',
    'api.ts',
    'api.js',
    'mod.ts',
    'mod.js',
]);

const EXEMPT_FILE_NAMES = new Set(['README', 'CHANGELOG', 'LICENSE']);
const RE_HOLLOW_SKIP_EXT = /\.(?:md|json|ya?ml)$/i;
const RE_DOCSTRING_START = /^(?:"""|''')/;

/** Terminator token that closes the currently open comment block; '' means no block is open. */
type HollowBlockTerminator = '' | '*/' | '"""' | "'''";

function isExemptFileName(name: string): boolean {
    return name.startsWith('.') || EXEMPT_FILE_NAMES.has(name);
}

function checkJsTsNaming(
    baseName: string,
    nameWithoutExt: string,
): ReturnType<typeof HygieneMessages.FILE_NAMING_KEBAB> | null {
    if (/[A-Z]/.test(nameWithoutExt) && nameWithoutExt.includes('_')) {
        return HygieneMessages.FILE_NAMING_KEBAB(baseName);
    }
    return null;
}

function checkSnakeNaming(
    baseName: string,
    nameWithoutExt: string,
): ReturnType<typeof HygieneMessages.FILE_NAMING_SNAKE> | null {
    if (/[A-Z]/.test(nameWithoutExt) || nameWithoutExt.includes('-')) {
        return HygieneMessages.FILE_NAMING_SNAKE(baseName);
    }
    return null;
}

/**
 * Classifies one trimmed source line for hollow-file detection while tracking open blocks.
 */
function checkHollowCommentLine(
    line: string,
    openTerminator: HollowBlockTerminator,
): { isComment: boolean; nextTerminator: HollowBlockTerminator } {
    if (openTerminator) {
        return {
            isComment: true,
            nextTerminator: line.includes(openTerminator) ? '' : openTerminator,
        };
    }
    if (line.startsWith('/*')) {
        return { isComment: true, nextTerminator: line.includes('*/') ? '' : '*/' };
    }
    if (line.startsWith('//') || line.startsWith('#')) {
        return { isComment: true, nextTerminator: '' };
    }
    if (RE_DOCSTRING_START.test(line)) {
        const quote = line.slice(0, 3) as HollowBlockTerminator;
        return { isComment: true, nextTerminator: line.slice(3).includes(quote) ? '' : quote };
    }
    return { isComment: false, nextTerminator: '' };
}

function isHollowCommentOnlyFile(content: string, filePath: string): boolean {
    if (filePath.endsWith('.d.ts') || RE_HOLLOW_SKIP_EXT.test(filePath)) {
        return false;
    }
    const lines = content.split('\n');
    let openTerminator: HollowBlockTerminator = '';

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length === 0) continue;

        const check = checkHollowCommentLine(line, openTerminator);
        openTerminator = check.nextTerminator;
        if (!check.isComment) {
            return false;
        }
    }

    return true;
}

interface EolMismatchOptions {
    file: string;
    filePath: string;
    expectedEol: string;
    actualEol: string;
    issues: Issue[];
}

function reportEolMismatch(params: EolMismatchOptions): void {
    const { file, filePath, expectedEol, actualEol, issues } = params;
    const desc = HygieneMessages.LINE_ENDINGS_MISMATCH(file, expectedEol, actualEol);
    issues.push(
        createLineIssue(ANALYZER_HYGIENE, filePath, {
            lineIdx: 0,
            rule: 'HYG-EOL-001',
            severity: SEVERITY_ERROR,
            message: desc.message,
            detail: { file, expected: expectedEol, actual: actualEol },
            suggestion: desc.suggestion,
        }),
    );
}

function auditFileBom(content: string, file: string, filePath: string, issues: Issue[]): void {
    if (content.charCodeAt(0) === 0xfeff) {
        const desc = HygieneMessages.UTF8_BOM_DETECTED(file);
        issues.push(
            createLineIssue(ANALYZER_HYGIENE, filePath, {
                lineIdx: 0,
                rule: 'HYG-BOM-001',
                severity: SEVERITY_ERROR,
                message: desc.message,
                detail: { file, hasBom: true },
                suggestion: desc.suggestion,
            }),
        );
    }
}

function auditTrailingNewline(
    content: string,
    file: string,
    filePath: string,
    issues: Issue[],
): void {
    const len = content.length;
    if (len === 0) return;

    if (!content.endsWith('\n')) {
        const desc = HygieneMessages.TRAILING_NEWLINE_VIOLATION(
            file,
            'Missing final EOF newline character',
        );
        issues.push(
            createLineIssue(ANALYZER_HYGIENE, filePath, {
                lineIdx: 0,
                rule: 'HYG-TRL-001',
                severity: SEVERITY_WARNING,
                message: desc.message,
                detail: { file, missingEof: true },
                suggestion: desc.suggestion,
            }),
        );
        return;
    }

    if (content.endsWith('\r\n\r\n') || (!content.includes('\r\n') && content.endsWith('\n\n'))) {
        const desc = HygieneMessages.TRAILING_NEWLINE_VIOLATION(
            file,
            'Excess trailing blank lines at end of file',
        );
        issues.push(
            createLineIssue(ANALYZER_HYGIENE, filePath, {
                lineIdx: 0,
                rule: 'HYG-TRL-001',
                severity: SEVERITY_WARNING,
                message: desc.message,
                detail: { file, excessTrailingBlanks: true },
                suggestion: desc.suggestion,
            }),
        );
    }
}

function auditCommentOnlyShell(
    content: string,
    file: string,
    filePath: string,
    issues: Issue[],
): boolean {
    if (isHollowCommentOnlyFile(content, file)) {
        const desc = HygieneMessages.COMMENT_HOLLOW_FILE(file);
        issues.push(
            createLineIssue(ANALYZER_HYGIENE, filePath, {
                lineIdx: 0,
                rule: 'HYG-EMP-002',
                severity: SEVERITY_ERROR,
                message: desc.message,
                detail: { file, hollow: true },
                suggestion: desc.suggestion,
            }),
        );
        return true;
    }
    return false;
}

function auditClutterFile(file: string, filePath: string, issues: Issue[]): boolean {
    const baseName = path.basename(file);
    const lowerBase = baseName.toLowerCase();
    const isClutter =
        lowerBase.endsWith('.log') ||
        lowerBase.endsWith('.tmp') ||
        lowerBase.endsWith('.bak') ||
        lowerBase.endsWith('.actual.json') ||
        lowerBase === 'thumbs.db' ||
        lowerBase === '.ds_store' ||
        lowerBase === 'desktop.ini';

    if (isClutter) {
        const desc = HygieneMessages.UNCONTROLLED_CLUTTER(file);
        issues.push(
            createLineIssue(ANALYZER_HYGIENE, filePath, {
                lineIdx: 0,
                rule: 'HYG-CLT-001',
                severity: SEVERITY_ERROR,
                message: desc.message,
                detail: { file, baseName },
                suggestion: desc.suggestion,
            }),
        );
        return true;
    }
    return false;
}

/**
 * Audit fundamental file basics: empty files, clutter, BOM, trailing newlines, and EOL.
 *
 * @param content - Raw file content string.
 * @param file - Relative normalized file path.
 * @param ctx - Active analyzer execution context.
 * @param issues - Mutable issue accumulator array.
 * @returns True if the file should abort further content scanning (e.g. 0-byte or clutter).
 */
export function auditFileBasics(
    content: string,
    file: string,
    ctx: AnalyzerContext,
    issues: Issue[],
): boolean {
    if (auditClutterFile(file, ctx.filePath, issues)) {
        return true;
    }

    const len = content.length;
    const trimmed = content.trim();
    if (len === 0 || trimmed.length === 0) {
        issues.push(
            createLineIssue(ANALYZER_HYGIENE, ctx.filePath, {
                lineIdx: 0,
                rule: 'HYG-EMP-001',
                severity: SEVERITY_ERROR,
                message: `Source file '${file}' is empty (0 bytes or whitespace only) and contains no valid executable code.`,
                detail: { file, length: len },
            }),
        );
        return true;
    }

    auditFileBom(content, file, ctx.filePath, issues);
    auditTrailingNewline(content, file, ctx.filePath, issues);

    if (auditCommentOnlyShell(content, file, ctx.filePath, issues)) {
        return true;
    }

    if (file.endsWith('.ps1')) {
        if (!content.includes('\r\n') && content.includes('\n')) {
            reportEolMismatch({ file, filePath: ctx.filePath, expectedEol: EOL_CRLF, actualEol: EOL_LF, issues });
        }
    } else if (/\.(?:ts|js|json|md|sh|rs|py|gd)$/.test(file)) {
        if (content.includes('\r\n')) {
            reportEolMismatch({ file, filePath: ctx.filePath, expectedEol: EOL_LF, actualEol: EOL_CRLF, issues });
        }
    }

    return false;
}

function isExemptRootScript(baseName: string, lowerBase: string): boolean {
    if (baseName.startsWith('.')) return true;
    if (lowerBase.includes('config') || lowerBase.includes('.conf.')) return true;
    if (lowerBase.endsWith('.d.ts')) return true;
    return EXEMPT_ROOT_BASENAMES.has(lowerBase);
}

interface DirectoryConventionsOptions {
    file: string;
    baseName: string;
    ext: string;
    ctx: AnalyzerContext;
    issues: Issue[];
}

function auditDirectoryConventions(params: DirectoryConventionsOptions): void {
    const { file, baseName, ext, ctx, issues } = params;
    const normalized = file.replace(/^\.\//, '');
    if (normalized.includes('/')) {
        return;
    }

    const lowerExt = ext.toLowerCase();
    if (!ROOT_SCRIPT_EXTENSIONS.has(lowerExt)) {
        return;
    }

    const lowerBase = baseName.toLowerCase();
    if (isExemptRootScript(baseName, lowerBase)) {
        return;
    }

    const desc = HygieneMessages.ROOT_SCRIPT_POLLUTION(file);
    issues.push(
        createLineIssue(ANALYZER_HYGIENE, ctx.filePath, {
            lineIdx: 0,
            rule: 'EXT-DIR-001',
            severity: SEVERITY_ERROR,
            message: desc.message,
            detail: { file, baseName, rootScript: true },
            suggestion: desc.suggestion,
        }),
    );
}

/**
 * Audit file and directory naming conventions: kebab-case vs snake_case.
 *
 * @param file - Relative normalized file path.
 * @param ctx - Active analyzer execution context.
 * @param issues - Mutable issue accumulator array.
 */
export function auditFileNaming(file: string, ctx: AnalyzerContext, issues: Issue[]): void {
    const baseName = path.basename(file);
    const ext = path.extname(baseName);
    const nameWithoutExt = baseName.slice(0, baseName.length - ext.length);

    auditDirectoryConventions({ file, baseName, ext, ctx, issues });

    if (isExemptFileName(nameWithoutExt)) {
        return;
    }

    const isJsTs = ext === '.ts' || ext === '.js';
    const isSnakeLang = ext === '.gd' || ext === '.py' || ext === '.rs';
    if (!isJsTs && !isSnakeLang) return;

    const desc = isJsTs
        ? checkJsTsNaming(baseName, nameWithoutExt)
        : checkSnakeNaming(baseName, nameWithoutExt);
    if (desc) {
        issues.push(
            createLineIssue(ANALYZER_HYGIENE, ctx.filePath, {
                lineIdx: 0,
                rule: 'HYG-NAM-001',
                severity: isJsTs ? SEVERITY_INFO : SEVERITY_WARNING,
                message: desc.message,
                detail: { file, baseName },
                suggestion: desc.suggestion,
            }),
        );
    }
}
