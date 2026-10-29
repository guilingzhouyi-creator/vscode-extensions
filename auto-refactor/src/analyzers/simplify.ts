/**
 * Module: Static Analysis Engine — Simplification & Structure Smells
 * File Path: src/analyzers/simplify.ts
 * Architecture Role: Polyglot smell detector for long functions, commented-out code, empty
 *   implementations and debug output; language-neutral rule set usable by every adapter
 * Dependencies & Triggers: core types plus NodeKind for adapter-provided function spans, locN
 *   for issue locations, and globToRegExp/matchAny for the debug-output allow-list; enabled
 *   only when a config declares `analyzers.simplify`
 * Responsibilities: Measure function line spans (SIM-LONG-001); flag blocks of >= 3
 *   consecutive code-shaped comment lines (SIM-COMC-001); flag function bodies that are only
 *   `pass`/`...` or `{}` (SIM-EMPTY-001); flag debug print/console output outside allow-listed
 *   paths (SIM-PRNT-001); flag redundant `else` after terminating statements (SIM-ELSE-001);
 *   flag boolean returns that can be simplified to returning the condition directly
 *   (SIM-BOOL-001); flag deep conditional nesting at function start that should use guard
 *   clauses (SIM-GUARD-001); flag excessive function parameter counts (SIM-ARGS-001)
 * Exit Semantics & Design Rationale: Pure detector — never throws and returns [] for empty
 *   content. Function length uses adapter-materialized start/end lines (the normalized AST
 *   guarantee for function-like nodes) so the measurement stays language-agnostic, while the
 *   line-based rules use conservative, keyword-anchored patterns: a false "delete this code"
 *   suggestion is far more expensive than a missed smell. Heavier line-check implementations
 *   live in `simplify-linecheck.ts` to keep this file under the large-file threshold.
 */
import * as ts from 'typescript';
import type {
    Analyzer,
    AnalyzerContext,
    Issue,
    AgentActionType,
    AgentActionablePayload,
} from '../core/types';
import type { DefectTaxonomyCategory } from '../core/governance/standard-terminology';
import { SEVERITY_WARNING } from '../core/types';
import { ANALYZER_SIMPLIFY } from '../core/scoring/dimensionLiterals';
import { REGEX } from '../core/constants';
import type { NormalizedNode } from '../core/ast/multilang';
import { NodeKind } from '../core/ast/multilang';
import { locN } from '../utils/normalized';
import { createLineIssue } from '../core/rules/diagnostic-catalog';
import { globToRegExp, matchAny } from '../core/file-discovery';
import { isCommentOrBlankLine, calculateIndentWidth } from '../core/ast/block-scope-utils';
import { detectTernaryOpportunities } from './simplify-ternary';
import {
    auditRedundantElse,
    auditBooleanReturn,
    auditGuardClausePatterns,
} from './simplify-linecheck';
import {
    generateParameterObjectSnippet,
    computeControlFlowNesting,
    isNormalizedNode,
    walkNormalizedTree,
    attachFunctionLengthSlices,
    attachGuardClauseInversion,
} from './simplify-slice-helper';
import { auditOrphanInlining } from './simplify-inlining';
import { auditStructuralPatterns } from './simplify-pattern-helper';

/** Per-analyzer tunables (declared in `defaultAnalyzerOptions().simplify`). */
export interface SimplifyOptions {
    maxFunctionLines?: number;
    maxFunctionParameters?: number;
    commentedCodeMinLines?: number;
    printAllowPatterns?: string[];
    checkGuardClauses?: boolean;
    maxGuardClauseNesting?: number;
    checkTernarySimplification?: boolean;
    maxTernaryLength?: number;
    rewardSimplifications?: boolean;
    checkRedundantElse?: boolean;
    checkBooleanReturn?: boolean;
    checkGuardClausePatterns?: boolean;
    maxGuardClausePatternNesting?: number;
}

const resolveNodeLocation = locN;

// rule: 'SIM-LONG-001'
const RULE_SIM_LONG_001 = 'SIM-LONG-001';
// rule: 'SIM-FLAT-002'
const RULE_SIM_FLAT_002 = 'SIM-FLAT-002';
// rule: 'SIM-ARGS-001'
const RULE_SIM_ARGS_001 = 'SIM-ARGS-001';
// rule: 'SIM-ARGS-002'
const RULE_SIM_ARGS_002 = 'SIM-ARGS-002';
// rule: 'SIM-COMC-001'
const RULE_SIM_COMC_001 = 'SIM-COMC-001';
// rule: 'SIM-EMPTY-001'
const RULE_SIM_EMPTY_001 = 'SIM-EMPTY-001';
// rule: 'SIM-PRNT-001'
const RULE_SIM_PRNT_001 = 'SIM-PRNT-001';

