/**
 * Module: Static Analysis Engine — Python Modernization Rule Contracts & Specs
 * File Path: src/analyzers/python-modern-contracts.ts
 * Architecture Role: Centralizes rule identifiers, actionable fix metadata, PEP-8/PEP-604
 *   issue specs, and single-line fast-trigger predicates for `PythonModernAnalyzer`.
 * Dependencies & Triggers: core/types, core/constants; imported by python-modern.ts and
 *   python-modern-shadowing.ts.
 * Responsibilities:
 *   1. Define immutable IssueSpec descriptors and actionable code-fix templates.
 *   2. Provide fast-trigger token prefiltering for single-line modernization rules.
 *   3. Share line/block/import scanning interfaces without circular dependencies.
 * Exit Semantics & Design Rationale: Pure frozen metadata tables; zero runtime state or I/O.
 */

import type { AgentActionType, Severity } from '../core/types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../core/types';
import { REGEX } from '../core/constants';

/** Canonical rule ID for legacy typing generics (`List`/`Dict`/`Set`/`Tuple`). */
export const RULE_PYM_GENERIC_001 = 'PYM-GENERIC-001';
/** Canonical rule ID for deprecated `typing` abstract collection aliases. */
export const RULE_PYM_ABC_001 = 'PYM-ABC-001';
/** Canonical rule ID for PEP 8 import grouping and ordering violations. */
export const RULE_PYM_IMPORT_001 = 'PYM-IMPORT-001';
/** Canonical rule ID for inner variable/import shadowing outer bindings. */
export const RULE_PYM_SHADOW_001 = 'PYM-SHADOW-001';

/** Default actionable fix operation kind emitted for Python token rewrites. */
export const ACTION_REPLACE_TOKEN: AgentActionType = 'replace_token';
/** Python keyword prefix identifying coroutine function declarations. */
export const PYTHON_ASYNC_KEYWORD = 'async';

/** Ordered PEP 8 import group display labels (`stdlib`, `third-party`, `local`). */
export const SECTION_LABELS: readonly string[] = Object.freeze(['stdlib', 'third-party', 'local']);
/** Section index for Python standard library imports. */
export const SECTION_STDLIB_INDEX = 0;
/** Section index for third-party package imports. */
export const SECTION_THIRD_PARTY_INDEX = 1;
/** Section index for relative/local project imports. */
export const SECTION_LOCAL_INDEX = 2;

/** Remediation message advising `collections.abc` imports. */
export const SUGGESTION_ABC =
    'Import these names from collections.abc (the typing aliases are deprecated).';
/** Remediation message advising PEP 8 section sorting. */
export const SUGGESTION_IMPORT_ORDER = 'Sort each import section alphabetically by whole line.';
/** Remediation message advising variable renaming to resolve shadowing. */
export const SUGGESTION_SHADOW =
    'Rename the variable or use a different name to avoid shadowing the outer binding.';

/** Issue metadata specification for constructing structured findings. */
export interface IssueSpec {
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
}

/** Actionable remediation template metadata keyed by rule ID. */
export interface ActionableSpec {
    readonly action?: AgentActionType;
    readonly code: string;
    readonly safeToAutomate?: boolean;
    readonly templateSnippet: string;
}

function freezeSpec(
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
): IssueSpec {
    return Object.freeze({ rule, severity, message, suggestion });
}

/** Finding descriptor for bare `raise` inside `except` blocks lacking `from`. */
export const SPEC_RAISE: IssueSpec = freezeSpec(
    'PYM-RAISE-001',
    SEVERITY_WARNING,
    '`raise` inside an except block without `from` drops the original exception chain.',
    'Re-raise with `raise NewError(...) from exc` (or a bare `raise` to propagate unchanged).',
);

/** Finding descriptor for mutable default arguments in function signatures. */
export const SPEC_DEFAULT: IssueSpec = freezeSpec(
    'PYM-DEFAULT-001',
    SEVERITY_WARNING,
    'Mutable default argument detected: the default is created once and shared by every call.',
    'Use a `None` sentinel and build the list/dict/set inside the body.',
);

/** Finding descriptor for `open()` calls outside `with` context managers. */
export const SPEC_OPEN: IssueSpec = freezeSpec(
    'PYM-OPEN-001',
    SEVERITY_WARNING,
    '`open()` without a `with` block leaks the file handle on error paths.',
    'Wrap the call in `with open(...) as handle:` so the handle closes deterministically.',
);

/** Finding descriptor for blocking I/O or sleep calls inside `async` functions. */
export const SPEC_ASYNC_BLOCKING: IssueSpec = freezeSpec(
    'PYM-ASYNC-001',
    SEVERITY_ERROR,
    'Blocking call inside an async function blocks the event loop.',
    'Use the async equivalent (asyncio.sleep, httpx, async repository) or run the blocking call in a thread.',
);

/** Finding descriptor for un-awaited synchronous ORM calls inside `async` functions. */
export const SPEC_ASYNC_ORM: IssueSpec = freezeSpec(
    'PYM-ASYNC-001',
    SEVERITY_ERROR,
    'Synchronous ORM call inside an async function is not awaited.',
    'Await the async session (`await session.execute(...)`) or use the async repository API.',
);

