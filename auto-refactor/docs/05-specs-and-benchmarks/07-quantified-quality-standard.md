# 量化质量标准（Quantified Quality Standard）

本文是 auto-refactor 质量分的**规范性定义**：十维模型、公式、阈值、扣分与增量规则，以及它们
在门禁中的用法。任何实现细节若与本文冲突，以本文为准并修正代码；反之，公式与常量的**单一事实源是
代码**（见文末"单一事实源"），本文只做规范化表述，不复制可执行常量。

适用对象：快照评分（`qualityScorer`）与增量评分（`diffScore`）共用同一套维度语言。

## 1. 十个维度（QualityDimension）

| 维度 | 含义 | 权重 | 量纲 | 作证分析器（`DIMENSION_ANALYZERS`） |
| :--- | :--- | ---: | :--- | :--- |
| `architectureConsistency` | 分层/边界/依赖方向是否被遵守 | 0.111 | density | `architecture`, `dependency-graph` |
| `semanticPurity` | 语义是否被字面量/魔法值污染 | 0.093 | density | `constants`, `simplify` |
| `codeSecurity` | 凭据、危险调用等安全信号 | 0.139 | **absolute** | `security`, `secrets` |
| `performanceEfficiency` | 复杂度、IO、内存增长等性能信号 | 0.102 | density | `performance` |
| `standardization` | 命名、死代码、清理等规范项 | 0.083 | density | `hygiene`, `comments` |
| `modernity` | 语言现代化写法 | 0.074 | density | `ts-modern`, `python-modern`, `rust-modern`, `gdscript-modern` |
| `maintainability` | 文件规模、复杂度、嵌套 | 0.111 | density | `complexity`, `large-file` |
| `commentQuality` | 注释/文档完备性 | 0.074 | density | `comments` |
| `duplication` | 重复字面量/重复代码 | 0.093 | density | `constants`, `simplify` |
| `techDebtRisk` | 通用债务与错误级问题 | 0.120 | density | `governance` |

权重归一化到 **1.0**（与八柱模型、七轴模型同口径），因此可直接跨评分面比较；只有相对比值有意义。

**量纲（`DIMENSION_SCALE_MODE`）**：`absolute` 按缺陷绝对计数计分，不随文件规模缩放；
`density` 按缺陷密度计分。当前仅 `codeSecurity` 为 `absolute`——一个硬编码凭据就是 1 个缺陷，
无论文件是 20 行还是 500 行，若按规模缩放会低估其严重性。

## 2. 快照公式

### 2.1 维度指数（`applyScaleDampedScores`）

设线性扣分点为 `points[d]`，文件规模系数 `scaleFactor = max(1, nonBlankLines / 100)`。

- **absolute 维**：`index[d] = max(0, 100 - points[d])`（不缩放）
- **density 维**：`density = points[d] / scaleFactor`，再取倒数型饱和曲线
  `index[d] = 100 × H / (H + density)`，半点常数 `H = SATURATION_HALFPOINT = 30`

倒数曲线**无硬截断**、严格单调、渐近于 0：密度越过约 240 之后，指数不再被压成同一个 0，而是
保持可分辨（24840 点 → 0.60，1230 点 → 10.90）。这取代了此前的指数饱和
`min(points, 100×(1-e^(-density/40)))`，后者用 `min` 把惩罚硬钳在 100，导致两个相差 20 倍的维度
映射到完全相同的 0 分。

### 2.2 可评估性与聚合

- **可评估性**：某维度的作证分析器在本次配置中**全部未启用** → 该维度进 `notEvaluated`，
  **不参与加权**；`evaluatedBy[d]` 列出真正启用的作证分析器（空数组 = 未评估）。
- **总分**：`composite = exp( Σ(w[d]·ln(max(index[d], F)) for d in evaluated) / Σ(w[d]) )`，
  `F = COMPOSITE_INDEX_FLOOR = 15`
  —— **加权几何平均**。算术平均会让九个满分维掩盖一个归零维度（0 与九个 100 平均得 90），
  几何平均受最小值约束，短板必然拉低总分。
