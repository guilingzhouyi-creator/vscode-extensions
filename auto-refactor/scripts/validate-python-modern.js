#!/usr/bin/env node
/**
 * Module: Verification Harness — Python Modernization Rule Key Points
 * File Path: scripts/validate-python-modern.js
 * Architecture Role: Integration suite for the `python-modern` analyzer rules internalized
 *     of the Python modernization pack
 * Dependencies & Triggers: `npm run validate-python-modern` (part of `npm test`); imports
 *     ../dist/api (scan) plus node's assert/fs/os/path
 * Responsibilities: Assert each modernization rule fires on a legacy fixture and stays silent
 *     on its modern twin (pathlib, `raise ... from`, None-sentinel defaults, await/async,
 *     f-strings, `with open`); assert non-Python files are never inspected
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly; the disposable workspace is always removed in `finally`. Rules are
 *     asserted pairwise (legacy vs modern) because a modernization rule that cannot tell the
 *     modern spelling apart would push reviewers to revert good code.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../dist/api');

const LEGACY = [
  '"""Module docstring."""',
  'import os',
  'import time',
  '',
  'import requests',
  '',
  '',
  'def read_config(path=[], name=None):',
  '    """Docstring."""',
  '    full = os.path.join("a", "b")',
  '    handle = open(full)',
  '    try:',
  '        return handle.read()',
  '    except OSError as exc:',
  '        raise RuntimeError("read failed")',
  '',
  '',
  'async def fetch(session):',
  '    """Docstring."""',
  '    time.sleep(1)',
  '    requests.get("https://x")',
  '    session.execute("SELECT 1")',
  '',
  '',
  'def render(name):',
  '    """Docstring."""',
  '    return "%s!" % name',
  '',
].join('\n');

const MODERN = [
  '"""Module docstring."""',
  'from pathlib import Path',
  '',
  '',
  'def read_config(path=None):',
  '    """Docstring."""',
  '    full = Path("a") / "b"',
  '    with full.open() as handle:',
  '        try:',
  '            return handle.read()',
  '        except OSError as exc:',
  '            raise RuntimeError("read failed") from exc',
  '',
  '',
  'async def fetch(session):',
  '    """Docstring."""',
  '    await asyncio.sleep(1)',
  '    await session.execute("SELECT 1")',
  '',
  '',
  'def render(name):',
  '    """Docstring."""',
  '    return f"{name}!"',
  '',
].join('\n');

const EDGE_CASES = [
  '"""Module docstring."""',
  'import asyncio',
  '',
  '',
  'async def handler(session):',
  '    """Docstring."""',
  '    await session.execute("SELECT 1")',
  '    session.get_bind()',
  '    try:',
  '        await asyncio.sleep(0)',
  '    except ValueError as exc:',
  '        raise  # deliberate re-raise',
  '    except OSError as exc:',
  '        raise RuntimeError(',
  '            "boom"',
  '        ) from exc',
  '    return None',
  '',
].join('\n');

const LEGACY_TYPING = [
  '"""Module docstring."""',
  'import os',
  'import requests',
  'import dataclasses',
  'from typing import List, Optional, Iterable, Union',
  '',
  'from datetime import datetime',
  '',
  '',
  '@dataclasses.dataclass',
  'class Job:',
  '    """Docstring."""',
  '',
  '    name: str',
  '',
  '',
  'def build():',
  '    """Docstring."""',
  '    rows: List[str] = []',
  '    handle: Optional[str] = None',
  '    created = datetime.now(timezone.utc)',
  '    alias = Union[str, int]',
  '    return rows, handle, created, alias',
  '',
].join('\n');

const MODERN_TYPING = [
  '"""Module docstring."""',
  'import dataclasses',
  'import os',
  '',
  'import requests',
  '',
  'from app.services import jobs',
  '',
  '',
  '@dataclasses.dataclass(frozen=True, slots=True)',
  'class Job:',
  '    """Docstring."""',
  '',
  '    name: str',
  '',
  '',
  'def build():',
  '    """Docstring."""',
  '    rows: list[str] = []',
  '    handle: str | None = None',
  '    created = datetime.now(datetime.UTC)',
  '    alias = str | int',
  '    return rows, handle, created, alias, jobs',
  '',
].join('\n');

/**
 * Write both Python fixtures plus a TypeScript decoy into a disposable workspace.
 *
 * @param root - Absolute workspace directory.
 * @returns Absolute path of the generated config file.
 */
