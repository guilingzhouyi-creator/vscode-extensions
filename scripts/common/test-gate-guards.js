/**
 * Module: Guard self-verification — prove each guard detects its own defect class
 * File Path: scripts/common/test-gate-guards.js
 * Architecture Role: Negative-path harness for the static gate guards
 * Dependencies & Triggers: Consumes validate-gate-ordering, validate-gate-feedback,
 *   validate-gate-verdicts, validate-hardcoded-counts, validate-block-chains,
 *   validate-script-isomorphism and gate-step-registry; invoked by pre-push and CI.
 * Responsibilities:
 *   1. Prove the ordering guard flags a call placed above its definition;
 *   2. Prove the ordering guard flags a status token outside the closed vocabulary;
 *   3. Prove the isomorphism guard flags a mixed-line-ending file;
 *   4. Prove the isomorphism guard flags a Bash script missing errexit;
 *   5. Prove the feedback guard flags a positional step label;
 *   6. Prove the verdict coverage guard flags a step with no verdict and a step announced twice;
 *   7. Prove the count guard fires on its own probes and distinguishes literal from interpolated;
 *   8. Prove the block-chain guard rejects an orphaned `else` and accepts every legal chain shape;
 *   9. Prove the metrics renderer rewrites a stale region and the docs consistency guard accepts the
 *      live figure, rejects an obsolete one, and honours only commit-qualified historical exemptions.
 * Exit Semantics & Design Rationale: 0 = every guard rejected its defect fixture,
 *   1 = at least one guard accepted a defect it claims to reject. A guard whose only evidence is
 *   "it exits 0 on clean code" is untested: the clean run cannot distinguish a working detector
 *   from a detector that never fires.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ORDERING = require('./validate-gate-ordering');
const FEEDBACK = require('./validate-gate-feedback');
const VERDICTS = require('./validate-gate-verdicts');
const ISOMORPHISM = require('./validate-script-isomorphism');
const CHAINS = require('./validate-block-chains');

/**
 * Creates a scratch directory removed when the process exits.
 *
 * @param {string} prefix - Directory name prefix.
 * @returns {string} Absolute directory path.
 */
function makeScratch(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.on('exit', () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试结论
    }
  });
  return dir;
}

const results = [];

/**
 * Records one assertion outcome.
 *
 * @param {string} name - Assertion label.
 * @param {boolean} ok - Whether the guard behaved as claimed.
 * @param {string} [detail] - Diagnostic detail.
 * @returns {void}
 */
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

// ---------------------------------------------------------------- ordering: early call
const orderLines = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'helper_defined_later "arg"',
  'helper_defined_later() {',
  '    echo ok',
  '}',
];
const orderDefs = ORDERING.collectDefinitions(orderLines);
const orderFindings = ORDERING.findEarlyCalls(orderLines, orderDefs);
check(
  'ordering guard flags a call above its definition',
  orderFindings.length === 1 && orderFindings[0].name === 'helper_defined_later',
  `findings=${orderFindings.length}`,
);

// ------------------------------------------------------------- ordering: inert on correct order
const orderedLines = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'helper_defined_later() {',
  '    echo ok',
  '}',
  'helper_defined_later "arg"',
];
const orderedFindings = ORDERING.findEarlyCalls(orderedLines, ORDERING.collectDefinitions(orderedLines));
check('ordering guard accepts a correctly ordered script', orderedFindings.length === 0, `findings=${orderedFindings.length}`);

// -------------------------------------------------------------- ordering: non-closed token
const tokenLines = ['echo "❌ [FAIL] 构建失败"'];
const tokenFindings = ORDERING.findStatusTokens(tokenLines);
check('ordering guard flags a non-closed status token', tokenFindings.length === 1, `findings=${tokenFindings.length}`);
const cleanTokenLines = ['echo "  ✖ BLOCK  构建失败"'];
check('ordering guard accepts a BLOCK verdict', ORDERING.findStatusTokens(cleanTokenLines).length === 0);