- **覆盖率**：`coverage = Σ(w[d] for d in evaluated) / Σ(w[d] for d in all d)`（算术权重比）
- **置信度**：`confidence = clamp(baseConfidence × coverage, floor, 1)`，其中
  - **文件级**：`baseConfidence = 0.6 + min(lines, 300) / 750`，小文件不足以支撑强结论
  - **项目级**：`baseConfidence = 0.6 + totalLines / (750 × 20)`，**不施加 300 行封顶**。
    旧实现把全仓行数当单文件传入，300 行封顶使 `baseConfidence` 恒为 1.0，
    `confidence` 退化为 `coverage`，代码规模维度失效（见 §7.9）
- **等级阈值**：`A+ ≥ 90`、`A ≥ 80`、`B ≥ 70`、`C ≥ 60`、`D ≥ 50`，否则 `F`；
  当**没有任何维度被评估**时，`composite = NaN` 且 `grade = 'N/A'`——这是数据缺失，
  不是评分失败，不得记为 `F`。
- **权重校验**：任一维度权重为负数或非有限值时 `computeCompositeScore` 抛 `RangeError`；
  旧的 `totalWeight || 1` 兜底会把非法配置静默转成任意分数。

### 2.3 扣分来源与可复算契约

`deductionsByDimension[d] = { points, effectivePoints, entries:[{rule, points, reason}] }`：

- `points`：**线性**扣分和，等于 `entries` 的逐条求和，可精确对账审计轨迹。
- `effectivePoints`：**曲线实际消费**的惩罚，满足 `100 - effectivePoints == indices[d]`。
  旧实现把饱和后的值覆写进 `points`、而 `entries` 仍是线性原值，二者互相矛盾，
  导致调用方无法从报告复算出指数；现在两者并列发布。

以上全部随报告发布为 `qualityScore.formulas`（含 `indexMapping`、`saturationHalfpoint`、
`dimensionScaleMode`、`gradeCutoffs`）、`qualityScore.deductionsByDimension` 与
`qualityScore.evaluatedBy`，调用方无需读源码即可复算。

## 3. 规则族 → 维度路由（`FAMILY_DIMENSIONS`）

严重度产生的债务信号默认进 `techDebtRisk`；下列族被显式路由到拥有它的维度（最长前缀优先）。
**族路由表与声明式扣分规则表（`DIMENSION_RULES`）必须对同一条规则给出同一维度**，否则一条发现会被
扣到两个不同维度上；`scripts/validate-dimension-consistency.js` 对全部 243 条注册规则逐条断言这一不变量。

| 规则族 | 维度 |
| :--- | :--- |
| `GOV-PRF`、`PRF-MEM`、`PRF-IO`、`PRF-ALG`、`PRF-LEAK`、`CMP`、`CPX`、`DAT` | `performanceEfficiency` |
| `ARCH` 及各 `ARCH-*` 子族、`DEP-LAZ`/`DEP-RES`/`DEP-INV`、`DAT-LAY`/`DAT-DEF` | `architectureConsistency` |
| `GOV-TYP` | `semanticPurity`（隐式松散类型属类型纯度缺陷，非架构违规） |
| `CPX-REC`/`CPX-BUD`/`CPX-JST`/`CPX-HOP`/`CPX-RED`/`CPX-NEST`/`CPX-STM`、`TST-TAU`/`TST-DBT`/`TST-TOP` | `maintainability` |
| `DEP-ORD`/`DEP-WLD` | `standardization` |
| `TST`（其余） | `modernity` |

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
| 族路由 vs 规则表一致 | 243 条注册规则的族路由必须与扣分表给出同一维度 | `scripts/validate-dimension-consistency.js` |
| 指数曲线性质 | 严格单调、不硬归零、`100 - effectivePoints == indices` | `tests/unit/scoring-formulas.test.ts` |
| 短板惩罚 | 一个维度归零时 composite 必须低于算术平均 | `tests/unit/scoring-formulas.test.ts` |
| 权重合法性 | 负/非有限权重抛 `RangeError`；默认权重和为 1.0 | `tests/unit/scoring-formulas.test.ts` |
| 未测量分数 | NaN 必须经 `isMeasured`/`scoreDelta` 判定，不得静默走默认分支 | `tests/unit/scoring-formulas.test.ts` |
| 跨维度扣分上界 | 单条发现最多计入 4 个维度轴 | `scripts/validate-dimension-consistency.js` |
| 报告契约 | 产出的报告必须通过 `report.schema.json`（含 JSON 往返） | `scripts/validate-report-schema.js` |
| CFG 守卫语义 | 内联终结守卫不报、无守卫解引用必报 | `tests/unit/cfg-inline-guard.test.ts` |

