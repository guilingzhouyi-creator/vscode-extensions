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
 * A fourth pass reports redundant constant aliases (`const A = B`) as nested-constant. Object
 * literal nesting is deliberately NOT reported: schema and document builders (the SARIF writer,
 * scan-config fixtures) legitimately nest four or more levels, so the advice to flatten them
 * would be wrong.
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
import type { LiteralRecord } from '../core/incremental-state';
import { locN } from '../utils/normalized';
import { runStreaming } from '../core/traverse';
import { classifyLiteral } from '../core/governance/semanticLiterals';
import { maskedLinesOfPath } from '../core/source-mask';
import { scanNearLiteralClusters } from '../core/intelligence/near-literal-cluster';
import { checkConstantLayoutAndScope } from '../core/governance/constant-layout-guard';
import { inferFineGrainedFileRole } from '../core/intelligence/file-role-inference';

const TRIVIAL_NUMBERS = new Set(['0', '1', '-1']);

/** Benign common token set exempt from duplicate-literal flagging in test suites. */
const TEST_SUITE_BENIGN_TOKENS = new Set([
    'foo',
    'bar',
    'baz',
    'qux',
    'test',
    'sample',
    'mock',
    'dummy',
    'fake',
    '*',
    'ok',
    'err',
    'error',
    'success',
    'pass',
    'fail',
]);

/** Schema property token set exempt from duplicate-literal flagging in config/data tables. */
const SCHEMA_PROPERTY_TOKENS = new Set([
    'id',
    'name',
    'type',
    'value',
    'key',
    'label',
    'desc',
    'description',
    'icon',
    'category',
    'status',
    'weight',
    'enabled',
    'disabled',
    'target',
    'item',
    'version',
    'title',
    'group',
    'order',
    'path',
    'data',
]);

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
/** Severity every constants finding carries: extraction advice never blocks a build by itself. */
const CONSTANTS_SEVERITY = 'warning';
/** Semantic literal kind used when no specialized category (URL, port, path, ...) applies. */
const LITERAL_KIND_GENERAL = 'general';
/** `suggestName` kind for numeric literals. */
const NUM_KIND = 'number';
/** `suggestName` kind for string literals. */
const STR_KIND = 'string';
/** Rule ID for duplicate literal extractions. */
const RULE_DUPLICATE_LITERAL = 'duplicate-literal';

/** Order two literal observations by source position (1-based line, then column). */
function byPosition(a: LiteralRecord, b: LiteralRecord): number {
    const al = a.node.start ? a.node.start.line : 0;
    const bl = b.node.start ? b.node.start.line : 0;
    if (al !== bl) return al - bl;
    const ac = a.node.start ? a.node.start.column : 0;
    const bc = b.node.start ? b.node.start.column : 0;
    return ac - bc;
}

function isQuoteCharCode(code: number): boolean {
    return (
        code === CHAR_CODE_SINGLE_QUOTE ||
        code === CHAR_CODE_DOUBLE_QUOTE ||
        code === CHAR_CODE_BACKTICK
    );
}

