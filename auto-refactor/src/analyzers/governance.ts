/**
 * Module: Static Analysis Engine — Governance & Code Quality Rules
 * File Path: src/analyzers/governance.ts
 * Architecture Role: Registry-driven, cross-language quality gate; converts accumulated rule
 *   violations into canonical, deduplicated Issue records inside the shared traversal
 * Dependencies & Triggers: core types, NormalizedNode, runStreaming, governance
 *   types/languageProfiles/registry, plus a lazy `typescriptAdapter` require; triggered when
 *   the declarative `analyzers.governance` entry is enabled by CLI / CI / daemon scans
 * Responsibilities: Resolve per-language capabilities and rule sets once per file; run
 *   pre-filtered node rules in `visit` and file rules once in `finalize`; map each violation
 *   to an Issue carrying category, risk, rationale and fixability metadata
 * Exit Semantics & Design Rationale: analyze() is the standalone contract, finalize() the
 *   multiplexed one; the analyzer has no error path of its own, returning [] when no rule
 *   applies, and registry lookups fall back to defaults so a partial rule set still yields a
 *   usable report. Rules stay in the registry, so one traversal serves every language.
 */
import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue, IssueLocation } from '../core/types';
import { NodeKind, type NormalizedNode } from '../core/multilang';
import { runStreaming } from '../core/traverse';
import type {
    GovernanceIssueDetail,
    GovernanceRule,
    GovernanceViolation,
    LanguageCapabilities,
    RuleEvaluationContext,
} from '../core/governance/types';
import { resolveLanguageProfile } from '../core/governance/languageProfiles';
import { maskedLinesOf } from '../core/source-mask';
import { TypeScriptAdapter } from '../core/typescript-adapter';
import type { GovernanceRegistry } from '../core/governance/registry';
import { getDefaultGovernanceRegistry } from '../core/governance/registry';

/**
 * Modern Governance & Code Quality Analyzer for registry-driven cross-language gating.
 *
 * Evaluates source files across 8 core quality dimensions:
 * - standardization, file_structure, code_logic, type_system,
 * - exception_safety, debug_logging, performance, maintainability.
 *
 * Generalizes WebGames script audits into a cross-language, modern quality gate.
 * Single-pass multiplexed traversal integration with zero duplicate walks.
 */
export class GovernanceAnalyzer implements Analyzer {
    name = 'governance' as const;

    private registry: GovernanceRegistry;
    private violations: GovernanceViolation[] = [];
    private capabilities!: LanguageCapabilities;
    private lines: string[] = [];
    private maskedLines: string[] = [];
    private hasCheckedFile = false;
    private nodeRules: GovernanceRule[] = [];
    private fileRules: GovernanceRule[] = [];
    private reusableEvalCtx: RuleEvaluationContext | null = null;

    constructor(registry?: GovernanceRegistry) {
        this.registry = registry || getDefaultGovernanceRegistry();
    }

