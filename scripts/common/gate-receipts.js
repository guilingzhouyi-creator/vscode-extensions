/**
 * Module: Local Git Commit-Gate Receipt Engine
 * File Path: scripts/common/gate-receipts.js
 * Architecture Role: Local audit authority for the commit gate. It records which interactive gate
 *   phases actually ran for a commit, materializes one receipt per commit under
 *   .git/gate-receipts/, and hands pre-push a per-commit verdict, so a --no-verify commit can no
 *   longer reach a remote without leaving evidence. It also guards ref updates: protected-branch
 *   deletion and non-fast-forward pushes to a protected branch.
 * Dependencies & Triggers: Node.js built-ins (crypto, fs, os, path, child_process) plus the local
 *   git executable; no third-party package and no other repository module. Invoked by the
 *   post-commit and post-merge hooks (finalize), by the pre-commit and commit-msg gates (mark), by
 *   the pre-push gate (verify-receipts, verify-refs), and manually (baseline, selftest).
 * Responsibilities:
 *   1. Merge per-phase markers written to pending/<ppid>.json without dropping sibling phases;
 *   2. Materialize a receipt from HEAD, tree, index digest, phases, actor and bypass facts, and
 *      preserve an already-verified receipt instead of downgrading it on a post-merge run;
 *   2b. Sign every receipt and the baseline with HMAC-SHA256 under a key that lives outside the
 *      repository, so a hand-written {verified:true} file can never pass the push audit;
 *   3. Exempt history at or below baseline.json, then require every pushed commit to carry a
 *      verified receipt, or record an explicit operator-allow-bypass line;
 *   4. Block protected-branch deletion and non-fast-forward pushes to a protected branch;
 *   5. Self-test every branch of the contract inside an isolated temporary Git repository.
 * Exit Semantics & Design Rationale: 0 = check passed or action succeeded, 1 = a gate blocked or an
 *   action failed, 2 = usage error. The engine must never fail in either direction silently: the
 *   post-* hooks may not interrupt Git, so finalize reports problems and still exits 0, while
 *   pre-push fails closed and treats an unreadable receipt exactly like a missing one. --no-verify
 *   cannot be prevented locally, so it is made observable instead: the absent receipt is the
 *   evidence, and an allowed bypass leaves a JSONL trail. Every JSON write is staged in the target
 *   directory and renamed, so an interrupted hook can never leave a half-written receipt that a
 *   later reader would misread as forged proof.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isProtectedBranch, validateBranchName } = require('./validate-branch-governance');

const SCHEMA_VERSION = 'gate-receipt-v1', RECEIPTS_DIRNAME = 'gate-receipts', PENDING_DIRNAME = 'pending';
const BASELINE_FILENAME = 'baseline.json', BYPASS_LOG_FILENAME = 'bypass.log';
const PHASES = Object.freeze(['pre-commit', 'commit-msg']), PHASE_STATUSES = Object.freeze(['pass', 'merge-structural']);
const DEFAULT_PHASE_STATUS = 'pass', SOURCE_HOOKS = Object.freeze(['post-commit', 'post-merge']), DEFAULT_SOURCE_HOOK = 'post-commit';
const PROTECTED_BRANCHES = Object.freeze(['main', 'master', 'integration']), PROTECTED_PREFIX = 'refs/heads/';
const BYPASS_REASON = 'no-verify-or-unrecorded', OPERATOR_BYPASS_REASON = 'operator-allow-bypass';
const MAX_PUSH_COMMITS = 2000, MERGE_BASE_PROBE_LIMIT = 200;
const ZERO_SHA = '0'.repeat(40), TAG_PASS = 'PASS', TAG_BLOCK = 'BLOCK', TAG_INFO = 'INFO';
const EXIT_OK = 0, EXIT_BLOCK = 1, EXIT_USAGE = 2;
const RECEIPT_MISSING_TEXT = '缺少有效门禁收据（疑似 --no-verify 或 cherry-pick/revert 直接产生）';
const RECEIPT_KEY_ENV = 'DSH_GATE_RECEIPT_KEY_FILE', RECEIPT_KEY_DIRNAME = '.dsh', RECEIPT_KEY_FILENAME = 'gate-receipt.key';
const RECEIPT_KEY_BYTES = 32, RECEIPT_KEY_MODE = 0o600, SIGNATURE_HEX_LENGTH = 64;
const RECEIPT_KEY_PATTERN = /^[0-9a-f]{64}$/i, SHA_HEX_PATTERN = /^[0-9a-f]{40}$/;
const SIGNATURE_FIELD = 'signature', SIGNATURE_ALG_FIELD = 'signatureAlg', SIGNATURE_ALG = 'hmac-sha256';

const USAGE = [
  '用法: node scripts/common/gate-receipts.js <命令> [选项]',
  '',
  '命令:',
  '  mark --phase <pre-commit|commit-msg> --ppid <数字> [--status <pass|merge-structural>]',
  '  finalize --ppid <数字> [--hook <post-commit|post-merge>]',
  '  rewrite                              # 读取 stdin 的 <old-sha> <new-sha> 行，重算并重签收据',
  '  baseline',
  '  verify-receipts --refs-file <路径> [--allow-bypass]',
  '  verify-refs --refs-file <路径>',
  '  selftest',
  '',
  '退出码: 0=通过/成功, 1=阻断/失败, 2=用法错误',
].join('\n');

const COMMAND_SPECS = new Map([
  ['mark', { values: ['phase', 'ppid', 'status'], flags: [], required: ['phase', 'ppid'] }],
  ['finalize', { values: ['ppid', 'hook'], flags: [], required: ['ppid'] }],
  ['verify-receipts', { values: ['refs-file'], flags: ['allow-bypass'], required: ['refs-file'] }],
  ['verify-refs', { values: ['refs-file'], flags: [], required: ['refs-file'] }],
  ['rewrite', { values: [], flags: [], required: [] }],
  ['baseline', { values: [], flags: [], required: [] }],
  ['selftest', { values: [], flags: [], required: [] }],
]);
const COMMAND_HANDLERS = new Map([
  ['mark', commandMark], ['finalize', commandFinalize], ['rewrite', commandRewrite], ['baseline', commandBaseline],
  ['verify-receipts', commandVerifyReceipts], ['verify-refs', commandVerifyRefs], ['selftest', commandSelftest],
]);

function toCamelCase(name) {
  return name.replace(/-([a-z0-9])/g, (match, character) => character.toUpperCase());
}

function usageError(message) {
  process.stderr.write(`用法错误: ${message}\n\n${USAGE}\n`);
  return EXIT_USAGE;
}

function failBlock(message) {
  process.stderr.write(`BLOCK ${message}\n`);
  return EXIT_BLOCK;
}

function parseCommandArgs(argv, spec) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) return { error: `参数必须以 -- 开头: ${arg}` };
    const name = arg.slice(2);
    if (spec.flags.includes(name)) { options[toCamelCase(name)] = true; continue; }
    if (!spec.values.includes(name)) return { error: `未知参数: ${arg}` };
    if (index + 1 >= argv.length) return { error: `参数 ${arg} 缺少取值` };
    options[toCamelCase(name)] = argv[index + 1];
    index += 1;
  }
  for (const name of spec.required) {
    if (options[toCamelCase(name)] === undefined) return { error: `缺少必填参数 --${name}` };
  }
  return { options };
}

function run(argv) {
  const command = argv[0];
  if (command === undefined) return usageError('缺少子命令');
  const spec = COMMAND_SPECS.get(command);
  if (spec === undefined) return usageError(`未知子命令: ${command}`);
  const parsed = parseCommandArgs(argv.slice(1), spec);
  if (parsed.error !== undefined) return usageError(`${command}: ${parsed.error}`);
  return COMMAND_HANDLERS.get(command)(parsed.options);
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, {
    cwd: cwd === undefined ? process.cwd() : cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    status: result.status === null ? -1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function gitText(args, cwd) {
  const result = runGit(args, cwd);
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitSucceeds(args) {
  return runGit(args).status === 0;
}

/**
 * Resolves the repository Git directory as an absolute path.
 *
 * git rev-parse --git-dir is relative to the worktree root for an ordinary repository, and every
 * receipt path is derived from the resolved value, so a relative answer must be anchored at the
 * worktree root rather than at the caller's possibly nested working directory.
 *
 * @param {string} [cwd] - Directory used for Git discovery; defaults to the process directory.
 * @returns {string|null} Absolute Git directory, or null outside a repository.
 */
