# 主 Agent 8 步交叉复审协议与领域自适应路由 (Cross-Review Protocol)

> **规范地位**：本文件为 `subagent-orchestration` 技能的交付审计协议参考指南，定义主 Agent 对 SubAgent 产物进行独立交叉验证的标准流水线。

---

## 一、 交叉复审核心原则

1. **零盲目信任**：无论 SubAgent 自报如何顺利，主 Agent 必须以独立第三方的姿态重新审查物理文件与执行验证；
2. **领域感知分流**：根据受影响项目的领域特性，动态自适应调用专属验证命令，严禁跨领域硬编码；
3. **单调棘轮防反弹**：历史技术债务必须保持单调收敛，全工作区 High/Critical 债务 0 项基线一票否决。

---

## 二、 8 步交叉复审标准流水线

```text
┌────────────────────────────────────────────────────────┐
│ 步骤 1: 沙箱隔离审计 (git diff --name-only 比对 Path Jail)  │
├────────────────────────────────────────────────────────┤
│ 步骤 2: 领域编译构建自检 (npm run compile / build / python)│
├────────────────────────────────────────────────────────┤
│ 步骤 3: 体积与复杂度双轨预算 (evaluate-eloc-budget.js)   │
├────────────────────────────────────────────────────────┤
│ 步骤 4: 单源规则目录与防虚构校验 (generate-rule-catalog) │
├────────────────────────────────────────────────────────┤
│ 步骤 5: 领域专属架构守卫 (门面治理 / 五层解耦 / 循环堆分配)│
├────────────────────────────────────────────────────────┤
│ 步骤 6: 自审棘轮基线防反弹 (gate-self.js / 0 High/Critical)│
├────────────────────────────────────────────────────────┤
│ 步骤 7: 受影响领域自动化回归测试 (专属全量测试套件)      │
├────────────────────────────────────────────────────────┤
│ 步骤 8: 工作区五大支柱统一审查 (audit-all.ps1 -Fast >= 98)│
└────────────────────────────────────────────────────────┘
```

---

## 三、 领域路由矩阵

| 领域原型 | 编译自检命令 (步骤 2) | 专属架构守卫 (步骤 5) | 自动化回归测试 (步骤 7) |
| :--- | :--- | :--- | :--- |
| **`vs-extension`** | `cd workspace-timing && npm run compile` | `cd workspace-timing && npm run review` | `cd workspace-timing && npm run test:fast` |
| **`cli-engine`** | `cd auto-refactor && npm run build` | `node auto-refactor/scripts/validate-facade-governance.js`<br/>`node auto-refactor/scripts/validate-project-neutrality.js` | `cd auto-refactor && npm test` |
| **`game-engine`** | `cd WebGames && python scripts/py/audit_config.py --strict` | `cd WebGames && python scripts/py/audit_runner.py` | `cd WebGames && pwsh scripts/ps1/audit-all.ps1` |
| **`infra-tool`** | 语法解析检查 | `pwsh -File scripts/ps1/pre-commit-gate.ps1` | `pwsh -File scripts/ps1/pre-commit-gate.ps1` |
| **`workspace-meta`** | JSON/MD 语法检查 | `node scripts/common/generate-rule-catalog.js` | `pwsh -File scripts/ps1/audit-all.ps1 -Fast` |
| **`skill-governance`** | YAML Frontmatter 检查 | `node scripts/common/validate-skills.js`<br/>`node scripts/common/sync-skills.js --check` | `node scripts/common/validate-skills.js` |
