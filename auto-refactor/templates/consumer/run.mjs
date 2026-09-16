#!/usr/bin/env node
/**
 * Module: Consumer Runner Template — project-side ratchet wrapper for auto-refactor
 * File Path: templates/consumer/run.mjs
 * Architecture Role: Project-agnostic bridge a consuming repository copies next to its own
 *   `.auto-refactor/config.json`; it locates the engine CLI, runs a scan, applies the
 *   severity + baseline ratchet policy, and maps the outcome to a process exit code.
 * Dependencies & Triggers: Node >= 18 and the engine build (`<engine>/dist/index.js`); invoked by
 *   the project's own script or CI. Engine lookup order: `--engine` -> `$AUTO_REFACTOR_ENGINE`
 *   -> nearest ancestor directory whose package.json is named `auto-refactor`.
 * Responsibilities: Resolve engine/root/config/report/baseline paths; optionally assert that a
 *   threshold never gets two different values (global vs analyzer options); spawn the engine
 *   scan with `--baseline` plus `--fail-on-severity`; forward extra engine flags verbatim via
 *   repeatable `--engine-arg`; print a one-block summary (files, counts, suppressions,
 *   ratchet-new, skipped analyzers); refresh the baseline on demand.
 * Exit Semantics & Design Rationale: 0 = no blocking finding, 1 = blocking finding (engine
 *   verdict), 2 = usage/engine/config error. `--report-only` drops the severity gate so a
 *   consumer that maps findings into its own envelope keeps owning the verdict. A missing engine
 *   is fail-closed by default because a silently skipped scan is indistinguishable from a clean
 *   one; pass --allow-missing-engine only where the tool is genuinely optional.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FORMATS = new Set(['json', 'sarif', 'text', 'compact']);
const SEVERITIES = new Set(['info', 'warning', 'error']);

/**
 * Parse `--flag value` / `--flag` arguments into a plain options object.
 *
 * `--engine-arg` is repeatable (pass-through to the engine CLI) and also accepts the
 * `--engine-arg=value` spelling, so a project can forward flags this runner does not model.
 *
 * @param argv - Process arguments after the script name.
 * @returns Parsed options plus positional leftovers.
 */
function parseArgs(argv) {
    const opts = { _: [] };
    const repeatable = new Set(['--engine-arg']);
    const flagWithValue = new Set([
        '--root',
        '--config',
        '--engine',
        '--format',
        '--out',
        '--baseline',
        '--baseline-granularity',
        '--fail-on-severity',
        '--compare-before',
        '--compare-after',
        '--max-coupling-delta',
    ]);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const eq = arg.indexOf('=');
        const bare = eq >= 0 ? arg.slice(0, eq) : arg;
        if (repeatable.has(bare)) {
            const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
            if (value === undefined) throw new Error(`missing value for ${bare}`);
            (opts[bare.slice(2)] ??= []).push(value);
            continue;
        }
        if (flagWithValue.has(bare)) {
            const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
            if (value === undefined) throw new Error(`missing value for ${bare}`);
            opts[bare.slice(2)] = value;
        } else if (arg.startsWith('--')) {
            opts[arg.slice(2)] = true;
        } else {
            opts._.push(arg);
        }
    }
    return opts;
}

/**
 * Locate the engine CLI, preferring an explicit override over the environment and a tree walk.
 *
 * @param explicit - `--engine` value, if any.
 * @param startDir - Directory to start the ancestor walk from.
 * @returns Absolute path to the engine CLI, or null when no engine build is reachable.
 */
