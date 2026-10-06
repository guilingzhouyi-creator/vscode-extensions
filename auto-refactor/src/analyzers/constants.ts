/**
 * Module: Static Analysis Engine — Inline Literal Extraction
 * File Path: src/analyzers/constants.ts
 * Architecture Role: Language-agnostic analyzer that turns the engine's single shared
 *   traversal into constant-extraction findings over numeric and string literals
 * Dependencies & Triggers: core types, NodeKind/NormalizedNode, LiteralRecord, locN,
 *   runStreaming, classifyLiteral, plus constants-literal-helper; triggered when the
 *   declarative `analyzers.constants` entry is enabled by CLI / CI / daemon scans
 * Responsibilities: Collect every literal once per file, skipping reused subtrees; rebuild
 *   full-file duplicate groups across warm scans; emit duplicate-literal, magic-number and
 *   hardcoded-string findings; honor magicNumberMin, hardcodedStringMinLength,
 *   duplicateLiteralThreshold, ignoreLiterals and classifyLiterals; skip trivial, const-bound and
 *   tolerated literals, plus the benign-vocabulary literals `classifyLiteral` marks reasonable;
 *   propose constant names, optionally classified semantically
 * Exit Semantics & Design Rationale: analyze() is the standalone contract and finalize() runs
 *   the literal detection stages; duplicate-literal is a full-file multiset, so it is rebuilt
 *   from reused plus fresh records instead of being reused wholesale, keeping warm scans
 *   byte-identical to a cold rescan.
 */
import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import type { NormalizedNode } from '../core/ast/multilang';
import { NodeKind } from '../core/ast/multilang';
import type { LiteralRecord } from '../core/diff/incremental-state';
import { locN } from '../utils/normalized';
import { runStreaming } from '../core/ast/traverse';
import { classifyLiteral } from '../core/governance/semanticLiterals';
import { maskedLinesOfPath } from '../core/policy/source-mask';
import { scanNearLiteralClusters } from '../core/intelligence/near-literal-cluster';
import { checkConstantLayoutAndScope } from '../core/governance/constant-layout-guard';
import { extractConstantEntities } from '../core/diff/constant-relocation-detector';
import { inspectConstantLibraryTopology } from '../core/architecture/constant-library-auditor';
import { detectConstantDrift } from '../core/architecture/constant-drift-guard';
import { arbitrateConstantOwnership } from '../core/architecture/constant-ownership-arbiter';
import { inferFineGrainedFileRole } from '../core/intelligence/file-role-inference';
import { formatConstantDeclarationSuggestion } from '../core/intelligence/constant-identity';

import {
    ANALYZER_CONSTANTS,
    RULE_NESTED_CONSTANT,
    CODE_CONST_HARDCODED_STRING,
    CODE_CONST_MAGIC_NUMBER,
    CODE_CONST_NESTED_CONSTANT,
    SEVERITY_WARNING,
} from '../core/constants';

import {
    TRIVIAL_NUMBERS,
    TEST_SUITE_BENIGN_TOKENS,
    AST_PARSER_BENIGN_TOKENS,
    SCHEMA_PROPERTY_TOKENS,
    SUGGESTED_NAME_INTEGER_LIMIT,
    SUGGESTED_NAME_MAX_WORDS,
    NUM_KIND,
    STR_KIND,
    byPosition,
    stripQuotes,
    resolveLiteralIssueData,
    resolveDuplicateThreshold,
    isDataOrConfigFile,
    isTestFile,
    isI18nFile,
    groupDuplicates,
    buildDuplicateIssue,
} from './constants-literal-helper';

/** Regular expression matching test directory path components. */
const RE_TEST_PATH = /[\\/](?:tests?|fixtures?|mocks?)[\\/]/i;

/** Regular expression matching test file extension patterns. */
const RE_TEST_FILE_EXT = /\.(?:test|spec)\.[a-z0-9]+$/i;

/** Regular expression matching styling stylesheet extensions. */
const RE_STYLE_FILE_EXT = /\.(?:css|scss|less|sass)\b/i;

/** Regular expression identifying diagnostic or logging message prefixes. */
const RE_DIAGNOSTIC_LOG_PREFIX = /^(?:error|failed|warning|info|debug|trace|fatal|assert):/i;

