/**
 * Module: Static Analysis — Naming Candidate Inference & Context Helper
 * File Path: src/analyzers/naming-candidate-helper.ts
 * Architecture Role: Modular inference engine and cross-file usage inspector
 *   powering AST naming candidate generation and actionable issue resolution.
 * Dependencies & Triggers: TypeScript AST types, DiagnosticDescriptor,
 *   AgentActionablePayload, and splitIdentifierTokens.
 * Responsibilities:
 *   1. Implement three-stage inference pipeline (type, initializer call, abbreviation dictionary).
 *   2. Provide cross-file reference inspection and CrossFileUsageContext assembly.
 *   3. Construct standardization proposals and human clarification requests.
 *   4. Supply diagnostic message catalog (NamingMessages) for naming length and abbreviation rules.
 * Exit Semantics & Design Rationale: Pure deterministic helper; returns structured candidates
 *   and diagnostics without throwing; graceful fallback on absent indices.
 */

import * as ts from 'typescript';
import type { AgentActionablePayload, AnalyzerContext, Severity } from '../core/types';
import type { DiagnosticDescriptor } from '../core/messages/types';
import { auditFunctionSemantics } from './naming-path-helper';

/** Candidate naming proposal derived by the inference pipeline. */
export interface NamingCandidate {
    readonly name: string;
    readonly confidence: number;
    readonly source: 'type_inference' | 'initializer_call' | 'abbreviation_expansion';
    readonly rationale: string;
}

/** Summary of a cross-file symbol reference site. */
export interface CrossFileReferenceSummary {
    readonly file: string;
    readonly line: number | null;
    readonly caller?: string | null;
}

/** Usage context tracking cross-file references for an identifier. */
export interface CrossFileUsageContext {
    readonly symbolName: string;
    readonly definitionFile: string;
    readonly crossFileReferenceCount: number;
    readonly references: readonly CrossFileReferenceSummary[];
    readonly isCrossFile: boolean;
}

/** Machine-actionable proposal suggesting identifier standardization. */
export interface StandardizationProposal {
    readonly originalName: string;
    readonly suggestedName: string;
    readonly confidence: number;
    readonly candidates: readonly NamingCandidate[];
    readonly rationale: string;
    readonly safeToAutomate: boolean;
}

/** Request requiring clarification or human judgment for ambiguous naming. */
export interface ClarificationRequest {
    readonly symbolName: string;
    readonly filePath: string;
    readonly crossFileContext: CrossFileUsageContext;
    readonly ambiguityReasons: readonly string[];
    readonly candidates: readonly NamingCandidate[];
    readonly requiresHumanReview: boolean;
}

/** Actionable payload attaching naming proposals or clarification requests. */
export interface NamingActionablePayload extends AgentActionablePayload {
    standardizationProposal?: StandardizationProposal;
    clarificationRequest?: ClarificationRequest;
}

/** Rule code for variable name length constraints. */
export const RULE_NAM_LEN_001 = 'NAM-LEN-001';

/** Rule code for function and method name length constraints. */
export const RULE_NAM_LEN_002 = 'NAM-LEN-002';

/** Rule code for unapproved abbreviation checks. */
export const RULE_NAM_ABR_001 = 'NAM-ABR-001';

/** Maximum permitted length for variable identifiers. */
export const MAX_VARIABLE_NAME_LENGTH = 42;

/** Maximum permitted length for function and method identifiers. */
export const MAX_FUNCTION_NAME_LENGTH = 50;

/** Allowed short identifier names commonly accepted across domains. */
export const ALLOWED_SHORT_NAMES: ReadonlySet<string> = new Set(
    (
        'x y z dx dy w h id ip i j k l m n p r s t v a b c d e f _ ' +
        'ts fs cp vm db fd fn cb el sf ns op re ex ev ok no ch tx rx io os ui ci cd eq ne gt lt ' +
        'l1 l2 rl w1 w2 vp vn pm hp hn d0 tn lc'
    ).split(' '),
);

/**
 * Common truncated abbreviations dictionary with standard English expansions.
 */
const ABBREVIATION_PAIRS: ReadonlyArray<readonly [string, string]> = Object.freeze([
    ['usr', 'user'],
    ['mgr', 'manager'],
    ['btn', 'button'],
    ['cnt', 'count'],
    ['ptr', 'pointer'],
    ['cur', 'current'],
    ['auth_mgr', 'authManager'],
    ['tbl', 'table'],
    ['chk', 'check'],
    ['cb', 'callback'],
    ['cfg', 'config'],
    ['ctx', 'context'],
    ['doc', 'document'],
    ['err', 'error'],
    ['idx', 'index'],
    ['len', 'length'],
    ['msg', 'message'],
    ['num', 'number'],
    ['pos', 'position'],
    ['prev', 'previous'],
    ['req', 'request'],
    ['res', 'response'],
    ['src', 'source'],
    ['str', 'string'],
]);

