/**
 * Module: Core Codemod — Constant Extraction Transform
 * File Path: src/core/codemod/transforms/extract-constant.ts
 * Architecture Role: Generates FixDescriptor for extracting magic literals into
 *   top-level constants with AST-verified anchor resolution and collision guards.
 * Dependencies & Triggers: Triggered by `--fix` on `magic-number` or `hardcoded-string`;
 *   consumes extract-constant-guards.ts for AST literal and binding validation.
 * Responsibilities: Compute AST-safe after_imports anchors, coordinate collision/TDZ guards,
 *   and emit atomic insertion + replacement TextEdits.
 * Exit Semantics & Design Rationale: Fail-closed resolver returns null when safe declaration
 *   coordinates cannot be guaranteed; preserves backwards-compatible createExtractConstantFix.
 */

import type * as ts from 'typescript';
import { TextEditApplier } from '../text-edit-applier';
import type { FixDescriptor, FixSafetyLevel, TextEdit, TransformContext } from '../types';
import {
    buildDeclarationInsertionEdit,
    checkLiteralValueMatch,
    checkSafeTargetSymbol,
    findSafeLiteralNodeAtSpan,
    hasEnclosingScopeShadow,
    inspectTopLevelBinding,
    isSupportedJsTsPath,
    parseCleanSourceFile,
} from './extract-constant-guards';

/** Options configuring legacy line-based constant extraction. */
export interface ExtractConstantOptions {
    /** Target line number where literal occurs (1-indexed). */
    readonly line: number;
    /** Target column number where literal begins (1-indexed). */
    readonly startCol: number;
    /** Target column number where literal ends (1-indexed). */
    readonly endCol: number;
    /** Literal value string as represented in code. */
    readonly literalValue: string;
    /** Suggested name for the extracted constant identifier. */
    readonly suggestedName: string;
    /** Optional rule identifier attributing this fix (defaults to 'magic-number'). */
    readonly ruleId?: string;
}

/** Input configuring fail-closed AST-verified constant extraction for a scan Issue. */
export interface SafeExtractConstantInput {
    readonly context: TransformContext;
    readonly ruleId: string;
    readonly targetSymbol: string;
    readonly replacementRange: {
        readonly startLine: number;
        readonly startCol: number;
        readonly endLine: number;
        readonly endCol: number;
    };
    readonly literalValue?: unknown;
    readonly description?: string;
    readonly safetyLevel?: FixSafetyLevel;
    readonly plannedSymbolLiteralMap?: ReadonlyMap<string, string>;
}

/** Planned constant extraction outcome returned when AST safety verification succeeds. */
export interface PlannedConstantExtraction {
    readonly fix: FixDescriptor;
    readonly targetSymbol: string;
    readonly literalText: string;
    readonly insertedDeclaration: boolean;
}

import { resolveConstantInsertionLine } from './constant-anchor-scanner';
export { resolveConstantInsertionLine } from './constant-anchor-scanner';

/** Canonical codemod rule registration for constant extraction transforms. */
export const CONSTANT_EXTRACTION_RULE_SPECS: readonly {
    readonly ruleId: string;
    readonly action: string;
}[] = Object.freeze([
    { ruleId: 'magic-number', action: 'extract_constant' },
    { ruleId: 'hardcoded-string', action: 'extract_constant' },
]);

const FIRST_LINE = 1;
const FIRST_COLUMN = 1;
const DEFAULT_EXTRACT_RULE_ID = 'magic-number';

function resolveSpanOffsets(
    context: TransformContext,
    range: SafeExtractConstantInput['replacementRange'],
): { readonly startOffset: number; readonly endOffset: number; readonly sliceText: string } | null {
    if (
        range.startLine < FIRST_LINE ||
        range.endLine < range.startLine ||
        range.endLine > context.lines.length
    ) {
        return null;
    }
    const lineOffsets = TextEditApplier.buildLineOffsets(context.sourceText);
    const maxLen = context.sourceText.length;
    const startOffset = TextEditApplier.coordinateToOffset(
        lineOffsets,
        range.startLine,
        range.startCol,
        maxLen,
    );
    const endOffset = TextEditApplier.coordinateToOffset(
        lineOffsets,
        range.endLine,
        range.endCol,
        maxLen,
    );
    if (startOffset >= endOffset) return null;
    return { startOffset, endOffset, sliceText: context.sourceText.slice(startOffset, endOffset) };
}

