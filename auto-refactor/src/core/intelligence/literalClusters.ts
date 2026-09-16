/**
 * Module: Core Engine - Cross-file Literal Cluster Findings (Repository Intelligence consumer)
 * File Path: src/core/intelligence/literalClusters.ts
 * Architecture Role: The consumer that turns the shared literal store into review obligations:
 *     it reads the already-collected cross-file clusters and reports values that are shared
 *     between files AND carry more than one meaning, so the reviewer never re-parses a file
 * Dependencies & Triggers: `LiteralIndex`/`LiteralEntry` from ./literalIndex; called by the
 *     `literal-clusters` post-scan pass in api.finalizeReport when the constants analyzer enables
 *     `crossFileLiteralClusters` and the scan covers the complete file set
 * Responsibilities: Filter cross-file clusters, skip single-meaning values (those stay with the
 *     per-file duplicate-literal analyzer), cap the finding count, and emit one issue per value
 *     carrying the meaning split, the files and the occurrences as evidence
 * Exit Semantics & Design Rationale: Pure function over in-memory facts - no I/O, no throwing,
 *     deterministic ordering. Findings are emitted only when the value is genuinely shared AND
 *     multi-meaning, because "appears twice" alone is not evidence for extracting a constant and
 *     a Global Constants God Object is the failure mode this rule exists to prevent. Severity is
 *     informational by default and the whole pass is opt-in, so enabling it never changes an
 *     existing consumer's gate without an explicit configuration decision.
 */
import type { Issue } from '../types';
import type { LiteralEntry, LiteralIndex } from './literalIndex';

/** Tuning for the cross-file literal cluster findings. */
export interface LiteralClusterOptions {
    /** Minimum number of files a value must appear in. Defaults to two. */
    minFiles?: number;
    /** Hard cap on emitted findings. Defaults to fifty. */
    maxIssues?: number;
    /** Require more than one meaning; defaults to true. */
    requireMultipleMeanings?: boolean;
    /** Severity of the emitted findings. Defaults to `info`. */
    severity?: string;
}

const DEFAULT_MIN_FILES = 2;
const DEFAULT_MAX_ISSUES = 50;
const DEFAULT_SEVERITY = 'info';
const UNATTRIBUTED = 'unattributed';

/**
 * Render one meaning as `role:symbol` for the issue message.
 *
 * @param meaning - The meaning to render.
 * @returns Human-readable meaning key.
 */
function meaningLabel(meaning: LiteralEntry['meanings'][number]): string {
    return `${meaning.role}:${meaning.symbol ?? UNATTRIBUTED}`;
}

/**
 * Build review findings for cross-file literal clusters.
 *
 * @param index - The shared literal store fed by the scan traversal.
 * @param options - Optional thresholds and severity.
 * @returns One issue per shared multi-meaning value, richest first.
 */
export function buildLiteralClusterIssues(
    index: LiteralIndex,
    options: LiteralClusterOptions = {},
): Issue[] {
    const minFiles = options.minFiles ?? DEFAULT_MIN_FILES;
    const maxIssues = options.maxIssues ?? DEFAULT_MAX_ISSUES;
    const requireMultipleMeanings = options.requireMultipleMeanings ?? true;
    const severity = options.severity ?? DEFAULT_SEVERITY;
    const issues: Issue[] = [];
    for (const entry of index.clusters(minFiles)) {
        if (issues.length >= maxIssues) break;
        if (requireMultipleMeanings && !entry.multiMeaning) continue;
        const site = entry.firstSite;
        const meanings = entry.meanings.map((meaning) => ({
            role: meaning.role,
            symbol: meaning.symbol,
            files: meaning.files,
            occurrences: meaning.occurrences,
        }));
        issues.push({
            id: `literal-clusters:${entry.value}`,
            analyzer: 'constants',
            rule: 'duplicate-literal',
            severity: severity as Issue['severity'],
            message:
                `字面量 "${entry.value}" 跨 ${entry.files.length} 个文件出现 ${entry.occurrences} 次，` +
                `且承载 ${entry.meanings.length} 种语义（${entry.meanings.map(meaningLabel).join('; ')}）` +
                '—— 不得合并为同一个常量',
            location: {
                file: site.file,
                start: { line: site.line, column: site.column },
                end: { line: site.line, column: site.column },
            },
            detail: {
                crossFile: true,
                value: entry.value,
                files: entry.files,
                occurrences: entry.occurrences,
                meanings,
            },
            suggestion:
                '按语义分别定义常量：协议/接口值归协议层，算法调参归算法模块，测试夹具留在 fixture；' +
                '若确属同一语义，收敛到唯一的领域所有者并保留兼容别名',
        });
    }
    return issues;
}
