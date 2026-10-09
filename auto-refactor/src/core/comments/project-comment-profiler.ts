/**
 * Module: Core Engine - Project-Level Comment Style & Language Profiler
 * File Path: src/core/comments/project-comment-profiler.ts
 * Architecture Role: Aggregates project-level and domain-level comment language distribution;
 *   determines dominant documentation language conventions without rigid hardcoding.
 * Dependencies & Triggers: Consumes comment-types; consumed by comments analyzer and scheduler.
 * Responsibilities: Extract comment texts; calculate CJK and Latin word frequency; compute language
 *   entropy and dominant style; aggregate module-specific sub-profiles.
 * Exit Semantics & Design Rationale: Never throws; deterministic single-pass regex scanner
 *   operating with sub-millisecond overhead.
 */

import type {
    CommentLanguageKind,
    LanguageDistribution,
    ProjectCommentProfile,
} from './comment-types';

/** Regular expression matching CJK unified ideographs */
const CJK_CHAR_PATTERN = /[\u4e00-\u9fa5]/g;

/** Regular expression matching meaningful Latin words (length >= 2) */
const LATIN_WORD_PATTERN = /\b[A-Za-z]{2,}\b/g;

/** Dominant language ratio threshold */
const DOMINANCE_RATIO_THRESHOLD = 0.7;

function skipStringLiteral(content: string, startIdx: number): number {
    const quote = content[startIdx];
    let i = startIdx + 1;
    const len = content.length;
    while (i < len) {
        const c = content[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === quote) {
            return i + 1;
        }
        if (quote !== '`' && (c === '\n' || c === '\r')) {
            return i;
        }
        i++;
    }
    return i;
}

function scanLineComment(content: string, startIdx: number): { comment: string; nextIdx: number } {
    let i = startIdx;
    const len = content.length;
    while (i < len && content[i] !== '\n' && content[i] !== '\r') {
        i++;
    }
    return {
        comment: content.slice(startIdx, i).trim(),
        nextIdx: i,
    };
}

function scanBlockComment(content: string, startIdx: number): { comment: string; nextIdx: number } {
    let i = startIdx;
    const len = content.length;
    while (i + 1 < len) {
        if (content[i] === '*' && content[i + 1] === '/') {
            return {
                comment: content.slice(startIdx, i).trim(),
                nextIdx: i + 2,
            };
        }
        i++;
    }
    return {
        comment: content.slice(startIdx, len).trim(),
        nextIdx: len,
    };
}

function tryScanSlashComment(
    content: string,
    index: number,
): { comment: string; nextIdx: number; isLineStart: boolean } | null {
    const next = content[index + 1];
    if (next === '/') {
        const res = scanLineComment(content, index + 2);
        return { comment: res.comment, nextIdx: res.nextIdx, isLineStart: true };
    }
    if (next === '*') {
        const res = scanBlockComment(content, index + 2);
        return { comment: res.comment, nextIdx: res.nextIdx, isLineStart: false };
    }
    return null;
}

function appendComment(comments: string[], text: string): void {
    if (text.length > 0) {
        comments.push(text);
    }
}

function isQuoteChar(ch: string): boolean {
    return ch === '"' || ch === "'" || ch === '`';
}

function tryScanAnyComment(
    content: string,
    index: number,
    isLineStart: boolean,
): { comment: string; nextIdx: number; isLineStart: boolean } | null {
    const ch = content[index];
    if (ch === '/') {
        return tryScanSlashComment(content, index);
    }
    if (ch === '#' && isLineStart && content[index + 1] !== '!') {
        const res = scanLineComment(content, index + 1);
        return { comment: res.comment, nextIdx: res.nextIdx, isLineStart: true };
    }
    return null;
}

function advanceLineStartState(ch: string, current: boolean): boolean {
    if (ch === '\n' || ch === '\r') {
        return true;
    }
    if (ch !== ' ' && ch !== '\t') {
        return false;
    }
    return current;
}

/**
 * Rapidly extracts all raw comment text lines from source content.
 * Single-pass cursor scanner skipping string literals and recognizing
 * line comments (//, #) and block comments (/* *\/).
 *
 * @param content - Full source content
 * @returns Concatenated comment lines
 */
export function extractRawCommentText(content: string): string {
    const comments: string[] = [];
    const len = content.length;
    let i = 0;
    let isLineStart = true;

    while (i < len) {
        const ch = content[i];

        if (isQuoteChar(ch)) {
            i = skipStringLiteral(content, i);
            isLineStart = false;
            continue;
        }

        const commentScan = tryScanAnyComment(content, i, isLineStart);
        if (commentScan) {
            appendComment(comments, commentScan.comment);
            i = commentScan.nextIdx;
            isLineStart = commentScan.isLineStart;
            continue;
        }

        isLineStart = advanceLineStartState(ch, isLineStart);
        i++;
    }

    return comments.join('\n');
}