function resolveGitDir(cwd) {
  const workTree = cwd === undefined ? process.cwd() : cwd;
  const raw = gitText(['rev-parse', '--git-dir'], workTree);
  if (raw === null) return null;
  if (path.isAbsolute(raw)) return path.normalize(raw);
  const topLevel = gitText(['rev-parse', '--show-toplevel'], workTree);
  return path.resolve(topLevel === null ? workTree : topLevel, raw);
}

function receiptsRoot(gitDir) {
  return path.join(gitDir, RECEIPTS_DIRNAME);
}

/**
 * Stages a complete file beside its destination and renames it into place.
 *
 * post-* hooks can be interrupted mid-write; rename within one directory is atomic, so a reader
 * sees either the previous file or the complete new one, never a half-written receipt.
 */
function writeFileAtomic(filePath, content) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, 'utf8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch (cleanupError) { void cleanupError; }
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function tryWriteJson(filePath, value) {
  try {
    writeJsonAtomic(filePath, value);
    return true;
  } catch (error) {
    process.stderr.write(`WARN 写入 ${filePath} 失败: ${error.message}\n`);
    return false;
  }
}

function appendJsonLinesAtomic(filePath, records) {
  if (!Array.isArray(records) || records.length === 0) return;
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? `${existing}\n` : existing;
  const lines = records.map((record) => `${JSON.stringify(record)}\n`).join('');
  writeFileAtomic(filePath, `${prefix}${lines}`);
}

function readJsonSafe(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch (error) { void error; return null; }
}

function nowIso() {
  return new Date().toISOString();
}

let cachedReceiptKey;

/**
 * Canonicalizes a JSON value so a signature never depends on key insertion order.
 *
 * @param {unknown} value - Arbitrary JSON value.
 * @returns {unknown} Value with object keys sorted recursively.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value === null || typeof value !== 'object') return value;
  const ordered = {};
  for (const key of Object.keys(value).sort()) ordered[key] = canonicalize(value[key]);
  return ordered;
}

/**
 * Loads the receipt signing key from env override or ~/.dsh, generating 32 random bytes on first
 * use. The key never lives inside the repository, so a commit cannot carry its own forge tool.
 *
 * @returns {{key: Buffer}|{error: string}} Key material or a fail-closed reason.
 */
function readReceiptKey() {
  if (cachedReceiptKey !== undefined) return cachedReceiptKey;
  const configured = process.env[RECEIPT_KEY_ENV];
  const keyPath = typeof configured === 'string' && configured.trim().length > 0
    ? path.resolve(configured.trim()) : path.join(os.homedir(), RECEIPT_KEY_DIRNAME, RECEIPT_KEY_FILENAME);
  try {
    if (!fs.existsSync(keyPath)) {
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, `${crypto.randomBytes(RECEIPT_KEY_BYTES).toString('hex')}\n`, { encoding: 'utf8', mode: RECEIPT_KEY_MODE });
      try { fs.chmodSync(keyPath, RECEIPT_KEY_MODE); } catch (error) { process.stderr.write(`WARN 无法把收据密钥权限收紧到 0600（${error.message}）\n`); }
    }
    const raw = fs.readFileSync(keyPath, 'utf8').trim();
    if (!RECEIPT_KEY_PATTERN.test(raw)) { cachedReceiptKey = { error: `密钥文件内容不是 64 位十六进制: ${keyPath}` }; return cachedReceiptKey; }
    cachedReceiptKey = { key: Buffer.from(raw, 'hex') };
  } catch (error) { cachedReceiptKey = { error: `无法读写收据密钥 ${keyPath}: ${error.message}` }; }
  return cachedReceiptKey;
}

