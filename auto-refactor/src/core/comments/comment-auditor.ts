/**
 * Module: Core Engine - Comment Governance & Density Auditor
 * File Path: src/core/comments/comment-auditor.ts
 * Architecture Role: Evaluates comment language consistency, effective density, and semantic
 *   duty alignment; decouples advanced comment governance from the main line scanner.
 * Dependencies & Triggers: Consumes comment-types, profiler, density model, semantic matcher;
 *   consumed by CommentsAnalyzer during standard and strict audits.
 * Responsibilities:
 *   1. Evaluate comment language drift against dominant convention (CMT-LNG-001);
 *   2. Detect haphazard mixed language incoherence within single files (CMT-LNG-002);
 *   3. Identify low effective comment density and tautological water-logging (CMT-VMD-001);
 *   4. Flag contradictions between documented contract duties and code AST (CMT-INT-001).
 * Exit Semantics & Design Rationale: Never throws; appends structured issues to accumulator.
 */

import type { AnalyzerContext, Issue } from '../types';
import { SEVERITY_WARNING } from '../types';
import { defaultProjectCommentProfiler } from './project-comment-profiler';
import { evaluateEffectiveCommentDensity } from './comment-density-model';
import { matchCommentCodeDuty } from './comment-semantic-matcher';
import type { CommentGovernanceOptions } from './comment-types';

/**
 * Factory callback to construct canonical issue objects.
 */
export type IssueFactory = (
    ctx: AnalyzerContext,
    line: number,
    rule: string,
    message: string,
    severity: typeof SEVERITY_WARNING,
    detail?: Record<string, any>,
    suggestion?: string,
) => Issue;

/** Minimum consecutive CJK characters in a comment line to trigger line-level drift */
const CJK_LINE_THRESHOLD = 3;
const CJK_CONSECUTIVE_RE = new RegExp(`[\\u4e00-\\u9fa5]{${CJK_LINE_THRESHOLD},}`);
const MAX_LINE_NOTICES = 3;
const FILE_LEVEL_DRIFT_THRESHOLD = 0.15;
const CJK_MIN_CHAR_COUNT = 10;
const LATIN_MIN_WORD_COUNT = 15;
const INCOHERENCE_RATIO_MIN = 0.25;
const INCOHERENCE_ENTROPY_MIN = 0.5;
const MIN_WATER_LOGGING_LINES = 4;
const LOOKAHEAD_BODY_LINES = 30;

const DEFAULT_DOMINANT_LANG = 'en';
const CHINESE_LANG_ID = 'zh-CN';
const ENGLISH_LANG_ID = 'en';

/**
 * Checks whether a given path is an exempt asset (localization dictionaries or test fixtures).
 */
function isExemptLanguageAuditPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return (
        normalized.includes('/dictionaries/') ||
        normalized.includes('/locales/') ||
        normalized.includes('/i18n/') ||
        normalized.includes('/test/') ||
        normalized.includes('/tests/') ||
        normalized.includes('scripts/validate-')
    );
}

/**
 * Audit source file for comment language consistency against project convention.
 *
 * @param content - Full source text of the file
 * @param opts - Comment governance configuration options
 * @param ctx - Analyzer execution context
 * @param issues - Output accumulator for detected issues
 * @param mkIssue - Factory callback to instantiate canonical issues
 */
function auditLineLevelLanguage(
    content: string,
    targetLang: string,
    ctx: AnalyzerContext,
    issues: Issue[],
    mkIssue: IssueFactory,
): void {
    if (targetLang !== ENGLISH_LANG_ID) return;
    const lines = content.split('\n');
    let notices = 0;
    for (let i = 0; i < lines.length && notices < MAX_LINE_NOTICES; i++) {
        const trimmed = lines[i].trim();
        const isComment =
            trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
        if (isComment && CJK_CONSECUTIVE_RE.test(trimmed)) {
            issues.push(
                mkIssue(
                    ctx,
                    i,
                    'CMT-LNG-001',
                    'Comment language diverges from dominant project convention [en]; ' +
                        'detected non-English characters in comment line.',
                    SEVERITY_WARNING,
                    { line: i + 1, dominantLanguage: ENGLISH_LANG_ID },
                    'Translate comment prose to English to maintain repository-wide ' +
                        'language uniformity.',
                ),
            );
            notices++;
        }
    }
}

function auditMacroLanguageDrift(
    dist: ReturnType<typeof defaultProjectCommentProfiler.profileSingleFile>,
    targetLang: string,
    ctx: AnalyzerContext,
    issues: Issue[],
    mkIssue: IssueFactory,
): void {
    if (
        targetLang === ENGLISH_LANG_ID &&
        dist.cjkRatio >= FILE_LEVEL_DRIFT_THRESHOLD &&
        dist.cjkChars >= CJK_MIN_CHAR_COUNT
    ) {
        const cjkPct = (dist.cjkRatio * 100).toFixed(0);
        issues.push(
            mkIssue(
                ctx,
                0,
                'CMT-LNG-001',
                'Comment language diverges from dominant project convention [en]; ' +
                    `detected ${dist.cjkChars} CJK characters (${cjkPct}%).`,
                SEVERITY_WARNING,
                { dominantLanguage: ENGLISH_LANG_ID, actualDistribution: dist },
                'Translate comments to English to maintain repository-wide language uniformity.',
            ),
        );
    } else if (
        targetLang === CHINESE_LANG_ID &&
        dist.latinRatio >= 0.7 &&
        dist.latinWords >= LATIN_MIN_WORD_COUNT
    ) {
        const latinPct = (dist.latinRatio * 100).toFixed(0);
        issues.push(
            mkIssue(
                ctx,
                0,
                'CMT-LNG-001',
                'Comment language diverges from dominant project convention [zh-CN]; ' +
                    `detected ${dist.latinWords} Latin words (${latinPct}%).`,
                SEVERITY_WARNING,
                { dominantLanguage: CHINESE_LANG_ID, actualDistribution: dist },
                'Translate comments to Simplified Chinese to maintain repository-wide ' +
                    'language uniformity.',
            ),
        );
    }
}

