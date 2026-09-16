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
import { fileNameEndsWith, pathHasSegment } from '../pathScope';
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';

const JARGON_RE = /\b(p[0-9]+|phase[\s_]*[0-9]+|st[\s_]*[0-9]+|wip)\b/i;

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
 * GOV-SAN-001: Lexical Hygiene & Temporary Jargon Prevention.
 * Detects temporary development tags and batch jargon (pXX, phaseXX, stXX, wip)
 * in comments to prevent sprint-level noise from polluting long-term architecture.
 */
export const LexicalHygieneRule: GovernanceRule = {
    id: 'GOV-SAN-001',
    name: 'Lexical Hygiene & Temporary Jargon Prevention',
    category: 'maintainability',
    severity: 'warning',
    risk: 'medium',
    rationale:
        'Transient task tags and batch jargon (pXX/phaseXX/stXX/wip) compromise architectural longevity and create documentation drift.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        // Generic corpus conventions only. Project-specific file names used to be listed
        // here, which silently made the rule inert for whoever it was tuned against; the
        // enumeration check below now handles the vocabulary case without naming any file.
        // Directory membership uses the shared segment test so that a repository-relative
        // path such as `tests/a.py` is exempted too, which the substring form was not.
        if (
            pathHasSegment(ctx.filePath, 'tests') ||
            pathHasSegment(ctx.filePath, 'test') ||
            pathHasSegment(ctx.filePath, 'benchmarks') ||
            fileNameEndsWith(ctx.filePath, ['sanitization.ts'])
        ) {
            return null;
        }

        const violations: GovernanceViolation[] = [];
        const lines = ctx.lines;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Fast zero-allocation ASCII comment check
            let startIdx = 0;
            while (
                startIdx < line.length &&
                (line.charCodeAt(startIdx) === CHAR_CODE_SPACE ||
                    line.charCodeAt(startIdx) === CHAR_CODE_TAB)
            ) {
                startIdx++;
            }
            if (startIdx >= line.length) continue;
            const c0 = line.charCodeAt(startIdx);
            const c1 = line.charCodeAt(startIdx + 1);
            const isComment =
                c0 === CHAR_CODE_HASH /* '#' */ ||
                (c0 === CHAR_CODE_SLASH &&
                    (c1 === CHAR_CODE_SLASH || c1 === CHAR_CODE_ASTERISK)) /* '//' or '/*' */ ||
                c0 === CHAR_CODE_ASTERISK; /* '*' */

            if (!isComment) continue;

            // Ignore rule definitions, constants, or regex patterns
            if (
                line.includes('JARGON_RE') ||
                line.includes('LexicalHygieneRule') ||
                line.includes('GOV-SAN-001') ||
                line.includes('COMMENT-JARGON')
            ) {
                continue;
            }

            const match = JARGON_RE.exec(line);
            if (match && isVocabularyEnumeration(line, match.index, match[0])) continue;
            if (match) {
                violations.push({
                    ruleId: 'GOV-SAN-001',
                    message: `Comment contains temporary batch jargon / WIP marker \`${match[0]}\`. Replace with canonical architectural description.`,
                    line: i + 1,
                    column: (match.index ?? line.indexOf(match[0])) + 1,
                    suggestion:
                        'Remove temporary phase/task tags and use standard domain terminology.',
                    fixable: false,
                });
            }
        }

        return violations.length > 0 ? violations : null;
    },
};