const LIFECYCLE_HOOK_NAMES: ReadonlySet<string> = new Set([
    'oninit',
    'onmounted',
    'onmount',
    'ondestroy',
    'ondestroyed',
    'onready',
    'onstart',
    'onstop',
    'onclose',
    'onopen',
    'ontick',
    'onexit',
    'onenter',
    '_ready',
    '_enter_tree',
    '_exit_tree',
    '_process',
    '_physics_process',
]);

function isSemanticHandlerOrSolver(name: string): boolean {
    if (!name || LIFECYCLE_HOOK_NAMES.has(name.toLowerCase())) {
        return false;
    }
    return REGEX.NAMING.HANDLER_OR_SOLVER.test(name);
}

const ACTION_SPLIT_FUNCTION: AgentActionType = 'split_function';
const ACTION_SIMPLIFY_CONTROL_FLOW: AgentActionType = 'simplify_control_flow';
const ACTION_INTRODUCE_PARAM_OBJECT: AgentActionType = 'introduce_parameter_object';
const ACTION_REPLACE_TOKEN: AgentActionType = 'replace_token';

const CODE_AR_SIM_001 = 'AR:SIM:001';
const CODE_AR_SIM_002 = 'AR:SIM:002';
const CODE_AR_SIM_003 = 'AR:SIM:003';
const CODE_AR_SIM_004 = 'AR:SIM:004';
const CODE_AR_SIM_005 = 'AR:SIM:005';
const CODE_AR_SIM_006 = 'AR:SIM:006';

const SCOPE_MODULE_TOP_LEVEL = 'module_top_level';
const SCOPE_FUNCTION_LOCAL = 'function_local';
const TAXONOMY_CTRL_FLOW: DefectTaxonomyCategory = 'CTRL_FLOW';

const KEYWORD_CONSTRUCTOR = 'constructor';
const KEYWORD_CLASS = 'class';
const KEYWORD_FUNCTION = 'function';
const ARROW_OPERATOR = '=>';

function buildSimplifyActionable(
    payload: Partial<AgentActionablePayload> & { action: AgentActionType; code: string },
): AgentActionablePayload {
    return {
        safeToAutomate: false,
        ...payload,
    };
}

const DEFAULT_MAX_FUNCTION_LINES = 60;
const DEFAULT_MAX_FUNCTION_PARAMETERS = 4;
const DEFAULT_MIN_COMMENTED_CODE_LINES = 3;
const DEFAULT_MAX_GUARD_CLAUSE_NESTING = 3;
const DEFAULT_PRINT_ALLOW_PATTERNS = [
    '**/cli/**',
    '**/scripts/**',
    '**/tests/**',
    '**/test/**',
    '**/bench/**',
    '**/benchmark*/**',
    '**/*.test.*',
    '**/*.spec.*',
];

/** Keyword-anchored "this comment is code" heuristic, language-neutral. */
const CODE_SHAPED_RE =
    /^(?:def|class|function|fn|func|return|raise|throw|import|from|if|for|while|switch|try|except|catch|with|const|let|var|public|private|protected|async|await|yield|break|continue|else|elif|namespace|using|struct|enum|interface)\b/;

const PREFIX_SLASH_SLASH = '//';
const PREFIX_HASH = '#';
const PREFIX_STAR = '*';
const PREFIX_BLOCK_COMMENT_START = '/*';
const COMMENT_MARKERS = [PREFIX_SLASH_SLASH, PREFIX_HASH, PREFIX_STAR];
const CHAR_DOUBLE_QUOTE = '"';

function countEffectiveFunctionLines(lines: string[], startLine: number, endLine: number): number {
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(lines.length, endLine);
    let effective = 0;
    for (let i = startIdx; i < endIdx; i++) {
        if (!isCommentOrBlankLine(lines[i].trim())) {
            effective++;
        }
    }
    return effective;
}
const CHAR_SINGLE_QUOTE = "'";
const TRIPLE_DOUBLE_QUOTE = '"""';
const TRIPLE_SINGLE_QUOTE = "'''";
type DocstringQuote = typeof CHAR_DOUBLE_QUOTE | typeof CHAR_SINGLE_QUOTE;
const PROP_FOR_EACH_CHILD = 'forEachChild';
const ANONYMOUS_NAME = 'anonymous';
const ANONYMOUS_SUFFIX = '.<anonymous>';

