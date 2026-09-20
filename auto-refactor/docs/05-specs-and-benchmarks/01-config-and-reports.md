# 配置规范与报告输出格式 (Configuration & Report Formats)

> **所属模块**：`05-specs-and-benchmarks`  
> **核心源码**：`config.schema.json`, `report.schema.json`, `src/formatters/*`, `src/core/config.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 配置文件模式 (`ar.config.json`)

引擎提供完整的 JSON Schema 校验支持（`config.schema.json`）：

```json
{
  "$schema": "./config.schema.json",
  "root": "src",
  "include": ["**/*.ts", "**/*.js", "**/*.rs"],
  "exclude": ["**/node_modules/**", "**/dist/**"],
  "thresholds": {
    "magicNumberMin": 2,
    "hardcodedStringMinLength": 3,
    "duplicateLiteralThreshold": 3,
    "complexityWarn": 10,
    "complexityFail": 20,
    "maxFileLines": 500,
    "maxFunctionLines": 80
  },
  "format": "json",
  "failOnIssue": false
}
```

**跨语言覆盖的 fail-closed 开关**：`unsupportedLanguage`（`error` | `warning` | `off`，默认 `error`）。当扫描范围内出现没有任何语言适配器认领的扩展名（如 `.py`/`.sh`/`.ps1`）时，引擎会产生 `LANG-UNSUPPORTED` 诊断而非静默回退 TypeScript 解析器——默认档会直接让 CI 失败，避免"零发现等于没问题"的假安全。详见 [内置分析器与规则 §10](../04-analyzers-and-rules/01-builtin-rules.md)。

**阈值优先级（三层）**：每个分析器读取的调谐值按 `内置分析器默认值 < 全局 thresholds < 分析器自身 options` 合并，且只级联该分析器在 `defaultAnalyzerOptions()` 中声明过的键名，互不串扰。因此全局 `thresholds.complexityWarn` 会真正作用于复杂度分析器，而显式 `analyzers.complexity.options.complexityWarn` 始终最高优先。

**字面量豁免策略**：`ignoreLiterals`（数组，默认 `[]`）让项目把结构性 token（`/`、`..`、`}`、`//`、`\n` 一类）从 `hardcoded-string` 与 `duplicate-literal` 两趟检查中豁免——这些 token 重复出现是语法使然，提取成常量只会增加噪声。匹配时带引号与不带引号两种写法都接受（`"/"` 与 `/` 等价）。它同样受三层优先级管辖：全局 `thresholds.ignoreLiterals` 提供项目级基线，`analyzers.constants.options.ignoreLiterals` 逐分析器覆盖。默认值为空数组是刻意设计——升级引擎不会静默减少消费方已有的门禁发现。

**良性字面量分类（`classifyLiterals`）**：打开后，`magic-number`、`hardcoded-string`、`duplicate-literal` 三趟检查统一跳过 `classifyLiteral()` 判为 benign 的字面量——分隔符、空白与转义序列（含 `\n` 转义写法）、编码名（`utf8`/`base64`）、HTTP 动词、Python docstring 围栏（`"""`）。这些字面量重复出现是「词汇表」使然，本身不承载可提取语义；分类器关闭时引擎行为与旧版逐字节一致，因此默认值为 `false`。

---

## 2. 输出报告格式 (Output Formats)

引擎内置多种标准输出格式化程序：

| 格式标识 (`--format`) | 输出特性 | 适用场景 |
| :--- | :--- | :--- |
| **`json`** (默认) | 结构化完整 JSON 树，包含全量汇总、文件指标与问题详情。 | CI 自动化脚本解析、跨工具集成 |
| **`sarif`** | OASIS 标准静态分析结果交换格式 (SARIF v2.1.0)。 | GitHub Code Scanning / 安全面板直接展示 |
| **`text`** | 彩色终端高亮排版，附带文件名、行号、代码建议与摘要表格。 | 开发者本地 CLI 手动执行 |
| **`compact`** | 单行精简格式 (`file:line:col: [severity] rule: message`)。 | 类 Unix 管道过滤 (`grep` / `awk`) |

> **suppressions 匹配语义**：`matchFile` 接受**精确路径或 glob**（`scripts/**`、`app/cli/*.py`），
> 与 `matchAnalyzer` / `matchRule` / `matchSymbol` 可组合，`reason` 必填；命中的发现**仍留在报告里**
> 并标记 suppression（可审计），只是不再计入门禁阻断。