/** Regular expression stripping enclosing quotes from string literals. */
const RE_OUTER_QUOTES = /^['"`]|['"`]$/g;

/** Regular expression matching non-alphanumeric character sequences for name cleanup. */
const RE_NON_ALPHANUMERIC = /[^A-Za-z0-9]+/g;

/** Regular expression splitting strings along whitespace boundaries. */
const RE_WHITESPACE = /\s+/;

/** Regular expression detecting identifiers starting with numeric digits. */
const RE_LEADING_DIGIT = /^[0-9]/;

/** Regular expression detecting redundant uppercase constant aliases. */
const RE_CONSTANT_ALIAS =
    /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::\s*[^=]+)?\s*=\s*([A-Z][A-Z0-9_]{2,})\s*;?$/;

/**
 * Detect inline literals that should be promoted to named constants.
 */
export class ConstantsAnalyzer implements Analyzer {
    name = ANALYZER_CONSTANTS;

    private literals: LiteralRecord[] = [];
    private issues: Issue[] = [];

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        this.literals = [];
        this.issues = [];

        const { TypeScriptAdapter } =
            require('../core/ast/typescript-adapter') as typeof import('../core/ast/typescript-adapter');
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

        // Duplicate literal detection: identify repeated literal groups, emit
        // duplicate findings, and collect nodes to suppress from individual checks.
        const duplicateNodes = new Set<NormalizedNode>();
        this.detectDuplicates(ctx, duplicateNodes, issues);

        // Individual literal scanning: detect unextracted magic numbers and
        // hardcoded strings (skipping duplicates).
        this.detectMagicNumbers(ctx, duplicateNodes, issues);
        this.detectHardcodedStrings(ctx, duplicateNodes, issues);

        // Extended constant governance: evaluate nested constants, layout, clusters, and topology.
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
        const flagNested = ctx.options?.flagNestedConstants !== false;
        if (flagNested && ctx.content) {
            this.detectNestedConstants(ctx, issues);
        }

        if (ctx.options?.checkConstantClusters || ctx.options?.constantGovernance) {
            issues.push(...scanNearLiteralClusters(this.literals, ctx.filePath));
        }

        if ((ctx.options?.checkConstantLayout || ctx.options?.constantGovernance) && ctx.content) {
            issues.push(...checkConstantLayoutAndScope(ctx.content, ctx.filePath));
        }

