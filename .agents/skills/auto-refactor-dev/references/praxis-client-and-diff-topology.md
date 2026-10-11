# Praxis 客户端 SDK 与一体两面三层拓扑 Diff 规范指南

> 本指南为 `auto-refactor` 中 Praxis 表现层治理子系统与拓扑差分引擎的权威参考手册。

---

## 一、 Praxis 客户端 SDK 架构 (`IPraxisReviewClient`)

Praxis 客户端 SDK 是面向多智能体协同、CI 门禁与开发者工具的统一高级调用门面（位于 `src/core/praxis/`），通过强类型接口解耦底层 AST 扫描细节：

### 1. 统一接口契约
```typescript
export interface IPraxisReviewClient {
  readonly root: string;
  reviewWorkspace(options?: PraxisWorkspaceReviewOptions): Promise<PraxisWorkspaceReviewVerdict>;
  reviewFile(filePath: string, content?: string, options?: PraxisFileReviewOptions): Promise<PraxisFileReviewVerdict>;
  reviewDiff(input: DiffInput, options?: PraxisGovernanceOptions): Promise<PraxisDiffGovernanceResult>;
  evaluateMergeGate(sourceBranch: string, targetBranch: string, hunks: ReviewDiffHunk[]): Promise<PraxisMergeGateVerdict>;
}
```

### 2. 工厂构造与上下文透传
通过 `createPraxisClient` 构造统一客户端实例，支持注入任务卡上下文（CardContext：`cardId`、`cellId`、`agentUid`、`checkpointId`），为所有生成的审查判定与机器指令打上可溯源的元数据标签。

---

## 二、 一体两面三层拓扑 Diff 引擎

Diff 治理子系统（`src/core/praxis/diff-topology.ts`）实现了机器代理（Agent Face）与人类审查（Human Face）100% 数据对称的“一体两面”：

### 1. 数据对称公理
- **底层统一数据模型**：两端完全基于同一份结构化 JSON 数据生成；
- **Agent 面**：输出确定性可解析的指令字典（`AgentDirectives`），供自动化工具和 SubAgent 执行；
- **人类面**：输出符合 GitHub 风格的 Markdown 表格与折叠代码块，便于人类工程师快速决策。

### 2. 三层拓扑递进解剖
1. **L1 行级物理差异**：基于 Myers 差分算法计算文本行的增删改；
2. **L2 AST 语义级差异**：基于 `NormalizedNode` 分析节点类型变更，区分实质语义修改与排版变化；
3. **L3 架构依赖级差异**：基于 `SemanticGraph` 计算反向依赖影响闭包（Impact Closure），评估改动的全局爆炸半径。

---

## 三、 AgentDirectives 结构化指令协议

Praxis 审查输出包含一等公民的 `agentDirectives` 集合，标准结构如下：

```json
{
  "action": "REFACTOR_SIMPLIFY",
  "targetFile": "src/core/ast/slice.ts",
  "startLine": 42,
  "endLine": 68,
  "reason": "Cyclomatic complexity CC=18 exceeds budget baseline CC<=15",
  "ruleId": "GATE-AST-001",
  "patchSnippet": "..."
}
```

Agent 在消费该指令时，必须优先应用结构化补丁，并自主闭环执行本地门禁验证。
