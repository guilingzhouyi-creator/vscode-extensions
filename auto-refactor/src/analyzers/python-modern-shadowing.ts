/**
 * Module: Static Analysis Engine — Python LEGB Variable Shadowing Detector
 * File Path: src/analyzers/python-modern-shadowing.ts
 * Architecture Role: Tracks Python LEGB lexical scopes across indentation blocks to detect
 *   outer-scope variable, parameter, import, and comprehension shadowing (`PYM-SHADOW-001`).
 * Dependencies & Triggers: core/types, core/constants, python-modern-contracts,
 *   python-modern-tables; invoked per non-blank line by `PythonModernAnalyzer`.
 * Responsibilities:
 *   1. Resolve configurable `shadowing` options and ignore-name allowlists.
 *   2. Extract function parameters, imports, context targets, and assignments as bindings.
 *   3. Walk enclosing LEGB scopes and emit shadowing diagnostics on prior outer bindings.
 * Exit Semantics & Design Rationale: Heuristic line-level scope tracker; control-flow blocks
 *   leak bindings into the enclosing function/class/module scope per Python LEGB semantics.
 */

import { SEVERITY_WARNING } from '../core/types';
import { REGEX } from '../core/constants';
import { SHADOW_IGNORE_NAMES } from './python-modern-tables';
import {
    extractPythonParamNames,
    RULE_PYM_SHADOW_001,
    SUGGESTION_SHADOW,
    type IssueSpec,
    type PyEmitter,
    type PyLineScanContext,
} from './python-modern-contracts';

const CONTEXT_BINDING_PATTERNS: readonly RegExp[] = Object.freeze([
    REGEX.PYTHON.FOR_VAR,
    REGEX.PYTHON.WITH_AS,
    REGEX.PYTHON.EXCEPT_AS,
]);

/** Lexical scope tracked on the parallel LEGB scope stack. */
export interface VarScope {
    readonly indent: number;
    readonly kind: 'module' | 'function' | 'class';
    readonly names: Map<string, number>;
}

/** Normalized options for outer-scope variable shadowing detection. */
export interface ShadowingOptions {
    readonly enabled: boolean;
    readonly ignoreNames: Set<string>;
}

/** Mutable per-file state passed into shadowing checks on each line. */
export interface PyShadowContext {
    indent: number;
    readonly varScopes: VarScope[];
    readonly opts: ShadowingOptions;
    readonly emit: PyEmitter;
}

/**
 * Resolves shadowing options from the analyzer's `ctx.options` object.
 *
 * @param options - Analyzer options bag.
 * @returns Normalized shadowing enabled flag and ignored symbol set.
 */
export function resolveShadowingOptions(options: Record<string, unknown>): ShadowingOptions {
    const raw = (options?.shadowing ?? {}) as Record<string, unknown>;
    const enabled = raw.enabled !== false;
    const ignoreNames = new Set<string>(SHADOW_IGNORE_NAMES);
    if (Array.isArray(raw.ignoreNames)) {
        for (const name of raw.ignoreNames) {
            if (typeof name === 'string') ignoreNames.add(name);
        }
    }
    return { enabled, ignoreNames };
}

function registerBinding(
    name: string,
    targetLine: number,
    targetScope: VarScope,
    shadowCtx: PyShadowContext,
): void {
    if (shadowCtx.opts.ignoreNames.has(name) || targetScope.names.has(name)) return;

    let outerLine = -1;
    const scopes = shadowCtx.varScopes;
    for (let scopeIndex = scopes.length - 2; scopeIndex >= 0; scopeIndex--) {
        const found = scopes[scopeIndex].names.get(name);
        if (found !== undefined) {
            outerLine = found;
            break;
        }
    }

    if (outerLine > 0) {
        const spec: IssueSpec = {
            rule: RULE_PYM_SHADOW_001,
            severity: SEVERITY_WARNING,
            message: `Variable \`${name}\` may shadow an outer-scope declaration (line ${outerLine}).`,
            suggestion: SUGGESTION_SHADOW,
        };
        shadowCtx.emit(targetLine - 1, spec, { name, outerLine, scope: targetScope.kind });
    }
    targetScope.names.set(name, targetLine);
}

