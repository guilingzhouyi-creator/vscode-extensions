/**
 * Module: Core Reporting — Pluggable Reporter Registry
 * File Path: src/core/reporters/reporterRegistry.ts
 * Architecture Role: Registry/adapter boundary between the scan engine's ScanReport model and
 *   string report formats; the stable extension point for built-in and third-party reporters.
 * Dependencies & Triggers: Imports only the ScanReport type from ../types; self-registers the
 *   json, markdown, sarif and badge plugins at module load and is re-exported by src/api.ts;
 *   registerReporter, getReporter and listReporters are called by API/CLI integrators, not by
 *   the core scan path.
 * Responsibilities: Key plugins by lower-cased name and register/get/list them; render pretty
 *   (2-space) or compact JSON; emit a Markdown summary with counts, optional quality-score
 *   table and at most 100 issues; emit SARIF 2.1.0 with de-duplicated rules and severity
 *   mapping; emit a 110x20 SVG badge colored by the composite score; delegate the Agent,
 *   CAPP, CAS v3 compact and Praxis formats to their dedicated serializers.
 * Exit Semantics & Design Rationale: Synchronous in-memory Map operations; an unknown name
 *   returns undefined instead of throwing so format resolution stays fail-soft, and the last
 *   registration for a name wins (Map.set), so external plugins can override built-ins without
 *   core engine edits.
 */

import type { ScanReport } from '../types';
import type { PraxisPresentationOptions } from '../praxis/presentation/presentation-types';
import { toAasJson, type AasReportOptions } from '../reporting/aas-reporter';
import { createAuditReceipt, serializeAuditReceipt } from '../reporting/audit-receipt';
import { toJson, toSarif } from '../reporters';
import {
    toAgentReview,
    toCapp,
    toPraxisPresentation,
    type AgentReviewReporterOptions,
} from './agent-review-reporter';

/**
 * Public contract for a pluggable report renderer: a stable, case-insensitive `name` used as
 * the registry key plus a `format` that serializes one complete ScanReport into a string.
 *
 * Implementations are invoked synchronously on the caller's thread and receive the report by
 * reference. `format` must return the entire rendered document for its format; the registry
 * treats the returned text as opaque and neither inspects nor mutates it.
 */
export interface ReporterPlugin {
    name: string;

    /**
     * Serialize one report into this reporter's output format.
     *
     * Implementations run synchronously, receive the report by reference, and return the
     * complete rendered document; the caller appends nothing and writes the string as-is.
     *
     * @param report - Complete scan result to render; the implementation should treat it as
     *   read-only so the caller can reuse it for other reporters.
     * @param options - Optional format-specific rendering switches; a plugin may ignore it and
     *   fall back to its own defaults.
     * @returns The rendered document as a string, possibly empty for an empty report.
     */
    format(report: ScanReport, options?: Record<string, unknown>): string;
}

const REGISTRY = new Map<string, ReporterPlugin>();

/** Minimum rounded composite score for the badge's green (passing) color tier. */
const BADGE_GREEN_MIN_SCORE = 90;

/** Minimum rounded composite score for the badge's yellow (warning) color tier. */
const BADGE_YELLOW_MIN_SCORE = 75;

/** Minimum dimension index rendered as PASS in the Markdown quality table. */
const DIMENSION_PASS_MIN_SCORE = 80;
/** Status label for a dimension whose index reaches the pass threshold. */
const STATUS_PASS = '🟢 PASS';
/** Status label for a dimension whose index falls below the pass threshold. */
const STATUS_WARN = '🟡 WARN';
/** Status label for a failing dimension. */
const STATUS_FAIL = '🔴 BLOCK';
/** Maximum issues listed in the Markdown report before the tail is truncated. */
const MARKDOWN_MAX_ISSUES = 100;
/** Fallback badge score when a report carries no quality score; 100 is a baseline composite. */
const BADGE_DEFAULT_SCORE = 100;

