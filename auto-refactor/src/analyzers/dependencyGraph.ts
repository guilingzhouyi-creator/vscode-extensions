/**
 * Module: Static Analysis Engine — Dependency Graph Analyzer
 * File Path: src/analyzers/dependencyGraph.ts
 * Architecture Role: Per-file analyzer adapter enforcing declarative import boundaries
 * Dependencies & Triggers: core types plus `path`; triggered when `analyzers["dependency-graph"]`
 *   is enabled by CLI / CI / daemon scans, and also through the standalone analyze() contract
 * Responsibilities: Resolve relative import specifiers, map files to configured `groups`,
 *   enforce each group's `rules` (allowGroups / allowExternal / allowImportGlobs) and emit
 *   `disallowed-import` findings for forbidden externals or cross-group dependencies
 * Exit Semantics & Design Rationale: Cache-friendly pure function of file content and resolved
 *   config — returns [] for unconfigured or unmatched files and never throws; when
 *   `options.detectCycles` is on, global cycle detection needs the whole-file view and runs in
 *   the post-scan pass (api.ts), emitting `import-cycle` issues under this analyzer's name.
 *
 * Config shape (inside `analyzers["dependency-graph"].options`):
 *   groups: { "domain": ["src/domain/**"] }         // file → group membership (glob list)
 *   rules:  { "domain": {
 *              allowGroups: ["shared"],             // groups it may import (self always allowed)
 *              allowExternal: ["vscode", "node:*"], // bare imports permitted
 *              allowImportGlobs: ["src/a/b.ts"]     // exact-file exceptions (DIP ports)
 *            } }
 * Groups not listed in `rules` are unconstrained. Files matching no group are unchecked.
 */

import * as path from 'path';
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';

interface GroupRules {
    allowGroups?: string[];
    allowExternal?: string[];
    allowImportGlobs?: string[];
}

interface DependencyGraphOptions {
    groups?: Record<string, string[]>;
    rules?: Record<string, GroupRules>;
    detectCycles?: boolean;
    cycleSeverity?: Severity;
    maxCyclesReported?: number;
}

/** Simple glob → RegExp: `**` crosses segments, `*` stays within one segment. */
function globToRegex(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
}

/** Normalize a file path the same way the core graph does: POSIX, extension stripped. */
function normalizeRel(p: string): string {
    return path
        .normalize(p)
        .replace(/\\/g, '/')
        .replace(/\.(ts|tsx|js|jsx|d\.ts|mts|cts|mjs|cjs)$/, '');
}

interface CompiledGroup {
    group: string;
    regexes: RegExp[];
}

interface RuleConstraints {
    allowGroups: Set<string>;
    compiledExceptionRegexes: RegExp[];
    allowAllExternal: boolean;
    allowExternalExact: Set<string>;
    allowExternalPrefixes: string[];
}

function compileGroups(groups: Record<string, string[]>): CompiledGroup[] {
    const compiled: CompiledGroup[] = [];
    for (const [group, globs] of Object.entries(groups)) {
        compiled.push({
            group,
            regexes: (globs ?? []).map(globToRegex),
        });
    }
    return compiled;
}

function matchGroup(normPath: string, compiledGroups: CompiledGroup[]): string | null {
    for (const { group, regexes } of compiledGroups) {
        if (regexes.some((re) => re.test(normPath))) {
            return group;
        }
    }
    return null;
}

function classifyAllowedExternal(
    entry: string,
    target: { allowAll: boolean; exact: Set<string>; prefixes: string[] },
): void {
    if (entry === '*') {
        target.allowAll = true;
        return;
    }
    if (entry.endsWith(':*')) {
        target.prefixes.push(entry.slice(0, -1));
        return;
    }
    target.exact.add(entry);
}

function compileRuleConstraints(fromGroup: string, rule: GroupRules): RuleConstraints {
    const allowGroups = new Set([fromGroup, ...(rule.allowGroups ?? [])]);
    const compiledExceptionRegexes = (rule.allowImportGlobs ?? []).map((g) => {
        return globToRegex(g.includes('/') ? g : `**/${g}`);
    });

    const target = { allowAll: false, exact: new Set<string>(), prefixes: [] as string[] };
    for (const a of rule.allowExternal ?? []) {
        classifyAllowedExternal(a, target);
    }

    return {
        allowGroups,
        compiledExceptionRegexes,
        allowAllExternal: target.allowAll,
        allowExternalExact: target.exact,
        allowExternalPrefixes: target.prefixes,
    };
}

