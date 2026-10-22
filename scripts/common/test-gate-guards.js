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
// 三类漏检形态曾同时逃过旧正则：表格单元格、括号裸计数、拉丁限定词。三者都必须在同一份
// 语料上被捕获，否则「守卫 PASS」只说明它没看懂这些写法。
check(
  'docs consistency guard reads a bare figure in a table cell',
  DOCS_CONSISTENCY.scanTextForClaims('| **`auto-refactor`** | 338 条 | 30 个分析器 |', claimDetectors).length >= 1,
);
check(
  'docs consistency guard reads a parenthesised bare figure',
  DOCS_CONSISTENCY.scanTextForClaims('1. **`autoRefactor` (338 条)**：涵盖 30 个分析器', claimDetectors).length >= 1,
);
check(
  'docs consistency guard reads a Latin-qualified bare figure',
  DOCS_CONSISTENCY.scanTextForClaims('触发 30 分析器与 359 条 auto-refactor 规则自测', claimDetectors).length >= 1,
);
check(
  'docs consistency guard leaves session-capacity figures alone',
  DOCS_CONSISTENCY.scanTextForClaims('单日会话记录超过 20 条时按 FIFO 淘汰', claimDetectors).length === 0,
);
check(
  'docs consistency guard judges a project row against its own total',
  DOCS_CONSISTENCY.scanTextForClaims('| **`WebGames`** | 29 条 | Godot 专属契约 |', claimDetectors).length === 1 &&
    DOCS_CONSISTENCY.scanTextForClaims('| **`WebGames`** | 50 条 | Godot 专属契约 |', claimDetectors).length === 0,
);
check(
  'docs consistency guard judges a family figure against its own family',
  DOCS_CONSISTENCY.scanTextForClaims('对应 `PYM` 族 11 条规则。', claimDetectors).length === 1 &&
    DOCS_CONSISTENCY.scanTextForClaims('对应 `PYM` 族 13 条规则。', claimDetectors).length === 0 &&
    DOCS_CONSISTENCY.scanTextForClaims('13 条 `PYM` 规则对应的写法。', claimDetectors).length === 0 &&
    DOCS_CONSISTENCY.scanTextForClaims('11 条 `PYM` 规则对应的写法。', claimDetectors).length === 1,
);
check(
  'docs consistency guard honours a reasoned plan exemption',
  DOCS_CONSISTENCY.scanTextForClaims(
    '<!-- METRICS:IGNORE-PLAN reason=preset-family-target -->\n| catalog | 30 条 preset |\n',
    claimDetectors,
  ).length === 0,
);

// --- 度量覆盖 / 扫描域单源 / 测试套件量词 ---
// 这三个守卫在 audit-all 缺席期间无任何负向证明，其「PASS」只等于「没在干净语料上报错」。
const COVERAGE = require('./validate-metric-coverage');

check(
  'metric coverage guard self-probes all match',
  COVERAGE.runSelfProbes().length === 0,
  COVERAGE.runSelfProbes().join('; '),
);
check(
  'metric coverage guard flags an inventory row the README omits',
  COVERAGE.findMissingInventoryRows(
    [
      { dir: 'common', file: 'a.js' },
      { dir: 'common', file: 'b.js' },
    ],
    COVERAGE.parseInventoryTable('| `common/` | Node.js | `a.js` | role | caller |'),
  ).length === 1,
);
check(
  'metric coverage guard flags a guard that keeps a private scan scope',
  COVERAGE.findPrivateScopes([{ file: 'x.js', body: "const SKIP_DIRS = new Set(['dist']);" }]).length === 1,
);
check(
  'metric coverage guard accepts a config-derived scan scope',
  COVERAGE.findPrivateScopes([{ file: 'y.js', body: 'const scope = resolveScanScope(config);' }]).length === 0,
);

// 「套」量词曾四处在文档里漂移而无人发现：探测器集合里没有任何一条认得「N 套测试」。
const suiteLanes = METRICS.countTestSuiteLanes();
check(
  'docs consistency guard rejects a stale suite count',
  DOCS_CONSISTENCY.scanTextForClaims('全量 155 套测试全部通过。', claimDetectors).length === 1,
);
check(
  'docs consistency guard accepts the live suite total and each lane',
  DOCS_CONSISTENCY.scanTextForClaims(`全量 ${suiteLanes.total} 套测试全部通过。`, claimDetectors).length === 0 &&
    DOCS_CONSISTENCY.scanTextForClaims(`含 ${suiteLanes.parallel} 个并行套件。`, claimDetectors).length === 0 &&
    DOCS_CONSISTENCY.scanTextForClaims(`含 ${suiteLanes.serialSum} 套串行套件。`, claimDetectors).length === 0,
);
check(
  'docs consistency guard leaves an unrelated quantifier alone',
  DOCS_CONSISTENCY.scanTextForClaims('这一套方案覆盖 3 个阶段。', claimDetectors).length === 0,
);

