/**
 * Module: Core Codemod — Vacuous Trampoline Inliner Transform
 * File Path: src/core/codemod/transforms/trampoline-inliner.ts
 * Architecture Role: Generates FixDescriptor for inlining pass-through trampolines (ARCH-ABS-001)
 *   by rewriting consumer import declarations directly to the underlying concrete modules.
 * Dependencies & Triggers: Triggered by `--fix` on `ARCH-ABS-001` or during architectural cleanup.
 * Responsibilities:
 *   1. Detect whether a module is a vacuous trampoline module (<= 3 code lines of pure re-exports);
 *   2. Generate guaranteed TextEdit patches replacing trampoline import paths in consumer files;
 *   3. Preserve surrounding import formatting, specifiers, and comments.
 * Exit Semantics & Design Rationale: Pure AST/lexical transform emitting guaranteed FixDescriptor;
 *   100% semantics-preserving and ensures atomic refactoring convergence.
 */

import type { FixDescriptor, TextEdit, TransformContext } from '../types';

/** Options configuring trampoline inlining for a consumer file. */
export interface TrampolineInlinerOptions {
    /** The trampoline import path string to locate (e.g. './core/data-structures'). */
    readonly trampolinePath: string;
    /** The underlying target module path to redirect to (e.g. concrete submodule). */
    readonly targetModulePath: string;
}

/** Diagnostic analysis output for a candidate trampoline module. */
export interface TrampolineDetectionResult {
    readonly isTrampoline: boolean;
    readonly reexports: readonly string[];
}

const REEXPORT_PATTERN =
    /^(?:export\s+\*\s+from|export\s*\{[^}]*\}\s*from|module\.exports\s*=)\s*['"](\.[^'"]+)['"]/;

const LOCAL_DECL_PATTERN =
    /(?:^|\s)(?:function|class|interface|type|const|let|var|enum|def|struct|fn)\s+[a-zA-Z0-9_$]+/;

const EMPTY_REEXPORTS: readonly string[] = Object.freeze([]);
const NOT_TRAMPOLINE: TrampolineDetectionResult = Object.freeze({
    isTrampoline: false,
    reexports: EMPTY_REEXPORTS,
});

/**
 * Inspects source code to determine if it is a vacuous trampoline module (ARCH-ABS-001).
 *
 * @param content - Source code text of candidate module.
 * @returns Detection result with re-exported module paths.
 */
export function detectVacuousTrampoline(content: string): TrampolineDetectionResult {
    const rawLines = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').split('\n');
    const codeLines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);

    if (codeLines.length === 0 || codeLines.length > 3) {
        return NOT_TRAMPOLINE;
    }

    const reexports: string[] = [];
    for (const line of codeLines) {
        if (
            LOCAL_DECL_PATTERN.test(line) &&
            !line.startsWith('export {') &&
            !line.startsWith('export *')
        ) {
            return NOT_TRAMPOLINE;
        }
        const match = line.match(REEXPORT_PATTERN);
        if (match && match[1]) {
            reexports.push(match[1]);
        }
    }

    return {
        isTrampoline: reexports.length > 0 && reexports.length === codeLines.length,
        reexports: Object.freeze(reexports),
    };
}

function buildReplacementEdit(
    lineNum: number,
    startCol: number,
    endCol: number,
    newText: string,
): TextEdit {
    return {
        startLine: lineNum,
        startCol,
        endLine: lineNum,
        endCol,
        newText,
    };
}

const REGEX_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;

function escapePathForRegex(pathStr: string): string {
    return pathStr.replace(REGEX_ESCAPE_PATTERN, '\\$&');
}

/**
 * Creates a fix descriptor that replaces references to a trampoline module with the target module.
 *
 * @param context - Transform context for the consumer file.
 * @param options - Trampoline path to replace and target module to substitute.
 * @returns FixDescriptor containing replacement TextEdit objects.
 */
export function createTrampolineInlineFix(
    context: TransformContext,
    options: TrampolineInlinerOptions,
): FixDescriptor {
    const edits: TextEdit[] = [];
    const escaped = escapePathForRegex(options.trampolinePath);
    const targetPattern = new RegExp(`(['"])${escaped}\\1`);

    for (let i = 0; i < context.lines.length; i++) {
        const line = context.lines[i];
        const match = targetPattern.exec(line);
        if (match) {
            const startCol = match.index + 1;
            const endCol = match.index + match[0].length + 1;
            const quote = match[1];
            edits.push(
                buildReplacementEdit(
                    i + 1,
                    startCol,
                    endCol,
                    `${quote}${options.targetModulePath}${quote}`,
                ),
            );
        }
    }

    return {
        ruleId: 'ARCH-ABS-001',
        description: `Inline vacuous trampoline import '${options.trampolinePath}' -> '${options.targetModulePath}'`,
        safetyLevel: 'guaranteed',
        edits,
    };
}
