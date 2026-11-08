/**
 * Module: Core Engine — Batch Analyzer Runner Phase
 * File Path: src/core/scanner/batch-analyzer-runner.ts
 * Architecture Role: Single-pass batch analyzer execution stage of the in-process scan path.
 * Dependencies & Triggers: typescript, ../types, ../analyzerRegistry, ../multilang, and
 *   ./analyzerRunner (shared host and context contracts); invoked by runFileAnalyzers for
 *   analyzers without streaming hooks, such as external TypeScript-only plug-ins.
 * Responsibilities: Materialize the ts.SourceFile only when a legacy analyzer needs it, then run
 *   each legacy analyzer through the original analyze(sf, ctx) contract.
 * Exit Semantics & Design Rationale: An analyzer that throws becomes an issue instead of aborting
 *   the scan, and the ts.SourceFile require stays lazy so oxc-only runs never load typescript.
 */
import type * as ts from 'typescript';
import type { AnalyzerContext, Issue, Severity } from '../types';
import type { ResolvedAnalyzer } from '../analyzer-registry';
import type { LanguageAdapter } from '../ast/multilang';
import type {
    AnalyzerHost,
    FileContextBase,
    ParseState,
    StreamingOutcome,
} from './analyzer-runner';
import { isFileAnalyzerActive } from './file-preflight-gate';

/**
 * Materialize the ts.SourceFile, but only when a legacy TS-only plug-in needs it.
 *
 * Both TS-family adapters (typescript / oxc) parse TS/JS-family files, so legacy plug-ins keep
 * working regardless of the selected parser. The `../utils/ast` require stays lazy so the
 * oxc + built-in analyzers path never loads `typescript`.
 *
 * @param rel - Repository-relative POSIX path of the file.
 * @param content - Raw file content already read by the caller.
 * @param legacy - Legacy analyzers of this file.
 * @param adapter - Language adapter selected for the file.
 * @returns The parsed source file, or undefined when no legacy analyzer needs one.
 */
export function materializeSourceFile(
    rel: string,
    content: string,
    legacy: ResolvedAnalyzer[],
    adapter: LanguageAdapter,
): ts.SourceFile | undefined {
    const isTsFamily = adapter.id === 'typescript' || adapter.id === 'oxc';
    if (legacy.length === 0 || !isTsFamily) return undefined;
    const astModule = require('../../utils/ast') as {
        createSourceFile: (filePath: string, text: string) => ts.SourceFile;
    }; // @lazy deferred load
    return astModule.createSourceFile(rel, content);
}

/**
 * Run the legacy analyzers (no streaming hooks) through the original per-analyzer contract.
 *
 * @param host - Runner host carrying the logger.
 * @param legacy - Legacy analyzers of this file.
 * @param outcome - Streaming outcome supplying the AST the legacy contexts must see.
 * @param parse - Parse artifacts supplying the fallback root when no AST was materialized.
 * @param base - Shared per-file context values.
 * @returns Issues from every legacy analyzer, plus one issue per analyzer that threw.
 */
export function runLegacyPhase(
    host: AnalyzerHost,
    legacy: ResolvedAnalyzer[],
    outcome: StreamingOutcome,
    parse: ParseState,
    base: FileContextBase,
): Issue[] {
    const issues: Issue[] = [];
    const sourceFile = base.sourceFile;
    for (const planItem of legacy) {
        if (!sourceFile && planItem.instance.requiresSourceFile) {
            base.execution?.skip(planItem.name, 'requires-source-file');
            continue;
        }
        if (!isFileAnalyzerActive(base.preflightMask, planItem.name)) {
            base.execution?.skip(planItem.name, 'file-preflight');
            continue;
        }
        const ctx: AnalyzerContext = {
            filePath: base.rel,
            content: base.content,
            root: outcome.ast?.root || parse.rootForCtx,
            adapter: base.adapter,
            sourceFile,
            config: base.config,
            options: planItem.options,
            lineStats: base.lineStats,
        };
        try {
            base.execution?.begin(planItem.name);
            issues.push(...planItem.instance.analyze(sourceFile, ctx));
        } catch (error) {
            base.execution?.fail(planItem.name, error);
            if (!sourceFile && error instanceof TypeError) {
                // Analyzer strictly expected SourceFile AST; safely ignore on non-TS/JS files
                continue;
            }
            const sev: Severity = base.config.failOnAnalyzerError ? 'error' : 'info';
            host.logger.error(`analyzer "${planItem.name}" threw on ${base.rel}`, error);
            issues.push({
                id: `core:analyzer-error:${base.rel}:1`,
                analyzer: planItem.name,
                rule: 'analyzer-error',
                severity: sev,
                message: `Analyzer "${planItem.name}" threw: ${(error as Error).message}`,
                location: {
                    file: base.rel,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                detail: {
                    error: String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
            });
        }
    }
    return issues;
}
