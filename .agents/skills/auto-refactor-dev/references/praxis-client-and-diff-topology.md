# Praxis 客户端 SDK、表现层语义聚合与一体两面三层拓扑 Diff 规范指南

> 本指南为 `auto-refactor` 中 Praxis 客户端 SDK（`src/core/praxis/`）、表现层语义去重聚合引擎（`semantic-correlation.ts`）、一体两面三层拓扑 Diff（`diff-topology.ts`）与 `AgentDirectives` 协议的权威参考手册。

---

## 一、 Praxis 客户端 SDK (`IPraxisReviewClient` / `createPraxisClient`)

Praxis 客户端 SDK 是面向多智能体协同、CI 门禁与开发者工具的统一高级调用门面，通过强类型接口解耦底层 AST 扫描细节：

### 1. 客户端初始化与工厂
```typescript
import { createPraxisClient, IPraxisReviewClient } from 'auto-refactor';

const client: IPraxisReviewClient = createPraxisClient({
  root: process.cwd(),
  enableMoE: true,
  includeDualFacedPresentation: true,
  defaultLocale: 'zh-CN',
  defaultCardContext: {
    cardId: 'CARD-1024',
    cellId: 'CELL-REFACTOR-01',
    agentUid: 'agent-worker-42',
    checkpointId: 'chk-d3f030a'
  }
});
```

### 2. 核心调用 API
1. **`reviewWorkspace(options?: PraxisWorkspaceReviewOptions): Promise<PraxisWorkspaceReviewVerdict>`**：执行全工作区全量或过滤分析，输出 `scanReport`、`status`、`issues`、`agentDirectives` 与 `directivesMarkdown`。
2. **`reviewFile(filePath: string, content?: string, options?: PraxisFileReviewOptions): Promise<PraxisFileReviewVerdict>`**：针对单文件执行 AST 切片与 Sparse MoE 条件路由器审查，输出单文件判定 `verdict`、`sparsePlan` 与机器指令。
3. **`reviewDiff(input: DiffInput, options?: PraxisGovernanceOptions): Promise<PraxisDiffGovernanceResult>`**：执行代码变更的语义化审查，生成三层拓扑 Diff、反向依赖影响闭包、8 支柱补丁质量评分与标准统一补丁。
4. **`evaluateMergeGate(sourceBranch: string, targetBranch: string, hunks: ReviewDiffHunk[]): Promise<PraxisMergeGateVerdict>`**：在分支合并与 Pull Request 阶段评估合并门禁不变量，输出 `approved`、`violations` 与一体两面 Diff。

---

## 二、 一体两面三层拓扑 Diff 引擎 (`diff-topology.ts`)

### 1. 一体两面对称表达 (Dual-Faced Diff)
- **Agent Face (`DiffAgentFace`) — 机器可执行**：携带精确 AST 作用域（`enclosingSymbol`、`scopeRange`、`symbolKind`）、行号精确映射（`exactLineOffsets`，区分 `context`/`insert`/`delete`）、确定性补丁指令（`deterministicHunkId`、`patchDirective`）与代码切片（`codeSlice`）。
- **Human Face (`DiffHumanFace`) — 人类与 UI 友好**：携带决策徽章（`decisionBadge`: `red`/`yellow`/`blue`/`green`）、双语字典（`i18nMessage` 支持 `zh-CN`/`en`）、折叠层级 `foldingLevel`、审查动作建议（`suggestedReviewAction`: `accept` | `auto_fix` | `rework` | `escalate_l3a` | `reject`）与质性依据 `rationale`。

### 2. 三层拓扑结构 (Three-Tier Topology)
1. **Layer 1: Build Execution Unit Diff (`DiffLayer1BuildUnit`)**：物理代码行变更量、增删改统计、变更行号列表与基础 AST 节点映射（`DiffAstNodeMapping`）。
2. **Layer 2: Review Cell Diff (`DiffLayer2ReviewCell`)**：利用 `SemanticGraph` 计算反向依赖影响闭包、依赖传播路径（`SemanticPropagationNode`）与跨模块架构契约冲突（`DiffContractConflict`）。
3. **Layer 3: Conflict & High-Risk Diff (`DiffLayer3ConflictRisk`)**：拦截跨层依赖违规（`DiffCrossLayerRisk`）、破坏性改动（`DiffDestructiveRisk`）、循环内瞬态堆分配风险（`DiffLoopAllocationRisk`）与未决 Git 冲突标记（`DiffConflictMarker`），触发专家升级仲裁（`shouldEscalateToL3A`）。
4. **Unified Patch 输出**：通过 `toAgentUnifiedPatch()` 与 `formatUnifiedDiff()` 生成与标准 `git apply` 100% 兼容的补丁文本。

---

## 三、 AgentDirectives 结构化指令协议 (`agent-directives.ts`)

```typescript
export interface AgentDirectivesBundle {
  items: AgentDirectiveItem[];                      // 结构化指令条目 (含 safeToAutomate, action, templateSnippet)
  compactPromptText: string;                        // 适合注入单次 Prompt 的超紧凑 CAPP 文本
  renderedMarkdown: string;                         // 人类与 LLM 易读的格式化 Markdown
  presentationPayload?: PraxisPresentationPayload;  // 前端诊断卡片
  summary: { total: number; blockCount: number; warnCount: number; infoCount: number; };
}
```

---

## 四、 表现层语义聚合引擎 (`semantic-correlation.ts`) 与 `correlatedRules`

当底层扫描在同一文件路径与同一行号命中多条规则时，表现层通过并查集（Disjoint Set）对 11 组重叠规则族（`SEMANTIC_OVERLAP_GROUPS`）进行等价聚类：
1. **11 组语义重叠规则族**：涵盖命名与卫生（`HYG-STB-002`/`GOV-SAN-001`）、门面与抽象（`ARCH-FAC-001`/`ARCH-ABS-001`）、控制流扁平化（`SIM-FLAT-002`/`SIM-GUARD-001`/`CPX-NEST-001`/`CPX-NEST-002`）、内存与对象池（`GDM-POOL-001`/`PRF-MEM-001`/`PRF-MEM-002`）等。
2. **主卡片选举 (`electPrimaryCard`)**：按严重度权重 $\text{block (4)} > \text{warn (3)} > \text{info (2)} > \text{pass (1)}$ 选举 `primaryCard`，其余关联规则代号去重写入 `correlatedRules: string[]` 与 `correlationCount: number`。
3. **消费契约**：UI 仅渲染单张主卡片并附带关联徽章；AI Agent 优先针对主卡片执行单一原子修复，顺带消融次级关联规则。
