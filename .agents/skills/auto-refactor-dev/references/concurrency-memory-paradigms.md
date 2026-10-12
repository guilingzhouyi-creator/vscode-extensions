# 高并发调度、热路径字符扫描、图算法降阶与 12 项内存治理工程范式

> 本指南总结了 `auto-refactor` 大型静态分析与常驻守护进程中的 12 项核心内存、并发与热路径算法治理范式，由 `node scripts/bench-hot-paths.js` 持续看守。

---

## 一、 12 项刚性治理范式矩阵

| 序号 | 治理范式名称 | 关键模块 / 规则 | 治理手段与标准代码模式 |
| :--- | :--- | :--- | :--- |
| **1** | **Myers Trace 动态缩容与修剪保留** | `diff-engine` | 按编辑距离 $D$ 动态分配 $(D + 1) \times (2D + 1)$ 矩阵；超限（$>1500$ 行或 $>2\text{M}$ 单元格）回退 `histogramDiff` 时继承剥离公共前后缀后的修剪边界。 |
| **2** | **Worker 线程池监听器显式解绑** | `worker-scheduler.ts` | 批次终结（成功/失败）阶段通过 `w.off('message', ...)` 与 `w.off(EVENT_ERROR, ...)` 显式解绑，防止闭包长期持有大型 AST。 |
| **3** | **队列单指针游标推进替代移位** | `SemanticGraph` | BFS 遍历严禁调用 `queue.shift()`（防 $O(V^2)$ 退化）；统一采用 `let head = 0; while (head < queue.length) { const cur = queue[head++]; ... }`。 |
| **4** | **显式栈三色迭代 DFS** | `findCycles` | 废除原生 JS 递归，基于显式 `stack` 执行 White/Gray/Black 三色迭代遍历，免疫万级依赖图递归爆栈。 |
| **5** | **规范化路径倒排索引 (`nodesByFile`)** | `SemanticGraph` | 维护 `Map<string, SemanticNode[]>` 按文件精准索引候选节点，彻底消融 `getAllNodes()` 全图拷贝与线性过滤。 |
| **6** | **分析器文件级行切片缓存 (`cachedLines`)** | `complexity*.ts` | 文件入口处单次执行 `cachedLines = content.split('\n')`，函数级切片直接 `cachedLines.slice(start, end)`。 |
| **7** | **词法正则顶层不可变常量化** | `PRF-MEM-001` | 严禁在函数或循环内动态 `new RegExp()`；统一提升至模块顶层 `const RE_XXX = /^.../`；带 `/g` 标志跨次调用前重置 `lastIndex = 0`。 |
| **8** | **同步 I/O 隔离屏障与物理次序** | `PRF-IO-001` | 必要同步文件操作统一经 `SyncIoBarrier` / `LogIoBarrier` / `PraxisIoBarrier` 封装；类中所有同步方法必须物理排在 `async` 方法之前。 |
| **9** | **循环内集合预索引与单趟匹配** | `PRF-ALG-002` | 循环外预构建 `new Set(...)` 并通过 `Set.has()` 索引；严禁循环内反复 `Array.includes()` 或多次简单正则扫描。 |
| **10** | **词法脱敏首字符 $O(1)$ 整数分发** | `source-mask.ts` | `scanNextMaskSpan` 基于 `raw.charCodeAt(index)` 对首字符（引号 `34/39/96`、斜杠 `47`、`r/b/f/#/@`）执行 $O(1)$ 直达分发，并拆解为 5 个 $\text{CC} \le 6$ 独立扫描子函数，消除每位置 8 路前缀试探。 |
| **11** | **治理扫描器紧凑 `ActiveHook[]` 与单趟行扫描** | `governance/scanner.ts` | 文件入口处按扩展名预过滤出紧凑 `ActiveHook[]`（无匹配立即跳过掩码构建），并将单行规则回调合并入构建 `MaskedLine[]` 的同一循环，消除每文件 200+ 次空转回调与二次行数组遍历。 |
| **12** | **零堆分配字符统计与算子预筛** | `compressionBounds.ts` | 以 `charCodeAt` 游标函数 `countNonWhitespace` 与 `countOperators` 替代 `.replace(/\s+/g, '')` 临时字符串分配与 `safeRegexMatch`；在 `classifyGiantExpression` 中前置算子存在性过滤并提前 `break`。 |

---

## 二、 热路径微基准守卫 (`scripts/bench-hot-paths.js`)

优化词法掩码、治理扫描器或高密度规则时，必须运行热路径基准测试验证吞吐量提升且无回归：
```bash
cd auto-refactor
node scripts/bench-hot-paths.js
```
基准涵盖 `mask-source`（词法脱敏扫描）、`governance-scan`（全规则集文件扫描）与 `cmp-rules`（压缩边界与高密度行分析）三大核心热路径。
