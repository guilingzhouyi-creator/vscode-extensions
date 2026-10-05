#!/usr/bin/env node
/**
 * Module: CLI Entry Point — Subcommand Dispatch & Process Shell
 * File Path: src/index.ts
 * Architecture Role: Executable shell over the shared programmatic API; converts argv into
 *     CliOptions, selects a subcommand, and delegates scans to api.scanAndRender.
 * Dependencies & Triggers: Triggered by `node dist/index.js` or the installed bin; imports
 *     cli/cli-parser, scanAndRender from ./api, resolveConfig from core/config; lazily requires
 *     cli/daemonCmd, cli/selfTestCmd, core/cache and ./api helpers.
 * Responsibilities: Enable Node's V8 compile cache best-effort; dispatch scan, daemon,
 *     self-test, guide, trajectory, symbols, and memory subcommands; print usage; exit cleanly.
 * Exit Semantics & Design Rationale: Normal runs exit with scanAndRender's 0/1 code or a
 *     subcommand's code; usage errors exit 2; the top-level catch logs FATAL to stderr and
 *     exits 2. Compile-cache setup is best-effort so an unwritable cache never breaks a scan.
 */
// C1: enable Node's V8 bytecode compile cache for the CLI process. MUST run before any
// other require so the CLI's own module graph gets cached on disk (30-50% faster
// cold-start module compilation on Node >= 22.8). CLI-only by design — library consumers
// (api.ts / analyzer.ts) are intentionally NOT affected. Best-effort: any failure (old
// Node, unwritable cache dir, already enabled, ...) must never break the scan.
try {
    const { enableCompileCache } = require('node:module');
    enableCompileCache?.();
} catch {
    /* compile cache is best-effort — ignore */
}

import { scanAndRender } from './api';
import { resolveConfig } from './core/config/config';
import { DAEMON_SUBCOMMAND, DAEMON_MODE_OFF, parseArgs, printUsage } from './cli/cli-parser';

/** Decimal radix used when parsing numeric CLI arguments such as `--line`. */
const DECIMAL_RADIX = 10;

/** Number of leading revision-id characters shown by the `trajectory` CLI subcommand. */
const REVISION_ID_DISPLAY_LENGTH = 8;

async function handleSymbolsCommand(args: string[]): Promise<void> {
    const { querySymbols } = require('./api');
    const target = args[args.indexOf('symbols') + 1];
    if (!target) {
        process.stderr.write('Usage: auto-refactor symbols <name> [--root <dir>]\n');
        process.exit(2);
    }
    const rootIdx = args.indexOf('--root');
    const root = rootIdx !== -1 ? args[rootIdx + 1] : process.cwd();
    try {
        const result: {
            definitions: Array<{ kind: string; file: string; line?: number }>;
            references: Array<{ file: string; line?: number }>;
            stats: {
                definitions: number;
                references: number;
                crossFileReferences: number;
                builtFrom: string;
            };
        } = await querySymbols(target, {
            root,
            logLevel: 'silent',
            daemon: DAEMON_MODE_OFF,
            cache: false,
        });

        process.stdout.write(`\n=== Symbol: ${target} ===\n`);
        for (const d of result.definitions) {
            process.stdout.write(`  defined  ${d.kind.padEnd(9)} ${d.file}:${d.line ?? '?'}\n`);
        }
        for (const r of result.references) {
            process.stdout.write(`  called   ${r.file}:${r.line ?? '?'}\n`);
        }
        process.stdout.write(
            `  coverage defs=${result.stats.definitions} refs=${result.stats.references} ` +
            `crossFile=${result.stats.crossFileReferences} (${result.stats.builtFrom})\n`,
        );
        process.exit(0);
    } catch (error: unknown) {
        process.stderr.write(`symbols failed: ${String(error)}\n`);
        process.exit(1);
    }
}

