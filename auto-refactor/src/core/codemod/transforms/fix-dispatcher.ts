/**
 * Module: Core Codemod — Diagnostic Issue Fix Dispatcher
 * File Path: src/core/codemod/transforms/fix-dispatcher.ts
 * Architecture Role: Maps diagnostic Issue payloads into fail-closed FixDescriptors by
 *   dispatching registered AST transforms and resolving insertAnchor constant hoisting.
 * Dependencies & Triggers: Invoked by PatchEngine.issueToFix and PatchEngine.issuesToFixes.
 * Responsibilities: Validate transform preconditions, route constant extractions and AST
 *   transforms cleanly, and deduplicate batch constant declarations per target file.
 * Exit Semantics & Design Rationale: Fail-closed design returns null whenever required
 *   source text, safe anchors, or transform parameters are absent or unsafe.
 */

import type { StandardActionVerb } from '../../governance/standard-terminology';
import type { Issue } from '../../types';
import type { FixDescriptor, FixSafetyLevel, TextEdit, TransformContext } from '../types';
import { CONSTANT_EXTRACTION_RULE_SPECS, resolveSafeConstantExtraction } from './extract-constant';
import { createJsDocTemplateFix, type JsDocParam } from './jsdoc-template';
import { createSimplifyBooleanFix } from './modern-construct';
import { createTrampolineInlineFix } from './trampoline-inliner';
import { createUnusedImportFix } from './unused-imports';

interface IssueDispatchMeta {
    readonly issue: Issue;
    readonly context: TransformContext | undefined;
    readonly safetyLevel: FixSafetyLevel;
    readonly description: string;
    readonly plannedSymbolLiteralMap?: Map<string, string>;
}

interface JsDocContractFields {
    readonly summary: string;
    readonly line: number;
    readonly params?: readonly JsDocParam[];
    readonly returns?: string;
    readonly concurrency?: string;
}

const ANCHOR_AFTER_IMPORTS = 'after_imports';
const CODEMOD_RULES = Object.freeze({
    booleanSimplify: 'SIM-BOOL-001',
    unusedImport: 'HYG-DED-001',
    trampoline: 'ARCH-ABS-001',
});
const TRANSFORM_ACTIONS: Readonly<Record<string, StandardActionVerb>> = Object.freeze({
    extractConstant: 'extract_constant',
    simplifyFlow: 'simplify_control_flow',
    insertComment: 'insert_comment_contract',
    meltTrampoline: 'melt_trampoline',
});
const IMPORT_PREFIX = 'import ';
const IMPORT_COMPACT_PREFIX = 'import{';
const PREVIOUS_LINE_OFFSET = 2;

/**
 * Resolves a TransformContext from raw source text or an existing context instance.
 *
 * @param issue - Diagnostic finding providing fallback file path.
 * @param sourceTextOrContext - Optional raw file content or pre-built TransformContext.
 * @returns Resolved TransformContext or undefined when no source content is provided.
 */
export function resolveTransformContext(
    issue: Issue,
    sourceTextOrContext?: string | TransformContext,
): TransformContext | undefined {
    if (!sourceTextOrContext) return undefined;
    if (typeof sourceTextOrContext !== 'string') return sourceTextOrContext;
    return createTransformContext(issue.location?.file || '', sourceTextOrContext);
}

/**
 * Builds a TransformContext for a single target source file.
 *
 * @param filePath - Target file path.
 * @param content - Complete file source text.
 * @returns TransformContext populated with lines and raw source text.
 */
export function createTransformContext(filePath: string, content: string): TransformContext {
    return {
        filePath,
        sourceText: content,
        lines: content.split(/\r\n|\r|\n/),
    };
}

function checkRangeWithinContext(
    range: { startLine: number; startCol: number; endLine: number; endCol: number },
    context?: TransformContext,
): boolean {
    if (
        range.startLine < 1 ||
        range.endLine < range.startLine ||
        range.startCol < 1 ||
        range.endCol < 1
    ) {
        return false;
    }
    return context ? range.endLine <= context.lines.length : true;
}

