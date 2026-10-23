# 现代 TypeScript 高级类型学、全域开销规避与 12 项热路径内存治理范式

> 本指南整合了 TypeScript 编译期类型工程六大原则、四重避免重复开销架构以及 `bench-hot-paths.js` 看守的 12 项热路径内存治理范式。

---

## 一、 TypeScript 高级类型学六大原则

1. **名义量纲烙印 (`Brand<T, B>`)**：使用 `unique symbol` 标记 `TimestampMs`、`LineNumber`、`ColumnNumber`、`FileHash`，零运行时开销，编译期杜绝裸 `number`/`string` 混用；
2. **可辨识联合与 `assertNever` 穷尽推导**：对 `GateStage`、`DiffSemanticCategory` 等联合类型在 `switch` 尾部调用 `assertNever(variant)`；
3. **模板字面量规则代码收窄 (`StandardRuleId`)**：`AR:${RuleDomain}:${RuleFamily}-${RuleNumber}` 编译期防漂移；
4. **精确类型谓词守卫 (`item is Target`)**：外部载荷与 Worker 消息经 `hasWorkerSymbols` 等类型谓词收窄，零 `as any`（`GOV-TYP-005`）；
5. **深度只读 AST 防污染 (`DeepReadonly<NormalizedNode>`)**：防止单趟磁带流中分析器就地变异共享语法树；
6. **参数对象与条件重载 (`SIM-ARGS-001`)**：多形参收敛为只读参数对象接口。

---

## 二、 四重避免重复开销架构与 12 项热路径内存范式

1. **四重避免重复开销流水线**：
   - **MoE 稀疏路由 (`sparseRuleRouter.ts`)**：按 Diff 语义分类跳过 80%~95% 无关分析器；
   - **三级拓扑缓存 (`topology-cache-manager.ts`)**：L1 LRU 内存 + L2 持久化 + L3 DAG 反向闭包最小级联失效；
   - **双缓冲预读与零拷贝 (`worker-scheduler.ts`)**：`inflightRead` 重叠 I/O 与计算，Transferable `ArrayBuffer` 转移所有权；
   - **单趟磁带融合 (`analyzer-runner.ts`)**：单次 AST 遍历并发执行全规则，循环零瞬态分配。
2. **12 项热路径与内存治理刚性范式**：
   - **① Myers Trace 动态缩容**：按编辑距离 $D$ 分配 $(D+1)\times(2D+1)$，超限（$>1500$ 行）回退 `histogramDiff` 并保留前后缀修剪边界；
   - **② Worker 监听器显式解绑**：批次结束调用 `w.off('message', ...)` 与 `w.off(EVENT_ERROR, ...)` 释放 AST 闭包；
   - **③ 队列单指针游标推进**：BFS 用 `queue[head++]` 替代 `queue.shift()`（防 $O(V^2)$）；
   - **④ 显式栈三色迭代 DFS**：`findCycles` 基于显式栈 White/Gray/Black 迭代防爆栈；
   - **⑤ 路径倒排索引 (`nodesByFile`)**：`Map<string, SemanticNode[]>` 消除 `getAllNodes()` 全图扫描；
   - **⑥ 文件级行切片缓存 (`cachedLines`)**：入口单次 `split('\n')`，函数级直接 `slice`；
   - **⑦ 词法正则顶层常量化 (`PRF-MEM-001`)**：禁循环内 `new RegExp()`，`/g` 正则重置 `lastIndex = 0`；
   - **⑧ 同步 I/O 隔离屏障与物理次序 (`PRF-IO-001`)**：经 `*IoBarrier` 封装，类中同步方法物理排在 `async` 之前；
   - **⑨ 循环外集合预索引 (`PRF-ALG-002`)**：循环外预建 `Set` 替代循环内 `Array.includes()`；
   - **⑩ 词法脱敏首字符 $O(1)$ 整数分发 (`source-mask.ts`)**：基于 `charCodeAt` 首字符分发并拆为 5 个 $\text{CC}\le 6$ 纯函数；
   - **⑪ 紧凑 `ActiveHook[]` 单趟行扫描 (`scanner.ts`)**：按扩展名预过滤并在构建 `MaskedLine[]` 同一循环执行回调；
   - **⑫ 零分配字符统计与算子预筛 (`compressionBounds.ts`)**：用 `charCodeAt` 游标统计替代 `.replace(/\s+/g, '')` 并前置算子过滤提前 `break`。