function hasFunctionKeywords(content: string): boolean {
    return (
        content.includes(KEYWORD_FUNCTION) ||
        content.includes(ARROW_OPERATOR) ||
        content.includes(KEYWORD_CLASS) ||
        content.includes(KEYWORD_CONSTRUCTOR)
    );
}

function resolveFunctionDeclarationName(node: ts.Node): string {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        if (node.name && ts.isIdentifier(node.name)) {
            return node.name.text;
        }
    } else if (ts.isConstructorDeclaration(node)) {
        return KEYWORD_CONSTRUCTOR;
    } else if (
        node.parent &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isIdentifier(node.parent.name)
    ) {
        return node.parent.name.text;
    }
    return ANONYMOUS_NAME;
}

interface FunctionParameterAuditParams {
    node:
        | ts.FunctionDeclaration
        | ts.MethodDeclaration
        | ts.ArrowFunction
        | ts.FunctionExpression
        | ts.ConstructorDeclaration;
    sourceFile: ts.SourceFile;
    ctx: AnalyzerContext;
    opts: SimplifyOptions;
    issues: Issue[];
}

/**
 * Simplification and structure-smell analyzer (language-agnostic).
 *
 * `visit` records over-long functions from adapter positions; `finalize` appends the
 * line-based smell scan. The engine instantiates a fresh analyzer per file, so the
 * collector never leaks across files.
 */
export class SimplifyAnalyzer implements Analyzer {
    name = ANALYZER_SIMPLIFY;

    private readonly defaultSeverity = SEVERITY_WARNING;
    private longFunctions: Issue[] = [];
    private contentLines: string[] | null = null;
    private cachedSourceFile: ts.SourceFile | null | undefined = undefined;

    private getContentLines(ctx: AnalyzerContext): string[] {
        if (!this.contentLines) {
            this.contentLines = ctx.content ? ctx.content.split('\n') : [];
        }
        return this.contentLines;
    }

    private getOrParseSourceFile(ctx: AnalyzerContext): ts.SourceFile | null {
        if (this.cachedSourceFile !== undefined) {
            return this.cachedSourceFile;
        }
        this.cachedSourceFile = this.parseTsSource(ctx);
        return this.cachedSourceFile;
    }

    /**
     * Record functions whose measured span exceeds `maxFunctionLines`.
     *
     * @param node - Every visited node; only function-like nodes are measured.
     * @param ctx - Analyzer context (file path, options, content).
     * @param opts - Merged analyzer options.
     * @param name - Display name of the function or method.
     */
    private checkFunctionLength(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        opts: SimplifyOptions,
        name: string,
    ): void {
        const limit = opts.maxFunctionLines ?? DEFAULT_MAX_FUNCTION_LINES;
        const startLine = node.start?.line ?? 1;
        const endLine = node.end?.line ?? startLine;
        const length = endLine - startLine + 1;
        if (length <= limit) return;

        const lines = this.getContentLines(ctx);
        const effectiveLines = countEffectiveFunctionLines(lines, startLine, endLine);
        if (effectiveLines <= limit) return;

        const issue: Issue = createLineIssue(ANALYZER_SIMPLIFY, ctx.filePath, {
            lineIdx: Math.max(0, startLine - 1),
            rule: RULE_SIM_LONG_001,
            severity: this.defaultSeverity,
            message: `Function "${name}" spans ${length} lines (limit ${limit}).`,
            detail: { function: name, lines: length, limit },
            suggestion:
                'Extract cohesive steps into named helpers so the top-level flow reads as a short sequence of intent.',
        });
        issue.location = resolveNodeLocation(node, ctx.filePath);
        issue.actionable = buildSimplifyActionable({
            action: ACTION_SPLIT_FUNCTION,
            code: CODE_AR_SIM_001,
            targetScope: SCOPE_MODULE_TOP_LEVEL,
            targetSymbol: name,
        });

        attachFunctionLengthSlices(issue, this.getOrParseSourceFile(ctx), startLine);
        this.longFunctions.push(issue);
    }