/**
 * Computes the HMAC-SHA256 signature over the canonical payload: only the signature field is
 * stripped, so signatureAlg stays covered by the MAC and any byte edit invalidates the record.
 *
 * @param {object} record - Receipt or baseline record.
 * @param {Buffer} key - HMAC key.
 * @returns {string} Lowercase hex MAC.
 */
function computeSignature(record, key) {
  const payload = { ...record };
  delete payload[SIGNATURE_FIELD];
  return crypto.createHmac('sha256', key).update(JSON.stringify(canonicalize(payload)), 'utf8').digest('hex');
}

/**
 * Returns a copy of the record carrying signatureAlg and its MAC.
 *
 * @param {object} record - Receipt or baseline record.
 * @param {Buffer} key - HMAC key.
 * @returns {object} Signed record.
 */
function attachSignature(record, key) {
  const signed = { ...record, [SIGNATURE_ALG_FIELD]: SIGNATURE_ALG };
  signed[SIGNATURE_FIELD] = computeSignature(signed, key);
  return signed;
}

/**
 * Verifies a record signature and fails closed on every abnormal shape.
 *
 * @param {object|null} record - Parsed record.
 * @returns {{ok: boolean, reason: string}} Verification outcome.
 */
function verifyRecordSignature(record) {
  if (record === null || typeof record !== 'object') return { ok: false, reason: '记录不存在' };
  if (record[SIGNATURE_ALG_FIELD] !== SIGNATURE_ALG) return { ok: false, reason: `${SIGNATURE_ALG_FIELD}=${String(record[SIGNATURE_ALG_FIELD])} 不是 ${SIGNATURE_ALG}` };
  const actualHex = record[SIGNATURE_FIELD];
  if (typeof actualHex !== 'string' || actualHex.length !== SIGNATURE_HEX_LENGTH) return { ok: false, reason: '缺少合法 signature' };
  const keyed = readReceiptKey();
  if (keyed.error !== undefined) return { ok: false, reason: keyed.error };
  const expected = Buffer.from(computeSignature(record, keyed.key), 'hex'), actual = Buffer.from(actualHex.toLowerCase(), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return { ok: false, reason: '签名不匹配' };
  return { ok: true, reason: '' };
}


function isZeroSha(sha) {
  return /^0+$/.test(sha);
}

function isDecimal(value) {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function shortSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 8) : '';
}

function removePendingFile(pendingPath) {
  try {
    fs.unlinkSync(pendingPath);
  } catch (error) {
    if (error.code !== 'ENOENT') process.stderr.write(`WARN 删除 pending 标记失败: ${error.message}\n`);
  }
}

function readPendingPhases(record) {
  return record !== null && typeof record.phases === 'object' && record.phases !== null ? record.phases : {};
}

function hashIndexListing() {
  const listing = runGit(['ls-files', '-s']);
  return crypto.createHash('sha1').update(listing.status === 0 ? listing.stdout : '', 'utf8').digest('hex');
}

function resolveActor() {
  const email = gitText(['config', 'user.email']);
  return email === null || email.length === 0 ? 'unknown' : email;
}

function resolveBypassReason() {
  const match = /^(cherry-pick|revert|am|rebase)/.exec(gitText(['reflog', '-1', '--format=%gs']) || '');
  return match === null ? BYPASS_REASON : match[1];
}

/**
 * Records one interactive gate phase under pending/<ppid>.json.
 *
 * The pending record is merged, never replaced: pre-commit and commit-msg arrive from different hook
 * processes that share one parent shell, so a sibling phase must survive the later write.
 */
function commandMark(options) {
  if (!PHASES.includes(options.phase)) return usageError(`mark: --phase 必须是 ${PHASES.join('|')}`);
  if (!isDecimal(options.ppid)) return usageError('mark: --ppid 必须是十进制数字');
  const status = options.status === undefined ? DEFAULT_PHASE_STATUS : options.status;
  if (!PHASE_STATUSES.includes(status)) return usageError(`mark: --status 必须是 ${PHASE_STATUSES.join('|')}`);
  const gitDir = resolveGitDir();
  if (gitDir === null) return failBlock('mark: 无法解析 Git 目录（不在 Git 仓库内）');
  const pendingPath = path.join(receiptsRoot(gitDir), PENDING_DIRNAME, `${options.ppid}.json`);
  const existing = readJsonSafe(pendingPath);
  const phases = { ...readPendingPhases(existing) };
  const entry = { status, at: nowIso() };
  if (options.phase === 'pre-commit') entry.treeSha = gitText(['write-tree']) || '';
  phases[options.phase] = entry;
  const record = {
    schemaVersion: SCHEMA_VERSION,
    ppid: Number(options.ppid),
    phases,
    createdAt: existing !== null && typeof existing.createdAt === 'string' ? existing.createdAt : nowIso(),
  };
  try {
    writeJsonAtomic(pendingPath, record);
  } catch (error) {
    return failBlock(`mark: 写入 pending 标记失败（${error.message}）`);
  }
  console.log(`PASS 阶段标记 ${options.phase} 已记录（ppid=${options.ppid}）`);
  return EXIT_OK;
}

/**
 * Materializes the final receipt for HEAD and retires the pending marker.
 *
 * Called from post-commit/post-merge, so it must never interrupt Git: failures are reported and the
 * exit code remains 0. An already-verified receipt is left untouched, because a non-fast-forward
 * merge's post-merge would otherwise downgrade proven evidence into bypass.
 */