`summary` 除计数外还带以下**自检与可观测性字段**，用于区分「真零违规」与「规则没跑」：

- `summary.disabledAnalyzers`：被有效配置关闭的分析器清单（`enabled === false`）；`text` 输出打印为 `skipped (disabled) analyzers: …`。
- `summary.warnings`：配置自检提示——include 命中 0 文件、缓存回退重读建图、**语言包关闭却扫到了该语言的文件**（`.py` + `python-modern` 关闭、`.md` + `docs` 关闭）时的 `analyzer coverage:` 提示，以及增量口径下跳过跨文件通道的 `incremental scope:` 说明。
- `summary.postScanPasses`：本报告实际执行的后处理通道（`suppressions` / `dependency-graph` / `baseline`，按执行顺序）。全量扫描含跨文件通道，增量扫描不含——消费方据此判断「这份报告能不能回答跨文件问题」。
- `summary.activatedReviewers`：Sparse MoE 稀疏激活结果（`archetype`、`active`、`skipped`、`activationRatio`、`reason`），明确标识领域分析器激活比例与节约的计算量。
- `summary.uncertainty`：不确定性证据模型度量（`requiresRuntimeCount`、`averageConfidence`），精确量化静态不可证问题。

## 质量分的可评估性契约（notEvaluated / coverage）

量化分数只有在"测了什么"被如实披露时才可信。该契约现在由代码强制，而不是靠文档承诺：

- 维度→分析器映射单一事实源：`DIMENSION_ANALYZERS`（`src/core/scoring/scoringTypes.ts`）。
- 判定规则：某维度的分析器在本次扫描配置中**全部未启用** → 该维度进入 `qualityScore.notEvaluated[]`，
  **不参与加权**（既不当 0 也不当满分）；`compositeScore` 只在已测权重上重归一。
- `qualityScore.coverage = 已测权重 / 总权重`；`confidence = 行数基线 × coverage`，
  即"读了 40% 权重"的扫描不能宣称全量扫描的置信度。
- 未测维度仍会出现在 `indices` 里（保留原始值便于对比），但调用方应以 `notEvaluated` 为准。

自审实测（本仓库，181 文件）：修复前 `composite=43.5 / confidence=0.67`，其中 `modernity=100`、
`codeSecurity=0` 属"未测却打分"；修复后 `composite=38.6 / coverage=0.90 / confidence=0.60`，
`notEvaluated=["modernity"]`（4 个语言包在自审配置中未启用）。

回归锁：`scripts/validate-scoring-coverage.js`（门禁链内）——窄配置 8 个维度判 N/A 且 composite
只按 2 个已测维度重归一；全量配置 `coverage=1`、`notEvaluated=[]` 且 confidence 不低于窄扫描。

### 维度作证者（evaluatedBy）

`qualityScore.evaluatedBy[dimension]` 列出**本次真正启用的分析器**，空数组即"该维度无作证者、判 N/A"。
它解决了一类看起来自相矛盾的报告：`summary.disabledAnalyzers` 里出现 `security`，而 `codeSecurity`
仍然被评估——因为该维度的作证者是**默认启用的 `secrets`**（`DIMENSION_ANALYZERS.codeSecurity =
['security','secrets']`）。自审实测：`codeSecurity witnesses=["secrets"] -> 0`（真实扣分，非未测），
`modernity witnesses=[]`（4 个语言包未启用，判 N/A）。任何维度只要 `evaluatedBy` 非空就必须有真实证据，
为空则不得进入加权——两者由同一份启用状态推导，不会漂移。

### 量化标准的机器可读定义（qualityScore.formulas）

分数不再是"看着像"的标签：报告同时发布它所依据的公式与阈值，调用方可自行复算。

- `formulas.composite`：`sum(indices[d] * weights[d] for d in evaluated) / sum(weights[d] for d in evaluated)`
  ——**只对已测维度**加权（未测维度见 `notEvaluated` / `evaluatedBy`）。
- `formulas.coverage`：已测权重 / 全部权重；`formulas.confidence`：`clamp(行数基线 × coverage, floor, 1)`。
- `formulas.gradeCutoffs`：`A+ ≥95 / A ≥85 / B ≥75 / C ≥65 / D ≥50`，否则 `F`；`formulas.dimensionWeights`
  即实际参与计算的权重（security 1.5 最高、techDebt 1.3、architecture 1.2、maintainability 1.2…）。