// 三种形态曾同时逃过全部既有探测器：覆盖率比值、按项目分解、规范/别名拆分。它们都不把
// 「条」写在数字旁边，因此旧正则连匹配都匹配不到，PASS 只证明守卫没看懂这些写法。
const liveAutoRefactor = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'rule-catalog.json'), 'utf8'),
).counts.autoRefactor;
check(
  'docs consistency guard reads a coverage ratio',
  DOCS_CONSISTENCY.scanTextForClaims('| 规则字典覆盖率 | **362 / 362 (100%)** |', claimDetectors).length === 1 &&
    DOCS_CONSISTENCY.scanTextForClaims(
      `| 规则字典覆盖率 | **${liveAutoRefactor} / ${liveAutoRefactor} (100%)** |`,
      claimDetectors,
    ).length === 0,
);
check(
  'docs consistency guard treats an unequal ratio as a gap report',
  DOCS_CONSISTENCY.scanTextForClaims('规则定义行覆盖率 362/363，尚有一条待补。', claimDetectors).length === 0,
);
check(
  'docs consistency guard reads a per-project decomposition',
  DOCS_CONSISTENCY.scanTextForClaims('收录规则 (autoRefactor: 362, webGames: 50)', claimDetectors).length === 1 &&
    DOCS_CONSISTENCY.scanTextForClaims(
      `收录规则 (autoRefactor: ${liveAutoRefactor}, webGames: 50)`,
      claimDetectors,
    ).length === 0,
);
check(
  'docs consistency guard reads a canonical/legacy split',
  DOCS_CONSISTENCY.scanTextForClaims('全量规则字典 (347 规范 + 15 历史别名)', claimDetectors).length === 1 &&
    DOCS_CONSISTENCY.scanTextForClaims('全量规则字典 (348 规范 + 15 历史别名)', claimDetectors).length === 0,
);
check(
  'docs consistency guard leaves a rule-id suffix and a test ratio alone',
  DOCS_CONSISTENCY.scanTextForClaims('对齐 `ADV-RNG-001` 规范后重跑规则自测', claimDetectors).length === 0 &&
    DOCS_CONSISTENCY.scanTextForClaims('规则自测全通过 (163/163 套测试)', claimDetectors).length === 0,
);

// --- 锚点 / 可达性 / 族契约 / 提交历史冻结 / SubAgent 目录 ---
const ANCHORS = require('./validate-doc-anchors');
const REACHABILITY = require('./validate-doc-reachability');
const FAMILY = require('./validate-family-contract');
const HISTORY = require('./validate-commit-history-baseline');
const SUBAGENT = require('../../.agents/skills/subagent-orchestration/scripts/validate-subagent-catalog');

check('doc anchors guard self-probes all match', ANCHORS.runSelfProbes('「SubAgent 调度」公理').length === 0);
check(
  'doc anchors guard rejects a positional reference',
  ANCHORS.findPositional('依据公理 6 执行').length === 1 &&
    ANCHORS.findPositional('详见 AGENTS.md §3').length === 1,
);
check(
  'doc anchors guard rejects an anchor that names no row',
  ANCHORS.findDanglingAnchors('见「不存在的条目」公理', '「SubAgent 调度」公理').length === 1,
);
check('doc reachability guard self-probes all match', REACHABILITY.runSelfProbes().length === 0);
check('family contract guard self-probes all match', FAMILY.runSelfProbes().length === 0);
check('commit history guard self-probes all match', HISTORY.runSelfProbes().length === 0);
check('subagent catalog guard self-probes all match', SUBAGENT.runSelfProbes().length === 0);