function commandFinalize(options) {
  const hook = options.hook === undefined ? DEFAULT_SOURCE_HOOK : options.hook;
  if (!SOURCE_HOOKS.includes(hook)) return usageError(`finalize: --hook 必须是 ${SOURCE_HOOKS.join('|')}`);
  if (!isDecimal(options.ppid)) return usageError('finalize: --ppid 必须是十进制数字');
  const headSha = gitText(['rev-parse', 'HEAD']);
  if (headSha === null) { console.log('SKIP 无 HEAD 提交可记录（空仓库或未提交）'); return EXIT_OK; }
  const gitDir = resolveGitDir();
  if (gitDir === null) { process.stderr.write('WARN 当前目录不是 Git 仓库，跳过收据生成\n'); return EXIT_OK; }
  const receipts = receiptsRoot(gitDir);
  const pendingPath = path.join(receipts, PENDING_DIRNAME, `${options.ppid}.json`);
  const phases = readPendingPhases(readJsonSafe(pendingPath));
  const treeSha = gitText(['rev-parse', `${headSha}^{tree}`]) || '';
  const allPhasesPresent = PHASES.every((phase) => Object.prototype.hasOwnProperty.call(phases, phase));
  const preCommitTree = phases['pre-commit'] && typeof phases['pre-commit'].treeSha === 'string' ? phases['pre-commit'].treeSha : '';
  const treeMatched = preCommitTree.length === 0 || preCommitTree === treeSha;
  const verified = allPhasesPresent && treeMatched;
  const receiptPath = path.join(receipts, `${headSha}.json`);
  const existing = readJsonSafe(receiptPath);
  if (isTrustedVerifiedReceipt(existing, headSha)) {
    removePendingFile(pendingPath);
    console.log(`SKIP 收据 ${shortSha(headSha)} 已存在且 verified=true，保持不变`);
    return EXIT_OK;
  }
  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    commitSha: headSha,
    treeSha,
    indexDigest: hashIndexListing(),
    phases,
    verified,
    bypass: !verified,
    bypassReason: verified ? null : (!treeMatched ? 'staged-tree-mismatch' : resolveBypassReason()),
    sourceHook: hook,
    actor: resolveActor(),
    createdAt: nowIso(),
  };
  const keyed = readReceiptKey();
  if (keyed.error !== undefined) process.stderr.write(`WARN 收据未签名，push 阶段将 fail-closed 阻断: ${keyed.error}\n`);
  tryWriteJson(receiptPath, keyed.error !== undefined ? { ...receipt, [SIGNATURE_ALG_FIELD]: SIGNATURE_ALG, [SIGNATURE_FIELD]: '' } : attachSignature(receipt, keyed.key));
  removePendingFile(pendingPath);
  console.log(`PASS 收据 ${shortSha(headSha)} verified=${verified} hook=${hook}`);
  return EXIT_OK;
}

/**
 * Parses the "<old-sha> <new-sha>" lines Git feeds to a post-rewrite hook.
 *
 * @param {string} raw - Complete stdin text.
 * @returns {{pairs: Array<{oldSha: string, newSha: string}>}|{error: string}} Parse outcome.
 */
function parseRewriteLines(raw) {
  const pairs = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const columns = line.split(/\s+/);
    if (columns.length < 2) return { error: `post-rewrite 行必须是 <old-sha> <new-sha>: ${line}` };
    const oldSha = columns[0].toLowerCase();
    const newSha = columns[1].toLowerCase();
    if (!SHA_HEX_PATTERN.test(oldSha) || !SHA_HEX_PATTERN.test(newSha)) {
      return { error: `post-rewrite 行包含非 40 位 sha: ${line}` };
    }
    pairs.push({ oldSha, newSha });
  }
  return { pairs };
}

/**
 * Reads the hook stdin payload without ever throwing on a closed or empty stream.
 *
 * @returns {string} stdin text, empty when unavailable.
 */
function readStdinText() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (error) {
    void error;
    return '';
  }
}

/**
 * Re-materializes one receipt for a rewritten commit.
 *
 * The old receipt must be authentically signed, otherwise nothing is propagated: rewriting is a
 * provenance carry-forward, never a laundering step for forged evidence.
 *
 * @param {string} receipts - Absolute receipts root.
 * @param {Buffer} key - HMAC key.
 * @param {{oldSha: string, newSha: string}} pair - Rewrite pair.
 * @returns {string} Operator-facing one-line outcome.
 */
function rewriteOneReceipt(receipts, key, pair) {
  if (pair.oldSha === pair.newSha) return `SKIP 收据重写 ${shortSha(pair.newSha)}：新旧 sha 相同`;
  const oldReceipt = readJsonSafe(path.join(receipts, `${pair.oldSha}.json`));
  if (oldReceipt === null) {
    return `WARN 收据重写跳过 ${shortSha(pair.oldSha)} -> ${shortSha(pair.newSha)}：旧收据不存在`;
  }
  if (oldReceipt.commitSha !== pair.oldSha) {
    return `WARN 收据重写跳过 ${shortSha(pair.oldSha)} -> ${shortSha(pair.newSha)}：旧收据 commitSha 不匹配`;
  }
  const oldTrust = verifyRecordSignature(oldReceipt);
  if (!oldTrust.ok) {
    return `WARN 收据重写跳过 ${shortSha(pair.oldSha)} -> ${shortSha(pair.newSha)}：旧收据签名不可信（${oldTrust.reason}）`;
  }
  const existing = readJsonSafe(path.join(receipts, `${pair.newSha}.json`));
  if (isTrustedVerifiedReceipt(existing, pair.newSha)) {
    return `SKIP 收据重写 ${shortSha(pair.newSha)}：已有可信收据，保持不变`;
  }
  const verified = oldReceipt.verified === true && oldReceipt.bypass === false;
  const rewritten = attachSignature(
    {
      schemaVersion: oldReceipt.schemaVersion || SCHEMA_VERSION,
      commitSha: pair.newSha,
      treeSha: gitText(['rev-parse', `${pair.newSha}^{tree}`]) || '',
      indexDigest: typeof oldReceipt.indexDigest === 'string' ? oldReceipt.indexDigest : '',
      phases: typeof oldReceipt.phases === 'object' && oldReceipt.phases !== null ? oldReceipt.phases : {},
      verified,
      bypass: !verified,
      bypassReason: verified ? null : oldReceipt.bypassReason || BYPASS_REASON,
      sourceHook: 'post-rewrite',
      actor: typeof oldReceipt.actor === 'string' ? oldReceipt.actor : resolveActor(),
      createdAt: typeof oldReceipt.createdAt === 'string' ? oldReceipt.createdAt : nowIso(),
      rewrittenFrom: pair.oldSha,
      rewrittenAt: nowIso(),
    },
    key,
  );
  if (!tryWriteJson(path.join(receipts, `${pair.newSha}.json`), rewritten)) {
    return `WARN 收据重写写入失败 ${shortSha(pair.newSha)}`;
  }
  return `PASS 收据重写 ${shortSha(pair.oldSha)} -> ${shortSha(pair.newSha)} verified=${verified}`;
}

