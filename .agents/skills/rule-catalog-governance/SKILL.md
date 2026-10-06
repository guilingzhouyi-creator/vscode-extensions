---
name: rule-catalog-governance
description: >-
  全工作区单源规则目录（SSOT）、元数据一致性与规则反虚构治理规范。指导 Agent 聚合
  385 条跨项目静态分析与审查规则、在三大项目中规范注册新规则、防范规则 ID 虚构（RCFG-RULE-DRIFT）
  并执行单源一致性验证。
---

# rule-catalog-governance — 全仓单源规则目录与元数据一致性治理

本技能规范了工作区 385 条静态分析与审查规则的单源聚合机制（Single Source of Truth, SSOT）、三项目规则纳管标准、度量求真数学公理以及提交说明防规则虚构门禁（`RCFG-RULE-DRIFT`）。

---

## 一、 适用场景与触发条件

在以下任一开发或治理场景中，必须激活本技能：
1. **新增或修改静态分析/审查规则**（涉及 `auto-refactor`、`workspace-timing` 或 `WebGames`）；
2. **在 Git 提交说明（Commit Message）中引用规则 ID**；
3. **维护度量评估系统与评分算法**（CAI 自研率、质量置信度区间估算）；
4. **执行全仓单源规则目录同步更新**（`generate-rule-catalog.js`）；
5. **排查 `RCFG-RULE-DRIFT`（规则未登记或虚构代号）门禁阻断**。

---

## 二、 全仓单源规则目录架构 (`rule-catalog.json`)

工作区维护全局唯一的规则真源注册表，任何规则必须在注册表中登记后方可在代码、配置或提交信息中生效：
- **SSOT 文件路径**：`scripts/common/rule-catalog.json`
- **生成与聚合脚本**：`scripts/common/generate-rule-catalog.js`
- **纳管规模与形态**：跨三大项目聚合 385 条活跃规则，结构元数据定义如下：
  ```json
  {
    "schema": "workspace-rule-catalog/v1",
    "generatedAt": "2026-10-05T05:14:37.464Z",
    "totalRules": 385,
    "counts": {
      "autoRefactor": 304,
      "workspaceTiming": 38,
      "webGames": 43
    },
    "rules": [
      {
        "id": "ARCH-FAC-001",
        "title": "门面模块必须满足实质承载与不可变性预算",
        "category": "architecture",
        "severity": "error",
        "analyzer": "architecture",
        "family": "ARCH",
        "dimension": "topological_coupling"
      }
    ]
  }
  ```

---

## 三、 三项目规则纳管与规范注册 SOP

向工作区新增或调整规则时，必须依项目标准流程落户，严禁未注册先引用：

### 1. `auto-refactor` 规则注册工作流
- **规则定义声明**：在 `src/core/rules/entries/` 对应家族文件中创建规则对象（继承 `RuleDefinition`），填写真实 `id`、`title`、`severity`、`analyzer` 与 `dimension`；
- **分值权重绑定**：在 `src/core/scoring/dimensionRuleTable.ts` 中分配对应的扣分权重，严格遵守单规则跨维度扣分约束 `MAX_AXES_PER_FINDING <= 4`；
- **自测套件闭环**：在 `tests/rules/` 编写专属单元测试，并在 `scripts/test-parallel.js` 中注册验证脚本，确保 243+ 核心规则零孤儿用例；
- **原生 Rust 内核等价同步**：若规则涉及原生算子分析，必须确保 Rust 内核与 TS shim 达到 100% 字节等价性。

### 2. `workspace-timing` 审查规则注册工作流
- **单源配置文件**：在 `workspace-timing/scripts/config/review-rules.json` 中统一登记；
- **规则层级代号**：使用严格的 `L0~L5` 六层体系前缀（如 `L0-COMPILE`、`L1-STORAGE-CRASH`、`L3-I18N-COVERAGE`），并附带对应触发审查命令与阻断级别。