    private checkGuardClauseNesting(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        opts: SimplifyOptions,
        name: string,
    ): void {
        if (!opts.checkGuardClauses) return;
        const maxNesting = computeControlFlowNesting(node);
        const maxAllowed = opts.maxGuardClauseNesting ?? DEFAULT_MAX_GUARD_CLAUSE_NESTING;
        if (maxNesting <= maxAllowed) return;

        const startLine = node.start?.line ?? 1;
        const issue: Issue = createLineIssue(ANALYZER_SIMPLIFY, ctx.filePath, {
            lineIdx: Math.max(0, startLine - 1),
            rule: RULE_SIM_FLAT_002,
            severity: this.defaultSeverity,
            message: `Function "${name}" has nested conditional control-flow depth ${maxNesting} (limit ${maxAllowed}). Flatten with guard clauses.`,
            detail: { function: name, nestingDepth: maxNesting, limit: maxAllowed },
            suggestion:
                'Invert deep conditionals and return early with guard clauses to flatten control flow.',
        });
        issue.location = resolveNodeLocation(node, ctx.filePath);
        issue.actionable = buildSimplifyActionable({
            action: ACTION_SIMPLIFY_CONTROL_FLOW,
            code: CODE_AR_SIM_002,
            targetScope: SCOPE_FUNCTION_LOCAL,
            targetSymbol: name,
        });

        attachGuardClauseInversion(issue, this.getOrParseSourceFile(ctx), startLine);
        this.longFunctions.push(issue);
    }

    private auditFunctionParameters(params: FunctionParameterAuditParams): void {
        const { node, sourceFile, ctx, opts, issues } = params;
        const limit = opts.maxFunctionParameters ?? DEFAULT_MAX_FUNCTION_PARAMETERS;
        const nodeParams = node.parameters;
        const name = resolveFunctionDeclarationName(node);
        const file = ctx.filePath.replace(/\\/g, '/');

        const startPos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        const startLine = startPos.line + 1;
        const startCol = startPos.character + 1;

        if (nodeParams.length > limit) {
            const paramNames = nodeParams.map((param) => param.name.getText(sourceFile));
            const paramInfo = nodeParams.map((param) => ({
                name: param.name.getText(sourceFile),
                type: param.type ? param.type.getText(sourceFile) : undefined,
            }));

            const template = generateParameterObjectSnippet(name, paramInfo);

            const issue = createLineIssue(ANALYZER_SIMPLIFY, file, {
                lineIdx: Math.max(0, startLine - 1),
                rule: RULE_SIM_ARGS_001,
                severity: this.defaultSeverity,
                message: `Function "${name}" has ${nodeParams.length} parameters (limit ${limit}). Introduce a parameter object.`,
                detail: {
                    function: name,
                    parameters: paramNames,
                    parameterCount: nodeParams.length,
                    limit,
                },
                suggestion:
                    'Encapsulate parameter list into a single options/parameter object using introduce_parameter_object.',
            });
            issue.location = {
                file,
                start: { line: startLine, column: startCol },
                end: { line: endPos.line + 1, column: endPos.character + 1 },
            };
            issue.actionable = buildSimplifyActionable({
                action: ACTION_INTRODUCE_PARAM_OBJECT,
                code: CODE_AR_SIM_006,
                taxonomy: TAXONOMY_CTRL_FLOW,
                targetScope: SCOPE_FUNCTION_LOCAL,
                targetSymbol: name,
                templateSnippet: template,
                targetArguments: {
                    functionName: name,
                    parameterCount: nodeParams.length,
                    parameters: paramNames,
                },
            });
            issues.push(issue);
        }

        if (nodeParams.length === 0 && isSemanticHandlerOrSolver(name)) {
            const issue = createLineIssue(ANALYZER_SIMPLIFY, file, {
                lineIdx: Math.max(0, startLine - 1),
                rule: RULE_SIM_ARGS_002,
                severity: this.defaultSeverity,
                message: `Specialized handler/solver "${name}" declared with 0 parameters. Expected event payload or context parameter.`,
                detail: {
                    function: name,
                    parameterCount: 0,
                    expectedMinimum: 1,
                },
                suggestion:
                    'Declare required event payload, context, or request parameters to fulfill the handler contract.',
            });
            issue.location = {
                file,
                start: { line: startLine, column: startCol },
                end: { line: endPos.line + 1, column: endPos.character + 1 },
            };
            issues.push(issue);
        }
    }

    private auditTypeScriptFunctions(
        sourceFile: ts.SourceFile,
        ctx: AnalyzerContext,
        opts: SimplifyOptions,
        issues: Issue[],
    ): void {
        const walk = (node: ts.Node): void => {
            if (
                ts.isFunctionDeclaration(node) ||
                ts.isMethodDeclaration(node) ||
                ts.isArrowFunction(node) ||
                ts.isFunctionExpression(node) ||
                ts.isConstructorDeclaration(node)
            ) {
                this.auditFunctionParameters({ node, sourceFile, ctx, opts, issues });
            }
            ts.forEachChild(node, walk);
        };
        walk(sourceFile);
    }

