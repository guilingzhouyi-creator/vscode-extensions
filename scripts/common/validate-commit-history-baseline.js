/**
 * Module: Commit-history freeze ledger guard.
 * File Path: scripts/common/validate-commit-history-baseline.js
 * Architecture Role: Prevents the freeze ledger from degrading into a general-purpose exemption.
 *   The ledger exists so that tightening a rule does not retroactively brick published history;
 *   it must never become a way to pre-forgive a commit that has not been pushed yet.
 * Dependencies & Triggers: Invoked by pre-push-gate (COMMIT-HISTORY-BASELINE-36) and audit-all.
 * Responsibilities:
 *   1. Assert every frozen commit predates the ledger's ratification instant;
 *   2. Assert every frozen SHA resolves to a real commit object (no fabricated entries);
 *   3. Assert frozen rule IDs are registered in the single-source rule catalog;
 *   4. Assert each entry's recorded timestamp matches the commit's real timestamp;
 *   5. Assert no entry leaves ruleIds empty (a blanket freeze is not a rule-scoped freeze).
 * Exit Semantics & Design Rationale: Exits 0 when the ledger is well-formed, 1 otherwise.
 *   The abuse this mechanism invites is self-exemption: appending a SHA for work the gate has
 *   never evaluated. Requiring every frozen commit to predate the ledger's ratification instant
 *   closes that path while still admitting commits written before a rule tightened.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LEDGER = path.join(__dirname, 'commit-history-baseline.json');
const CATALOG = path.join(__dirname, 'rule-catalog.json');
const UTF8 = 'utf8';
const EXPECTED_SCHEMA = 'commit-history-baseline/v1';
const SHA_LENGTH = 40;
const TIMESTAMP_TOLERANCE_MS = 1000;

/**
 * Reads object type and committer timestamp for many SHAs in one git invocation.
 *
 * The previous shape spawned two processes per entry (`git cat-file -t` and `git show -s --format`),
 * so a 29-entry ledger cost 58 process launches and measured 4.8 s — more than every other pre-push
 * guard combined. `git cat-file --batch` returns the type and the full object body on one stream, and
 * a commit body's `committer` line carries the same timestamp `--format=%ct` reports, so one call
 * answers both questions with identical semantics.
 *
 * The stream is consumed as a Buffer, not a string: the header declares the body length in *bytes*
 * while a decoded string is indexed in *characters*, and a Chinese commit body makes the two diverge
 * by hundreds of units. Slicing a decoded string by the declared size lands mid-body and the next
 * header is never found, which reads as "object missing" for every entry.
 *
 * @param {string[]} shas - Candidate SHAs.
 * @returns {Map<string, {type: string, committedMs: number}>} Facts keyed by the SHA as given.
 */