/**
 * Common truncated abbreviations dictionary with standard English expansions.
 */
export const COMMON_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze(
    Object.fromEntries(ABBREVIATION_PAIRS),
);

/**
 * Unapproved abbreviations triggering NAM-ABR-001 warnings.
 */
export const UNAPPROVED_ABBREVIATION_SET: ReadonlySet<string> = new Set([
    'usr',
    'mgr',
    'btn',
    'cnt',
    'ptr',
    'cur',
    'auth_mgr',
    'tbl',
    'chk',
    'cb',
]);

/**
 * Polysemic abbreviations that introduce semantic ambiguity.
 */
export const POLYSEMIC_ABBREVIATIONS: ReadonlySet<string> = new Set([
    'cur',
    'res',
    'sec',
    'auth',
    'doc',
    'cnt',
]);

const PRIMITIVE_TYPE_NAMES: ReadonlySet<string> = new Set(
    'string number boolean any unknown void never symbol bigint object undefined null'.split(' '),
);

const RISK_LOW = 'Low';

/**
 * Diagnostic message catalog for length and abbreviation rules.
 */
export const NamingMessages = {
    FUNCTION_NAME_TOO_SHORT: (name: string): DiagnosticDescriptor => ({
        message: `Function or method name '${name}' is too short (< 3 characters); lacks semantic description.`,
        suggestion: `Rename '${name}' to a descriptive verb-noun phrase with at least 3 characters.`,
        rationale: 'Short function names obscure behavior and hinder code searchability.',
        risk: RISK_LOW,
    }),
    FUNCTION_NAME_TOO_LONG: (name: string): DiagnosticDescriptor => ({
        message: `Function or method name '${name}' is excessively long (>= ${MAX_FUNCTION_NAME_LENGTH} characters); consider simplifying or decomposing.`,
        suggestion: `Refactor '${name}' to reduce verbosity or decompose responsibilities into smaller procedures.`,
        rationale:
            'Overly long function names indicate procedural clutter and responsibility bloat.',
        risk: RISK_LOW,
    }),
    VARIABLE_NAME_TOO_SHORT: (name: string): DiagnosticDescriptor => ({
        message: `Local variable name '${name}' is too short (<= 2 characters) and not in permitted whitelist.`,
        suggestion: `Rename '${name}' to an expressive identifier conveying purpose and type.`,
        rationale:
            'Cryptic 1-2 character variables outside standard math/loop coordinates impair readability.',
        risk: RISK_LOW,
    }),
    VARIABLE_NAME_TOO_LONG: (name: string): DiagnosticDescriptor => ({
        message: `Variable name '${name}' is overly qualified or verbose (>= ${MAX_VARIABLE_NAME_LENGTH} characters).`,
        suggestion: `Simplify '${name}' to focus on core semantic domain entity.`,
        rationale:
            'Excessive variable length creates line noise and typically signals missing module scope boundaries.',
        risk: RISK_LOW,
    }),
    UNAPPROVED_ABBREVIATION: (
        name: string,
        unapproved: string,
        expanded?: string,
    ): DiagnosticDescriptor => ({
        message: `Identifier '${name}' contains unapproved truncated abbreviation '${unapproved}'.`,
        suggestion: expanded
            ? `Expand abbreviation '${unapproved}' to full word '${expanded}' (e.g. rename to candidate).`
            : `Expand abbreviated token '${unapproved}' into standard unabbreviated English term.`,
        rationale:
            'Truncated abbreviations create cognitive burden and inconsistency across teams.',
        risk: RISK_LOW,
    }),
};

type TypeWrapperHandler = (arg: ts.TypeNode) => { typeName: string; isArray: boolean } | null;

const TYPE_NAME_TO_WRAPPER_MAP: ReadonlyMap<string, TypeWrapperHandler> = new Map([
    [
        'Array',
        (arg: ts.TypeNode) => {
            const inner = extractTypeName(arg);
            return inner ? { typeName: inner.typeName, isArray: true } : null;
        },
    ],
    [
        'ReadonlyArray',
        (arg: ts.TypeNode) => {
            const inner = extractTypeName(arg);
            return inner ? { typeName: inner.typeName, isArray: true } : null;
        },
    ],
    ['Promise', (arg: ts.TypeNode) => extractTypeName(arg)],
]);

