/**
 * Module: Core Engine - Governance Rules - Sanitization
 * File Path: src/core/governance/rules/sanitization.ts
 * Architecture Role: File-level rule provider exporting LexicalHygieneRule (GOV-SAN-001),
 *     invoked by GovernanceAnalyzer.finalize once per governed file and wired directly by
 *     BUILTIN_GOVERNANCE_RULES rather than through the public rules barrel.
 * Dependencies & Triggers: Imports GovernanceRule, GovernanceViolation and
 *     RuleEvaluationContext from ../types; runs whenever a CLI, CI or daemon scan enables the
 *     governance analyzer, for every language profile that keeps the rule enabled.
 * Responsibilities: JARGON_RE case-insensitively matches p-prefixed, phase/st-prefixed
 *     numbered batch tags and the three-letter work-in-progress marker; the rule exempts
 *     test, benchmark and fixture paths (including this file and audit_script_comment.py) and
 *     ignores lines naming JARGON_RE, LexicalHygieneRule, GOV-SAN-001 or COMMENT-JARGON; it
 *     treats hash, double-slash, block-comment and star lines as comments and emits one
 *     non-fixable warning per match with a 1-based line and column.
 * Exit Semantics & Design Rationale: checkFile returns null for exempt or clean files and a
 *     violation array otherwise, never throwing and performing no I/O. Exempt-first checking
 *     keeps fixture corpora quiet, the charCode ASCII scan avoids regex and trim work on every
 *     line, and findings stay advisory because transient tags are documentation debt rather
 *     than runtime defects.
 */
import { isVocabularyEnumeration } from '../markerScope';
import {
    CONSTRUCTION_JARGON_RE,
    DEFAULT_RULES_FAST_CANDIDATE_RE,
    auditTerminologyProse,
} from '../terminology-engine';
import { fileNameEndsWith, isToolOrTestScript } from '../pathScope';
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';
import { CODE_GOV_PROSE_SANITIZATION } from '../../constants/rule-codes';

/** ASCII code for a space, skipped while advancing past a line's leading whitespace. */
const CHAR_CODE_SPACE = 32;

/** ASCII code for a tab, skipped while advancing past a line's leading whitespace. */
const CHAR_CODE_TAB = 9;

/** ASCII code for `#`, the marker that starts a hash-style comment line. */
const CHAR_CODE_HASH = 35;

/** ASCII code for `/`, used to recognize `//` and `/*` comment openers. */
const CHAR_CODE_SLASH = 47;

/** ASCII code for `*`, used to recognize `/*` and bare `*` comment lines. */
const CHAR_CODE_ASTERISK = 42;

/**
 * Checks whether a single source line starts with comment delimiters.
 */
function isCommentLinePrefix(line: string): boolean {
    let startIdx = 0;
    while (
        startIdx < line.length &&
        (line.charCodeAt(startIdx) === CHAR_CODE_SPACE ||
            line.charCodeAt(startIdx) === CHAR_CODE_TAB)
    ) {
        startIdx++;
    }
    if (startIdx >= line.length) return false;
    const c0 = line.charCodeAt(startIdx);
    const c1 = line.charCodeAt(startIdx + 1);
    return (
        c0 === CHAR_CODE_HASH ||
        (c0 === CHAR_CODE_SLASH && (c1 === CHAR_CODE_SLASH || c1 === CHAR_CODE_ASTERISK)) ||
        c0 === CHAR_CODE_ASTERISK
    );
}

/**
 * Checks whether a line references internal jargon governance identifiers.
 */
function isJargonSelfReference(line: string): boolean {
    return (
        line.includes('JARGON_RE') ||
        line.includes('LexicalHygieneRule') ||
        line.includes('GOV-SAN-001') ||
        line.includes('COMMENT-JARGON')
    );
}

/**
 * Checks whether a single source line contains temporary task jargon or `WIP` markers in comments.
 */
function checkCommentLineJargon(line: string, lineIndex: number): GovernanceViolation | null {
    if (!isCommentLinePrefix(line) || isJargonSelfReference(line)) return null;

    const match = CONSTRUCTION_JARGON_RE.exec(line);
    if (!match || isVocabularyEnumeration(line, match.index, match[0])) return null;

    return {
        ruleId: 'GOV-SAN-001',
        message: `Comment contains temporary batch jargon / WIP marker \`${match[0]}\`. Replace with canonical architectural description.`,
        line: lineIndex + 1,
        column: (match.index ?? line.indexOf(match[0])) + 1,
        suggestion: 'Remove temporary phase/task tags and use standard domain terminology.',
        fixable: false,
    };
}

