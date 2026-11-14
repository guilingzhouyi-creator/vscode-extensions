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
    hasDefaultTerminologyCandidate,
    auditTerminologyProse,
} from '../terminology-engine';
import { fileNameEndsWith, isToolOrTestScript } from '../pathScope';
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';
import { CODE_GOV_PROSE_SANITIZATION } from '../../constants/rule-codes';

const CHAR_CODE_TAB = 9;
const CHAR_CODE_LF = 10;
const CHAR_CODE_CR = 13;
const CHAR_CODE_SPACE = 32;
const CHAR_CODE_HASH = 35;
const CHAR_CODE_ASTERISK = 42;
const CHAR_CODE_SLASH = 47;
const CHAR_CODE_DIGIT_ZERO = 48;
const CHAR_CODE_DIGIT_NINE = 57;
const CHAR_CODE_DOLLAR = 36;
const CHAR_CODE_HYPHEN = 45;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const CHAR_CODE_UNDERSCORE = 95;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const CHAR_CODE_ASCII_MAX = 127;
const MIN_DOSSIER_LINE_LEN = 3;
const COMMENT_PREFIX_TRIGGERS: readonly string[] = ['//', '*', '#'];
const DIAGNOSTIC_MESSAGE_TRIGGERS: readonly string[] = ['mkIssue', 'message:', 'suggestion:'];
const HAS_NON_ASCII_RE = /[^\u0000-\u007f]/;
const COMMENT_WHITESPACE_RE = /\s/;

/**
 * Zero-allocation comment prefix check matching C-family (`//`, `/*`, `*`) and `#` lines.
 */
function isCommentLineFast(line: string): boolean {
    const len = line.length;
    if (len === 0) return false;
    let i = 0;
    while (i < len) {
        const c = line.charCodeAt(i);
        const isAsciiWs =
            c === CHAR_CODE_SPACE ||
            c === CHAR_CODE_TAB ||
            (c >= CHAR_CODE_LF && c <= CHAR_CODE_CR);
        if (isAsciiWs || (c > CHAR_CODE_ASCII_MAX && COMMENT_WHITESPACE_RE.test(line[i]))) {
            i++;
            continue;
        }
        break;
    }
    if (i >= len) return false;
    const first = line.charCodeAt(i);
    if (first === CHAR_CODE_ASTERISK || first === CHAR_CODE_HASH) return true;
    if (first === CHAR_CODE_SLASH && i + 1 < len) {
        const second = line.charCodeAt(i + 1);
        return second === CHAR_CODE_SLASH || second === CHAR_CODE_ASTERISK;
    }
    return false;
}

function hasAsciiDigit(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c >= CHAR_CODE_DIGIT_ZERO && c <= CHAR_CODE_DIGIT_NINE) return true;
    }
    return false;
}

function isTokenIdentCharCode(code: number): boolean {
    return (
        (code >= CHAR_CODE_UPPER_A && code <= CHAR_CODE_UPPER_Z) ||
        (code >= CHAR_CODE_LOWER_A && code <= CHAR_CODE_LOWER_Z) ||
        (code >= CHAR_CODE_DIGIT_ZERO && code <= CHAR_CODE_DIGIT_NINE) ||
        code === CHAR_CODE_UNDERSCORE ||
        code === CHAR_CODE_DOLLAR ||
        code === CHAR_CODE_HYPHEN
    );
}