const SOURCE_TYPE_INFERENCE = 'type_inference';
const SOURCE_INITIALIZER_CALL = 'initializer_call';
const SOURCE_ABBREVIATION_EXPANSION = 'abbreviation_expansion';
const ACTION_REPLACE_TOKEN = 'replace_token';
const TAXONOMY_GOV_NORM = 'GOV_NORM';
const MIN_FUNCTION_NAME_LENGTH = 3;
const SEVERITY_WARN: Severity = 'warning';

function resolveEntityNameText(name: ts.EntityName): string {
    if (ts.isIdentifier(name)) return name.text;
    return ts.isQualifiedName(name) ? name.right.text : '';
}

function extractTypeReferenceNode(
    typeNode: ts.TypeReferenceNode,
): { typeName: string; isArray: boolean } | null {
    const rawName = resolveEntityNameText(typeNode.typeName);
    if (!rawName) return null;

    const firstArg = typeNode.typeArguments?.[0];
    if (firstArg) {
        const handler = TYPE_NAME_TO_WRAPPER_MAP.get(rawName);
        if (handler) {
            return handler(firstArg);
        }
    }

    return { typeName: rawName, isArray: false };
}

function extractTypeName(typeNode: ts.TypeNode): { typeName: string; isArray: boolean } | null {
    if (ts.isArrayTypeNode(typeNode)) {
        const inner = extractTypeName(typeNode.elementType);
        return inner ? { typeName: inner.typeName, isArray: true } : null;
    }
    if (ts.isTypeReferenceNode(typeNode)) {
        return extractTypeReferenceNode(typeNode);
    }
    return null;
}

/**
 * Infer naming candidate from AST explicit type annotation (Stage 1).
 *
 * @param node - AST node with optional type annotation.
 * @returns Inferred naming candidate or null if none found.
 */
export function inferFromExplicitType(node: ts.Node | undefined): NamingCandidate | null {
    if (!node) return null;
    const typeNode = (node as { type?: ts.TypeNode }).type;
    if (!typeNode) return null;

    const extracted = extractTypeName(typeNode);
    if (!extracted) return null;

    const { typeName, isArray } = extracted;
    if (PRIMITIVE_TYPE_NAMES.has(typeName.toLowerCase())) return null;

    const cleaned = typeName.replace(/^[IT](?=[A-Z])/, '');
    if (!cleaned) return null;

    let candidateName = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
    if (isArray) {
        candidateName = candidateName.endsWith('s') ? candidateName : `${candidateName}s`;
    }

    return {
        name: candidateName,
        confidence: 0.9,
        source: SOURCE_TYPE_INFERENCE,
        rationale: `Derived from explicit TypeScript type annotation '${typeName}'`,
    };
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
    let current = expr;
    while (current) {
        if (ts.isAwaitExpression(current)) {
            current = current.expression;
        } else if (ts.isParenthesizedExpression(current)) {
            current = current.expression;
        } else if (ts.isAsExpression(current)) {
            current = current.expression;
        } else if (ts.isNonNullExpression(current)) {
            current = current.expression;
        } else {
            break;
        }
    }
    return current;
}

const STATIC_VERB_RULES: ReadonlyArray<{ pattern: RegExp; replace: (rest: string) => string }> = [
    { pattern: /^parse([A-Z].*)$/, replace: (rest) => `parsed${rest}` },
    { pattern: /^fetch([A-Z].*)$/, replace: (rest) => `fetched${rest}` },
    { pattern: /^build([A-Z].*)$/, replace: (rest) => `built${rest}` },
    { pattern: /^load([A-Z].*)$/, replace: (rest) => `loaded${rest}` },
    {
        pattern: /^create([A-Z].*)$/,
        replace: (rest) => rest.charAt(0).toLowerCase() + rest.slice(1),
    },
    { pattern: /^get([A-Z].*)$/, replace: (rest) => rest.charAt(0).toLowerCase() + rest.slice(1) },
    { pattern: /^find([A-Z].*)$/, replace: (rest) => `found${rest}` },
    { pattern: /^calculate([A-Z].*)$/, replace: (rest) => `calculated${rest}` },
    { pattern: /^generate([A-Z].*)$/, replace: (rest) => `generated${rest}` },
    { pattern: /^resolve([A-Z].*)$/, replace: (rest) => `resolved${rest}` },
];

