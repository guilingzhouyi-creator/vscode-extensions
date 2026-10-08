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
import { SEVERITY_WARNING } from '../core/types';
import type { DiagnosticDescriptor } from '../core/messages/types';

export interface NamingCandidate {
    readonly name: string;
    readonly confidence: number;
    readonly source: 'type_inference' | 'initializer_call' | 'abbreviation_expansion';
    readonly rationale: string;
}

export interface CrossFileReferenceSummary {
    readonly file: string;
    readonly line: number | null;
    readonly caller?: string | null;
}

export interface CrossFileUsageContext {
    readonly symbolName: string;
    readonly definitionFile: string;
    readonly crossFileReferenceCount: number;
    readonly references: readonly CrossFileReferenceSummary[];
    readonly isCrossFile: boolean;
}

export interface StandardizationProposal {
    readonly originalName: string;
    readonly suggestedName: string;
    readonly confidence: number;
    readonly candidates: readonly NamingCandidate[];
    readonly rationale: string;
    readonly safeToAutomate: boolean;
}

export interface ClarificationRequest {
    readonly symbolName: string;
    readonly filePath: string;
    readonly crossFileContext: CrossFileUsageContext;
    readonly ambiguityReasons: readonly string[];
    readonly candidates: readonly NamingCandidate[];
    readonly requiresHumanReview: boolean;
}

export interface NamingActionablePayload extends AgentActionablePayload {
    standardizationProposal?: StandardizationProposal;
    clarificationRequest?: ClarificationRequest;
}

export const RULE_NAM_LEN_001 = 'NAM-LEN-001';
export const RULE_NAM_LEN_002 = 'NAM-LEN-002';
export const RULE_NAM_ABR_001 = 'NAM-ABR-001';

export const MAX_VARIABLE_NAME_LENGTH = 42;
export const MAX_FUNCTION_NAME_LENGTH = 50;

export const ALLOWED_SHORT_NAMES: ReadonlySet<string> = new Set([
    'x', 'y', 'z', 'dx', 'dy', 'w', 'h', 'id', 'ip', 'i', 'j', 'k', '_',
    'ts', 'fs', 'cp', 'vm', 'db', 'fd', 'fn', 'cb', 'el', 'sf', 'ns', 'op',
    're', 'ex', 'ev', 'ok', 'no', 'ch', 'tx', 'rx',
]);

/**
 * Common truncated abbreviations dictionary with standard English expansions.
 */
export const COMMON_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
    usr: 'user',
    mgr: 'manager',
    btn: 'button',
    cnt: 'count',
    ptr: 'pointer',
    cur: 'current',
    auth_mgr: 'authManager',
    tbl: 'table',
    chk: 'check',
    cb: 'callback',
    cfg: 'config',
    ctx: 'context',
    doc: 'document',
    err: 'error',
    idx: 'index',
    len: 'length',
    msg: 'message',
    num: 'number',
    pos: 'position',
    prev: 'previous',
    req: 'request',
    res: 'response',
    src: 'source',
    str: 'string',
});

/**
 * Unapproved abbreviations triggering NAM-ABR-001 warnings.
 */
export const UNAPPROVED_ABBREVIATION_SET = new Set([
    'usr', 'mgr', 'btn', 'cnt', 'ptr', 'cur', 'auth_mgr', 'tbl', 'chk', 'cb',
]);

/**
 * Polysemic abbreviations that introduce semantic ambiguity.
 */
export const POLYSEMIC_ABBREVIATIONS = new Set([
    'cur', 'res', 'sec', 'auth', 'doc', 'cnt',
]);

const PRIMITIVE_TYPE_NAMES = new Set([
    'string', 'number', 'boolean', 'any', 'unknown', 'void',
    'never', 'symbol', 'bigint', 'object', 'undefined', 'null',
]);

/**
 * Diagnostic message catalog for length and abbreviation rules.
 */
