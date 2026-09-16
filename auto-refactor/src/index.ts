#!/usr/bin/env node
/**
 * Module: CLI Entry Point — Argument Parsing, Subcommand Dispatch & Cache Bootstrap
 * File Path: src/index.ts
 * Architecture Role: Executable shell over the shared programmatic API; converts argv into
 *     CliOptions, selects a subcommand, and delegates scans to api.scanAndRender.
 * Dependencies & Triggers: Triggered by `node dist/index.js` or the installed bin; imports
 *     scanAndRender/ScanOptions from ./api, resolveConfig from core/config and LogLevel from
 *     core/types; lazily requires cli/daemonCmd, cli/selfTestCmd, core/cache and ./api helpers.
 * Responsibilities: Enable Node's V8 compile cache best-effort; parse --key value/--key=value,
 *     boolean and list flags; dispatch scan, daemon, self-test, guide, trajectory and memory
 *     subcommands; print usage; optionally clear the cache; forward the scan exit code.
 * Exit Semantics & Design Rationale: Normal runs exit with scanAndRender's 0/1 code or a
 *     subcommand's code; usage errors exit 2; the top-level catch logs FATAL to stderr and
 *     exits 2. Compile-cache setup is best-effort so an unwritable cache never breaks a scan,
 *     and lazy requires keep default CLI boot off the daemon/child_process module graph.
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
import type { ScanOptions } from './api';
import { scanAndRender } from './api';
import { resolveConfig } from './core/config';
import type { LogLevel } from './core/types';
// NOTE: daemonCommand / CacheStore are required lazily in main() — the default CLI path
// must not pay for the daemon module graph (net, child_process) at boot.

/** Decimal radix used when parsing numeric CLI arguments such as `--line`. */
const DECIMAL_RADIX = 10;

/** Number of leading revision-id characters shown by the `trajectory` CLI subcommand. */
const REVISION_ID_DISPLAY_LENGTH = 8;

/** Boolean `--daemon` CLI flag name opting into daemon auto-start. */
const DAEMON_FLAG = 'daemon';

/** `daemon` subcommand name dispatched to cli/daemonCmd in main(). */
const DAEMON_SUBCOMMAND = 'daemon';

/** Daemon mode value disabling daemon probing and auto-start (`--no-daemon`). */
const DAEMON_MODE_OFF = 'off';

/** Comment-level value disabling comment governance checks. */
const COMMENT_LEVEL_OFF = 'off';

/** Security-level value disabling security analysis. */
const SECURITY_LEVEL_OFF = 'off';

interface CliOptions extends ScanOptions {
    out?: string;
    cacheClear?: boolean;
}

