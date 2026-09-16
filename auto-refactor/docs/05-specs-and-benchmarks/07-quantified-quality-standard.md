# 量化质量标准（Quantified Quality Standard）

本文是 auto-refactor 质量分的**规范性定义**：十维模型、公式、阈值、扣分与增量规则，以及它们
在门禁中的用法。任何实现细节若与本文冲突，以本文为准并修正代码；反之，公式与常量的**单一事实源是
代码**（见文末"单一事实源"），本文只做规范化表述，不复制可执行常量。

适用对象：快照评分（`qualityScorer`）与增量评分（`diffScore`）共用同一套维度语言。

## 1. 十个维度（QualityDimension）

| 维度 | 含义 | 权重 | 作证分析器（`DIMENSION_ANALYZERS`） |
| :--- | :--- | ---: | :--- |
| `architectureConsistency` | 分层/边界/依赖方向是否被遵守 | 1.2 | `architecture`, `dependency-graph` |
| `semanticPurity` | 语义是否被字面量/魔法值污染 | 1.0 | `constants`, `simplify` |
| `codeSecurity` | 凭据、危险调用等安全信号 | 1.5 | `security`, `secrets` |
| `performanceEfficiency` | 复杂度、IO、内存增长等性能信号 | 1.1 | `performance` |
| `standardization` | 命名、死代码、清理等规范项 | 0.9 | `hygiene`, `comments` |
| `modernity` | 语言现代化写法 | 0.8 | `ts-modern`, `python-modern`, `rust-modern`, `gdscript-modern` |
| `maintainability` | 文件规模、复杂度、嵌套 | 1.2 | `complexity`, `large-file` |
| `commentQuality` | 注释/文档完备性 | 0.8 | `comments` |
| `duplication` | 重复字面量/重复代码 | 1.0 | `constants`, `simplify` |
| `techDebtRisk` | 通用债务与错误级问题 | 1.3 | `governance` |

## 2. 快照公式

- **指数**：`index[d] = max(0, 100 - points[d])`（现行实现）
- **可评估性**：某维度的作证分析器在本次配置中**全部未启用** → 该维度进 `notEvaluated`，
  **不参与加权**；`evaluatedBy[d]` 列出真正启用的作证分析器（空数组 = 未评估）。
- **总分**：`composite = Σ(index[d] × weight[d] for d in evaluated) / Σ(weight[d] for d in evaluated)`
- **覆盖率**：`coverage = Σ(weight[d] for d in evaluated) / Σ(weight[d] for all d)`
- **置信度**：`confidence = clamp(baseConfidenceFromLines × coverage, floor, 1)`
- **等级阈值**：`A+ ≥ 95`、`A ≥ 85`、`B ≥ 75`、`C ≥ 65`、`D ≥ 50`，否则 `F`
- **扣分来源**：`deductionsByDimension[d] = { points, entries:[{rule, points, reason}] }`，
  低分必须能逐条追溯到规则；校验器断言"指数 = 按现行算法复算值"。

以上全部随报告发布为 `qualityScore.formulas` / `qualityScore.deductionsByDimension` /
`qualityScore.evaluatedBy`，调用方无需读源码即可复算。

## 3. 规则族 → 维度路由（`FAMILY_DIMENSIONS`）

严重度产生的债务信号默认进 `techDebtRisk`；下列族被显式路由到拥有它的维度（最长前缀优先，
各分析器主扣分不变，不重复计分）：

| 规则族 | 维度 |
| :--- | :--- |
| `GOV-PRF`、`PRF-MEM`、`PRF-IO`、`PRF-ALG`、`PRF-LEAK`、`CMP` | `performanceEfficiency` |
| `GOV-TYP`、`ARCH` | `architectureConsistency` |

映射随报告发布为 `qualityScore.formulas.familyDimensions`，可由消费者审计。

## 4. 增量（diff 层）公式

`scoreDiff(oldContent, newContent)` 消费 `computeIncrementalMetrics`，只发布可观测的四个维度：

| 维度 | 公式 | 默认权重 |
| :--- | :--- | ---: |
| `architectureConsistency` | `- couplingDelta × 2` | 2 |
| `performanceEfficiency` | `- complexityDelta × 3` | 3 |
| `maintainability` | `- effectiveLocDelta × 0.5` | 0.5 |
| `duplication` | `- duplicationDelta × 1` | 1 |

契约：增量带符号（负 = 变差）；`verdict` **原样透传** B7 的增量门（本模块不重新裁决）；只为可观测维度
发布（partial 返回），不为观测不到的维度编造分数。"删 500 行但耦合上升"在维度语言里同时呈现
**架构分下降 + 可维护性上升**——行数少 ≠ 更好。

## 5. 阈值与门禁策略

| 场景 | 判据 | 位置 |
| :--- | :--- | :--- |
| 仓库快照 | `grade`/`composite` 仅作趋势与看板，不单独阻断 | `qualityScore` |
| 改动（diff） | `verdict === 'FAILED'` → 非零退出（如 `--coupling-gate`） | `templates/consumer/run.mjs` |
| 未评估维度 | 进 `notEvaluated`，**不得**计入分母，也不得分派严重度 | `qualityScore.scoring` |
| 自审 | `npm run gate:self` 基线棘轮：只允许收缩 | `scripts/gate-self.js` |
| 规则族路由 | 校验器断言关键族必须指向预期维度 | `scripts/validate-scoring-coverage.js` |

## 6. 已知缺陷（在册，未修）

**饱和**：现行 `index = max(0, 100 - points)` 会把扣分多的维度压成 0；自审实测 `techDebtRisk`
累计 24840 点而 `performanceEfficiency` 1230 点，两者同为 0——极值区间不可分辨。去饱和曲线
（`100×H/(H+points)`）曾实现并被 `validate-review-memory` 的架构扣分断言拦下后回退；修复需要
**曲线 + 评分锁 + 冻结基线**三处协调变更，作为独立批次执行。在修复前，任何"某维度 0 分"的读数都应
同时看 `deductionsByDimension.points`。

## 7. 单一事实源与回归锁

| 内容 | 单一事实源 | 回归锁 |
| :--- | :--- | :--- |
| 维度、权重、公式契约 | `src/core/scoring/scoringTypes.ts` | `validate-scoring-coverage` |
| 指数/覆盖率/置信度/扣分聚合 | `src/core/scoring/qualityScorer.ts` | `validate-scoring-coverage` |
| 规则族路由表 | `qualityScorer.ts::FAMILY_DIMENSIONS` | `validate-scoring-coverage` |
| 增量公式与权重 | `src/core/scoring/diffScore.ts` | `validate-diff-score` |
| 增量指标本体 | `src/core/intelligence/incrementalMetrics.ts` | `validate-data-flow` |

本文只描述**当前实现**；若代码变更使本文失真，视为文档缺陷，必须在同一批次内修正。