/** Canonical ten dimensions for markdown report rendering */
const CANONICAL_DIMENSIONS = Object.freeze([
    { key: 'codeSecurity', num: ' 1', name: '代码安全', labelEn: '代码安全 (Code Security)' },
    { key: 'architectureConsistency', num: ' 2', name: '架构一致', labelEn: '架构一致 (Architecture)' },
    { key: 'maintainability', num: ' 3', name: '可维护性', labelEn: '可维护性 (Maintainability)' },
    { key: 'performanceEfficiency', num: ' 4', name: '性能预算', labelEn: '性能预算 (Performance)' },
    { key: 'techDebtRisk', num: ' 5', name: '技术债风险', labelEn: '技术债风险 (Tech Debt Risk)' },
    { key: 'semanticPurity', num: ' 6', name: '语义纯度', labelEn: '语义纯度 (Semantic Purity)' },
    { key: 'duplication', num: ' 7', name: '重复率', labelEn: '重复率 (Duplication)' },
    { key: 'standardization', num: ' 8', name: '标准化', labelEn: '标准化 (Standardization)' },
    { key: 'modernity', num: ' 9', name: '现代化', labelEn: '现代化 (Modernity)' },
    { key: 'commentQuality', num: '10', name: '注释质量', labelEn: '注释质量 (Comment Quality)' },
]);

function renderMarkdownProgressBar(score: number, width = 12): string {
    const clamped = Math.max(0, Math.min(100, score));
    const filled = Math.round((clamped / 100) * width);
    const empty = width - filled;
    return '`[' + '█'.repeat(filled) + '░'.repeat(empty) + ']`';
}

/**
 * Register or replace a reporter plugin under its lower-cased name.
 *
 * Registration is synchronous, process-local, and last-writer-wins: the key is
 * `plugin.name.toLowerCase()`, so registering an existing name silently replaces the previous
 * plugin (including a built-in) for every later lookup. The plugin instance is stored by
 * reference and is not copied or validated.
 *
 * @param plugin - Reporter whose `name` becomes the lookup key and whose `format` renders a
 *   complete ScanReport; an empty name is accepted as a legal key.
 */
export function registerReporter(plugin: ReporterPlugin): void {
    REGISTRY.set(plugin.name.toLowerCase(), plugin);
}

/**
 * Resolve the reporter registered for `name` using a case-insensitive lookup.
 *
 * The lookup is synchronous and side-effect free: it only reads the in-memory Map, so callers
 * may invoke it during output formatting without touching the filesystem or a subprocess.
 *
 * @param name - Registry key to look up; case is folded with `toLowerCase()` because
 *   registration normalizes keys the same way.
 * @returns The registered plugin, or `undefined` when no reporter owns that key; callers
 *   decide whether to fall back to the default text format.
 */
export function getReporter(name: string): ReporterPlugin | undefined {
    return REGISTRY.get(name.toLowerCase());
}

/**
 * Snapshot every registered reporter key as a new array in Map insertion order.
 *
 * Built-in json, markdown, sarif and badge reporters appear in module-load order unless a
 * later registration replaced one. The returned array is detached from the registry, so
 * callers may sort or filter it without changing resolution behavior.
 *
 * @returns Lower-cased reporter names currently registered; an empty array when none exist.
 */
export function listReporters(): string[] {
    return Array.from(REGISTRY.keys());
}

// ---- Register Built-in Reporters ----

/**
 * Groups top scoring rationales by dimension key to explain score deductions.
 */
function groupTopRationalesByDimension(rationales?: Array<{ dimension: string; delta: number; reason: string; rule?: string; line?: number }>): Map<string, string[]> {
    const result = new Map<string, string[]>();
    if (!rationales || rationales.length === 0) return result;
    CANONICAL_DIMENSIONS.forEach((dimensionDef) => {
        result.set(dimensionDef.key, []);
    });
    for (const rationale of rationales) {
        const list = result.get(rationale.dimension);
        if (list && list.length < 2) {
            const ruleText = rationale.rule ? `\`${rationale.rule}\` ` : '';
            const lineText = rationale.line ? ` (L${rationale.line})` : '';
            list.push(`${ruleText}${rationale.delta}分${lineText}: ${rationale.reason}`);
        }
    }
    return result;
}

/**
 * Formats a single markdown table row for a canonical quality dimension.
 */