/** Minimal argv parser: supports `--key value`, `--key=value`, and repeated `--include`. */
function parseArgs(argv: string[]): CliOptions {
    const opt: CliOptions = { cache: true, daemon: 'auto' };
    const listFlags = new Set(['include', 'exclude']);
    // Valueless (boolean) flag: defaults to true; it takes a value only for an explicit
    // `=false` or a directly following standalone `true|false` token.
    // A valueless flag must not unconditionally swallow the next token: previously
    // `--fail-on-issue --format json` consumed `--format` as a boolean value and silently
    // dropped `json` as a bare argument, losing the output-format configuration.
    const boolFlags = new Set([
        'fail-on-issue',
        'fail-on-analyzer-error',
        'respect-gitignore',
        'cache',
        DAEMON_FLAG,
        'diff',
        'auto-tune',
        'profile',
        'score',
        'memory',
    ]);

    for (let i = 0; i < argv.length; i++) {
        let arg = argv[i];
        if (!arg.startsWith('--')) continue;
        arg = arg.slice(2);

        let value = '';
        let hasInline = false;
        if (arg.includes('=')) {
            [arg, value] = arg.split('=', 2);
            hasInline = true;
        }

        if (boolFlags.has(arg)) {
            let enabled = true;
            if (hasInline) {
                enabled = value !== 'false';
            } else {
                const nxt = argv[i + 1];
                // Consume the next token only for an explicit boolean (`--cache false`);
                // otherwise treat the flag as enabled.
                if (nxt === 'true' || nxt === 'false') {
                    enabled = nxt !== 'false';
                    i++;
                }
            }
            if (arg === 'fail-on-issue') opt.failOnIssue = enabled;
            else if (arg === 'fail-on-analyzer-error') opt.failOnAnalyzerError = enabled;
            else if (arg === 'respect-gitignore') opt.respectGitignore = enabled;
            else if (arg === 'cache') opt.cache = enabled;
            else if (arg === DAEMON_FLAG) opt.daemon = enabled ? 'on' : DAEMON_MODE_OFF;
            else if (arg === 'diff') opt.diff = enabled;
            else if (arg === 'auto-tune') opt.autoTuneScale = enabled;
            else if (arg === 'profile') opt.showProfile = enabled;
            else if (arg === 'score') opt.showScore = enabled;
            else if (arg === 'memory') opt.memory = enabled;
            continue;
        }

        // Value-taking flag: `--key=value` wins; otherwise consume the next token, which
        // must not itself be another flag.
        const takeValue = (): string => {
            if (hasInline) return value;
            const nxt = argv[i + 1];
            if (nxt === undefined || nxt.startsWith('--')) return '';
            i++;
            return nxt;
        };

        if (listFlags.has(arg)) {
            const v = takeValue();
            (opt as any)[arg] = (opt as any)[arg]
                ? [
                      ...(opt as any)[arg],
                      ...v
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                  ]
                : v
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
        } else if (arg === 'analyzers') {
            opt.analyzers = takeValue()
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        } else if (arg === 'fail-on-severity') {
            // Leveled gate: info|warning|error — generalizes failOnIssue by blocking at a
            // severity threshold.
            const v = takeValue();
            if (v === 'info' || v === 'warning' || v === 'error') opt.failOnSeverity = v;
        } else if (arg === 'baseline-granularity') {
            // Ratchet comparison granularity: id (exact issue id, line-number sensitive) |
            // grouped (analyzer|rule|file counts, immune to line drift).
            const v = takeValue();
            if (v === 'id' || v === 'grouped') opt.baselineGranularity = v;
        } else if (arg === 'format') {
            opt.format = takeValue() as any;
        } else if (arg === 'log-level') {
            opt.logLevel = takeValue() as LogLevel;
        } else if (arg === 'log-file') {
            opt.logFile = takeValue();
        } else if (arg === 'concurrency') {
            opt.concurrency = Number(takeValue());
        } else if (arg === 'workers') {
            opt.workers = Number(takeValue());
        } else if (arg === 'out') {
            opt.out = takeValue();
        } else if (arg === 'parser') {
            opt.parser = takeValue() === 'oxc' ? 'oxc' : 'typescript';
        } else if (arg === 'root') {
            opt.root = takeValue();
        } else if (arg === 'config') {
            opt.configFile = takeValue();
        } else if (arg === 'baseline') {
            opt.baseline = takeValue();
        } else if (arg === 'update-baseline') {
            opt.updateBaseline = takeValue();
        } else if (arg === 'no-cache') {
            opt.cache = false;
        } else if (arg === 'cache-dir') {
            opt.cacheDir = takeValue();
        } else if (arg === 'cache-clear') {
            opt.cacheClear = true;
        } else if (arg === 'cache-custom') {
            opt.cacheCustom = true;
        } else if (arg === 'no-daemon') {
            opt.daemon = DAEMON_MODE_OFF;
        } else if (arg === 'comment-level') {
            const v = takeValue();
            if (v === COMMENT_LEVEL_OFF || v === 'basic' || v === 'standard' || v === 'strict') {
                opt.commentLevel = v;
            }
        } else if (arg === 'security-level') {
            const v = takeValue();
            if (v === SECURITY_LEVEL_OFF || v === 'basic' || v === 'full') {
                opt.securityLevel = v;
            }
        } else if (arg === 'agent-uid') {
            opt.agentUid = takeValue();
        } else if (arg === 'no-memory') {
            opt.memory = false;
        } else if (arg === 'help' || arg === 'h') {
            printUsage();
            process.exit(0);
        }
    }
    return opt;
}

