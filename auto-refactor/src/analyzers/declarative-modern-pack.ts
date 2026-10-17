/**
 * Module: Static Analysis Engine — Declarative Modern Language Pack Metapack
 * File Path: src/analyzers/declarative-modern-pack.ts
 * Architecture Role: Shared generic execution engine for polyglot language modernization
 *     analyzers (Go, Rust, GDScript, Python, TypeScript); unifies source masking,
 *     line iteration, regex matching, actionable attachment, and canonical issue creation.
 * Dependencies & Triggers: Consumes core types (Analyzer, AnalyzerContext, Issue, Severity, AgentActionablePayload),
 *     source-mask (maskSourceText), and buildCanonicalIssue. Used by polyglot modern analyzers.
 * Responsibilities:
 *     1. Provide declarative pattern rule interfaces eliminating repetitive scanner loops;
 *     2. Provide immutable LineScanContext reducing parameter bloat and data clumps (SIM-ARGS-001);
 *     3. Standardize actionable snippet creation and canonical issue emission;
 *     4. Zero-allocation fast-paths for non-matching file extensions.
 * Exit Semantics & Design Rationale: Pure analysis engine; never throws and returns [] for
 *     unsupported extensions or blank files; conforms to Analyzer interface with both finalize
 *     and analyze entry points; maintains strict CC <= 15 and Depth <= 4.
 */

import type {
    AgentActionablePayload,
    AgentActionType,
    Analyzer,
    AnalyzerContext,
    Issue,
    Severity,
} from '../core/types';
import { maskSourceText, type SourceMaskConfig } from '../core/policy/source-mask';
import { buildCanonicalIssue } from '../core/reporting/canonical-issue-builder';

/** Immutable context provided to individual rule condition evaluations. */
export interface LineScanContext {
    readonly file: string;
    readonly lineIndex: number;
    readonly lineNumber: number;
    readonly rawLine: string;
    readonly trimmed: string;
    readonly maskedLine: string;
    readonly allRawLines: readonly string[];
    readonly allMaskedLines: readonly string[];
    readonly options?: Record<string, unknown>;
}

/** Actionable remediation specification for a declarative rule. */
export interface DeclarativeActionableSpec {
    readonly action: AgentActionType;
    readonly codeId: string;
    readonly templateSnippet: string;
    readonly autoSafe?: boolean;
}

/** Declarative definition of a line-level pattern rule. */
export interface DeclarativeLineRule {
    /** Canonical rule identifier (e.g. 'GOM-ERR-001', 'RSM-TRY-001'). */
    readonly rule: string;
    /** Severity level of the finding. */
    readonly severity: Severity;
    /** Diagnostic message explaining the violation. */
    readonly message: string;
    /** Suggestion for remedying the code. */
    readonly suggestion: string;
    /** Positive pattern to match against masked line. */
    readonly pattern?: RegExp;
    /** Negative pattern: if matched, suppression is applied. */
    readonly negativePattern?: RegExp;
    /** Custom boolean predicate for non-regex structural rules. */
    readonly condition?: (ctx: LineScanContext) => boolean;
    /** Actionable payload configuration. */
    readonly actionable?: DeclarativeActionableSpec;
    /** Optional factory for custom issue detail records. */
    readonly detailFactory?: (ctx: LineScanContext) => Record<string, unknown>;
}

/** Configuration specification for a declarative modern language pack. */
export interface DeclarativeModernPackConfig {
    readonly analyzerId: string;
    readonly fileExtensions: readonly string[];
    readonly maskConfig: SourceMaskConfig;
    readonly rules: readonly DeclarativeLineRule[];
    /** Optional custom filter to exclude files based on custom criteria (e.g. .d.ts). */
    readonly pathFilter?: (filePath: string) => boolean;
    /** Optional custom scanner hook for complex multi-line stateful rules. */
    readonly multiLineScanner?: (
        allRawLines: readonly string[],
        allMaskedLines: readonly string[],
        file: string,
        issues: Issue[],
    ) => void;
}

/**
 * Generic declarative analyzer that runs declarative pattern rules over masked source lines.
 */
export class DeclarativeModernAnalyzer implements Analyzer {
    public readonly name: string;
    private readonly actionMap: ReadonlyMap<string, AgentActionablePayload>;
    private readonly extensionSet: ReadonlySet<string>;

    constructor(private readonly config: DeclarativeModernPackConfig) {
        this.name = config.analyzerId;
        this.extensionSet = new Set(config.fileExtensions.map((ext) => ext.toLowerCase()));

        const actionMap = new Map<string, AgentActionablePayload>();
        for (const rule of config.rules) {
            if (!rule.actionable) {
                continue;
            }
            actionMap.set(rule.rule, {
                action: rule.actionable.action,
                code: `AR:${rule.rule.split('-')[0]}:${rule.actionable.codeId}`,
                safeToAutomate: rule.actionable.autoSafe ?? false,
                templateSnippet: rule.actionable.templateSnippet,
            });
        }
        this.actionMap = actionMap;
    }