export const NamingMessages = {
    FUNCTION_NAME_TOO_SHORT: (name: string): DiagnosticDescriptor => ({
        message: `Function or method name '${name}' is too short (< 3 characters); lacks semantic description.`,
        suggestion: `Rename '${name}' to a descriptive verb-noun phrase with at least 3 characters.`,
        rationale: 'Short function names obscure behavior and hinder code searchability.',
        risk: 'Low',
    }),
    FUNCTION_NAME_TOO_LONG: (name: string): DiagnosticDescriptor => ({
        message: `Function or method name '${name}' is excessively long (>= ${MAX_FUNCTION_NAME_LENGTH} characters); consider simplifying or decomposing.`,
        suggestion: `Refactor '${name}' to reduce verbosity or decompose responsibilities into smaller procedures.`,
        rationale: 'Overly long function names indicate procedural clutter and responsibility bloat.',
        risk: 'Low',
    }),
    VARIABLE_NAME_TOO_SHORT: (name: string): DiagnosticDescriptor => ({
        message: `Local variable name '${name}' is too short (<= 2 characters) and not in permitted whitelist.`,
        suggestion: `Rename '${name}' to an expressive identifier conveying purpose and type.`,
        rationale: 'Cryptic 1-2 character variables outside standard math/loop coordinates impair readability.',
        risk: 'Low',
    }),
    VARIABLE_NAME_TOO_LONG: (name: string): DiagnosticDescriptor => ({
        message: `Variable name '${name}' is overly qualified or verbose (>= ${MAX_VARIABLE_NAME_LENGTH} characters).`,
        suggestion: `Simplify '${name}' to focus on core semantic domain entity.`,
        rationale: 'Excessive variable length creates line noise and typically signals missing module scope boundaries.',
        risk: 'Low',
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
        rationale: 'Truncated abbreviations create cognitive burden and inconsistency across teams.',
        risk: 'Low',
    }),
};

type TypeWrapperHandler = (arg: ts.TypeNode) => { typeName: string; isArray: boolean } | null;

const TYPE_WRAPPER_HANDLERS: Readonly<Record<string, TypeWrapperHandler>> = Object.freeze({
    Array: (arg: ts.TypeNode) => {
        const inner = extractTypeName(arg);
        return inner ? { typeName: inner.typeName, isArray: true } : null;
    },
    ReadonlyArray: (arg: ts.TypeNode) => {
        const inner = extractTypeName(arg);
        return inner ? { typeName: inner.typeName, isArray: true } : null;
    },
    Promise: (arg: ts.TypeNode) => extractTypeName(arg),
});

function resolveEntityNameText(name: ts.EntityName): string {
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isQualifiedName(name)) return name.right.text;
    return '';
}