    private checkFunctionParameters(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        opts: SimplifyOptions,
        name: string,
    ): void {
        const params = node.parameters;
        if (!params) return;

        const limit = opts.maxFunctionParameters ?? DEFAULT_MAX_FUNCTION_PARAMETERS;
        const file = ctx.filePath.replace(/\\/g, '/');
        const startLine = node.start?.line ?? 1;

        // SIM-ARGS-001 for non-TS (TS handles via type signatures in auditTypeScriptFunctions)
        if (!this.getOrParseSourceFile(ctx) && params.length > limit) {
            const issue = createLineIssue(ANALYZER_SIMPLIFY, file, {
                lineIdx: Math.max(0, startLine - 1),
                rule: RULE_SIM_ARGS_001,
                severity: this.defaultSeverity,
                message: `Function "${name}" has ${params.length} parameters (limit ${limit}). Introduce a parameter object.`,
                detail: {
                    function: name,
                    parameters: params,
                    parameterCount: params.length,
                    limit,
                },
                suggestion:
                    'Encapsulate parameter list into a single options/parameter object using introduce_parameter_object.',
            });
            issue.location = resolveNodeLocation(node, ctx.filePath);
            this.longFunctions.push(issue);
        }

        // SIM-ARGS-002: Minimum parameter count on specialized handlers/solvers
        // (TS handled in auditTypeScriptFunctions)
        if (
            !this.getOrParseSourceFile(ctx) &&
            params.length === 0 &&
            isSemanticHandlerOrSolver(name)
        ) {
            const issue = createLineIssue(ANALYZER_SIMPLIFY, file, {
                lineIdx: Math.max(0, startLine - 1),
                rule: RULE_SIM_ARGS_002,
                severity: this.defaultSeverity,
                message: `Specialized handler/solver "${name}" declared with 0 parameters. Expected event payload or context parameter.`,
                detail: {
                    function: name,
                    parameterCount: 0,
                    expectedMinimum: 1,
                },
                suggestion:
                    'Declare required event payload, context, or request parameters to fulfill the handler contract.',
            });
            issue.location = resolveNodeLocation(node, ctx.filePath);
            this.longFunctions.push(issue);
        }
    }

    visit(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        ...frame: [NormalizedNode?, NormalizedNode?, number?, (string | null)?, (string | null)?]
    ): void {
        if (!node.functionLike || !node.start || !node.end) return;
        const opts = (ctx.options || {}) as SimplifyOptions;
        const className = frame[3] ?? null;
        const binding = frame[4] ?? null;
        const name = this.resolveNameFor(node, className, binding);
        this.checkFunctionLength(node, ctx, opts, name);
        this.checkGuardClauseNesting(node, ctx, opts, name);
        this.checkFunctionParameters(node, ctx, opts, name);
    }

    private dispatchSourceAudits(
        sourceFile: ts.SourceFile | null,
        ctx: AnalyzerContext,
        opts: SimplifyOptions,
        issues: Issue[],
    ): void {
        if (!sourceFile) return;
        const content = ctx.content || '';
        if (content.includes('?') || content.includes('if')) {
            detectTernaryOpportunities(sourceFile, ctx, opts, issues);
            auditStructuralPatterns(content, ctx.filePath, issues);
        }
        if (hasFunctionKeywords(content)) {
            this.auditTypeScriptFunctions(sourceFile, ctx, opts, issues);
            auditOrphanInlining(sourceFile, ctx, opts, issues);
        }
    }

    /**
     * Emit collected long-function findings plus the line-based smell scan.
     *
     * @param ctx - Analyzer context carrying the file content and options.
     * @returns All findings for the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        const issues = this.longFunctions.concat(this.scanContent(ctx));
        const opts = (ctx.options || {}) as SimplifyOptions;
        this.dispatchSourceAudits(this.getOrParseSourceFile(ctx), ctx, opts, issues);
        return issues;
    }

    /**
     * Standalone `analyze()` contract: run the line-based scan and ternary opportunities.
     *
     * @param rawAstOrSource - Optional TypeScript source file or unknown AST.
     * @param ctx - Analyzer context carrying the file content and options.
     * @returns The findings for the file.
     */
    analyze(rawAstOrSource: unknown, ctx: AnalyzerContext): Issue[] {
        const issues = this.scanContent(ctx);
        const opts = (ctx.options || {}) as SimplifyOptions;
        if (isNormalizedNode(rawAstOrSource)) {
            walkNormalizedTree(rawAstOrSource, (node) => this.visit(node, ctx));
            issues.push(...this.longFunctions);
            this.longFunctions = [];
        }
        const isTsSource =
            typeof rawAstOrSource === 'object' &&
            rawAstOrSource !== null &&
            PROP_FOR_EACH_CHILD in rawAstOrSource &&
            typeof (rawAstOrSource as Record<string, unknown>)[PROP_FOR_EACH_CHILD] === 'function';
        const sourceFile = isTsSource
            ? (rawAstOrSource as ts.SourceFile)
            : this.getOrParseSourceFile(ctx);
        this.dispatchSourceAudits(sourceFile, ctx, opts, issues);
        return issues;
    }

