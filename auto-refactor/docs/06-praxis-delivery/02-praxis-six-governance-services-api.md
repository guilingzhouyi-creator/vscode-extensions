# 02. Praxis 六大核心治理服务门面 API 手册

> **所属层级**：L6 Praxis 团队交付专层 (`docs/06-praxis-delivery/`)  
> **对应代码真源**：`src/core/praxis/diffGovernance.ts`、`src/core/praxis/sliceAuditService.ts`、`src/core/praxis/multiAgentGovernance.ts`、`src/core/praxis/trajectoryLearningService.ts`、`src/core/praxis/feedback-adaptive-supervisor.ts`、`src/core/rollback.ts`

---

## 1. 服务门面矩阵总览

为满足 Praxis 平台在**增量代码审查、智能体毫秒级切片自检、多 Agent 并发补丁冲突仲裁、历史重构轨迹学习、线上反馈自适应调权、卡级故障原子回滚**六大场景下的调用需求，`auto-refactor` 在顶层 API (`src/api.ts`) 统一导出了六大高内聚服务门面：

| 序号 | 服务门面接口 / 类 | 核心源码路径 | 关键 SLA 与职责定位 |
| :---: | :--- | :--- | :--- |
| **S-01** | `IPraxisDiffGovernanceService`<br/>(`PraxisDiffGovernanceService`) | `src/core/praxis/diffGovernance.ts` | 语义感知的 Diff 全维审查、逆向依赖闭包计算、八支柱补丁质量打分 (`PatchQualityResult`) 与合入裁决 |
| **S-02** | `IPraxisSliceAuditService`<br/>(`PraxisSliceAuditService`) | `src/core/praxis/sliceAuditService.ts` | **< 10ms** 局部 AST 切片提取、Sparse MoE 稀疏分析器路由（$\ge 70\%$ 绕过率）、调用链爆炸半径追踪与 CAPP 智能体指令合成 |
| **S-03** | `IPraxisMultiAgentGovernanceService`<br/>(`PraxisMultiAgentGovernanceService`) | `src/core/praxis/multiAgentGovernance.ts` | 多 Agent 并发补丁冲突检测、跨 Agent 循环依赖拦截 (`GOV-AGN-001`)、重复劳动识别与候选补丁质量优胜仲裁 |
| **S-04** | `IPraxisTrajectoryLearningService`<br/>(`PraxisTrajectoryLearningService`) | `src/core/praxis/trajectoryLearningService.ts` | 从 Bad$\rightarrow$Good 演进历史提取结构化重构配方 (`RefactoringRecipe`)、检测循环震荡与反模式死灰复燃 (`GOV-TRJ-001`) |
| **S-05** | `FeedbackAdaptiveSupervisor` | `src/core/praxis/feedback-adaptive-supervisor.ts` | 生产事故与回滚台账管理、三平面权重 $(W_s, W_d, W_f)$ 梯度下降闭环自演化、高误报规则置信度阻尼与稳定模式增益 |
| **S-06** | `PraxisRollbackEngine` & `scanDiffStream` | `src/core/rollback.ts`<br/>`src/core/stream.ts` | 异步生成器响应式 Diff 事件流推送 (`file_start` $\rightarrow$ `hunk_ready` $\rightarrow$ `file_done` $\rightarrow$ `stream_end`) 与 Hunk/TaskCard 原子逆序回滚 |

---

## 2. S-01：语义差分治理门面 (`IPraxisDiffGovernanceService`)

### 2.1 核心方法签名

```ts
export interface IPraxisDiffGovernanceService {
    reviewDiff(
        input: DiffInput,
        options?: PraxisGovernanceOptions,
    ): Promise<PraxisDiffGovernanceResult>;

    enrichHunks(
        filePath: string,
        hunks: ReviewDiffHunk[],
        graph?: SemanticGraph,
    ): ReviewDiffHunk[];

    createHooks(graph?: SemanticGraph): PraxisPluginHooks;
}
```

### 2.2 执行流水线与返回载荷 (`PraxisDiffGovernanceResult`)

调用 `defaultPraxisDiffGovernanceService.reviewDiff(input, options)` 时，内部按以下五步协同执行：

