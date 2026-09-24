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
import { resolveConfig } from './core/config';
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

function handleTrajectoryCommand(args: string[]): void {
    const { getChangeTrajectory } = require('./api');
    const targetFile = args[args.indexOf('trajectory') + 1];
    if (!targetFile) {
        process.stderr.write('Usage: auto-refactor trajectory <file>\n');
        process.exit(2);
    }
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
        process.stdout.write(
            `  • [${new Date(r.timestamp).toISOString()}] Rev ${r.revisionId.slice(0, REVISION_ID_DISPLAY_LENGTH)} by Agent: ${r.agentUid} | Score: ${r.qualityScore?.compositeScore ?? 'N/A'}\n`,
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
        handleTrajectoryCommand(args);
        return;
    }
    if (sub === 'memory') {
        handleMemoryCommand();
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