    /**
     * Parse source text into a TypeScript SourceFile if the target file is TS/JS.
     *
     * @param ctx - Analyzer context.
     * @returns Parsed SourceFile or null for non-TS/JS sources.
     */
    private parseTsSource(ctx: AnalyzerContext): ts.SourceFile | null {
        if (ctx.sourceFile) {
            return ctx.sourceFile as ts.SourceFile;
        }
        if (!ctx.content) return null;
        const normalizedPath = ctx.filePath.toLowerCase();
        if (
            !normalizedPath.endsWith('.ts') &&
            !normalizedPath.endsWith('.tsx') &&
            !normalizedPath.endsWith('.js') &&
            !normalizedPath.endsWith('.jsx') &&
            !normalizedPath.endsWith('.mjs') &&
            !normalizedPath.endsWith('.cjs')
        ) {
            return null;
        }
        return ts.createSourceFile(ctx.filePath, ctx.content, ts.ScriptTarget.Latest, true);
    }

    /**
     * Run the line-based rules over the file content.
     *
     * @param ctx - Analyzer context carrying the file content and options.
     * @returns Findings for commented-out code, empty implementations and debug output.
     */
    private scanContent(ctx: AnalyzerContext): Issue[] {
        const content = ctx.content || '';
        if (!content) return [];
        const file = ctx.filePath.replace(/\\/g, '/');
        const opts = (ctx.options || {}) as SimplifyOptions;
        const lines = content
            .split('\n')
            .map((lineStr) => (lineStr.endsWith('\r') ? lineStr.slice(0, -1) : lineStr));
        const issues: Issue[] = [];

        this.detectCommentedOutCode(lines, file, opts, issues);
        this.detectEmptyImplementations(lines, file, ctx, issues);
        this.detectDebugOutput(lines, file, opts, issues);
        auditRedundantElse(lines, file, opts, issues);
        auditBooleanReturn(lines, file, opts, issues);
        auditGuardClausePatterns(lines, file, opts, issues);

        return issues;
    }