/**
 * GOV-SAN-001: Lexical Hygiene & Temporary Jargon Prevention.
 * Detects temporary development tags and batch jargon (such as task prefixes
 * or work-in-progress tags) in comments to prevent sprint-level noise.
 */
export const LexicalHygieneRule: GovernanceRule = {
    id: 'GOV-SAN-001',
    name: 'Lexical Hygiene & Temporary Jargon Prevention',
    category: 'maintainability',
    severity: 'warning',
    risk: 'medium',
    rationale:
        'Transient task tags and batch jargon compromise architectural longevity and create documentation drift.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (
            isToolOrTestScript(ctx.filePath) ||
            fileNameEndsWith(ctx.filePath, ['sanitization.ts'])
        ) {
            return null;
        }

        if (!CONSTRUCTION_JARGON_RE.test(ctx.content)) {
            return null;
        }

        const violations: GovernanceViolation[] = [];
        const lines = ctx.lines;

        for (let i = 0; i < lines.length; i++) {
            const hit = checkCommentLineJargon(lines[i], i);
            if (hit) violations.push(hit);
        }

        return violations.length > 0 ? violations : null;
    },
};

const CHINESE_CHAR_RE = /[\u4e00-\u9fa5]/;

const SEVERITY_WARNING_LEVEL = 'warning';
const RISK_MEDIUM_LEVEL = 'medium';
const SANITIZATION_FILENAME = 'sanitization.ts';
const TEST_DIR_NAME = 'test';
const FIXTURE_DIR_NAME = 'fixture';
const MD_EXTENSION = '.md';
const DIAGNOSTIC_TRIGGER_RE = /(?:mkIssue|message:|suggestion:)/;
const GOV_MSG_001_ID = 'GOV-MSG-001';
const GOV_MSG_001_MARKER_RE = /GOV-MSG-001/;
const GOV_MSG_001_MESSAGE =
    'Diagnostic message or suggestion contains non-English characters. Low-level analyzer diagnostics must use technical English.';
const GOV_MSG_001_SUGGESTION =
    'Replace non-English text with standardized technical English message and centralize in src/core/messages/.';

function isExemptDiagnosticFile(filePath: string): boolean {
    return (
        isToolOrTestScript(filePath) ||
        fileNameEndsWith(filePath, [SANITIZATION_FILENAME]) ||
        filePath.includes(TEST_DIR_NAME) ||
        filePath.includes(FIXTURE_DIR_NAME) ||
        filePath.endsWith(MD_EXTENSION)
    );
}

function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return (
        trimmed.startsWith('*') ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('#')
    );
}

/**
 * GOV-MSG-001: Technical diagnostic messages and suggestions in lower-level analyzers must
 * strictly adhere to standard technical English and avoid unmanaged non-ASCII strings.
 */
export const DiagnosticMessageRule: GovernanceRule = {
    id: GOV_MSG_001_ID,
    name: 'Diagnostic Messages English Standardization Contract',
    category: 'standardization',
    severity: SEVERITY_WARNING_LEVEL,
    risk: RISK_MEDIUM_LEVEL,
    rationale:
        'All low-level diagnostic messages, analyzer issues, and remediation suggestions must strictly use technical English to maintain industrial compatibility and avoid encoding artifacts.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (isExemptDiagnosticFile(ctx.filePath)) return null;
        if (!CHINESE_CHAR_RE.test(ctx.content)) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.lines;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!CHINESE_CHAR_RE.test(line)) continue;
            if (isCommentLine(line)) continue;

            if (DIAGNOSTIC_TRIGGER_RE.test(line) && !GOV_MSG_001_MARKER_RE.test(line)) {
                violations.push({
                    ruleId: GOV_MSG_001_ID,
                    message: GOV_MSG_001_MESSAGE,
                    line: i + 1,
                    column: line.search(CHINESE_CHAR_RE) + 1,
                    suggestion: GOV_MSG_001_SUGGESTION,
                    fixable: false,
                });
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

const DOSSIER_JARGON_RE =
    /\b(st_[0-9]+[a-z0-9_]*|phase[\s_]*[0-9]+|p[0-9]{2,}|milestone[\s_]*[0-9]+)\b/i;

function isExemptDossierPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return (
        /(?:\/|^)(?:archive|fixtures?|tests?|history)(?:\/|$)/i.test(normalized) ||
        normalized.startsWith('archive/') ||
        fileNameEndsWith(filePath, ['sanitization.ts'])
    );
}