function extractTypeReferenceNode(
    typeNode: ts.TypeReferenceNode,
): { typeName: string; isArray: boolean } | null {
    const rawName = resolveEntityNameText(typeNode.typeName);
    if (!rawName) return null;

    const firstArg = typeNode.typeArguments?.[0];
    if (firstArg) {
        const handler = TYPE_WRAPPER_HANDLERS[rawName];
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
        source: 'type_inference',
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

function transformCallName(fnName: string): string | null {
    const verbRules: Array<{ pattern: RegExp; replace: (rest: string) => string }> = [
        { pattern: /^parse([A-Z].*)$/, replace: (rest) => `parsed${rest}` },
        { pattern: /^fetch([A-Z].*)$/, replace: (rest) => `fetched${rest}` },
        { pattern: /^build([A-Z].*)$/, replace: (rest) => `built${rest}` },
        { pattern: /^load([A-Z].*)$/, replace: (rest) => `loaded${rest}` },
        { pattern: /^create([A-Z].*)$/, replace: (rest) => rest.charAt(0).toLowerCase() + rest.slice(1) },
        { pattern: /^get([A-Z].*)$/, replace: (rest) => rest.charAt(0).toLowerCase() + rest.slice(1) },
        { pattern: /^find([A-Z].*)$/, replace: (rest) => `found${rest}` },
        { pattern: /^calculate([A-Z].*)$/, replace: (rest) => `calculated${rest}` },
        { pattern: /^generate([A-Z].*)$/, replace: (rest) => `generated${rest}` },
        { pattern: /^resolve([A-Z].*)$/, replace: (rest) => `resolved${rest}` },
    ];

    for (const rule of verbRules) {
        const match = rule.pattern.exec(fnName);
        if (match && match[1]) {
            return rule.replace(match[1]);
        }
    }
    return null;
}

/**
 * Infer naming candidate from assignment call initializer (Stage 2).
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
        source: 'initializer_call',
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
        for (const token of matchedTokens) target.push(token);
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
 */
export function tokenizeIdentifier(name: string): string[] {
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

/**
 * Infer naming candidate from abbreviation expansion dictionary (Stage 3).
 */
export function inferFromAbbreviationDictionary(name: string): NamingCandidate | null {
    if (!name) return null;
    const lower = name.toLowerCase();

    if (COMMON_ABBREVIATIONS[lower]) {
        return {
            name: COMMON_ABBREVIATIONS[lower],
            confidence: 0.92,
            source: 'abbreviation_expansion',
            rationale: `Expanded unapproved abbreviation '${name}' -> '${COMMON_ABBREVIATIONS[lower]}'`,
        };
    }

    const tokens = tokenizeIdentifier(name);
    if (tokens.length === 0) return null;

    let hasExpanded = false;
    const expandedTokens = tokens.map((token, idx) => {
        const tokenLower = token.toLowerCase();
        const expanded = COMMON_ABBREVIATIONS[tokenLower];
        if (expanded) {
            hasExpanded = true;
            return idx === 0 ? expanded.toLowerCase() : expanded.charAt(0).toUpperCase() + expanded.slice(1);
        }
        return idx === 0 ? token.charAt(0).toLowerCase() + token.slice(1) : token.charAt(0).toUpperCase() + token.slice(1);
    });

    if (!hasExpanded) return null;

    const candidateName = expandedTokens.join('');
    if (candidateName === name) return null;

    return {
        name: candidateName,
        confidence: 0.92,
        source: 'abbreviation_expansion',
        rationale: `Expanded truncated token segment(s) in identifier '${name}'`,
    };
}

/**
 * Three-stage naming candidate inference pipeline.
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
 */
export function findUnapprovedAbbreviation(name: string): { unapproved: string; expanded?: string } | null {
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

export interface SymbolIndexLike {
    crossFileReferencesTo(name: string, definitionFile: string): Array<{
        file: string;
        line?: number | null;
        caller?: string | null;
    }>;
}

/**
 * Inspect cross-file usage context for a given symbol.
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
            reasons.push(`Ambiguous candidate contest between '${top.name}' and '${candidates[1].name}'`);
        }
    }

    return {
        hasAmbiguity: reasons.length > 0,
        reasons,
    };
}

/** Immutable set of syntax kinds identifying export modifiers. */
const EXPORT_MODIFIER_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
    ts.SyntaxKind.ExportKeyword,
]);

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

/**
 * Build machine-actionable payload with standardization proposal or clarification request.
 */
export function buildNamingActionable(
    name: string,
    node: ts.Node | undefined,
    ruleCode: string,
    ctx: AnalyzerContext,
    pos: { line: number; character: number },
    symbolIndex?: SymbolIndexLike,
): NamingActionablePayload {
    const isExported = isNodeExported(node);
    const candidates = inferNamingCandidates(name, node);
    const crossCtx = inspectCrossFileContext(name, ctx.filePath, symbolIndex);
    const ambiguity = evaluateNamingAmbiguity(name, candidates);
    const topCandidate = candidates[0];

    const isCrossFileExported = isExported && crossCtx.isCrossFile;
    const shouldClarify = isCrossFileExported || ambiguity.hasAmbiguity || isExported;

    if (!shouldClarify && topCandidate && topCandidate.confidence >= 0.85) {
        const standardizationProposal: StandardizationProposal = {
            originalName: name,
            suggestedName: topCandidate.name,
            confidence: topCandidate.confidence,
            candidates,
            rationale: topCandidate.rationale,
            safeToAutomate: true,
        };

        return {
            action: 'replace_token',
            code: ruleCode,
            taxonomy: 'GOV_NORM',
            safeToAutomate: true,
            targetSymbol: topCandidate.name,
            patch: {
                range: {
                    startLine: pos.line + 1,
                    startCol: pos.character + 1,
                    endLine: pos.line + 1,
                    endCol: pos.character + 1 + name.length,
                },
                replacementText: topCandidate.name,
            },
            templateSnippet: topCandidate.name,
            targetArguments: {
                originalName: name,
                standardizationProposal,
            },
            standardizationProposal,
        };
    }

    const reasons = [...ambiguity.reasons];
    if (isCrossFileExported) {
        reasons.unshift(`Exported symbol has ${crossCtx.crossFileReferenceCount} cross-file reference(s)`);
    } else if (isExported && reasons.length === 0) {
        reasons.unshift('Exported symbol boundary requires external consumer verification');
    }

    const clarificationRequest: ClarificationRequest = {
        symbolName: name,
        filePath: ctx.filePath,
        crossFileContext: crossCtx,
        ambiguityReasons: reasons,
        candidates,
        requiresHumanReview: true,
    };

    return {
        action: 'replace_token',
        code: ruleCode,
        taxonomy: 'GOV_NORM',
        safeToAutomate: false,
        targetSymbol: topCandidate?.name ?? name,
        templateSnippet: topCandidate ? topCandidate.name : undefined,
        targetArguments: {
            symbolName: name,
            clarificationRequest,
        },
        clarificationRequest,
    };
}

/** Callback signature for issuing naming diagnostics. */
export type NamingIssueEmitter = (
    line: number,
    column: number,
    rule: string,
    message: string,
    severity: Severity,
    detail: Record<string, unknown>,
    suggestion?: string,
    actionable?: NamingActionablePayload,
) => void;

/**
 * Audits a function or method name for minimum/maximum length constraints
 * and unapproved abbreviation patterns.
 */
export function auditFunctionNameLengthsAndAbbreviations(
    name: string,
    node: ts.Node,
    pos: { line: number; character: number },
    ctx: AnalyzerContext,
    opts: { checkLengths?: boolean; checkAbbreviations?: boolean },
    symbolIndex: SymbolIndexLike | undefined,
    emitIssue: NamingIssueEmitter,
): void {
    if (opts.checkLengths !== false) {
        if (name.length < 3) {
            const desc = NamingMessages.FUNCTION_NAME_TOO_SHORT(name);
            const actionable = buildNamingActionable(name, node, RULE_NAM_LEN_002, ctx, pos, symbolIndex);
            emitIssue(
                pos.line + 1,
                pos.character + 1,
                RULE_NAM_LEN_002,
                desc.message,
                SEVERITY_WARNING,
                { name, length: name.length, actionable },
                desc.suggestion,
                actionable,
            );
        } else if (name.length >= MAX_FUNCTION_NAME_LENGTH) {
            const desc = NamingMessages.FUNCTION_NAME_TOO_LONG(name);
            const actionable = buildNamingActionable(name, node, RULE_NAM_LEN_002, ctx, pos, symbolIndex);
            emitIssue(
                pos.line + 1,
                pos.character + 1,
                RULE_NAM_LEN_002,
                desc.message,
                SEVERITY_WARNING,
                { name, length: name.length, actionable },
                desc.suggestion,
                actionable,
            );
        }
    }

    if (opts.checkAbbreviations !== false) {
        const abbr = findUnapprovedAbbreviation(name);
        if (abbr) {
            const desc = NamingMessages.UNAPPROVED_ABBREVIATION(name, abbr.unapproved, abbr.expanded);
            const actionable = buildNamingActionable(name, node, RULE_NAM_ABR_001, ctx, pos, symbolIndex);
            emitIssue(
                pos.line + 1,
                pos.character + 1,
                RULE_NAM_ABR_001,
                desc.message,
                SEVERITY_WARNING,
                { name, unapproved: abbr.unapproved, expanded: abbr.expanded, actionable },
                desc.suggestion,
                actionable,
            );
        }
    }
}

/**
 * Audits a variable or binding identifier for minimum/maximum length constraints
 * and unapproved abbreviation patterns.
 */
export function auditVariableNameLengthsAndAbbreviations(
    name: string,
    decl: ts.Node,
    isTopLevel: boolean,
    pos: { line: number; character: number },
    ctx: AnalyzerContext,
    opts: { checkLengths?: boolean; checkAbbreviations?: boolean },
    symbolIndex: SymbolIndexLike | undefined,
    emitIssue: NamingIssueEmitter,
): void {
    if (opts.checkLengths !== false) {
        if (!isTopLevel && name.length <= 2 && !ALLOWED_SHORT_NAMES.has(name)) {
            const desc = NamingMessages.VARIABLE_NAME_TOO_SHORT(name);
            const actionable = buildNamingActionable(name, decl, RULE_NAM_LEN_001, ctx, pos, symbolIndex);
            emitIssue(
                pos.line + 1,
                pos.character + 1,
                RULE_NAM_LEN_001,
                desc.message,
                SEVERITY_WARNING,
                { name, length: name.length, isTopLevel, actionable },
                desc.suggestion,
                actionable,
            );
        } else if (name.length >= MAX_VARIABLE_NAME_LENGTH && (!isTopLevel || !/^[A-Z][A-Z0-9_]*$/.test(name))) {
            const desc = NamingMessages.VARIABLE_NAME_TOO_LONG(name);
            const actionable = buildNamingActionable(name, decl, RULE_NAM_LEN_001, ctx, pos, symbolIndex);
            emitIssue(
                pos.line + 1,
                pos.character + 1,
                RULE_NAM_LEN_001,
                desc.message,
                SEVERITY_WARNING,
                { name, length: name.length, isTopLevel, actionable },
                desc.suggestion,
                actionable,
            );
        }
    }

    if (opts.checkAbbreviations !== false) {
        const abbr = findUnapprovedAbbreviation(name);
        if (abbr) {
            const desc = NamingMessages.UNAPPROVED_ABBREVIATION(name, abbr.unapproved, abbr.expanded);
            const actionable = buildNamingActionable(name, decl, RULE_NAM_ABR_001, ctx, pos, symbolIndex);
            emitIssue(
                pos.line + 1,
                pos.character + 1,
                RULE_NAM_ABR_001,
                desc.message,
                SEVERITY_WARNING,
                { name, unapproved: abbr.unapproved, expanded: abbr.expanded, actionable },
                desc.suggestion,
                actionable,
            );
        }
    }
}

/**
 * Audits a member or property declaration for unapproved abbreviations.
 */
export function auditMemberAbbreviation(
    memberName: string,
    member: ts.Node,
    pos: { line: number; character: number },
    ctx: AnalyzerContext,
    opts: { checkAbbreviations?: boolean },
    symbolIndex: SymbolIndexLike | undefined,
    emitIssue: NamingIssueEmitter,
): void {
    if (opts.checkAbbreviations === false) return;
    const abbr = findUnapprovedAbbreviation(memberName);
    if (abbr) {
        const desc = NamingMessages.UNAPPROVED_ABBREVIATION(memberName, abbr.unapproved, abbr.expanded);
        const actionable = buildNamingActionable(memberName, member, RULE_NAM_ABR_001, ctx, pos, symbolIndex);
        emitIssue(
            pos.line + 1,
            pos.character + 1,
            RULE_NAM_ABR_001,
            desc.message,
            SEVERITY_WARNING,
            { name: memberName, unapproved: abbr.unapproved, expanded: abbr.expanded, actionable },
            desc.suggestion,
            actionable,
        );
    }
}

const SCALAR_SYNTAX_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.BigIntLiteral, ts.SyntaxKind.RegularExpressionLiteral,
]);