function findEngineCli(explicit, startDir) {
    const candidates = [];
    if (explicit) candidates.push(path.resolve(explicit));
    if (process.env.AUTO_REFACTOR_ENGINE)
        candidates.push(path.resolve(process.env.AUTO_REFACTOR_ENGINE));
    let dir = path.resolve(startDir);
    for (let depth = 0; depth < 6; depth++) {
        candidates.push(path.join(dir, 'auto-refactor'), dir);
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    for (const candidate of candidates) {
        const cli = path.join(candidate, 'dist', 'index.js');
        const pkg = path.join(candidate, 'package.json');
        if (!fs.existsSync(cli) || !fs.existsSync(pkg)) continue;
        try {
            if (JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'auto-refactor') return cli;
        } catch {
            /* unreadable package.json: keep looking */
        }
    }
    return null;
}

/**
 * Assert that every threshold declared both globally and inside an analyzer options block holds
 * the same value — two divergent sources would silently change the effective threshold.
 *
 * @param configPath - Project config to inspect.
 * @returns A list of human-readable divergences (empty when consistent).
 */
function thresholdDivergences(configPath) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const global = config.thresholds || {};
    const divergences = [];
    for (const [analyzer, decl] of Object.entries(config.analyzers || {})) {
        for (const [key, value] of Object.entries((decl && decl.options) || {})) {
            if (key in global && JSON.stringify(global[key]) !== JSON.stringify(value)) {
                divergences.push(
                    `${key}: thresholds=${JSON.stringify(global[key])} vs ${analyzer}.options=${JSON.stringify(value)}`,
                );
            }
        }
    }
    return divergences;
}

/**
 * Render the post-scan summary block from a JSON report.
 *
 * @param report - Parsed JSON scan report.
 * @returns Array of lines; empty when the shape is unexpected.
 */
function summarize(report) {
    const s = report.summary || {};
    const newIssues = (report.issues || []).filter(
        (issue) => issue.isNew && !issue.suppression,
    ).length;
    const lines = [
        `files=${s.filesScanned ?? '?'} issues=${s.issuesTotal ?? '?'} ` +
            `[error=${s.bySeverity?.error ?? '?'}, warning=${s.bySeverity?.warning ?? '?'}, info=${s.bySeverity?.info ?? '?'}] ` +
            `suppressed=${s.suppressedCount ?? 0} ratchetNew=${newIssues}`,
    ];
    if (s.disabledAnalyzers?.length) {
        lines.push(`skipped (disabled) analyzers: ${s.disabledAnalyzers.join(', ')}`);
    }
    for (const warning of s.warnings || []) lines.push(`note: ${warning}`);
    return lines;
}

function fail(message) {
    process.stderr.write(`[auto-refactor] ${message}\n`);
    process.exit(2);
}

/**
 * Run coupling gate evaluation on two versions of a source file.
 *
 * @param engineCli - Path to the engine CLI dist/index.js.
 * @param beforeFile - Path to the baseline/original source file.
 * @param afterFile - Path to the refactored source file.
 * @param maxCoupling - Optional maximum coupling delta threshold.
 */
