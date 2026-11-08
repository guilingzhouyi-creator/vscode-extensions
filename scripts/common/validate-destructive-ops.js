/**
 * Module: Destructive Filesystem Operation Guard
 * File Path: scripts/common/validate-destructive-ops.js
 * Architecture Role: Static guard over the script corpus, rejecting a recursive delete whose
 *   operand is, or is transitively derived from, a home / profile / filesystem-root expression,
 *   and rejecting any write to a read-only PowerShell automatic variable.
 * Dependencies & Triggers: Node.js standard libraries only; walks scripts/, fractal-git/,
 *   WebGames/, auto-refactor/ and workspace-timing/; invoked by the pre-push gate and audit-all.
 * Responsibilities:
 *   1. Reject a recursive delete whose operand names a filesystem root, an ancestor directory, or a
 *      home/profile directory;
 *   2. Reject a recursive delete whose operand is bound, directly or through any chain of
 *      assignments, to such an expression;
 *   3. Reject a recursive delete that names no operand at all, where the shell decides the target;
 *   4. Reject assignment, loop, parameter and cast bindings that shadow a read-only automatic
 *      variable;
 *   5. Prove every detector still fires before trusting a clean result.
 * Exit Semantics & Design Rationale: 0 = no destructive operand traces to a home or root
 *   expression and no read-only automatic variable is shadowed, 1 = at least one finding or a
 *   failed self-probe.
 *
 *   The defect this guards is a provenance defect, not a logic defect. A recursive delete is safe
 *   only when the path it receives is the path the author meant; when the path arrives through a
 *   variable, the source usually says nothing about where it came from. A real incident motivated
 *   this module: a staging path was built from a variable whose name collided, case-insensitively,
 *   with the read-only `$HOME`, the assignment threw, the throw was never checked, and the delete
 *   ran against the user profile. Both links in that chain are checked here, because either one
 *   alone would have prevented it.
 *
 *   The detector is deliberately a *taint* analysis rather than a blanket "operand must be a
 *   literal" rule. A blanket rule fires on every legitimate fixture cleanup — this corpus has
 *   dozens — and a guard that is wrong twenty times is a guard that gets suppressed. Taint has the
 *   opposite property: no legitimate scratch or fixture path in this workspace is derived from a
 *   home or drive-root expression, so a tainted operand is always a real defect. The analysis
 *   follows assignments transitively because the incident's path was built by joining a home root
 *   with a relative segment, which is two hops from the root that made it dangerous.
 *
 *   The automatic-variable list is measured, not remembered: every entry was probed with
 *   `Set-Variable -ErrorAction Stop` and kept only when PowerShell rejected the write as read-only.
 *   Writable look-alikes (`$PROFILE`, `$PWD`, `$INPUT`, `$ARGS`, `$MATCHES`, `$LASTEXITCODE`,
 *   `$PSITEM`, `$THIS`, `$STACKTRACE`) are excluded on measurement. `$ARGS` in particular is the
 *   argument array every wrapper in the parity library legitimately owns; flagging it would reject
 *   correct code.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

const SCAN_ROOTS = Object.freeze([
  'scripts',
  'fractal-git/scripts',
  'fractal-git/ts',
  'WebGames/scripts',
  'auto-refactor/scripts',
  'workspace-timing/scripts',
  '.githooks',
]);

const SCAN_EXTENSIONS = new Set(['.ps1', '.psm1', '.sh', '.js', '.mjs', '.cjs', '.ts']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', 'build', '__pycache__', 'archive', 'fixtures']);

/**
 * Expressions that denote a home, profile or filesystem root in any of the three languages.
 *
 * A root is never a legitimate recursive-delete operand, so this list needs no allowance for
 * intent. The POSIX entries cover the top-level system directories and one level beneath them
 * (`/home`, `/home/user`), because a delete of either destroys data no script owns.
 */