/** Fast strip leading and trailing quote characters without RegExp allocation */
function stripQuotes(str: string): string {
    const len = str.length;
    if (len === 0) return str;
    const start = isQuoteCharCode(str.charCodeAt(0)) ? 1 : 0;
    const end = len > start && isQuoteCharCode(str.charCodeAt(len - 1)) ? len - 1 : len;
    return start > 0 || end < len ? str.slice(start, end) : str;
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
            require('../core/typescript-adapter') as typeof import('../core/typescript-adapter');
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
        this.reconcileIncrementalLiterals(ctx.incremental);
        this.issues = issues;

        // Pass 1: find duplicate groups, emit duplicate-literal findings, and collect the
        // set of nodes that should be suppressed from the individual passes.
        const duplicateNodes = new Set<NormalizedNode>();
        this.detectDuplicates(ctx, duplicateNodes, issues);

        // Pass 2/3: individual magic-number / hardcoded-string findings (skip duplicates).
        this.detectMagicNumbers(ctx, duplicateNodes, issues);
        this.detectHardcodedStrings(ctx, duplicateNodes, issues);

        // Extended governance passes (4, 5, 6)
        this.runExtendedGovernancePasses(ctx, issues);

        return issues;
    }

    private reconcileIncrementalLiterals(state: AnalyzerContext['incremental']): void {
        if (!state) return;
        const prevRecords = state.getPrevLiteralRecords();
        if (prevRecords.length > 0) {
            const reused: LiteralRecord[] = [];
            for (const rec of prevRecords) {
                if (state.isReusedLiteral(rec.node)) reused.push(rec);
            }
            this.literals = [...reused, ...this.literals].sort(byPosition);
        }
        state.setLiteralRecords(this.literals);
    }

    private runExtendedGovernancePasses(ctx: AnalyzerContext, issues: Issue[]): void {
        // Pass 4: detect nested constant anti-patterns and redundant constant aliasing.
        const flagNested = ctx.options?.flagNestedConstants !== false;
        if (flagNested && ctx.content) {
            this.detectNestedConstants(ctx, issues);
        }

        // Pass 5: near-literal calling domain clustering scanner (CONST-CLU-001)
        if (ctx.options?.checkConstantClusters || ctx.options?.constantGovernance) {
            issues.push(...scanNearLiteralClusters(this.literals, ctx.filePath));
        }

        // Pass 6: file layout and scope discipline guard (CONST-LAY-001, CONST-SCP-001)
        if ((ctx.options?.checkConstantLayout || ctx.options?.constantGovernance) && ctx.content) {
            issues.push(...checkConstantLayoutAndScope(ctx.content, ctx.filePath));
        }
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
            if (this.shouldSkipMagicNumber(lit, min, suppress)) continue;

            const issue = this.buildMagicNumberIssue(lit, ctx, classify, granular);
            if (issue) out.push(issue);
        }
    }

    private shouldSkipMagicNumber(
        lit: LiteralRecord,
        min: number,
        suppress: Set<NormalizedNode>,
    ): boolean {
        if (!lit.numeric || lit.isConstBound || lit.tolerated) return true;
        if (suppress.has(lit.node)) return true;
        const num = Number(lit.value);
        if (!isFinite(num) || TRIVIAL_NUMBERS.has(lit.value)) return true;
        return Math.abs(num) < min;
    }

    private buildMagicNumberIssue(
        lit: LiteralRecord,
        ctx: AnalyzerContext,
        classify: boolean,
        granular: boolean,
    ): Issue | null {
        const classification = classify ? classifyLiteral(lit.value, true) : null;
        if (classification && classification.isReasonable) return null;

        const res = resolveLiteralIssueData(
            lit.value,
            true,
            classification,
            granular,
            this.suggestName(lit.value, NUM_KIND),
        );

        return {
            id: `constants:${res.rule}:${ctx.filePath}:${lit.node.start?.line ?? 1}`,
            analyzer: CONSTANTS_ANALYZER_NAME,
            rule: res.rule,
            severity: CONSTANTS_SEVERITY,
            message: res.message,
            location: locN(lit.node, ctx.filePath),
            detail: res.detail,
            suggestion: `const ${res.suggested} = ${lit.value};`,
        };
    }

    private detectHardcodedStrings(
        ctx: AnalyzerContext,
        suppress: Set<NormalizedNode>,
        out: Issue[],
    ): void {
        const roleInference = inferFineGrainedFileRole(ctx.filePath, ctx.content?.slice(0, 500));
        const isTest = roleInference.role === 'test_suite';
        const isDataOrConfig =
            roleInference.role === 'config_constant' ||
            roleInference.role === 'rules_registry' ||
            ctx.filePath.endsWith('.json');

        const minLen = ctx.options.hardcodedStringMinLength;
        const ignoreSet = new Set<string>(ctx.options.ignoreLiterals || []);
        const classify = !!ctx.options.classifyLiterals;
        const granular = !!ctx.options.granularRules;

        for (const lit of this.literals) {
            if (this.shouldSkipHardcodedString(lit, minLen, ignoreSet, suppress, isTest, isDataOrConfig)) continue;

            const issue = this.buildHardcodedStringIssue(lit, ctx, classify, granular);
            if (issue) out.push(issue);
        }
    }

    private isHardcodedContextAllowed(lower: string, isTest: boolean, isDataOrConfig: boolean): boolean {
        if (isTest && TEST_SUITE_BENIGN_TOKENS.has(lower)) return true;
        return isDataOrConfig && SCHEMA_PROPERTY_TOKENS.has(lower);
    }

    private shouldSkipHardcodedString(
        lit: LiteralRecord,
        minLen: number,
        ignoreSet: Set<string>,
        suppress: Set<NormalizedNode>,
        isTest = false,
        isDataOrConfig = false,
    ): boolean {
        if (lit.numeric || lit.isConstBound || lit.tolerated || suppress.has(lit.node)) return true;
        const text = lit.value;
        const inner = stripQuotes(text);
        if (inner.length < minLen || inner.trim().length === 0) return true;
        const lower = inner.toLowerCase();
        if (this.isHardcodedContextAllowed(lower, isTest, isDataOrConfig)) return true;
        return ignoreSet.has(text) || ignoreSet.has(inner);
    }

    private buildHardcodedStringIssue(
        lit: LiteralRecord,
        ctx: AnalyzerContext,
        classify: boolean,
        granular: boolean,
    ): Issue | null {
        const text = lit.value;
        const inner = stripQuotes(text);
        const classification = classify ? classifyLiteral(text, false) : null;
        if (classification && classification.isReasonable) return null;

        const res = resolveLiteralIssueData(
            text,
            false,
            classification,
            granular,
            this.suggestName(inner, STR_KIND),
        );

        return {
            id: `constants:${res.rule}:${ctx.filePath}:${lit.node.start?.line ?? 1}`,
            analyzer: CONSTANTS_ANALYZER_NAME,
            rule: res.rule,
            severity: CONSTANTS_SEVERITY,
            message: res.message,
            location: locN(lit.node, ctx.filePath),
            detail: res.detail,
            suggestion: `const ${res.suggested} = ${text};`,
        };
    }

    private detectDuplicates(
        ctx: AnalyzerContext,
        suppress: Set<NormalizedNode>,
        out: Issue[],
    ): void {
        const roleInference = inferFineGrainedFileRole(ctx.filePath, ctx.content?.slice(0, 500));
        const isTest = roleInference.role === 'test_suite';
        const isDataOrConfig = isDataOrConfigFile(roleInference.role, ctx.filePath);
        const threshold = resolveDuplicateThreshold(
            ctx.options.duplicateLiteralThreshold ?? 4,
            isTest,
            isDataOrConfig,
        );

        const ignoreSet = new Set<string>(ctx.options.ignoreLiterals || []);
        const classify = !!ctx.options.classifyLiterals;
        const groups = groupDuplicates(
            this.literals,
            ctx.options.magicNumberMin,
            ignoreSet,
            classify,
            isTest,
            isDataOrConfig,
        );

        for (const [, arr] of groups) {
            if (arr.length < threshold) continue;
            for (const l of arr) suppress.add(l.node);
            const first = arr[0];
            const valText = first.value.trim();
            if (!first.numeric && valText.length === 0) continue;
            const suggested = this.suggestName(first.value, first.numeric ? NUM_KIND : STR_KIND);
            out.push(buildDuplicateIssue(ctx, arr, suggested));
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

    /**
     * Detect redundant constant aliasing: a named constant whose value is another named
     * constant, which adds an indirection layer without adding meaning.
     *
     * The pattern runs on the masked view, so a trailing comment cannot hide a declaration and a
     * quoted value can never be mistaken for a constant reference.
     */
    private detectNestedConstants(ctx: AnalyzerContext, out: Issue[]): void {
        const lines = ctx.content.split('\n');
        const masked = maskedLinesOfPath(ctx.filePath, ctx.content);

        for (let i = 0; i < lines.length; i++) {
            const trimmed = (masked[i] ?? '').trim();
            if (!trimmed || trimmed.startsWith('*')) continue;
            this.checkConstantAlias(lines[i], trimmed, i + 1, ctx, out);
        }
    }

    /**
     * Check if a line defines a redundant constant alias (e.g. const FOO = BAR).
     */
    private checkConstantAlias(
        line: string,
        trimmed: string,
        lineNum: number,
        ctx: AnalyzerContext,
        out: Issue[],
    ): void {
        const aliasMatch = trimmed.match(
            /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::\s*[^=]+)?\s*=\s*([A-Z][A-Z0-9_]{2,})\s*;?$/,
        );
        if (!aliasMatch) return;

        const [, aliasName, targetName] = aliasMatch;
        if (aliasName === targetName) return;

        out.push({
            id: `constants:nested-constant:${ctx.filePath}:${lineNum}`,
            analyzer: CONSTANTS_ANALYZER_NAME,
            rule: 'nested-constant',
            severity: CONSTANTS_SEVERITY,
            message: `Redundant constant alias: '${aliasName}' directly references '${targetName}'. Avoid constant nesting and indirection; use '${targetName}' directly.`,
            location: {
                file: ctx.filePath,
                start: { line: lineNum, column: 1 },
                end: { line: lineNum, column: line.length },
            },
            detail: {
                pattern: 'alias',
                alias: aliasName,
                target: targetName,
            },
            suggestion: `Remove '${aliasName}' and reference '${targetName}' directly at call sites.`,
        });
    }
}

