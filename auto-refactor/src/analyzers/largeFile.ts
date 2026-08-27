import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue, FileMetric, Severity } from '../core/types';
import { NodeKind, NormalizedNode } from '../core/multilang';
import { runStreaming } from '../core/traverse';

function firstWord(name: string): string {
  const m = name.match(/^[a-z]+|^[A-Z]+/) || ['misc'];
  return m[0].toLowerCase();
}

/**
 * Large-file splitting analyzer (language-agnostic).
 *
 * In the single-pass model, `visit` accumulates the structural metrics AND the inferred module
 * prefixes using the adapter-precomputed `node.topLevel` / `node.exported` / `node.functionLike`
 * flags (previously four+ separate `ts.forEachChild` walks). `finalize` consults the
 * (per-analyzer) thresholds and emits at most one issue when the file is too large.
 * `analyze` delegates to `runStreaming` via the TypeScript adapter.
 *
 * Judgment conditions (configurable thresholds):
 *   - lines >= fileLinesFail                        -> error   (must split)
 *   - lines >= fileLinesWarn OR functions >= fileFunctionsWarn -> warning (should split)
 */
export class LargeFileAnalyzer implements Analyzer {
  name = 'large-file' as const;

  private lines = 0;
  private nonBlankLines = 0;
  private functions = 0;
  private maxNesting = 0;
  private topLevelDeclarations = 0;
  private exportedSymbols = 0;
  private modules = new Set<string>();

  analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
    this.reset();
    // Lazy: the TypeScript adapter (and the `typescript` module) is only needed for the
    // standalone `analyze()` contract — never on the worker streaming path.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TypeScriptAdapter } = require('../core/typescriptAdapter') as typeof import('../core/typescriptAdapter');
    const adapter = new TypeScriptAdapter();
    const ast = adapter.parse(sf.text, ctx.filePath);
    return runStreaming(adapter, ast.root, [
      { analyzer: this, ctx: { ...ctx, sourceFile: sf, root: ast.root, adapter } },
    ]);
  }

  private reset(): void {
    this.lines = 0;
    this.nonBlankLines = 0;
    this.functions = 0;
    this.maxNesting = 0;
    this.topLevelDeclarations = 0;
    this.exportedSymbols = 0;
    this.modules.clear();
  }

  visit(
    node: NormalizedNode,
    _ctx: AnalyzerContext,
    parent: NormalizedNode | undefined,
    _grandparent: NormalizedNode | undefined,
    depth: number,
    _className: string | null,
    _binding: string | null,
  ): void {
    if (parent && parent.kind === NodeKind.SourceFile) {
      if (node.topLevel) {
        this.topLevelDeclarations++;
        if (node.exported) this.exportedSymbols++;
      }
      if (node.functionLike) {
        const name = node.name;
        if (name) this.modules.add(firstWord(name));
      }
    }
    if (node.functionLike) this.functions++;
    if (depth > this.maxNesting) this.maxNesting = depth;
  }

  finalize(ctx: AnalyzerContext): Issue[] {
    // P0-3: read the engine-precomputed line stats when present (single pass per file);
    // fall back to the old split-based counting for direct `analyze()` calls so the
    // produced values stay byte-identical.
    let lines: number;
    let nonBlankLines: number;
    if (ctx.lineStats) {
      lines = ctx.lineStats.lines;
      nonBlankLines = ctx.lineStats.nonBlankLines;
    } else {
      const content = ctx.content;
      lines = content.split(/\r\n|\n/).length;
      nonBlankLines = content.split(/\r\n|\n/).filter((l) => l.trim().length > 0).length;
    }
    this.lines = lines;
    this.nonBlankLines = nonBlankLines;

    const m: FileMetric = {
      file: ctx.filePath,
      lines: this.lines,
      nonBlankLines: this.nonBlankLines,
      functions: this.functions,
      maxNestingDepth: this.maxNesting,
      topLevelDeclarations: this.topLevelDeclarations,
      exportedSymbols: this.exportedSymbols,
    };

    const t = ctx.options;
    let severity: Severity | null = null;
    const reasons: string[] = [];

    if (m.lines >= t.fileLinesFail) {
      severity = 'error';
      reasons.push(`lines ${m.lines} >= fail threshold ${t.fileLinesFail}`);
    } else if (m.lines >= t.fileLinesWarn || m.functions >= t.fileFunctionsWarn) {
      severity = 'warning';
      if (m.lines >= t.fileLinesWarn) reasons.push(`lines ${m.lines} >= warn threshold ${t.fileLinesWarn}`);
      if (m.functions >= t.fileFunctionsWarn)
        reasons.push(`functions ${m.functions} >= warn threshold ${t.fileFunctionsWarn}`);
    }

    if (!severity) return [];

    const modules = [...this.modules];
    const suggestions: string[] = [];
    suggestions.push(
      `Split into smaller modules by responsibility (current: ${m.lines} lines, ${m.functions} functions, ` +
        `${m.topLevelDeclarations} top-level declarations, ${m.exportedSymbols} exports, max nesting ${m.maxNestingDepth}).`,
    );
    if (modules.length > 1) {
      suggestions.push(
        `Detected potential modules by name prefix: ${modules.join(', ')}. ` +
          `Consider extracting each into its own file under a dedicated directory.`,
      );
    }

    return [
      {
        id: `large-file:large-file:${ctx.filePath}:1`,
        analyzer: 'large-file',
        rule: 'large-file',
        severity,
        message:
          severity === 'error'
            ? `File is too large and should be split (${reasons.join('; ')}).`
            : `File is large; consider splitting (${reasons.join('; ')}).`,
        location: { file: ctx.filePath, start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
        detail: {
          ...m,
          reasons,
          inferredModules: modules,
        },
        suggestion: suggestions.join(' '),
      },
    ];
  }
}