const IMPORT_SPEC_RE =
    /(?:import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?|export\s+(?:[\s\S]*?from\s+)?|import\(|require\()['"]([^'"]+)['"]/g;

/** ASCII code of carriage return, stripped from CRLF line endings before per-line analysis. */
const CARRIAGE_RETURN_CHAR_CODE = 13;

/**
 * Enforce declarative import boundaries between configured file groups.
 *
 * Each file is mapped to a group through its glob list, and the group's rules constrain
 * which peer groups may be imported (`allowGroups`), which bare packages are permitted
 * (`allowExternal`) and which exact files are exempt (`allowImportGlobs`). Relative
 * specifiers are resolved before the target group is checked; unresolved specifiers are
 * left alone rather than guessed.
 *
 * Contract: produces canonical `disallowed-import` issues for forbidden externals or
 * cross-group dependencies. Inputs are the file `content`/`filePath` plus `options`
 * (`groups`, `rules`); `detectCycles`, `cycleSeverity` and `maxCyclesReported` are
 * consumed by the whole-file cycle pass in `api.ts`, which emits `import-cycle` findings
 * under this analyzer's name. Output is an empty array when no groups are configured,
 * when the file matches no group, or when the matched group has no rules.
 * Edge cases: the file's own group is always allowed; external names match by exact name
 * or prefix; `**` crosses path segments while `*` stays within one; group membership is
 * first-match-wins.
 * Failure semantics: a pure function of content plus resolved config that never throws.
 */
export class DependencyGraphAnalyzer implements Analyzer {
    name = 'dependency-graph' as const;

    analyze(sf: import('typescript').SourceFile, ctx: AnalyzerContext): Issue[] {
        const opts = (ctx.options || {}) as DependencyGraphOptions;
        const groups = opts.groups ?? {};
        const rules = opts.rules ?? {};
        if (Object.keys(groups).length === 0) return [];

        const file = ctx.filePath.replace(/\\/g, '/');
        const normFile = normalizeRel(file);

        const compiledGroups = compileGroups(groups);
        const fromGroup = matchGroup(normFile, compiledGroups);
        if (!fromGroup) return [];

        const rule = rules[fromGroup];
        if (!rule) return [];
        const constraints = compileRuleConstraints(fromGroup, rule);

        const targetGroupCache = new Map<string, string | null>();
        const resolveTargetGroup = (resolvedPath: string): string | null => {
            const cached = targetGroupCache.get(resolvedPath);
            if (cached !== undefined) return cached;
            const target = matchGroup(resolvedPath, compiledGroups);
            targetGroupCache.set(resolvedPath, target);
            return target;
        };

        const issues: Issue[] = [];
        const content = ctx.content || '';
        const len = content.length;
        let lineStart = 0;
        let idx = 0;

        while (lineStart < len) {
            const { lineText, nextStart } = this.extractNextLine(content, lineStart, len);
            this.auditLineImports(
                lineText,
                fromGroup,
                normFile,
                constraints,
                resolveTargetGroup,
                idx,
                ctx,
                issues,
            );
            idx++;
            lineStart = nextStart;
        }

        return issues;
    }

    private extractNextLine(
        content: string,
        lineStart: number,
        len: number,
    ): { lineText: string; nextStart: number } {
        let lineEnd = content.indexOf('\n', lineStart);
        if (lineEnd === -1) return { lineText: content.slice(lineStart, len), nextStart: len };
        const nextStart = lineEnd + 1;
        if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === CARRIAGE_RETURN_CHAR_CODE) {
            lineEnd--;
        }
        return { lineText: content.slice(lineStart, lineEnd), nextStart };
    }

    private auditLineImports(
        lineText: string,
        fromGroup: string,
        normFile: string,
        constraints: RuleConstraints,
        resolveTargetGroup: (resolvedPath: string) => string | null,
        lineIdx: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        IMPORT_SPEC_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = IMPORT_SPEC_RE.exec(lineText)) !== null) {
            const spec = m[1];
            if (spec) {
                this.auditImportSpecifier(
                    spec,
                    fromGroup,
                    normFile,
                    constraints,
                    resolveTargetGroup,
                    lineIdx,
                    ctx,
                    issues,
                );
            }
        }
    }

    private auditImportSpecifier(
        spec: string,
        fromGroup: string,
        normFile: string,
        constraints: RuleConstraints,
        resolveTargetGroup: (resolvedPath: string) => string | null,
        lineIdx: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (!spec.startsWith('.') && !spec.startsWith('/')) {
            this.auditExternalImport(spec, fromGroup, constraints, lineIdx, ctx, issues);
        } else {
            this.auditRelativeImport(
                spec,
                fromGroup,
                normFile,
                constraints,
                resolveTargetGroup,
                lineIdx,
                ctx,
                issues,
            );
        }
    }

    private auditExternalImport(
        spec: string,
        fromGroup: string,
        constraints: RuleConstraints,
        lineIdx: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const allowed =
            constraints.allowAllExternal ||
            constraints.allowExternalExact.has(spec) ||
            constraints.allowExternalPrefixes.some((prefix) => spec.startsWith(prefix));
        if (!allowed) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'disallowed-import',
                    `External dependency '${spec}' is not permitted for group "${fromGroup}"`,
                    { from: fromGroup, specifier: spec },
                ),
            );
        }
    }

    private auditRelativeImport(
        spec: string,
        fromGroup: string,
        normFile: string,
        constraints: RuleConstraints,
        resolveTargetGroup: (resolvedPath: string) => string | null,
        lineIdx: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const abs = path.posix.normalize(path.posix.join(path.posix.dirname(normFile), spec));
        const resolved = normalizeRel(abs);
        const targetGroup = resolveTargetGroup(resolved);

        if (targetGroup && constraints.allowGroups.has(targetGroup)) return;

        const globException = constraints.compiledExceptionRegexes.some((re) => {
            return re.test(resolved) || re.test(resolved + '.ts') || re.test(resolved + '/index');
        });
        if (globException) return;

        if (targetGroup) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'disallowed-import',
                    `Cross-group dependency violation: "${fromGroup}" → "${targetGroup}" (${resolved} is not permitted)`,
                    { from: fromGroup, to: targetGroup, resolved, specifier: spec },
                ),
            );
        }
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined as any, ctx);
    }

    private mkIssue(
        ctx: AnalyzerContext,
        lineIdx: number,
        rule: string,
        message: string,
        detail: Record<string, any>,
    ): Issue {
        const line = lineIdx + 1;
        const file = ctx.filePath.replace(/\\/g, '/');
        return {
            id: `${this.name}:${rule}:${file}:${line}`,
            analyzer: this.name,
            rule,
            severity: 'error',
            message,
            location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
            detail,
        };
    }
}