    private ensureInitialized(ctx: AnalyzerContext): void {
        if (!this.capabilities) {
            this.capabilities = resolveLanguageProfile(ctx.filePath, ctx.adapter?.id);
            this.lines = ctx.content ? ctx.content.split(/\r?\n/) : [];
            // Built once per file through the shared mask so every content-oriented rule reads the
            // same view; a per-rule mask would let each rule drift back to raw-line heuristics.
            this.maskedLines = ctx.content
                ? maskedLinesOf(ctx.content, this.capabilities.languageId)
                : [];
            const rules = this.registry.getRulesForLanguage(
                this.capabilities.languageId,
                ctx.options,
            );
            this.nodeRules = rules.filter((r) => typeof r.checkNode === 'function');
            this.fileRules = rules.filter((r) => typeof r.checkFile === 'function');
            this.reusableEvalCtx = {
                node: undefined as unknown as NormalizedNode,
                ctx,
                parent: undefined,
                grandparent: undefined,
                depth: 0,
                className: null,
                binding: null,
                capabilities: this.capabilities,
                filePath: ctx.filePath,
                content: ctx.content,
                lines: this.lines,
                masked: this.maskedLines,
            };
        }
    }

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        this.violations = [];
        this.hasCheckedFile = false;
        this.nodeRules = [];
        this.fileRules = [];
        this.reusableEvalCtx = null;
        // Standalone contract fallback

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
        grandparent: NormalizedNode | undefined,
        depth: number,
        className: string | null,
        binding: string | null,
    ): void {
        this.ensureInitialized(ctx);
        if (this.nodeRules.length === 0) return;

        // Fast node pre-filter: all node-level governance rules (redundant boolean, nesting,
        // wrapper, signature completeness) only evaluate control flow or function/method nodes.
        // Skipping expressions, literals, identifiers and statements eliminates >90% of visits.
        const kind = node.kind;
        const isCandidate =
            node.functionLike ||
            kind === NodeKind.Function ||
            kind === NodeKind.Method ||
            kind === NodeKind.ControlFlow;
        if (!isCandidate) return;

        const evalCtx = this.reusableEvalCtx!;
        evalCtx.node = node;
        evalCtx.ctx = ctx;
        evalCtx.parent = parent;
        evalCtx.grandparent = grandparent;
        evalCtx.depth = depth;
        evalCtx.className = className;
        evalCtx.binding = binding;

        // Evaluate pre-filtered node-level rules
        for (const rule of this.nodeRules) {
            const result = rule.checkNode!(evalCtx);
            if (result && result.length > 0) {
                this.violations.push(...result);
            }
        }
    }

    private runFileRules(ctx: AnalyzerContext): void {
        if (this.hasCheckedFile) return;
        this.hasCheckedFile = true;
        if (this.fileRules.length === 0) return;

        const evalCtx = this.reusableEvalCtx!;
        evalCtx.node = ctx.root;
        evalCtx.ctx = ctx;
        evalCtx.parent = undefined;
        evalCtx.grandparent = undefined;
        evalCtx.depth = 0;
        evalCtx.className = null;
        evalCtx.binding = null;

        for (const rule of this.fileRules) {
            const result = rule.checkFile!(evalCtx);
            if (result && result.length > 0) {
                this.violations.push(...result);
            }
        }
    }

    private recordViolationIssue(
        v: GovernanceViolation,
        ctx: AnalyzerContext,
        seenIds: Set<string>,
        issues: Issue[],
    ): void {
        const issueId = `governance:${v.ruleId}:${ctx.filePath}:${v.line}`;
        if (seenIds.has(issueId)) return;
        seenIds.add(issueId);

        const rule = this.registry.get(v.ruleId);
        const category = rule?.category || 'standardization';
        const severity = rule?.severity || 'warning';
        const risk = rule?.risk || 'medium';
        const rationale = rule?.rationale || '';
        const isFixable = rule?.isFixable ?? false;
        const fixable = v.fixable !== undefined ? v.fixable : isFixable;

        const loc: IssueLocation = {
            file: ctx.filePath,
            start: { line: v.line, column: v.column },
            end: { line: v.endLine ?? v.line, column: v.endColumn ?? v.column + 1 },
        };

        const detail: GovernanceIssueDetail = {
            category,
            risk,
            rationale,
            fixable,
            targetLanguage: this.capabilities.languageId,
            ruleId: v.ruleId,
            suggestedPatch: v.suggestedPatch,
            ...v.customDetail,
        };

        const issue: Issue = {
            id: issueId,
            analyzer: this.name,
            rule: v.ruleId,
            severity,
            message: v.message,
            location: loc,
            detail,
            suggestion: v.suggestion,
        };
        if (v.evidence) {
            issue.evidence = v.evidence;
        }
        issues.push(issue);
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        // Source-code governance (naming, headers, type rules) does not apply to documentation
        // prose: markdown is audited by the dedicated `docs` analyzer instead.
        if (ctx.filePath.replace(/\\/g, '/').endsWith('.md')) return [];
        this.ensureInitialized(ctx);
        this.runFileRules(ctx);

        // Convert accumulated violations to canonical Issue records carrying category, risk,
        // rationale and fixability metadata.
        const issues: Issue[] = [];
        const seenIds = new Set<string>();

        for (const v of this.violations) {
            this.recordViolationIssue(v, ctx, seenIds, issues);
        }

        return issues;
    }
}