function renderMarkdownDimensionRow(
    dimensionDef: (typeof CANONICAL_DIMENSIONS)[number],
    qualityScore: NonNullable<ScanReport['qualityScore']>,
    notEvaluatedSet: Set<string>,
    rationalesByDimension: Map<string, string[]>,
): string {
    const rawScoreValue = qualityScore.indices ? (qualityScore.indices as any)[dimensionDef.key] : undefined;
    const isNotEvaluated = notEvaluatedSet.has(dimensionDef.key as any) || rawScoreValue === undefined || !Number.isFinite(rawScoreValue);
    const scoreText = isNotEvaluated ? 'N/A' : (rawScoreValue as number).toFixed(1);
    const weightVal = qualityScore.weights ? (qualityScore.weights as any)[dimensionDef.key] : undefined;
    const weightText = typeof weightVal === 'number' ? `${(weightVal * 100).toFixed(1)}%` : '-';

    if (isNotEvaluated) {
        return `| ${dimensionDef.num} | ${dimensionDef.labelEn} | ${scoreText} | ${weightText} | ⚪ SKIP | \`[            ]\` | 当前扫描器未覆盖此维度 |`;
    }

    const dimensionScore = rawScoreValue as number;
    let status = STATUS_PASS;
    if (dimensionScore < BADGE_YELLOW_MIN_SCORE) status = STATUS_FAIL;
    else if (dimensionScore < DIMENSION_PASS_MIN_SCORE) status = STATUS_WARN;

    const bar = renderMarkdownProgressBar(dimensionScore);
    const hints = rationalesByDimension.get(dimensionDef.key);
    const guidance = hints && hints.length > 0 ? hints.join('; ') : '健康达标 (无显式扣分)';
    return `| ${dimensionDef.num} | ${dimensionDef.labelEn} | ${scoreText} | ${weightText} | ${status} | ${bar} | ${guidance.replace(/\|/g, '\\|')} |`;
}

/**
 * Renders the complete ten-dimensional quality scorecard in markdown.
 */
function renderMarkdownQualityScorecard(qualityScore: NonNullable<ScanReport['qualityScore']>): string[] {
    const compositeText = Number.isFinite(qualityScore.compositeScore)
        ? `${qualityScore.compositeScore} / 100`
        : 'N/A';
    const confidenceText = qualityScore.confidence !== undefined
        ? ` | 置信度: ${(qualityScore.confidence * 100).toFixed(0)}%`
        : '';
    const section: string[] = [
        ``,
        `## 🎯 十维工程质量全景看板 (Quality Score: ${compositeText} [Grade: ${qualityScore.grade}]${confidenceText})`,
        ``,
        `| # | 评估维度 | 得分 | 权重 | 状态 | 进度走廊 | 扣分根因 / 优化导引 |`,
        `| :-: | :--- | :-: | :-: | :-: | :-: | :--- |`,
    ];

    const rationalesByDimension = groupTopRationalesByDimension(qualityScore.rationales);
    const notEvaluatedSet = new Set(qualityScore.notEvaluated ?? []);
    for (const dimensionDef of CANONICAL_DIMENSIONS) {
        section.push(renderMarkdownDimensionRow(dimensionDef, qualityScore, notEvaluatedSet, rationalesByDimension));
    }

    if (qualityScore.technicalDebt || qualityScore.densityTensorSummary) {
        section.push(``);
        section.push(`### 📊 结构张量与技术债务`);
        if (qualityScore.technicalDebt) {
            const technicalDebt = qualityScore.technicalDebt;
            const hours = (technicalDebt.totalRemediationMinutes / 60).toFixed(1);
            section.push(
                `- **SQALE 技术债务比率**: \`${technicalDebt.technicalDebtRatio.toFixed(1)}%\` (等级: \`${technicalDebt.sqaleGrade}\`, 预估修复工时: \`${hours}h\` / \`${technicalDebt.totalRemediationMinutes}min\`)`,
            );
        }
        if (qualityScore.densityTensorSummary) {
            const tensor = qualityScore.densityTensorSummary;
            const distanceText = tensor.averageMahalanobisDistance !== undefined
                ? `, 马氏距离: \`${tensor.averageMahalanobisDistance.toFixed(2)}\``
                : '';
            section.push(
                `- **5D 黎曼相空间张量**: 逻辑密度 \`${(tensor.compositeDensity * 100).toFixed(1)}%\`, TSPR: \`${(tensor.averageTspr * 100).toFixed(0)}%\`, POR: \`${(tensor.averagePor * 100).toFixed(0)}%\`${distanceText}`,
            );
        }
    }
    return section;
}

/**
 * Renders detected issues summary table in markdown.
 */
