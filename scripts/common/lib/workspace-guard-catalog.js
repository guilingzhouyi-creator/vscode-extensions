/**
 * Module: Workspace Governance Guard Catalog & Registry
 * File Path: scripts/common/lib/workspace-guard-catalog.js
 * Architecture Role: Single authoritative registry of Pillar-2 governance guards, group mappings,
 *   metadata index, and `--list-json` payload formatting shared by run-workspace-guards.js and
 *   audit summary renderers.
 * Dependencies & Triggers: Zero external runtime dependencies; consumed by
 *   scripts/common/run-workspace-guards.js and scripts/common/render-audit-all-summary.js.
 * Responsibilities:
 *   1. Construct frozen guard descriptor objects with derived CLI and verification commands;
 *   2. Maintain the ordered 23-guard `PILLAR2_GUARDS` registry and `GUARD_GROUPS` map;
 *   3. Expose `GUARD_META_BY_ID` lookup and `buildListPayload` formatter for inspection.
 * Exit Semantics & Design Rationale: Pure immutable catalog module with zero side effects or I/O.
 */
'use strict';

/**
 * Builds an immutable guard metadata descriptor with derived command and verification strings.
 *
 * @param {object} spec - Guard definition fields.
 * @returns {object} Frozen guard descriptor.
 */
function defineGuard(spec) {
  const args = Array.isArray(spec.args) ? spec.args : [];
  const cmdParts = ['node', spec.script, ...args];
  const cmd = cmdParts.join(' ');
  return Object.freeze({
    id: spec.id,
    name: spec.name,
    script: spec.script,
    args: Object.freeze([...args]),
    cmd,
    fix: spec.fix,
    verifyCmd: spec.verifyCmd || cmd,
    aasLayer: spec.aasLayer || 'L5_GOVERNANCE',
    suppressStderrOnPass: Boolean(spec.suppressStderrOnPass),
  });
}