        const checkTopology = ctx.options?.checkConstantTopology || ctx.options?.constantGovernance;
        if (checkTopology && ctx.content) {
            const entities = extractConstantEntities(ctx.content, ctx.filePath);
            const observed = entities.map((e) => ({
                name: e.identity.name,
                normalizedValue: e.fingerprint?.normalizedValue ?? '',
                filePath: ctx.filePath,
                line: e.identity.line ?? 1,
                isExported: e.identity.isExported,
            }));
            issues.push(...inspectConstantLibraryTopology(observed, ctx.filePath));
            issues.push(...detectConstantDrift(observed));
            for (const item of observed) {
                const { issue } = arbitrateConstantOwnership(
                    item.name,
                    item.normalizedValue,
                    item.filePath,
                    item.line,
                    [item.filePath],
                );
                if (issue) issues.push(issue);
            }
        }
    }

    private detectMagicNumbers(
        ctx: AnalyzerContext,
        suppress: Set<NormalizedNode>,
        out: Issue[],
    ): void {
        const roleInference = inferFineGrainedFileRole(ctx.filePath, ctx.content?.slice(0, 500));
        const isTest =
            roleInference.role === 'test_suite' ||
            RE_TEST_PATH.test(ctx.filePath) ||
            RE_TEST_FILE_EXT.test(ctx.filePath);
        const isStyle = ctx.filePath.includes('-styles.') || RE_STYLE_FILE_EXT.test(ctx.filePath);
        if (isTest || isStyle) return;

        const isDataOrConfig = isDataOrConfigFile(roleInference.role, ctx.filePath);
        const min = ctx.options.magicNumberMin;
        const classify = !!ctx.options.classifyLiterals;
        const granular = !!ctx.options.granularRules;

        for (const lit of this.literals) {
            if (this.shouldSkipMagicNumber(lit, min, suppress, isDataOrConfig)) continue;

            const issue = this.buildMagicNumberIssue(lit, ctx, classify, granular);
            if (issue) out.push(issue);
        }
    }

    private shouldSkipMagicNumber(
        lit: LiteralRecord,
        min: number,
        suppress: Set<NormalizedNode>,
        isDataOrConfig = false,
    ): boolean {
        if (!lit.numeric || lit.isConstBound || lit.tolerated) return true;
        if (suppress.has(lit.node)) return true;
        if (isDataOrConfig && !lit.parent?.functionLike) {
            return true;
        }
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
            analyzer: ANALYZER_CONSTANTS,
            rule: res.rule,
            severity: SEVERITY_WARNING,
            message: res.message,
            location: locN(lit.node, ctx.filePath),
            detail: res.detail,
            suggestion: formatConstantDeclarationSuggestion(
                ctx.filePath,
                res.suggested,
                lit.value,
                true,
            ),
            actionable: {
                action: 'extract_constant',
                code: CODE_CONST_MAGIC_NUMBER,
                targetScope: 'module_top_level',
                targetSymbol: res.suggested,
                insertAnchor: { position: 'after_imports' },
                patch: {
                    range: {
                        startLine: lit.node.start?.line ?? 1,
                        startCol: lit.node.start?.column ?? 1,
                        endLine: lit.node.end?.line ?? 1,
                        endCol: lit.node.end?.column ?? 1,
                    },
                    replacementText: res.suggested,
                },
                safeToAutomate: true,
            },
        };
    }

    private detectHardcodedStrings(
        ctx: AnalyzerContext,
        suppress: Set<NormalizedNode>,
        out: Issue[],
    ): void {
        const roleInference = inferFineGrainedFileRole(ctx.filePath, ctx.content?.slice(0, 500));
        const isTest = isTestFile(roleInference.role, ctx.filePath);
        const isI18n = isI18nFile(roleInference.role, ctx.filePath);
        if (isTest || isI18n) return;

        const isDataOrConfig =
            roleInference.role === 'config_constant' ||
            roleInference.role === 'rules_registry' ||
            ctx.filePath.endsWith('.json');
        const isAlgorithm =
            roleInference.role === 'algorithm_computation' ||
            ctx.filePath.includes('/ast/') ||
            ctx.filePath.includes('\\ast\\');

        const minLen = ctx.options.hardcodedStringMinLength;
        const ignoreSet = new Set<string>(ctx.options.ignoreLiterals || []);
        const classify = !!ctx.options.classifyLiterals;
        const granular = !!ctx.options.granularRules;

        for (const lit of this.literals) {
            if (
                this.shouldSkipHardcodedString(
                    lit,
                    minLen,
                    ignoreSet,
                    suppress,
                    isTest,
                    isDataOrConfig,
                    isAlgorithm,
                )
            ) {
                continue;
            }

            const issue = this.buildHardcodedStringIssue(lit, ctx, classify, granular);
            if (issue) out.push(issue);
        }
    }

    private isDiagnosticOrLogMessage(lit: LiteralRecord): boolean {
        const text = lit.value;
        const inner = stripQuotes(text);
        if (inner.startsWith('[') && inner.includes(']')) return true;
        if (RE_DIAGNOSTIC_LOG_PREFIX.test(inner)) return true;
        const parentText = lit.parent?.text?.toLowerCase();
        if (
            parentText &&
            (parentText.includes('log(') ||
                parentText.includes('console.') ||
                parentText.includes('new error') ||
                parentText.includes('reject('))
        ) {
            return true;
        }
        return false;
    }

    private isHardcodedContextAllowed(
        lower: string,
        isTest: boolean,
        isDataOrConfig: boolean,
        isAlgorithm = false,
    ): boolean {
        if (isTest && TEST_SUITE_BENIGN_TOKENS.has(lower)) return true;
        if (isDataOrConfig && SCHEMA_PROPERTY_TOKENS.has(lower)) return true;
        if (isAlgorithm && AST_PARSER_BENIGN_TOKENS.has(lower)) return true;
        return false;
    }

    private shouldSkipHardcodedString(
        lit: LiteralRecord,
        minLen: number,
        ignoreSet: Set<string>,
        suppress: Set<NormalizedNode>,
        isTest = false,
        isDataOrConfig = false,
        isAlgorithm = false,
    ): boolean {
        if (lit.numeric || lit.isConstBound || lit.tolerated || suppress.has(lit.node)) return true;
        if (this.isDiagnosticOrLogMessage(lit)) return true;
        const text = lit.value;
        const inner = stripQuotes(text);
        if (inner.length < minLen || inner.trim().length === 0) return true;
        const lower = inner.toLowerCase();
        if (this.isHardcodedContextAllowed(lower, isTest, isDataOrConfig, isAlgorithm)) return true;
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
            analyzer: ANALYZER_CONSTANTS,
            rule: res.rule,
            severity: SEVERITY_WARNING,
            message: res.message,
            location: locN(lit.node, ctx.filePath),
            detail: res.detail,
            suggestion: formatConstantDeclarationSuggestion(
                ctx.filePath,
                res.suggested,
                text,
                false,
            ),
            actionable: {
                action: 'extract_constant',
                code: CODE_CONST_HARDCODED_STRING,
                targetScope: 'module_top_level',
                targetSymbol: res.suggested,
                insertAnchor: { position: 'after_imports' },
                patch: {
                    range: {
                        startLine: lit.node.start?.line ?? 1,
                        startCol: lit.node.start?.column ?? 1,
                        endLine: lit.node.end?.line ?? 1,
                        endCol: lit.node.end?.column ?? 1,
                    },
                    replacementText: res.suggested,
                },
                safeToAutomate: true,
            },
        };
    }

    private detectDuplicates(
        ctx: AnalyzerContext,
        suppress: Set<NormalizedNode>,
        out: Issue[],
    ): void {
        const roleInference = inferFineGrainedFileRole(ctx.filePath, ctx.content?.slice(0, 500));
        const isTest = isTestFile(roleInference.role, ctx.filePath);
        const isI18n = isI18nFile(roleInference.role, ctx.filePath);
        if (isTest || isI18n) return;

        const isDataOrConfig = isDataOrConfigFile(roleInference.role, ctx.filePath);
        const isAlgorithm =
            roleInference.role === 'algorithm_computation' ||
            ctx.filePath.includes('/ast/') ||
            ctx.filePath.includes('\\ast\\');
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
            isAlgorithm,
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
            .replace(RE_OUTER_QUOTES, '')
            .replace(RE_NON_ALPHANUMERIC, ' ')
            .trim()
            .split(RE_WHITESPACE)
            .slice(0, SUGGESTED_NAME_MAX_WORDS)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join('');
        const name = cleaned ? `${cleaned.toUpperCase()}_TEXT` : 'EXTRACTED_STRING';
        return RE_LEADING_DIGIT.test(name) ? `CONST_${name}` : name;
    }

    private detectNestedConstants(ctx: AnalyzerContext, out: Issue[]): void {
        const lines = ctx.content.split('\n');
        const masked = maskedLinesOfPath(ctx.filePath, ctx.content);

        for (let i = 0; i < lines.length; i++) {
            const trimmed = (masked[i] ?? '').trim();
            if (!trimmed || trimmed.startsWith('*')) continue;
            this.checkConstantAlias(lines[i], trimmed, i + 1, ctx, out);
        }
    }

    private checkConstantAlias(
        line: string,
        trimmed: string,
        lineNum: number,
        ctx: AnalyzerContext,
        out: Issue[],
    ): void {
        const aliasMatch = trimmed.match(RE_CONSTANT_ALIAS);
        if (!aliasMatch) return;

        const [, aliasName, targetName] = aliasMatch;
        if (aliasName === targetName) return;

        out.push({
            id: `constants:${RULE_NESTED_CONSTANT}:${ctx.filePath}:${lineNum}`,
            analyzer: ANALYZER_CONSTANTS,
            rule: 'nested-constant',
            severity: SEVERITY_WARNING,
            message:
                `Redundant constant alias: '${aliasName}' directly references '${targetName}'. ` +
                `Avoid constant nesting and indirection; use '${targetName}' directly.`,
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
            actionable: {
                action: 'replace_token',
                code: CODE_CONST_NESTED_CONSTANT,
                targetSymbol: targetName,
                safeToAutomate: false,
            },
        });
    }
}
