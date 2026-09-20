# Praxis 定制高性能 Diff 底座交付与接入技术报告 (Index)

完整技术报告与系统设计规范已归档至系统架构文档中心：
- 👉 **[1. Praxis 底座接入与接口改造指南](03-incremental-and-diff/03-praxis-integration-guide.md)**
- 👉 **[2. Praxis 分形 Git 门禁工作树与生命周期规范](01-architecture/04-praxis-git-fractal-and-gating-spec.md)**

---

### 🚀 核心交付摘要

1. **算力基准**：
   - 64 位 SWAR 纯 ASCII 向量扫描吞吐：**6,448.4 MB/s**
   - Bit-Parallel Myers (BPM) 64 位向量差分：**17.8 微秒** (较标准 Myers 提速 **2.42x**)
   - 5,000 行 10 处分散编辑：**3.55 ms** (全量基准 **63.28 ms**，提速 **17.8x**)
   - 500 轮连续高压 Diff 内存增量：**0 内存泄漏 / 0 GC 抖动**
   - 治理规则扫描净吞吐量：**3.66 MB/s** (零堆分配单例上下文)

2. **核心特性矩阵**：
   - **5 大 SPI 扩展插槽**：动态卡片/Cell 归属、AST 作用域富集、审核熔断阈值、环形缓冲存储、双流分发；
   - **跨文件行级依赖 Diff**：`ModuleDependencyGraph` 瞬时反查逆向影响闭包；
   - **响应式事件流**：`scanDiffStream` 异步生成器实时推流，支持多级门禁联动；
   - **卡级原子全域回滚**：`PraxisRollbackEngine.revertTaskCard()` 跨文件多 Hunk 逆序原子撤回。

3. **测试与门禁保障**：
   - 全量 55 套并行/异步测试流水线通过率 **100% PASS**（16.75s 闭环完成）。
