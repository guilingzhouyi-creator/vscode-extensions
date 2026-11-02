/**
 * Module: Tooling / Git Commit Message Contract Probes
 * File Path: scripts/common/lib/commit-structure-probes.js
 * Architecture Role: Isolated test harness and probe suite for commit structure contracts
 * Dependencies & Triggers: Consumed by commit-structure-contract.js, test-gate-guards.js, and CI
 * Responsibilities:
 *   1. Execute negative and positive probe cases covering all structural rules (header, sections, bounds);
 *   2. Assert typography, punctuation, character bounds, and manifest linkages under synthetic inputs;
 *   3. Return an array of diagnostic failure descriptions if any invariant breaks.
 * Exit Semantics & Design Rationale: Pure verification suite returning empty array on 100% pass.
 *   Uses declarative table-driven evaluation to maintain strict volume budgets and zero redundancy.
 */

'use strict';

/**
 * Proves each check fires on its own defect and stays silent on a compliant message.
 *
 * @param {Function} verifyStructure The contract verification function under test.
 * @param {object} STEP Step identity enumeration.
 * @returns {string[]} Array of failure descriptions, empty on complete success.
 */
function runSelfProbes(verifyStructure, STEP) {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) {
      failures.push(`probe "${label}": expected ${wanted}, got ${actual}`);
    }
  };

  const project = '[Project / 项目归属]\n- governance';
  const why = '[Why / 动机背景]\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。';
  const fixed = '[Fixed / 修复缺陷]\n- 修复空指针分支缺少保护导致异常穿透到调用方的缺陷，根因是判定顺序先解引用后判空。';
  const verify = '[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。';
  const cleanBody = [project, why, fixed, verify].join('\n\n');
  const build = (header, body) => [header, '', body, ''].join('\n');
  const clean = build('fix(gate): 修复空指针分支的判定顺序', cleanBody);
  const steps = (msg) => verifyStructure(msg).map((f) => f.step);

  expect(
    'compliant-message-passes',
    steps(clean).length,
    0
  );
  expect(
    'chinese-scope-accepted',
    steps(build('fix(门禁): 修复空指针分支的判定顺序', cleanBody)).length,
    0
  );
  expect(
    'compliant-docs-message-passes',
    steps(build('docs(gate): 补充判定顺序说明与契约设计', [project, why, verify].join('\n\n'))).length,
    0
  );

  const tableProbes = [
    {
      label: 'short-header-rejected',
      msg: build('fix(gate): abc', cleanBody),
      step: STEP.header,
    },
    {
      label: 'missing-scope-rejected',
      msg: build('fix: 修复空指针分支的判定顺序', cleanBody),
      step: STEP.header,
    },
    {
      label: 'empty-scope-rejected',
      msg: build('fix(): 修复空指针分支的判定顺序', cleanBody),
      step: STEP.header,
    },
    {
      label: 'trailing-period-rejected',
      msg: build('fix(gate): 修复空指针分支的判定顺序。', cleanBody),
      step: STEP.header,
    },
    {
      label: 'unknown-type-rejected',
      msg: build('update(gate): 修复空指针分支的判定顺序', cleanBody),
      step: STEP.header,
    },
    {
      label: 'fullwidth-colon-rejected',
      msg: build('fix(gate)： 修复空指针分支的判定顺序', cleanBody),
      step: STEP.header,
    },
    {
      label: 'missing-colon-space-rejected',
      msg: build('fix(gate):修复空指针分支的判定顺序', cleanBody),
      step: STEP.header,
    },
    {
      label: 'emoji-in-header-rejected',
      msg: build('fix(gate): 🚀 修复空指针分支判定顺序', cleanBody),
      step: STEP.header,
    },
    {
      label: 'missing-blank-line-rejected',
      msg: ['fix(gate): 修复空指针分支的判定顺序', project, why, fixed, verify, ''].join('\n'),
      step: STEP.split,
    },
    {
      label: 'thin-body-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, '[Why]\n- 短', '[Fixed]\n- 短', '[Verification]\n- 短断言结果合格通过'].join('\n\n')
      ),
      step: STEP.density,
    },
    {
      label: 'missing-verification-rejected',
      msg: build('fix(gate): 修复空指针分支的判定顺序', [project, why, fixed].join('\n\n')),
      step: STEP.sections,
    },
    {
      label: 'fix-without-fixed-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, why, '[Changed]\n- 补充显式判空与早返回，避免异常穿透到调用方。', verify].join('\n\n')
      ),
      step: STEP.sections,
    },
    {
      label: 'missing-project-rejected',
      msg: build('fix(gate): 修复空指针分支的判定顺序', [why, fixed, verify].join('\n\n')),
      step: STEP.project,
    },
    {
      label: 'invalid-project-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        ['[Project / 项目归属]\n- unknown', why, fixed, verify].join('\n\n')
      ),
      step: STEP.project,
    },
    {
      label: 'batch-codename-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, '[Why]\n- 本 Sprint 3 内补齐判定顺序保护，构造边界输入时会抛出异常并中断门禁流程。', fixed, verify].join('\n\n')
      ),
      step: STEP.batch,
    },
    {
      label: 'duplicate-section-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, why, why, fixed, verify].join('\n\n')
      ),
      step: STEP.sections,
    },
    {
      label: 'out-of-order-section-rejected',
      msg: build('fix(gate): 修复空指针分支的判定顺序', [project, verify, why, fixed].join('\n\n')),
      step: STEP.sections,
    },
    {
      label: 'bare-cmd-verification-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, why, fixed, '[Verification]\n- npm test'].join('\n\n')
      ),
      step: STEP.sections,
    },
    {
      label: 'hedge-verification-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, why, fixed, '[Verification]\n- 应该没问题了'].join('\n\n')
      ),
      step: STEP.sections,
    },
    {
      label: 'template-placeholder-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, why, fixed, '[Verification]\n- <在此处补充技术断言>'].join('\n\n')
      ),
      step: STEP.density,
    },
    {
      label: 'empty-section-rejected',
      msg: build('fix(gate): 修复空指针分支的判定顺序', [project, '[Why]', fixed, verify].join('\n\n')),
      step: STEP.sections,
    },
    {
      label: 'unresolved-marker-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, why, fixed, '[Verification]\n- 待补充验证用例与断言'].join('\n\n')
      ),
      step: STEP.density,
    },
    {
      label: 'docs-without-body-rejected',
      msg: build('docs(gate): 补充判定顺序说明', '简短说明'),
      step: STEP.sections,
    },
    {
      label: 'fullwidth-bracket-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, '【Why】\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。', fixed, verify].join('\n\n')
      ),
      step: STEP.sections,
    },
    {
      label: 'invalid-bullet-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, why, fixed, '[Verification]\n* 以空输入复核，门禁给出结构化阻断而非异常中断。'].join('\n\n')
      ),
      step: STEP.sections,
    },
    {
      label: 'short-why-rejected',
      msg: build(
        'fix(gate): 修复空指针分支的判定顺序',
        [project, '[Why]\n- 短动机不够长', fixed, verify].join('\n\n')
      ),
      step: STEP.density,
    },
    {
      label: 'breaking-without-section-rejected',
      msg: build(
        'feat(gate)!: 新增门禁核心配置能力并重构',
        [project, why, '[Added]\n- 新增统一门禁核心配置能力解析契约与动态分发。', verify].join('\n\n')
      ),
      step: STEP.sections,
    },
  ];

  for (const tc of tableProbes) {
    expect(tc.label, steps(tc.msg).includes(tc.step), true);
  }

  const zeroWidthMsg = build('fix(gate): 修复空指针分支的判定顺序\u200B', cleanBody);
  const zwSteps = steps(zeroWidthMsg);
  expect(
    'zero-width-char-rejected',
    zwSteps.includes(STEP.density) || zwSteps.includes(STEP.header),
    true
  );

  return failures;
}

module.exports = Object.freeze({
  runSelfProbes,
});