function renderMarkdownIssuesSection(issues: ScanReport['issues']): string[] {
    if (issues.length === 0) return [];
    const section: string[] = [
        ``,
        `## Detected Issues (${issues.length})`,
        ``,
        `| Severity | Rule | Location | Message |`,
        `| :--- | :--- | :--- | :--- |`,
    ];
    for (const issueItem of issues.slice(0, MARKDOWN_MAX_ISSUES)) {
        section.push(
            `| **${issueItem.severity.toUpperCase()}** | \`${issueItem.rule}\` | \`${issueItem.location.file}:${issueItem.location.start.line}\` | ${issueItem.message.replace(/\|/g, '\\|')} |`,
        );
    }
    if (issues.length > MARKDOWN_MAX_ISSUES) {
        section.push(
            `| ... | ... | ... | *[${issues.length - MARKDOWN_MAX_ISSUES} more issues truncated]* |`,
        );
    }
    return section;
}

registerReporter({
    name: 'json',
    format(report: ScanReport, options?: { pretty?: boolean }): string {
        return options?.pretty === false ? JSON.stringify(report) : toJson(report);
    },
});

registerReporter({
    name: 'markdown',
    format(report: ScanReport): string {
        const { summary, issues, qualityScore } = report;
        const lines: string[] = [
            `# Auto-Refactor Code Review Report`,
            ``,
            `**Generated At**: ${report.generatedAt}`,
            `**Files Scanned**: ${summary.filesScanned} | **Issues Found**: ${summary.issuesTotal} (Errors: ${summary.bySeverity.error}, Warnings: ${summary.bySeverity.warning}, Info: ${summary.bySeverity.info})`,
            `**Duration**: ${summary.durationMs}ms`,
        ];

        if (qualityScore) {
            lines.push(...renderMarkdownQualityScorecard(qualityScore));
        }

        if (issues.length > 0) {
            lines.push(...renderMarkdownIssuesSection(issues));
        }

        return lines.join('\n');
    },
});

registerReporter({
    name: 'sarif',
    format(report: ScanReport): string {
        return toSarif(report);
    },
});

registerReporter({
    name: 'badge',
    format(report: ScanReport): string {
        // An unmeasured composite is NaN, and Math.round(NaN) is NaN, which would render the
        // literal "NaN" into the badge and make every threshold comparison false (forcing
        // the red colour for a scan that simply measured nothing). Treat it as "no score".
        const measured =
            report.qualityScore !== undefined &&
            Number.isFinite(report.qualityScore.compositeScore);
        const score = measured
            ? Math.round((report.qualityScore as { compositeScore: number }).compositeScore)
            : BADGE_DEFAULT_SCORE;
        const color =
            score >= BADGE_GREEN_MIN_SCORE
                ? '#4c1'
                : score >= BADGE_YELLOW_MIN_SCORE
                    ? '#dfb317'
                    : '#e05d44';
        return `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="20">
  <linearGradient id="b" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <mask id="a"><rect width="110" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h65v20H0z"/>
    <path fill="${color}" d="M65 0h45v20H65z"/>
    <path fill="url(#b)" d="M0 0h110v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="32.5" y="15" fill="#010101" fill-opacity=".3">quality</text>
    <text x="32.5" y="14">quality</text>
    <text x="86.5" y="15" fill="#010101" fill-opacity=".3">${score}</text>
    <text x="86.5" y="14">${score}</text>
  </g>
</svg>`;
    },
});

registerReporter({
    name: 'agent',
    format(report: ScanReport, options?: Record<string, unknown>): string {
        return toAgentReview(report, options as AgentReviewReporterOptions | undefined);
    },
});

registerReporter({
    name: 'capp',
    format(report: ScanReport): string {
        return toCapp(report);
    },
});

registerReporter({
    name: 'compact',
    format(report: ScanReport, options?: Record<string, unknown>): string {
        return toAasJson(report, options as AasReportOptions | undefined);
    },
});

registerReporter({
    name: 'praxis',
    format(report: ScanReport, options?: Record<string, unknown>): string {
        return toPraxisPresentation(report, options as PraxisPresentationOptions | undefined);
    },
});

registerReporter({
    name: 'aas',
    format(report: ScanReport, options?: Record<string, unknown>): string {
        return toAasJson(report, options as AasReportOptions | undefined);
    },
});

registerReporter({
    name: 'receipt',
    format(report: ScanReport): string {
        return serializeAuditReceipt(createAuditReceipt(report));
    },
});