function readCommitFacts(shas) {
  const facts = new Map();
  if (shas.length === 0) return facts;
  let stream;
  try {
    stream = execFileSync('git', ['cat-file', '--batch'], {
      cwd: REPO_ROOT,
      input: `${shas.join('\n')}\n`,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return facts;
  }
  let cursor = 0;
  while (cursor < stream.length) {
    const newline = stream.indexOf(0x0a, cursor);
    if (newline < 0) break;
    const header = stream.subarray(cursor, newline).toString(UTF8);
    cursor = newline + 1;
    // "<sha> missing", "<sha> ambiguous", or "<sha> <type> <size>".
    const parts = header.split(' ');
    const sha = parts[0];
    if (parts.length < 3) {
      facts.set(sha, { type: '', committedMs: 0 });
      continue;
    }
    const type = parts[1];
    const size = Number(parts[2]);
    if (!Number.isFinite(size) || size < 0) {
      facts.set(sha, { type, committedMs: 0 });
      continue;
    }
    const body = stream.subarray(cursor, cursor + size).toString(UTF8);
    cursor += size + 1; // body bytes plus the separator newline
    facts.set(sha, { type, committedMs: type === 'commit' ? committerMs(body) : 0 });
  }
  return facts;
}

/**
 * Extracts the committer timestamp (seconds) from a raw commit object body.
 *
 * @param {string} body - Commit object body.
 * @returns {number} Unix seconds, or 0 when the line is absent or malformed.
 */
function committerMs(body) {
  const match = /^committer .*? (\d+) [+-]\d{4}$/m.exec(body);
  return match ? Number(match[1]) : 0;
}

/**
 * Returns the committer timestamp for a SHA, in milliseconds.
 *
 * Kept as a single-SHA convenience for callers that already hold one fact; the bulk path is
 * `readCommitFacts`, which the guard uses so a large ledger costs one process launch.
 *
 * @param {string} sha - Commit SHA.
 * @returns {number} Unix milliseconds, or 0 when unavailable.
 */
function commitTimestampMs(sha) {
  const fact = readCommitFacts([sha]).get(sha);
  return fact && fact.committedMs > 0 ? fact.committedMs * 1000 : 0;
}

/**
 * Resolves the object type of a SHA.
 *
 * @param {string} sha - Candidate commit SHA.
 * @returns {string} Object type, or empty string when the object is absent.
 */
function objectType(sha) {
  const fact = readCommitFacts([sha]).get(sha);
  return fact ? fact.type : '';
}

/**
 * Returns the ratification instant of the ledger, in milliseconds.
 *
 * Every frozen commit must predate this instant. Without it, an author could append their own
 * just-written SHA and exempt work the gate has never evaluated, which would turn the freeze
 * ledger into a general-purpose bypass.
 *
 * @param {object} ledger - Parsed ledger payload.
 * @returns {number} Unix milliseconds, or 0 when the ledger states no ratification.
 */
function ratificationInstant(ledger) {
  const raw = ledger.ratifiedAt;
  if (typeof raw !== 'string') return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Collects shape-level defects for one ledger entry that need no repository query.
 *
 * @param {object} entry - Ledger entry.
 * @param {Set<string>} registeredRuleIds - Registered rule identifiers.
 * @returns {string[]} Human-readable defects.
 */
function shapeDefects(entry, registeredRuleIds) {
  const label = (entry.sha || '(空)').slice(0, 8);
  const ruleIds = Array.isArray(entry.ruleIds) ? entry.ruleIds : [];
  const defects = [];

  if ((entry.sha || '').length !== SHA_LENGTH) defects.push(`${label}: SHA 长度不是 ${SHA_LENGTH}`);
  if (ruleIds.length === 0) defects.push(`${label}: ruleIds 为空，冻结必须指明所依据的具体规则`);
  for (const ruleId of ruleIds) {
    if (!registeredRuleIds.has(ruleId)) defects.push(`${label}: 未登记的规则标识 ${ruleId}`);
  }
  return defects;
}

/**
 * Collects repository-level defects for one ledger entry.
 *
 * @param {object} entry - Ledger entry.
 * @param {number} ratifiedAtMs - Ledger ratification instant in milliseconds.
 * @param {Map<string, {type: string, committedMs: number}>} facts - Bulk git facts.
 * @returns {string[]} Human-readable defects.
 */
function repositoryDefects(entry, ratifiedAtMs, facts) {
  const sha = entry.sha || '';
  const label = sha.slice(0, 8);
  const defects = [];
  const fact = facts.get(sha);

  if (!fact || fact.type !== 'commit') {
    defects.push(`${label}: 对象不存在或不是提交`);
    return defects;
  }

  // Core anti-abuse assertion: a frozen commit must predate the ledger's ratification,
  // proving it was written before the freeze existed rather than exempted after the fact.
  const committedMs = fact.committedMs * 1000;
  if (ratifiedAtMs > 0 && committedMs > ratifiedAtMs) {
    defects.push(`${label}: 提交时间晚于冻结清单生效时刻，不得自我豁免`);
  }

  if (entry.committedAt) {
    const recorded = Date.parse(entry.committedAt);
    const drift = Math.abs(recorded - committedMs);
    if (Number.isFinite(recorded) && committedMs > 0 && drift > TIMESTAMP_TOLERANCE_MS) {
      defects.push(`${label}: committedAt 与提交真实时间不一致`);
    }
  }
  return defects;
}

/**
 * Validates every ledger entry, combining shape and repository assertions.
 *
 * @param {Array<object>} entries - Frozen commit entries.
 * @param {Set<string>} registeredRuleIds - Registered rule identifiers.
 * @param {number} ratifiedAtMs - Ledger ratification instant in milliseconds.
 * @returns {string[]} All defects found.
 */
function collectEntryDefects(entries, registeredRuleIds, ratifiedAtMs) {
  const defects = [];
  const seen = new Set();
  const wellFormed = entries.filter((entry) => (entry.sha || '').length === SHA_LENGTH);
  const facts = readCommitFacts(wellFormed.map((entry) => entry.sha));

  for (const entry of entries) {
    const sha = entry.sha || '';
    if (seen.has(sha)) defects.push(`${sha.slice(0, 8)}: 清单内重复条目`);
    seen.add(sha);

    defects.push(...shapeDefects(entry, registeredRuleIds));
    if (sha.length === SHA_LENGTH) {
      defects.push(...repositoryDefects(entry, ratifiedAtMs, facts));
    }
  }
  return defects;
}

/**
 * Proves the guard rejects each defect class it claims to catch.
 *
 * A green run on a well-formed ledger proves nothing on its own: every one of these checks could be
 * dead code and the shipped ledger would still pass. Each probe injects one defect into an otherwise
 * valid entry and asserts the corresponding check fires.
 *
 * @returns {string[]} Probe failures.
 */
function runSelfProbes() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`probe "${label}": expected ${wanted}, got ${actual}`);
  };

  const ledger = JSON.parse(fs.readFileSync(LEDGER, UTF8));
  const entries = Array.isArray(ledger.frozenCommits) ? ledger.frozenCommits : [];
  const registered = new Set(['CMG-STY-001']);
  const ratified = ratificationInstant(ledger);
  const real = entries[0];
  expect('shipped-ledger-has-entries', entries.length > 0, true);
  expect('shipped-ledger-ratified', ratified > 0, true);

  // Shape: a blanket freeze names no rule, so the entry cannot say what it is frozen against.
  expect('empty-rule-ids-rejected', shapeDefects({ sha: real.sha, ruleIds: [] }, registered).length, 1);
  // Shape: an unregistered rule id is a rule nobody can look up.
  expect(
    'unregistered-rule-rejected',
    shapeDefects({ sha: real.sha, ruleIds: ['NOPE-000'] }, registered).length,
    1,
  );
  // Shape: a truncated SHA cannot be resolved and hides which commit is meant.
  expect('short-sha-rejected', shapeDefects({ sha: 'abc123', ruleIds: ['CMG-STY-001'] }, registered).length, 1);
  expect(
    'well-formed-entry-passes',
    shapeDefects({ sha: real.sha, ruleIds: ['CMG-STY-001'] }, registered).length,
    0,
  );

  // Repository: a fabricated SHA must be reported rather than silently trusted.
  const facts = readCommitFacts([real.sha, 'f'.repeat(SHA_LENGTH)]);
  expect('real-sha-resolves', facts.get(real.sha)?.type, 'commit');
  expect('fabricated-sha-rejected', repositoryDefects({ sha: 'f'.repeat(SHA_LENGTH) }, ratified, facts).length, 1);
  // Repository: the anti-abuse assertion — a commit after ratification must not be frozen.
  const future = repositoryDefects({ sha: real.sha }, 1, facts);
  expect('post-ratification-commit-rejected', future.length, 1);
  // Repository: a mis-recorded timestamp must be caught, not smoothed over.
  expect(
    'timestamp-drift-rejected',
    repositoryDefects({ sha: real.sha, committedAt: '2000-01-01T00:00:00Z' }, ratified, facts).length,
    1,
  );
  expect('matching-timestamp-passes', repositoryDefects({ sha: real.sha }, ratified, facts).length, 0);

  return failures;
}