// ------------------------------------------------------------------ isomorphism: mixed endings
const isoDir = makeScratch('gate-guard-iso-');
const mixedFile = path.join(isoDir, 'mixed.ps1');
fs.writeFileSync(mixedFile, 'Write-Host a\r\nWrite-Host b\nWrite-Host c\n');
check(
  'isomorphism guard flags mixed line endings',
  ISOMORPHISM.auditLineEnding(mixedFile, 'CRLF') !== null,
  String(ISOMORPHISM.auditLineEnding(mixedFile, 'CRLF')),
);
const lfFile = path.join(isoDir, 'uniform.ps1');
fs.writeFileSync(lfFile, 'Write-Host a\r\nWrite-Host b\r\n');
check('isomorphism guard accepts uniform CRLF', ISOMORPHISM.auditLineEnding(lfFile, 'CRLF') === null);

// --------------------------------------------------------------- isomorphism: missing errexit
const noErrexit = ['#!/usr/bin/env bash', 'set -uo pipefail', 'echo hi'].join('\n');
const errexitFindings = ISOMORPHISM.auditShDirectives(noErrexit, true);
check(
  'isomorphism guard flags missing errexit where required',
  errexitFindings.some((f) => f.includes('errexit')),
  errexitFindings.join('; '),
);
check(
  'isomorphism guard allows documented no-errexit policy',
  ISOMORPHISM.auditShDirectives(noErrexit, false).length === 0,
  ISOMORPHISM.auditShDirectives(noErrexit, false).join('; '),
);

// ------------------------------------------------------------- isomorphism: missing native switches
const missingSwitches = ["Set-StrictMode -Version Latest", "$ErrorActionPreference = 'Stop'"].join('\n');
const ps1Findings = ISOMORPHISM.auditPs1Directives(missingSwitches);
check(
  'isomorphism guard flags missing native-command switches',
  ps1Findings.some((f) => f.includes('PSNativeCommandUseErrorActionPreference')),
  ps1Findings.join('; '),
);

// ---------------------------------------------------------------- feedback: positional label
// auditFile resolves relative paths against REPO_ROOT, so the exported pattern sets are asserted
// directly rather than by walking a fixture outside the repository.
const positionalHit = FEEDBACK.ORDINAL_LABEL_PATTERNS.some((p) => p.pattern.test('Write-Host "Gate 3 通过"'));
check('feedback guard pattern matches a positional label', positionalHit);
const statusHit = FEEDBACK.STATUS_SYNONYMS.some((p) => p.pattern.test('echo "[OK] done"'));
check('feedback guard pattern matches a status synonym', statusHit);

// ---------------------------------------------------- verdict coverage: silent success path
// 一个步骤若只有 SKIP 判定，它在「未执行」与「已通过」之间就不可区分 —— 这正是缺口本身。
const ps1Quoted = ['Write-StepVerdict -StepId "GATE-PROOF-25" -Status "PASS" -Detail "ok"'];
check(
  'verdict guard reads a quoted PowerShell status',
  VERDICTS.extractStatuses(ps1Quoted[0]).includes('PASS'),
  VERDICTS.extractStatuses(ps1Quoted[0]).join(','),
);
const shBare = ['write_step_verdict "GATE-PROOF-25" PASS "ok"'];
check(
  'verdict guard reads a bare Bash status',
  VERDICTS.extractStatuses(shBare[0]).includes('PASS'),
  VERDICTS.extractStatuses(shBare[0]).join(','),
);
const ps1Conditional = ['Write-StepVerdict -StepId "GATE-PROOF-25" -Status $(if ($x -eq "PASS") { "PASS" } else { "BLOCK" })'];
const conditionalStatuses = VERDICTS.extractStatuses(ps1Conditional[0]);
check(
  'verdict guard reads both branches of a conditional verdict',
  conditionalStatuses.includes('PASS') && conditionalStatuses.includes('BLOCK'),
  conditionalStatuses.join(','),
);