function transformCallName(fnName: string): string | null {
    for (const rule of STATIC_VERB_RULES) {
        const match = rule.pattern.exec(fnName);
        if (match && match[1]) {
            return rule.replace(match[1]);
        }
    }
    return null;
}

/**
 * Infer naming candidate from assignment call initializer (Stage 2).
 *
 * @param node - AST node containing an initializer.
 * @returns Inferred naming candidate or null if none found.
 */
export function inferFromInitializerCall(node: ts.Node | undefined): NamingCandidate | null {
    if (!node) return null;
    const init = (node as { initializer?: ts.Expression }).initializer;
    if (!init) return null;

    const unwrapped = unwrapExpression(init);
    if (!ts.isCallExpression(unwrapped)) return null;

    let fnName = '';
    if (ts.isIdentifier(unwrapped.expression)) {
        fnName = unwrapped.expression.text;
    } else if (ts.isPropertyAccessExpression(unwrapped.expression)) {
        fnName = unwrapped.expression.name.text;
    }
    if (!fnName) return null;

    const transformed = transformCallName(fnName);
    if (!transformed) return null;

    return {
        name: transformed,
        confidence: 0.88,
        source: SOURCE_INITIALIZER_CALL,
        rationale: `Derived from initializer call expression '${fnName}()'`,
    };
}

const TOKEN_SPLIT_PATTERN = /([A-Z]+(?=[A-Z][a-z0-9]|$)|[A-Z]?[a-z0-9]+)/g;

function extractMorphemeTokens(text: string): string[] {
    TOKEN_SPLIT_PATTERN.lastIndex = 0;
    const tokens: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = TOKEN_SPLIT_PATTERN.exec(text)) !== null) {
        if (match[0].length > 0) {
            tokens.push(match[0]);
        }
    }
    return tokens;
}

function appendSegmentTokens(segment: string, target: string[]): void {
    if (!segment) return;
    const matchedTokens = extractMorphemeTokens(segment);
    if (matchedTokens.length > 0) {
        target.push(...matchedTokens);
    } else {
        target.push(segment);
    }
}

function hasSegmentSeparators(name: string): boolean {
    return name.includes('_') || name.includes('-');
}

/**
 * Tokenize an identifier into discrete semantic morpheme tokens.
 * Accurately parses camelCase, PascalCase, snake_case, and UPPER_SNAKE_CASE.
 *
 * @param name - Identifier string to tokenize.
 * @returns Array of morpheme token strings.
 */
export function getIdentifierTokens(name: string): string[] {
    if (!name) return [];

    if (!hasSegmentSeparators(name)) {
        const singleTokens = extractMorphemeTokens(name);
        return singleTokens.length > 0 ? singleTokens : [name];
    }

    const segments = name.split(/[_-]+/);
    const tokens: string[] = [];
    for (const segment of segments) {
        appendSegmentTokens(segment, tokens);
    }
    return tokens.length > 0 ? tokens : [name];
}

/** Backward-compatible alias for getIdentifierTokens. */
export const tokenizeIdentifier = getIdentifierTokens;

