/**
 * Module: Static Analysis Engine — GDScript Modernization Rules
 * File Path: src/analyzers/gdscript-modern.ts
 * Architecture Role: GDScript-only style analyzer (a language pack bound to the language, never to
 *     a project) — Godot 3 → 4 migration findings, which no mature external linter covers
 * Dependencies & Triggers: core types + the shared source masker; enabled when a config declares
 *     `analyzers.gdscript-modern`; specialized packs are default-off, so registering it cannot
 *     change an existing gate result
 * Responsibilities: Report seven migration findings on `.gd` files: GDM-YIELD-001 (`yield(`),
 *     GDM-EXPORT-001 (`export` statement), GDM-ONREADY-001 (`onready var`), GDM-TOOL-001 (bare
 *     `tool` line), GDM-POOL-001 (`Pool*Array`), GDM-CONNECT-001 (Godot 3 `connect` signature) and
 *     GDM-RPC-001 (`remote`/`master`/`puppet`/`slave` function modifiers)
 * Exit Semantics & Design Rationale: Pure line scanner over the shared masked view, never throws
 *     and returns [] for every other language. GDScript comments are `#` only, so the mask needs no
 *     block-comment state; triple-quoted docstrings still mask correctly because each quote opens a
 *     run that the next quote closes. The `connect` rule is the one shape that needs the raw line
 *     (its arguments are string literals, which the mask blanks), so it checks both views: the
 *     masked text proves the call is real code, the raw text proves the Godot 3 signature.
 */
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { ANALYZER_GDSCRIPT_MODERN } from '../core/scoring/dimensionLiterals';
import { maskSourceText, type SourceMaskConfig } from '../core/sourceMask';

/** Extension the pack accepts; the content-only path sees every language. */
const SOURCE_EXTENSION = '.gd';

/** Masking syntax for GDScript: `#` line comments and the three quote characters. */
const GDSCRIPT_MASK: SourceMaskConfig = {
    lineComment: '#',
    quoteChars: '"\'`',
};

/** `yield(...)`, replaced by `await`. */
const YIELD_RE = /\byield\s*\(/;

/** `export var x` / `export(int) var x`, replaced by the `@export` annotation. */
const EXPORT_RE = /^\s*export(?:\s*\([^)]*\))?\s+(?:var|const|onready)\b/;

/** `onready var x`, replaced by `@onready var x`. */
const ONREADY_RE = /^\s*onready\s+var\b/;

/** A bare `tool` line at the top of the script, replaced by `@tool`. */
const TOOL_RE = /^\s*tool\s*$/;

/** `Pool*Array` types, renamed to `Packed*Array` in Godot 4. */
const POOL_ARRAY_RE = /\bPool(?:Byte|Int|Real|String|Vector2|Vector3|Color)Array\b/;

/** Godot 3 RPC/modifier keywords ahead of `func`, replaced by the `@rpc` annotation. */
const RPC_MODIFIER_RE =
    /^\s*(?:remote|master|puppet|slave|remotesync|mastersync|puppetsync|sync)\s+func\b/;

/** Godot 3 `connect("signal", self, "method")` call, whose arguments are string literals. */
const LEGACY_CONNECT_RE = /\.connect\s*\(\s*"[^"]*"\s*,\s*(?:self|[A-Za-z_]\w*)\s*,\s*"[^"]*"\s*\)/;

/** One keyword-anchored rule: pattern to match on the masked line plus its report text. */
interface LineRule {
    /** Canonical rule id (`GDM-TOPIC-NNN`). */
    rule: string;
    /** Finding severity. */
    severity: Severity;
    /** Pattern run against the masked line. */
    pattern: RegExp;
    /** Why the Godot 4 form is preferable. */
    message: string;
    /** One-line migration guidance. */
    suggestion: string;
}