const verdictDir = makeScratch('gate-guard-verdict-');
const doubleBanner = path.join(verdictDir, 'double.sh');
fs.writeFileSync(doubleBanner, [
  'write_step_banner "GATE-PROOF-25"',
  'write_step_banner "GATE-PROOF-25"',
  'write_step_verdict "GATE-PROOF-25" PASS "ok"',
].join('\n'));
const doubleIndex = VERDICTS.indexEntryScript(doubleBanner);
check(
  'verdict guard indexes both banners of a duplicated announcement',
  (doubleIndex.banners.get('GATE-PROOF-25') || []).length === 2,
  `banners=${(doubleIndex.banners.get('GATE-PROOF-25') || []).length}`,
);
const skipOnly = path.join(verdictDir, 'skip-only.sh');
fs.writeFileSync(skipOnly, ['write_step_banner "GATE-PROOF-25"', 'write_step_verdict "GATE-PROOF-25" SKIP "skipped"'].join('\n'));
const skipStatuses = new Set((VERDICTS.indexEntryScript(skipOnly).verdicts.get('GATE-PROOF-25') || [])
  .flatMap((item) => item.statuses));
check(
  'verdict guard treats a SKIP-only step as having no terminal verdict',
  !skipStatuses.has('PASS') && !skipStatuses.has('BLOCK'),
  [...skipStatuses].join(','),
);

// 通用 Runner 内部已渲染横幅，调用点再写一次即为重复宣布 —— 这一处最容易被遗漏，
// 因为它看起来「有横幅、有判定」，唯一症状是运行时同一序号出现两行。
const genericDir = makeScratch('gate-guard-generic-');
const duplicateOnGeneric = path.join(genericDir, 'generic.ps1');
fs.writeFileSync(duplicateOnGeneric, [
  'function Invoke-GateStep {',
  '    Write-StepBanner -StepId $StepId',
  '}',
  'Write-StepBanner -StepId "GATE-PROOF-25"',
].join('\n'));
const genericIndex = VERDICTS.indexEntryScript(duplicateOnGeneric);
check(
  'verdict guard detects a generic runner file and an explicit banner',
  genericIndex.genericRunner === true,
  `genericRunner=${genericIndex.genericRunner}`,
);

// ---------------------------------------------------- hardcoded counts: detector self-proof
// 该守卫的第一版用 `\b` 与 `{2,5}`，对中文样本一条都不命中却仍退出 0。
// 这里先证明探针命中，再证明违规被检出、正确写法被放行。
const COUNTS = require('./validate-hardcoded-counts');
check(
  'count guard self-probes all match',
  COUNTS.runSelfProbes().length === 0,
  COUNTS.runSelfProbes().join(','),
);
const countDir = makeScratch('gate-guard-counts-');
const literalCount = path.join(countDir, 'literal.js');
// 违规样本本身不能在源码里写死计数，否则本文件会被自己的守卫拦下；
// 计数在此处拼接生成，落盘后仍是一行真实写死计数的输出语句。
const LITERAL_COUNT = 74;
fs.writeFileSync(literalCount, `console.log('扫描 ${LITERAL_COUNT} 份活动脚本');\n`);
check(
  'count guard flags a literal scale count',
  COUNTS.auditFile(literalCount).length === 1,
  `findings=${COUNTS.auditFile(literalCount).length}`,
);
const interpolatedCount = path.join(countDir, 'interpolated.js');
fs.writeFileSync(interpolatedCount, 'console.log(`扫描 ${total} 份活动脚本`);\n');
check(
  'count guard allows an interpolated count',
  COUNTS.auditFile(interpolatedCount).length === 0,
  `findings=${COUNTS.auditFile(interpolatedCount).length}`,
);

