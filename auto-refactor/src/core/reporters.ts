/**
 * Module: Core Engine — Report Rendering & Output Formats
 * File Path: src/core/reporters.ts
 * Architecture Role: Stateless output boundary that turns a ScanReport into the CLI/CI
 *     formats (text, JSON, SARIF 2.1.0); imported by api.ts render()/Scanner.
 * Dependencies & Triggers: ./types (ScanReport, Issue, Severity, OutputFormat); invoked when
 *     the scan CLI or API requests a format; SARIF targets GitHub code-scanning dashboards.
 * Responsibilities: Dispatch by OutputFormat; build the text summary (version, root,
 *     generatedAt, per-severity/per-analyzer counts) and group issues by file; pretty-print
 *     JSON; emit SARIF runs with rule ids, level mapping, locations and detail properties.
 * Exit Semantics & Design Rationale: Pure string-returning functions that never throw for a
 *     well-formed ScanReport; unknown formats fall back to text, and an empty report returns
 *     the "No issues found." summary so CLI output stays printable in every case.
 */

import type { ScanReport, Issue, Severity, OutputFormat } from './types';

const SARIF_LEVEL: Record<Severity, string> = {
    info: 'note',
    warning: 'warning',
    error: 'error',
};

/**
 * Render a scan report in the requested output format.
 *
 * Dispatch is a pure switch with a text default, so an unknown or missing format degrades to
 * human-readable text instead of throwing and breaking the CLI's output stream.
 *
 * @param report - Complete scan result to serialize; its summary and issues are assumed to be
 *   well-formed and are never mutated.
 * @param format - Requested wire format (`json`, `sarif` or `text`); any other value selects
 *   the text renderer.
 * @returns The rendered report string in the selected format.
 */
export function render(report: ScanReport, format: OutputFormat): string {
    switch (format) {
        case 'json':
            return toJson(report);
        case 'sarif':
            return toSarif(report);
        case 'text':
        default:
            return toText(report);
    }
}

/**
 * Serialize a scan report as pretty-printed JSON.
 *
 * @param report - Report object to serialize; scan reports are plain acyclic data, which is
 *   what keeps this lossless round-trip safe.
 * @returns Two-space-indented JSON matching the report schema; property order follows the
 *   in-memory object rather than the schema.
 * @throws TypeError when `report` contains a circular reference, because `JSON.stringify`
 *   cannot serialize cycles; well-formed scan reports never do.
 */
export function toJson(report: ScanReport): string {
    return JSON.stringify(report, null, 2);
}

/**
 * Render a human-readable summary followed by the issues grouped by file.
 *
 * The header always carries version, root and generatedAt plus per-severity and per-analyzer
 * totals; when the report holds no issues the body collapses to a single "No issues found."
 * line, so CLI consumers always receive printable output.
 *
 * @param report - Scan result to format; only `summary`, `issues` and the header fields are
 *   read, so extra properties are ignored.
 * @returns A newline-joined plain-text block; each issue contributes one severity line and an
 *   optional indented suggestion line, with a blank line closing every file group.
 */
export function toText(report: ScanReport): string {
    const lines: string[] = [];
    lines.push(`auto-refactor v${report.version}`);
    lines.push(`root: ${report.root}`);
    lines.push(`generatedAt: ${report.generatedAt}`);
    lines.push('');
    lines.push(
        `Scanned ${report.summary.filesScanned} file(s); ${report.summary.issuesTotal} issue(s) ` +
            `[error=${report.summary.bySeverity.error}, warning=${report.summary.bySeverity.warning}, info=${report.summary.bySeverity.info}]`,
    );
    for (const [a, c] of Object.entries(report.summary.byAnalyzer)) {
        lines.push(`  analyzer ${a}: ${c} issue(s)`);
    }
    if (report.summary.disabledAnalyzers && report.summary.disabledAnalyzers.length > 0) {
        lines.push(
            `  skipped (disabled) analyzers: ${report.summary.disabledAnalyzers.join(', ')}`,
        );
    }
    for (const warning of report.summary.warnings ?? []) {
        lines.push(`  note: ${warning}`);
    }
    lines.push('');

    if (report.issues.length === 0) {
        lines.push('No issues found.');
        return lines.join('\n');
    }

    // group by file
    const byFile = new Map<string, Issue[]>();
    for (const it of report.issues) {
        const arr = byFile.get(it.location.file) || [];
        arr.push(it);
        byFile.set(it.location.file, arr);
    }

    for (const [file, items] of byFile) {
        lines.push(`■ ${file}`);
        for (const it of items) {
            const loc = `${it.location.start.line}:${it.location.start.column}`;
            lines.push(
                `  [${it.severity.toUpperCase()}] ${it.analyzer}/${it.rule} @${loc} — ${it.message}`,
            );
            if (it.suggestion) lines.push(`      ↳ ${it.suggestion}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

/**
 * SARIF 2.1.0 output, compatible with GitHub code scanning and other CI dashboards.
 *
 * Rule descriptors are de-duplicated by `${analyzer}.${rule}` id, severities are mapped to
 * SARIF levels (info to note), and every issue becomes a result with a physical location plus
 * the analyzer detail payload attached as properties for annotation consumers.
 *
 * @param report - Scan result to convert; `issues` drive both the rule list and the results.
 * @returns The SARIF document as two-space-indented JSON, ready to upload as a build artifact.
 */
export function toSarif(report: ScanReport): string {
    const ruleIds = new Set<string>();
    for (const it of report.issues) ruleIds.add(`${it.analyzer}.${it.rule}`);

    const rules = [...ruleIds].map((id) => ({
        id,
        name: id,
        shortDescription: { text: id },
    }));

    const results = report.issues.map((it) => ({
        ruleId: `${it.analyzer}.${it.rule}`,
        level: SARIF_LEVEL[it.severity],
        message: { text: it.message + (it.suggestion ? ` Suggestion: ${it.suggestion}` : '') },
        properties: { analyzer: it.analyzer, detail: it.detail },
        locations: [
            {
                physicalLocation: {
                    artifactLocation: { uri: it.location.file },
                    region: {
                        startLine: it.location.start.line,
                        startColumn: it.location.start.column,
                        endLine: it.location.end.line,
                        endColumn: it.location.end.column,
                    },
                },
            },
        ],
    }));

    const sarif = {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
            {
                tool: {
                    driver: {
                        name: 'auto-refactor',
                        version: report.version,
                        informationUri:
                            'https://github.com/guilingzhouyi-creator/vscode-extensions',
                        rules,
                    },
                },
                results,
            },
        ],
    };
    return JSON.stringify(sarif, null, 2);
}