function auditDefAndClassShadowing(
    line: string,
    targetLine: number,
    shadowCtx: PyShadowContext,
): boolean {
    const enclosingScope = shadowCtx.varScopes[shadowCtx.varScopes.length - 1];
    const defMatch = REGEX.SYNTAX.PYTHON_DEF_PARAMS.exec(line);
    if (defMatch) {
        registerBinding(defMatch[1], targetLine, enclosingScope, shadowCtx);
        const isFunc =
            REGEX.SYNTAX.PYTHON_ASYNC_DEF.test(line) || REGEX.SYNTAX.PYTHON_DEF_KEYWORD.test(line);
        const newScope: VarScope = {
            indent: shadowCtx.indent,
            kind: isFunc ? 'function' : 'class',
            names: new Map(),
        };
        shadowCtx.varScopes.push(newScope);
        if (isFunc) {
            for (const paramName of extractPythonParamNames(defMatch[2])) {
                registerBinding(paramName, targetLine, newScope, shadowCtx);
            }
        }
        return true;
    }

    if (REGEX.SYNTAX.PYTHON_CLASS_KEYWORD.test(line)) {
        const clsMatch = REGEX.SYNTAX.PYTHON_CLASS.exec(line);
        if (clsMatch) registerBinding(clsMatch[1], targetLine, enclosingScope, shadowCtx);
        shadowCtx.varScopes.push({ indent: shadowCtx.indent, kind: 'class', names: new Map() });
        return true;
    }
    return false;
}

function auditImportShadowing(
    line: string,
    codeOnly: string,
    targetLine: number,
    shadowCtx: PyShadowContext,
): boolean {
    if (!REGEX.PYTHON.IMPORT_STMT.test(codeOnly)) return false;
    const moduleScope = shadowCtx.varScopes[shadowCtx.varScopes.length - 1];
    const simpleImp = REGEX.PYTHON.IMPORT_SIMPLE.exec(line);
    if (simpleImp) registerBinding(simpleImp[1], targetLine, moduleScope, shadowCtx);

    const fromImp = REGEX.PYTHON.IMPORT_FROM.exec(codeOnly);
    if (fromImp) {
        for (const item of fromImp[1].split(',')) {
            const clean = item.trim().replace(REGEX.PYTHON.createParenStripScanner(), '').trim();
            if (!clean) continue;
            const asMatch = REGEX.PYTHON.AS_ALIAS_CAPTURE.exec(clean);
            const name = asMatch ? asMatch[2] : clean.split(/\s+/)[0];
            if (REGEX.PYTHON.VALID_IDENTIFIER.test(name)) {
                registerBinding(name, targetLine, moduleScope, shadowCtx);
            }
        }
    }
    return true;
}

function auditContextBindingShadowing(
    line: string,
    targetLine: number,
    shadowCtx: PyShadowContext,
): boolean {
    const activeScope = shadowCtx.varScopes[shadowCtx.varScopes.length - 1];
    for (const pattern of CONTEXT_BINDING_PATTERNS) {
        const match = pattern.exec(line);
        if (match) {
            registerBinding(match[1], targetLine, activeScope, shadowCtx);
            return true;
        }
    }
    return false;
}

/**
 * Evaluates a single source line for Python outer-scope shadowing (`PYM-SHADOW-001`).
 *
 * @param scanCtx - Current line scan context.
 * @param shadowCtx - Active lexical scope stack and shadowing options.
 */
export function auditVariableShadowing(
    scanCtx: PyLineScanContext,
    shadowCtx: PyShadowContext,
): void {
    if (!shadowCtx.opts.enabled) return;
    const codeOnly = scanCtx.trimmed.split('#')[0].trim();
    const targetLine = scanCtx.lineIndex + 1;

    if (auditDefAndClassShadowing(scanCtx.line, targetLine, shadowCtx)) return;
    if (auditImportShadowing(scanCtx.line, codeOnly, targetLine, shadowCtx)) return;
    if (auditContextBindingShadowing(scanCtx.line, targetLine, shadowCtx)) return;

    const assignMatch = REGEX.PYTHON.ASSIGN.exec(scanCtx.line);
    if (assignMatch && !scanCtx.line.slice(assignMatch[0].length).startsWith('=')) {
        const targetScope = shadowCtx.varScopes[shadowCtx.varScopes.length - 1];
        registerBinding(assignMatch[1], targetLine, targetScope, shadowCtx);
    }
}