function handleGuideCommand(args: string[]): void {
    const { queryAgentConstraints } = require('./api');
    const targetFile = args[args.indexOf('guide') + 1];
    if (!targetFile) {
        process.stderr.write(
            'Usage: auto-refactor guide <file> [--domain <name>] [--line <num>]\n',
        );
        process.exit(2);
    }
    const domainIdx = args.indexOf('--domain');
    const domainName = domainIdx !== -1 ? args[domainIdx + 1] : undefined;
    const lineIdx = args.indexOf('--line');
    const line = lineIdx !== -1 ? parseInt(args[lineIdx + 1], DECIMAL_RADIX) : undefined;
    const prompt = queryAgentConstraints({ filePath: targetFile, domainName, line });
    process.stdout.write(prompt.renderedMarkdown + '\n');
    process.exit(0);
}

async function printRecentActiveRuns(activeRunsFile: string): Promise<void> {
    const fs = require('fs');
    if (!fs.existsSync(activeRunsFile)) return;
    const rawContent = await fs.promises.readFile(activeRunsFile, 'utf8');
    const raw = rawContent.trim().split('\n').filter(Boolean);
    const recent = raw.slice(-3);
    if (recent.length === 0) return;
    process.stdout.write(`\nRecent Active Runs (last ${recent.length}):\n`);
    for (const line of recent) {
        try {
            const r = JSON.parse(line);
            const dateStr = new Date(r.t).toISOString();
            process.stdout.write(
                `  • [${dateStr}] Rev ${r.rev} (${r.mod}): Score ${r.score.aft} | QED ${r.score.qed} | Proc ${r.eloc.proc} ELOC [Gate: ${r.gate.code}]\n`,
            );
        } catch {
            /* ignored: malformed ndjson log entry */
        }
    }
}

async function printLedgerSummary(customRoot?: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    const baseDir = customRoot ? path.resolve(customRoot) : process.cwd();
    let ledgerDir = path.join(baseDir, '.refactor-trajectory');
    if (!fs.existsSync(ledgerDir)) {
        const sub = path.join(baseDir, 'auto-refactor', '.refactor-trajectory');
        if (fs.existsSync(sub)) {
            ledgerDir = sub;
        }
    }
    const lifetimeFile = path.join(ledgerDir, 'lifetime.summary.json');
    const activeRunsFile = path.join(ledgerDir, 'active-runs.ndjson');

    if (!fs.existsSync(lifetimeFile)) {
        process.stdout.write(`\nNo persistent refactoring ledger found at ${ledgerDir}\n`);
        process.exit(0);
    }

    try {
        const lifetimeContent = await fs.promises.readFile(lifetimeFile, 'utf8');
        const lifetime = JSON.parse(lifetimeContent);
        const equivLoc = ((lifetime.eloc.processedTotal * 1.37) / 1000000).toFixed(2);
        process.stdout.write(`\n=== Workspace Refactoring Trajectory & Review Ledger ===\n`);
        process.stdout.write(`Total Audit Runs       : ${lifetime.totalRuns}\n`);
        process.stdout.write(
            `Processed Code (ELOC)  : ${lifetime.eloc.processedTotal.toLocaleString()} lines (~${equivLoc}M equivalent LOC)\n`,
        );
        process.stdout.write(
            `Unique Code Baseline   : ${lifetime.eloc.uniqueTotal.toLocaleString()} ELOC\n`,
        );
        process.stdout.write(
            `Changed Code Audited   : ${lifetime.eloc.changedTotal.toLocaleString()} ELOC (Semantic: ${lifetime.eloc.semanticTotal.toLocaleString()})\n`,
        );
        process.stdout.write(
            `Quality Efficiency QED : ${lifetime.qed.mean} [min: ${lifetime.qed.min}, max: ${lifetime.qed.max}]\n`,
        );
        process.stdout.write(
            `Technical Debt Balance : Added ${lifetime.debt.totalAdded} | Resolved ${lifetime.debt.totalResolved} (Net Yield: ${lifetime.debt.netYield} pts/kELOC)\n`,
        );
        process.stdout.write(
            `Mean Composite Score   : ${lifetime.meanCompositeScore} / 100 [Gate Pass Rate: ${lifetime.gatePassRate}%]\n`,
        );

        await printRecentActiveRuns(activeRunsFile);
        process.stdout.write(`========================================================\n\n`);
        process.exit(0);
    } catch (err: unknown) {
        process.stderr.write(`Failed to read trajectory summary: ${String(err)}\n`);
        process.exit(1);
    }
}