// ------------------------------------------------- block chains: orphaned continuation detector
// 重复的 else 分支 PowerShell 解析器不报错（实测 ParseFile 0 错误），只在运行时于该行失败。
// 探针语料覆盖重复 else、try 后接 else、以及字符串/块注释/here-string 内的花括号三类陷阱。
check(
  'block chain guard self-probes all match',
  CHAINS.runSelfProbes().length === 0,
  CHAINS.runSelfProbes().join('; '),
);
const orphanedElse = 'if ($a) {\r\n    "y"\r\n} else {\r\n    "n"\r\n} else {\r\n    "n"\r\n}\r\n';
check(
  'block chain guard flags a duplicated else branch',
  CHAINS.auditSource(orphanedElse, '<fixture>').length === 1,
  `findings=${CHAINS.auditSource(orphanedElse, '<fixture>').length}`,
);
const legalChain = 'if ($a) {\r\n    "1"\r\n} elseif ($b) {\r\n    "2"\r\n} else {\r\n    "3"\r\n}\r\n';
check(
  'block chain guard accepts a legal if/elseif/else chain',
  CHAINS.auditSource(legalChain, '<fixture>').length === 0,
  `findings=${CHAINS.auditSource(legalChain, '<fixture>').length}`,
);

// ------------------------------------------------- docs metrics: rendered regions and drift detector
// 渲染器与漂移守卫必须共用同一条判定路径，否则「探针通过」只能证明探针自己没坏。
const METRICS = require('./sync-doc-metrics');
const DOCS_CONSISTENCY = require('./validate-docs-consistency');
const metricConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'doc-metrics.json'), 'utf8'));

check(
  'metrics guard self-probes all match',
  METRICS.runSelfProbes(metricConfig).length === 0,
  METRICS.runSelfProbes(metricConfig).join('; '),
);

const metricRender = (id, inline) => METRICS.renderMetric(metricConfig, id, new Map([['rule-total', 500]]), inline);
const staleRegion = METRICS.applyRegions(
  '<!-- METRICS:BEGIN rule-total -->\n全工作区 SSOT 单源收录 **428 条规则**\n<!-- METRICS:END rule-total -->',
  metricRender,
);
check(
  'metrics guard rewrites a stale region body',
  staleRegion.drifts.length === 1 && !staleRegion.text.includes('428'),
  `drifts=${staleRegion.drifts.length}`,
);

const claimDetectors = DOCS_CONSISTENCY.buildClaimDetectors();
// 真值来自目录而非探针字面量：探针若写死 500，规则新增一条就会让「应放行」的断言自己过期。
const liveRuleTotal = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'rule-catalog.json'), 'utf8'),
).totalRules;
check(
  'docs consistency guard detects an obsolete rule count',
  DOCS_CONSISTENCY.scanTextForClaims('全仓收录 428 条规则。', claimDetectors).length === 1,
);
check(
  'docs consistency guard accepts the live rule count',
  DOCS_CONSISTENCY.scanTextForClaims(`全仓收录 ${liveRuleTotal} 条规则。`, claimDetectors).length === 0,
);
check(
  'docs consistency guard exempts a dated historical paragraph',
  DOCS_CONSISTENCY.scanTextForClaims(
    '<!-- METRICS:IGNORE-HISTORICAL commit=c711798 -->\n该时点结论：468 条规则。\n',
    claimDetectors,
  ).length === 0,
);
check(
  'docs consistency guard rejects an exemption without a commit',
  DOCS_CONSISTENCY.scanTextForClaims(
    '<!-- METRICS:IGNORE-HISTORICAL -->\n现行结论：468 条规则。\n',
    claimDetectors,
  ).length === 1,
);
check(
  'docs consistency guard ignores figures inside rendered regions',
  DOCS_CONSISTENCY.scanTextForClaims(
    '<!-- METRICS:BEGIN rule-total -->**500 条规则**<!-- METRICS:END rule-total -->',
    claimDetectors,
  ).length === 0,
);

const failures = results.filter((r) => !r.ok).length;if (failures > 0) {
  console.error(`FAIL ${failures} guard assertion(s) did not hold`);
  process.exit(1);
}
console.log(`PASS 全部门禁守卫的检出能力已由 ${results.length} 项断言证明`);
process.exit(0);