回归锁 `scripts/validate-scoring-coverage.js` 断言：发布的权重必须等于实际权重、用发布的阈值复算出的等级
必须等于发布的等级、且公式必须声明"按已测维度加权"。自审实测：`grade=F`、`composite=39`、`coverage=0.90`，
按上述阈值复算仍为 `F`——分数与标签一致，且能解释"为什么是 F"（`performanceEfficiency=0`、
`maintainability=0`、`duplication=0`、`techDebtRisk=0`、`codeSecurity=0` 均为已测维度的真实扣分）。

### 维度扣分明细（deductionsByDimension）

`qualityScore.deductionsByDimension[dim] = { points, entries:[{rule, points, reason}] }`：每个维度的指数可
逐条追溯到具体规则与理由（`applyDeduction` 既有的 `rule`/`line` 字段被消费）。回归锁断言"发布的指数必须与
发布的扣分点按现行算法复算一致"。

**已知缺陷（未修，带证据）**：现行算法是 `index = max(0, 100 - points)`——扣分一多就饱和。自审实测
`techDebtRisk` 累计 **26075 点**并被压成 0，于是"100 条发现"与"10000 条发现"得到同一个指数，极值区间
失去分辨力。去饱和曲线（`100×H/(H+points)`）**本轮尝试后已回退**：`validate-review-memory` 断言架构扣分
路径，在漏斗内改曲线会改变可观测评分行为，超出本批可重新验证的范围；修复需要曲线 + 评分锁 + 冻结基线
三处协调变更，作为独立批次进行。


### 规则族 → 维度的显式路由（familyDimensions）

严重度产生的"债务信号"原本一律进 `techDebtRisk`，于是 `GOV-PRF-*` 这类性能规则从不扣性能维度，
`architectureConsistency` 也长期拿不到任何扣分（永远 100 分 = 无信号）。现在：

- 单一事实源 `FAMILY_DIMENSIONS`（`qualityScorer.ts`）：`GOV-PRF`/`PRF-MEM`/`PRF-IO`/`PRF-ALG`/`PRF-LEAK`/
  `CMP` → `performanceEfficiency`；`GOV-TYP`/`ARCH` → `architectureConsistency`；最长前缀优先。
- 路由作用于**严重度债务信号**：命中所属族的规则把该信号记到目标维度，不再混入通用 `techDebtRisk`；
  各分析器原有的主扣分保持不变（不重复计分）。
- 映射随报告发布：`qualityScore.formulas.familyDimensions`，回归锁断言关键族必须指向预期维度。

自审实测（同一仓库、同一配置）：

| 维度 | 路由前 | 路由后 |
|---|---|---|
| `performanceEfficiency` | 530 点、1 条规则 | **1230 点**（GOV-PRF 510 / PRF-IO 390 / PRF-MEM 170 / PRF-ALG 150） |
| `architectureConsistency` | **0 点、index 100（无信号）** | **555 点（GOV-TYP）、index 0** |
| `techDebtRisk` | 26075 点（混入性能/类型族） | 24840 点（不再混入） |
| composite | 39.0 | **27.0**（架构/性能信号首次计入） |

### 增量（diff 层）评分：`scoreDiff()`

快照层评分回答"这个仓库现在多好",diff 层评分回答"这次改动是变好还是变坏"。
`src/core/scoring/diffScore.ts` 消费 B7 的 `computeIncrementalMetrics`(有效 LOC / 复杂度代理 / 耦合 /
重复行),把增量映射到**同一套十维**:`architectureConsistency = -couplingDelta×2`、
`performanceEfficiency = -complexityDelta×3`、`maintainability = -effectiveLocDelta×0.5`、
`duplication = -duplicationDelta×1`。契约:增量带符号(负 = 变差);`verdict` 原样透传 B7,本模块不重新
裁决;只发布可观测的四项维度;公式与权重随结果发布,校验器断言"每个增量 = 其发布公式作用于对应 metric"。
"删 500 行但耦合上升"因此在维度语言里同时呈现**架构分下降 + 可维护性上升**——行数少 ≠ 更好。
回归锁 `scripts/validate-diff-score.js`(门禁内)。

> 规范性定义（十维模型、公式、阈值、族映射、diff 层公式、单一事实源）见 [`07-quantified-quality-standard.md`](./07-quantified-quality-standard.md)；本文只记录操作细节，两者冲突时以 07 为准。