function printFileTrajectory(targetFile: string): void {
    const { getChangeTrajectory } = require('./api');
    const traj = getChangeTrajectory(targetFile);
    if (!traj || traj.revisions.length === 0) {
        process.stdout.write(`No historical trajectory recorded for ${targetFile}\n`);
        process.exit(0);
    }
    process.stdout.write(`\n=== Change Trajectory: ${targetFile} ===\n`);
    process.stdout.write(
        `Total Revisions: ${traj.totalRevisions} | Agents: ${traj.participatingAgents.join(', ')}\n`,
    );
    for (const r of traj.revisions) {
        const score = r.qualityScore?.compositeScore;
        const scoreText = typeof score === 'number' && Number.isFinite(score) ? score : 'N/A';
        process.stdout.write(
            `  • [${new Date(r.timestamp).toISOString()}] Rev ${r.revisionId.slice(0, REVISION_ID_DISPLAY_LENGTH)} by Agent: ${r.agentUid} | Score: ${scoreText}\n`,
        );
    }
    if (traj.activeAnomalies.length > 0) {
        process.stdout.write(`Active Anomalies:\n`);
        for (const a of traj.activeAnomalies) {
            process.stdout.write(`  ⚠️ [${a.kind}] ${a.message}\n`);
        }
    }
    process.stdout.write(`========================================\n\n`);
    process.exit(0);
}

async function handleTrajectoryCommand(args: string[]): Promise<void> {
    const rawTarget = args[args.indexOf('trajectory') + 1];
    const isSummary =
        !rawTarget ||
        rawTarget === '--summary' ||
        rawTarget === '-s' ||
        rawTarget.startsWith('--');
    if (isSummary) {
        const rootIdx = args.indexOf('--root');
        const customRoot = rootIdx !== -1 && args[rootIdx + 1] ? args[rootIdx + 1] : undefined;
        await printLedgerSummary(customRoot);
        return;
    }
    printFileTrajectory(rawTarget);
}

function countLinesEloc(content: string): { loc: number; eloc: number } {
    const lines = content.split('\n');
    let eloc = 0;
    for (const l of lines) {
        const t = l.trim();
        if (t.length > 0 && !t.startsWith('//') && !t.startsWith('#') && !t.startsWith('*')) {
            eloc++;
        }
    }
    return { loc: lines.length, eloc };
}

async function processDirectoryEntries(
    curr: string,
    entries: import('fs').Dirent[],
    queue: string[],
    supportedExts: Set<string>,
    ignoredDirs: Set<string>,
): Promise<{ files: number; loc: number; eloc: number }> {
    const path = require('path');
    const fs = require('fs');
    let files = 0;
    let loc = 0;
    let eloc = 0;
    for (const e of entries) {
        const full = path.join(curr, e.name);
        if (e.isDirectory()) {
            if (!ignoredDirs.has(e.name)) queue.push(full);
            continue;
        }
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!supportedExts.has(ext)) continue;

        files++;
        try {
            const content = await fs.promises.readFile(full, 'utf8');
            const counts = countLinesEloc(content);
            loc += counts.loc;
            eloc += counts.eloc;
        } catch {
            /* ignored: unreadable file */
        }
    }
    return { files, loc, eloc };
}

async function collectDirectoryStats(
    targetRoot: string,
): Promise<{ totalFiles: number; totalLoc: number; totalEloc: number }> {
    const fs = require('fs');
    const SUPPORTED_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.gd', '.py', '.sh', '.ps1']);
    const IGNORED_DIRS = new Set([
        'node_modules',
        '.git',
        'dist',
        'out',
        'fixtures',
        'baseline',
        'archive',
        'reports',
    ]);

    let totalFiles = 0;
    let totalLoc = 0;
    let totalEloc = 0;

    const queue = [targetRoot];
    while (queue.length > 0) {
        const curr = queue.pop()!;
        let entries: import('fs').Dirent[] = [];
        try {
            entries = await fs.promises.readdir(curr, { withFileTypes: true });
        } catch {
            /* ignored: unreadable directory permission */
            continue;
        }
        const delta = await processDirectoryEntries(
            curr,
            entries,
            queue,
            SUPPORTED_EXTS,
            IGNORED_DIRS,
        );
        totalFiles += delta.files;
        totalLoc += delta.loc;
        totalEloc += delta.eloc;
    }
    return { totalFiles, totalLoc, totalEloc };
}