async function runCouplingGate(engineCli, beforeFile, afterFile, maxCoupling) {
    if (!fs.existsSync(beforeFile)) fail(`compare-before file not found: ${beforeFile}`);
    if (!fs.existsSync(afterFile)) fail(`compare-after file not found: ${afterFile}`);

    const engineApi = path.join(path.dirname(engineCli), 'api.js');
    let computeIncrementalMetrics;
    if (fs.existsSync(engineApi)) {
        const mod = await import(`file://${engineApi.replace(/\\/g, '/')}`);
        computeIncrementalMetrics = mod.computeIncrementalMetrics;
    }

    if (!computeIncrementalMetrics) {
        fail('engine api missing computeIncrementalMetrics');
    }

    const oldContent = fs.readFileSync(beforeFile, 'utf8');
    const newContent = fs.readFileSync(afterFile, 'utf8');
    const metrics = computeIncrementalMetrics(oldContent, newContent, {
        maxCouplingDelta: maxCoupling ? Number(maxCoupling) : undefined,
    });

    if (metrics.verdict === 'FAILED') {
        process.stderr.write(
            `[auto-refactor] coupling-gate FAILED: ${metrics.rejectionRationale}\n`,
        );
        process.exit(1);
    }

    process.stdout.write(
        `[auto-refactor] coupling-gate PASSED: locDelta=${metrics.effectiveLocDelta}, ` +
            `couplingDelta=${metrics.couplingDelta}\n`,
    );
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (error) {
        fail(error.message);
    }

    const projectDir = path.resolve(opts.root || process.cwd());
    if (!fs.existsSync(projectDir)) fail(`project root not found: ${projectDir}`);

    // The coupling gate compares two files and reads no project config, so it must be answered BEFORE
    // the config lookup. Requiring `.auto-refactor/config.json` first made the gate unreachable in any
    // directory that has no project config yet — which is the normal shape for a CI diff check.
    if (opts['coupling-gate']) {
        const beforeFile = opts['compare-before'];
        const afterFile = opts['compare-after'];
        if (!beforeFile || !afterFile) {
            fail('--coupling-gate requires --compare-before <file> and --compare-after <file>');
        }
        const engineCli = findEngineCli(opts.engine, projectDir);
        if (!engineCli) fail('engine build not found for coupling-gate');
        await runCouplingGate(
            engineCli,
            path.resolve(projectDir, beforeFile),
            path.resolve(projectDir, afterFile),
            opts['max-coupling-delta'],
        );
        process.exit(0);
    }

    const configPath = path.resolve(
        opts.config || path.join(projectDir, '.auto-refactor', 'config.json'),
    );
    if (!fs.existsSync(configPath)) fail(`config not found: ${configPath}`);

    const format = opts.format || 'json';
    if (!FORMATS.has(format)) fail(`unsupported --format: ${format}`);
    if (opts['baseline-granularity'] && !['id', 'grouped'].includes(opts['baseline-granularity'])) {
        fail(`unsupported --baseline-granularity: ${opts['baseline-granularity']}`);
    }
    const severity = opts['fail-on-severity'] || 'warning';
    if (!SEVERITIES.has(severity)) fail(`unsupported --fail-on-severity: ${severity}`);

    if (opts['check-threshold-parity']) {
        const divergences = thresholdDivergences(configPath);
        if (divergences.length > 0) fail(`threshold divergence: ${divergences.join('; ')}`);
    }

    const engineCli = findEngineCli(opts.engine, projectDir);
    if (!engineCli) {
        if (opts['allow-missing-engine']) {
            process.stdout.write(
                '[auto-refactor] engine not found — skipped (--allow-missing-engine)\n',
            );
            process.exit(0);
        }
        fail(
            'engine build not found; pass --engine <dir>, set AUTO_REFACTOR_ENGINE, or --allow-missing-engine',
        );
    }

    const defaultBaseline = path.join(projectDir, '.auto-refactor', 'baseline.json');
    const baseline = path.resolve(opts.baseline || defaultBaseline);
    const out = path.resolve(
        opts.out || path.join(projectDir, '.auto-refactor', `report.${format}`),
    );
    fs.mkdirSync(path.dirname(out), { recursive: true });

    const args = [
        'scan',
        '--root',
        projectDir,
        '--config',
        configPath,
        '--format',
        format,
        '--out',
        out,
        // Declared on both paths: a base frozen as `grouped` must never be re-frozen as exact ids
        // (or vice versa), because the two formats are compared differently at read time.
        '--baseline-granularity',
        opts['baseline-granularity'] || 'grouped',
    ];
    if (opts['update-baseline']) {
        args.push('--update-baseline', baseline);
    } else {
        if (fs.existsSync(baseline)) args.push('--baseline', baseline);
        // `--report-only` suppresses this runner's own severity gate: the consumer inspects the
        // report and decides for itself (its exit code, not the engine's, carries the verdict).
        if (!opts['report-only']) args.push('--fail-on-severity', severity);
    }
    args.push(...(opts['engine-arg'] ?? []));

    const result = spawnSync(process.execPath, [engineCli, ...args], { stdio: 'inherit' });
    if (result.error) fail(`failed to spawn engine: ${result.error.message}`);
    const code = result.status ?? 2;
    if (code === 0 && opts['update-baseline']) {
        process.stdout.write(`[auto-refactor] baseline written: ${baseline}\n`);
    }

    if (!opts.quiet && format === 'json' && fs.existsSync(out)) {
        try {
            for (const line of summarize(JSON.parse(fs.readFileSync(out, 'utf8')))) {
                process.stdout.write(`[auto-refactor] ${line}\n`);
            }
            process.stdout.write(`[auto-refactor] report: ${out}\n`);
        } catch {
            /* non-fatal: the engine verdict is already the source of truth */
        }
    }
    process.exit(code);
}

await main();
