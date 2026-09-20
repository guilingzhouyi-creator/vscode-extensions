# 性能基准与吞吐量压测规范 (Performance Benchmarks & Boundaries)

> **所属模块**：`05-specs-and-benchmarks`  
> **核心源码**：`scripts/bench-hot-paths.js`, `scripts/bench-baselines.js`, `scripts/bench-quant.js`, `scripts/bench-warm.js`, `scripts/bench-diff.js`, `scripts/gate-self-slice.js`  
> **基线记录**：`bench/hot-paths-baseline.json`, `scripts/bench-history.json`, `reports/perf-multi-dimensional-baseline.json`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 性能基准流水线与触发契约

为了严格防范性能衰退，仓库建立了全维基准测试与防劣化流水线：

```bash
npm run hotpath-bench         # 3 大热点路径性能防衰退门禁 (mask-source, cmp-rules, governance-scan)
npm run hotpath-baseline:update # 更新热点路径高水位记录基线
npm run bench-baselines       # 全局吞吐量基线（TypeScript vs OXC、多阶段 Profile 并记入 bench-history.json）
npm run bench-quant           # 64-bit SWAR、Bit-Parallel Myers 与 50k 行极限压测基准
npm run bench-asymmetric      # 不对称双轨推测扫描与 MoE 专家路由旁路实测
npm run bench-warm            # L1/L2 缓存加速效果与热扫描守护进程延迟 (S1~S6)
npm run bench-diff            # Git Diff 增量扫描加速比与字节级等价验证
npm run gate:self:slice:warning # 增量切片自审门禁 (MoE 动态路由毫秒级响应)
```

---

## 2. 全维度性能基准指标全景矩阵 (Multi-Dimensional Matrix)

基于 2.51 MB / 234 个源码文件 / 63,905 行规模的当前工程实测数据：

| 评测维度与场景 | 历史基线 (1.71 MB) | 当前实测 (2.51 MB) | 提升幅度与收益 |
| :--- | :--- | :--- | :--- |
| **全域治理扫描吞吐** | 2.63 MB/s (651.2ms) | **3.66 MB/s** (684.8ms) | **吞吐量净提升 +39.2%**（代码 +46.4% 下耗时仅 +5.1%） |
| **增量切片自审 (`gate:self:slice`)** | 35.8 s (全量扫描) | **1.9 s** | **提速 ~18.8 倍**（动态旁路 65%~85% 无关冷分析器） |
| **不对称快速裁决 (FastTrack)** | 1,284 ms (冷全库) | **0.22 ms** | **5,836 倍极速响应** |
| **SWAR 64-bit ASCII 向量扫描** | 传统逐字节匹配 | **0.0914 ms** (603.5 KB) | **吞吐量突破 6,448.4 MB/s (6.45 GB/s)** |
| **Myers Disjoint 极端最坏情况 (1k行)** | 40.17 ms | **0.410 ms** | **提速 98.0 倍 (耗时缩减 99.0%)** |
| **5,000 行源码 10 处分散编辑** | 63.28 ms | **3.549 ms** | **提速 17.8 倍** |
| **Bit-Parallel Myers (64位向量)** | 0.0430 ms | **0.0178 ms (17.8 μs)** | **提速 2.42 倍** |
| **OXC 原生解析 vs TS 官方编译器** | 14.05 ~ 19.36 ms | **1.46 ~ 2.24 ms** | **解析耗时降低 85%~92%** |
| **守护进程热缓存扫描 (1001 文件)** | ~1,200 ms | **~180 ms** | **提速 6.67 倍** |
| **10% 变更增量热更新** | ~1,100 ms | **~85 ms** | **提速 12.9 倍** |

---

## 3. 优化技术架构与核心机制

1. **AST 单通道多路复用 (Single-Pass Multiplexing)**：全部分析器共用单次 AST 深度优先遍历，彻底消除多次全树重复遍历，节约 35%~50% 遍历 CPU 开销。
2. **评估上下文零堆分配 (Zero-Allocation Evaluation Context)**：`GovernanceAnalyzer` 在单文件中复用单例 `reusableEvalCtx`，在节点遍历时原地更新引用，消除数十万次堆对象分配。
3. **AST 节点粗筛与规则文本级短路**：
   - 节点级：非函数、非方法、非控制流节点在入口短路跳过，过滤 90% 以上无效节点；
   - 规则级：全域 22 项规则全部加装前置文本短路（如 `return true`、`Sync(`、`for`、`while`、`any`、`catch`、`except`），95% 以上无关文件在 $O(1)$ 内直接退出。
4. **MoE 稀疏路由与增量语法切片**：基于 Git diff 仅提取改动行关联的语法单元局部 AST 切片，结合上下文事件派发（CED）仅激活 15%~35% 专家分析器，将日常提交门禁从几十秒压至 1.9 秒。
5. **硬件对齐向量化 (SWAR 8 Bytes/Cycle & Bit-Parallel)**：利用 64 位整数寄存器并发扫描 8 个字节的 ASCII 边界，Myers 最坏情况优化为位并行剪枝。

---

## 4. 基线记录库与防劣化约束体系

- **热点门禁记录库**：[`bench/hot-paths-baseline.json`](../../bench/hot-paths-baseline.json) 由 `bench-hot-paths.js` 统一看守，任何热点路径劣于基线 15% 自动阻断流水线。
- **历史演进记录库**：[`scripts/bench-history.json`](../../scripts/bench-history.json) 自动追加记录历次提交的关键性能指纹与硬件环境信息。
- **全维基准快照库**：[`reports/perf-multi-dimensional-baseline.json`](../../reports/perf-multi-dimensional-baseline.json) 结构化封存 6 大维度的基线度量数据，作为长期技术演进对比的标准基准。