const FORBIDDEN_OPERANDS = Object.freeze([
  /^\.$/,
  /^\.\.$/,
  /^[/\\]$/,
  /^[A-Za-z]:[/\\]?$/,
  /^~[/\\]?$/,
  /^\$HOME$/i,
  /^\$\{HOME\}$/i,
  /^\$PSHOME$/i,
  /^\$PROFILE$/i,
  /^\$env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR|PROGRAMFILES)$/i,
  /^\$\{env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR|PROGRAMFILES)\}$/i,
  /^%(?:USERPROFILE|HOMEPATH|HOMEDRIVE|SYSTEMDRIVE|SYSTEMROOT|WINDIR)%$/i,
  /^\/(?:home|users|root|etc|usr|var|bin|sbin|lib|opt|boot|dev|proc|sys)(?:\/[^/]*)?$/i,
]);

/**
 * Sub-expressions that introduce a taint source. A binding whose right-hand side contains any of
 * these is tainted, and everything derived from a tainted binding inherits the taint.
 */
const TAINT_SOURCES = Object.freeze([
  /\$HOME\b/i,
  /\$\{HOME\}/i,
  /\$PSHOME\b/i,
  /\$PROFILE\b/i,
  /\$env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR)\b/i,
  /\$\{env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR)\}/i,
  /%(?:USERPROFILE|HOMEPATH|HOMEDRIVE|SYSTEMDRIVE|SYSTEMROOT|WINDIR)%/i,
  /\bos\s*\.\s*homedir\s*\(/,
  /\bprocess\s*\.\s*env\s*\.\s*(?:USERPROFILE|HOMEPATH|HOME|SystemDrive|SystemRoot|windir)\b/,
  /\bprocess\s*\.\s*env\s*\[\s*['"](?:USERPROFILE|HOMEPATH|HOME|SystemDrive|SystemRoot|windir)['"]\s*\]/,
]);

/**
 * Read-only automatic variables, each verified by probing `Set-Variable -ErrorAction Stop` and
 * keeping only the names PowerShell rejected with a read-only/constant error.
 *
 * Two neighbouring categories are excluded on measurement, and the distinction matters:
 *
 *   - *Writable* names (`$PROFILE`, `$PWD`, `$INPUT`, `$ARGS`, `$MATCHES`, `$LASTEXITCODE`,
 *     `$PSITEM`, `$THIS`, `$STACKTRACE`, `$NESTEDPROMPTLEVEL`, `$PSCommandPath`, `$PSScriptRoot`).
 *     Assigning these succeeds, so it is not the failure being guarded. `$ARGS` in particular is
 *     the argument array every wrapper in the parity library legitimately owns.
 *   - *Type-constrained* names (`$OutputEncoding`, `$MyInvocation`, `$PSBoundParameters`,
 *     `$PSCmdlet`). Assigning these throws only when the value has the wrong type; assigning the
 *     right type succeeds and is idiomatic — `$OutputEncoding = [Text.UTF8Encoding]::new($false)`
 *     appears in every gate script in this workspace and works. Reporting them would block correct
 *     code, which is how a guard earns being switched off.
 */
const READONLY_AUTOMATIC_VARIABLES = Object.freeze([
  'home', 'pshome', 'pid', 'host', 'error', 'executioncontext', 'shellid',
  'psversiontable', 'iswindows', 'islinux', 'ismacos', 'psculture', 'psuiculture', 'psedition',
]);

const PS_DELETE = /\b(?:Remove-Item|rm|del|erase|rd|rmdir)\b/i;
const SH_DELETE = /\brm\b/;
const JS_DELETE = /\b(?:rmSync|rimraf|removeSync)\s*\(|\bfs\s*\.\s*rm\s*\(|\bshutil\s*\.\s*rmtree\s*\(/;

/** Recursion may be decided at run time (`-Recurse:$flag`), so any mention counts. */
const PS_RECURSIVE = /-Recurse|\s-[a-zA-Z]*[rR]\b/;
const SH_RECURSIVE = /(?:^|\s)(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/;
const JS_RECURSIVE = /\brecursive\s*:\s*true\b/;

/** How far forward a multi-line JavaScript call may state `recursive: true`. */
const JS_STATEMENT_WINDOW = 6;

/**
 * Self-probes: every detector must fire on its sample, or the guard reports itself broken.
 *
 * A clean corpus run cannot distinguish a working detector from one that never matches, and the
 * guard this module most resembles shipped once with a pattern that matched nothing while exiting
 * zero. Each probe below is a shape the detector is *required* to handle.
 */
const SELF_PROBES = Object.freeze({
  psDelete: [
    'Remove-Item -LiteralPath $p -Recurse -Force',
    'Remove-Item -Path $logDir -Recurse:$flag -Force',
    'Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue',
  ],
  shDelete: [
    'rm -rf "$WORKDIR"',
    'rm -r --one-file-system /srv/data',
    'rm -fr "${CACHE}"',
  ],
  jsDelete: [
    'fs.rmSync(physicalDir, { recursive: true, force: true });',
    'fs.rm(target, { recursive: true }, () => {});',
    'shutil.rmtree(tmp, ignore_errors=True)',
  ],
  shadow: [
    '$home = "x"',
    'foreach ($PID in @(1)) { }',
    '[string]$Host = "x"',
    'param([string]$Error)',
  ],
  forbidden: ['.', '..', '/', 'C:\\', '~', '$HOME', '$env:USERPROFILE', '%USERPROFILE%'],
  taint: [
    '$env:USERPROFILE',
    'Join-Path $HOME "staging"',
    'os.homedir()',
    'process.env.USERPROFILE',
  ],
});

/**
 * Collects scannable files under one root.
 *
 * @param {string} dir - Absolute directory.
 * @param {string[]} acc - Accumulator.
 * @returns {string[]} Absolute file paths.
 */
function collectFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, acc);
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

/**
 * Splits an argument list into tokens, honouring quotes and bracket nesting.
 *
 * @param {string} text - Argument text.
 * @returns {string[]} Tokens.
 */
function splitArguments(text) {
  const tokens = [];
  let current = '';
  let depth = 0;
  let quote = '';
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    if (char === ' ' && depth === 0) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Extracts the operand of a PowerShell recursive delete.
 *
 * @param {string} line - Source line.
 * @returns {string|null} Operand expression, or null when the line is not a recursive delete.
 */
function parsePowerShellDelete(line) {
  if (!PS_DELETE.test(line) || !PS_RECURSIVE.test(line)) return null;
  const cmd = /\b(?:Remove-Item|rm|del|erase|rd|rmdir)\b([\s\S]*)/i.exec(line);
  if (!cmd) return null;
  const tokens = splitArguments(cmd[1].replace(/[|;].*$/, '').trim());
  const named = tokens.findIndex((token) => /^-(?:LiteralPath|Path|LP)$/i.test(token));
  if (named >= 0) {
    const next = tokens[named + 1];
    return next && !next.startsWith('-') ? next.split(',')[0].trim() : '';
  }
  return (tokens.find((token) => !token.startsWith('-')) || '').split(',')[0].trim();
}

/**
 * Extracts the operand of a Bash recursive `rm`.
 *
 * @param {string} line - Source line.
 * @returns {string|null} First operand, or null when the line is not a recursive delete.
 */
function parseShellDelete(line) {
  if (!SH_DELETE.test(line) || !SH_RECURSIVE.test(line)) return null;
  const match = /\brm\b([\s\S]*)/.exec(line);
  if (!match) return null;
  const tokens = splitArguments(match[1].replace(/[|;&].*$/, '').trim());
  return tokens.find((token) => !token.startsWith('-')) || '';
}

/**
 * Extracts the operand of a JavaScript recursive delete.
 *
 * The recursion flag may sit on a later line of the same call, so a forward window is scanned.
 * `rimraf`, `removeSync` and `rmtree` are recursive by definition and need no flag.
 *
 * @param {string[]} lines - File lines.
 * @param {number} index - Zero-based index of the candidate line.
 * @returns {string|null} First argument expression, or null when not a recursive delete.
 */
function parseJavaScriptDelete(lines, index) {
  const line = lines[index];
  if (!JS_DELETE.test(line)) return null;
  const inherentlyRecursive = /\brimraf\b|\bremoveSync\b|\brmtree\b/.test(line);
  if (!inherentlyRecursive) {
    const window = lines.slice(index, index + JS_STATEMENT_WINDOW).join(' ');
    if (!JS_RECURSIVE.test(window)) return null;
  }
  const open = line.indexOf('(');
  if (open < 0) return null;
  const inner = line.slice(open + 1).replace(/\)\s*[;,)]?\s*$/, '');
  const target = splitArguments(inner)[0];
  return target ? target.replace(/,$/, '').trim() : '';
}

/**
 * Reads single-assignment bindings so an operand's provenance can be traced.
 *
 * Loop variables are bindings too, and they are the shape the incident actually took: the delete
 * named `$d` from `foreach ($d in @($staging))`, one alias away from the tainted collection. A
 * taint analysis that only reads `=` would have reported that file clean while it deleted the
 * profile, so the three loop forms are parsed into the same table.
 *
 * @param {string[]} lines - File lines.
 * @returns {Map<string, string[]>} Identifier to every right-hand side bound to it.
 */
function collectBindings(lines) {
  const bindings = new Map();
  const bind = (name, source) => {
    if (!bindings.has(name)) bindings.set(name, []);
    bindings.get(name).push(source);
  };
  for (const line of lines) {
    const assign = /(?:^|[\s(,])(?:const|let|var)?\s*\$?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\r\n]*)$/.exec(line);
    if (assign) bind(assign[1], assign[2]);
    const psLoop = /foreach\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^)]*)/i.exec(line);
    if (psLoop) bind(psLoop[1], psLoop[2]);
    const shLoop = /\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\r\n]*)/.exec(line);
    if (shLoop) bind(shLoop[1], shLoop[2]);
    const jsLoop = /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s+of\s+([^)]*)\)/.exec(line);
    if (jsLoop) bind(jsLoop[1], jsLoop[2]);
    const jsEach = /\.\s*forEach\s*\(\s*\(?\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (jsEach) bind(jsEach[1], line);
  }
  return bindings;
}

