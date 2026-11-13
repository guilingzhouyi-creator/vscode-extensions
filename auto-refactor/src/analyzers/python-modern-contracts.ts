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

export const RULE_PYM_GENERIC_001 = 'PYM-GENERIC-001';
export const RULE_PYM_ABC_001 = 'PYM-ABC-001';
export const RULE_PYM_IMPORT_001 = 'PYM-IMPORT-001';
export const RULE_PYM_SHADOW_001 = 'PYM-SHADOW-001';

export const ACTION_REPLACE_TOKEN: AgentActionType = 'replace_token';
export const PYTHON_ASYNC_KEYWORD = 'async';

export const SECTION_LABELS: readonly string[] = Object.freeze(['stdlib', 'third-party', 'local']);
export const SECTION_STDLIB_INDEX = 0;
export const SECTION_THIRD_PARTY_INDEX = 1;
export const SECTION_LOCAL_INDEX = 2;

export const SUGGESTION_ABC =
    'Import these names from collections.abc (the typing aliases are deprecated).';
export const SUGGESTION_IMPORT_ORDER = 'Sort each import section alphabetically by whole line.';
export const SUGGESTION_SHADOW =
    'Rename the variable or use a different name to avoid shadowing the outer binding.';

/** Issue metadata specification for constructing structured findings. */
export interface IssueSpec {
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
}

export interface ActionableSpec {
    readonly action?: AgentActionType;
    readonly code: string;
    readonly safeToAutomate?: boolean;
    readonly templateSnippet: string;
}

export const SPEC_RAISE: IssueSpec = Object.freeze({
    rule: 'PYM-RAISE-001',
    severity: SEVERITY_WARNING,
    message: '`raise` inside an except block without `from` drops the original exception chain.',
    suggestion:
        'Re-raise with `raise NewError(...) from exc` (or a bare `raise` to propagate unchanged).',
});

export const SPEC_DEFAULT: IssueSpec = Object.freeze({
    rule: 'PYM-DEFAULT-001',
    severity: SEVERITY_WARNING,
    message:
        'Mutable default argument detected: the default is created once and shared by every call.',
    suggestion: 'Use a `None` sentinel and build the list/dict/set inside the body.',
});

export const SPEC_OPEN: IssueSpec = Object.freeze({
    rule: 'PYM-OPEN-001',
    severity: SEVERITY_WARNING,
    message: '`open()` without a `with` block leaks the file handle on error paths.',
    suggestion:
        'Wrap the call in `with open(...) as handle:` so the handle closes deterministically.',
});

export const SPEC_ASYNC_BLOCKING: IssueSpec = Object.freeze({
    rule: 'PYM-ASYNC-001',
    severity: SEVERITY_ERROR,
    message: 'Blocking call inside an async function blocks the event loop.',
    suggestion:
        'Use the async equivalent (asyncio.sleep, httpx, async repository) or run the blocking call in a thread.',
});

export const SPEC_ASYNC_ORM: IssueSpec = Object.freeze({
    rule: 'PYM-ASYNC-001',
    severity: SEVERITY_ERROR,
    message: 'Synchronous ORM call inside an async function is not awaited.',
    suggestion:
        'Await the async session (`await session.execute(...)`) or use the async repository API.',
});

export const SPEC_SLOTS: IssueSpec = Object.freeze({
    rule: 'PYM-SLOTS-001',
    severity: SEVERITY_WARNING,
    message:
        'Dataclass without slots=True: instances carry a __dict__ and typos create silent attributes.',
    suggestion:
        'Add `slots=True` (or an explicit `slots=False` when __dict__ is genuinely required).',
});

export const SPEC_IMPORT_ORDER: IssueSpec = Object.freeze({
    rule: RULE_PYM_IMPORT_001,
    severity: SEVERITY_WARNING,
    message: 'Import section order violated.',
    suggestion: 'Group imports as stdlib → third-party → local (PEP 8), separated by blank lines.',
});

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

export interface ImportRecord {
    readonly line: number;
    readonly text: string;
    readonly section: number;
}

export type BlockKind = typeof PYTHON_ASYNC_KEYWORD | 'def' | 'class' | 'except' | 'with' | 'other';

export interface Block {
    readonly indent: number;
    readonly kind: BlockKind;
}

export type PyEmitter = (
    targetLineIndex: number,
    spec: IssueSpec,
    detail: Record<string, unknown>,
) => void;

export interface PyLineScanContext {
    line: string;
    trimmed: string;
    lineIndex: number;
    readonly emit: PyEmitter;
}

export interface PyBlockContext {
    inExcept: boolean;
    inWith: boolean;
    inAsync: boolean;
}

export interface PyImportAccumulator {
    readonly file: string;
    readonly records: ImportRecord[];
}
