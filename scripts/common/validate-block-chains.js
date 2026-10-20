/**
 * Module: PowerShell Block Chain Guard
 * File Path: scripts/common/validate-block-chains.js
 * Architecture Role: Static guard over the PowerShell script corpus, rejecting a block-chain
 *   continuation (`else`, `elseif`, `catch`, `finally`) that attaches to a block which cannot
 *   legally accept it.
 * Dependencies & Triggers: Scans scripts/, fractal-git/scripts/, WebGames/scripts/,
 *   auto-refactor/scripts/ and workspace-timing/scripts/ for `.ps1` files; invoked by pre-push and CI.
 * Responsibilities:
 *   1. Prove its own detector still fires before trusting a clean result (built-in probes);
 *   2. Track block openers with a string-, comment- and here-string-aware brace scanner;
 *   3. Reject a continuation whose popped opener is not in its legal set (a second `else` after an
 *      `else`, `else` after `try`, `catch` after `if`, and so on);
 *   4. Report file-and-line diagnostics for every finding.
 * Exit Semantics & Design Rationale: 0 = every block chain is well formed, 1 = at least one finding
 *   or a failed self-probe. This guards a defect the PowerShell parser accepts: a duplicated
 *   `} else { ... }` branch parses with zero errors, so every parse- and lint-based check passes,
 *   and the file only fails at run time on the branch that reaches the orphaned `else`. The guard
 *   is deliberately limited to `.ps1` because Bash has no `else`-block construct with this shape.
 *   The self-probes exist because a brace scanner that silently stops tracking braces reports a
 *   clean corpus while detecting nothing.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

const SCAN_ROOTS = Object.freeze([
  'scripts',
  'fractal-git/scripts',
  'WebGames/scripts',
  'auto-refactor/scripts',
  'workspace-timing/scripts',
]);

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', '__pycache__', 'archive', 'fixtures', 'config']);

/** Which opener kinds may legally precede each continuation. */
const LEGAL_PREDECESSOR = Object.freeze({
  else: new Set(['if', 'elseif']),
  elseif: new Set(['if', 'elseif']),
  catch: new Set(['try', 'catch']),
  finally: new Set(['try', 'catch']),
});

/** A continuation keyword at the start of the statement that follows a closed block. */
const CONTINUATION_START = /^(elseif|else|catch|finally)\b/i;

/**
 * Classifies the block a `{` opens, from the statement text that precedes it.
 *
 * @param {string} prefix - Statement text before the brace.
 * @returns {string} One of if/elseif/else/try/catch/finally/other.
 */
function classifyOpener(prefix) {
  const tail = prefix.trimEnd();
  if (/\belseif\b[^;{}]*$/i.test(tail)) return 'elseif';
  if (/\belse\s*$/i.test(tail)) return 'else';
  if (/\btry\s*$/i.test(tail)) return 'try';
  if (/\bcatch\b[^;{}]*$/i.test(tail)) return 'catch';
  if (/\bfinally\s*$/i.test(tail)) return 'finally';
  if (/\bif\s*\(/i.test(tail) || /\bif\b[^;{}]*$/i.test(tail)) return 'if';
  return 'other';
}

/**
 * Per-mode character handlers for the PowerShell lexical scanner.
 *
 * A table instead of one long branch chain: each mode is a small pure function returning how many
 * characters to consume, what to emit in their place, and whether the mode changes. The emitted
 * text is always the same length as the consumed text so column positions survive.
 */
const SCANNERS = Object.freeze({
  blockComment: (ch, next) => (ch === '#' && next === '>'
    ? { text: '  ', step: 2, mode: 'normal' }
    : { text: ' ', step: 1 }),

  hereString: (ch, next, state, line, i) => (ch === state.quote && next === '@' && line.slice(i + 2).trim() === ''
    ? { text: '  ', step: 2, mode: 'normal' }
    : { text: ' ', step: 1 }),

  single: (ch, next) => {
    if (ch !== "'") return { text: ' ', step: 1 };
    if (next === "'") return { text: '  ', step: 2 };
    return { text: ' ', step: 1, mode: 'normal' };
  },

  double: (ch, next) => {
    if (ch === '`') return { text: '  ', step: 2 };
    if (ch !== '"') return { text: ' ', step: 1 };
    if (next === '"') return { text: '  ', step: 2 };
    return { text: ' ', step: 1, mode: 'normal' };
  },

  normal: (ch, next) => {
    if (ch === '<' && next === '#') return { text: '  ', step: 2, mode: 'blockComment' };
    if (ch === '#') return { text: '', step: Number.POSITIVE_INFINITY };
    if (ch === '@' && (next === '"' || next === "'")) {
      return { text: '  ', step: 2, mode: 'hereString', quote: next };
    }
    if (ch === "'") return { text: ' ', step: 1, mode: 'single' };
    if (ch === '"') return { text: ' ', step: 1, mode: 'double' };
    return { text: ch, step: 1 };
  },
});

/**
 * Blanks one source line according to the current lexical state.
 *
 * @param {string} line - One source line.
 * @param {{ mode: string, quote: string }} state - Carried across lines.
 * @returns {string} Code-only view of the line, same length as the input.
 */
function blankLine(line, state) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const result = SCANNERS[state.mode](line[i], line[i + 1], state, line, i);
    out += result.text;
    if (result.mode) state.mode = result.mode;
    if (result.quote) state.quote = result.quote;
    i += result.step;
  }
  return out;
}