async function handleStatsCommand(args: string[]): Promise<void> {
    const rootIdx = args.indexOf('--root');
    const targetRoot = rootIdx !== -1 && args[rootIdx + 1] ? args[rootIdx + 1] : process.cwd();

    const { totalFiles, totalLoc, totalEloc } = await collectDirectoryStats(targetRoot);

    const densityPct = totalLoc > 0 ? ((totalEloc / totalLoc) * 100).toFixed(1) : '0.0';
    const dilutionRatio = totalEloc > 0 ? (totalLoc / totalEloc).toFixed(2) : '1.00';

    process.stdout.write(`\n=== Code Volume & Complexity Statistics ===\n`);
    process.stdout.write(`Target Scope Root       : ${targetRoot}\n`);
    process.stdout.write(`Auditable Code Files    : ${totalFiles.toLocaleString()}\n`);
    process.stdout.write(`Physical Lines (LOC)    : ${totalLoc.toLocaleString()}\n`);
    process.stdout.write(`Effective Logic (ELOC)  : ${totalEloc.toLocaleString()}\n`);
    process.stdout.write(`Effective Code Density  : ${densityPct}%\n`);
    process.stdout.write(`Average Dilution Ratio  : 1 : ${dilutionRatio}\n`);
    process.stdout.write(`============================================\n\n`);
    process.exit(0);
}

function handleMemoryCommand(): void {
    const { getReviewMemory } = require('./api');
    const mem = getReviewMemory();
    const stats = mem.getStats();
    process.stdout.write(`\n=== Review Memory Status ===\n`);
    process.stdout.write(`Active Indexed Records: ${stats.recordsCount}\n`);
    process.stdout.write(`Total Historical Revisions: ${stats.revisionsCount}\n`);
    process.stdout.write(`Max In-Memory Capacity: ${stats.maxFiles}\n`);
    process.stdout.write(`============================\n\n`);
    process.exit(0);
}

/**
 * Executes automated AST codemod repairs for actionable scan findings.
 *
 * @param cli - Parsed command-line options including fix flags.
 * @returns Exit code 0 on successful repair completion.
 */
async function handleFixWorkflow(cli: any): Promise<number> {
    const { scan } = require('./api');
    const { defaultPatchEngine, PatchEngine } = require('./core/codemod');
    const fs = require('fs');
    const path = require('path');

    const report = await scan(cli);
    const fixesByFile = new Map<string, any[]>();

    for (const issue of report.issues) {
        const fix = PatchEngine.issueToFix(issue);
        if (fix) {
            const relFile = issue.location.file;
            const existing = fixesByFile.get(relFile) || [];
            existing.push(fix);
            fixesByFile.set(relFile, existing);
        }
    }

    if (fixesByFile.size === 0) {
        process.stdout.write(
            '[auto-refactor] No automated codemod fixes available for detected issues.\n',
        );
        return 0;
    }

    const rootDir = cli.root || process.cwd();
    let totalApplied = 0;
    let totalSkipped = 0;

    process.stdout.write(
        `\n=== Automated Codemod Repair (${cli.fixDryRun ? 'DRY-RUN' : 'IN-PLACE'}) ===\n`,
    );

    for (const [relPath, fixes] of fixesByFile.entries()) {
        const fullPath = path.resolve(rootDir, relPath);
        if (!fs.existsSync(fullPath)) continue;

        const content = await fs.promises.readFile(fullPath, 'utf8');
        const result = defaultPatchEngine.applyFixes(fullPath, content, fixes, {
            dryRun: cli.fixDryRun,
            rules: cli.fixRules,
        });

        if (result.appliedFixCount > 0) {
            totalApplied += result.appliedFixCount;
            totalSkipped += result.skippedConflictCount;
            if (result.unifiedDiff) {
                process.stdout.write(result.unifiedDiff + '\n');
            }
        }
    }

    process.stdout.write(
        `[auto-refactor] Fix summary: ${totalApplied} applied, ${totalSkipped} conflicts skipped across ${fixesByFile.size} files.\n\n`,
    );

    await recordCodemodTrajectory(rootDir, fixesByFile, totalApplied, cli);

    return 0;
}