/**
 * Rewrites receipts after commit --amend or rebase, driven by the post-rewrite hook's stdin.
 *
 * Never blocks Git: post-rewrite is a post-transaction hook and must leave the rebase result intact;
 * every problem becomes a WARN line and the exit code stays 0.
 *
 * @param {object} options - Parsed CLI options (unused).
 * @returns {number} Always EXIT_OK.
 */
function commandRewrite(options) {
  void options;
  const gitDir = resolveGitDir();
  if (gitDir === null) {
    process.stderr.write('WARN 当前目录不是 Git 仓库，跳过收据重写\n');
    return EXIT_OK;
  }
  const keyed = readReceiptKey();
  if (keyed.error !== undefined) {
    process.stderr.write(`WARN 无法加载收据签名密钥，跳过收据重写: ${keyed.error}\n`);
    return EXIT_OK;
  }
  const parsed = parseRewriteLines(readStdinText());
  if (parsed.error !== undefined) {
    process.stderr.write(`WARN ${parsed.error}\n`);
    return EXIT_OK;
  }
  if (parsed.pairs.length === 0) {
    console.log('SKIP 收据重写：stdin 没有 <old-sha> <new-sha> 行');
    return EXIT_OK;
  }
  const receipts = receiptsRoot(gitDir);
  for (const pair of parsed.pairs) console.log(rewriteOneReceipt(receipts, keyed.key, pair));
  return EXIT_OK;
}

/**
 * Pins the current HEAD as trusted history for later pre-push checks.
 *
 * Exempting older history is an explicit, recorded operator decision, never a silently forged
 * receipt; an empty repository stores an empty commitSha and exempts nothing.
 */
function commandBaseline() {
  const gitDir = resolveGitDir();
  if (gitDir === null) return failBlock('baseline: 无法解析 Git 目录（不在 Git 仓库内）');
  const keyed = readReceiptKey();
  if (keyed.error !== undefined) return failBlock(`baseline: 无法加载收据签名密钥（${keyed.error}）`);
  const commitSha = gitText(['rev-parse', 'HEAD']) || '';
  const baseline = attachSignature({ schemaVersion: SCHEMA_VERSION, commitSha, createdAt: nowIso() }, keyed.key);
  if (!tryWriteJson(path.join(receiptsRoot(gitDir), BASELINE_FILENAME), baseline)) {
    return failBlock('baseline: 写入 baseline 失败，拒绝留下不可信豁免');
  }
  console.log(`PASS 写入 baseline（commitSha=${commitSha.length === 0 ? '(empty)' : shortSha(commitSha)}，已签名）`);
  return EXIT_OK;
}

/**
 * Parses the four-column ref update list Git feeds to a pre-push hook.
 *
 * Each line is "<local ref> <local sha> <remote ref> <remote sha>"; blank lines are legal and an
 * all-zero local sha marks a deletion, which only verify-refs judges.
 */
function readRefsFile(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return { error: '--refs-file 缺少取值' };
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return { error: `无法读取 refs 文件 ${filePath}: ${error.message}` };
  }
  const rows = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const columns = line.split(/\s+/);
    if (columns.length !== 4) return { error: `refs 行必须是 4 列: ${line}` };
    rows.push({
      localRef: columns[0],
      localSha: columns[1].toLowerCase(),
      remoteRef: columns[2],
      remoteSha: columns[3].toLowerCase(),
    });
  }
  return { rows };
}

function resolvePushRange(row) {
  const remoteExists = !isZeroSha(row.remoteSha) && gitSucceeds(['cat-file', '-e', `${row.remoteSha}^{commit}`]);
  const args = remoteExists ? ['rev-list', `${row.remoteSha}..${row.localSha}`] : ['rev-list', row.localSha];
  const result = runGit(args);
  if (result.status !== 0) return { error: true };
  const commits = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { commits, truncated: commits.length > MAX_PUSH_COMMITS };
}

function readCommitAncestors(baselineSha) {
  const ancestors = new Set();
  const result = runGit(['rev-list', baselineSha]);
  if (result.status !== 0) return ancestors;
  for (const line of result.stdout.split('\n')) {
    const sha = line.trim();
    if (sha.length > 0) ancestors.add(sha);
  }
  return ancestors;
}

function resolveBaselineSha(receipts) {
  const baseline = readJsonSafe(path.join(receipts, BASELINE_FILENAME));
  if (baseline === null || !verifyRecordSignature(baseline).ok) return '';
  return typeof baseline.commitSha === 'string' ? baseline.commitSha : '';
}

function createBaselineExemptionLookup(baselineSha, commitCount, ancestorCache) {
  if (baselineSha.length === 0) return () => false;
  if (commitCount <= MERGE_BASE_PROBE_LIMIT && !ancestorCache.set) {
    return (sha) => gitSucceeds(['merge-base', '--is-ancestor', sha, baselineSha]);
  }
  if (!ancestorCache.set) ancestorCache.set = readCommitAncestors(baselineSha);
  const ancestors = ancestorCache.set;
  return (sha) => ancestors.has(sha);
}