/**
 * Computes language distribution and balance metrics for given comment text.
 *
 * @param commentText - Extracted comment prose
 * @returns Language distribution statistics
 */
export function computeLanguageDistribution(commentText: string): LanguageDistribution {
    if (!commentText || commentText.trim().length === 0) {
        return {
            cjkChars: 0,
            latinWords: 0,
            cjkRatio: 0,
            latinRatio: 1.0,
            dominantLanguage: 'en',
            driftEntropy: 0,
        };
    }

    const cjkMatches = commentText.match(CJK_CHAR_PATTERN);
    const latinMatches = commentText.match(LATIN_WORD_PATTERN);

    const cjkChars = cjkMatches ? cjkMatches.length : 0;
    const latinWords = latinMatches ? latinMatches.length : 0;
    const totalTokens = cjkChars + latinWords;

    if (totalTokens === 0) {
        return {
            cjkChars: 0,
            latinWords: 0,
            cjkRatio: 0,
            latinRatio: 1.0,
            dominantLanguage: 'en',
            driftEntropy: 0,
        };
    }

    const cjkRatio = Number((cjkChars / totalTokens).toFixed(3));
    const latinRatio = Number((latinWords / totalTokens).toFixed(3));

    let dominantLanguage: CommentLanguageKind = 'bilingual';
    if (latinRatio >= DOMINANCE_RATIO_THRESHOLD) {
        dominantLanguage = 'en';
    } else if (cjkRatio >= DOMINANCE_RATIO_THRESHOLD) {
        dominantLanguage = 'zh-CN';
    }

    const driftEntropy = Number((1.0 - Math.abs(cjkRatio - latinRatio)).toFixed(3));

    return {
        cjkChars,
        latinWords,
        cjkRatio,
        latinRatio,
        dominantLanguage,
        driftEntropy,
    };
}

/**
 * Repository-wide and domain-scoped comment profiler.
 */
export class ProjectCommentProfiler {
    /**
     * Profile comment language distribution for a single source file.
     *
     * @param content - File source code
     * @returns Single file distribution statistics
     */
    public profileSingleFile(content: string): LanguageDistribution {
        const comments = extractRawCommentText(content);
        return computeLanguageDistribution(comments);
    }

    /**
     * Aggregates multiple source files into a repository-wide comment ecosystem profile.
     *
     * @param fileContents - Map from relative file path to source text
     * @returns Aggregated comment style profile
     */
    public profileProject(fileContents: Map<string, string>): ProjectCommentProfile {
        let totalCjk = 0;
        let totalLatin = 0;
        const domainDistributions = new Map<string, LanguageDistribution>();
        const domainBuffers = new Map<string, string[]>();

        for (const [filePath, content] of fileContents.entries()) {
            const commentText = extractRawCommentText(content);
            const dist = computeLanguageDistribution(commentText);
            totalCjk += dist.cjkChars;
            totalLatin += dist.latinWords;

            // Extract module prefix as domain key
            const normalized = filePath.replace(/\\/g, '/');
            const parts = normalized.split('/');
            const domainKey = parts.length > 1 ? parts[0] : 'root';

            const buf = domainBuffers.get(domainKey) ?? [];
            buf.push(commentText);
            domainBuffers.set(domainKey, buf);
        }

        // Calculate domain-specific profiles
        for (const [domainKey, texts] of domainBuffers.entries()) {
            domainDistributions.set(domainKey, computeLanguageDistribution(texts.join('\n')));
        }

        // Calculate repository-wide global profile
        const totalTokens = totalCjk + totalLatin;
        const globalCjkRatio = totalTokens > 0 ? Number((totalCjk / totalTokens).toFixed(3)) : 0;
        const globalLatinRatio =
            totalTokens > 0 ? Number((totalLatin / totalTokens).toFixed(3)) : 1.0;

        let globalDominant: CommentLanguageKind = 'bilingual';
        if (globalLatinRatio >= DOMINANCE_RATIO_THRESHOLD) {
            globalDominant = 'en';
        } else if (globalCjkRatio >= DOMINANCE_RATIO_THRESHOLD) {
            globalDominant = 'zh-CN';
        }

        const globalEntropy = Number(
            (1.0 - Math.abs(globalCjkRatio - globalLatinRatio)).toFixed(3),
        );

        return {
            totalFilesScanned: fileContents.size,
            globalDominantLanguage: globalDominant,
            overallDistribution: {
                cjkChars: totalCjk,
                latinWords: totalLatin,
                cjkRatio: globalCjkRatio,
                latinRatio: globalLatinRatio,
                dominantLanguage: globalDominant,
                driftEntropy: globalEntropy,
            },
            domainDistributions,
        };
    }
}

/** Singleton instance of ProjectCommentProfiler */
export const defaultProjectCommentProfiler = new ProjectCommentProfiler();