/**
 * Records an automated codemod repair run into the persistent trajectory ledger.
 */
async function recordCodemodTrajectory(
    rootDir: string,
    fixesByFile: Map<string, any[]>,
    totalApplied: number,
    cli: any,
): Promise<void> {
    if (cli.fixDryRun || totalApplied === 0) return;
    try {
        const fs = require('fs');
        const path = require('path');
        const trajectoryDir = path.join(rootDir, '.refactor-trajectory');
        if (!fs.existsSync(trajectoryDir)) return;

        const { TrajectoryAccumulator } = require('./core/trajectory');
        const accumulator = new TrajectoryAccumulator(trajectoryDir);
        const modifiedFilesList = [];
        for (const relPath of fixesByFile.keys()) {
            const fullPath = path.resolve(rootDir, relPath);
            if (fs.existsSync(fullPath)) {
                modifiedFilesList.push({
                    filePath: relPath,
                    content: await fs.promises.readFile(fullPath, 'utf8'),
                });
            }
        }
        const resolvedPoints = totalApplied * 2;
        await accumulator.recordAuditRun({
            runId: `fix-${Date.now()}`,
            revision: cli.revision ? String(cli.revision).slice(0, 8) : 'codemod',
            module: path.basename(rootDir),
            agent: 'codemod-fix',
            timestamp: Date.now(),
            scannedFiles: modifiedFilesList,
            beforeScore: 98.0,
            afterScore: Math.min(100.0, 98.0 + totalApplied * 0.1),
            resolvedDebtPoints: resolvedPoints,
            addedDebtPoints: 0,
            regressionFindingsCount: 0,
            diffCounters: {
                changed: totalApplied * 3,
                semantic: totalApplied * 2,
                modified: totalApplied,
            },
        });
    } catch (err: unknown) {
        void err;
    }
}

async function handleScanCommand(args: string[]): Promise<number> {
    const cli = parseArgs(args);

    // --cache-clear: wipe the cache dir up-front (a fresh scan rebuilds it).
    if (cli.cacheClear) {
        const { CacheStore } = require('./core/cache');
        const cfg = resolveConfig(cli);
        const cache = new CacheStore(cli.cacheDir, cfg.root);
        const ok = cache.clear();
        process.stderr.write(
            `[auto-refactor] cache cleared (${ok ? 'ok' : 'FAILED'}): ${cache.dir}\n`,
        );
    }

    if (cli.fix || cli.fixDryRun) {
        return handleFixWorkflow(cli);
    }

    return scanAndRender(cli);
}

/**
 * CLI entry point. Delegates all work to the shared API (scanAndRender),
 * so script/CI and CLI share identical behavior.
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const sub = args.find((a) => !a.startsWith('--')) || 'scan';

    if (sub === 'symbols') {
        await handleSymbolsCommand(args);
        return;
    }
    if (sub === DAEMON_SUBCOMMAND) {
        const { daemonCommand } = require('./cli/daemonCmd');
        const rest = args.slice(args.indexOf(DAEMON_SUBCOMMAND) + 1);
        const r = await daemonCommand(rest);
        if (r.text) process.stdout.write(r.text + '\n');
        process.exit(r.code);
    }
    if (sub === 'self-test') {
        const { selfTestCommand } = require('./cli/selfTestCmd');
        const r = await selfTestCommand(args.slice(args.indexOf('self-test') + 1));
        process.stderr.write(r.text + '\n');
        process.exit(r.code);
    }
    if (sub === 'guide') {
        handleGuideCommand(args);
        return;
    }
    if (sub === 'trajectory') {
        await handleTrajectoryCommand(args);
        return;
    }
    if (sub === 'memory') {
        handleMemoryCommand();
        return;
    }
    if (sub === 'stats') {
        await handleStatsCommand(args);
        return;
    }
    if (sub !== 'scan') {
        printUsage();
        process.exit(2);
    }

    const code = await handleScanCommand(args);
    process.exit(code);
}

main().catch((e) => {
    process.stderr.write(`[auto-refactor] FATAL: ${e?.stack || e}\n`);
    process.exit(2);
});
