/**
 * Module: Core Engine — Legacy Analyzer Phase
 * File Path: src/core/scanner/legacyAnalyzers.ts
 * Architecture Role: Legacy per-analyzer execution stage of the in-process scan path.
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
import type { ResolvedAnalyzer } from '../analyzerRegistry';
import type { LanguageAdapter } from '../multilang';
import type { AnalyzerHost, FileContextBase, ParseState, StreamingOutcome } from './analyzerRunner';

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
    if (legacy.length === 0) return undefined;
    if (adapter.id !== 'typescript' && adapter.id !== 'oxc') return undefined;
    return require('../../utils/ast').createSourceFile(rel, content);
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
    const sf = base.sourceFile;
    for (const p of legacy) {
        if (!sf) continue; // external plug-ins cannot analyze non-TypeScript files
        const ctx: AnalyzerContext = {
            filePath: base.rel,
            content: base.content,
            root: outcome.ast?.root || parse.rootForCtx,
            adapter: base.adapter,
            sourceFile: sf,
            config: base.config,
            options: p.options,
            lineStats: base.lineStats,
        };
        try {
            issues.push(...p.instance.analyze(sf, ctx));
        } catch (e) {
            const sev: Severity = base.config.failOnAnalyzerError ? 'error' : 'info';
            host.logger.error(`analyzer "${p.name}" threw on ${base.rel}: ${String(e)}`);
            issues.push({
                id: `core:analyzer-error:${base.rel}:1`,
                analyzer: p.name,
                rule: 'analyzer-error',
                severity: sev,
                message: `Analyzer "${p.name}" threw: ${(e as Error).message}`,
                location: {
                    file: base.rel,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                detail: { error: String(e) },
            });
        }
    }
    return issues;
}
