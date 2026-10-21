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
 * Returns the committer timestamp for a SHA, in milliseconds.
 *
 * @param {string} sha - Commit SHA.
 * @returns {number} Unix milliseconds, or 0 when unavailable.
 */
function commitTimestampMs(sha) {
  try {
    const out = execFileSync('git', ['show', '-s', '--format=%ct', sha], {
      cwd: REPO_ROOT,
      encoding: UTF8,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return (Number(out.trim()) || 0) * 1000;
  } catch {
    return 0;
  }
}

/**
 * Resolves the object type of a SHA.
 *
 * @param {string} sha - Candidate commit SHA.
 * @returns {string} Object type, or empty string when the object is absent.
 */
function objectType(sha) {
  try {
    const out = execFileSync('git', ['cat-file', '-t', sha], {
      cwd: REPO_ROOT,
      encoding: UTF8,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return '';
  }
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
 * @returns {string[]} Human-readable defects.
 */
function repositoryDefects(entry, ratifiedAtMs) {
  const sha = entry.sha || '';
  const label = sha.slice(0, 8);
  const defects = [];

  if (objectType(sha) !== 'commit') {
    defects.push(`${label}: 对象不存在或不是提交`);
    return defects;
  }

  // Core anti-abuse assertion: a frozen commit must predate the ledger's ratification,
  // proving it was written before the freeze existed rather than exempted after the fact.
  const committedMs = commitTimestampMs(sha);
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

  for (const entry of entries) {
    const sha = entry.sha || '';
    if (seen.has(sha)) defects.push(`${sha.slice(0, 8)}: 清单内重复条目`);
    seen.add(sha);

    defects.push(...shapeDefects(entry, registeredRuleIds));
    if (sha.length === SHA_LENGTH) {
      defects.push(...repositoryDefects(entry, ratifiedAtMs));
    }
  }
  return defects;
}

function main() {
  if (!fs.existsSync(LEDGER)) {
    console.log('  ✔ PASS  未使用提交历史冻结清单');
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
    `  ✔ PASS  提交历史冻结清单合规 (${entries.length} 笔提交，全部早于生效时刻 ` +
      `${new Date(ratifiedAtMs).toISOString()})`
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