    /**
     * Checks whether the target file matches configured extensions.
     *
     * @param filePath - Path to source file.
     * @returns True if the extension is supported.
     */
    public supportsFile(filePath: string): boolean {
        if (this.config.pathFilter && !this.config.pathFilter(filePath)) {
            return false;
        }
        const lowerPath = filePath.toLowerCase();
        for (const ext of this.extensionSet) {
            if (lowerPath.endsWith(ext)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Finalize entry point for the streaming scanner pipeline.
     */
    public finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Analyzes source file against all configured declarative modernization rules.
     *
     * @param _sf - Unused AST node for non-TS content.
     * @param context - Analyzer runtime context.
     * @returns Array of detected issues.
     */
    public analyze(_sf: unknown, context: AnalyzerContext): Issue[] {
        const file = (context.filePath || '').replace(/\\/g, '/');
        if (!this.supportsFile(file)) {
            return [];
        }

        const content = context.content || '';
        if (content.length === 0) {
            return [];
        }

        const { raw, masked } = maskSourceText(content, this.config.maskConfig);
        const issues: Issue[] = [];

        this.scanLines(file, raw, masked, issues, context.options);

        if (this.config.multiLineScanner) {
            this.config.multiLineScanner(raw, masked, file, issues);
        }

        return issues;
    }

    /**
     * Iterates over masked lines and evaluates declarative rules.
     */
    private scanLines(
        file: string,
        rawLines: readonly string[],
        maskedLines: readonly string[],
        issues: Issue[],
        options?: Record<string, unknown>,
    ): void {
        const totalLines = rawLines.length;

        for (let lineIndex = 0; lineIndex < totalLines; lineIndex++) {
            const rawLine = rawLines[lineIndex];
            const maskedLine = maskedLines[lineIndex];
            const trimmed = maskedLine.trim();

            if (trimmed.length === 0) {
                continue;
            }

            const ctx: LineScanContext = {
                file,
                lineIndex,
                lineNumber: lineIndex + 1,
                rawLine,
                trimmed,
                maskedLine,
                allRawLines: rawLines,
                allMaskedLines: maskedLines,
                options,
            };

            this.evaluateRulesOnLine(ctx, issues);
        }
    }

    /**
     * Evaluates all configured rules on a single line context.
     */
    private evaluateRulesOnLine(ctx: LineScanContext, issues: Issue[]): void {
        for (const rule of this.config.rules) {
            if (this.isRuleViolation(rule, ctx)) {
                issues.push(this.createIssue(rule, ctx));
            }
        }
    }

    /**
     * Checks if a line violates the given declarative rule.
     */
    private isRuleViolation(rule: DeclarativeLineRule, ctx: LineScanContext): boolean {
        if (!rule.pattern && !rule.condition) {
            return false;
        }

        if (rule.condition && !rule.condition(ctx)) {
            return false;
        }


        if (
            rule.pattern &&
            !rule.pattern.test(ctx.maskedLine) &&
            !rule.pattern.test(ctx.trimmed)
        ) {
            return false;
        }

        if (
            rule.negativePattern &&
            (rule.negativePattern.test(ctx.maskedLine) ||
                rule.negativePattern.test(ctx.trimmed))
        ) {
            return false;
        }

        return true;
    }


    /**
     * Constructs and formats a canonical issue for a declarative rule.
     *
     * @param rule - Declarative line rule definition.
     * @param file - Relative file path.
     * @param line - 1-based line number.
     * @param detail - Optional evidence detail dictionary.
     * @param column - Optional 1-based column position.
     * @returns Formatted canonical Issue.
     */
    public emitIssue(
        rule: DeclarativeLineRule,
        file: string,
        line: number,
        detail: Record<string, unknown> = {},
        column: number = 1,
    ): Issue {
        const actionable = this.actionMap.get(rule.rule);

        return buildCanonicalIssue({
            analyzer: this.config.analyzerId,
            rule: rule.rule,
            file,
            line,
            column,
            severity: rule.severity,
            message: rule.message,
            suggestion: rule.suggestion,
            detail,
            actionable,
        });
    }

    /**
     * Constructs a canonical issue for the detected violation.
     */
    private createIssue(rule: DeclarativeLineRule, ctx: LineScanContext): Issue {
        const detail = rule.detailFactory ? rule.detailFactory(ctx) : { line: ctx.rawLine.trim() };
        return this.emitIssue(rule, ctx.file, ctx.lineNumber, detail);
    }

}
