/**
 * Module: Diagnostic Messages — Comment & Header Specification
 * File Path: src/core/messages/comments.ts
 * Architecture Role: Contract-data single source for the comments analyzer
 * Dependencies & Triggers: Imported by src/analyzers/comments.ts and the reporting layer;
 *     consumed on every strict comment audit
 * Responsibilities: Declare the bilingual six-field header labels (EN/ZH) plus the
 *     CMT-HDR-001/002/003, CMT-DOC-001/002 and CMT-CON-001 diagnostic descriptors
 *     (message, suggestion, rationale, risk) emitted by the comment analyzer
 * Exit Semantics & Design Rationale: Pure data module — no side effects, never throws.
 *     Labels live here so the enforced contract and the emitted diagnostics can never drift
 *     apart; the Chinese labels exist only for cross-repository compatibility.
 */

import type { DiagnosticDescriptor } from './types';

/** Risk tier for comment-contract gaps that render as Low severity. */
const RISK_LOW = 'Low';

/**
 * Chinese labels for the six mandatory file-header fields, in contract order.
 *
 * Used for compatibility with headers written in Chinese; the tuple order mirrors
 * SIX_FIELD_HEADERS_EN so index-based comparisons between the two label sets stay valid.
 */
export const SIX_FIELD_HEADERS_ZH = [
    '模块归属',
    '文件路径',
    '架构定位',
    '依赖与触发',
    '职责说明',
    '退出语义与设计依据',
] as const;

/**
 * English labels for the six mandatory file-header fields, in contract order.
 *
 * The tuple defines the exact substring labels the analyzer looks for in the first 30 lines;
 * changing a label or its order changes the header contract for every consumer.
 */
export const SIX_FIELD_HEADERS_EN = [
    'Module',
    'File Path',
    'Architecture Role',
    'Dependencies & Triggers',
    'Responsibilities',
    'Exit Semantics & Design Rationale',
] as const;

/**
 * Stable diagnostic descriptor catalog for comment, header, and concurrency rules.
 *
 * Each factory maps a failure fact to the canonical English message, remediation suggestion,
 * rationale, and risk level emitted by the comments analyzer. Factories are pure and
 * synchronous; existing strings are part of the enforced contract and must not be rewritten
 * because baselines and snapshots depend on them.
 */
export const CommentMessages = {
    // CMT-HDR-001
    MISSING_FILE_HEADER: (filePath: string): DiagnosticDescriptor => ({
        message: `Missing file header commentary: '${filePath}' lacks module-level responsibility and design intent description`,
        suggestion:
            'Add a standard file header comment at the top of the file describing module purpose, architecture role, and dependencies',
        rationale:
            'Top-level header comments accelerate codebase onboarding and prevent architectural boundary erosion.',
        risk: RISK_LOW,
    }),

    // CMT-HDR-002
    MISSING_HEADER_FIELD: (field: string): DiagnosticDescriptor => ({
        message: `Strict header contract violation: Missing required standard header field '${field}'`,
        suggestion: `Ensure standard 6-field header contract is present: ${SIX_FIELD_HEADERS_EN.join(', ')} (or Chinese equivalent: ${SIX_FIELD_HEADERS_ZH.join(', ')})`,
        rationale:
            'Industrial-grade module headers require complete metadata to support automated tooling and cross-team maintenance.',
        risk: 'Medium',
    }),

    // CMT-HDR-003
    HEADER_PATH_MISMATCH: (declaredPath: string, physicalPath: string): DiagnosticDescriptor => ({
        message: `Header declared path mismatch: declared '${declaredPath}' does not match repository path '${physicalPath}'`,
        suggestion:
            'Update the declared file path in the file header to exactly match its repository relative path',
        rationale:
            'Stale header paths mislead code navigation and break documentation linters during file restructuring.',
        risk: 'High',
    }),

    // CMT-DOC-001
    MISSING_PUBLIC_DOC: (symbol: string): DiagnosticDescriptor => ({
        message: `Missing documentation commentary (JSDoc / Docstring) for public exported symbol '${symbol}'`,
        suggestion: `Add documentation comments for public exported symbol '${symbol}' specifying its behavior, parameters, and return value`,
        rationale:
            'Public interfaces and domain entities without docstrings increase cognitive load and misuse by consumers.',
        risk: RISK_LOW,
    }),

    // CMT-DOC-002
    TRIVIAL_COMMENT: (symbol: string): DiagnosticDescriptor => ({
        message: `Tautological trivial comment: Documentation for '${symbol}' mechanically repeats symbol name without semantic value`,
        suggestion:
            'Enrich commentary with business context, edge cases, or exception preconditions, or remove redundant filler text',
        rationale:
            'Comments that only mirror identifier names add visual noise without providing architectural or algorithmic insight.',
        risk: RISK_LOW,
    }),

    // CMT-CON-001
    MISSING_CONCURRENCY_NOTE: (symbol: string): DiagnosticDescriptor => ({
        message: `Missing concurrency semantics: Asynchronous function '${symbol}' lacks concurrency safety or reentrancy specification`,
        suggestion:
            'Specify whether this routine is reentrant, idempotent, thread-safe, or requires external synchronization',
        rationale:
            'Asynchronous workflows without concurrency notes frequently suffer from race conditions under high throughput.',
        risk: RISK_LOW,
    }),

    // CMT-MOJI-001
    MOJIBAKE: (filePath: string): DiagnosticDescriptor => ({
        message: `Encoding corruption (mojibake) detected in '${filePath}': replacement characters or UTF-8/Latin-1 double-decoding artifacts`,
        suggestion: 'Re-save the file as UTF-8 and repair the corrupted text',
        rationale:
            'Mojibake silently destroys prose: readers cannot tell whether a message is a typo or a decoding bug, and the bytes leak into logs and reports.',
        risk: 'High',
    }),

    // CMT-WID-001
    COMMENT_WIDTH: (width: number, limit: number): DiagnosticDescriptor => ({
        message: `Comment/docstring line exceeds ${limit} columns (found ${width})`,
        suggestion: `Wrap the comment at word boundaries; long directives keep their exemption`,
        rationale:
            'Over-wide comments cannot be read side-by-side in diffs or split panes, and they silently defeat the project line-width contract.',
        risk: RISK_LOW,
    }),

    // CMT-SEP-001
    MIXED_SEPARATORS: (shortCount: number, longCount: number): DiagnosticDescriptor => ({
        message: `Mixed section-separator styles in one file: ${shortCount} short title(s) vs ${longCount} long divider(s)`,
        suggestion:
            'Pick one style for the whole file (short `── Section ──` or long `──────── Section`); bare dividers are exempt',
        rationale:
            'A file that mixes separator dialects makes section boundaries look accidental and complicates automated restyling.',
        risk: RISK_LOW,
    }),

    // CMT-BAN-001
    BANNER_SMALL_FILE: (lineCount: number, limit: number): DiagnosticDescriptor => ({
        message: `File-level banner comment used in a small module (${lineCount} lines < ${limit})`,
        suggestion:
            'Drop the banner and rely on the module header contract; keep banners for large files only',
        rationale:
            'Banners consume a disproportionate share of a small file and push the actual contract below the fold.',
        risk: RISK_LOW,
    }),
} as const;