/** Keyword rules, all of which fit on one physical line. */
const LINE_RULES: LineRule[] = [
    {
        rule: 'GDM-YIELD-001',
        severity: SEVERITY_WARNING,
        pattern: YIELD_RE,
        message: '`yield` was removed in Godot 4: coroutines are plain `await` expressions.',
        suggestion: 'Rewrite `yield(obj, "signal")` as `await obj.signal`.',
    },
    {
        rule: 'GDM-EXPORT-001',
        severity: SEVERITY_WARNING,
        pattern: EXPORT_RE,
        message: 'The `export` statement syntax is gone; Godot 4 uses annotations.',
        suggestion: 'Write `@export var x: int`, keeping the type in the declaration itself.',
    },
    {
        rule: 'GDM-ONREADY-001',
        severity: SEVERITY_WARNING,
        pattern: ONREADY_RE,
        message: '`onready` became the `@onready` annotation in Godot 4.',
        suggestion: 'Write `@onready var node = $Path`.',
    },
    {
        rule: 'GDM-TOOL-001',
        severity: SEVERITY_WARNING,
        pattern: TOOL_RE,
        message: 'The `tool` keyword became the `@tool` annotation in Godot 4.',
        suggestion: 'Put `@tool` on the first line of the script.',
    },
    {
        rule: 'GDM-POOL-001',
        severity: SEVERITY_WARNING,
        pattern: POOL_ARRAY_RE,
        message: '`Pool*Array` types were renamed to `Packed*Array` in Godot 4.',
        suggestion: 'Use the `PackedByteArray` / `PackedVector2Array` family of names.',
    },
    {
        rule: 'GDM-RPC-001',
        severity: SEVERITY_WARNING,
        pattern: RPC_MODIFIER_RE,
        message: 'RPC keywords before `func` were replaced by the `@rpc` annotation.',
        suggestion:
            'Annotate the function (`@rpc("any_peer", "call_local")`) and drop the keyword.',
    },
];

/**
 * Build one finding anchored to a source line.
 *
 * @param file - Normalized repository-relative path.
 * @param lineIndex - Zero-based line index.
 * @param rule - Canonical rule id.
 * @param severity - Finding severity.
 * @param message - Why the Godot 4 form is preferable.
 * @param suggestion - One-line migration guidance.
 * @param detail - Structured evidence for machines.
 * @returns The finding, ready to be pushed onto the result list.
 */
function makeIssue(
    file: string,
    lineIndex: number,
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
): Issue {
    const line = lineIndex + 1;
    return {
        id: `${ANALYZER_GDSCRIPT_MODERN}:${rule}:${file}:${line}`,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        rule,
        severity,
        message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail,
        suggestion,
    };
}

/** GDScript modernization pack: seven rules over a masked view of the file. */
export class GdscriptModernAnalyzer implements Analyzer {
    name = ANALYZER_GDSCRIPT_MODERN;

    /**
     * Streaming-path entry point: the engine invokes this once per file. Content-only analyzers
     * must expose it, because the legacy `analyze` path covers the TS-family adapters only.
     *
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Scan one GDScript file for Godot 3 → 4 migration findings.
     *
     * @param _sf - Unused TypeScript source file (kept for the analyzer contract).
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const file = ctx.filePath.replace(/\\/g, '/');
        if (!file.endsWith(SOURCE_EXTENSION)) return [];
        const content = ctx.content || '';
        if (content.length === 0) return [];
        const { raw, masked } = maskSourceText(content, GDSCRIPT_MASK);
        const out: Issue[] = [];
        for (let index = 0; index < masked.length; index += 1) {
            const code = masked[index];
            if (code.trim().length === 0) continue;
            for (const rule of LINE_RULES) {
                if (!rule.pattern.test(code)) continue;
                out.push(
                    makeIssue(
                        file,
                        index,
                        rule.rule,
                        rule.severity,
                        rule.message,
                        rule.suggestion,
                        {
                            line: raw[index].trim(),
                        },
                    ),
                );
            }
            if (masked[index].includes('.connect(') && LEGACY_CONNECT_RE.test(raw[index])) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-CONNECT-001',
                        SEVERITY_INFO,
                        'Godot 3 `connect` passes the method as a string, which no checker validates.',
                        'Use `signal.connect(method.callable())` or `signal.connect(_on_signal)`.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
        return out;
    }
}
