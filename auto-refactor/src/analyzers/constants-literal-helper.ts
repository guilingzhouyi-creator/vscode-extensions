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
import { stripQuotes } from '../core/scanner/text-scanner-utils';

export { stripQuotes };

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

/** Benign default mapping tokens exempt from duplicate-literal flagging in constant catalogs. */
export const CONSTANT_DEFAULT_MAPPING_TOKENS = new Set([
    'default',
    'none',
    'unknown',
    'auto',
    'all',
    'misc',
    'empty',
    'undefined',
    'null',
    'na',
    'n/a',
    'other',
    'general',
    'normal',
    'standard',
    'custom',
    'initial',
    'reset',
]);

/** Common web, DOM event, and standard framework tokens exempt from constant extraction. */
export const WEB_AND_DOM_BENIGN_TOKENS = new Set([
    'click',
    'dblclick',
    'change',
    'input',
    'submit',
    'focus',
    'blur',
    'keydown',
    'keyup',
    'keypress',
    'load',
    'unload',
    'resize',
    'scroll',
    'message',
    'close',
    'open',
    'aria-label',
    'aria-hidden',
    'title',
    'alt',
    'role',
    'target',
    'rel',
    'href',
    'src',
    'text/csv',
    'text/css',
    'text/javascript',
    'text/plain',
    'text/html',
    'application/json',
    'application/pdf',
    'application/octet-stream',
    'electron',
    'node:fs',
    'node:path',
    'node:os',
    'node:url',
    'node:http',
    'node:https',
    'node:crypto',
    'node:child_process',
    'node:util',
    'node:stream',
    '<pre>',
    '</pre>',
    '<div>',
    '</div>',
    '<span>',
    '</span>',
    '* [',
    '](',
    '][',
    'win',
    '_blank',
    '_self',
    '_parent',
    '_top',
    'article :header',
    ':header',
    ':visible',
    ':hidden',
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

const PREFIX_CONST = 'CONST';
const PREFIX_CONST_STR = 'CONST_STR';

const RULE_MAGIC_NUMBER = 'magic-number';
const RULE_HARDCODED_STRING = 'hardcoded-string';

const THRESHOLD_MULTIPLIER_TEST = 3;
const THRESHOLD_MIN_TEST = 12;
const THRESHOLD_MULTIPLIER_DATA = 2;
const THRESHOLD_MIN_DATA = 8;

const ROLE_CONFIG_CONSTANT = 'config_constant';
const ROLE_RULES_REGISTRY = 'rules_registry';
const ROLE_TEST_SUITE = 'test_suite';

const ACTION_EXTRACT_CONSTANT = 'extract_constant';
const TARGET_SCOPE_MODULE_TOP_LEVEL = 'module_top_level';
const ANCHOR_POSITION_AFTER_IMPORTS = 'after_imports';

/**
 * Orders two literal observations by source position.
 *
 * @param recordA - First literal record.
 * @param recordB - Second literal record.
 * @returns Sort comparison number.
 */
export function computePositionDelta(recordA: LiteralRecord, recordB: LiteralRecord): number {
    const startLineA = recordA.node.start ? recordA.node.start.line : 0;
    const startLineB = recordB.node.start ? recordB.node.start.line : 0;
    if (startLineA !== startLineB) return startLineA - startLineB;
    const startColA = recordA.node.start ? recordA.node.start.column : 0;
    const startColB = recordB.node.start ? recordB.node.start.column : 0;
    return startColA - startColB;
}

/** Backward-compatible export alias for computePositionDelta. */
export const byPosition = computePositionDelta;

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
        return prefix !== PREFIX_CONST ? prefix : fallback;
    }
    return prefix !== PREFIX_CONST_STR ? `${prefix}_${fallback}` : fallback;
}

/**
 * Resolves diagnostic message for literal extraction issue.
 *
 * @param literalValueText - Raw literal value text.
 * @param numeric - Whether literal is numeric.
 * @param isGranular - Whether granular rule mode is active.
 * @param rationale - Optional classification rationale.
 * @returns Formatted issue message.
 */
export function resolveLiteralMessage(
    literalValueText: string,
    numeric: boolean,
    isGranular: boolean,
    rationale?: string,
): string {
    if (isGranular && rationale) {
        return `${rationale}: ${literalValueText} should be extracted.`;
    }
    if (numeric) {
        return `Magic number ${literalValueText} should be extracted into a named constant.`;
    }
    return 'Hardcoded string should be extracted into a named constant.';
}

/** Parameter bundle for resolving literal issue diagnostic payload. */
export interface LiteralIssueParams {
    literalValue: string;
    numeric: boolean;
    classification: ReturnType<typeof classifyLiteral> | null;
    granular: boolean;
    suggestedNameFallback: string;
}