// --- 结构契约（七项检查的单一实现，双 shell 均委托此处）---
const STRUCTURE = require('./commit-structure-contract');
check(
  'commit structure contract self-probes all match',
  STRUCTURE.runSelfProbes().length === 0,
  STRUCTURE.runSelfProbes().join('; '),
);
check(
  'commit structure contract accepts a chinese scope',
  STRUCTURE.verifyStructure(
    'fix(门禁): 修复空指针分支的判定顺序\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。\n\n[Fixed / 修复缺陷]\n- 修复空指针分支缺少保护导致异常穿透到调用方的缺陷，根因是判定顺序先解引用后判空。\n\n[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。\n',
  ).length === 0,
);
check(
  'commit structure contract rejects an unknown type',
  STRUCTURE.verifyStructure('update(gate): 修复空指针分支的判定顺序\n\n[Project / 项目归属]\n- governance\n').some(
    (f) => f.step === 'HEADER-FORM-01',
  ),
);
check(
  'commit structure contract reads the controlled project list from the dictionary',
  STRUCTURE.controlledProjects().includes('governance') &&
    STRUCTURE.controlledProjects().includes('fractal-git'),
);
// The codename vocabulary used to exist twice: the contract carried sprint/pass/w markers, while
// validate-commit-msg carried wip/temp/new/vN. Both registered as CMG-STY-001, so the pair claimed
// to be one rule while disagreeing on most inputs. These assertions pin the single vocabulary and
// the two false positives that the duplicate produced.
const CODENAME_CASES = [
  ['phase2', '本 phase2 内补齐判空与早返回，避免异常穿透到调用方。', true],
  ['sprint 3', '本 Sprint 3 内补齐判空与早返回，避免异常穿透到调用方。', true],
  ['st7', '本 st7 内补齐判空与早返回，避免异常穿透到调用方。', true],
  ['p4', '本 p4 内补齐判空与早返回，避免异常穿透到调用方。', true],
  ['w3', '本 w3 内补齐判空与早返回，避免异常穿透到调用方。', true],
  ['pass 2', '本 pass 2 内补齐判空与早返回，避免异常穿透到调用方。', true],
  ['new analyzer', '新增 new analyzer 注册分支，避免未注册分析器被静默忽略。', false],
  ['v2 版本', '升级协议到 v2 版本，避免旧客户端解析失败。', false],
];
const codenameBody = (why) =>
  `fix(gate): 修复空指针分支的判定顺序\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- ${why}\n\n[Fixed / 修复缺陷]\n- 修复空指针分支缺少保护导致异常穿透到调用方的缺陷，根因是判定顺序先解引用后判空。\n\n[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。\n`;
const codenameMismatches = CODENAME_CASES.filter(([, why, expectBlocked]) => {
  const blocked = STRUCTURE.verifyStructure(codenameBody(why)).some((f) => f.step === STRUCTURE.STEP.batch);
  return blocked !== expectBlocked;
}).map(([label]) => label);
check(
  'commit structure contract owns the only codename vocabulary',
  codenameMismatches.length === 0,
  `mismatched: ${codenameMismatches.join(', ')}`,
);
check(
  'codename finding carries the line and token so callers need no second pattern',
  (() => {
    const finding = STRUCTURE.verifyStructure(codenameBody('本 phase2 内补齐判空与早返回。')).find(
      (f) => f.step === STRUCTURE.STEP.batch,
    );
    return Boolean(finding) && finding.token === 'phase2' && finding.line > 0;
  })(),
);
check(
  'validate-commit-msg projects the contract codename finding without a second vocabulary',
  (() => {
    const { validateSingleCommitMessage } = require('./validate-commit-msg');
    const flagged = validateSingleCommitMessage(codenameBody('本 phase2 内补齐判空与早返回。')).batchFindings;
    const legit = validateSingleCommitMessage(codenameBody('新增 new analyzer 注册分支，避免未注册分析器被静默忽略。')).batchFindings;
    return flagged.length === 1 && flagged[0].term === 'phase2' && legit.length === 0;
  })(),
);
// A step constant the module never emits is worse than no constant: a caller filtering on it matches
// nothing and reports a clean run. `slang` was exactly that — the dictionary owns SLANG-GUARD-02.
check(
  'every structure-contract step constant is reachable from verifyStructure',
  (() => {
    const produced = new Set();
    const probeMessages = [
      'fix(gate): abc',
      'update(gate): 修复空指针分支的判定顺序',
      'fix(gate): 修复空指针分支的判定顺序',
      'fix(gate): 修复空指针分支的判定顺序。',
      // A non-blank second line is the only way to reach BODY-SPLIT-03.
      'fix(gate): 修复空指针分支的判定顺序\n[Project / 项目归属]\n- governance\n',
      codenameBody('本 phase2 内补齐判空与早返回。'),
      `fix(gate): 修复空指针分支的判定顺序\n\n[Project / 项目归属]\n- unknown\n\n[Why / 动机背景]\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。\n`,
    ];
    for (const message of probeMessages) {
      for (const finding of STRUCTURE.verifyStructure(message)) produced.add(finding.step);
    }
    const declared = Object.values(STRUCTURE.STEP);
    const unreachable = declared.filter((step) => !produced.has(step));
    return unreachable.length === 0;
  })(),
);