function isTrustedVerifiedReceipt(receipt, expectedSha) {
  if (receipt === null || receipt.schemaVersion !== SCHEMA_VERSION) return false;
  if (receipt.commitSha !== expectedSha) return false;
  if (receipt.verified !== true || receipt.bypass !== false) return false;
  return verifyRecordSignature(receipt).ok;
}

function hasVerifiedReceipt(receipts, sha) {
  return isTrustedVerifiedReceipt(readJsonSafe(path.join(receipts, `${sha}.json`)), sha);
}

function violationNote(violation) {
  if (violation.kind === 'range-error') return '无法枚举推送提交范围';
  if (violation.kind === 'range-truncated') return `推送提交超过 ${MAX_PUSH_COMMITS} 个上限且超出历史未获可信收据或基线豁免`;
  return RECEIPT_MISSING_TEXT;
}

function collectRowViolations(row, receipts, baselineSha, ancestorCache, violations) {
  const range = resolvePushRange(row);
  if (range.error === true) {
    violations.push({ sha: row.localSha, remoteRef: row.remoteRef, kind: 'range-error' });
    return;
  }
  const isExempt = createBaselineExemptionLookup(baselineSha, range.commits.length, ancestorCache);
  for (const sha of range.commits.slice(0, MAX_PUSH_COMMITS)) {
    if (isExempt(sha)) continue;
    if (!hasVerifiedReceipt(receipts, sha)) violations.push({ sha, remoteRef: row.remoteRef, kind: 'missing-receipt' });
  }
  if (range.truncated) {
    const firstUnchecked = range.commits.slice(MAX_PUSH_COMMITS).find((sha) => !isExempt(sha));
    if (firstUnchecked !== undefined) {
      violations.push({ sha: firstUnchecked, remoteRef: row.remoteRef, kind: 'range-truncated' });
    }
  }
}

function collectReceiptViolations(rows, receipts) {
  const baselineSha = resolveBaselineSha(receipts);
  const ancestorCache = { set: null };
  const violations = [];
  for (const row of rows) {
    if (isZeroSha(row.localSha)) continue;
    collectRowViolations(row, receipts, baselineSha, ancestorCache, violations);
  }
  return violations;
}

function recordOperatorBypass(receipts, violations) {
  const logPath = path.join(receipts, BYPASS_LOG_FILENAME);
  const ts = nowIso();
  const records = violations.map((violation) => ({
    ts,
    commit: violation.sha,
    ref: violation.remoteRef,
    reason: OPERATOR_BYPASS_REASON,
  }));
  try {
    appendJsonLinesAtomic(logPath, records);
    for (const violation of violations) {
      console.log(`WARN 提交 ${shortSha(violation.sha)} ${violationNote(violation)}，已按 --allow-bypass 记录豁免（ref=${violation.remoteRef}）`);
    }
  } catch (error) {
    process.stderr.write(`BLOCK 无法写入 bypass.log（${error.message}），拒绝放行\n`);
    return EXIT_BLOCK;
  }
  console.log(`WARN 本次推送共 ${violations.length} 个提交按 --allow-bypass 放行，已写入 bypass.log`);
  return EXIT_OK;
}

/**
 * Judges every commit that the push would add to the remote.
 *
 * Fails closed: an unreadable receipt means exactly the same as a missing one. --allow-bypass turns
 * the same violations into an explicit JSONL trail and lets the push proceed on operator record.
 */
function commandVerifyReceipts(options) {
  const refs = readRefsFile(options.refsFile);
  if (refs.error !== undefined) return usageError(`verify-receipts: ${refs.error}`);
  const gitDir = resolveGitDir();
  if (gitDir === null) return failBlock('verify-receipts: 无法解析 Git 目录（不在 Git 仓库内）');
  const keyed = readReceiptKey();
  if (keyed.error !== undefined) return failBlock(`verify-receipts: 无法加载收据签名密钥（${keyed.error}）`);
  const receipts = receiptsRoot(gitDir);
  const baselinePath = path.join(receipts, BASELINE_FILENAME);
  if (fs.existsSync(baselinePath)) {
    const baseline = readJsonSafe(baselinePath);
    const baselineTrust = verifyRecordSignature(baseline);
    if (!baselineTrust.ok) return failBlock(`verify-receipts: baseline 签名校验失败（${baselineTrust.reason}）`);
  }
  const violations = collectReceiptViolations(refs.rows, receipts);
  if (violations.length === 0) {
    console.log(`PASS 收据校验通过：${refs.rows.length} 条 ref 范围内没有缺少有效收据的提交`);
    return EXIT_OK;
  }
  if (options.allowBypass === true) return recordOperatorBypass(receipts, violations);
  for (const violation of violations) {
    console.log(`BLOCK 提交 ${shortSha(violation.sha)} ${violationNote(violation)}`);
  }
  console.log(`本次推送共 ${violations.length} 个提交缺少有效门禁收据，已阻断。`);
  return EXIT_BLOCK;
}

function isProtectedRef(remoteRef) {
  if (!remoteRef.startsWith(PROTECTED_PREFIX)) return false;
  return isProtectedBranch(remoteRef.slice(PROTECTED_PREFIX.length));
}

/**
 * Applies the ref-safety and branch-governance rules to one update row.
 *
 * Deletion is judged before any object lookup, a new branch must conform to the 5-tier taxonomy,
 * and a remote object missing locally yields INFO: an unjudgeable update must not become a proven violation.
 */