/**
 * Strips type assertions and parenthesization from a constant initializer.
 */
export function unwrapConstantInitializer(expr: ts.Expression): ts.Expression {
    let current = expr;
    while (
        ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) ||
        ts.isParenthesizedExpression(current) ||
        ts.isNonNullExpression(current)
    ) {
        current = current.expression;
    }
    return current;
}

/**
 * Checks whether an expression represents a composite collection/object literal.
 */
export function isCompositeLiteral(expr: ts.Expression): boolean {
    const unwrapped = unwrapConstantInitializer(expr);
    return ts.isObjectLiteralExpression(unwrapped) || ts.isArrayLiteralExpression(unwrapped);
}

/**
 * Checks whether an expression is a scalar primitive literal.
 */
export function isScalarLiteral(expr: ts.Expression): boolean {
    let unwrapped = unwrapConstantInitializer(expr);
    if (
        ts.isPrefixUnaryExpression(unwrapped) &&
        (unwrapped.operator === ts.SyntaxKind.PlusToken || unwrapped.operator === ts.SyntaxKind.MinusToken)
    ) {
        unwrapped = unwrapped.operand;
    }
    return SCALAR_SYNTAX_KINDS.has(unwrapped.kind);
}

/**
 * Checks whether an AST node is a single-line or single-expression arrow function.
 */
export function isSimpleArrowFunction(node: ts.Node, sf: ts.SourceFile): boolean {
    if (!ts.isArrowFunction(node)) return false;
    const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
    if (startLine !== endLine) return false;
    if (!ts.isBlock(node.body)) return true;
    return node.body.statements.length <= 1;
}