    /**
     * Flag blocks of consecutive code-shaped comment lines.
     *
     * @param lines - File content split into physical lines.
     * @param file - Normalized file path.
     * @param opts - Analyzer options (`commentedCodeMinLines`).
     * @param issues - Accumulator for emitted issues.
     */
    private detectCommentedOutCode(
        lines: string[],
        file: string,
        opts: SimplifyOptions,
        issues: Issue[],
    ): void {
        const min = opts.commentedCodeMinLines ?? DEFAULT_MIN_COMMENTED_CODE_LINES;
        let streak = 0;
        let start = 0;
        const flush = (endIndex: number): void => {
            if (streak >= min) {
                const issue = createLineIssue(ANALYZER_SIMPLIFY, file, {
                    lineIdx: start,
                    rule: RULE_SIM_COMC_001,
                    severity: this.defaultSeverity,
                    message: `Suspected commented-out code: ${streak} consecutive code-shaped comment lines.`,
                    detail: { lines: streak, first: lines[start].trim() },
                    suggestion:
                        'Delete the block (history lives in git) or restore it to real code.',
                });
                issue.location = {
                    file,
                    start: { line: start + 1, column: 1 },
                    end: { line: endIndex, column: 1 },
                };
                issue.actionable = buildSimplifyActionable({
                    action: ACTION_REPLACE_TOKEN,
                    code: CODE_AR_SIM_003,
                    safeToAutomate: false,
                });
                issues.push(issue);
            }
            streak = 0;
        };
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            let marker: string | undefined;
            for (const markerToken of COMMENT_MARKERS) {
                if (trimmed.startsWith(markerToken)) {
                    marker = markerToken;
                    break;
                }
            }
            const body = marker ? trimmed.slice(marker.length).trim() : '';
            const codeShaped =
                !!marker &&
                body.length > 0 &&
                (CODE_SHAPED_RE.test(body) || REGEX.SYNTAX.CODE_ASSIGN_LINE.test(body));
            if (codeShaped) {
                if (streak === 0) start = i;
                streak++;
            } else {
                flush(i);
            }
        }
        flush(lines.length);
    }

    /**
     * Flag functions whose entire body is `pass`, `...`, or an empty brace pair.
     *
     * @param lines - File content split into physical lines.
     * @param file - Normalized file path.
     * @param lineIndex - Zero-based line index of the detected empty placeholder.
     * @param issues - Accumulator for emitted issues.
     */
    private emitEmptyIssue(
        lines: string[],
        file: string,
        lineIndex: number,
        issues: Issue[],
    ): void {
        const issue = createLineIssue(ANALYZER_SIMPLIFY, file, {
            lineIdx: lineIndex,
            rule: RULE_SIM_EMPTY_001,
            severity: this.defaultSeverity,
            message: 'Empty implementation: the function body is only a placeholder.',
            detail: { line: lines[lineIndex].trim() },
            suggestion:
                'Implement the body, raise an explicit not-implemented error, or remove the declaration.',
        });
        issue.actionable = buildSimplifyActionable({
            action: ACTION_REPLACE_TOKEN,
            code: CODE_AR_SIM_005,
            safeToAutomate: false,
        });
        issues.push(issue);
    }

    private isBraceBlockEmpty(lines: string[], startIndex: number): boolean {
        if (REGEX.SYNTAX.BRACE_EMPTY_ONE_LINER.test(lines[startIndex])) {
            return true;
        }
        if (REGEX.SYNTAX.BRACE_OPEN_FN.test(lines[startIndex])) {
            let lineIndex = startIndex + 1;
            while (
                lineIndex < lines.length &&
                (lines[lineIndex].trim() === '' ||
                    lines[lineIndex].trim().startsWith(PREFIX_SLASH_SLASH))
            ) {
                lineIndex++;
            }
            return lineIndex < lines.length && REGEX.SYNTAX.BRACE_CLOSE_LINE.test(lines[lineIndex]);
        }
        return false;
    }

    private advancePastPythonDocstrings(lines: string[], startIndex: number): number {
        let cursorIndex = startIndex;
        while (cursorIndex < lines.length) {
            const trimmed = lines[cursorIndex].trim();
            if (trimmed === '' || trimmed.startsWith('#')) {
                cursorIndex++;
                continue;
            }
            if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
                const marker = trimmed.startsWith('"""') ? '"""' : "'''";
                if (trimmed.split(marker).length - 1 >= 2) {
                    cursorIndex++;
                    continue;
                }
                cursorIndex++;
                while (cursorIndex < lines.length && !lines[cursorIndex].includes(marker))
                    cursorIndex++;
                cursorIndex++;
                continue;
            }
            break;
        }
        return cursorIndex;
    }

    private updateDocstringState(
        raw: string,
        trimmed: string,
        inTriple: DocstringQuote | null,
    ): DocstringQuote | null {
        if (inTriple) {
            const closers =
                inTriple === CHAR_DOUBLE_QUOTE
                    ? raw.split(TRIPLE_DOUBLE_QUOTE).length - 1
                    : raw.split(TRIPLE_SINGLE_QUOTE).length - 1;
            return closers > 0 ? null : inTriple;
        }
        if (trimmed.startsWith(TRIPLE_DOUBLE_QUOTE) || trimmed.startsWith(TRIPLE_SINGLE_QUOTE)) {
            const marker = trimmed.startsWith(TRIPLE_DOUBLE_QUOTE)
                ? TRIPLE_DOUBLE_QUOTE
                : TRIPLE_SINGLE_QUOTE;
            const markerOccurrences = trimmed.split(marker).length - 1;
            if (markerOccurrences < 2) {
                return marker === TRIPLE_DOUBLE_QUOTE ? CHAR_DOUBLE_QUOTE : CHAR_SINGLE_QUOTE;
            }
            return null;
        }
        return null;
    }

    private checkEmptyAtLine(
        lines: string[],
        file: string,
        lineIndex: number,
        issues: Issue[],
    ): void {
        if (REGEX.SYNTAX.PYTHON_DEF.test(lines[lineIndex])) {
            const indent = this.getIndentWidth(lines[lineIndex]);
            if (this.checkPythonBodyEmpty(lines, lineIndex, indent)) {
                this.emitEmptyIssue(lines, file, lineIndex, issues);
            }
            return;
        }
        if (this.isBraceBlockEmpty(lines, lineIndex)) {
            this.emitEmptyIssue(lines, file, lineIndex, issues);
        }
    }

    /**
     * Identify empty implementation blocks across physical lines.
     *
     * @param lines - Physical lines of the file.
     * @param file - Normalized file path.
     * @param _ctx - Analyzer context.
     * @param issues - Accumulator for emitted issues.
     */
    private detectEmptyImplementations(
        lines: string[],
        file: string,
        _ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        let inTriple: '"' | "'" | null = null;
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmedLine = raw.trim();
            const nextTriple = this.updateDocstringState(raw, trimmedLine, inTriple);
            if (inTriple !== null || nextTriple !== null) {
                inTriple = nextTriple;
                continue;
            }
            this.checkEmptyAtLine(lines, file, i, issues);
        }
    }

    /**
     * Report whether a Python function's effective body is only `pass`/`...`.
     *
     * Skips a leading docstring (single- or multi-line) before testing the body, then verifies
     * the placeholder is the last statement of the block by indentation.
     *
     * @param lines - File content split into physical lines.
     * @param defIndex - Index of the `def` line.
     * @param defIndent - Indentation width of the `def` keyword.
     * @returns True when the body consists solely of a placeholder.
     */
    private checkPythonBodyEmpty(lines: string[], defIndex: number, defIndent: number): boolean {
        const bodyLineIndex = this.advancePastPythonDocstrings(lines, defIndex + 1);
        if (
            bodyLineIndex >= lines.length ||
            !REGEX.SYNTAX.PYTHON_EMPTY_BODY.test(lines[bodyLineIndex].trim())
        ) {
            return false;
        }
        if (this.getIndentWidth(lines[bodyLineIndex]) <= defIndent) {
            return false;
        }
        let nextLineIndex = bodyLineIndex + 1;
        while (
            nextLineIndex < lines.length &&
            (lines[nextLineIndex].trim() === '' || lines[nextLineIndex].trim().startsWith('#'))
        ) {
            nextLineIndex++;
        }
        return (
            nextLineIndex >= lines.length || this.getIndentWidth(lines[nextLineIndex]) <= defIndent
        );
    }

    /**
     * Count the leading-space indentation width of a line.
     *
     * @param line - Raw physical line.
     * @returns The number of leading spaces (tabs count as one column).
     */
    private getIndentWidth(line: string): number {
        return calculateIndentWidth(line);
    }

    /**
     * Flag debug output outside the allow-listed paths.
     *
     * @param lines - File content split into physical lines.
     * @param file - Normalized file path.
     * @param opts - Analyzer options (`printAllowPatterns`).
     * @param issues - Accumulator for emitted issues.
     */
    private detectDebugOutput(
        lines: string[],
        file: string,
        opts: SimplifyOptions,
        issues: Issue[],
    ): void {
        const patterns = (opts.printAllowPatterns ?? DEFAULT_PRINT_ALLOW_PATTERNS).map((pattern) =>
            globToRegExp(pattern),
        );
        if (patterns.length > 0) {
            if (matchAny(patterns, file)) return;
        }
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
                continue;
            }
            if (!REGEX.SYNTAX.DEBUG_PRINT_CALL.test(lines[i])) {
                continue;
            }
            const issue = createLineIssue(ANALYZER_SIMPLIFY, file, {
                lineIdx: i,
                rule: RULE_SIM_PRNT_001,
                severity: this.defaultSeverity,
                message:
                    'Debug output call in non-CLI code: route diagnostics through the project logger.',
                detail: { line: trimmed },
                suggestion:
                    'Use the structured logger (or remove the statement); debug output bypasses log levels and leaks to production stdout.',
            });
            issue.actionable = buildSimplifyActionable({
                action: ACTION_REPLACE_TOKEN,
                code: CODE_AR_SIM_004,
                safeToAutomate: false,
            });
            issues.push(issue);
        }
    }

    /**
     * Resolve a human-readable name for a function-like node.
     *
     * @param node - Function-like normalized node.
     * @param className - Enclosing class name, when the engine threaded one.
     * @param binding - Enclosing binding name for anonymous functions.
     * @returns The resolved display name.
     */
    private resolveNameFor(
        node: NormalizedNode,
        className: string | null,
        binding: string | null,
    ): string {
        if (node.kind === NodeKind.Method && !node.isConstructor) {
            const methodName = node.name ?? ANONYMOUS_NAME;
            return className ? className + '.' + methodName : methodName;
        }
        if (node.kind === NodeKind.Function && node.name) return node.name;
        return binding ?? (className ? className + ANONYMOUS_SUFFIX : ANONYMOUS_NAME);
    }
}
