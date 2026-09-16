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
 *   mapping; emit a 110x20 SVG badge colored by the composite score.
 * Exit Semantics & Design Rationale: Synchronous in-memory Map operations; an unknown name
 *   returns undefined instead of throwing so format resolution stays fail-soft, and the last
 *   registration for a name wins (Map.set), so external plugins can override built-ins without
 *   core engine edits.
 */

import type { ScanReport } from '../types';

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
const STATUS_PASS = 'PASS';
/** Status label for a dimension whose index falls below the pass threshold. */
const STATUS_WARN = 'WARN';
/** Maximum issues listed in the Markdown report before the tail is truncated. */
const MARKDOWN_MAX_ISSUES = 100;
/** Fallback badge score when a report carries no quality score; 100 is a perfect composite. */
const BADGE_DEFAULT_SCORE = 100;

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

// 1. JSON Reporter
registerReporter({
    name: 'json',
    format(report: ScanReport, options?: { pretty?: boolean }): string {
        return JSON.stringify(report, null, options?.pretty !== false ? 2 : 0);
    },
});

// 2. Markdown Reporter
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
            lines.push(
                ``,
                `## Quality Score: ${qualityScore.compositeScore} / 100 (Grade: ${qualityScore.grade})`,
                ``,
                `| Dimension | Score | Status |`,
                `| :--- | :--- | :--- |`,
                `| Standardization | ${qualityScore.indices.standardization} | ${qualityScore.indices.standardization >= DIMENSION_PASS_MIN_SCORE ? STATUS_PASS : STATUS_WARN} |`,
                `| Security | ${qualityScore.indices.codeSecurity} | ${qualityScore.indices.codeSecurity >= DIMENSION_PASS_MIN_SCORE ? STATUS_PASS : STATUS_WARN} |`,
                `| Architecture | ${qualityScore.indices.architectureConsistency} | ${qualityScore.indices.architectureConsistency >= DIMENSION_PASS_MIN_SCORE ? STATUS_PASS : STATUS_WARN} |`,
                `| Maintainability | ${qualityScore.indices.maintainability} | ${qualityScore.indices.maintainability >= DIMENSION_PASS_MIN_SCORE ? STATUS_PASS : STATUS_WARN} |`,
                `| Performance | ${qualityScore.indices.performanceEfficiency} | ${qualityScore.indices.performanceEfficiency >= DIMENSION_PASS_MIN_SCORE ? STATUS_PASS : STATUS_WARN} |`,
            );
        }

        if (issues.length > 0) {
            lines.push(
                ``,
                `## Detected Issues (${issues.length})`,
                ``,
                `| Severity | Rule | Location | Message |`,
                `| :--- | :--- | :--- | :--- |`,
            );
            for (const it of issues.slice(0, MARKDOWN_MAX_ISSUES)) {
                lines.push(
                    `| **${it.severity.toUpperCase()}** | \`${it.rule}\` | \`${it.location.file}:${it.location.start.line}\` | ${it.message.replace(/\|/g, '\\|')} |`,
                );
            }
            if (issues.length > MARKDOWN_MAX_ISSUES) {
                lines.push(
                    `| ... | ... | ... | *[${issues.length - MARKDOWN_MAX_ISSUES} more issues truncated]* |`,
                );
            }
        }

        return lines.join('\n');
    },
});

// 3. SARIF (Static Analysis Results Interchange Format) Reporter
registerReporter({
    name: 'sarif',
    format(report: ScanReport): string {
        const sarif = {
            $schema:
                'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
            version: '2.1.0',
            runs: [
                {
                    tool: {
                        driver: {
                            name: report.tool,
                            version: report.version,
                            rules: Array.from(new Set(report.issues.map((i) => i.rule))).map(
                                (r) => ({ id: r }),
                            ),
                        },
                    },
                    results: report.issues.map((i) => ({
                        ruleId: i.rule,
                        level:
                            i.severity === 'error'
                                ? 'error'
                                : i.severity === 'warning'
                                  ? 'warning'
                                  : 'note',
                        message: { text: i.message },
                        locations: [
                            {
                                physicalLocation: {
                                    artifactLocation: { uri: i.location.file },
                                    region: {
                                        startLine: i.location.start.line,
                                        startColumn: i.location.start.column || 1,
                                    },
                                },
                            },
                        ],
                    })),
                },
            ],
        };
        return JSON.stringify(sarif, null, 2);
    },
});

// 4. SVG Badge Reporter
registerReporter({
    name: 'badge',
    format(report: ScanReport): string {
        const score = report.qualityScore
            ? Math.round(report.qualityScore.compositeScore)
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
