# Praxis 平台与开发团队集成指南 (Praxis Integration Guide)

> **文档版本**: 2.0 · 生产工程级标准  
> **适用受众**: Praxis 核心平台团队、多 Agent 自治运行时（Cell Runtime）研发团队、CI/CD 自动化流水线维护人员  
> **架构对齐**: [agent-native-system-blueprint.md](../../docs/agent-native-system-blueprint.md) §2.1 一体两面三层拓扑 Diff 体系与 Cell 平权自治体系

---

## 一、 架构定位与核心价值

在多智能体自治演化体系中，`auto-refactor` 作为静态重构与审查底座，向 **Praxis 开发团队** 提供开箱即用、类型安全、低延迟、可插拔的审查与差分分析能力。

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Praxis 协作运行时 (Praxis Cell Runtime)              │
│   ┌─────────────────────┐    ┌──────────────────────────────────────┐  │
│   │   构建部门 (Builder) │    │      专业审查部门 (Review Cell)       │  │
│   └──────────┬──────────┘    └──────────────────┬───────────────────┘  │
└──────────────┼──────────────────────────────────┼──────────────────────┘
               │                                  │
               ▼                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│               PraxisReviewClient (统一客户端 SDK 门面)                  │
├────────────────────────────────────────────────────────────────────────┤
│  • reviewWorkspace()       : 全工作区多维体检与指令分发               │
│  • reviewFile()            : 单文件 AST 切片与 MoE 稀疏路由审查        │
│  • reviewDiff()            : 内存/暂存区 Diff 审查与拓扑影响闭包计算   │
│  • evaluateMergeGate()     : 分形 Git 合并门禁与回滚判定               │
├────────────────────────────────────────────────────────────────────────┤
│  • 一体两面三层拓扑 Diff   : Agent Face (补丁) / Human Face (UI 胶囊) │
│  • 面向 Agent 结构化指令   : 5 维结构化指令包 (锚点/契约/模板/分层/验证)│
└────────────────────────────────────────────────────────────────────────┘
```

### 核心设计原则
1. **单一事实源与高内聚门面**：通过 `IPraxisReviewClient` 收口所有底层分析器（Scanner、SemanticGraph、SparseMoEGateRouter、PyramidEvaluator）；
2. **多智能体上下文感知**：原生透传 `cardId`、`cellId`、`agentUid` 与 `checkpointId`，自动标记至代码行级归属（`AttributedDiffLine`）；
3. **一体两面（Dual-Faced）**：
   - **面向 Agent 实体**：提供精确行号偏移、AST 语义符号定位、确定性 Patch 指令；
   - **面向人类与 UI**：提供双语本地化、折叠层级、视觉高亮徽章与审查决策建议；
4. **三层拓扑架构（Three-Tier Topology）**：
   - **Layer 1**：物理变更行与执行单元映射；
   - **Layer 2**：反向依赖闭包与架构契约冲突（`ARCH-*`, `DEP-*`）；
   - **Layer 3**：循环内堆分配（`ADV-PRF-002`）、破坏性变更与 L3A 升级告警；
5. **100% 向后兼容**：底层 `IPraxisDiffGovernanceService` 保持完全独立，外部存量调用无感升级。

---

## 二、 快速接入与客户端初始化

### 1. 引入依赖与工厂初始化

```typescript
import {
    createPraxisClient,
    type IPraxisReviewClient,
    type PraxisClientConfig,
} from 'auto-refactor';

// 创建标准客户端实例（开箱即用，内部自动装配 SemanticGraph 与 MoE 稀疏路由）
const client: IPraxisReviewClient = createPraxisClient({
    root: process.cwd(),
    defaultAgentUid: 'praxis-builder-agent-01',
    defaultCellId: 'cell-core-infrastructure',
    enablePerformanceAudit: true,
    enableArchitectureAudit: true,
});
```

也可以直接复用工作区默认单例：

```typescript
import { defaultPraxisReviewClient } from 'auto-refactor';

