/**
 * Module: Core Reporting — AAS Remediation Recipe Generator
 * File Path: src/core/reporting/aas-remediation.ts
 * Architecture Role: Builds actionable remediation recipes and concise suggestion templates.
 * Dependencies & Triggers: Consumes ../types and ./aas-types; imported by aas-reporter.ts.
 * Responsibilities:
 *   1. Resolve semantic action verb from canonical rule identifier.
 *   2. Sanitize and bound suggestion templates (<= 80 chars) to prevent prose bloat.
 *   3. Assemble AasFixRecipe with actionable patch, template snippet, and safety flags.
 * Exit Semantics & Design Rationale: Pure, non-throwing transformation; CC <= 10, Depth <= 3.
 */

import type { Issue } from '../types';
import type { AasFixRecipe } from './aas-types';

/** Remediation action code instructing identifier renaming to match domain conventions. */
export const ACTION_RENAME_IDENTIFIER = 'rename_identifier';
/** Remediation action code instructing extraction of inline literals into named constants. */
export const ACTION_EXTRACT_CONSTANT = 'extract_constant';
/** Remediation action code instructing decomposition of oversized files into cohesive modules. */
export const ACTION_SPLIT_FILE = 'split_file';
/** Remediation action code instructing control-flow flattening and branch extraction. */
export const ACTION_DECOMPOSE_COMPLEXITY = 'decompose_complexity';
/** Remediation action code instructing syntactic simplification and dead-branch removal. */
export const ACTION_SIMPLIFY_CODE = 'simplify_code';
/** Remediation action code instructing hot-path allocation or I/O throughput optimization. */
export const ACTION_OPTIMIZE_PERFORMANCE = 'optimize_performance';
/** Remediation action code instructing architectural boundary decoupling and inversion repair. */
export const ACTION_DECOUPLE_ARCHITECTURE = 'decouple_architecture';
/** Remediation action code instructing import cycle breaking or dependency graph hygiene. */
export const ACTION_RESOLVE_DEPENDENCY = 'resolve_dependency';
/** Remediation action code instructing taint sanitization or cryptographic hardening. */
export const ACTION_HARDEN_SECURITY = 'harden_security';
/** Remediation action code instructing physical file encoding, whitespace, or comment cleanup. */
export const ACTION_SANITIZE_HYGIENE = 'sanitize_hygiene';
/** Fallback remediation action code for general structural refactoring findings. */
export const ACTION_REFACTOR = 'refactor';

/** Legacy rule identifier alias matching hardcoded string literal findings. */
export const RULE_HARDCODED_STRING = 'hardcoded-string';
/** Legacy rule identifier alias matching unexplained numeric literal findings. */
export const RULE_MAGIC_NUMBER = 'magic-number';
/** Legacy rule identifier alias matching file volume budget findings. */
export const RULE_LARGE_FILE = 'large-file';
/** Legacy rule identifier alias matching cyclomatic complexity budget findings. */
export const RULE_HIGH_COMPLEXITY = 'high-complexity';