/**
 * Splits a PowerShell source into "code with string and comment bodies blanked out".
 *
 * Blanking rather than deleting keeps every character position, so a brace that lives inside a
 * string or a comment cannot move the block stack, and line numbers stay aligned with the source.
 *
 * @param {string} source - Raw file contents.
 * @returns {string[]} Per-line code-only view.
 */
function blankNonCode(source) {
  const state = { mode: 'normal', quote: '' };
  return source.split(/\r?\n/).map((line) => blankLine(line, state));
}

/**
 * Flattens per-line code into a single character stream that remembers source lines.
 *
 * @param {string[]} codeLines - Code-only view, one entry per source line.
 * @returns {Array<{ ch: string, line: number }>} Character stream.
 */
function flatten(codeLines) {
  const stream = [];
  codeLines.forEach((code, index) => {
    for (const ch of code) stream.push({ ch, line: index + 1 });
    stream.push({ ch: '\n', line: index + 1 });
  });
  return stream;
}

/**
 * Reads the identifier that starts at or after `from`, skipping whitespace.
 *
 * PowerShell allows `}` and `else` on separate lines, so a detector that only inspects the text
 * after the brace on the same line misses the whole two-line form.
 *
 * @param {Array<{ ch: string, line: number }>} stream - Character stream.
 * @param {number} from - Index to start at.
 * @returns {{ word: string, line: number }} Identifier text and the line it starts on.
 */
function peekWord(stream, from) {
  let i = from;
  while (i < stream.length && /\s/.test(stream[i].ch)) i += 1;
  const line = i < stream.length ? stream[i].line : 0;
  let word = '';
  while (i < stream.length && /[A-Za-z]/.test(stream[i].ch)) {
    word += stream[i].ch;
    i += 1;
  }
  return { word, line };
}

/**
 * Audits one PowerShell source for orphaned block-chain continuations.
 *
 * The opener is classified from the accumulated statement text since the previous brace or `;`,
 * not from the current line alone: a condition that wraps across lines puts the `elseif` keyword
 * several lines above the `{`, and a per-line view would misclassify the block as `other`.
 *
 * @param {string} source - Raw file contents.
 * @param {string} rel - Repo-relative path used in diagnostics.
 * @returns {Array<object>} Findings.
 */
function auditSource(source, rel) {
  const stream = flatten(blankNonCode(source));
  const findings = [];
  const stack = [];
  let pending = '';

  for (let i = 0; i < stream.length; i += 1) {
    const { ch, line } = stream[i];

    if (ch === '{') {
      stack.push(classifyOpener(pending));
      pending = '';
      continue;
    }
    if (ch === ';') {
      pending = '';
      continue;
    }
    if (ch !== '}') {
      pending += ch;
      continue;
    }

    const popped = stack.pop();
    const { word } = peekWord(stream, i + 1);
    const kind = word.toLowerCase();
    if (CONTINUATION_START.test(word)) {
      const legal = LEGAL_PREDECESSOR[kind];
      if (legal && !legal.has(popped)) {
        findings.push({
          type: 'GUARD-CHAIN-001',
          file: rel,
          line,
          detail: `'${kind}' 挂在 '${popped}' 块之后，该块无法接受此分支；PowerShell 解析器不报错，运行时才在此行失败`,
        });
      }
    }
    pending = '';
  }

  return findings;
}

/**
 * Audits one file path.
 *
 * @param {string} file - Absolute file path.
 * @returns {Array<object>} Findings.
 */
function auditFile(file) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  return auditSource(fs.readFileSync(file, 'utf8'), rel);
}