const verdict = await defaultPraxisReviewClient.reviewWorkspace();
```

---

## 三、 四大核心调用意图与实战范式

### 1. 意图 A：全工作区工程体检与 Agent 指令集下发

适用于全量审查、定时巡检或大型重构任务启动前：

```typescript
const verdict = await client.reviewWorkspace({
    root: '/path/to/project',
    include: ['src/**/*.ts'],
    exclude: ['**/*.test.ts'],
    format: 'agent', // 可选 'json' | 'sarif' | 'agent' | 'capp' | 'praxis'
});

console.log('总体健康分:', verdict.scoreAssessment.overallScore);
console.log('门禁状态:', verdict.status); // 'PASS' | 'BLOCK' | 'WARN'

// 提取面向 Agent 的结构化执行包
const directives = verdict.agentDirectives;
for (const dir of directives.directives) {
    console.log(`[${dir.ruleContract.severity}] ${dir.targetContext.filePath}:${dir.targetContext.startLine}`);
    console.log('不可变契约:', dir.immutableConstraints.contractRules);
    console.log('修复指引:', dir.remediationRecipe.remediationSummary);
    console.log('建议验证命令:', dir.verificationDirective.command);
}
```

### 2. 意图 B：单文件极速 AST 切片审查

适用于 Agent 编辑完单个文件后的实时检查（延迟 `<15ms`）：

```typescript
const fileVerdict = await client.reviewFile('src/core/router/sliceExtractor.ts', {
    agentUid: 'agent-executor-42',
    cardId: 'TASK-CARD-8812',
});

if (fileVerdict.status === 'BLOCK') {
    // 获取注入 Agent 上下文的 Markdown 指令
    console.log(fileVerdict.agentDirectives.renderedMarkdown);
}
```

### 3. 意图 C：内存 Diff / 暂存区审查与拓扑影响分析

适用于 Agent 提出代码修改、准备提交或多 Agent 交叉审查时：

```typescript
import type { DiffInput } from 'auto-refactor';

const diffInput: DiffInput = {
    filePath: 'src/core/cache.ts',
    kind: 'full',
    oldContent: '...', // 修改前内容
    newContent: '...', // 修改后内容
};

const diffResult = await client.reviewDiff(diffInput, {
    cardContext: {
        cardId: 'CARD-REFACTOR-CACHE',
        cellId: 'cell-storage',
        agentUid: 'builder-01',
    },
});

console.log('合并裁决:', diffResult.verdict.status); // 'passed' | 'minor_fix_needed' | 'major_rework_needed'
console.log('下游受影响文件闭包:', diffResult.impactSummary.affectedFiles);

// 获取标准 Unified Patch (兼容 git apply)
if (diffResult.unifiedPatch) {
    console.log('Unified Patch:\n', diffResult.unifiedPatch);
}

// 访问三层拓扑数据
const topology = diffResult.topologicalDiff;
if (topology) {
    console.log('Layer 1 物理变更行数:', topology.layer1BuildUnit.totalChangedLines);
    console.log('Layer 2 架构冲突项:', topology.layer2ReviewCell.contractConflicts.length);
    console.log('Layer 3 是否需升级 L3A:', topology.layer3ConflictRisk.shouldEscalateToL3A);
}
```

### 4. 意图 D：分形 Git 跨分支合并门禁判定

适用于构建分支合入集成分支、或集成分支合入主干前的前置拦截：

```typescript
const gateVerdict = await client.evaluateMergeGate(
    'subagent/feature-perf-opt',
    'cell/main',
    diffResult.hunks,
    {
        cardContext: {
            cardId: 'CARD-MERGE-01',
            cellId: 'cell-engine',
            agentUid: 'merger-agent',
        },
    },
);

