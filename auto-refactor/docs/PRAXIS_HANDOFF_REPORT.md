# Praxis 定制高性能 Diff 底座交付与接入技术报告 (Index)

完整技术报告已归档至系统架构文档中心：
👉 **[docs/03-incremental-and-diff/03-praxis-integration-guide.md](03-incremental-and-diff/03-praxis-integration-guide.md)**

---

### 🚀 核心交付摘要

1. **算力基准**：
   - 64 位 SWAR 纯 ASCII 扫描吞吐：**720.5 MB/s**
   - Bit-Parallel Myers (BPM) 位并行差分：**15.8 微秒**
   - 5,000 行 10 处分散编辑：**2.90 ms**
   - 1,000 文件大批次流式管道处理：**85.9 ms (1.16 万文件/秒)**
   - 500 轮连续高压 Diff 内存增量：**-2.72 MB (0 内存泄漏 / 0 GC 抖动)**

2. **核心特性矩阵**：
   - **5 大 SPI 扩展插槽**：动态卡片/Cell 归属、AST 作用域富集、审核熔断阈值、环形缓冲存储、双流分发；
   - **跨文件行级依赖 Diff**：`ModuleDependencyGraph` 7.2 微秒瞬时反查逆向影响闭包；
   - **“一体两面”响应式事件流**：`scanDiffStream` 异步生成器实时推流，支持 4 级零 GC 静默/限流门禁；
   - **卡级原子全域回滚**：`PraxisRollbackEngine.revertTaskCard()` 跨文件多 Hunk 逆序原子撤回。

3. **测试覆盖**：
   - 全套 6/6 测试套件通过率 **100% PASS**（`validate`, `validate-warm`, `validate-oxc`, `validate-diff`, `validate-praxis`, `test-codec`）。
