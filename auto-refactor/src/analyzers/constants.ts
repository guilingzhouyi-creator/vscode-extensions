/**
 * Module: Static Analysis Engine — Inline Literal Extraction
 * File Path: src/analyzers/constants.ts
 * Architecture Role: Language-agnostic analyzer that turns the engine's single shared
 *   traversal into constant-extraction findings over numeric and string literals
 * Dependencies & Triggers: core types, NodeKind/NormalizedNode, LiteralRecord, locN,
 *   runStreaming, classifyLiteral, plus a lazy `typescriptAdapter` require; triggered when the
 *   declarative `analyzers.constants` entry is enabled by CLI / CI / daemon scans
 * Responsibilities: Collect every literal once per file, skipping reused subtrees; rebuild
 *   full-file duplicate groups across warm scans; emit duplicate-literal, magic-number and
 *   hardcoded-string findings; honor magicNumberMin, hardcodedStringMinLength,
 *   duplicateLiteralThreshold, ignoreLiterals and classifyLiterals; skip trivial, const-bound and
 *   tolerated literals, plus the benign-vocabulary literals `classifyLiteral` marks reasonable;
 *   propose constant names, optionally classified semantically
 * Exit Semantics & Design Rationale: analyze() is the standalone contract and finalize() runs
 *   the three detection passes; duplicate-literal is a full-file multiset, so it is rebuilt
 *   from reused plus fresh records instead of being reused wholesale, keeping warm scans
 *   byte-identical to a cold rescan.
 *
 * Three promotion categories:
 *   1. magic-number      — a numeric literal used inline (not already a `const`).
 *   2. hardcoded-string  — a string literal used inline (not already a `const` / i18n call /
 *      import path).
 *   3. duplicate-literal — a value (number or string) repeated >= threshold times in a file.
 *
 * The heavy lifting happens in the engine's single shared traversal: `visit` collects every
 * literal (const-binding and tolerated flags are precomputed by the language adapter,
 * so no `ts.isXxx` predicates remain here), and `finalize` runs the three detection passes;
 * `analyze` delegates to `runStreaming` so standalone calls match the multiplexed engine path.
 */
import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import type { NormalizedNode } from '../core/multilang';
import { NodeKind } from '../core/multilang';
import type { LiteralRecord } from '../core/incrementalState';
import { locN } from '../utils/normalized';
import { runStreaming } from '../core/traverse';
import { classifyLiteral } from '../core/governance/semanticLiterals';

const TRIVIAL_NUMBERS = new Set(['0', '1', '-1']);

/** Character code of the single-quote (') string delimiter. */
const CHAR_CODE_SINGLE_QUOTE = 39;
/** Character code of the double-quote (") string delimiter. */
const CHAR_CODE_DOUBLE_QUOTE = 34;
/** Character code of the backtick (`) template-literal delimiter. */
const CHAR_CODE_BACKTICK = 96;
/** Absolute-value limit below which an integer gets a `CONST_<n>` name suggestion. */
const SUGGESTED_NAME_INTEGER_LIMIT = 1000;
/** Maximum number of words kept when deriving a constant name from a string literal. */
const SUGGESTED_NAME_MAX_WORDS = 4;
/** Analyzer id emitted on every finding and matched by the declarative `analyzers.constants`. */
const CONSTANTS_ANALYZER_NAME = 'constants';
/** Semantic literal kind used when no specialized category (URL, port, path, ...) applies. */
const LITERAL_KIND_GENERAL = 'general';
/** `suggestName` kind for numeric literals. */
const NUM_KIND = 'number';
/** `suggestName` kind for string literals. */
const STR_KIND = 'string';

/** Order two literal observations by source position (1-based line, then column). */
function byPosition(a: LiteralRecord, b: LiteralRecord): number {
    const al = a.node.start ? a.node.start.line : 0;
    const bl = b.node.start ? b.node.start.line : 0;
    if (al !== bl) return al - bl;
    const ac = a.node.start ? a.node.start.column : 0;
    const bc = b.node.start ? b.node.start.column : 0;
    return ac - bc;
}

