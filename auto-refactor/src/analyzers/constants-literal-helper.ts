/**
 * Module: Static Analysis Engine — Constants Literal Extraction Helpers
 * File Path: src/analyzers/constants-literal-helper.ts
 * Architecture Role: Token tables, duplicate literal grouping, and issue data resolution
 *   for ConstantsAnalyzer.
 * Dependencies & Triggers: Core types, AST multilang types, and governance functions;
 *   consumed by ConstantsAnalyzer.
 * Responsibilities: Maintain domain benign token sets, resolve suggested names, filter duplicate
 *   candidates, build canonical duplicate issue objects, and strip quotes safely.
 * Exit Semantics & Design Rationale: Pure deterministic helper functions; never throws.
 */
import type { AnalyzerContext, Issue } from '../core/types';
import type { LiteralRecord } from '../core/diff/incremental-state';
import { locN } from '../utils/normalized';
import { classifyLiteral } from '../core/governance/semanticLiterals';
import {
    formatConstantDeclarationSuggestion,
    isConstantDefinitionFile,
} from '../core/intelligence/constant-identity';
import {
    ANALYZER_CONSTANTS,
    RULE_DUPLICATE_LITERAL,
    CODE_CONST_DUPLICATE_LITERAL,
    SEVERITY_WARNING,
} from '../core/constants';

/** Set of trivial numbers exempt from duplicate constant extraction. */
export const TRIVIAL_NUMBERS = new Set(['0', '1', '-1']);

/** Benign common token set exempt from duplicate-literal flagging in test suites. */
export const TEST_SUITE_BENIGN_TOKENS = new Set([
    'foo',
    'bar',
    'baz',
    'qux',
    'test',
    'sample',
    'mock',
    'dummy',
    'fake',
    '*',
    'ok',
    'err',
    'error',
    'success',
    'pass',
    'fail',
    'warning',
    'info',
    'exit',
    'status',
    'expected',
    'actual',
    'fixture',
    'file',
    'input',
    'output',
    'summary',
    'result',
    'baseline',
    'suite',
]);

/** AST and parser domain token set exempt from constant extraction in parser/ast files. */
export const AST_PARSER_BENIGN_TOKENS = new Set([
    'identifier',
    'callexpression',
    'memberexpression',
    'functiondeclaration',
    'functionexpression',
    'arrowfunctionexpression',
    'classdeclaration',
    'classexpression',
    'methoddefinition',
    'property',
    'literal',
    'string',
    'number',
    'boolean',
    'object',
    'undefined',
    'symbol',
    'type',
    'start',
    'end',
    'kind',
    'parent',
    'node',
    'body',
    'params',
    'init',
    'left',
    'right',
    'operator',
    'arguments',
    'declarations',
]);

/** Schema property token set exempt from duplicate-literal flagging in config/data tables. */
export const SCHEMA_PROPERTY_TOKENS = new Set([
    'id',
    'name',
    'type',
    'value',
    'key',
    'label',
    'desc',
    'description',
    'icon',
    'category',
    'status',
    'weight',
    'enabled',
    'disabled',
    'target',
    'item',
    'version',
    'title',
    'group',
    'order',
    'path',
    'data',
]);

/** Character code for ASCII single quote. */
export const CHAR_CODE_SINGLE_QUOTE = 39;
/** Character code for ASCII double quote. */
export const CHAR_CODE_DOUBLE_QUOTE = 34;
/** Character code for ASCII backtick. */
export const CHAR_CODE_BACKTICK = 96;
/** Upper bound for integer literal suggested names. */
export const SUGGESTED_NAME_INTEGER_LIMIT = 1000;
/** Maximum word count in suggested constant names. */
export const SUGGESTED_NAME_MAX_WORDS = 4;
/** Identifier for general literal kind. */
export const LITERAL_KIND_GENERAL = 'general';
/** Identifier for numeric literal kind. */
export const NUM_KIND = 'number';
/** Identifier for string literal kind. */
export const STR_KIND = 'string';

/**
 * Orders two literal observations by source position.
 *
 * @param a - First literal record.
 * @param b - Second literal record.
 * @returns Sort comparison number.
 */
export function byPosition(a: LiteralRecord, b: LiteralRecord): number {
    const al = a.node.start ? a.node.start.line : 0;
    const bl = b.node.start ? b.node.start.line : 0;
    if (al !== bl) return al - bl;
    const ac = a.node.start ? a.node.start.column : 0;
    const bc = b.node.start ? b.node.start.column : 0;
    return ac - bc;
}

/**
 * Checks if a character code is a quote or backtick.
 *
 * @param code - Character code.
 * @returns True when code is a quote character.
 */
export function isQuoteCharCode(code: number): boolean {
    return (
        code === CHAR_CODE_SINGLE_QUOTE ||
        code === CHAR_CODE_DOUBLE_QUOTE ||
        code === CHAR_CODE_BACKTICK
    );
}

