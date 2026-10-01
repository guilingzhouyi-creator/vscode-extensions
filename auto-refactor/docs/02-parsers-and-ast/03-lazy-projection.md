# 03. 控制流图 (CFG)、数据流图 (DFG) 与符号调用图构建

> **所属层级**：L2 跨语言解析与语义图底座 (`docs/02-parsers-and-ast/`)  
> **对应代码真源**：`src/core/cfg/`、`src/core/intelligence/dataFlow.ts`、`src/core/intelligence/callGraph.ts`、`src/core/dependency-graph.ts`、`crates/ops-graph/`

---

## 1. 零物化懒投影与多维图索引体系

在大型工程审查中，并非每个文件都需要构建昂贵的控制流与数据流图。`auto-refactor` 采用**按需懒投影（Lazy Projection）**策略：仅当文件被 Sparse MoE 路由分派至需要深层图分析的规则（如循环内 I/O 分配、未界定集合增长、错误流吞没、跨文件死锁/环依赖）时，才从 `NormalizedNode` 投影构建以下四类内存图结构：

| 图结构名称 | 源码实现模块 | Native 加速算子 | 支撑的核心分析能力 |
| :--- | :--- | :--- | :--- |
| **控制流图 (CFG)** | `src/core/cfg/` | `crates/ops-graph` (Lengauer-Tarjan 支配树) | 不可达死代码检测、循环嵌套深度与热路径 (`Hot Loop`) 识别、异常捕获块逃逸分析 |
| **数据流与生命周期图 (DFG)** | `src/core/intelligence/dataFlow.ts` | `src/core/native/native-flow-shim.ts` | 变量定义-使用链 (Def-Use)、生命周期阶段 (`LifecycleStage`)、未界定容器增长 (`detectUnboundedGrowth`) |
| **符号调用图 (`CallGraph`)** | `src/core/intelligence/callGraph.ts` | `crates/ops-graph` (逆向可达闭包) | 跨文件函数调用链追踪、破坏性修改冲击半径计算 (`CallChainImpactTracer`) |
| **模块依赖图 (`ModuleDependencyGraph`)** | `src/core/dependency-graph.ts` | `crates/ops-graph` (Tarjan SCC) | 全仓导入环路检测 (`findImportCycles` / `DEP-CYC-001`)、未引用导出死符号扫描 (`unused-export`) |

---

## 2. 控制流图 (CFG) 与支配树算法

`src/core/cfg/` 将函数体分解为基础块（Basic Blocks）与有向控制转移边（顺序执行、条件跳转、循环回边、异常抛出边 `throw/catch/finally`）：

1. **Lengauer-Tarjan / CHK 支配树加速**：通过 `crates/ops-graph` 计算每个基础块的直接支配节点（Immediate Dominator），在 $O(E \alpha(E, V))$ 近线性时间内精确识别自然循环头（Natural Loop Headers）与回边（Back-Edges）。
2. **循环内阻塞与堆分配检测**：结合支配树识别出的循环体范围，精准驱动 `PRF-IO-001`（循环内同步阻塞 I/O）、`PRF-MEM-001`（高频循环内瞬态对象分配）与 GDScript `GME-PRF-001`（`_process`/`_physics_process` 帧循环堆分配）告警。

---

## 3. 数据流图 (`DataFlowGraph`) 与无界增长诊断

`src/core/intelligence/dataFlow.ts` 将程序状态建模为携带生命周期标签（`LifetimeKind`: `'transient' | 'request' | 'singleton' | 'global'`）的数据流节点：

- **传输边分类 (`TransferType`)**：区分值拷贝（`copy`）、引用别名（`alias`）、容器追加（`append` / `push` / `set`）与清理释放（`clear` / `delete` / `dispose`）。
- **无界内存增长检测 (`detectUnboundedGrowth`)**：若某个具备 `'singleton'` 或 `'global'` 生命周期的 `Map` / `Set` / `Array` 容器存在处于请求处理路径上的 `append` 入边，但全生命周期内缺失任何 `clear` / `delete` / 容量淘汰（Eviction）出边，引擎立即判定为潜在内存泄漏隐患并发出告警。

---

## 4. 跨文件调用图 (`CallGraph`) 与上下文切片 (`ContextSlice`)

- **符号级逆向闭包**：`CallGraph` 不仅记录文件级导入，更精确到 `(callerFile, callerSymbol) -> (calleeFile, calleeSymbol)`。当 `calleeSymbol` 发生签名变动时，`CallChainImpactTracer` 可在 `< 1ms` 内返回直接调用方与多跳传递调用方列表。
- **最小上下文切片 (`buildContextSlice`)**：位于 `src/core/intelligence/contextSlice.ts`，给定目标行号或违规点，自动顺着 DFG 与 CFG 向上游提取相关的类型声明、常量定义与直接依赖函数，裁剪掉 85% 以上的无关代码，为 LLM 重构 Agent 构造高信噪比的修复上下文。

---

## 5. 关联文档导航

- [01. 统一语法树 `NormalizedNode` 与八语言语义 IR (`SemanticGraph`)](./01-multilang-abstraction.md)
- [05. Rust N-API 原生加速内核与双轨等价桥](../01-architecture/05-rust-native-operator-kernel.md)