if (!gateVerdict.approved) {
    console.error('合并阻断原因:', gateVerdict.reason);
    console.error('违规清单:', gateVerdict.violations);
} else {
    console.log('合并通过，一体两面 Diff 胶囊已生成:', gateVerdict.dualFacedDiff.humanFace.statusText);
}
```

---

## 四、 面向 Agent 的结构化提示信息协议 (Agent Directives)

审查系统为 Agent 输出纯客观、结构化、自包含的修复指令包，杜绝含混建议：

```typescript
export interface AgentActionableDirective {
    /** 1. 目标位置与真实代码锚点切片 */
    targetContext: {
        filePath: string;
        startLine: number;
        endLine: number;
        startColumn?: number;
        endColumn?: number;
        anchorCodeSlice?: string; // 携带前后 2 行上下文并高亮标记违规行
        targetSymbol?: string;
    };
    /** 2. 规则契约与客观根因 */
    ruleContract: {
        ruleId: string;           // 真实登记于 rule-catalog.json 的规则 ID
        severity: 'BLOCK' | 'WARN' | 'INFO';
        topologyLayer: 'L1_CONTRACT' | 'L2_OPERATOR' | 'L3_CONFIG' | 'L4_PRESENTATION' | 'L5_GOVERNANCE';
        rootCause: string;
    };
    /** 3. 不可变前置/后置防腐约束 */
    immutableConstraints: {
        preservesPurity: boolean;
        zeroHeapAllocationInLoop: boolean; // ADV-PRF-002
        immutableStateSnapshot: boolean;
        elocBudgetConstraint: boolean;     // GATE-AST-001
        noExternalSideEffects: boolean;
        contractRules: string[];
    };
    /** 4. 确定性修复指导与代码模板 */
    remediationRecipe: {
        actionVerb: string;
        remediationSummary: string;
        templateSnippet?: string;          // AST / 代码替换模板
        safeToAutomate: boolean;
    };
    /** 5. 精准质性验证命令 */
    verificationDirective: {
        command: string;                  // 如 'npm run test:fast -- -t ...'
        description: string;
        assertionCriteria: string;        // 质性功能与输入输出断言
    };
}
```

---

## 五、 一体两面三层拓扑 Diff 规范 (Topological Diff)

对齐架构蓝图 §2.1，Diff 引擎提供面向两种消费者的双重投影：

### 1. 双面投影模型 (Dual-Faced Projections)
- **Agent Face (`DiffAgentFace`)**：
  - 精确行号映射（`oldSpan` / `newSpan` / `exactLineOffsets`）；
  - AST 符号作用域（`enclosingSymbol` / `symbolKind`）；
  - 代码切片（`codeSlice`）；
  - 确定性补丁指令（`patchDirective`，如 `PATCH [15..28] IN computeCoupling`）。
- **Human/UI Face (`DiffHumanFace`)**：
  - 双语字典映射（`i18nKey` / `i18nMessage`）；
  - 折叠分级（`foldingLevel`: 1 级符号级，2 级代码级）；
  - 视觉样式分类（`visualHighlight`: `added` | `deleted` | `modified` | `conflict` | `critical`）；
  - 风险严重度胶囊（`decisionBadge`）。

### 2. 三层拓扑分层 (Three-Tier Topological Hierarchy)
- **Layer 1（构建执行单元）**：物理增删改行数统计、受影响行号序列、AST 节点映射；
- **Layer 2（专业审查域）**：反向跨文件依赖闭包、语义图谱传播路径、架构契约冲突（`ARCH-*` 等）；
- **Layer 3（冲突与高危风险）**：跨层级违规绕过、大规模单向破坏性删除、循环内堆分配（`ADV-PRF-002`）、未决 Git 合并冲突标记。

---

## 六、 生产级性能与并发安全

1. **非阻塞异步 I/O**：全链路采用 `fs.promises` 读取文件，杜绝同步阻塞（`PRF-IO-001`）；
2. **循环零瞬态堆分配**：Diff 与行打标循环严格避免在每行生成闭包或对象字面量，采用就地修改与索引遍历；
3. **MoE 条件专家分发稀疏路由**：单文件审查仅激活与当前文件类型相关的分析器，绕过率 $\ge 75\%$，保证毫秒级响应。

