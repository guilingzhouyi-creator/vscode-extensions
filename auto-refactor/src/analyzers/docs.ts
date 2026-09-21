/**
 * Module: Static Analysis Engine — Documentation Prose Rules
 * File Path: src/analyzers/docs.ts
 * Architecture Role: Markdown documentation analyzer covering format-level defects
 *     (fence balance, dead path references, duplicated prose), language- and project-neutral
 * Dependencies & Triggers: core types plus node's fs/path for reference resolution; enabled
 *     only when a config declares `analyzers.docs`, and runs on `.md` files
 * Responsibilities: Flag unbalanced code fences (DOC-FEN-001), repository paths and relative
 *     links that do not resolve (DOC-LNK-001), and prose lines repeated inside one document
 *     (DOC-DUP-001)
 * Exit Semantics & Design Rationale: Content-only analyzer exposing `finalize` (the engine
 *     skips bare `analyze` analyzers for non-TypeScript files); it never throws — a missing or
 *     unreadable target simply counts as unresolved. The fence rule is an error because a
 *     single missing fence swallows every following section into a code block, while dead
 *     links and duplicated prose stay warnings: they rot slowly, not catastrophically.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import { globToRegExp } from '../core/file-discovery';

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const LINK_TARGET_RE = /\]\(\s*([^)\s]+)\s*\)/g;
// Repository-relative file target: at least one directory segment plus a known extension.
// Globs (`a/**/b.ts`), bare filenames (`benchmark.js`) and git refs (`refs/heads/main`) are
// deliberately excluded — they are not addressable files and only produce noise.
const PATH_TARGET_RE =
    /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.(?:py|md|ya?ml|json|sh|ps1|ts|js|css|html|gd|rs|toml|txt|cfg|ini|mjs|cjs)$/;
const DUP_MIN_LENGTH = 24;
const DUP_IGNORED_PREFIXES = ['>', '|', '#'];
const DUP_MAX_REPORTED = 5;
/** Maximum characters of the duplicated prose sample embedded in the DOC-DUP-001 message. */
const DUP_MESSAGE_SAMPLE_CHARS = 60;
/** Maximum characters of the duplicated prose sample stored in the DOC-DUP-001 issue detail. */
const DUP_DETAIL_SAMPLE_CHARS = 120;

const EXEMPT_MARKERS = [
    '不存在',
    '已废止',
    '已迁',
    'deprecated',
    'removed',
    'archived',
    'historical',
    'was ',
    '示例',
    '例如',
    'example',
    'e.g.',
    'for instance',
];

/** Analyzer options for documentation checks. */
interface DocsOptions {
    /** Glob patterns of reference targets that are intentionally external (other repos). */
    linkExemptTargets?: string[];
}

/**
 * Documentation analyzer: markdown-only prose and reference checks.
 */
export class DocsAnalyzer implements Analyzer {
    name = 'docs' as const;

    /**
     * Streaming-path entry point; the engine invokes it once per discovered file.
     *
     * @param ctx - Analyzer context carrying content, path and the resolved scan root.
     * @returns Documentation findings for the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Scan one markdown file.
     *
     * @param _sf - Unused TypeScript source file (kept for the analyzer contract).
     * @param ctx - Analyzer context carrying content, path and the resolved scan root.
     * @returns Documentation findings for the file.
     */
    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const content = ctx.content || '';
        const file = ctx.filePath.replace(/\\/g, '/');
        if (!file.endsWith('.md') || content.length === 0) return [];
        const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
        const issues: Issue[] = [];
        const emit = (
            lineIdx: number,
            rule: string,
            message: string,
            severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
            suggestion: string,
            detail: Record<string, unknown>,
        ): void => {
            issues.push({
                id: `docs:${rule}:${file}:${lineIdx + 1}`,
                analyzer: this.name,
                rule,
                severity,
                message,
                location: {
                    file,
                    start: { line: lineIdx + 1, column: 1 },
                    end: { line: lineIdx + 1, column: 1 },
                },
                detail,
                suggestion,
            });
        };

        this.checkFences(lines, emit);
        this.checkReferences(
            lines,
            file,
            ctx.config.root,
            (ctx.options || {}) as DocsOptions,
            emit,
        );
        this.checkDuplicateProse(lines, emit);

        return issues;
    }

    /**
     * Flag an unbalanced code fence.
     *
     * @param lines - Markdown lines.
     * @param emit - Issue factory.
     */
    private checkFences(lines: string[], emit: Emit): void {
        let openLine = 0;
        for (let i = 0; i < lines.length; i++) {
            if (FENCE_RE.test(lines[i])) openLine = openLine === 0 ? i + 1 : 0;
        }
        if (openLine === 0) return;
        emit(
            openLine - 1,
            'DOC-FEN-001',
            'Unbalanced code fence: the block opened here is never closed.',
            SEVERITY_ERROR,
            'Close the fence (``` or ~~~) so later sections are not swallowed into the code block.',
            { openedAt: openLine },
        );
    }

    /**
     * Flag repository paths and relative links that do not resolve on disk.
     *
     * @param lines - Markdown lines.
     * @param file - Normalized file path (used for document-relative resolution).
     * @param root - Resolved scan root (used for repository-relative resolution).
     * @param options - Analyzer options (`linkExemptTargets`).
     * @param emit - Issue factory.
     */
    private checkReferences(
        lines: string[],
        file: string,
        root: string,
        options: DocsOptions,
        emit: Emit,
    ): void {
        const docDir = path.dirname(path.resolve(root, file));
        const exempt = (options.linkExemptTargets ?? []).map((pattern) => globToRegExp(pattern));
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (EXEMPT_MARKERS.some((marker) => line.includes(marker))) continue;
            for (const target of this.extractTargets(line, exempt)) {
                const candidates = [path.resolve(root, target), path.resolve(docDir, target)];
                if (candidates.some((candidate) => fs.existsSync(candidate))) continue;
                emit(
                    i,
                    'DOC-LNK-001',
                    `Referenced path does not exist: \`${target}\`.`,
                    SEVERITY_WARNING,
                    'Update the reference to the current path, or mark the line as deprecated/historical.',
                    { target },
                );
            }
        }
    }

    /**
     * Extract path-like reference targets from one line (inline code plus link targets).
     *
     * @param line - Raw markdown line.
     * @returns Deduplicated repo/document-relative targets.
     */
    private extractTargets(line: string, exempt: RegExp[]): string[] {
        const found = new Set<string>();
        const consider = (raw: string): void => {
            const target = raw.split('#')[0].split('?')[0].trim();
            if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/'))
                return;
            if (!PATH_TARGET_RE.test(target)) return;
            if (exempt.some((pattern) => pattern.test(target))) return;
            found.add(target);
        };
        INLINE_CODE_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = INLINE_CODE_RE.exec(line)) !== null) consider(match[1]);
        LINK_TARGET_RE.lastIndex = 0;
        while ((match = LINK_TARGET_RE.exec(line)) !== null) consider(match[1]);
        return [...found];
    }

    /**
     * Flag prose lines repeated inside the document (single-source hygiene).
     *
     * @param lines - Markdown lines.
     * @param emit - Issue factory.
     */
    private checkDuplicateProse(lines: string[], emit: Emit): void {
        const lineCounts = new Map<string, number>();
        const lineFirst = new Map<string, number>();
        for (let i = 0; i < lines.length; i++) {
            const text = lines[i].trim();
            if (text.length < DUP_MIN_LENGTH) continue;
            if (DUP_IGNORED_PREFIXES.some((prefix) => text.startsWith(prefix))) continue;
            const current = lineCounts.get(text) || 0;
            lineCounts.set(text, current + 1);
            if (current === 0) {
                lineFirst.set(text, i + 1);
            }
        }
        const repeated = [...lineCounts.entries()]
            .filter(([, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, DUP_MAX_REPORTED);
        if (repeated.length === 0) return;
        const [sample, count] = repeated[0];
        const firstLine = lineFirst.get(sample) || 1;
        emit(
            firstLine - 1,
            'DOC-DUP-001',
            `Duplicated prose: ${repeated.length} line(s) repeat inside this document ` +
                `(most frequent appears ${count} times: "${sample.slice(0, DUP_MESSAGE_SAMPLE_CHARS)}…").`,
            SEVERITY_WARNING,
            'Collapse the repetition into one canonical section and reference it, so the copy cannot drift.',
            { repeated: repeated.length, sample: sample.slice(0, DUP_DETAIL_SAMPLE_CHARS) },
        );
    }
}

/** Issue factory shared by the documentation checks. */
type Emit = (
    lineIdx: number,
    rule: string,
    message: string,
    severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
    suggestion: string,
    detail: Record<string, unknown>,
) => void;
