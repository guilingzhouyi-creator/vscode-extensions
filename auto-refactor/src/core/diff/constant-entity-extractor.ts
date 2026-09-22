/**
 * Module: Core Engine — Constant Entity Extractor
 * File Path: src/core/diff/constant-entity-extractor.ts
 * Architecture Role: Lexical and structural extractor of constant entity snapshots
 *     from source files across TypeScript, JavaScript, and related languages.
 * Dependencies & Triggers: Consumes ConstantEntity & ConstantSemanticFingerprint from
 *     core/intelligence/constant-identity.ts; consumed by constant-relocation-detector.ts.
 * Responsibilities:
 *     1. Tokenize lines and track brace/function/class scope stacks.
 *     2. Extract constant declarations with symbol identity, line/column, and export status.
 *     3. Compute semantic fingerprints for constant values.
 * Exit Semantics & Design Rationale: Deterministic, side-effect-free AST/lexical analyzer.
 */

import type {
    ConstantEntity,
    ConstantSymbolIdentity,
    CodeDomainKind,
} from '../intelligence/constant-identity';
import { computeConstantFingerprint } from '../intelligence/constant-identity';

interface ScopeFrame {
    name: string;
    depth: number;
    isFunction: boolean;
}

const CONST_DECL_RE =
    /^(?:(export)\s+)?(?:const|static\s+readonly)\s+([A-Za-z0-9_$]+)\s*(?::\s*[^=]+)?\s*=\s*([^;,\n]+)/;
const IMPORT_LINE_RE = /^(?:import[\s{]|require\(|export\s+(?:\*|\{)|from\s|use\s)/;
const COMMENT_LINE_RE = /^(\/\/|#)/;
const HEADER_COMMENT_RE = /^(\/\/|\/\*|\*)/;
const COMPLEX_INITIALIZER_RE = /^[{(\s]|^(?:function\b|=>)/;
const SCOPE_DECL_RE =
    /(?:function\s+([A-Za-z0-9_$]+)|(?:class|interface|struct)\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/;
const CLASS_LIKE_RE = /^(?:class|interface|struct)\b/;

const DOMAIN_FUNCTION_LOCAL: CodeDomainKind = 'function_local';
const DOMAIN_CLASS_DECLARATIONS: CodeDomainKind = 'class_declarations';
const DOMAIN_FILE_HEADER: CodeDomainKind = 'file_header';
const DOMAIN_IMPORT_AREA: CodeDomainKind = 'import_area';
const DOMAIN_MODULE_CONSTANTS: CodeDomainKind = 'module_constants';
const HEADER_LINE_LIMIT = 10;

function resolveCodeDomain(
    scopeStack: ScopeFrame[],
    pastImports: boolean,
    lineIndex: number,
    line: string,
): CodeDomainKind {
    for (let i = 0; i < scopeStack.length; i++) {
        if (scopeStack[i].isFunction) return DOMAIN_FUNCTION_LOCAL;
    }
    if (scopeStack.length > 0) return DOMAIN_CLASS_DECLARATIONS;
    if (!pastImports) {
        const isHeader = lineIndex < HEADER_LINE_LIMIT && HEADER_COMMENT_RE.test(line.trim());
        return isHeader ? DOMAIN_FILE_HEADER : DOMAIN_IMPORT_AREA;
    }
    return DOMAIN_MODULE_CONSTANTS;
}

function tryParseConstantEntity(
    trimmed: string,
    line: string,
    lineNo: number,
    lineIndex: number,
    scopeStack: ScopeFrame[],
    pastImports: boolean,
    filePath: string,
    currentScope: string | null,
): ConstantEntity | null {
    const match = trimmed.match(CONST_DECL_RE);
    if (!match) return null;

    const rawValue = match[3].trim().replace(/;$/, '');
    if (COMPLEX_INITIALIZER_RE.test(rawValue)) return null;

    const codeDomain = resolveCodeDomain(scopeStack, pastImports, lineIndex, line);
    const name = match[2];
    const identity: ConstantSymbolIdentity = {
        name,
        filePath,
        codeDomain,
        enclosingScope: currentScope,
        isExported: Boolean(match[1]),
        line: lineNo,
        column: line.indexOf(name) + 1,
    };

    const isNumeric =
        !Number.isNaN(Number(rawValue)) && !rawValue.startsWith("'") && !rawValue.startsWith('"');
    const fingerprint = computeConstantFingerprint({
        value: rawValue,
        isNumeric,
        isImmutable: true,
    });

    return { identity, fingerprint };
}

function popScopeStackToDepth(scopeStack: ScopeFrame[], currentDepth: number): void {
    while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].depth >= currentDepth) {
        scopeStack.pop();
    }
}

function adjustDepthForChar(ch: string, depth: number, scopeStack: ScopeFrame[]): number {
    if (ch === '{') return depth + 1;
    if (ch === '}') {
        const next = depth - 1;
        popScopeStackToDepth(scopeStack, next);
        return next;
    }
    return depth;
}

function updateBracesAndScopeStack(
    trimmed: string,
    braceDepth: number,
    scopeStack: ScopeFrame[],
): { braceDepth: number; currentScope: string | null } {
    let currentDepth = braceDepth;
    for (let c = 0; c < trimmed.length; c++) {
        currentDepth = adjustDepthForChar(trimmed[c], currentDepth, scopeStack);
    }
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].name : null;
    return { braceDepth: currentDepth, currentScope };
}

function tryExtractScopeDeclaration(
    trimmed: string,
    braceDepth: number,
    scopeStack: ScopeFrame[],
): string | null {
    const fnMatch = trimmed.match(SCOPE_DECL_RE);
    if (!fnMatch) return null;
    const name = fnMatch[1] || fnMatch[2] || fnMatch[3];
    const isFn = !CLASS_LIKE_RE.test(trimmed);
    scopeStack.push({ name, depth: braceDepth, isFunction: isFn });
    return name;
}

/**
 * Parses constant entities from source text using lexical and structural analysis.
 *
 * @param content - Source file content string.
 * @param filePath - Repository-relative file path.
 * @returns Extracted constant entities with identity and semantic fingerprints.
 */
export function extractConstantEntities(content: string, filePath: string): ConstantEntity[] {
    const lines = content.split('\n');
    const entities: ConstantEntity[] = [];
    const scopeStack: ScopeFrame[] = [];

    let inCommentBlock = false;
    let pastImports = false;
    let currentScope: string | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('/*')) inCommentBlock = true;
        if (inCommentBlock) {
            inCommentBlock = !trimmed.includes('*/');
            continue;
        }
        if (COMMENT_LINE_RE.test(trimmed)) continue;
        if (!pastImports && IMPORT_LINE_RE.test(trimmed)) continue;
        if (!pastImports && trimmed.length > 0) pastImports = true;

        const scopeName = tryExtractScopeDeclaration(trimmed, braceDepth, scopeStack);
        if (scopeName) currentScope = scopeName;

        const braceResult = updateBracesAndScopeStack(trimmed, braceDepth, scopeStack);
        braceDepth = braceResult.braceDepth;
        currentScope = braceResult.currentScope;

        const entity = tryParseConstantEntity(
            trimmed,
            line,
            i + 1,
            i,
            scopeStack,
            pastImports,
            filePath,
            currentScope,
        );
        if (entity) entities.push(entity);
    }

    return entities;
}