/** Fast strip leading and trailing quote characters without RegExp allocation */
function stripQuotes(str: string): string {
    const len = str.length;
    if (len < 2) {
        if (len === 1 && (str === "'" || str === '"' || str === '`')) return '';
        return str;
    }
    const first = str.charCodeAt(0);
    const last = str.charCodeAt(len - 1);
    const hasLead =
        first === CHAR_CODE_SINGLE_QUOTE ||
        first === CHAR_CODE_DOUBLE_QUOTE ||
        first === CHAR_CODE_BACKTICK;
    const hasTail =
        last === CHAR_CODE_SINGLE_QUOTE ||
        last === CHAR_CODE_DOUBLE_QUOTE ||
        last === CHAR_CODE_BACKTICK;
    if (hasLead && hasTail) return str.slice(1, -1);
    if (hasLead) return str.slice(1);
    if (hasTail) return str.slice(0, -1);
    return str;
}

/**
 * Detect inline literals that should be promoted to named constants.
 *
 * The analyzer collects numeric and string literal records during the engine's shared
 * traversal (`visit`), then runs three detection passes in `finalize`: magic-number,
 * hardcoded-string and full-file duplicate-literal grouping. Reused incremental subtrees
 * are reseeded from previous records rather than re-collected, so warm scans stay
 * byte-identical to a cold rescan.
 *
 * Contract: produces canonical `Issue` records for the `magic-number`,
 * `hardcoded-string` and `duplicate-literal` rules. Inputs are the parsed `SourceFile`
 * or normalized tree plus `AnalyzerContext.options` (`magicNumberMin`,
 * `hardcodedStringMinLength`, `duplicateLiteralThreshold`, `ignoreLiterals`,
 * `classifyLiterals`, `granularRules`) and optional incremental state. Output is a list
 * of promotable literals with suggested constant names, or an empty array when no
 * literal crosses its configured threshold.
 * Edge cases: trivial numbers (0/1/-1), const-bound literals, tolerated literals and
 * ignored values are skipped; duplicate detection is a whole-file multiset, so warm
 * scans rebuild it from reused plus fresh records instead of trusting cached groups.
 * Failure semantics: never throws; a file with no analyzable literals yields [].
 */
export class ConstantsAnalyzer implements Analyzer {
    name = CONSTANTS_ANALYZER_NAME;

    private literals: LiteralRecord[] = [];
    private issues: Issue[] = [];

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        this.literals = [];
        this.issues = [];
        // Lazy: the TypeScript adapter (and the `typescript` module) is only needed for the
        // standalone `analyze()` contract — never on the worker streaming path.