/** Finding descriptor for non-inheriting `@dataclass` classes omitting `slots=True`. */
export const SPEC_SLOTS: IssueSpec = freezeSpec(
    'PYM-SLOTS-001',
    SEVERITY_WARNING,
    'Dataclass without slots=True: instances carry a __dict__ and typos create silent attributes.',
    'Add `slots=True` (or an explicit `slots=False` when __dict__ is genuinely required).',
);

/** Finding descriptor for unsorted or misgrouped PEP 8 import blocks. */
export const SPEC_IMPORT_ORDER: IssueSpec = freezeSpec(
    RULE_PYM_IMPORT_001,
    SEVERITY_WARNING,
    'Import section order violated.',
    'Group imports as stdlib → third-party → local (PEP 8), separated by blank lines.',
);

const ACTION_ENTRIES: ReadonlyArray<readonly [string, string, string, AgentActionType?, boolean?]> =
    [
        ['PYM-PATH-001', '001', 'Path($1) / $2'],
        ['PYM-RAISE-001', '002', 'raise $1 from $2', 'apply_guard_clause'],
        ['PYM-DEFAULT-001', '003', '$1: $2 = None', 'apply_guard_clause'],
        ['PYM-DATETIME-001', '004', 'datetime.UTC', undefined, true],
        ['PYM-UNION-001', '005', '$1 | None', undefined, true],
        ['PYM-SLOTS-001', '006', '@dataclass(slots=True)'],
        ['PYM-ASYNC-001', '007', 'await asyncio.to_thread($1)', 'apply_guard_clause'],
        ['PYM-OPEN-001', '008', 'with open($1) as $2:', 'apply_guard_clause'],
        [RULE_PYM_SHADOW_001, '009', '$1_renamed', 'rename_symbol'],
        ['PYM-FSTRING-001', '010', 'f"{$1}"'],
        [RULE_PYM_GENERIC_001, '011', '$1[$2]', undefined, true],
        [RULE_PYM_ABC_001, '012', 'from collections.abc import $1', undefined, true],
        [RULE_PYM_IMPORT_001, '013', 'import $1', 'simplify_control_flow'],
    ];

/** Frozen lookup mapping `PYM-*` rule IDs to actionable remediation metadata. */
export const ACTIONABLE_SPECS: Readonly<Record<string, ActionableSpec>> = Object.freeze(
    Object.fromEntries(
        ACTION_ENTRIES.map(([rule, codeId, templateSnippet, action, safeToAutomate]) => [
            rule,
            {
                action: action ?? ACTION_REPLACE_TOKEN,
                code: `AR:PYM:${codeId}`,
                safeToAutomate: safeToAutomate ?? false,
                templateSnippet,
            },
        ]),
    ),
);

/** Parsed import line record with 1-based line number and PEP 8 section index. */
export interface ImportRecord {
    readonly line: number;
    readonly text: string;
    readonly section: number;
}

/** Python indentation block classification token. */
export type BlockKind = typeof PYTHON_ASYNC_KEYWORD | 'def' | 'class' | 'except' | 'with' | 'other';

/** Indentation-scoped Python lexical block frame. */
export interface Block {
    readonly indent: number;
    readonly kind: BlockKind;
}

/** Callback signature for emitting Python modernization findings on a source line. */
export type PyEmitter = (
    targetLineIndex: number,
    spec: IssueSpec,
    detail: Record<string, unknown>,
) => void;

/** Per-line scan state passed to line-level Python rule checks. */
export interface PyLineScanContext {
    line: string;
    trimmed: string;
    lineIndex: number;
    readonly emit: PyEmitter;
}

/** Active nesting flags for the current Python indentation block stack. */
export interface PyBlockContext {
    inExcept: boolean;
    inWith: boolean;
    inAsync: boolean;
}

/** Per-file import collection buffer used for PEP 8 import ordering analysis. */
export interface PyImportAccumulator {
    readonly file: string;
    readonly records: ImportRecord[];
}

function splitParamParts(paramsStr: string): string[] {
    let depth = 0;
    let current = '';
    const parts: string[] = [];
    for (const charToken of paramsStr) {
        if (charToken === '(' || charToken === '[' || charToken === '{') depth++;
        else if (charToken === ')' || charToken === ']' || charToken === '}') depth--;
        if (charToken === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += charToken;
        }
    }
    if (current.trim() !== '') parts.push(current);
    return parts;
}

function sanitizeParamName(part: string): string | null {
    const trimmed = part.trim();
    if (trimmed === '' || trimmed === '/' || trimmed === '*') return null;
    let cleaned = trimmed.replace(REGEX.PYTHON.createStarPrefixStripScanner(), '').trim();
    const eqIdx = cleaned.indexOf('=');
    const colonIdx = cleaned.indexOf(':');
    if (colonIdx !== -1 && (eqIdx === -1 || colonIdx < eqIdx)) {
        cleaned = cleaned.slice(0, colonIdx).trim();
    }
    if (eqIdx !== -1) cleaned = cleaned.slice(0, eqIdx).trim();
    return REGEX.PYTHON.VALID_IDENTIFIER.test(cleaned) ? cleaned : null;
}

/**
 * Extracts normalized parameter identifier names from a Python `def` signature slice.
 *
 * @param paramsStr - Raw parameter list substring inside `def f(...)`.
 * @returns Parameter identifier names in declaration order.
 */
export function extractPythonParamNames(paramsStr: string): string[] {
    const names: string[] = [];
    for (const part of splitParamParts(paramsStr)) {
        const name = sanitizeParamName(part);
        if (name) names.push(name);
    }
    return names;
}