function buildAtomicConstantEdits(
    sourceFile: ts.SourceFile,
    input: SafeExtractConstantInput,
    sliceText: string,
    startOffset: number,
    alreadyDeclared: boolean,
): { readonly edits: TextEdit[]; readonly insertedDeclaration: boolean } | null {
    const edits: TextEdit[] = [];
    if (!alreadyDeclared) {
        const insertion = buildDeclarationInsertionEdit(
            sourceFile,
            input.context.lines,
            `const ${input.targetSymbol} = ${sliceText};`,
        );
        if (insertion.insertOffset > startOffset) return null;
        edits.push(insertion.edit);
    }
    const range = input.replacementRange;
    edits.push({
        startLine: range.startLine,
        startCol: range.startCol,
        endLine: range.endLine,
        endCol: range.endCol,
        newText: input.targetSymbol,
    });
    return { edits, insertedDeclaration: !alreadyDeclared };
}

/**
 * Resolves an AST-verified, fail-closed FixDescriptor for `after_imports` constant hoisting.
 * Prevents duplicate declarations, TDZ references, enclosing-scope shadowing, and unsafe syntax.
 *
 * @param input - Safe constant extraction planning parameters.
 * @returns Planned constant extraction result, or null when safe anchor/binding cannot be verified.
 */
export function resolveSafeConstantExtraction(
    input: SafeExtractConstantInput,
): PlannedConstantExtraction | null {
    const { context, targetSymbol, replacementRange } = input;
    if (!isSupportedJsTsPath(context.filePath) || !checkSafeTargetSymbol(targetSymbol)) {
        return null;
    }
    const sourceFile = parseCleanSourceFile(context.filePath, context.sourceText);
    const span = sourceFile ? resolveSpanOffsets(context, replacementRange) : null;
    if (!sourceFile || !span) return null;

    const literalNode = findSafeLiteralNodeAtSpan(sourceFile, span.startOffset, span.endOffset);
    if (!literalNode || !checkLiteralValueMatch(literalNode, span.sliceText, input.literalValue)) {
        return null;
    }

    const topStatus = inspectTopLevelBinding(sourceFile, targetSymbol, span.sliceText);
    if (topStatus.conflict || hasEnclosingScopeShadow(literalNode, targetSymbol)) return null;

    const batchExisting = input.plannedSymbolLiteralMap?.get(targetSymbol);
    if (batchExisting !== undefined && batchExisting !== span.sliceText) return null;

    const matchingEnd = topStatus.matchingConstEndOffset;
    if (matchingEnd !== null && matchingEnd > span.startOffset) return null;

    const built = buildAtomicConstantEdits(
        sourceFile,
        input,
        span.sliceText,
        span.startOffset,
        matchingEnd !== null || batchExisting === span.sliceText,
    );
    if (!built) return null;

    return {
        fix: {
            ruleId: input.ruleId,
            description:
                input.description ||
                `Extract literal ${span.sliceText} to constant ${targetSymbol}`,
            safetyLevel: input.safetyLevel ?? 'guaranteed',
            edits: built.edits,
        },
        targetSymbol,
        literalText: span.sliceText,
        insertedDeclaration: built.insertedDeclaration,
    };
}

/**
 * Creates a fix descriptor that hoists a literal to a top-level constant definition.
 *
 * @param context - Transform analysis context for target file.
 * @param options - Configuration specifying target literal location and constant identifier.
 * @returns FixDescriptor containing insertion and replacement text edits.
 */
export function createExtractConstantFix(
    context: TransformContext,
    options: ExtractConstantOptions,
): FixDescriptor {
    const insertLine = resolveConstantInsertionLine(context.lines);
    const constDeclaration = `const ${options.suggestedName} = ${options.literalValue};\n`;
    const insertEdit: TextEdit = {
        startLine: insertLine,
        startCol: FIRST_COLUMN,
        endLine: insertLine,
        endCol: FIRST_COLUMN,
        newText: constDeclaration,
    };
    const replaceEdit: TextEdit = {
        startLine: options.line,
        startCol: options.startCol,
        endLine: options.line,
        endCol: options.endCol,
        newText: options.suggestedName,
    };
    return {
        ruleId: options.ruleId || DEFAULT_EXTRACT_RULE_ID,
        description: `Extract literal ${options.literalValue} to constant ${options.suggestedName}`,
        safetyLevel: 'guaranteed',
        edits: [insertEdit, replaceEdit],
    };
}