### 3. `WebGames` 文档与代码规范注册工作流
- **配置与门禁脚本**：在 `WebGames/scripts/config/docs_governance_rules.json` 或 `WebGames/scripts/py/audit_docs.py` 中登记规则元数据；
- **前缀体系**：对齐文档治理规范（`DOC-`、`LINK-`）与引擎高性能契约（`ADV-`）。

### 4. 全仓同步触发
在任何子项目中新增规则后，必须运行：
```powershell
node scripts/common/generate-rule-catalog.js
```
确保全仓 SSOT 目录 `scripts/common/rule-catalog.json` 自动完成增量聚合与计数同步。

---

## 四、 提交说明规则反虚构门禁 (`RCFG-RULE-DRIFT`)

为根除大语言模型虚构规则 ID（Hallucination）或使用已废弃代号，`commit-msg-gate` 深度集成了 `scripts/common/validate-commit-msg-rules.js`：

1. **自动正则捕获**：
   从提交信息正文中精确捕获所有符合工作区规则命名特征的词条：
   - 家族型规则：`[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}`（如 `ARCH-FAC-001`, `GATE-AST-001`）
   - 层级型规则：`L[0-5]-[A-Z0-9\-]+`（如 `L0-COMPILE`, `L3-I18N-COVERAGE`）
   - 元治理规则：`RCFG-[A-Z\-]+`（如 `RCFG-RULE-DRIFT`）
2. **客观协议白名单过滤**：
   自动豁免标准网络与编码常量，如 `UTF-8`、`SHA-256`、`RFC-7231`、`HTTP-2`、`IEEE-754` 等；
3. **一票否决阻断**：
   捕获的规则词条若在 `rule-catalog.json` 中查无记录，门禁立即打印 `❌ [REJECT] RCFG-RULE-DRIFT` 并阻断提交，要求开发者修正为真实已登记 ID 或在真源中完成注册。

---

## 五、 指标度量求真与严谨数学公理

在开发度量评估、打分系统或算法统计时，必须贯彻客观科学公理：

### 1. 客观统计零注水原则
- 所有代码质量度量、自研率（CAI）与符号分析必须从 0 纯客观统计；
- **严禁手段**：严禁在算法中注入虚假基数、倍数放大、保底常数伪造或主观人工加分；
- **真实符号追踪**：外部依赖与自研符号统计必须基于 AST 真实符号索引（`symbolIndex`）进行端到端精确调用图追踪。

### 2. 主流统计学 Jeffreys Beta 后验模型
度量系统的置信度与区间估计严禁主观写死常数误差（如 $\pm 5\%$），必须采用主流经典统计学模型：
- **无信息先验**：采用 Jeffreys 先验 $\text{Beta}(0.5, 0.5)$；
- **共轭后验更新**：在观察到 $s$ 次成功、$f$ 次失败（总样本 $n = s + f$）后，后验分布为 $\text{Beta}(s + 0.5, f + 0.5)$；
- **均值与方差**：
  $$\mu = \frac{s + 0.5}{n + 1}, \quad \sigma^2 = \frac{(s + 0.5)(f + 0.5)}{(n + 1)^2 (n + 2)}$$
- 通过经典二项分布共轭贝叶斯模型输出置信区间，确保度量结果客观可复现。

---

## 六、 常用命令与校验工具

在执行规则变更或本地门禁验证时，使用以下命令：

```powershell
# 1. 重新扫描三大项目并全量生成单源规则目录 (SSOT)
node scripts/common/generate-rule-catalog.js

# 2. 本地验证提交说明中的规则 ID 是否真实存在
node scripts/common/validate-commit-msg-rules.js <path-to-commit-msg-file>

# 3. 运行 pre-commit 门禁中的规则一致性校验 (Gate 7)
pwsh -File scripts/ps1/pre-commit-gate.ps1
```

---

## 七、 关联参考与模板

- [rule-declaration-boilerplate.json](templates/rule-declaration-boilerplate.json)：新规则标准元数据声明模板；
- [rule-family-taxonomy.md](references/rule-family-taxonomy.md)：全仓规则家族分类与统一前缀体系。