/**
 * Fast strip leading and trailing quote characters without RegExp allocation.
 *
 * @param str - Input string literal text.
 * @returns Unquoted string.
 */
export function stripQuotes(str: string): string {
    const len = str.length;
    if (len === 0) return str;
    const start = isQuoteCharCode(str.charCodeAt(0)) ? 1 : 0;
    const end = len > start && isQuoteCharCode(str.charCodeAt(len - 1)) ? len - 1 : len;
    return start > 0 || end < len ? str.slice(start, end) : str;
}

/** Result of resolving a literal duplicate issue. */
export interface LiteralResolution {
    rule: string;
    message: string;
    detail: Record<string, unknown>;
    suggested: string;
}

/**
 * Resolves suggested constant name based on semantic classification and fallback.
 *
 * @param numeric - Whether literal is numeric.
 * @param classification - Semantic classification result.
 * @param fallback - Fallback suggested name.
 * @returns Resolved suggested constant identifier.
 */
export function resolveSuggestedName(
    numeric: boolean,
    classification: ReturnType<typeof classifyLiteral> | null,
    fallback: string,
): string {
    if (!classification) return fallback;
    const prefix = classification.suggestedConstPrefix;
    if (numeric) {
        return prefix !== 'CONST' ? prefix : fallback;
    }
    return prefix !== 'CONST_STR' ? `${prefix}_${fallback}` : fallback;
}

/**
 * Resolves diagnostic message for literal extraction issue.
 *
 * @param value - Raw literal value.
 * @param numeric - Whether literal is numeric.
 * @param isGranular - Whether granular rule mode is active.
 * @param rationale - Optional classification rationale.
 * @returns Formatted issue message.
 */
export function resolveLiteralMessage(
    value: string,
    numeric: boolean,
    isGranular: boolean,
    rationale?: string,
): string {
    if (isGranular && rationale) {
        return `${rationale}: ${value} should be extracted.`;
    }
    return numeric
        ? `Magic number ${value} should be extracted into a named constant.`
        : 'Hardcoded string should be extracted into a named constant.';
}

/**
 * Resolves complete issue payload for a detected literal.
 *
 * @param value - Literal value string.
 * @param numeric - Whether literal is numeric.
 * @param classification - Semantic classification result.
 * @param granular - Whether granular rules are enabled.
 * @param suggestedNameFallback - Fallback name.
 * @returns Literal issue data structure.
 */
export function resolveLiteralIssueData(
    value: string,
    numeric: boolean,
    classification: ReturnType<typeof classifyLiteral> | null,
    granular: boolean,
    suggestedNameFallback: string,
): LiteralResolution {
    const isGranular = Boolean(
        granular && classification && classification.kind !== LITERAL_KIND_GENERAL,
    );
    const defaultRule = numeric ? 'magic-number' : 'hardcoded-string';
    const rule = isGranular ? `literal-${classification!.kind}` : defaultRule;
    const suggested = resolveSuggestedName(numeric, classification, suggestedNameFallback);
    const message = resolveLiteralMessage(value, numeric, isGranular, classification?.rationale);

    const detail: Record<string, unknown> = numeric
        ? {
              value,
              numeric: true,
              suggestedName: suggested,
              ...(classification
                  ? { semanticKind: classification.kind, rationale: classification.rationale }
                  : {}),
          }
        : {
              value,
              length: stripQuotes(value).length,
              suggestedName: suggested,
              ...(classification
                  ? { semanticKind: classification.kind, rationale: classification.rationale }
                  : {}),
          };

    return { rule, message, detail, suggested };
}

/**
 * Resolves duplicate literal count threshold based on file context.
 *
 * @param base - Base threshold from options.
 * @param isTest - Whether file is a test suite.
 * @param isDataOrConfig - Whether file is data or config.
 * @returns Threshold count.
 */
export function resolveDuplicateThreshold(
    base: number,
    isTest: boolean,
    isDataOrConfig: boolean,
): number {
    if (isTest) return Math.max(base * 3, 12);
    if (isDataOrConfig) return Math.max(base * 2, 8);
    return base;
}

/**
 * Checks if a file role is data or config definition.
 *
 * @param role - Inferred file role.
 * @param filePath - Path to source file.
 * @returns True when file represents data or config.
 */
export function isDataOrConfigFile(role: string, filePath: string): boolean {
    return (
        role === 'config_constant' ||
        role === 'rules_registry' ||
        filePath.endsWith('.json') ||
        isConstantDefinitionFile(filePath)
    );
}

/**
 * Checks if a numeric literal is a duplicate candidate.
 *
 * @param value - Numeric literal value.
 * @param magicNumberMin - Magic number minimum threshold.
 * @returns True when numeric value qualifies.
 */
export function isNumericDuplicateCandidate(value: string, magicNumberMin: number): boolean {
    if (TRIVIAL_NUMBERS.has(value)) return false;
    return Math.abs(Number(value)) >= magicNumberMin;
}