function containsExactToken(line: string, token: string): boolean {
    const tokenLen = token.length;
    if (tokenLen === 0 || line.length < tokenLen) return false;
    const limit = line.length - tokenLen;
    for (let pos = 0; pos <= limit; pos++) {
        if (pos > 0 && isTokenIdentCharCode(line.charCodeAt(pos - 1))) continue;
        const end = pos + tokenLen;
        if (end < line.length && isTokenIdentCharCode(line.charCodeAt(end))) continue;
        let matched = true;
        for (let k = 0; k < tokenLen; k++) {
            if (line.charCodeAt(pos + k) !== token.charCodeAt(k)) {
                matched = false;
                break;
            }
        }
        if (matched) return true;
    }
    return false;
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

const CHINESE_CONSTRUCTION_JARGON_RE =
    /(?:临时方案|临时代码|临时处理|临时绕过|临时修复|先这样|待处理|后续再看|占位代码|打补丁|草率|先顶着|应急处理)/;

/**
 * Checks whether a single source line contains temporary task jargon or `WIP` markers in comments.
 */
function checkCommentLineJargon(line: string, lineIndex: number): GovernanceViolation | null {
    if (!isCommentLineFast(line) || isJargonSelfReference(line)) return null;

    const match = CONSTRUCTION_JARGON_RE.exec(line);
    let matchedText = match ? match[0] : '';
    let matchIdx = match ? match.index : -1;

    if (!match && HAS_NON_ASCII_RE.test(line)) {
        const zhMatch = CHINESE_CONSTRUCTION_JARGON_RE.exec(line);
        if (zhMatch) {
            matchedText = zhMatch[0];
            matchIdx = zhMatch.index;
        }
    }

    if (!matchedText || matchIdx < 0 || isVocabularyEnumeration(line, matchIdx, matchedText)) {
        return null;
    }

    return {
        ruleId: 'GOV-SAN-001',
        message: `Comment contains temporary batch jargon / WIP marker \`${matchedText}\`. Replace with canonical architectural description.`,
        line: lineIndex + 1,
        column: matchIdx + 1,
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
    textTrigger: COMMENT_PREFIX_TRIGGERS,
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

function hasDiagnosticTriggerToken(text: string): boolean {
    return text.includes('mkIssue') || text.includes('message:') || text.includes('suggestion:');
}

function checkDiagnosticLine(line: string, lineIndex: number): GovernanceViolation | null {
    if (!hasDiagnosticTriggerToken(line) || !CHINESE_CHAR_RE.test(line)) return null;
    if (isCommentLineFast(line)) return null;
    if (!DIAGNOSTIC_TRIGGER_RE.test(line) || GOV_MSG_001_MARKER_RE.test(line)) return null;

    return {
        ruleId: GOV_MSG_001_ID,
        message: GOV_MSG_001_MESSAGE,
        line: lineIndex + 1,
        column: line.search(CHINESE_CHAR_RE) + 1,
        suggestion: GOV_MSG_001_SUGGESTION,
        fixable: false,
    };
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
    textTrigger: DIAGNOSTIC_MESSAGE_TRIGGERS,
    rationale:
        'All low-level diagnostic messages, analyzer issues, and remediation suggestions must strictly use technical English to maintain industrial compatibility and avoid encoding artifacts.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (isExemptDiagnosticFile(ctx.filePath)) return null;
        if (!hasDiagnosticTriggerToken(ctx.content) || !CHINESE_CHAR_RE.test(ctx.content)) {
            return null;
        }

        const violations: GovernanceViolation[] = [];
        const lines = ctx.lines;

        for (let i = 0; i < lines.length; i++) {
            const hit = checkDiagnosticLine(lines[i], i);
            if (hit) violations.push(hit);
        }

        return violations.length > 0 ? violations : null;
    },
};

const DOSSIER_JARGON_RE =
    /\b(st_[0-9]+[a-z0-9_]*|phase[\s_]*[0-9]+|p[0-9]{2,}|milestone[\s_]*[0-9]+)\b/i;

/**
 * Checks whether a line references dossier self-governance identifiers without allocation.
 */
function isDossierSelfReference(line: string): boolean {
    return (
        containsExactToken(line, 'DOSSIER_JARGON_RE') ||
        containsExactToken(line, 'GOV-ARC-001') ||
        containsExactToken(line, 'DossierBoundaryIsolationRule')
    );
}

function isExemptDossierPath(filePath: string): boolean {
    const normalized = (
        filePath.includes('\\') ? filePath.replace(/\\/g, '/') : filePath
    ).toLowerCase();
    return (
        /(?:\/|^)(?:archive|fixtures?|tests?|history)(?:\/|$)/i.test(normalized) ||
        normalized.startsWith('archive/') ||
        fileNameEndsWith(filePath, ['sanitization.ts'])
    );
}

/**
 * Evaluates a single source line for historical dossier nomenclature violations.
 */
function checkDossierLine(line: string, lineIndex: number): GovernanceViolation | null {
    if (line.length < MIN_DOSSIER_LINE_LEN || !hasAsciiDigit(line)) return null;
    const match = DOSSIER_JARGON_RE.exec(line);
    if (!match || isDossierSelfReference(line)) return null;

    return {
        ruleId: 'GOV-ARC-001',
        message: `Historical dossier nomenclature or batch tag \`${match[0]}\` found outside archived directory white-list.`,
        line: lineIndex + 1,
        column: match.index != null ? match.index + 1 : 1,
        suggestion:
            'Remove milestone/batch tags from active code; use canonical product features and functional domain naming.',
        fixable: false,
    };
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
        if (!hasAsciiDigit(ctx.content) || !DOSSIER_JARGON_RE.test(ctx.content)) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.lines;

        for (let i = 0; i < lines.length; i++) {
            const hit = checkDossierLine(lines[i], i);
            if (hit) violations.push(hit);
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
    textTrigger: COMMENT_PREFIX_TRIGGERS,
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

        const candidateComments: string[] = [];
        const candidateLineNumbers: number[] = [];
        for (let i = 0; i < ctx.lines.length; i++) {
            const line = ctx.lines[i];
            if (isCommentLineFast(line) && hasDefaultTerminologyCandidate(line)) {
                candidateComments.push(line);
                candidateLineNumbers.push(i + 1);
            }
        }

        if (candidateComments.length === 0) return null;

        const commentContent = candidateComments.join('\n');
        const findings = auditTerminologyProse(commentContent, {
            allowedCategories: [
                'temporary',
                'hyperbolic_affirmative',
                'hyperbolic_negative',
                'meta_narrative',
            ],
        });

        if (findings.length === 0) return null;

        return findings.map((finding) => ({
            ruleId: 'GOV-SAN-002',
            message: finding.message,
            line: candidateLineNumbers[finding.line - 1] ?? finding.line,
            column: finding.column,
            suggestion: finding.guidance,
            fixable: false,
            customDetail: {
                category: finding.category,
                term: finding.term,
                snippet: finding.contextSnippet,
            },
            actionable: {
                action: 'sanitize_prose_terminology',
                code: CODE_GOV_PROSE_SANITIZATION,
                taxonomy: 'GOV_NORM',
                safeToAutomate: false,
                templateSnippet:
                    'Use objective, factual technical statements instead of promotional or casual phrasing.',
                targetArguments: {
                    forbiddenTerm: finding.term,
                    category: finding.category,
                },
            },
        }));
    },
};