/**
 * GOV-ARC-001: Historical Dossier Nomenclature Boundary Isolation Guard.
 * Restricts historical dossier batch jargon and milestone codes to archived directories.
 */
export const DossierBoundaryIsolationRule: GovernanceRule = {
    id: 'GOV-ARC-001',
    name: 'Historical Dossier Nomenclature Boundary Isolation Guard',
    category: 'maintainability',
    severity: 'warning',
    risk: 'medium',
    rationale:
        'Historical dossier batch jargon and milestone codes outside archive directories violate user-facing clarity and architectural neutrality.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (isExemptDossierPath(ctx.filePath)) return null;
        if (!DOSSIER_JARGON_RE.test(ctx.content)) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.lines;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (
                line.includes('DOSSIER_JARGON_RE') ||
                line.includes('GOV-ARC-001') ||
                line.includes('DossierBoundaryIsolationRule')
            ) {
                continue;
            }
            const match = DOSSIER_JARGON_RE.exec(line);
            if (match) {
                violations.push({
                    ruleId: 'GOV-ARC-001',
                    message: `Historical dossier nomenclature or batch tag \`${match[0]}\` found outside archived directory white-list.`,
                    line: i + 1,
                    column: match.index != null ? match.index + 1 : 1,
                    suggestion:
                        'Remove milestone/batch tags from active code; use canonical product features and functional domain naming.',
                    fixable: false,
                });
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

/**
 * GOV-SAN-002: Source Prose Terminology & Objective Technical Language Guard.
 * Analyzes comments and documentation in source files to enforce objective, factual,
 * non-hyperbolic terminology and eliminate promotional slogans or casual markers.
 */
export const ProseTerminologySanitizationRule: GovernanceRule = {
    id: 'GOV-SAN-002',
    name: 'Prose Terminology & Objective Technical Language Guard',
    category: 'maintainability',
    severity: 'warning',
    risk: 'medium',
    rationale:
        'Technical prose in source comments and docstrings must remain objective, factual, and free of hyperbolic slogans or unsubstantiated marketing claims.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (
            isToolOrTestScript(ctx.filePath) ||
            fileNameEndsWith(ctx.filePath, [SANITIZATION_FILENAME, 'terminology-engine.ts'])
        ) {
            return null;
        }

        if (!DEFAULT_RULES_FAST_CANDIDATE_RE.test(ctx.content)) {
            return null;
        }

        const commentLines: string[] = [];
        for (let i = 0; i < ctx.lines.length; i++) {
            const line = ctx.lines[i];
            if (isCommentLine(line) || isCommentLinePrefix(line)) {
                commentLines.push(line);
            } else {
                commentLines.push('');
            }
        }

        const commentContent = commentLines.join('\n');
        if (!commentContent.trim()) return null;

        const findings = auditTerminologyProse(commentContent, {
            allowedCategories: ['hyperbolic_affirmative', 'hyperbolic_negative', 'meta_narrative'],
        });

        if (findings.length === 0) return null;

        return findings.map((f) => ({
            ruleId: 'GOV-SAN-002',
            message: f.message,
            line: f.line,
            column: f.column,
            suggestion: f.guidance,
            fixable: false,
            customDetail: {
                category: f.category,
                term: f.term,
                snippet: f.contextSnippet,
            },
            actionable: {
                action: 'sanitize_prose_terminology',
                code: CODE_GOV_PROSE_SANITIZATION,
                taxonomy: 'GOV_NORM',
                safeToAutomate: false,
                templateSnippet:
                    'Use objective, factual technical statements instead of promotional or casual phrasing.',
                targetArguments: {
                    forbiddenTerm: f.term,
                    category: f.category,
                },
            },
        }));
    },
};