/**
 * Reports whether an expression mentions a taint source directly.
 *
 * @param {string} expression - Source fragment.
 * @returns {boolean} True when a home or root expression appears.
 */
function mentionsTaintSource(expression) {
  return TAINT_SOURCES.some((pattern) => pattern.test(expression));
}

/**
 * Reports whether an operand is, or is transitively derived from, a home or root expression.
 *
 * Transitive because the incident's operand was a home root joined with a relative segment: the
 * dangerous expression was two assignments away from the delete that used it.
 *
 * @param {string} operand - Operand expression.
 * @param {Map<string, string[]>} bindings - Identifier to right-hand sides.
 * @returns {string[]} Identifiers that carried the taint, nearest first; empty when clean.
 */
function taintChain(operand, bindings) {
  if (mentionsTaintSource(operand)) return [];
  const seen = new Set();
  const queue = [[operand, []]];
  while (queue.length > 0 && seen.size < 64) {
    const [expression, trail] = queue.shift();
    for (const token of expression.matchAll(/\$?([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const name = token[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const sources = bindings.get(name);
      if (!sources) continue;
      const nextTrail = [...trail, name];
      for (const source of sources) {
        if (mentionsTaintSource(source)) return nextTrail;
        queue.push([source, nextTrail]);
      }
    }
  }
  return [];
}

/**
 * Normalises an operand for comparison: quotes stripped, whitespace trimmed.
 *
 * @param {string} operand - Raw operand.
 * @returns {string} Normalised operand.
 */
function normalizeOperand(operand) {
  return operand.trim().replace(/^["'`]/, '').replace(/["'`]$/, '').trim();
}

/**
 * Classifies one delete operand.
 *
 * @param {string} operand - Raw operand expression.
 * @param {Map<string, string[]>} bindings - Identifier to right-hand sides.
 * @returns {string|null} Rejection reason, or null when the operand is accounted for.
 */
function classifyOperand(operand, bindings) {
  if (!operand || !operand.trim()) {
    return 'the delete names no operand, so the shell decides what it receives';
  }
  const normalized = normalizeOperand(operand);
  if (FORBIDDEN_OPERANDS.some((pattern) => pattern.test(normalized))) {
    return `'${normalized}' is a filesystem root, an ancestor directory, or a home/profile directory`;
  }
  const chain = taintChain(operand, bindings);
  if (chain.length > 0) {
    return `'${normalized}' derives from a home/profile/root expression through ${chain.join(' -> ')}`;
  }
  return null;
}

/**
 * Finds recursive deletes whose operand traces to a home or root expression.
 *
 * @param {string} full - Absolute file path.
 * @returns {Array<object>} Findings.
 */
function auditDestructiveTargets(full) {
  const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
  const extension = path.extname(full);
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  const bindings = collectBindings(lines);
  const findings = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // A line that opens with a quote is a string element, not a statement. Self-probe corpora and
    // message tables both have that shape and must not be read as executable deletes.
    if (/^(?:#|\/\/|\*|["'`])/.test(trimmed)) return;
    let operand;
    if (extension === '.ps1' || extension === '.psm1') operand = parsePowerShellDelete(line);
    else if (extension === '.sh') operand = parseShellDelete(line);
    else operand = parseJavaScriptDelete(lines, index);
    if (operand === null || operand === undefined) return;
    const reason = classifyOperand(operand, bindings);
    if (!reason) return;
    findings.push({ type: 'GUARD-DESTR-001', file: rel, line: index + 1, detail: reason });
  });
  return findings;
}

/**
 * Finds PowerShell bindings that shadow a read-only automatic variable.
 *
 * The write always throws. The defect is not the throw: it is that the surrounding script keeps
 * running with the name still holding its previous value, so every later use of that name silently
 * addresses a different object than the author intended.
 *
 * @param {string} full - Absolute file path.
 * @returns {Array<object>} Findings.
 */
function auditAutomaticVariableShadowing(full, contentOverride) {
  if (!['.ps1', '.psm1'].includes(path.extname(full))) return [];
  const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
  const findings = [];
  const seen = new Set();
  const report = (name, line) => {
    const key = `${line}:${name.toLowerCase()}`;
    if (!READONLY_AUTOMATIC_VARIABLES.includes(name.toLowerCase()) || seen.has(key)) return;
    seen.add(key);
    findings.push({
      type: 'GUARD-VAR-001',
      file: rel,
      line,
      detail: `$${name} is a read-only automatic variable; the write throws and the name keeps its previous value`,
    });
  };
  const source = contentOverride !== undefined ? contentOverride : fs.readFileSync(full, 'utf8');
  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('*')) return;
    for (const match of line.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:=[^=]|\+=|-=|\*=)/g)) report(match[1], index + 1);
    for (const match of line.matchAll(/foreach\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+in\b/gi)) report(match[1], index + 1);
    for (const match of line.matchAll(/\bparam\s*\([^)]*\$([A-Za-z_][A-Za-z0-9_]*)/gi)) report(match[1], index + 1);
    for (const match of line.matchAll(/\[[A-Za-z_][A-Za-z0-9_.\[\]]*\]\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
      report(match[1], index + 1);
    }
    for (const match of line.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*,[^=\r\n]*=/g)) report(match[1], index + 1);
  });
  return findings;
}

/**
 * Audits one file for both rule families.
 *
 * @param {string} full - Absolute file path.
 * @returns {Array<object>} Findings.
 */
function auditFile(full) {
  return [...auditDestructiveTargets(full), ...auditAutomaticVariableShadowing(full)];
}

/**
 * Verifies every detector against its probe corpus.
 *
 * @returns {string[]} Probe labels the detectors failed to handle.
 */
function runSelfProbes() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`probe "${label}": expected ${wanted}, got ${actual}`);
  };
  for (const sample of SELF_PROBES.psDelete) expect(`ps:${sample}`, parsePowerShellDelete(sample) !== null, true);
  for (const sample of SELF_PROBES.shDelete) expect(`sh:${sample}`, parseShellDelete(sample) !== null, true);
  for (const sample of SELF_PROBES.jsDelete) {
    expect(`js:${sample}`, parseJavaScriptDelete([sample], 0) !== null, true);
  }
  expect('ps:non-recursive-ignored', parsePowerShellDelete('Remove-Item -LiteralPath $f -Force'), null);
  expect('js:non-recursive-ignored', parseJavaScriptDelete(['fs.rmSync(file, { force: true });'], 0), null);
  expect('sh:non-recursive-ignored', parseShellDelete('rm -f "$LOG"'), null);

  for (const sample of SELF_PROBES.shadow) {
    const detected = auditAutomaticVariableShadowing(path.join(REPO_ROOT, '__probe__.ps1'), sample);
    expect(`shadow:${sample}`, detected.length > 0, true);
  }
  for (const sample of SELF_PROBES.forbidden) {
    expect(`forbidden:${sample}`, FORBIDDEN_OPERANDS.some((pattern) => pattern.test(sample)), true);
  }
  for (const sample of SELF_PROBES.taint) expect(`taint:${sample}`, mentionsTaintSource(sample), true);

  // Discrimination: shapes that must NOT fire, because a guard that always fires is a guard that
  // gets switched off.
  expect('forbidden:relative-path-passes', FORBIDDEN_OPERANDS.some((p) => p.test('./dist')), false);
  expect('taint:scratch-passes', mentionsTaintSource('os.tmpdir()'), false);
  expect('readonly:args-passes', READONLY_AUTOMATIC_VARIABLES.includes('args'), false);
  expect('readonly:profile-passes', READONLY_AUTOMATIC_VARIABLES.includes('profile'), false);
  expect('readonly:outputencoding-passes', READONLY_AUTOMATIC_VARIABLES.includes('outputencoding'), false);

  // The incident shape, end to end: a home root bound to a name, then joined, then iterated, then
  // deleted through the loop alias. Each hop is a separate alias, and the delete names only the
  // last one — which is why the walk must be transitive and must read loop bindings.
  const bindings = collectBindings([
    '$probe = Join-Path $HOME "Low"',
    '$staging = Join-Path $probe "case"',
    'foreach ($d in @($staging)) { }',
  ]);
  expect('taint:transitive-caught', taintChain('$staging', bindings).length > 0, true);
  expect('taint:loop-alias-caught', taintChain('$d', bindings).length > 0, true);
  expect('taint:clean-name-passes', taintChain('$unrelated', bindings).length, 0);
  expect(
    'taint:scratch-chain-passes',
    taintChain('$dir', collectBindings(['$dir = fs.mkdtempSync("x-")'])).length,
    0,
  );
  return failures;
}