/**
 * Checks if a string literal is a duplicate candidate.
 *
 * @param value - String literal value.
 * @param ignoreSet - Set of ignored string literals.
 * @param isTest - Whether test suite.
 * @param isDataOrConfig - Whether data/config.
 * @param isAlgorithm - Whether algorithm code.
 * @returns True when string qualifies.
 */
export function isStringDuplicateCandidate(
    value: string,
    ignoreSet: Set<string>,
    isTest: boolean,
    isDataOrConfig: boolean,
    isAlgorithm = false,
): boolean {
    const str = stripQuotes(value).trim();
    if (str.length === 0 || ignoreSet.has(value) || ignoreSet.has(str)) return false;
    const lower = str.toLowerCase();
    if (isTest && TEST_SUITE_BENIGN_TOKENS.has(lower)) return false;
    if (isDataOrConfig && SCHEMA_PROPERTY_TOKENS.has(lower)) return false;
    if (isAlgorithm && AST_PARSER_BENIGN_TOKENS.has(lower)) return false;
    return true;
}

/**
 * Checks if a literal record is a candidate for duplicate grouping.
 *
 * @param lit - Literal record.
 * @param magicNumberMin - Minimum numeric limit.
 * @param ignoreSet - Ignored literals set.
 * @param classify - Whether classification enabled.
 * @param isTest - Whether test suite.
 * @param isDataOrConfig - Whether data/config.
 * @param isAlgorithm - Whether algorithm file.
 * @returns True when candidate.
 */
export function isDuplicateCandidate(
    lit: LiteralRecord,
    magicNumberMin: number,
    ignoreSet: Set<string>,
    classify: boolean,
    isTest = false,
    isDataOrConfig = false,
    isAlgorithm = false,
): boolean {
    if (lit.isConstBound || lit.tolerated) return false;
    const candidate = lit.numeric
        ? isNumericDuplicateCandidate(lit.value, magicNumberMin)
        : isStringDuplicateCandidate(lit.value, ignoreSet, isTest, isDataOrConfig, isAlgorithm);
    if (!candidate) return false;
    return !(classify && classifyLiteral(lit.value, lit.numeric).isReasonable);
}

/**
 * Groups duplicate literals across all collected records in a file.
 *
 * @param literals - All collected literal records.
 * @param magicNumberMin - Minimum numeric threshold.
 * @param ignoreSet - Set of ignored literal values.
 * @param classify - Whether semantic classification is enabled.
 * @param isTest - Whether file is test suite.
 * @param isDataOrConfig - Whether file is data/config.
 * @param isAlgorithm - Whether file is algorithm/parser.
 * @returns Map of literal key to array of occurrences.
 */
export function groupDuplicates(
    literals: LiteralRecord[],
    magicNumberMin: number,
    ignoreSet: Set<string>,
    classify: boolean,
    isTest = false,
    isDataOrConfig = false,
    isAlgorithm = false,
): Map<string, LiteralRecord[]> {
    const groups = new Map<string, LiteralRecord[]>();
    for (const lit of literals) {
        if (
            !isDuplicateCandidate(
                lit,
                magicNumberMin,
                ignoreSet,
                classify,
                isTest,
                isDataOrConfig,
                isAlgorithm,
            )
        ) {
            continue;
        }
        const key = `${lit.numeric ? 'N' : 'S'}:${lit.value}`;
        const arr = groups.get(key) || [];
        arr.push(lit);
        groups.set(key, arr);
    }
    return groups;
}

/**
 * Builds an actionable Issue object for duplicate literals.
 *
 * @param ctx - Analyzer context.
 * @param arr - Array of duplicate literal records.
 * @param suggested - Suggested constant name.
 * @returns Constructed Issue object.
 */
export function buildDuplicateIssue(
    ctx: AnalyzerContext,
    arr: LiteralRecord[],
    suggested: string,
): Issue {
    const first = arr[0];
    return {
        id:
            `${ANALYZER_CONSTANTS}:${RULE_DUPLICATE_LITERAL}:${ctx.filePath}:` +
            `${first.node.start?.line ?? 1}`,
        analyzer: ANALYZER_CONSTANTS,
        rule: RULE_DUPLICATE_LITERAL,
        severity: SEVERITY_WARNING,
        message: `Literal ${first.value} is repeated ${arr.length} times in this file; extract it into a shared constant.`,
        location: locN(first.node, ctx.filePath),
        detail: {
            value: first.value,
            numeric: first.numeric,
            occurrences: arr.length,
            lines: arr.map((l) => l.node.start?.line ?? 1),
            suggestedName: suggested,
        },
        suggestion: formatConstantDeclarationSuggestion(
            ctx.filePath,
            suggested,
            first.value,
            first.numeric,
            `used ${arr.length}x`,
        ),
        actionable: {
            action: 'extract_constant',
            code: CODE_CONST_DUPLICATE_LITERAL,
            targetScope: 'module_top_level',
            targetSymbol: suggested,
            insertAnchor: { position: 'after_imports' },
            safeToAutomate: true,
        },
    };
}
