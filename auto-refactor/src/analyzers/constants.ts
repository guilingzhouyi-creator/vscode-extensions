import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { NodeKind, NormalizedNode } from '../core/multilang';
import { LiteralRecord } from '../core/incrementalState';
import { locN } from '../utils/normalized';
import { runStreaming } from '../core/traverse';

const TRIVIAL_NUMBERS = new Set(['0', '1', '-1']);

/** Order two literal observations by source position (1-based line, then column). */
function byPosition(a: LiteralRecord, b: LiteralRecord): number {
  const al = a.node.start ? a.node.start.line : 0;
  const bl = b.node.start ? b.node.start.line : 0;
  if (al !== bl) return al - bl;
  const ac = a.node.start ? a.node.start.column : 0;
  const bc = b.node.start ? b.node.start.column : 0;
  return ac - bc;
}

/**
 * Constants analyzer (language-agnostic).
 *
 * Detects three categories of inline literals that should be promoted to named constants:
 *   1. magic-number      — a numeric literal used inline (not already a `const`).
 *   2. hardcoded-string  — a string literal used inline (not already a `const` / i18n call / import path).
 *   3. duplicate-literal — a literal value (number or string) repeated >= threshold times in a file.
 *
 * The heavy lifting happens in the engine's single shared traversal: `visit` collects every
 * literal (const-binding and tolerated-context flags are precomputed by the language adapter,
 * so no `ts.isXxx` predicates remain here), and `finalize` runs the three detection passes.
 * `analyze` delegates to `runStreaming` via the TypeScript adapter so standalone calls behave
 * identically to the multiplexed engine path.
 */
export class ConstantsAnalyzer implements Analyzer {
  name = 'constants' as const;

  private literals: LiteralRecord[] = [];
  private issues: Issue[] = [];

  analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
    this.literals = [];
    this.issues = [];
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
    for (const lit of this.literals) {
      if (!lit.numeric || lit.isConstBound) continue;
      if (suppress.has(lit.node)) continue;
      const num = Number(lit.value);
      if (!isFinite(num)) continue;
      if (TRIVIAL_NUMBERS.has(lit.value)) continue;
      if (Math.abs(num) < min) continue;
      if (lit.tolerated) continue;

      const suggested = this.suggestName(lit.value, 'number');
      out.push({
        id: `constants:magic-number:${ctx.filePath}:${lit.node.start.line}`,
        analyzer: 'constants',
        rule: 'magic-number',
        severity: 'warning',
        message: `Magic number ${lit.value} should be extracted into a named constant.`,
        location: locN(lit.node, ctx.filePath),
        detail: { value: lit.value, numeric: true, suggestedName: suggested },
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
    for (const lit of this.literals) {
      if (lit.numeric || lit.isConstBound) continue;
      if (suppress.has(lit.node)) continue;
      const text = lit.value;
      const inner = text.replace(/^['"`]|['"`]$/g, '');
      if (inner.length < minLen) continue;
      if (lit.tolerated) continue;

      const suggested = this.suggestName(inner, 'string');
      out.push({
        id: `constants:hardcoded-string:${ctx.filePath}:${lit.node.start.line}`,
        analyzer: 'constants',
        rule: 'hardcoded-string',
        severity: 'warning',
        message: `Hardcoded string should be extracted into a named constant.`,
        location: locN(lit.node, ctx.filePath),
        detail: { value: text, length: inner.length, suggestedName: suggested },
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
    const groups = new Map<string, LiteralRecord[]>();
    for (const lit of this.literals) {
      if (lit.isConstBound) continue;
      if (
        lit.numeric &&
        (TRIVIAL_NUMBERS.has(lit.value) || Math.abs(Number(lit.value)) < ctx.options.magicNumberMin)
      ) {
        continue;
      }
      const key = `${lit.numeric ? 'N' : 'S'}:${lit.value}`;
      const arr = groups.get(key) || [];
      arr.push(lit);
      groups.set(key, arr);
    }

    for (const [key, arr] of groups) {
      if (arr.length < threshold) continue;
      for (const l of arr) suppress.add(l.node);
      const first = arr[0];
      const suggested = this.suggestName(first.value, first.numeric ? 'number' : 'string');
      out.push({
        id: `constants:duplicate-literal:${ctx.filePath}:${first.node.start.line}`,
        analyzer: 'constants',
        rule: 'duplicate-literal',
        severity: 'warning',
        message: `Literal ${first.value} is repeated ${arr.length} times in this file; extract it into a shared constant.`,
        location: locN(first.node, ctx.filePath),
        detail: {
          value: first.value,
          numeric: first.numeric,
          occurrences: arr.length,
          lines: arr.map((l) => l.node.start.line),
          suggestedName: suggested,
        },
        suggestion: `const ${suggested} = ${first.value}; // used ${arr.length}x`,
      });
    }
  }

  private suggestName(value: string, kind: 'number' | 'string'): string {
    if (kind === 'number') {
      const n = Number(value);
      if (Number.isInteger(n) && Math.abs(n) < 1000) return `CONST_${n}`;
      return 'EXTRACTED_NUMBER';
    }
    const cleaned = value
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    return cleaned ? `${cleaned.toUpperCase()}_TEXT` : 'EXTRACTED_STRING';
  }
}