function formatTokenCase(text: string, isFirst: boolean): string {
    return isFirst ? text.toLowerCase() : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Infer naming candidate from abbreviation expansion dictionary (Stage 3).
 *
 * @param name - Identifier name to analyze.
 * @returns Inferred naming candidate or null if no expansion possible.
 */
export function inferFromAbbreviationDictionary(name: string): NamingCandidate | null {
    if (!name) return null;
    const lower = name.toLowerCase();

    if (COMMON_ABBREVIATIONS[lower]) {
        return {
            name: COMMON_ABBREVIATIONS[lower],
            confidence: 0.92,
            source: SOURCE_ABBREVIATION_EXPANSION,
            rationale: `Expanded unapproved abbreviation '${name}' -> '${COMMON_ABBREVIATIONS[lower]}'`,
        };
    }

    const tokens = getIdentifierTokens(name);
    if (tokens.length === 0) return null;

    let hasExpanded = false;
    const expandedTokens = tokens.map((token, tokenIdx) => {
        const expanded = COMMON_ABBREVIATIONS[token.toLowerCase()];
        if (expanded) {
            hasExpanded = true;
            return formatTokenCase(expanded, tokenIdx === 0);
        }
        return formatTokenCase(token, tokenIdx === 0);
    });

    if (!hasExpanded) return null;

    const candidateName = expandedTokens.join('');
    if (candidateName === name) return null;

    return {
        name: candidateName,
        confidence: 0.92,
        source: SOURCE_ABBREVIATION_EXPANSION,
        rationale: `Expanded truncated token segment(s) in identifier '${name}'`,
    };
}

/**
 * Three-stage naming candidate inference pipeline.
 *
 * @param name - Identifier name to analyze.
 * @param node - Optional AST node for structural type inference.
 * @returns Array of deduplicated naming candidates sorted by confidence.
 */
export function inferNamingCandidates(name: string, node?: ts.Node): NamingCandidate[] {
    const candidates: NamingCandidate[] = [];

    const typeCandidate = inferFromExplicitType(node);
    if (typeCandidate && typeCandidate.name !== name) {
        candidates.push(typeCandidate);
    }

    const callCandidate = inferFromInitializerCall(node);
    if (callCandidate && callCandidate.name !== name) {
        candidates.push(callCandidate);
    }

    const abbrCandidate = inferFromAbbreviationDictionary(name);
    if (abbrCandidate && abbrCandidate.name !== name) {
        candidates.push(abbrCandidate);
    }

    candidates.sort((a, b) => b.confidence - a.confidence);

    const seen = new Set<string>();
    const deduplicated: NamingCandidate[] = [];
    for (const c of candidates) {
        if (!seen.has(c.name)) {
            seen.add(c.name);
            deduplicated.push(c);
        }
    }

    return deduplicated;
}

/**
 * Find unapproved abbreviation in an identifier.
 *
 * @param name - Identifier name to inspect.
 * @returns Unapproved abbreviation record or null if compliant.
 */
export function findUnapprovedAbbreviation(
    name: string,
): { unapproved: string; expanded?: string } | null {
    if (!name) return null;
    const lower = name.toLowerCase();

    if (UNAPPROVED_ABBREVIATION_SET.has(lower)) {
        return { unapproved: name, expanded: COMMON_ABBREVIATIONS[lower] };
    }

    const tokens = tokenizeIdentifier(name);
    for (const token of tokens) {
        const tokenLower = token.toLowerCase();
        if (UNAPPROVED_ABBREVIATION_SET.has(tokenLower)) {
            return { unapproved: token, expanded: COMMON_ABBREVIATIONS[tokenLower] };
        }
    }

    return null;
}

/** Lightweight contract representing a cross-file symbol query index. */
export interface SymbolIndexLike {
    crossFileReferencesTo(
        name: string,
        definitionFile: string,
    ): Array<{
        file: string;
        line?: number | null;
        caller?: string | null;
    }>;
}

/**
 * Inspect cross-file usage context for a given symbol.
 *
 * @param symbolName - Name of the symbol to query.
 * @param filePath - Current file path defining or using the symbol.
 * @param symbolIndex - Optional symbol index service.
 * @returns Cross-file usage context summary.
 */
export function inspectCrossFileContext(
    symbolName: string,
    filePath: string,
    symbolIndex?: SymbolIndexLike,
): CrossFileUsageContext {
    const normPath = filePath.replace(/\\/g, '/');
    if (!symbolIndex || typeof symbolIndex.crossFileReferencesTo !== 'function') {
        return {
            symbolName,
            definitionFile: normPath,
            crossFileReferenceCount: 0,
            references: [],
            isCrossFile: false,
        };
    }

    const rawRefs = symbolIndex.crossFileReferencesTo(symbolName, normPath) ?? [];
    const references: CrossFileReferenceSummary[] = rawRefs.map((r) => ({
        file: (r.file || '').replace(/\\/g, '/'),
        line: r.line ?? null,
        caller: r.caller ?? null,
    }));

    return {
        symbolName,
        definitionFile: normPath,
        crossFileReferenceCount: references.length,
        references,
        isCrossFile: references.length > 0,
    };
}

/**
 * Evaluate ambiguity across inferred candidates and token semantics.
 *
 * @param name - Identifier name under review.
 * @param candidates - List of inferred naming candidates.
 * @returns Ambiguity assessment containing flags and explanation reasons.
 */
export function evaluateNamingAmbiguity(
    name: string,
    candidates: readonly NamingCandidate[],
): { hasAmbiguity: boolean; reasons: string[] } {
    const reasons: string[] = [];

    if (candidates.length === 0) {
        reasons.push('No high-confidence naming candidate inferred');
        return { hasAmbiguity: true, reasons };
    }

    const tokens = tokenizeIdentifier(name);
    for (const t of tokens) {
        if (POLYSEMIC_ABBREVIATIONS.has(t.toLowerCase())) {
            reasons.push(`Token '${t}' has multiple domain interpretations`);
        }
    }

    const top = candidates[0];
    if (top.confidence < 0.85) {
        reasons.push(`Top candidate confidence (${top.confidence.toFixed(2)}) is below 0.85`);
    }

    if (candidates.length >= 2) {
        const diff = Math.abs(top.confidence - candidates[1].confidence);
        if (diff < 0.05) {
            reasons.push(
                `Ambiguous candidate contest between '${top.name}' and '${candidates[1].name}'`,
            );
        }
    }

    return {
        hasAmbiguity: reasons.length > 0,
        reasons,
    };
}

/** Immutable set of syntax kinds identifying export modifiers. */
const EXPORT_MODIFIER_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([ts.SyntaxKind.ExportKeyword]);

function hasExportModifier(modifiers?: readonly ts.ModifierLike[]): boolean {
    if (!modifiers) return false;
    for (const modifier of modifiers) {
        if (EXPORT_MODIFIER_KINDS.has(modifier.kind)) {
            return true;
        }
    }
    return false;
}

/**
 * Determine if an AST node has an export modifier.
 *
 * @param node - AST node to inspect.
 * @returns True if the node or an enclosing declaration is exported.
 */
export function isNodeExported(node?: ts.Node): boolean {
    if (!node) return false;
    let curr: ts.Node | undefined = node;
    while (curr) {
        if (ts.canHaveModifiers(curr)) {
            const modifiers = ts.getModifiers(curr);
            if (hasExportModifier(modifiers)) {
                return true;
            }
        }
        curr = curr.parent;
    }
    return false;
}

interface StandardizationContext {
    readonly name: string;
    readonly ruleCode: string;
    readonly topCandidate: NamingCandidate;
    readonly candidates: readonly NamingCandidate[];
    readonly pos: { line: number; character: number };
}

function createStandardizationActionable(
    standardizationContext: StandardizationContext,
): NamingActionablePayload {
    const standardizationProposal: StandardizationProposal = {
        originalName: standardizationContext.name,
        suggestedName: standardizationContext.topCandidate.name,
        confidence: standardizationContext.topCandidate.confidence,
        candidates: standardizationContext.candidates,
        rationale: standardizationContext.topCandidate.rationale,
        safeToAutomate: true,
    };

    return {
        action: ACTION_REPLACE_TOKEN,
        code: standardizationContext.ruleCode,
        taxonomy: TAXONOMY_GOV_NORM,
        safeToAutomate: true,
        targetSymbol: standardizationContext.topCandidate.name,
        patch: {
            range: {
                startLine: standardizationContext.pos.line + 1,
                startCol: standardizationContext.pos.character + 1,
                endLine: standardizationContext.pos.line + 1,
                endCol:
                    standardizationContext.pos.character + 1 + standardizationContext.name.length,
            },
            replacementText: standardizationContext.topCandidate.name,
        },
        templateSnippet: standardizationContext.topCandidate.name,
        targetArguments: {
            originalName: standardizationContext.name,
            standardizationProposal,
        },
        standardizationProposal,
    };
}

function resolveClarificationReasons(
    isCrossFileExported: boolean,
    isExported: boolean,
    crossCtx: CrossFileUsageContext,
    ambiguity: { hasAmbiguity: boolean; reasons: string[] },
): string[] {
    const reasons = [...ambiguity.reasons];
    if (isCrossFileExported) {
        reasons.unshift(
            `Exported symbol has ${crossCtx.crossFileReferenceCount} cross-file reference(s)`,
        );
    } else if (isExported && reasons.length === 0) {
        reasons.unshift('Exported symbol boundary requires external consumer verification');
    }
    return reasons;
}

interface ClarificationContext {
    readonly name: string;
    readonly ruleCode: string;
    readonly filePath: string;
    readonly crossCtx: CrossFileUsageContext;
    readonly ambiguity: { hasAmbiguity: boolean; reasons: string[] };
    readonly candidates: readonly NamingCandidate[];
    readonly isExported: boolean;
    readonly isCrossFileExported: boolean;
    readonly topCandidate?: NamingCandidate;
}

function createClarificationActionable(
    clarificationContext: ClarificationContext,
): NamingActionablePayload {
    const reasons = resolveClarificationReasons(
        clarificationContext.isCrossFileExported,
        clarificationContext.isExported,
        clarificationContext.crossCtx,
        clarificationContext.ambiguity,
    );
    const clarificationRequest: ClarificationRequest = {
        symbolName: clarificationContext.name,
        filePath: clarificationContext.filePath,
        crossFileContext: clarificationContext.crossCtx,
        ambiguityReasons: reasons,
        candidates: clarificationContext.candidates,
        requiresHumanReview: true,
    };

    return {
        action: ACTION_REPLACE_TOKEN,
        code: clarificationContext.ruleCode,
        taxonomy: TAXONOMY_GOV_NORM,
        safeToAutomate: false,
        targetSymbol: clarificationContext.topCandidate?.name ?? clarificationContext.name,
        templateSnippet: clarificationContext.topCandidate
            ? clarificationContext.topCandidate.name
            : undefined,
        targetArguments: {
            symbolName: clarificationContext.name,
            clarificationRequest,
        },
        clarificationRequest,
    };
}

/** Target identifier coordinates and metadata for naming auditing. */
export interface NamingAuditTarget {
    readonly name: string;
    readonly node: ts.Node;
    readonly pos: { line: number; character: number };
    readonly isTopLevel?: boolean;
}

/** Execution context and services for naming audits. */
export interface NamingAuditContext {
    readonly ctx: AnalyzerContext;
    readonly opts?: FunctionNamingAuditOptions;
    readonly symbolIndex?: SymbolIndexLike;
    readonly emitIssue: NamingIssueEmitter;
}

/**
 * Build machine-actionable payload with standardization proposal or clarification request.
 *
 * @param target - Target naming audit identifier with node and position.
 * @param ruleCode - Relevant naming rule code ID.
 * @param ctx - Current analyzer execution context.
 * @param symbolIndex - Optional symbol index for cross-file queries.
 * @returns Actionable payload containing proposals or clarification options.
 */
export function buildNamingActionable(
    target: NamingAuditTarget,
    ruleCode: string,
    ctx: AnalyzerContext,
    symbolIndex?: SymbolIndexLike,
): NamingActionablePayload {
    const { name, node, pos } = target;
    const isExported = isNodeExported(node);
    const candidates = inferNamingCandidates(name, node);
    const crossCtx = inspectCrossFileContext(name, ctx.filePath, symbolIndex);
    const ambiguity = evaluateNamingAmbiguity(name, candidates);
    const topCandidate = candidates[0];

    const isCrossFileExported = isExported && crossCtx.isCrossFile;
    const shouldClarify = isCrossFileExported || ambiguity.hasAmbiguity || isExported;

    if (!shouldClarify && topCandidate && topCandidate.confidence >= 0.85) {
        return createStandardizationActionable({
            name,
            ruleCode,
            topCandidate,
            candidates,
            pos,
        });
    }

    return createClarificationActionable({
        name,
        ruleCode,
        filePath: ctx.filePath,
        crossCtx,
        ambiguity,
        candidates,
        isExported,
        isCrossFileExported,
        topCandidate,
    });
}

/**
 * Structured diagnostic record emitted for naming rule violations.
 */
export interface NamingDiagnosticRecord {
    readonly line: number;
    readonly column: number;
    readonly rule: string;
    readonly message: string;
    readonly severity: Severity;
    readonly detail: Record<string, unknown>;
    readonly suggestion?: string;
    readonly actionable?: NamingActionablePayload;
}

/** Callback signature for emitting naming diagnostic records. */
export type NamingIssueEmitter = (diagnostic: NamingDiagnosticRecord) => void;

/**
 * Options configuring function identifier naming checks.
 */
export interface FunctionNamingAuditOptions {
    checkLengths?: boolean;
    checkAbbreviations?: boolean;
    minFunctionWords?: number;
    maxFunctionWords?: number;
    minFunctionLength?: number;
    maxFunctionLength?: number;
    enforceVerbNounContract?: boolean;
    enforceMorphemeCheck?: boolean;
}

interface DiagnosticDescriptorPayload {
    readonly rule: string;
    readonly desc: DiagnosticDescriptor;
    readonly detail: Record<string, unknown>;
}

function emitNamingIssue(
    target: NamingAuditTarget,
    diagnostic: DiagnosticDescriptorPayload,
    context: NamingAuditContext,
): void {
    const actionable = buildNamingActionable(
        target,
        diagnostic.rule,
        context.ctx,
        context.symbolIndex,
    );
    context.emitIssue({
        line: target.pos.line + 1,
        column: target.pos.character + 1,
        rule: diagnostic.rule,
        message: diagnostic.desc.message,
        severity: SEVERITY_WARN,
        detail: { ...diagnostic.detail, actionable },
        suggestion: diagnostic.desc.suggestion,
        actionable,
    });
}

function checkAndEmitAbbreviation(target: NamingAuditTarget, context: NamingAuditContext): void {
    const abbr = findUnapprovedAbbreviation(target.name);
    if (!abbr) return;
    const desc = NamingMessages.UNAPPROVED_ABBREVIATION(
        target.name,
        abbr.unapproved,
        abbr.expanded,
    );
    emitNamingIssue(
        target,
        {
            rule: RULE_NAM_ABR_001,
            desc,
            detail: { name: target.name, unapproved: abbr.unapproved, expanded: abbr.expanded },
        },
        context,
    );
}

/**
 * Audits a function or method name for minimum/maximum length constraints
 * and unapproved abbreviation patterns.
 *
 * @param target - Target identifier name, node, and position coordinates.
 * @param context - Naming audit context and configuration options.
 */
export function auditFunctionName(target: NamingAuditTarget, context: NamingAuditContext): void {
    const opts = context.opts ?? {};
    if (opts.checkLengths !== false) {
        const minLen = opts.minFunctionLength ?? MIN_FUNCTION_NAME_LENGTH;
        const maxLen = opts.maxFunctionLength ?? MAX_FUNCTION_NAME_LENGTH;
        if (target.name.length < minLen || target.name.length >= maxLen) {
            const isShort = target.name.length < minLen;
            const desc = isShort
                ? NamingMessages.FUNCTION_NAME_TOO_SHORT(target.name)
                : NamingMessages.FUNCTION_NAME_TOO_LONG(target.name);
            emitNamingIssue(
                target,
                {
                    rule: RULE_NAM_LEN_002,
                    desc,
                    detail: isShort
                        ? { name: target.name, length: target.name.length, minLen }
                        : { name: target.name, length: target.name.length, maxLen },
                },
                context,
            );
        }
    }

    const cleanName = target.name.replace(/^[_#]+/, '');
    const tokens = getIdentifierTokens(cleanName);
    const isAccessor = ts.isGetAccessor(target.node) || ts.isSetAccessor(target.node);
    const finding = auditFunctionSemantics(target.name, tokens, opts, isAccessor);
    if (finding) {
        emitNamingIssue(
            target,
            {
                rule: RULE_NAM_LEN_002,
                desc: {
                    message: finding.message,
                    suggestion: `Refactor function name '${target.name}' according to engineering naming standards.`,
                    rationale: '',
                    risk: RISK_LOW,
                },
                detail: { name: target.name, findingType: finding.type, token: finding.token },
            },
            context,
        );
    }

    if (opts.checkAbbreviations !== false) {
        checkAndEmitAbbreviation(target, context);
    }
}

/**
 * Audits a variable or binding identifier for minimum/maximum length constraints
 * and unapproved abbreviation patterns.
 *
 * @param target - Target variable identifier name, declaration node, and position.
 * @param context - Naming audit context and configuration options.
 */
export function auditVariableName(target: NamingAuditTarget, context: NamingAuditContext): void {
    const opts = context.opts ?? {};
    if (opts.checkLengths !== false) {
        const isTopLevel = target.isTopLevel ?? false;
        const nameLength = target.name.length;
        const isShort = !isTopLevel && nameLength === 2 && !ALLOWED_SHORT_NAMES.has(target.name);
        const isLong =
            nameLength >= MAX_VARIABLE_NAME_LENGTH &&
            (!isTopLevel || !/^[A-Z][A-Z0-9_]*$/.test(target.name));
        if (isShort || isLong) {
            const descriptor = isShort
                ? NamingMessages.VARIABLE_NAME_TOO_SHORT(target.name)
                : NamingMessages.VARIABLE_NAME_TOO_LONG(target.name);
            const variableDetail = { name: target.name, length: nameLength, isTopLevel };
            emitNamingIssue(
                target,
                { rule: RULE_NAM_LEN_001, desc: descriptor, detail: variableDetail },
                context,
            );
        }
    }

    if (opts.checkAbbreviations !== false) {
        checkAndEmitAbbreviation(target, context);
    }
}

/**
 * Audits a member or property declaration for unapproved abbreviations.
 *
 * @param target - Target member name, declaration node, and position.
 * @param context - Naming audit context and configuration options.
 */
export function auditMemberName(target: NamingAuditTarget, context: NamingAuditContext): void {
    if (context.opts?.checkAbbreviations === false) return;
    checkAndEmitAbbreviation(target, context);
}

export {
    unwrapConstantInitializer,
    isCompositeLiteral,
    isScalarLiteral,
    isSimpleArrowFunction,
} from './naming-ast-helper';
