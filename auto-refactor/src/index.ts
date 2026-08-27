#!/usr/bin/env node
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
import { scanAndRender, ScanOptions } from './api';
import { resolveConfig } from './core/config';
import { LogLevel } from './core/types';
// NOTE: daemonCommand / CacheStore are required lazily in main() — the default CLI path
// must not pay for the daemon module graph (net, child_process) at boot.

interface CliOptions extends ScanOptions {
  out?: string;
  cacheClear?: boolean;
}

/** Minimal argv parser: supports `--key value`, `--key=value`, and repeated `--include`. */
function parseArgs(argv: string[]): CliOptions {
  const opt: CliOptions = { cache: true, daemon: 'auto' };
  const listFlags = new Set(['include', 'exclude']);
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (!arg.startsWith('--')) continue;
    arg = arg.slice(2);
    let value = '';
    if (arg.includes('=')) {
      [arg, value] = arg.split('=', 2);
    } else {
      value = argv[i + 1] || '';
      i++;
    }
    if (listFlags.has(arg)) {
      (opt as any)[arg] = (opt as any)[arg]
        ? [...(opt as any)[arg], ...value.split(',').map((s) => s.trim()).filter(Boolean)]
        : value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === 'analyzers') {
      opt.analyzers = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === 'format') {
      opt.format = value as any;
    } else if (arg === 'log-level') {
      opt.logLevel = value as LogLevel;
    } else if (arg === 'log-file') {
      opt.logFile = value;
    } else if (arg === 'concurrency') {
      opt.concurrency = Number(value);
    } else if (arg === 'workers') {
      opt.workers = Number(value);
    } else if (arg === 'respect-gitignore') {
      opt.respectGitignore = value !== 'false';
    } else if (arg === 'no-respect-gitignore') {
      opt.respectGitignore = false;
    } else if (arg === 'out') {
      opt.out = value;
    } else if (arg === 'fail-on-issue') {
      opt.failOnIssue = value !== 'false';
    } else if (arg === 'fail-on-analyzer-error') {
      opt.failOnAnalyzerError = value !== 'false';
    } else if (arg === 'parser') {
      opt.parser = value === 'oxc' ? 'oxc' : 'typescript';
    } else if (arg === 'root') {
      opt.root = value;
    } else if (arg === 'config') {
      opt.configFile = value;
    } else if (arg === 'cache') {
      opt.cache = value !== 'false';
    } else if (arg === 'no-cache') {
      opt.cache = false;
    } else if (arg === 'cache-dir') {
      opt.cacheDir = value;
    } else if (arg === 'cache-clear') {
      opt.cacheClear = true;
    } else if (arg === 'cache-custom') {
      opt.cacheCustom = true;
    } else if (arg === 'daemon') {
      opt.daemon = 'on';
    } else if (arg === 'no-daemon') {
      opt.daemon = 'off';
    } else if (arg === 'help' || arg === 'h') {
      printUsage();
      process.exit(0);
    }
  }
  return opt;
}

function printUsage(): void {
  process.stdout.write(`auto-refactor — automated code-refactoring analyzer (declarative, pluggable)

Usage:
  auto-refactor scan [options]
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
  --fail-on-analyzer-error    Treat analyzer crashes as 'error' (can fail CI)
  --config <file>             Path to auto-refactor.config.json (declarative registry)
  --log-level <lvl>           silent|error|warn|info|debug (default: info; stderr)
  --log-file <file>           Also append logs to this file
  --concurrency <n>           Max files analyzed in parallel (single-process mode; default: min(4, cpus))
  --workers <n>               Worker threads for parse+analyze (1=in-process default, 0=auto, N=count; useful for very large repos on many-core CI)
  --parser <typescript|oxc>   TS/JS-family parser: typescript (default) or oxc (Rust oxc-parser, byte-equivalent output)
  --respect-gitignore         Honor a root .gitignore when discovering files (default: on)
  --no-respect-gitignore      Ignore .gitignore and only apply --exclude
  --cache / --no-cache        Two-level incremental cache (default: on for CLI; validate/benchmark use --no-cache)
  --cache-dir <dir>           Cache directory (default: <root>/.auto-refactor-cache)
  --cache-clear               Delete the project cache directory before scanning
  --cache-custom              Enable L2 caching even with custom analyzers (hashes module content)
  --daemon                    Auto-start the daemon if missing, then warm-scan (watch/CI warm-up)
  --no-daemon                 Never connect to the daemon (pure cold scan)
  --help, -h                  Show this help
`);
}

/**
 * CLI entry point. Delegates all work to the shared API (scanAndRender),
 * so script/CI and CLI share identical behavior.
 *
 * Defaults (docs/01-architecture/02-pipeline-and-caching.md §A4.3): cache ON; daemon 'auto' (probe an EXISTING daemon
 * only — <5ms, never auto-starts). `--daemon` opts into auto-start; `--no-daemon` opts out.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args.find((a) => !a.startsWith('--')) || 'scan';
  if (sub === 'daemon') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { daemonCommand } = require('./cli/daemonCmd');
    const rest = args.slice(args.indexOf('daemon') + 1);
    const r = await daemonCommand(rest);
    if (r.text) process.stdout.write(r.text + '\n');
    process.exit(r.code);
  }
  if (sub !== 'scan') {
    printUsage();
    process.exit(2);
  }

  const cli = parseArgs(args);

  // --cache-clear: wipe the cache dir up-front (a fresh scan rebuilds it).
  if (cli.cacheClear) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CacheStore } = require('./core/cache');
    const cfg = resolveConfig(cli);
    const cache = new CacheStore(cli.cacheDir, cfg.root);
    const ok = cache.clear();
    process.stderr.write(`[auto-refactor] cache cleared (${ok ? 'ok' : 'FAILED'}): ${cache.dir}\n`);
  }

  const code = await scanAndRender(cli);
  process.exit(code);
}

main().catch((e) => {
  process.stderr.write(`[auto-refactor] FATAL: ${e?.stack || e}\n`);
  process.exit(2);
});