/**
 * Resolves complete issue payload for a detected literal.
 *
 * @param params - Literal issue resolution parameter object.
 * @returns Literal issue data structure.
 */
export function resolveLiteralIssueData(params: LiteralIssueParams): LiteralResolution {
    const { literalValue, numeric, classification, granular, suggestedNameFallback } = params;
    const isGranular = Boolean(
        granular && classification && classification.kind !== LITERAL_KIND_GENERAL,
    );
    const defaultRule = numeric ? RULE_MAGIC_NUMBER : RULE_HARDCODED_STRING;
    const rule = isGranular ? `literal-${classification!.kind}` : defaultRule;
    const suggested = resolveSuggestedName(numeric, classification, suggestedNameFallback);
    const message = resolveLiteralMessage(
        literalValue,
        numeric,
        isGranular,
        classification?.rationale,
    );

    const detail: Record<string, unknown> = numeric
        ? {
              value: literalValue,
              numeric: true,
              suggestedName: suggested,
              ...(classification
                  ? { semanticKind: classification.kind, rationale: classification.rationale }
                  : {}),
          }
        : {
              value: literalValue,
              length: stripQuotes(literalValue).length,
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
 * @param isConstantFile - Whether file is a constant catalog.
 * @returns Threshold count.
 */
export function resolveDuplicateThreshold(
    base: number,
    isTest: boolean,
    isDataOrConfig: boolean,
    isConstantFile = false,
): number {
    if (isTest || isConstantFile)
        return Math.max(base * THRESHOLD_MULTIPLIER_TEST, THRESHOLD_MIN_TEST);
    return isDataOrConfig ? Math.max(base * THRESHOLD_MULTIPLIER_DATA, THRESHOLD_MIN_DATA) : base;
}

/**
 * Checks if a file role is data or config definition.
 *
 * @param role - Inferred file role.
 * @param filePath - Path to source file.
 * @param content - Optional full source code text.
 * @returns True when file represents data or config.
 */
export function isDataOrConfigFile(role: string, filePath: string, content?: string): boolean {
    return (
        role === ROLE_CONFIG_CONSTANT ||
        role === ROLE_RULES_REGISTRY ||
        filePath.endsWith('.json') ||
        isConstantDefinitionFile(filePath, content)
    );
}

/**
 * Checks if a file represents a test suite, fixture, or mock.
 *
 * @param role - Inferred file role identifier.
 * @param filePath - Normalized path of the target file.
 * @returns True if the file matches test suite or fixture characteristics.
 */
export function isTestFile(role: string, filePath: string): boolean {
    return (
        role === ROLE_TEST_SUITE ||
        /[\\/](?:tests?|fixtures?|mocks?)[\\/]/i.test(filePath) ||
        /\.(?:test|spec)\.[a-z0-9]+$/i.test(filePath)
    );
}

/**
 * Checks if a file represents an internationalization dictionary or locale file.
 *
 * @param role - Inferred file role identifier.
 * @param filePath - Normalized path of the target file.
 * @returns True if the file matches internationalization patterns.
 */
export function isI18nFile(role: string, filePath: string): boolean {
    return (
        (role === ROLE_CONFIG_CONSTANT && /[\\/](?:i18n|locales|lang)[\\/]/i.test(filePath)) ||
        /[\\/](?:i18n|locales|lang)[\\/]/i.test(filePath) ||
        /(?:zh-CN|en-US|zh|en)\.[a-z0-9]+$/i.test(filePath)
    );
}

/**
 * Checks if a numeric literal is a duplicate candidate.
 *
 * @param literalValueText - Numeric literal value.
 * @param magicNumberMin - Magic number minimum threshold.
 * @returns True when numeric value qualifies.
 */
export function isNumericDuplicateCandidate(
    literalValueText: string,
    magicNumberMin: number,
): boolean {
    if (TRIVIAL_NUMBERS.has(literalValueText)) return false;
    return Math.abs(Number(literalValueText)) >= magicNumberMin;
}

/**
 * Checks if a string literal should be ignored regardless of domain context.
 */
function isIgnoredLiteralCandidate(
    literalValueText: string,
    unquotedText: string,
    ignoreSet: Set<string>,
): boolean {
    return (
        unquotedText.length === 0 || ignoreSet.has(literalValueText) || ignoreSet.has(unquotedText)
    );
}

/** Domain classification flags for literal duplicate candidate filtering. */
export interface LiteralDomainContext {
    isTest?: boolean;
    isDataOrConfig?: boolean;
    isAlgorithm?: boolean;
    isConstantFile?: boolean;
}

/** Parameter bundle configuring duplicate candidate filtering and clustering. */
export interface DuplicateFilterOptions {
    magicNumberMin: number;
    ignoreSet: Set<string>;
    classify: boolean;
    domain: LiteralDomainContext;
}

/**
 * Determines whether a lowered string token is benign within the active domain scope.
 */
function isDomainBenignToken(lowerToken: string, domain: LiteralDomainContext): boolean {
    return Boolean(
        (domain.isTest && TEST_SUITE_BENIGN_TOKENS.has(lowerToken)) ||
        (domain.isDataOrConfig && SCHEMA_PROPERTY_TOKENS.has(lowerToken)) ||
        (domain.isAlgorithm && AST_PARSER_BENIGN_TOKENS.has(lowerToken)) ||
        (domain.isConstantFile && CONSTANT_DEFAULT_MAPPING_TOKENS.has(lowerToken)),
    );
}

/**
 * Checks if a string literal is a duplicate candidate.
 *
 * @param literalValueText - String literal value.
 * @param ignoreSet - Set of ignored string literals.
 * @param domain - Domain context flags.
 * @returns True when string qualifies.
 */
export function isStringDuplicateCandidate(
    literalValueText: string,
    ignoreSet: Set<string>,
    domain: LiteralDomainContext = {},
): boolean {
    const unquoted = stripQuotes(literalValueText).trim();
    if (isIgnoredLiteralCandidate(literalValueText, unquoted, ignoreSet)) return false;
    return !isDomainBenignToken(unquoted.toLowerCase(), domain);
}

/**
 * Checks if a literal record is a candidate for duplicate grouping.
 *
 * @param lit - Literal record.
 * @param options - Duplicate filter options.
 * @returns True when candidate.
 */
export function isDuplicateCandidate(lit: LiteralRecord, options: DuplicateFilterOptions): boolean {
    if (lit.isConstBound || lit.tolerated) return false;
    const candidate = lit.numeric
        ? isNumericDuplicateCandidate(lit.value, options.magicNumberMin)
        : isStringDuplicateCandidate(lit.value, options.ignoreSet, options.domain);
    if (!candidate) return false;
    return !(options.classify && classifyLiteral(lit.value, lit.numeric).isReasonable);
}

/**
 * Groups duplicate literals across all collected records in a file.
 *
 * @param literals - All collected literal records.
 * @param options - Duplicate filter options.
 * @returns Map of literal key to array of occurrences.
 */
export function collectDuplicateGroups(
    literals: LiteralRecord[],
    options: DuplicateFilterOptions,
): Map<string, LiteralRecord[]> {
    const groupsByKeyMap = new Map<string, LiteralRecord[]>();
    for (const lit of literals) {
        if (!isDuplicateCandidate(lit, options)) {
            continue;
        }
        const key = `${lit.numeric ? 'N' : 'S'}:${lit.value}`;
        const existingList = groupsByKeyMap.get(key) || [];
        existingList.push(lit);
        groupsByKeyMap.set(key, existingList);
    }
    return groupsByKeyMap;
}

/** Backward-compatible export alias for collectDuplicateGroups. */
export const groupDuplicates = collectDuplicateGroups;

/**
 * Builds an actionable Issue object for duplicate literals.
 *
 * @param ctx - Analyzer context.
 * @param records - Array of duplicate literal records.
 * @param suggested - Suggested constant name.
 * @returns Constructed Issue object.
 */
export function buildDuplicateIssue(
    ctx: AnalyzerContext,
    records: LiteralRecord[],
    suggested: string,
): Issue {
    const first = records[0];
    const issueLocation = locN(first.node, ctx.filePath);
    return {
        id:
            `${ANALYZER_CONSTANTS}:${RULE_DUPLICATE_LITERAL}:${ctx.filePath}:` +
            `${first.node.start?.line ?? 1}`,
        analyzer: ANALYZER_CONSTANTS,
        rule: RULE_DUPLICATE_LITERAL,
        severity: SEVERITY_WARNING,
        message: `Literal ${first.value} is repeated ${records.length} times in this file; extract it into a shared constant.`,
        location: issueLocation,
        detail: {
            value: first.value,
            numeric: first.numeric,
            occurrences: records.length,
            lines: records.map((l) => l.node.start?.line ?? 1),
            suggestedName: suggested,
        },
        suggestion: formatConstantDeclarationSuggestion(
            ctx.filePath,
            suggested,
            first.value,
            first.numeric,
            `used ${records.length}x`,
        ),
        actionable: {
            action: ACTION_EXTRACT_CONSTANT,
            code: CODE_CONST_DUPLICATE_LITERAL,
            targetScope: TARGET_SCOPE_MODULE_TOP_LEVEL,
            targetSymbol: suggested,
            insertAnchor: { position: ANCHOR_POSITION_AFTER_IMPORTS },
            safeToAutomate: true,
        },
    };
}