        const { TypeScriptAdapter } =
            require('../core/typescriptAdapter') as typeof import('../core/typescriptAdapter');
        const adapter = new TypeScriptAdapter();
        const ast = adapter.parse(sf.text, ctx.filePath);
        return runStreaming(adapter, ast.root, [
            { analyzer: this, ctx: { ...ctx, sourceFile: sf, root: ast.root, adapter } },
        ]);
    }

    visit(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        parent: NormalizedNode | undefined,
        _grandparent: NormalizedNode | undefined,
        _depth: number,
        _className: string | null,
        _binding: string | null,
    ): void {
        if (node.kind === NodeKind.NumericLiteral || node.kind === NodeKind.StringLiteral) {
            // T03 memo: literals inside a reused subtree are the SAME objects as the previous
            // scan (identity holds via the subtree cache), so skip re-collecting them — finalize
            // re-seeds them from the previous scan's `literalRecords`.
            const state = ctx.incremental;
            if (state && state.isReusedLiteral(node)) return;
            this.literals.push({
                value: node.text ?? '',
                numeric: node.kind === NodeKind.NumericLiteral,
                node,
                parent,
                isConstBound: !!node.isConstBound,
                tolerated: !!node.tolerated,
                line: node.start ? node.start.line : 0,
            });
        }
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        const issues: Issue[] = [];
        const state = ctx.incremental;

        // T03 recomposition: duplicate-literal is a FULL-FILE multiset, so it can never be
        // reused wholesale. Rebuild it from (reused-subtree records from the previous scan) +
        // (fresh records collected this scan), then re-sort by source position so the group
        // membership + `lines` ordering match a full rescan byte-for-byte.
        if (state && state.getPrevLiteralRecords().length > 0) {
            const reused: LiteralRecord[] = [];
            for (const rec of state.getPrevLiteralRecords()) {
                if (state.isReusedLiteral(rec.node)) reused.push(rec);
            }
            this.literals = [...reused, ...this.literals].sort(byPosition);
            state.setLiteralRecords(this.literals);
        } else if (state) {
            state.setLiteralRecords(this.literals);
        }
        this.issues = issues;

        // Pass 1: find duplicate groups, emit duplicate-literal findings, and collect the
        // set of nodes that should be suppressed from the individual passes.
        const duplicateNodes = new Set<NormalizedNode>();
        this.detectDuplicates(ctx, duplicateNodes, issues);

        // Pass 2/3: individual magic-number / hardcoded-string findings (skip duplicates).
        this.detectMagicNumbers(ctx, duplicateNodes, issues);
        this.detectHardcodedStrings(ctx, duplicateNodes, issues);

        return issues;
    }

    private detectMagicNumbers(
        ctx: AnalyzerContext,
        suppress: Set<NormalizedNode>,
        out: Issue[],
    ): void {
        const min = ctx.options.magicNumberMin;
        const classify = !!ctx.options.classifyLiterals;
        const granular = !!ctx.options.granularRules;

        for (const lit of this.literals) {
            if (!lit.numeric || lit.isConstBound) continue;
            if (suppress.has(lit.node)) continue;
            const num = Number(lit.value);
            if (!isFinite(num)) continue;
            if (TRIVIAL_NUMBERS.has(lit.value)) continue;
            if (Math.abs(num) < min) continue;
            if (lit.tolerated) continue;

            const classification = classify ? classifyLiteral(lit.value, true) : null;
            if (classify && classification && classification.isReasonable) {
                continue;
            }

            const rule =
                granular && classification && classification.kind !== LITERAL_KIND_GENERAL
                    ? `literal-${classification.kind}`
                    : 'magic-number';

            const suggested =
                classify && classification && classification.suggestedConstPrefix !== 'CONST'
                    ? classification.suggestedConstPrefix
                    : this.suggestName(lit.value, NUM_KIND);

            const detail: Record<string, unknown> = {
                value: lit.value,
                numeric: true,
                suggestedName: suggested,
            };
            if (classify && classification) {
                detail.semanticKind = classification.kind;
                detail.rationale = classification.rationale;
            }

            out.push({
                id: `constants:${rule}:${ctx.filePath}:${lit.node.start?.line ?? 1}`,
                analyzer: CONSTANTS_ANALYZER_NAME,
                rule,
                severity: 'warning',
                message:
                    classify && classification && classification.kind !== LITERAL_KIND_GENERAL
                        ? `${classification.rationale}: ${lit.value} should be extracted.`
                        : `Magic number ${lit.value} should be extracted into a named constant.`,
                location: locN(lit.node, ctx.filePath),
                detail,
                suggestion: `const ${suggested} = ${lit.value};`,
            });
        }
    }

    private detectHardcodedStrings(
        ctx: AnalyzerContext,
        suppress: Set<NormalizedNode>,
        out: Issue[],
    ): void {
        const minLen = ctx.options.hardcodedStringMinLength;
        const ignoreSet = new Set<string>(ctx.options.ignoreLiterals || []);
        const classify = !!ctx.options.classifyLiterals;
        const granular = !!ctx.options.granularRules;

        for (const lit of this.literals) {
            if (lit.numeric || lit.isConstBound) continue;
            if (suppress.has(lit.node)) continue;
            const text = lit.value;
            const inner = stripQuotes(text);
            if (inner.length < minLen || inner.trim().length === 0) continue;
            if (lit.tolerated) continue;
            if (ignoreSet.has(text) || ignoreSet.has(inner)) continue;

            const classification = classify ? classifyLiteral(text, false) : null;
            if (classify && classification && classification.isReasonable) {
                continue;
            }

            const rule =
                granular && classification && classification.kind !== LITERAL_KIND_GENERAL
                    ? `literal-${classification.kind}`
                    : 'hardcoded-string';

            const suggested =
                classify && classification && classification.suggestedConstPrefix !== 'CONST_STR'
                    ? `${classification.suggestedConstPrefix}_${this.suggestName(inner, STR_KIND)}`
                    : this.suggestName(inner, STR_KIND);

            const detail: Record<string, unknown> = {
                value: text,
                length: inner.length,
                suggestedName: suggested,
            };
            if (classify && classification) {
                detail.semanticKind = classification.kind;
                detail.rationale = classification.rationale;
            }

            out.push({
                id: `constants:${rule}:${ctx.filePath}:${lit.node.start?.line ?? 1}`,
                analyzer: CONSTANTS_ANALYZER_NAME,
                rule,
                severity: 'warning',
                message:
                    classify && classification && classification.kind !== LITERAL_KIND_GENERAL
                        ? `${classification.rationale}: ${text} should be extracted.`
                        : `Hardcoded string should be extracted into a named constant.`,
                location: locN(lit.node, ctx.filePath),
                detail,
                suggestion: `const ${suggested} = ${text};`,
            });
        }
    }

    private detectDuplicates(
        ctx: AnalyzerContext,
        suppress: Set<NormalizedNode>,
        out: Issue[],
    ): void {
        const threshold = ctx.options.duplicateLiteralThreshold;
        const ignoreSet = new Set<string>(ctx.options.ignoreLiterals || []);
        const classify = !!ctx.options.classifyLiterals;
        const groups = new Map<string, LiteralRecord[]>();
        for (const lit of this.literals) {
            if (lit.isConstBound) continue;
            // Tolerated contexts are out of scope in every pass; without this check a repeated
            // docstring / import path / JSX text would be reported as an extraction candidate
            // even though the magic-number and hardcoded-string passes skip it.
            if (lit.tolerated) continue;
            if (
                lit.numeric &&
                (TRIVIAL_NUMBERS.has(lit.value) ||
                    Math.abs(Number(lit.value)) < ctx.options.magicNumberMin)
            ) {
                continue;
            }
            if (!lit.numeric) {
                const str = stripQuotes(lit.value).trim();
                // Empty string or whitespace is not considered a duplicate literal
                // requiring extraction.
                if (str.length === 0) continue;
                if (ignoreSet.has(lit.value) || ignoreSet.has(str)) continue;
            }
            // Same semantic gate the magic-number and hardcoded-string passes apply: a benign
            // delimiter, encoding name or HTTP verb repeats because the vocabulary does, and the
            // extraction advice would be wrong for it. Gated on `classifyLiterals` so enabling the
            // engine can never silently drop findings for a project that has not opted in.
            if (classify && classifyLiteral(lit.value, lit.numeric).isReasonable) continue;
            const key = `${lit.numeric ? 'N' : 'S'}:${lit.value}`;
            const arr = groups.get(key) || [];
            arr.push(lit);
            groups.set(key, arr);
        }

        for (const [, arr] of groups) {
            if (arr.length < threshold) continue;
            for (const l of arr) suppress.add(l.node);
            const first = arr[0];
            const valText = first.value.trim();
            if (!first.numeric && valText.length === 0) continue;
            const suggested = this.suggestName(first.value, first.numeric ? NUM_KIND : STR_KIND);
            out.push({
                id: `constants:duplicate-literal:${ctx.filePath}:${first.node.start?.line ?? 1}`,
                analyzer: CONSTANTS_ANALYZER_NAME,
                rule: 'duplicate-literal',
                severity: 'warning',
                message: `Literal ${first.value} is repeated ${arr.length} times in this file; extract it into a shared constant.`,
                location: locN(first.node, ctx.filePath),
                detail: {
                    value: first.value,
                    numeric: first.numeric,
                    occurrences: arr.length,
                    lines: arr.map((l) => l.node.start?.line ?? 1),
                    suggestedName: suggested,
                },
                suggestion: `const ${suggested} = ${first.value}; // used ${arr.length}x`,
            });
        }
    }

    private suggestName(value: string, kind: typeof NUM_KIND | typeof STR_KIND): string {
        if (kind === NUM_KIND) {
            const n = Number(value);
            if (Number.isInteger(n) && Math.abs(n) < SUGGESTED_NAME_INTEGER_LIMIT)
                return `CONST_${n}`;
            return 'EXTRACTED_NUMBER';
        }
        const cleaned = value
            .replace(/^['"`]|['"`]$/g, '')
            .replace(/[^A-Za-z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .slice(0, SUGGESTED_NAME_MAX_WORDS)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join('');
        return cleaned ? `${cleaned.toUpperCase()}_TEXT` : 'EXTRACTED_STRING';
    }
}