1. **向量化差分切块**：调用 `computeDetailedHunks` 生成带精确起止行号的 `ReviewDiffHunk[]`。
2. **跨语言语义投影**：若传入 `SemanticGraph`，自动通过对应语言适配器（TS/Python/Rust/Go/GDScript 等）将新旧文本投影至语义拓扑图。
3. **五层审查器联动**：按配置依次执行 Layer 1 全域安全审查 (`defaultPyramidEvaluator`)、算法与循环性能审查 (`defaultPerformanceEvaluator`)、数据架构与查询审查 (`defaultDataArchitectureEvaluator`)、测试现代性与契约覆盖审查 (`defaultTestModernityEvaluator`)、元架构边界审查 (`defaultMetaArchitectureEvaluator`)。
4. **八支柱补丁质量量化**：调用 `evaluatePatchQuality` 计算本次补丁的净质量得分与 `deltaScore`。
5. **生成合入裁决**：汇总 `impactSummary`（受影响下游文件总数与路径列表）及 `verdict`（`passed` / `minor_fix_needed` / `major_rework_needed`）。

---

## 3. S-02：微秒/毫秒级 AST 切片审计门面 (`IPraxisSliceAuditService`)

专为智能体高频编码循环（Inner-Loop Coding）设计，避免每次局部编辑都触发全文件全量分析器扫描。

### 3.1 核心方法详解

| 方法名 | 输入参数 | 返回类型 | 核心功能说明 |
| :--- | :--- | :--- | :--- |
| `auditSlice` | `(input: PraxisSliceAuditInput, callGraph?: CallGraph)` | `Promise<PraxisSliceAuditVerdict>` | 提取最小语法包围切片，计算 Sparse MoE 激活计划，追踪破坏性签名变更 (`GOV-SLC-001`) 并返回微秒级耗时指标 |
| `auditAgentSlice` | `(input: PraxisSliceAuditInput, callGraph?: CallGraph)` | `Promise<CompactAgentPrompt>` | 在 `auditSlice` 基础上直接合成符合 **CAPP（Compact Agent Prompt Protocol）** 的极简英文修复指令，可直接拼入 LLM Context Window |
| `traceCallImpact` | `(file, symbol, hasBreakingMutation?, callGraph?)` | `CallChainImpactResult` | 不执行规则扫描，仅在内存 `CallGraph` 上瞬时计算指定符号的直接调用方、传递调用闭包与爆炸半径风险等级 |
| `getRoutingPlan` | `(file, oldCode, newCode, changedLines?)` | `SparseRoutingPlan` | 基于变更熵密度（CED）计算本次修改需要激活的专家分析器子集（`activeAnalyzers`）与可安全跳过的分析器子集（`bypassedAnalyzers`） |

### 3.2 破坏性切片变更自动拦截 (`GOV-SLC-001`)

当 `ASTSliceExtractor` 检测到导出函数/方法的签名发生破坏性变更（如必选参数增删、返回契约收窄）且 `CallChainImpactTracer` 发现下游存在活跃调用方时，服务自动发射 `GOV-SLC-001` 阻断级告警，列出所有受波及的下游调用文件。

---

## 4. S-03：多智能体并发治理门面 (`IPraxisMultiAgentGovernanceService`)

针对多个 Agent 在不同 Cell 并行修改同一代码库时的协作冲突问题，提供四项核心能力：

1. **`reviewMultiAgentPatches(patches, options)`**：
   - 接收一组并发提交的 `AgentPatchSlice[]`；
   - 识别重叠文件修改、符号级编辑碰撞与重复开发浪费（默认重叠率阈值 `duplicateWorkThreshold = 0.5`）；
   - 输出 `PraxisMultiAgentGovernanceResult`，包含 `blockingIssues`、`advisoryWarnings` 以及合入总裁决（`'approved' | 'rejected' | 'rework_needed'`）。
2. **`detectAgentCollisions(patches, baseEdges)`**：
   - 将各 Agent 新增的模块导入边叠加至仓库基准依赖图 `baseEdges`；
   - 若 Agent A 新增 `A -> B` 且 Agent B 同时新增 `B -> A` 形成跨智能体循环依赖，立即捕获并生成 `GOV-AGN-001` 违规记录。
3. **`attributeAgentChanges(filePath, revisions)`**：
   - 统计文件多版本演进中各 Agent 的净留存代码贡献率、重写率与回滚率。
