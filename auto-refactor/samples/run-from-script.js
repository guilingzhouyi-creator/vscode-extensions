#!/usr/bin/env node
/**
 * Script / programmatic invocation example for auto-refactor.
 *
 * Two equivalent ways to call it from a Node script (or CI step written in JS):
 *
 *   1) As a library (require the published package or dist/api.js):
 *        const { scan } = require('auto-refactor');
 *        const report = await scan({ root: './src', format: 'json' });
 *
 *   2) Run the built dist directly:
 *        const api = require('./dist/api');
 *        const report = await api.scan({ root: '..', format: 'sarif', failOnIssue: true });
 *
 * This example demonstrates the script entry point (no CLI), captures the
 * structured report, and applies a custom CI gate on error count.
 */
const path = require('path');
const api = require(path.join(__dirname, '..', 'dist', 'api'));

async function main() {
  const report = await api.scan({
    root: path.join(__dirname),                 // scan the samples/ folder
    configFile: path.join(__dirname, 'auto-refactor.config.json'),
    format: 'json',
    concurrency: 4,
    analyzerConcurrency: 1,
    logLevel: 'warn',
  });

  console.log('tool            :', report.tool, report.version);
  console.log('files scanned   :', report.summary.filesScanned);
  console.log('issues total    :', report.summary.issuesTotal);
  console.log('by severity     :', JSON.stringify(report.summary.bySeverity));
  console.log('by analyzer     :', JSON.stringify(report.summary.byAnalyzer));
  console.log('duration (ms)   :', report.summary.durationMs);

  // Example: fail the script if any error-severity issue exists.
  if (report.summary.bySeverity.error > 0) {
    console.error('CI GATE: error-severity issues found -> non-zero exit');
    process.exit(1);
  }
  console.log('CI GATE: passed');
}

main().catch((e) => {
  console.error('script failed:', e);
  process.exit(2);
});