function resolveConstantExtractionFix(meta: IssueDispatchMeta): FixDescriptor | null {
    const actionable = meta.issue.actionable;
    if (!actionable || !meta.context) return null;
    if (actionable.insertAnchor && actionable.insertAnchor.position !== ANCHOR_AFTER_IMPORTS) {
        return null;
    }
    if (!actionable.targetSymbol || !actionable.patch?.range) return null;

    const planned = resolveSafeConstantExtraction({
        context: meta.context,
        ruleId: meta.issue.rule,
        targetSymbol: actionable.targetSymbol,
        replacementRange: actionable.patch.range,
        literalValue: meta.issue.detail?.value,
        description: meta.description,
        safetyLevel: meta.safetyLevel,
        plannedSymbolLiteralMap: meta.plannedSymbolLiteralMap,
    });
    if (!planned) return null;
    if (planned.insertedDeclaration && meta.plannedSymbolLiteralMap) {
        meta.plannedSymbolLiteralMap.set(planned.targetSymbol, planned.literalText);
    }
    return planned.fix;
}

function resolveBooleanSimplifyFix(
    issue: Issue,
    context: TransformContext,
    safetyLevel: FixSafetyLevel,
    description: string,
): FixDescriptor | null {
    const actionable = issue.actionable;
    const isBooleanTarget =
        issue.rule === CODEMOD_RULES.booleanSimplify ||
        actionable?.action === TRANSFORM_ACTIONS.simplifyFlow;
    if (!isBooleanTarget || !actionable?.patch) return null;

    const { range, replacementText } = actionable.patch;
    const isSingleValidLine =
        range.startLine >= 1 &&
        range.startLine === range.endLine &&
        range.endLine <= context.lines.length;
    if (!isSingleValidLine) return null;

    const baseFix = createSimplifyBooleanFix(context, {
        line: range.startLine,
        startCol: range.startCol,
        endCol: range.endCol,
        replacementText,
    });
    return { ...baseFix, ruleId: issue.rule, description, safetyLevel };
}

function resolveUnusedImportFix(
    issue: Issue,
    context: TransformContext,
    safetyLevel: FixSafetyLevel,
): FixDescriptor | null {
    if (
        issue.rule !== CODEMOD_RULES.unusedImport ||
        typeof issue.detail?.unusedSymbol !== 'string'
    ) {
        return null;
    }
    const line = issue.location?.start?.line ?? 0;
    const targetLine = context.lines[line - 1]?.trim() ?? '';
    if (!targetLine.startsWith(IMPORT_PREFIX) && !targetLine.startsWith(IMPORT_COMPACT_PREFIX)) {
        return null;
    }
    const fix = createUnusedImportFix(context, { line, unusedSymbol: issue.detail.unusedSymbol });
    return fix.edits.length > 0 ? { ...fix, ruleId: issue.rule, safetyLevel } : null;
}

function readOptionalStringArg(
    args: Record<string, unknown> | undefined,
    key: string,
): string | undefined {
    const val = args?.[key];
    return typeof val === 'string' ? val : undefined;
}

function extractJsDocContractFields(
    issue: Issue,
    context: TransformContext,
): JsDocContractFields | null {
    const actionable = issue.actionable;
    if (actionable?.action !== TRANSFORM_ACTIONS.insertComment || !actionable.safeToAutomate) {
        return null;
    }
    const args = actionable.targetArguments as Record<string, unknown> | undefined;
    const summary = (readOptionalStringArg(args, 'summary') ?? '').trim();
    const line = issue.location?.start?.line ?? 0;
    const prevLine = context.lines[line - PREVIOUS_LINE_OFFSET]?.trim() ?? '';
    if (!summary || line < 1 || line > context.lines.length || prevLine.endsWith('*/')) {
        return null;
    }
    return {
        summary,
        line,
        params: Array.isArray(args?.params) ? (args.params as readonly JsDocParam[]) : undefined,
        returns: readOptionalStringArg(args, 'returns'),
        concurrency: readOptionalStringArg(args, 'concurrency'),
    };
}

function resolveJsDocContractFix(
    issue: Issue,
    context: TransformContext,
    safetyLevel: FixSafetyLevel,
): FixDescriptor | null {
    const fields = extractJsDocContractFields(issue, context);
    if (!fields) return null;
    const fix = createJsDocTemplateFix(context, fields);
    return { ...fix, ruleId: issue.rule, safetyLevel };
}