function writeWorkspace(root) {
  fs.writeFileSync(path.join(root, 'legacy.py'), LEGACY);
  fs.writeFileSync(path.join(root, 'modern.py'), MODERN);
  fs.writeFileSync(path.join(root, 'edge_cases.py'), EDGE_CASES);
  fs.writeFileSync(path.join(root, 'legacy_typing.py'), LEGACY_TYPING);
  fs.writeFileSync(path.join(root, 'modern_typing.py'), MODERN_TYPING);
  fs.writeFileSync(path.join(root, 'decoy.ts'), 'export const osPath = "os.path.join";\n');
  const configPath = path.join(root, 'ar.config.json');
  fs.writeFileSync(configPath, JSON.stringify({}));
  return configPath;
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-pymod-'));
  try {
    const configFile = writeWorkspace(root);
    const report = await scan({
      root,
      configFile,
      include: ['**/*.py', '**/*.ts'],
      analyzers: ['python-modern'],
      cache: false,
      daemon: 'off',
      logLevel: 'silent',
      respectGitignore: false,
      workers: 1,
    });
    const rulesIn = (file) => report.issues.filter((i) => i.location.file === file);
    const byRule = (rule) =>
      report.issues.filter((i) => i.rule === rule).map((i) => i.location.file);

    assert.deepStrictEqual(byRule('PYM-PATH-001'), ['legacy.py'], 'os.path must be flagged');
    assert.deepStrictEqual(
      byRule('PYM-RAISE-001'),
      ['legacy.py'],
      'raise without from must be flagged',
    );
    assert.deepStrictEqual(
      byRule('PYM-DEFAULT-001'),
      ['legacy.py'],
      'mutable default must be flagged',
    );
    assert.deepStrictEqual(
      byRule('PYM-ASYNC-001').sort(),
      ['legacy.py', 'legacy.py', 'legacy.py'],
      'time.sleep/requests/sync ORM inside async must all be flagged',
    );
    assert.deepStrictEqual(
      byRule('PYM-FSTRING-001'),
      ['legacy.py'],
      'percent-formatting must be flagged',
    );
    assert.deepStrictEqual(byRule('PYM-OPEN-001'), ['legacy.py'], 'bare open() must be flagged');
    console.log('  [PASS] all six modernization rules fire on the legacy fixture');

    assert.ok(
      !report.issues.some((i) => i.location.file === 'modern.py'),
      'the modern twin (pathlib/with/from/await/f-string/sentinel) must stay silent',
    );
    console.log('  [PASS] modern spellings stay silent on the paired fixture');

    assert.ok(
      !report.issues.some((i) => i.location.file === 'decoy.ts'),
      'non-Python files are outside this analyzer',
    );
    console.log('  [PASS] non-Python files are never inspected');

    const typingHits = (rule) =>
      report.issues.filter((i) => i.rule === rule && i.location.file === 'legacy_typing.py').length;
    assert.ok(typingHits('PYM-IMPORT-001') >= 1, 'out-of-order import sections must be flagged');
    assert.strictEqual(typingHits('PYM-SLOTS-001'), 1, 'bare @dataclass must request slots=True');
    assert.strictEqual(typingHits('PYM-GENERIC-001'), 1, 'typing.List must be flagged');
    assert.strictEqual(
      typingHits('PYM-ABC-001'),
      1,
      'typing.Iterable must move to collections.abc',
    );
    assert.strictEqual(typingHits('PYM-DATETIME-001'), 1, 'timezone.utc must be flagged');
    assert.strictEqual(typingHits('PYM-UNION-001'), 2, 'Optional annotation and Union alias');
    console.log('  [PASS] typing/dataclass/import modernization rules fire on the legacy fixture');

    assert.ok(
      !report.issues.some((i) => i.location.file === 'modern_typing.py'),
      'the fully modern twin (PEP 585/604, slots, sections, datetime.UTC) must stay silent',
    );
    console.log('  [PASS] fully modern module stays silent');

    assert.deepStrictEqual(
      rulesIn('edge_cases.py'),
      [],
      'bare re-raise, multi-line `from`, awaited execute and non-query session calls stay silent',
    );
    console.log('  [PASS] async/raise edge cases produce no false positives');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run()
  .then(() => {
    console.log('\n ALL PYTHON MODERNIZATION KEY POINTS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
