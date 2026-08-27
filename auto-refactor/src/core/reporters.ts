import { ScanReport, Issue, Severity, OutputFormat } from './types';

const SARIF_LEVEL: Record<Severity, string> = {
  info: 'note',
  warning: 'warning',
  error: 'error',
};

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

export function toJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}

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
      lines.push(`  [${it.severity.toUpperCase()}] ${it.analyzer}/${it.rule} @${loc} — ${it.message}`);
      if (it.suggestion) lines.push(`      ↳ ${it.suggestion}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** SARIF 2.1.0 output, compatible with GitHub code scanning and other CI dashboards. */
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
            informationUri: 'https://github.com/guilingzhouyi-creator/vscode-extensions',
            rules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}