/** Probe corpus: every sample states the expected finding count. */
const SELF_PROBES = Object.freeze([
  { name: 'duplicated else branch', expect: 1, source: 'if ($a) {\r\n    "y"\r\n} else {\r\n    "n"\r\n} else {\r\n    "n"\r\n}\r\n' },
  { name: 'legitimate if/elseif/else', expect: 0, source: 'if ($a) {\r\n    "1"\r\n} elseif ($b) {\r\n    "2"\r\n} else {\r\n    "3"\r\n}\r\n' },
  { name: 'else after try/catch', expect: 1, source: 'try {\r\n    "t"\r\n} catch {\r\n    "c"\r\n} else {\r\n    "e"\r\n}\r\n' },
  { name: 'legitimate try/catch/finally', expect: 0, source: 'try {\r\n    "t"\r\n} catch {\r\n    "c"\r\n} finally {\r\n    "f"\r\n}\r\n' },
  { name: 'braces inside a string', expect: 0, source: 'if ($a) {\r\n    "x } else {"\r\n} else {\r\n    "n"\r\n}\r\n' },
  { name: 'braces inside a block comment', expect: 0, source: 'if ($a) {\r\n    <# } else { #>\r\n    "y"\r\n} else {\r\n    "n"\r\n}\r\n' },
  { name: 'braces inside a here-string', expect: 0, source: 'if ($a) {\r\n    $t = @"\r\n} else {\r\n"@\r\n} else {\r\n    "n"\r\n}\r\n' },
  { name: 'brace and else on separate lines', expect: 1, source: 'if ($a) {\r\n    "y"\r\n}\r\nelse {\r\n    "n"\r\n}\r\nelse {\r\n    "n"\r\n}\r\n' },
  { name: 'legitimate chain split across lines', expect: 0, source: 'if ($a) {\r\n    "1"\r\n}\r\nelseif ($b) {\r\n    "2"\r\n}\r\nelse {\r\n    "3"\r\n}\r\n' },
  { name: 'wrapped condition keeps its if classification', expect: 0, source: 'if (($a -eq 1) -or\r\n    ($b -eq 2)) {\r\n    "y"\r\n} else {\r\n    "n"\r\n}\r\n' },
]);

/**
 * Runs the probe corpus against the detector.
 *
 * @returns {string[]} Probe names whose observed finding count differs from the expectation.
 */
function runSelfProbes() {
  return SELF_PROBES.filter((probe) => auditSource(probe.source, '<probe>').length !== probe.expect)
    .map((probe) => `${probe.name} (expect ${probe.expect}, got ${auditSource(probe.source, '<probe>').length})`);
}

/**
 * Recursively collects `.ps1` files.
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
    if (entry.isDirectory()) { collectFiles(full, acc); continue; }
    if (path.extname(entry.name) === '.ps1') acc.push(full);
  }
  return acc;
}

/**
 * Runs the block chain audit.
 *
 * @returns {{ findings: Array<object>, probeFailures: string[] }} Audit result.
 */
function runAudit() {
  const findings = [];
  for (const target of SCAN_ROOTS) {
    for (const file of collectFiles(path.join(REPO_ROOT, target))) findings.push(...auditFile(file));
  }
  return { findings, probeFailures: runSelfProbes() };
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const { findings, probeFailures } = runAudit();
  const passed = findings.length === 0 && probeFailures.length === 0;

  if (isAgent) {
    console.log(JSON.stringify({
      protocolVersion: '1.0.0',
      status: passed ? 'PASS' : 'BLOCK',
      gate: 'block-chains',
      probeFailures,
      findings,
      summary: passed
        ? 'Every PowerShell block chain attaches to a block that can accept it.'
        : `${findings.length} orphaned continuation(s), ${probeFailures.length} failed probe(s).`,
    }, null, 2));
    process.exit(passed ? 0 : 1);
  }

  if (probeFailures.length > 0) {
    console.error('✖ BLOCK  block-chains  检测器自检失败，以下样本与预期不符：');
    for (const probe of probeFailures) console.error(`  - ${probe}`);
    process.exit(1);
  }

  if (passed) {
    console.log('  ✔ PASS  block-chains  PowerShell 块链分支均挂在可接受它的块之后');
    process.exit(0);
  }

  console.error('✖ BLOCK  block-chains');
  for (const item of findings) console.error(`  - [${item.type}] ${item.file}:${item.line} ${item.detail}`);
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({ runAudit, auditFile, auditSource, runSelfProbes, blankNonCode, SELF_PROBES });