interface LiteralResolution {
    rule: string;
    message: string;
    detail: Record<string, unknown>;
    suggested: string;
}

function resolveSuggestedName(
    numeric: boolean,
    classification: ReturnType<typeof classifyLiteral> | null,
    fallback: string,
): string {
    if (!classification) return fallback;
    const prefix = classification.suggestedConstPrefix;
    if (numeric) {
        return prefix !== 'CONST' ? prefix : fallback;
    }
    return prefix !== 'CONST_STR' ? `${prefix}_${fallback}` : fallback;
}

function resolveLiteralMessage(
    value: string,
    numeric: boolean,
    isGranular: boolean,
    rationale?: string,
): string {
    if (isGranular && rationale) {
        return `${rationale}: ${value} should be extracted.`;
    }
    return numeric
        ? `Magic number ${value} should be extracted into a named constant.`
        : 'Hardcoded string should be extracted into a named constant.';
}

function resolveLiteralIssueData(
    value: string,
    numeric: boolean,
    classification: ReturnType<typeof classifyLiteral> | null,
    granular: boolean,
    suggestedNameFallback: string,
): LiteralResolution {
    const isGranular = Boolean(
        granular && classification && classification.kind !== LITERAL_KIND_GENERAL,
    );
    const defaultRule = numeric ? 'magic-number' : 'hardcoded-string';
    const rule = isGranular ? `literal-${classification!.kind}` : defaultRule;
    const suggested = resolveSuggestedName(numeric, classification, suggestedNameFallback);
    const message = resolveLiteralMessage(value, numeric, isGranular, classification?.rationale);

    const detail: Record<string, unknown> = numeric
        ? {
              value,
              numeric: true,
              suggestedName: suggested,
              ...(classification
                  ? { semanticKind: classification.kind, rationale: classification.rationale }
                  : {}),
          }
        : {
              value,
              length: stripQuotes(value).length,
              suggestedName: suggested,
              ...(classification
                  ? { semanticKind: classification.kind, rationale: classification.rationale }
                  : {}),
          };

    return { rule, message, detail, suggested };
}