const MAX_SUGGESTION_CHARS = 80;
const ELLIPSIS_TRUNCATE_CHARS = 77;
const ELLIPSIS = '…';
const GENERIC_PLACEHOLDER_RE = /\b(?:[A-Z0-9_]+_TEXT|MAGIC_NUMBER_\d+|CONST_\d+)\b/;
const CODE_TEMPLATE_PREFIX_RE = /^(?:const\s+|let\s+|function\s+|export\s+|import\s+|return\s+|`)/;

const SENTENCE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
    [
        /Identifier\s+('?[a-zA-Z0-9_$-]+'?)\s+contains\s+unapproved\s+truncated\s+abbreviation\s+('?[a-zA-Z0-9_$-]+'?)\.?/i,
        'identifier $1 unapproved abbr $2',
    ],
    [
        /Identifier\s+('?[a-zA-Z0-9_$-]+'?)\s+is\s+vague\s+and\s+uninformative;\s*lacks\s+domain\s+context\.?/i,
        'identifier $1 lacks domain context',
    ],
    [
        /(?:Function\s+or\s+method\s+name|Local\s+variable\s+name|Variable\s+name)\s+('?[a-zA-Z0-9_$-]+'?)\s+is\s+too\s+short\s*\(([^)]+)\)[^.]*\.?/i,
        'symbol $1 too short ($2)',
    ],
    [
        /(?:Function\s+or\s+method\s+name|Variable\s+name)\s+('?[a-zA-Z0-9_$-]+'?)\s+is\s+excessively\s+long\s*\(([^)]+)\)[^.]*\.?/i,
        'symbol $1 too long ($2)',
    ],
    [
        /Symbol\s+('?[a-zA-Z0-9_$-]+'?)\s+exhibits\s+excessive\s+length\s*\((\d+)\s*chars,\s*(\d+)\s*segments\)(?:[^]*)?/i,
        'symbol $1 len=$2 segs=$3',
    ],
    [
        /(?:Function\s+or\s+method\s+name|Method\s+name|Function\s+name)\s+('?[a-zA-Z0-9_$-]+'?)\s+violates\s+verb-noun\s+contract(?:[^]*)?/i,
        'fn $1 lacks verb prefix',
    ],
    [
        /Cognitive\s+complexity\s*\((\d+)\)\s*exceeds\s*threshold\s*\((\d+)\)\s*in\s*(?:function|method)?\s*('?[a-zA-Z0-9_$-]+'?)/i,
        'CC $1 > $2 in $3',
    ],
    [/Effective\s+code\s+volume\s+budget\s+exceeded\.?/i, 'ELOC budget exceeded'],
    [/Physical\s+line\s+count\s+ceiling\s+exceeded\.?/i, 'LOC ceiling exceeded'],
    [/Dynamic\s+dilution\s+envelope\s+exceeded\.?/i, 'dilution envelope exceeded'],
    [/Effective\s+logic\s+density\s+below\s+floor\s+threshold\.?/i, 'token density below floor'],
    [
        /(?:Function|Method)\s+has\s+(\d+)\s+positional\s+parameters?\s+exceeding\s+threshold\s+of\s+(\d+)\.?/i,
        'params $1 > $2',
    ],
    [
        /(?:Function|Method)\s+["']?([a-zA-Z0-9_$-]+)["']?\s+has\s+(\d+)\s+parameters?\s*\(limit\s+(\d+)\)(?:[^]*)?/i,
        "fn '$1' params $2 > $3",
    ],
    [
        /(?:Function|Method)\s+["']?([a-zA-Z0-9_$-]+)["']?\s+(?:is|has)\s+(\d+)\s+lines?(?:\s+long)?\s*\((?:limit|max|threshold)\s+(\d+)\)(?:[^]*)?/i,
        "fn '$1' lines $2 > $3",
    ],
    [
        /Synchronous\s+('?[a-zA-Z0-9_$.-]+'?)\s+blocks\s+event\s+loop\.?/i,
        'sync $1 blocks event loop',
    ],
    [/Sync\s+I\/O\s+in\s+async\s+(?:method|function)\.?/i, 'sync IO in async fn'],
    [
        /Zero\s+transient\s+heap\s+allocation\s+(?:in\s+hot\s+loop\s+bodies\s+)?violated\.?/i,
        'loop transient heap allocation',
    ],
    [
        /Control\s+flow\s+nesting\s+depth\s*\((\d+)\)\s*exceeds\s*(?:limit|threshold)\s*(?:\((\d+)\)|\s*(\d+))\.?/i,
        'nesting depth $1 > $2$3',
    ],
    [
        /Procedure\s+line\s+count\s*\((\d+)\)\s*exceeds\s*(?:single-responsibility\s+)?limit\s*(?:\((\d+)\)|\s*(\d+))\.?/i,
        'procedure lines $1 > $2$3',
    ],
    [
        /Magic\s+number\s+(-?\d+(?:\.\d+)?)\s+should\s+be\s+extracted\s+into\s+a\s+named\s+constant\.?/i,
        'magic num $1 -> const',
    ],
    [/Magic\s+number\s+(\d+)\s+detected(?:[^.]*)?\.?/i, 'magic number $1'],
    [
        /Hardcoded\s+string\s+should\s+be\s+extracted\s+into\s+a\s+named\s+constant\.?/i,
        'hardcoded string -> const',
    ],
    [
        /Literal\s+string\s+("?[^"]+"?|'?[^']+'?)\s+should\s+be\s+constant\.?/i,
        'literal string $1 not constant',
    ],
    [
        /(?:Duplicate\s+string\s+literal|String\s+literal)\s+("?[^"]+"?|'?[^']+'?)\s+(?:is\s+duplicated|found|repeated)\s+(\d+)\s+times(?:[^]*)?/i,
        'dup literal $1 x$2',
    ],
    [
        /File\s+is\s+large;\s*consider\s+splitting\s*\(lines\s+(\d+)\s*>=\s*(?:warn|error|fail)?\s*threshold\s+(\d+)\)\.?/i,
        'file lines $1 >= $2 (split)',
    ],
    [
        /File(?:\s+name)?\s+('?[a-zA-Z0-9_$.-]+'?)\s+violates\s+([a-zA-Z0-9_-]+)\s+naming\s+convention(?:[^]*)?/i,
        'file $1 !$2',
    ],
    [
        /CommonJS\s+require\s+in\s+a\s+module\s+that\s+already\s+uses\s+ESM\s+syntax\.?/i,
        'CJS require in ESM module',
    ],
    [
        /(?:Production\s+)?console(?:\.[a-zA-Z]+)?\s+(?:statement|call)\s+detected(?:[^]*)?/i,
        'console call in prod',
    ],
    [
        /String\s+literal\s+("[^"]*"|'[^']*')\s*\(len=(\d+)\)\s+appears\s+to\s+be\s+a\s+hardcoded\s+UI\s+message\s+or\s+config\s+value\.?/i,
        'hardcoded string $1 ($2c)',
    ],
    [
        /Numeric\s+literal\s+(-?\d+(?:\.\d+)?)\s+should\s+be\s+extracted\s+to\s+a\s+named\s+constant\.?/i,
        'magic number $1',
    ],
    [
        /File\s+has\s+(\d+)\s+lines\s*\(max\s+(\d+)\);\s*(\d+)\s+exports\.\s*See\s+split\s+suggestions\s+in\s+detail\.?/i,
        'file $1 > $2 lines ($3 exports)',
    ],
    [
        /(?:Function|Method)\s+('?[a-zA-Z0-9_$-]+'?)\s+declares\s+(\d+)\s+parameters?\s*\(limit:\s*(\d+)\)(?:[^]*)?/i,
        'fn $1 $2 > $3 params',
    ],
    [
        /CommonJS\s+'require\(\.\.\.\)'\s+detected\s+in\s+TypeScript\s+module(?:[^]*)?/i,
        'CommonJS require() in ESM',
    ],
    [
        /(?:Facade\s+method\s+merely\s+delegates\s+to\s+[^.]*|Single-target\s+pass-through\s+trampoline\s+detected)\.?/i,
        'trampoline pass-through',
    ],
];

/**
 * Compresses diagnostic narrative into high-information-density token sentence.
 *
 * @param rawText - Raw narrative diagnostic string.
 * @returns Concise token-dense diagnostic sentence.
 */
export function compressDiagnosticSentence(rawText: string): string {
    if (!rawText) return '';
    let messageText = rawText.replace(/\s+/g, ' ').trim();

    for (let i = 0; i < SENTENCE_REPLACEMENTS.length; i++) {
        const [pattern, replacement] = SENTENCE_REPLACEMENTS[i];
        messageText = messageText.replace(pattern, replacement);
    }

    messageText = messageText
        .replace(/^(?:Notice|Warning|Error|Violation|Failed):\s*/i, '')
        .replace(
            /\s*(?:;\s*(?:consider|extract|split|use|prefer)\s+[^.]+|\.\s*(?:Introduce|Extract|Split|Consider|Decompose|Replace|Use|Ensure|Move)\s+[^]+|\s*\((?:e\.g\.|i\.e\.)[^)]*\).*)$/i,
            '',
        );
    return messageText.trim().replace(/\.$/, '');
}

/**
 * Resolves concise semantic action verb from canonical rule identifier.
 *
 * @param rule - Canonical rule identifier.
 * @returns Semantic remediation action verb.
 */
export function resolveActionFromRule(rule: string): string {
    if (rule.startsWith('NAM-')) return ACTION_RENAME_IDENTIFIER;
    if (rule.startsWith('CST-') || rule === RULE_HARDCODED_STRING || rule === RULE_MAGIC_NUMBER) {
        return ACTION_EXTRACT_CONSTANT;
    }
    if (rule.startsWith('BIG-') || rule === RULE_LARGE_FILE) return ACTION_SPLIT_FILE;
    if (rule.startsWith('CPX-') || rule === RULE_HIGH_COMPLEXITY)
        return ACTION_DECOMPOSE_COMPLEXITY;
    if (rule.startsWith('SIM-')) return ACTION_SIMPLIFY_CODE;
    if (rule.startsWith('PRF-')) return ACTION_OPTIMIZE_PERFORMANCE;
    if (rule.startsWith('ARCH-')) return ACTION_DECOUPLE_ARCHITECTURE;
    if (rule.startsWith('DEP-')) return ACTION_RESOLVE_DEPENDENCY;
    if (rule.startsWith('SEC-')) return ACTION_HARDEN_SECURITY;
    if (rule.startsWith('HYG-')) return ACTION_SANITIZE_HYGIENE;
    return ACTION_REFACTOR;
}

/**
 * Extracts concise, single-clause suggestion template without splitting on abbreviations.
 *
 * @param rawContent - Raw suggestion text.
 * @returns Bounded single-clause suggestion or undefined.
 */
export function cleanSuggestion(rawContent: string): string | undefined {
    if (!rawContent) return undefined;
    const trimmed = rawContent
        .trim()
        .replace(
            /^(?:Please\s+|Consider\s+|It\s+is\s+(?:recommended|required)\s+to\s+|You\s+should\s+|Ensure\s+that\s+|Try\s+to\s+)/i,
            '',
        );
    const splitIndex = trimmed.search(/(?<!\b(?:e\.g|i\.e|etc|vs|cf|fig))\.\s+|[!?\n]/i);
    const firstClause =
        splitIndex !== -1 ? trimmed.slice(0, splitIndex).trim() : trimmed.replace(/\.$/, '').trim();
    if (firstClause.length <= MAX_SUGGESTION_CHARS) {
        return firstClause;
    }
    return firstClause.slice(0, ELLIPSIS_TRUNCATE_CHARS) + ELLIPSIS;
}

function isUsablePatchText(text: string | undefined): boolean {
    if (!text) return false;
    return !GENERIC_PLACEHOLDER_RE.test(text);
}

/**
 * Builds actionable remediation recipe from issue metadata.
 *
 * @param issue - Detected static analysis issue.
 * @returns Actionable fix recipe or undefined.
 */
export function buildFixRecipe(issue: Issue): AasFixRecipe | undefined {
    const actionable = issue.actionable;
    if (actionable?.action) {
        const rawTemplate = actionable.templateSnippet;
        const conciseTemplate =
            rawTemplate && isUsablePatchText(rawTemplate)
                ? cleanSuggestion(rawTemplate)
                : undefined;
        const patchValue = actionable.patch;
        const hasValidPatch =
            typeof patchValue === 'string'
                ? isUsablePatchText(patchValue)
                : Boolean(patchValue && isUsablePatchText(patchValue.replacementText));
        const isSafe = hasValidPatch ? actionable.safeToAutomate : false;
        return {
            action: actionable.action,
            ...(hasValidPatch && patchValue ? { patch: patchValue } : {}),
            ...(conciseTemplate ? { template: conciseTemplate } : {}),
            ...(actionable.safeToAutomate !== undefined ? { safeToAutomate: isSafe } : {}),
        };
    }
    if (issue.suggestion) {
        const isCodeSnippet = CODE_TEMPLATE_PREFIX_RE.test(issue.suggestion.trim());
        const concise = isCodeSnippet ? cleanSuggestion(issue.suggestion) : undefined;
        return {
            action: resolveActionFromRule(issue.rule),
            ...(concise ? { template: concise } : {}),
        };
    }
    return undefined;
}
