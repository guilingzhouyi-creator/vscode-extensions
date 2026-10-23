# Praxis 客户端 SDK、一体两面三层拓扑 Diff 与 Rust+TS 字节等价规范指南

> 本指南整合了 Praxis 客户端 SDK（`src/core/praxis/`）、一体两面三层拓扑 Diff（`diff-topology.ts`）、表现层并查集语义聚合（`semantic-correlation.ts`）以及 Rust 原生算子与纯 TS Shim 100% 字节等价契约。

---

## 一、 Praxis 客户端 SDK (`IPraxisReviewClient`) 与 `AgentDirectives`

```typescript
import { createPraxisClient, IPraxisReviewClient } from 'auto-refactor';

const client: IPraxisReviewClient = createPraxisClient({
  root: process.cwd(),
  enableMoE: true,
  includeDualFacedPresentation: true,
  defaultLocale: 'zh-CN',
});
```

提供四大异步方法：`reviewWorkspace`、`reviewFile`、`reviewDiff`、`evaluateMergeGate`，输出 `AgentDirectivesBundle`（含结构化 `items`、超紧凑 `compactPromptText`、`renderedMarkdown` 与前端卡片 `presentationPayload`）。

---

## 二、 一体两面三层拓扑 Diff 与表现层并查集去重

1. **一体两面对称表达**：
   - **`DiffAgentFace`（机器可执行）**：AST 作用域 `enclosingSymbol`、精确行偏移 `exactLineOffsets`、确定性补丁指令 `deterministicHunkId`；
   - **`DiffHumanFace`（人类与 UI 友好）**：四色徽章 `decisionBadge`、双语 `i18nMessage`、审查动作建议（`accept | auto_fix | rework | escalate_l3a | reject`）。
2. **三层 Diff 拓扑**：L1 构建单元行/AST 映射 $\to$ L2 `SemanticGraph` 反向依赖影响闭包 $\to$ L3 跨层违规、破坏性删除、循环堆分配与冲突标记阻断（触发 `shouldEscalateToL3A`），经 `toAgentUnifiedPatch()` 输出标准 `git apply` 补丁。
3. **表现层语义去重 (`semantic-correlation.ts`)**：对同文件同行命中的规则按 11 组重叠规则族（`SEMANTIC_OVERLAP_GROUPS`）并查集聚类，按严重度权重 $\text{block (4)} > \text{warn (3)} > \text{info (2)} > \text{pass (1)}$ 选举单张 `primaryCard`（`electPrimaryCard`），其余写入 `correlatedRules: string[]`。

---

## 三、 Rust 原生算子与纯 TS Shim 100% 字节等价矩阵

| 算子领域 | 核心算法与数据结构 | Rust 原生 Crate | Pure-TS 回退文件 | 验收脚本 |
| :--- | :--- | :--- | :--- | :--- |
| **行扫描与脱敏** | 64-bit SWAR 向量化脱敏状态机 | `crates/ops-mask` | `src/core/native/native-mask-shim.ts` | `validate-native-parity.js` |
| **Myers 差分** | Bit-Parallel Myers 差分算法 | `crates/ops-diff` | `src/core/native/native-diff-shim.ts` | `validate-equivalence.js` |
| **支配树与控制流** | Tarjan SCC 与 Lengauer-Tarjan 支配树 | `crates/ops-graph` | `src/core/native/native-flow-shim.ts` | `validate-control-flow-graph.js` |
| **代码克隆检测** | MinHash + b-Bit LSH 局部敏感哈希 | `crates/ops-clone` | `src/core/native/native-clone-shim.ts` | `validate-native-bridge.js` |

两端必须保证：**JSON 键序确定性拓扑排序**、**UTF-8 字符与 LF 行偏移严格一致**、**浮点分值统一保留 4 位精度**。