function resolveDuplicateThreshold(base: number, isTest: boolean, isDataOrConfig: boolean): number {
    if (isTest) return Math.max(base * 3, 12);
    if (isDataOrConfig) return Math.max(base * 2, 8);
    return base;
}

function isDataOrConfigFile(role: string, filePath: string): boolean {
    return role === 'config_constant' || role === 'rules_registry' || filePath.endsWith('.json');
}

function isNumericDuplicateCandidate(value: string, magicNumberMin: number): boolean {
    if (TRIVIAL_NUMBERS.has(value)) return false;
    return Math.abs(Number(value)) >= magicNumberMin;
}

function isStringDuplicateCandidate(
    value: string,
    ignoreSet: Set<string>,
    isTest: boolean,
    isDataOrConfig: boolean,
): boolean {
    const str = stripQuotes(value).trim();
    if (str.length === 0 || ignoreSet.has(value) || ignoreSet.has(str)) return false;
    const lower = str.toLowerCase();
    if (isTest && TEST_SUITE_BENIGN_TOKENS.has(lower)) return false;
    return !(isDataOrConfig && SCHEMA_PROPERTY_TOKENS.has(lower));
}

function isDuplicateCandidate(
    lit: LiteralRecord,
    magicNumberMin: number,
    ignoreSet: Set<string>,
    classify: boolean,
    isTest = false,
    isDataOrConfig = false,
): boolean {
    if (lit.isConstBound || lit.tolerated) return false;
    const candidate = lit.numeric
        ? isNumericDuplicateCandidate(lit.value, magicNumberMin)
        : isStringDuplicateCandidate(lit.value, ignoreSet, isTest, isDataOrConfig);
    if (!candidate) return false;
    return !(classify && classifyLiteral(lit.value, lit.numeric).isReasonable);
}

function groupDuplicates(
    literals: LiteralRecord[],
    magicNumberMin: number,
    ignoreSet: Set<string>,
    classify: boolean,
    isTest = false,
    isDataOrConfig = false,
): Map<string, LiteralRecord[]> {
    const groups = new Map<string, LiteralRecord[]>();
    for (const lit of literals) {
        if (!isDuplicateCandidate(lit, magicNumberMin, ignoreSet, classify, isTest, isDataOrConfig)) continue;
        const key = `${lit.numeric ? 'N' : 'S'}:${lit.value}`;
        const arr = groups.get(key) || [];
        arr.push(lit);
        groups.set(key, arr);
    }
    return groups;
}

function buildDuplicateIssue(ctx: AnalyzerContext, arr: LiteralRecord[], suggested: string): Issue {
    const first = arr[0];
    return {
        id: `${CONSTANTS_ANALYZER_NAME}:${RULE_DUPLICATE_LITERAL}:${ctx.filePath}:${first.node.start?.line ?? 1}`,
        analyzer: CONSTANTS_ANALYZER_NAME,
        rule: RULE_DUPLICATE_LITERAL,
        severity: CONSTANTS_SEVERITY,
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
    };
}