## 6. 四套评分面：口径差异与适用场景

同一份十维 `indices` 会被四个模型各聚合一次。它们**刻意不共用同一个聚合函数**，
因为面向的问题不同；把「不一致」当作缺陷去统一会破坏各自的语义。此处登记口径，
供消费者按场景选用，并避免把不同面的数字横向比较：

| 评分面 | 聚合方式 | 短板处理 | 适用场景 | 位置 |
| :--- | :--- | :--- | :--- | :--- |
| **十维 composite** | 加权**几何**平均，指数下限 15 | 短板必然拉低总分 | 仓库级质量趋势与看板 | `scorer-formulas.ts` |
| **八柱** | 柱内算术平均 + 柱间线性加权 | 柱内短板被平均稀释 | 架构治理与风险分 | `eightPillarModel.ts` |
| **静态七轴** | 轴内算术平均 + 轴间线性加权 | 同上 | 静态分析平面 `S_i = P_i × C_i × I_i` | `static-quality-model.ts` |
| **三平面融合** | 平面间**线性**加权 | 无下限 | 融合静态与运行时动态证据 | `fusion-scorer.ts` |

**数据柱（`data`）的来源**：八柱与七轴的 data 轴此前都回退到 `architectureConsistency`，
使该十维指数获得合计 0.25 的权重（`architecture:0.15` + `data:0.1`），高于任何真实轴。
现改为取 `duplication` 与 `semanticPurity`——真正描述数据质量的两个维度。

**八柱的 `data` 柱与 `duplication` 同时进入 `extensibility` 柱**（权重 0.15）。
这是有意的：一个轴可以支撑两个支柱的不同侧面。若需完全互斥，需重新设计支柱划分。

**`fatalCount` 不参与 composite**：项目级聚合统计并发布 fatal 数量，但不让它进入分数。
有 error 级发现的仓库仍可能得 A+。这是**已登记的已知限制**，让 fatalCount 门禁 composite
是独立决策。

## 7. 改造记录（已修）

### 7.1 饱和硬截断（已修）

旧实现 `index = max(0, 100 - min(points, 100×(1-e^(-density/40))))` 用 `min` 把惩罚硬钳在 100：
自审实测 `techDebtRisk` 累计 24840 点、`performanceEfficiency` 1230 点，两者同为 0，极值区间不可分辨。
现已改为倒数型密度曲线 `100×H/(H+density)`（§2.1），无硬截断、严格单调、渐近 0。

### 7.2 跨维度重复计分（已修）

`applyIssueDeductions` 顺序调用四个扣分器，而 `claimed` 去重集合原先只在规则表内部生效，
三个族扣分器完全绕过去重。现已在 `applyIssueDeductions` 单点建立跨扣分器共享的去重闸门。
`ARCH-LEAK-002` 仍会对两个维度各扣一次——凭据泄漏既是架构违规也是安全缺陷，属**设计意图**，
去重粒度是「维度」而非「发现」；其安全侧 rationale 追加 `[dual-axis]` 标记以便审计区分。

### 7.3 族路由与规则表矛盾（已修）

`CPX-NEST`/`CPX-STM` 缺显式条目而落到 `CPX` 兜底（`performanceEfficiency`），与规则表的
`maintainability` 矛盾；`GOV-TYP` 被路由到 `architectureConsistency`，而规则表扣在
`semanticPurity`；`TST-TOP` 被 `TST` 兜底路由到 `modernity`，规则表扣在 `maintainability`。
三者均已修正，并新增 `scripts/validate-dimension-consistency.js` 对 243 条规则常驻看守。

### 7.4 报告不可复算（已修）

