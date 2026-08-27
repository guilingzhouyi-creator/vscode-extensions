# 性能基准与吞吐量压测规范 (Performance Benchmarks & Boundaries)

> **所属模块**：`05-specs-and-benchmarks`  
> **核心源码**：`scripts/benchmark.js`, `scripts/bench-baselines.js`, `scripts/bench-warm.js`, `scripts/bench-diff.js`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 性能基准与度量场景

为了监控版本迭代中的性能表现，仓库建立了统一的基准压测流水线：

```bash
npm run benchmark         # 基础冷扫描性能基准
npm run bench-baselines   # 全局吞吐量基线（单核 vs 多核 Worker）
npm run bench-warm        # L1/L2 缓存加速效果与热扫描延迟
npm run bench-diff        # Git Diff 增量扫描加速比
npm run fastpath-bench    # 懒投影 Fastpath 对比基准
```

---

## 2. 核心性能指标矩阵 (Benchmark Matrix)

基于 1,000+ 源码文件标准语料库实测数据：

| 执行阶段 | TypeScript 官方引擎 | OXC Fastpath 引擎 | 加速收益 |
| :--- | :--- | :--- | :---: |
| **冷扫描解析 (Per-file Parse)** | ~1.25 ms | ~0.35 ms | **提升 ~70%** |
| **冷扫描端到端 (1000 Files w4)** | ~1100 ms | ~450 ms | **提升 ~60%** |
| **热扫描命中 (Warm Scan)** | ~15 ms | ~15 ms | **毫秒级极速响应** |
| **Diff 增量扫描 (Single File)** | ~2 ms | ~1 ms | **99% 延迟降低** |

---

## 3. 优化理论边界与收益上限

1. **IO 开销下界**：Node.js `fs.stat` 在 Windows 上的单文件系统调用开销约为 $0.02\text{ms}$，1000 文件的文件发现与元数据获取时间理论下界为 $10\sim 20\text{ms}$。
2. **IPC 编解码开销**：Worker 线程间传输的 `Issue` 结构体已进行轻量扁平化处理，避免大体积深拷贝。