function evaluateRefRow(row) {
  if (isZeroSha(row.localSha)) {
    return isProtectedRef(row.remoteRef)
      ? { tag: TAG_BLOCK, note: '受保护分支删除被拒绝' }
      : { tag: TAG_PASS, note: '非受保护分支删除，放行' };
  }
  if (isZeroSha(row.remoteSha)) {
    const branchName = row.remoteRef.startsWith(PROTECTED_PREFIX) ? row.remoteRef.slice(PROTECTED_PREFIX.length) : row.remoteRef;
    const v = validateBranchName(branchName);
    return v.valid
      ? { tag: TAG_PASS, note: `新建分形规范分支 (Tier ${v.tier})，放行` }
      : { tag: TAG_BLOCK, note: `新建非标分支被拒绝 (FGT-TOP-001): ${v.error}` };
  }
  if (!gitSucceeds(['cat-file', '-e', `${row.remoteSha}^{commit}`])) {
    return { tag: TAG_INFO, note: '远端对象本地缺失，无法判定快进关系，放行' };
  }
  if (gitSucceeds(['merge-base', '--is-ancestor', row.remoteSha, row.localSha])) {
    return { tag: TAG_PASS, note: '快进推送，放行' };
  }
  return isProtectedRef(row.remoteRef)
    ? { tag: TAG_BLOCK, note: '非快进推送到受保护分支被拒绝' }
    : { tag: TAG_PASS, note: '非受保护分支非快进推送，放行' };
}

function formatRefVerdict(verdict, row) {
  return `${verdict.tag} ${row.remoteRef} ${shortSha(row.localSha)} -> ${shortSha(row.remoteSha)} ${verdict.note}`;
}

function commandVerifyRefs(options) {
  const refs = readRefsFile(options.refsFile);
  if (refs.error !== undefined) return usageError(`verify-refs: ${refs.error}`);
  if (resolveGitDir() === null) return failBlock('verify-refs: 无法解析 Git 目录（不在 Git 仓库内）');
  let violations = 0;
  for (const row of refs.rows) {
    const verdict = evaluateRefRow(row);
    console.log(formatRefVerdict(verdict, row));
    if (verdict.tag === TAG_BLOCK) violations += 1;
  }
  return violations === 0 ? EXIT_OK : EXIT_BLOCK;
}

const GIT_ENV_KEYS = Object.freeze(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']);
function detachGitEnvironment() {
  const saved = new Map();
  for (const key of GIT_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  }
  return saved;
}

function restoreGitEnvironment(saved) {
  for (const [key, value] of saved) process.env[key] = value;
}

function expectSelftestGit(dir, args, label) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  const status = result.status === null ? -1 : result.status;
  if (status !== 0) {
    throw new Error(`${label}: git ${args.join(' ')} 失败(${status}): ${(result.stderr || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function selftestCli(repo, args) {
  return spawnSync(process.execPath, [__filename, ...args], { cwd: repo.dir, encoding: 'utf8', windowsHide: true });
}

function selftestCliWithInput(repo, args, input) {
  return spawnSync(process.execPath, [__filename, ...args], {
    cwd: repo.dir,
    encoding: 'utf8',
    windowsHide: true,
    input,
  });
}

function expectSelftestExit(result, expected, label) {
  const status = result.status === null ? -1 : result.status;
  if (status !== expected) {
    throw new Error(
      `${label}: 期望 exit ${expected}，实际 ${status}；stdout=${(result.stdout || '').trim()} stderr=${(result.stderr || '').trim()}`,
    );
  }
}

function assertSelftest(condition, message) {
  if (!condition) throw new Error(message);
}

function selftestCase(label, produce) {
  try {
    return { label, ok: true, detail: produce() || 'ok' };
  } catch (error) {
    return { label, ok: false, detail: error.message };
  }
}

function createSelftestRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-receipts-selftest-'));
  expectSelftestGit(dir, ['init', '-q'], '自测初始化临时仓库');
  expectSelftestGit(dir, ['config', 'user.email', 'selftest@example.invalid'], '自测配置邮箱');
  expectSelftestGit(dir, ['config', 'user.name', 'Gate Receipt Selftest'], '自测配置用户名');
  expectSelftestGit(dir, ['config', 'commit.gpgsign', 'false'], '自测关闭提交签名');
  const hookDir = path.join(dir, 'no-hooks').replace(/\\/g, '/');
  expectSelftestGit(dir, ['config', 'core.hooksPath', hookDir], '自测隔离 hooks');
  return { dir };
}

function commitSelftestFile(repo, fileName, content, message) {
  fs.writeFileSync(path.join(repo.dir, fileName), content, 'utf8');
  expectSelftestGit(repo.dir, ['add', fileName], '自测暂存文件');
  expectSelftestGit(repo.dir, ['commit', '-q', '-m', message], '自测创建提交');
  return expectSelftestGit(repo.dir, ['rev-parse', 'HEAD'], '自测读取 HEAD');
}

function writeSelftestRefs(repo, name, lines) {
  const filePath = path.join(repo.dir, `${name}-refs.txt`);
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

function refLine(localRef, localSha, remoteRef, remoteSha) {
  return `${localRef} ${localSha} ${remoteRef} ${remoteSha}`;
}

function selftestReceipts(repo) {
  return receiptsRoot(resolveGitDir(repo.dir));
}

function countNonEmptyLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim().length > 0).length;
}

function readLastJsonLine(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  return JSON.parse(lines[lines.length - 1]);
}

function selftestUnsignedReceiptBlocked(repo) {
  return selftestCase('h) 手写 {verified:true} 无签名收据 => verify-receipts exit 1', () => {
    const sha = commitSelftestFile(repo, 'unsigned.txt', 'one\n', 'unsigned target');
    const receipts = selftestReceipts(repo);
    fs.mkdirSync(receipts, { recursive: true });
    const forgedPath = path.join(receipts, `${sha}.json`);
    fs.writeFileSync(forgedPath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, commitSha: sha, verified: true, bypass: false }), 'utf8');
    const parent = expectSelftestGit(repo.dir, ['rev-parse', `${sha}^`], '自测读取父提交');
    const refsFile = writeSelftestRefs(repo, 'unsigned', [refLine('refs/heads/main', sha, 'refs/heads/main', parent)]);
    const blocked = selftestCli(repo, ['verify-receipts', '--refs-file', refsFile]);
    expectSelftestExit(blocked, 1, 'verify-receipts 无签名收据');
    assertSelftest(blocked.stdout.includes('BLOCK 提交'), '无签名收据未产出 BLOCK 行');
    fs.unlinkSync(forgedPath);
    return '无签名收据 exit=1 且产出 BLOCK 行';
  });
}

function selftestTamperedSignatureBlocked(repo) {
  return selftestCase('i) 收据签名改一字节 => verify-receipts exit 1', () => {
    const sha = commitSelftestFile(repo, 'tamper.txt', 'one\n', 'tamper target');
    expectSelftestExit(selftestCli(repo, ['mark', '--phase', 'pre-commit', '--ppid', '6161']), 0, 'mark pre-commit');
    expectSelftestExit(selftestCli(repo, ['mark', '--phase', 'commit-msg', '--ppid', '6161']), 0, 'mark commit-msg');
    expectSelftestExit(selftestCli(repo, ['finalize', '--ppid', '6161']), 0, 'finalize');
    const receiptPath = path.join(selftestReceipts(repo), `${sha}.json`);
    const receipt = readJsonSafe(receiptPath);
    assertSelftest(receipt !== null && typeof receipt.signature === 'string', '收据缺少 signature');
    const flipped = receipt.signature.startsWith('0') ? `1${receipt.signature.slice(1)}` : `0${receipt.signature.slice(1)}`;
    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, signature: flipped }, null, 2)}\n`, 'utf8');
    const parent = expectSelftestGit(repo.dir, ['rev-parse', `${sha}^`], '自测读取父提交');
    const refsFile = writeSelftestRefs(repo, 'tampered', [refLine('refs/heads/main', sha, 'refs/heads/main', parent)]);
    expectSelftestExit(selftestCli(repo, ['verify-receipts', '--refs-file', refsFile]), 1, 'verify-receipts 被篡改签名');
    fs.unlinkSync(receiptPath);
    return '篡改签名 exit=1';
  });
}