`groupDeductionsByDimension` 原先把饱和后的值覆写进 `points`，而 `entries` 保留线性原值，
两者互相矛盾；且 `formulas` 未发布指数算法。现已拆分为 `points`（线性，可对账 entries）与
`effectivePoints`（曲线消费值，满足 `100 - effectivePoints == indices[d]`）并列发布，
并补发 `indexMapping` / `saturationHalfpoint` / `dimensionScaleMode`。自审实测十维
`100 - effectivePoints` 与 `indices` 的偏差为 0.0000。

### 7.5 数据缺失被记为评分失败（已修）

窄扫描（例如只启用 `simplify`，它不为任何维度作证）会让 `evaluatedDimensions` 为空，
旧代码经 `totalWeight || 1` 把 composite 压成 0 并评为 `F`。现改为 `composite = NaN`、
`grade = 'N/A'`，打印器输出"N/A (no quality dimension was measured)"。

### 7.6 NaN 语义在下游全面失效（已修）

7.5 引入的 `'N/A'` 语义原先只在人读的终端打印生效，机器读的下游全部失效：

- `patchQuality` 的 `deltaScore` 为 NaN 时 `>0.5` 与 `<-0.5` 皆 false，**恒判 `neutral` 静默通过**。
  现改为 `deltaScore: number | null` 并新增 `unavailable` 判定；`patchArbiter` 把未评估补丁
  排除出仲裁并给出明确 reason。
- `reporterRegistry` 的 badge 渲染出字面量 `NaN` 且 `score>=90` 恒 false 强制红色。
- `trainingExporter` 把 NaN 当 falsy 静默写 0，**伪装成"中性"训练样本**。
- `anomalyDetector` / `regressionTrajectoryDetector` 的 NaN 差值使**回归检测静默失效**。
- `agentAttribution` 的 `reduce` 遇 NaN 污染整个平均值。
- `reportBuilder` 的 `revisionId` 拼入 `NaN`，同内容不同状态的 revision 身份不可区分。
- `index.ts` 用 `?? 'N/A'`，而 `??` **拦不住 NaN**。

现由 `scorer-formulas` 的 `isMeasured` / `scoreDelta` 统一判定，12 处消费点全部加保护。

### 7.7 两套 grade 阈值并存（已修）

`hierarchicalScorer` 自带一套 95/85/75/65/50，与 `scorer-formulas` 的 90/80/70/60/50 冲突：
同一 92 分在两个评分面分别判 `A+` 与 `A`。且其 `resolveGrade(NaN)` 返回 `'F'`，
恰是 7.5 要消除的缺陷。现已删除本地副本，改用 `resolveQualityGrade` 单一事实源。

### 7.8 报告通不过自己的 schema（已修）

`report.schema.json` 设 `additionalProperties: false` 但只定义 8 个顶层字段，而报告构建器
还输出 `qualityScore` / `fileQualityScores` / `triPlaneQuality` / `autonomy`，
`summary` 与 `issues[]` 也有未定义字段——**实测 5318 处违规**，即引擎产出的每份报告都通不过
自己发布的 schema。因无任何校验代码，漂移长期未被发现。现已补全定义并新增
`scripts/validate-report-schema.js`（真实报告 + JSON 往返双重校验），违规降为 0。

### 7.9 项目级 confidence 恒等于 coverage（已修）

`evaluateProject` 把全仓非空行总和当单文件大小传入，而 `calculateConfidence` 内有 300 行封顶，
故任何超过约 300 行的仓库 `baseConfidence` 恒为 1.0，`confidence` 退化为 `coverage`，
代码规模维度彻底失效。现拆分为 `calculateConfidenceFromVolume(lines, coverage, scope)`：
项目级不施加 300 行封顶，并以 `PROJECT_SCALE_FACTOR` 保持与文件级可比的曲线。
实测窄扫描下 `confidence=0.6` 而 `coverage=0.2`，两者已解耦。

### 7.10 CFG 建模：内联终结守卫被误报、无守卫解引用被漏报（已修）

`buildFromLines` 逐行处理且不解析花括号，整行 `if (!user) return;` 被判为 `condition`
（`cfg-builder.ts` 的 `classifyStatementKind` 以 `startsWith('if ')` 判定），行内 `return` 被丢弃，
落通块看起来像非终结守卫，于是后续 `user.name` 被误报。现新增 `CfgBuilder.inlineTerminator`
识别内联 `return`/`throw`/`break`/`continue`，并让守卫分支直连 exit。