function resolveTrampolineFix(
    issue: Issue,
    context: TransformContext,
    safetyLevel: FixSafetyLevel,
): FixDescriptor | null {
    const actionable = issue.actionable;
    const isTrampolineTarget =
        actionable?.action === TRANSFORM_ACTIONS.meltTrampoline ||
        (issue.rule === CODEMOD_RULES.trampoline && Boolean(actionable?.safeToAutomate));
    if (!isTrampolineTarget) return null;

    const args = (actionable?.targetArguments ?? issue.detail ?? {}) as Record<string, unknown>;
    const trampolinePath = typeof args.trampolinePath === 'string' ? args.trampolinePath : '';
    const targetModulePath = typeof args.targetModulePath === 'string' ? args.targetModulePath : '';
    if (!trampolinePath || !targetModulePath) return null;

    const fix = createTrampolineInlineFix(context, { trampolinePath, targetModulePath });
    return fix.edits.length > 0 ? { ...fix, ruleId: issue.rule, safetyLevel } : null;
}

function resolveRegisteredTransformFix(meta: IssueDispatchMeta): FixDescriptor | null {
    const { issue, context, safetyLevel, description } = meta;
    if (!context) return null;
    return (
        resolveBooleanSimplifyFix(issue, context, safetyLevel, description) ??
        resolveUnusedImportFix(issue, context, safetyLevel) ??
        resolveJsDocContractFix(issue, context, safetyLevel) ??
        resolveTrampolineFix(issue, context, safetyLevel)
    );
}

/**
 * Converts a single actionable Issue into an atomic FixDescriptor using registered transforms.
 *
 * @param issue - Diagnostic finding emitted by scanner.
 * @param context - Optional file TransformContext for anchor and transform verification.
 * @param plannedSymbolLiteralMap - Optional per-file map deduplicating planned declarations.
 * @returns FixDescriptor or null when the finding cannot be fixed safely.
 */
export function resolveSingleIssueFix(
    issue: Issue,
    context: TransformContext | undefined,
    plannedSymbolLiteralMap?: Map<string, string>,
): FixDescriptor | null {
    const actionable = issue.actionable;
    if (!actionable) return null;

    const meta: IssueDispatchMeta = {
        issue,
        context,
        safetyLevel: actionable.safeToAutomate ? 'guaranteed' : 'heuristic',
        description: issue.suggestion || issue.message,
        plannedSymbolLiteralMap,
    };
    const isConstantTarget =
        Boolean(actionable.insertAnchor) ||
        actionable.action === TRANSFORM_ACTIONS.extractConstant ||
        CONSTANT_EXTRACTION_RULE_SPECS.some((spec) => spec.ruleId === issue.rule);
    if (isConstantTarget) {
        return resolveConstantExtractionFix(meta);
    }

    const transformFix = resolveRegisteredTransformFix(meta);
    if (transformFix) return transformFix;

    if (actionable.patch && checkRangeWithinContext(actionable.patch.range, context)) {
        const patchRange = actionable.patch.range;
        const edit: TextEdit = {
            startLine: patchRange.startLine,
            startCol: patchRange.startCol,
            endLine: patchRange.endLine,
            endCol: patchRange.endCol,
            newText: actionable.patch.replacementText,
        };
        return {
            ruleId: issue.rule,
            description: meta.description,
            safetyLevel: meta.safetyLevel,
            edits: [edit],
        };
    }
    return null;
}

/**
 * Converts all non-clustered issues of a file into non-conflicting FixDescriptors,
 * sharing planned top-level constant bindings across fixes in the same file.
 *
 * @param issues - Diagnostic findings scoped to a single source file.
 * @param sourceText - Optional complete source content of the file.
 * @param filePath - Optional path of the file used to construct TransformContext.
 * @returns Ordered array of non-conflicting FixDescriptors.
 */
export function resolveBatchIssuesFixes(
    issues: readonly Issue[],
    sourceText?: string,
    filePath?: string,
): FixDescriptor[] {
    const targetPath = filePath || issues[0]?.location?.file || '';
    const context =
        sourceText !== undefined ? createTransformContext(targetPath, sourceText) : undefined;
    const plannedSymbolLiteralMap = new Map<string, string>();
    const fixes: FixDescriptor[] = [];
    for (const issue of issues) {
        if (issue.clusteredInto) continue;
        const fix = resolveSingleIssueFix(issue, context, plannedSymbolLiteralMap);
        if (fix) fixes.push(fix);
    }
    return fixes;
}