function printUsage(): void {
    process.stdout
        .write(`auto-refactor — automated code-refactoring analyzer (declarative, pluggable)

Usage:
  auto-refactor scan [options]
  auto-refactor self-test            Run a known-violation fixture corpus and assert every
                                     built-in analyzer still fires (engine quality guard)
  auto-refactor daemon start|stop|status [--root <dir>]

Options:
  --root <dir>                 Root directory to scan (default: cwd)
  --include <glob>            Include glob (repeatable / comma-separated)
  --exclude <glob|dir>        Exclude glob or directory name (repeatable)
  --analyzers <a,b,c>         Allow-list by name (built-in or custom). Declared but
                              unlisted analyzers are disabled for this run.
  --format <json|sarif|text>  Output format (default: text)
  --out <file>                Write report to a file instead of stdout
  --fail-on-issue             Exit non-zero if any 'error' issue (CI gate)
  --fail-on-severity <lvl>    Exit non-zero if any issue >= lvl (info|warning|error); with a
                              baseline, applies to NEW issues only (generalizes --fail-on-issue)
  --baseline-granularity <g>  Baseline ratchet comparison: id (exact issue id) | grouped
                              (analyzer|rule|file counts — tolerant to line shifts)
  --fail-on-analyzer-error    Treat analyzer crashes as 'error' (can fail CI)
  --config <file>             Path to auto-refactor.config.json (declarative registry)
  --log-level <lvl>           silent|error|warn|info|debug (default: info; stderr)
  --log-file <file>           Also append logs to this file
  --concurrency <n>           Max files analyzed in parallel (single-process mode; default: min(4, cpus))
  --workers <n>               Worker threads for parse+analyze (0=auto default: scales with file count, 1=in-process, N=threads)
  --parser <typescript|oxc>   TS/JS-family parser: typescript (default) or oxc (Rust oxc-parser, byte-equivalent output)
  --respect-gitignore         Honor a root .gitignore when discovering files (default: on)
  --no-respect-gitignore      Ignore .gitignore and only apply --exclude
  --cache / --no-cache        Two-level incremental cache (default: on for CLI; validate/benchmark use --no-cache)
  --cache-dir <dir>           Cache directory (default: <root>/.auto-refactor-cache)
  --cache-clear               Delete the project cache directory before scanning
  --cache-custom              Enable L2 caching even with custom analyzers (hashes module content)
  --daemon                    Auto-start the daemon if missing, then warm-scan (watch/CI warm-up)
  --no-daemon                 Never connect to the daemon (pure cold scan)
  --comment-level <level>      Leveled comment audit: off | basic | standard | strict (default: standard)
  --security-level <level>     Leveled security audit: off | basic | full (default: basic)
  --auto-tune                 Enable scale-adaptive dynamic threshold and option tuning
  --profile                   Display auto-detected project stack profile and partition details
  --help, -h                  Show this help
`);
}

/**
 * CLI entry point. Delegates all work to the shared API (scanAndRender),
 * so script/CI and CLI share identical behavior.
 *
 * Defaults (docs/01-architecture/02-pipeline-and-caching.md §A4.3): cache ON; daemon 'auto'
 * (probe an EXISTING daemon only — <5ms, never auto-starts). `--daemon` opts into auto-start;
 * `--no-daemon` opts out.
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const sub = args.find((a) => !a.startsWith('--')) || 'scan';
    if (sub === 'symbols') {
        const { querySymbols } = require('./api');
        const target = args[args.indexOf('symbols') + 1];
        if (!target) {
            process.stderr.write('Usage: auto-refactor symbols <name> [--root <dir>]\n');
            process.exit(2);
        }
        const rootIdx = args.indexOf('--root');
        const root = rootIdx !== -1 ? args[rootIdx + 1] : process.cwd();
        querySymbols(target, { root, logLevel: 'silent', daemon: DAEMON_MODE_OFF, cache: false })
            .then((result: any) => {
                process.stdout.write(`
=== Symbol: ${target} ===
`);
                for (const d of result.definitions) {
                    process.stdout.write(`  defined  ${d.kind.padEnd(9)} ${d.file}:${d.line ?? '?'}
`);
                }
                for (const r of result.references) {
                    process.stdout.write(`  called   ${r.file}:${r.line ?? '?'}
`);
                }
                process.stdout.write(
                    `  coverage defs=${result.stats.definitions} refs=${result.stats.references} ` +
                        `crossFile=${result.stats.crossFileReferences} (${result.stats.builtFrom})
`,
                );
                process.exit(0);
            })
            .catch((error: unknown) => {
                process.stderr.write(`symbols failed: ${String(error)}
`);
                process.exit(1);
            });
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
        // Engine quality guard: known-violation fixtures assert that every built-in analyzer
        // actually fires.

        const { selfTestCommand } = require('./cli/selfTestCmd');
        const r = await selfTestCommand(args.slice(args.indexOf('self-test') + 1));
        process.stderr.write(r.text + '\n');
        process.exit(r.code);
    }
    if (sub === 'guide') {
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
    if (sub === 'trajectory') {
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
    if (sub === 'memory') {
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
    if (sub !== 'scan') {
        printUsage();
        process.exit(2);
    }

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

    const code = await scanAndRender(cli);
    process.exit(code);
}

main().catch((e) => {
    process.stderr.write(`[auto-refactor] FATAL: ${e?.stack || e}\n`);
    process.exit(2);
});