同时发现第二个缺陷：解引用检测整体被 `if (guardedNullVars.size > 0)` 包裹，
**完全没有守卫的文件从不被检查**——最直接的空指针解引用不产生任何 finding。
现改为「终结守卫保护的变量豁免，其余一律检查」，并以
`tests/unit/cfg-inline-guard.test.ts` 的 9 条正反向用例锁定（负例必须静默、正例必须报出）。

## 8. 单一事实源与回归锁

| 内容 | 单一事实源 | 回归锁 |
| :--- | :--- | :--- |
| 维度、权重、量纲、公式契约 | `src/core/scoring/scoringTypes.ts` | `validate-scoring-coverage`、`scoring-formulas.test.ts` |
| 指数曲线/聚合/阈值/置信度 | `src/core/scoring/scorer-formulas.ts` | `scoring-formulas.test.ts` |
| 编排、formulas 发布、扣分分组 | `src/core/scoring/qualityScorer.ts` | `validate-scoring-coverage` |
| 规则族路由表 | `src/core/scoring/dimensionDeductions.ts::FAMILY_DIMENSIONS` | `validate-dimension-consistency` |
| 声明式扣分规则表 | `src/core/scoring/dimensionRuleTable.ts::DIMENSION_RULES` | `validate-dimension-consistency` |
| 原型自适应权重 | `src/core/scoring/archetype-weight-tuner.ts` | `scoring-formulas.test.ts` |
| 增量公式与权重 | `src/core/scoring/diffScore.ts` | `validate-diff-score` |
| 增量指标本体 | `src/core/intelligence/incrementalMetrics.ts` | `validate-data-flow` |

本文只描述**当前实现**；若代码变更使本文失真，视为文档缺陷，必须在同一批次内修正。

## 9. 改造前后实测对比

以下为对本仓库自身执行 `scan --root . --score` 的实测（同一代码库、同一配置）。
最后一列为第一、二轮全部改造完成后的状态：

| 指标 | 改造前 | 第一轮 B1–B4 | 第一轮 B5 | 第二轮完成后 |
| :--- | ---: | ---: | ---: | ---: |
| `compositeScore` | 95.9 | 95.8 | 95.2 | **95.2** |
| `grade` | A+ | A+ | A+ | **A+** |
| `coverage` | 1 | 1 | 1 | **1** |

| 维度 | 改造前 | 第一轮 B1–B4 | 第一轮 B5 | 第二轮完成后 |
| :--- | ---: | ---: | ---: | ---: |
| `architectureConsistency` | 99.7 | 99.6 | 99.9 | 99.9 |
| `semanticPurity` | 99.2 | 99.1 | 99.1 | 99.1 |
| `codeSecurity` | 100 | 100 | 100 | 100 |
| `performanceEfficiency` | 98.2 | 98.0 | 98.0 | 97.9 |
| `standardization` | 97.8 | 97.2 | 97.1 | 97.1 |
| `modernity` | 100 | 100 | 100 | 100 |
| `maintainability` | 95.5 | 94.5 | 94.5 | 94.5 |
| `commentQuality` | 99.9 | 99.9 | 99.9 | 99.9 |
| `duplication` | 67.2 | **67.8** | 67.8 | 67.8 |
| `techDebtRisk` | 99.5 | 99.3 | 99.3 | 99.3 |

读法：

- `duplication` 上升 0.6——它是全库最短板（8766 条 entries），旧指数饱和把它额外压低，
  倒数曲线恢复了真实位置。
- 其余维度下降 0.1–1.0——跨扣分器去重移除了重复计入的部分，这是分数**变准**而非变差。
- `composite` 由 95.9 降到 95.2——几何平均让 `duplication` 这条短板真正参与扣分，
  旧算术平均下该维度单独只有约 0.3 的权重影响。
- 第二轮（契约收口、CFG 修复、八柱 data 修正）后 composite 与 grade **保持不变**，
  仅 `performanceEfficiency` 因源码本身被本轮改造而微降 0.1。连续两次扫描结果完全一致，
  分数可重现。