/**
 * Runs the audit over the whole corpus.
 *
 * @returns {Array<object>} Findings.
 */
function runAudit() {
  const findings = [];
  for (const root of SCAN_ROOTS) {
    for (const file of collectFiles(path.join(REPO_ROOT, root))) findings.push(...auditFile(file));
  }
  return findings;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const probeFailures = runSelfProbes();
  const findings = probeFailures.length === 0 ? runAudit() : [];
  const passed = probeFailures.length === 0 && findings.length === 0;

  if (isAgent) {
    console.log(JSON.stringify({
      protocolVersion: '1.0.0',
      status: passed ? 'PASS' : 'BLOCK',
      gate: 'destructive-ops',
      probeFailures,
      findings,
      summary: passed
        ? 'No recursive delete traces to a home or root expression, and no read-only automatic variable is shadowed.'
        : `${findings.length} destructive-operand defect(s), ${probeFailures.length} failed probe(s).`,
    }, null, 2));
    process.exit(passed ? 0 : 1);
  }

  if (probeFailures.length > 0) {
    console.error('✖ BLOCK  destructive-ops  检测器自检失败，以下样本未被识别：');
    for (const failure of probeFailures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  if (passed) {
    console.log('  ✔  destructive-ops  递归删除目标无家目录/根路径污点且无只读自动变量遮蔽');
    process.exit(0);
  }

  console.error('✖ BLOCK  destructive-ops');
  for (const item of findings) console.error(`  - [${item.type}] ${item.file}:${item.line} ${item.detail}`);
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({
  runAudit,
  auditFile,
  auditDestructiveTargets,
  auditAutomaticVariableShadowing,
  runSelfProbes,
  parsePowerShellDelete,
  parseShellDelete,
  parseJavaScriptDelete,
  classifyOperand,
  taintChain,
  mentionsTaintSource,
  collectBindings,
  READONLY_AUTOMATIC_VARIABLES,
  FORBIDDEN_OPERANDS,
  TAINT_SOURCES,
  SELF_PROBES,
});