4. **`arbitrateCompetingPatches(patches)`**：
   - 当多个 Agent 针对同一任务提交竞争性候选补丁时，按静态质量得分、复杂度增量与架构契合度自动排序选出最优候选补丁。

---

## 5. S-04：重构轨迹配方学习门面 (`IPraxisTrajectoryLearningService`)

将团队与优秀 Agent 的历史重构经验沉淀为可复用的结构化知识库：

- **`learnFromTrajectory(input: PraxisTrajectoryLearningInput)`**：对比重构前后的代码快照（`beforeContent` vs `afterContent`），若质量分净增（`qualityDelta > 0`），自动抽象出 `RefactoringRecipe`（含触发反模式特征、目标结构模板与适用语言）并注册入库。
- **`detectRegressions(filePath, revisions)`**：扫描文件修订序列 `FileRevision[]`，若检测到 `A -> B -> A` 形式的循环修改震荡（Ping-Pong Churn）或已修复反模式死灰复燃，立即发射 `GOV-TRJ-001` 告警。
- **`matchRecipes(code, language)`**：针对待重构的目标代码片段检索高匹配度历史配方，辅助 Agent 定向改写。

---

## 6. S-05：反馈自适应监督器 (`FeedbackAdaptiveSupervisor`)

实现静态审查评分与生产运行结果的闭环对齐，数学演化律定义为：

$$W_{t+1} = \operatorname{Proj}_{\Delta}\Big(W_t + \eta \cdot (\text{ActualOutcome} - \text{PredictedScore}) \cdot \nabla W\Big), \quad \eta \in [0.01, 0.05]$$

其中 $\operatorname{Proj}_{\Delta}$ 保证静态平面权重 $W_s$、动态平面权重 $W_d$、反馈平面权重 $W_f$ 始终满足非负且归一化约束 $W_s + W_d + W_f = 1.0$。

- **事件台账记录 (`recordIncident`)**：支持登记 `'runtime_crash'`、`'rollback'`、`'performance_degradation'`、`'stable_milestone'`、`'false_positive'` 五类真实工程结果。
- **规则置信度阻尼 (`RuleReliabilityStats`)**：若某条规则触发的自动重构频繁引发回滚，其置信度乘子 `confidenceMultiplier` 在 $[0.2, 1.2]$ 区间内自动下调。
- **架构模式稳定性增益 (`PatternStabilityStats`)**：长期保持零事故的架构模块获得 $[1.0, 1.25]$ 的稳定性加分增益。
- **持久化快照 (`saveSnapshot` / `loadSnapshot`)**：支持将演化后的权重与台账序列化为 `GovernanceLedgerSnapshot` JSON 文件，供 CI 跨轮次继承。

---

## 7. S-06：响应式 Diff 流 (`scanDiffStream`) 与原子回滚引擎 (`PraxisRollbackEngine`)

### 7.1 异步事件流 (`scanDiffStream`)

`scanDiffStream(inputs, options)` 返回标准 `AsyncGenerator<DiffStreamEvent>`，按生命周期依次产出四类事件：

1. `file_start`：标记单文件增量审查启动；
2. `hunk_ready`：每完成一个 Hunk 的差分、归属解析、AST 富集与阈值评估即刻推送，无需等待整文件结束；
3. `file_done`：单文件全部 Hunk 处理完毕，附带文件级汇总统计；
4. `stream_end`：整批增量流闭合，输出全量吞吐耗时。

### 7.2 三级联动原子回滚 (`PraxisRollbackEngine`)

- **Level 1 — 单 Hunk 原子逆转 (`revertDiffHunk`)**：精确反转指定 Hunk 的增删操作（`insert` $\leftrightarrow$ `delete`），保留其余行不动。
- **Level 2 — 任务卡级多文件逆序回滚 (`revertTaskCard`)**：按时间戳逆序撤销同一 `cardId` 关联的全部文件 Hunk，确保行号偏移严格对齐。
- **Level 3 — 依赖链级联回滚**：结合 `parentCardIds` 自动识别依赖已回滚卡片的子任务卡，生成完整撤回清单与检查点回退记录。

---

## 8. 关联文档导航

- [01. Praxis 对接架构全景与五大 SPI 契约手册](./01-praxis-architecture-and-spi-contracts.md)
- [03. Praxis 团队联调操作手册与交付验收矩阵](./03-praxis-integration-runbook-and-acceptance.md)
