---
name: rule-catalog-governance
description: >-
  全工作区单源规则目录（SSOT）、元数据一致性与规则反虚构治理规范。指导 Agent 聚合
  380+ 条跨项目静态分析与审查规则、在三大项目中规范注册新规则、防范规则 ID 虚构（RCFG-RULE-DRIFT）
  并执行单源一致性验证。
---

# rule-catalog-governance — 全仓单源规则目录与元数据一致性治理

本技能规范了工作区 380+ 条静态分析与审查规则的单源聚合机制（SSOT）、三项目规则纳管标准以及提交说明防规则虚构门禁。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **新增或重构静态分析规则**（`auto-refactor`、`workspace-timing` 或 `WebGames`）；
2. **在提交说明（Commit Message）中引用规则 ID**；
3. **执行全仓单源规则目录更新**（`generate-rule-catalog.js`）；
4. **排查 `RCFG-RULE-DRIFT`（规则漂移或未登记）门禁阻断**。

---

## 二、 全仓单源规则目录架构 (`rule-catalog.json`)

工作区维护唯一的全量规则真源文件：
- **文件路径**：`scripts/common/rule-catalog.json`
- **生成脚本**：`scripts/common/generate-rule-catalog.js`
- **涵盖范围**：统一聚合全工作区 380+ 条活跃规则，结构如下：
  ```json
  {
    "schema": "workspace-rule-catalog/v1",
    "generatedAt": "2026-10-05T05:14:37.464Z",
    "totalRules": 380,
    "counts": {
      "autoRefactor": 299,
      "workspaceTiming": 38,
      "webGames": 43
    },
    "rules": [ ... ]
  }
  ```

---

## 三、 三项目规则纳管与单源注册 SOP

新增规则必须遵循以下各项目专属的注册流程：

### 1. `auto-refactor` 规则注册
- 在 `src/core/rules/entries/` 对应家族文件中声明规则（继承 `RuleDefinition`）；
- 必须具备 `id`（格式：`FAMILY-TOPIC-NNN`）、`title`、`severity`、`analyzer` 与 `dimension`；
- 在 `src/core/scoring/dimensionRuleTable.ts` 中分配对应的扣分权重；
- 在 `scripts/test-parallel.js` 中注册对应的自测验证脚本。

### 2. `workspace-timing` 规则注册
- 在 `workspace-timing/scripts/config/review-rules.json` 中统一登记；
- 规则格式：`L0~L5` 分层前缀（如 `L0-COMPILE`、`L3-I18N-COVERAGE`）。

### 3. `WebGames` 规则注册
- 在 `WebGames/scripts/config/docs_governance_rules.json` 或 `audit_docs.py` 中登记。

---

## 四、 提交说明规则反虚构门禁 (`RCFG-RULE-DRIFT`)

为防止 AI Agent 幻觉捏造不存在的规则代号，`commit-msg-gate` 挂载了 `scripts/common/validate-commit-msg-rules.js`：
1. **自动正则提取**：提交正文中匹配形如 `[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}` 或 `L[0-5]-[A-Z0-9]+` 的词条；
2. **白名单豁免**：自动跳过标准网络/编码常量（如 `UTF-8`、`SHA-256`、`RFC-7231` 等）；
3. **一票阻断**：凡出现在提交说明中但未在 `rule-catalog.json` 中登记的规则 ID，立即触发 `RCFG-RULE-DRIFT` 阻断提交。

---

## 五、 常用命令与校验工具

```powershell
# 1. 重新扫描三项目并重新聚合单源规则目录
node scripts/common/generate-rule-catalog.js

# 2. 校验某份提交信息中的规则 ID 是否真实存在
node scripts/common/validate-commit-msg-rules.js <path-to-msg>

# 3. 运行 pre-commit 门禁中的规则一致性校验 (Gate 7)
pwsh -File scripts/ps1/pre-commit-gate.ps1
```

---

## 六、 关联模板与深度指引

- [rule-declaration-boilerplate.json](templates/rule-declaration-boilerplate.json)：新规则元数据登记声明标准格式；
- [rule-family-taxonomy.md](references/rule-family-taxonomy.md)：全仓规则家族分类与统一前缀体系。