// --- 门面承载（auto-refactor 项目内守卫，无 runSelfProbes 导出，按其纯函数驱动）---
const FACADE_DIST = path.join(__dirname, '../../auto-refactor/dist/core/architecture/facade-governance-evaluator.js');
check('facade governance evaluator is built', fs.existsSync(FACADE_DIST));
if (fs.existsSync(FACADE_DIST)) {
  const { auditFacadeGovernance } = require(FACADE_DIST);
  // A three-line pure re-export is the shape ARCH-ABS-001 exists to block.
  const trampoline = auditFacadeGovernance(
    'src/trampoline.ts',
    'export { a } from "./a";\nexport { b } from "./b";\nexport { c } from "./c";\n',
  );
  check(
    'facade governance flags a three-line pure re-export',
    trampoline.trampolineCount >= 1,
    JSON.stringify(trampoline).slice(0, 160),
  );
  const substantive = auditFacadeGovernance(
    'src/substantive.ts',
    Array.from({ length: 20 }, (_, i) => `export function f${i}() { return ${i}; }`).join('\n'),
  );
  check('facade governance accepts a substantive facade', substantive.trampolineCount === 0);
}

// --- 命令面契约（无 runSelfProbes 导出，按其纯函数驱动）---
const SHELL_PARITY = require('./validate-shell-parity');
check(
  'shell parity guard exposes a command registry',
  typeof SHELL_PARITY === 'object' && SHELL_PARITY !== null,
);

// --- 变异覆盖：文档里每个规则数字改坏后必须被拦下 ---
// 「干净语料退出 0」无法区分「守卫在检测」与「守卫从不触发」。这里把仓库内每处规则数字
// 逐一替换成退役值，再问真实探测器是否捕获；捕获不到的站点就是未被看守的存量债。
// 真源文件（rule-catalog.json 与 rule-sources/*）不参与：改动它们改变的是「活真值」本身。
const MUTATION_TARGETS = ['503', '363', '348', '15', '17', '24', '49', '50'];
const RETIRED_FIGURE = '428';
const unguardedSites = [];
let mutatedSites = 0;

check(
  'docs consistency guard catches every rule figure in the governance corpus after mutation',
  (() => {
    const root = path.join(__dirname, '../..');
    const skip = new Set(['node_modules', '.git', 'out', 'dist', 'bin', 'obj', 'target', '.venv', '.audit-logs', 'archive']);
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          if (rel === 'WebGames/docs' || rel === '.agents/plugins') continue;
          walk(full);
        } else if (entry.name.endsWith('.md')) {
          files.push(full);
        }
      }
    };
    walk(root);
    const region = /<!--\s*METRICS:BEGIN\s+[a-z0-9-]+\s*-->[\s\S]*?<!--\s*METRICS:END\s+[a-z0-9-]+\s*-->/g;
    for (const file of files) {
      const rel = path.relative(root, file).replace(/\\/g, '/');
      const blanked = fs.readFileSync(file, 'utf8').replace(region, (m) => m.replace(/[^\n]/g, ' '));
      blanked.split(/\r?\n/).forEach((line, index) => {
        if (!/规则|分析器|rule|SSOT/i.test(line)) return;
        const ratioMutated = line.replace(/(?<![0-9])(\d{2,4})\s*\/\s*\1(?![0-9])/g, `${RETIRED_FIGURE} / ${RETIRED_FIGURE}`);
        if (ratioMutated !== line) {
          mutatedSites += 1;
          if (DOCS_CONSISTENCY.scanTextForClaims(ratioMutated, claimDetectors).length === 0) {
            unguardedSites.push(`${rel}:${index + 1} ratio`);
          }
          return;
        }
        for (const match of line.matchAll(/(?<![0-9.])(\d{2,4})(?![0-9])/g)) {
          if (!MUTATION_TARGETS.includes(match[1])) continue;
          mutatedSites += 1;
          const mutated = `${line.slice(0, match.index)}${RETIRED_FIGURE}${line.slice(match.index + match[0].length)}`;
          if (DOCS_CONSISTENCY.scanTextForClaims(mutated, claimDetectors).length === 0) {
            unguardedSites.push(`${rel}:${index + 1} ${match[1]}`);
          }
        }
      });
    }
    return unguardedSites.length === 0;
  })(),
  `${mutatedSites} site(s) mutated, unguarded: ${unguardedSites.slice(0, 6).join(', ') || 'none'}`,
);

const failures = results.filter((r) => !r.ok).length;if (failures > 0) {
  console.error(`FAIL ${failures} guard assertion(s) did not hold`);
  process.exit(1);
}
console.log(`PASS 全部门禁守卫的检出能力已由 ${results.length} 项断言证明`);
process.exit(0);