function main() {
  const probeFailures = runSelfProbes();
  if (probeFailures.length > 0) {
    console.error('  ✖ BLOCK 提交历史冻结清单守卫自证失败:');
    for (const failure of probeFailures) console.error(`     • ${failure}`);
    return 1;
  }

  if (!fs.existsSync(LEDGER)) {
    console.log('  ✔  未使用提交历史冻结清单');
    return 0;
  }

  const ledger = JSON.parse(fs.readFileSync(LEDGER, UTF8));
  const entries = Array.isArray(ledger.frozenCommits) ? ledger.frozenCommits : [];
  const catalog = JSON.parse(fs.readFileSync(CATALOG, UTF8));
  const registeredRuleIds = new Set((catalog.rules || []).map((rule) => rule.id));
  const ratifiedAtMs = ratificationInstant(ledger);

  const defects = [];
  if (ledger.schema !== EXPECTED_SCHEMA) {
    defects.push(`schema 应为 ${EXPECTED_SCHEMA}，实际 ${ledger.schema}`);
  }
  if (ratifiedAtMs === 0) {
    defects.push('ratifiedAt 缺失或不可解析，冻结清单必须声明其生效时刻');
  }
  defects.push(...collectEntryDefects(entries, registeredRuleIds, ratifiedAtMs));

  if (defects.length > 0) {
    console.error('  ✖ BLOCK 提交历史冻结清单不合规:');
    for (const defect of defects) console.error(`     • ${defect}`);
    return 1;
  }

  console.log(
    `  ✔  提交历史冻结清单合规 (${entries.length} 笔提交，全部早于生效时刻 ` +
      `${new Date(ratifiedAtMs).toISOString()})`
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, runSelfProbes, readCommitFacts, shapeDefects, repositoryDefects };