function selftestRewriteAfterAmend(repo) {
  return selftestCase('j) post-rewrite 把旧收据重算到新 sha 并标 rewrittenFrom', () => {
    const oldSha = commitSelftestFile(repo, 'rewrite.txt', 'one\n', 'rewrite target');
    expectSelftestExit(selftestCli(repo, ['mark', '--phase', 'pre-commit', '--ppid', '7171']), 0, 'mark pre-commit');
    expectSelftestExit(selftestCli(repo, ['mark', '--phase', 'commit-msg', '--ppid', '7171']), 0, 'mark commit-msg');
    expectSelftestExit(selftestCli(repo, ['finalize', '--ppid', '7171']), 0, 'finalize');
    expectSelftestGit(repo.dir, ['commit', '-q', '--amend', '--no-edit'], '自测 amend');
    const newSha = expectSelftestGit(repo.dir, ['rev-parse', 'HEAD'], '自测读取 amend 后 HEAD');
    assertSelftest(newSha !== oldSha, 'amend 未改变 sha');
    const rewritten = selftestCliWithInput(repo, ['rewrite'], `${oldSha} ${newSha}\n`);
    expectSelftestExit(rewritten, 0, 'rewrite');
    const receipt = readJsonSafe(path.join(selftestReceipts(repo), `${newSha}.json`));
    assertSelftest(receipt !== null, '新 sha 收据不存在');
    assertSelftest(receipt.rewrittenFrom === oldSha, `rewrittenFrom=${receipt.rewrittenFrom}`);
    assertSelftest(receipt.verified === true, `verified=${receipt.verified}`);
    assertSelftest(typeof receipt.signature === 'string' && receipt.signature.length === 64, '重写收据未签名');
    assertSelftest(receipt.sourceHook === 'post-rewrite', `sourceHook=${receipt.sourceHook}`);
    const parent = expectSelftestGit(repo.dir, ['rev-parse', `${newSha}^`], '自测读取父提交');
    const refsFile = writeSelftestRefs(repo, 'rewritten', [refLine('refs/heads/main', newSha, 'refs/heads/main', parent)]);
    expectSelftestExit(selftestCli(repo, ['verify-receipts', '--refs-file', refsFile]), 0, 'verify-receipts 重写后');
    return `rewrittenFrom=${shortSha(oldSha)} -> ${shortSha(newSha)} verify exit=0`;
  });
}

function commandSelftest() {
  const h = require("./lib/gate-receipts-selftest-helpers");
  const { buildCoreSelftestCases } = require("./lib/gate-receipts-selftest-core");
  const cfg = { schemaVersion: SCHEMA_VERSION, receiptsDirname: RECEIPTS_DIRNAME, pendingDirname: PENDING_DIRNAME, baselineFilename: BASELINE_FILENAME, bypassLogFilename: BYPASS_LOG_FILENAME, bypassReason: BYPASS_REASON, operatorBypassReason: OPERATOR_BYPASS_REASON, receiptKeyEnv: RECEIPT_KEY_ENV };
  const saved = detachGitEnvironment();
  const repo = createSelftestRepo();
  const previousKeyEnv = process.env[RECEIPT_KEY_ENV];
  process.env[RECEIPT_KEY_ENV] = path.join(repo.dir, "receipt.key");
  try {
    const receiptsDir = selftestReceipts(repo);
    const ctx = { repo, cliPath: __filename, receiptsDir, cfg };
    const { cases } = buildCoreSelftestCases(ctx);
    cases.push(selftestUnsignedReceiptBlocked(repo));
    cases.push(selftestTamperedSignatureBlocked(repo));
    cases.push(selftestRewriteAfterAmend(repo));
    return h.reportSelftest(cases);
  } catch (error) {
    process.stderr.write(`FAIL selftest 执行异常: ${error.message}\n`);
    return EXIT_BLOCK;
  } finally {
    if (previousKeyEnv === undefined) delete process.env[RECEIPT_KEY_ENV];
    else process.env[RECEIPT_KEY_ENV] = previousKeyEnv;
    h.cleanupSelftestRepo(repo.dir);
    restoreGitEnvironment(saved);
  }
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = {
  run,
  parseCommandArgs,
  verifyRecordSignature,
  hasVerifiedReceipt,
};