function auditMixedLanguageIncoherence(
    dist: ReturnType<typeof defaultProjectCommentProfiler.profileSingleFile>,
    ctx: AnalyzerContext,
    issues: Issue[],
    mkIssue: IssueFactory,
): void {
    if (
        dist.cjkRatio >= INCOHERENCE_RATIO_MIN &&
        dist.latinRatio >= INCOHERENCE_RATIO_MIN &&
        dist.driftEntropy >= INCOHERENCE_ENTROPY_MIN &&
        dist.cjkChars >= LATIN_MIN_WORD_COUNT &&
        dist.latinWords >= LATIN_MIN_WORD_COUNT
    ) {
        issues.push(
            mkIssue(
                ctx,
                0,
                'CMT-LNG-002',
                'Mixed language incoherence detected within single file ' +
                    `(CJK: ${(dist.cjkRatio * 100).toFixed(0)}%, ` +
                    `Latin: ${(dist.latinRatio * 100).toFixed(0)}%).`,
                SEVERITY_WARNING,
                { actualDistribution: dist },
                'Unify comment language throughout the file to avoid fragmented ' +
                    'multilingual maintenance.',
            ),
        );
    }
}

export function auditCommentLanguage(
    content: string,
    opts: CommentGovernanceOptions,
    ctx: AnalyzerContext,
    issues: Issue[],
    mkIssue: IssueFactory,
): void {
    if (isExemptLanguageAuditPath(ctx.filePath)) {
        return;
    }

    const dist = defaultProjectCommentProfiler.profileSingleFile(content);
    const targetLang = opts.targetDominantLanguage || DEFAULT_DOMINANT_LANG;

    auditLineLevelLanguage(content, targetLang, ctx, issues, mkIssue);
    auditMacroLanguageDrift(dist, targetLang, ctx, issues, mkIssue);
    auditMixedLanguageIncoherence(dist, ctx, issues, mkIssue);
}

/**
 * Audit effective comment density and flag tautological water-logging.
 *
 * @param content - Full source text of the file
 * @param ctx - Analyzer execution context
 * @param issues - Output accumulator for detected issues
 * @param mkIssue - Factory callback to instantiate canonical issues
 */
export function auditCommentDensity(
    content: string,
    ctx: AnalyzerContext,
    issues: Issue[],
    mkIssue: IssueFactory,
): void {
    const metrics = evaluateEffectiveCommentDensity(content);
    if (metrics.hasWaterLogging && metrics.totalCommentLines >= MIN_WATER_LOGGING_LINES) {
        const firstTrivial = metrics.snippets.find((s) => s.isWaterLogging);
        const lineIdx = firstTrivial ? firstTrivial.line - 1 : 0;
        issues.push(
            mkIssue(
                ctx,
                lineIdx,
                'CMT-VMD-001',
                'Low effective comment density or tautological water-logging detected ' +
                    `(ECR: ${metrics.effectiveCommentRatio}).`,
                SEVERITY_WARNING,
                { metrics },
                'Replace mechanical word-by-word echoes with substantive design rationale, ' +
                    'constraints, and invariant documentation.',
            ),
        );
    }
}

/**
 * Audit alignment between docstring contract claims and function AST behavior.
 *
 * @param content - Full source text of the file
 * @param ctx - Analyzer execution context
 * @param issues - Output accumulator for detected issues
 * @param mkIssue - Factory callback to instantiate canonical issues
 */
export function auditCommentSemanticDuty(
    content: string,
    ctx: AnalyzerContext,
    issues: Issue[],
    mkIssue: IssueFactory,
): void {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/);
        if (fnMatch) {
            const symbol = fnMatch[1];
            let docText = '';
            let j = i - 1;
            while (
                j >= 0 &&
                (lines[j].trim().startsWith('//') ||
                    lines[j].trim().startsWith('*') ||
                    lines[j].trim().startsWith('/*'))
            ) {
                docText = lines[j] + '\n' + docText;
                j--;
            }
            const bodyEnd = Math.min(lines.length, i + LOOKAHEAD_BODY_LINES);
            const bodyText = lines.slice(i, bodyEnd).join('\n');
            const mismatches = matchCommentCodeDuty(symbol, docText, bodyText, i + 1);
            for (const m of mismatches) {
                issues.push(
                    mkIssue(
                        ctx,
                        i,
                        'CMT-INT-001',
                        m.message,
                        SEVERITY_WARNING,
                        { symbol, claimedContract: m.claimedContract },
                        m.suggestion,
                    ),
                );
            }
        }
    }
}