const PILLAR2_GUARDS = Object.freeze([
  defineGuard({
    id: 'generate-rule-catalog',
    name: '单源规则注册表生成',
    script: 'scripts/common/generate-rule-catalog.js',
    args: ['--check-only'],
    fix: '运行 node scripts/common/generate-rule-catalog.js 重新同步规则',
  }),
  defineGuard({
    id: 'validate-gate-feedback',
    name: '门禁反馈契约审查',
    script: 'scripts/common/validate-gate-feedback.js',
    fix: '修正门禁输出词法并注册步骤',
  }),
  defineGuard({
    id: 'validate-gate-ordering',
    name: '门禁步骤执行拓扑排序',
    script: 'scripts/common/validate-gate-ordering.js',
    fix: '按照 gate-step-registry.json 调整调用顺序',
  }),
  defineGuard({
    id: 'validate-skills',
    name: '技能集规范与插件同构审查',
    script: 'scripts/common/validate-skills.js',
    fix: '运行 node scripts/common/sync-skills.js 同步技能',
  }),
  defineGuard({
    id: 'validate-rule-id-closure',
    name: '规则标识双向闭包审查',
    script: 'scripts/common/validate-rule-id-closure.js',
    fix: '在 rule-catalog.json 中登记调用的规则 ID',
  }),
  defineGuard({
    id: 'validate-scoring-rule-closure',
    name: '评分规则闭包审查',
    script: 'scripts/common/validate-scoring-rule-closure.js',
    fix: '对齐打分规则与 SSOT 注册表',
  }),
  defineGuard({
    id: 'validate-rule-reachability',
    name: '规则可达性静态追踪',
    script: 'scripts/common/validate-rule-reachability.js',
    fix: '检查并恢复丢失的规则检测逻辑',
  }),
  defineGuard({
    id: 'validate-rule-source-consistency',
    name: '规则源文件一致性审查',
    script: 'scripts/common/validate-rule-source-consistency.js',
    fix: '同步 rule-sources/ 与 rule-catalog.json',
  }),
  defineGuard({
    id: 'validate-docs-consistency',
    name: '文档计数与脚本引用一致性',
    script: 'scripts/common/validate-docs-consistency.js',
    fix: '同步文档指标或运行 sync-doc-metrics.js',
  }),
  defineGuard({
    id: 'validate-trajectory-ledger',
    name: '长期轨迹账本物理约束',
    script: 'scripts/common/validate-trajectory-ledger.js',
    fix: '清理或重置不合规的轨迹账本行',
  }),
  defineGuard({
    id: 'validate-subagent-catalog',
    name: 'SubAgent 预置名册与调度一致性',
    script: '.agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js',
    fix: '检查 subagent-catalog.json 与智能体模板',
  }),
  defineGuard({
    id: 'validate-cascade-coherence',
    name: '级联调度自洽性校验',
    script: '.agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js',
    fix: '检查子智能体调度拓扑',
  }),
  defineGuard({
    id: 'validate-doc-anchors',
    name: '文档代码锚点有效性审查',
    script: 'scripts/common/validate-doc-anchors.js',
    fix: '修复文档中的代码行锚点死链',
  }),
  defineGuard({
    id: 'validate-metric-coverage',
    name: '指标覆盖率审查',
    script: 'scripts/common/validate-metric-coverage.js',
    fix: '补充缺失的十维指标追踪',
  }),
  defineGuard({
    id: 'validate-family-contract',
    name: '规则族契约审查',
    script: 'scripts/common/validate-family-contract.js',
    fix: '修正规则命名与前缀拓扑',
  }),
  defineGuard({
    id: 'validate-doc-reachability',
    name: '文档链接可达性审查',
    script: 'scripts/common/validate-doc-reachability.js',
    fix: '修复文档中的内部相对死链',
  }),
  defineGuard({
    id: 'validate-commit-history-baseline',
    name: '提交历史基线校验',
    script: 'scripts/common/validate-commit-history-baseline.js',
    fix: '检查基线提交哈希是否变动',
  }),
  defineGuard({
    id: 'validate-destructive-ops',
    name: '破坏性删除操作白名单溯源',
    script: 'scripts/common/validate-destructive-ops.js',
    fix: '对递归删除调用添加三步守卫',
  }),
  defineGuard({
    id: 'validate-block-chains',
    name: '拦截链路完整性校验',
    script: 'scripts/common/validate-block-chains.js',
    fix: '确保门禁脚本具备阻断退出路径',
  }),
  defineGuard({
    id: 'validate-hardcoded-counts',
    name: '硬编码计数守卫',
    script: 'scripts/common/validate-hardcoded-counts.js',
    fix: '移除硬编码计数值，改为从 SSOT 动态读取',
  }),
  defineGuard({
    id: 'validate-shell-parity',
    name: '终端命令面对齐守卫',
    script: 'scripts/common/validate-shell-parity.js',
    fix: '对齐 PowerShell 与 GNU 命令别名',
  }),
  defineGuard({
    id: 'test-gate-guards',
    name: '门禁反向探针自证',
    script: 'scripts/common/test-gate-guards.js',
    fix: '排查守卫逻辑，确保探针能够触发失败',
    suppressStderrOnPass: true,
  }),
  defineGuard({
    id: 'sync-doc-metrics',
    name: '文档数字真源同步校验',
    script: 'scripts/common/sync-doc-metrics.js',
    fix: '运行 node scripts/common/sync-doc-metrics.js 进行同步',
  }),
]);

const GUARD_GROUPS = Object.freeze({
  pillar2: PILLAR2_GUARDS,
});

const GUARD_META_BY_ID = new Map(PILLAR2_GUARDS.map((guard) => [guard.id, guard]));

/**
 * Formats an ordered guard metadata list for `--list-json` inspection and fallback collectors.
 *
 * @param {Array<object>} guards - Guard descriptors for the selected group.
 * @returns {Array<object>} Ordered metadata objects with 0-based index.
 */
function buildListPayload(guards) {
  return guards.map((guard, index) => ({
    index,
    id: guard.id,
    name: guard.name,
    script: guard.script,
    args: guard.args,
    cmd: guard.cmd,
    fix: guard.fix,
    verifyCmd: guard.verifyCmd,
    aasLayer: guard.aasLayer,
    suppressStderrOnPass: guard.suppressStderrOnPass,
  }));
}

module.exports = Object.freeze({
  defineGuard,
  PILLAR2_GUARDS,
  GUARD_GROUPS,
  GUARD_META_BY_ID,
  buildListPayload,
});
