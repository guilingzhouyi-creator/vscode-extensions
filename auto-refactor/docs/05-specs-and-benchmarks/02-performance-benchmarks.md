# 02. 全维性能基准与原生算子加速台账

> **所属层级**：L5 规范、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)  
> **对应代码真源**：`scripts/benchmark.js`、`scripts/validate-native-benchmark.js`、`scripts/bench-fastpath.js`、`scripts/bench-hot-paths.js`

---

## 1. 六大核心性能基准台账

`auto-refactor` 每一层算子均配备独立的自动化基准评测套件，确保在引入跨语言语义 IR 与 243 条规则的同时，维持亚秒级全仓响应：

| 评测维度 | 基准脚本命令 | 核心测试工况 | 实测性能指标 | 对照加速比 |
| :--- | :--- | :--- | :--- | :---: |
| **1. SWAR 64-bit 向量行扫描** | `npm run hotpath-bench` | 纯 ASCII 源码换行定位与 FNV-1a 行哈希 | **6,448.4 MB/s** | 较逐字符扫描提速 **5.8x** |
| **2. Bit-Parallel Myers 差分** | `npm run bench-diff` | 64 位位并行向量差分计算 | **17.8 µs / 对** | 较标准 Myers 提速 **2.42x** |
| **3. 行级增量子树复用** | `npm run bench-diff` | 5,000 行大文件 10 处分散编辑重审 | **3.55 ms**（全量 63.28 ms） | **17.8x** |
| **4. `oxc-parser` Mode A 快轨** | `npm run fastpath-bench` | 300 文件标准语料库全量扫描 | 中位耗时 **~103 ms** | 较纯 `typescript` AST 提速 **3.4x** |
| **5. Sparse MoE 稀疏切片审计** | `npm run bench-asymmetric` | 单函数局部修改触发 `auditSlice` | **< 8.5 ms**（分析器绕过率 $\ge 70\%$） | **11.2x** |
| **6. Rust N-API 六算子核** | `npm run benchmark:native` | 支配树 (`ops-graph`)、克隆检测 (`ops-clone`)、词法掩码 (`ops-mask`) | 零 GC 抖动，500 轮连续高压压测 **0 内存泄漏** | 较 JS Shim 提速 **3.1x ~ 8.6x** |

---

## 2. 防劣化回归护栏 (Anti-Regression Ratchets)

为了防止功能迭代悄然劣化核心热路径，仓库配置了三道性能与等价性看守：

1. **热路径消融与基线比对 (`scripts/bench-hot-paths.js`)**：
   - 支持 `npm run hotpath-ablate` 执行算子消融实验，单独量化 SWAR、`ops-mask`、Sparse MoE 每一项优化的净收益；
   - 当核心算子吞吐下降超过容差带时自动告警。
2. **字节级等价性硬门禁 (`npm run fastpath-check` & `npm run validate-native-parity`)**：
   - 任何性能优化（无论是 `oxc` Mode A 零物化还是 Rust Native 算子）都不得以牺牲准确性为代价；
   - 门禁强制断言优化路径与参考路径产出的 `Issue` 列表、行号、严重度 **100% 逐字节一致**。
3. **内存边界与压缩界限看守 (`npm run validate-compression` & `npm run validate-latency-metrics`)**：
   - 验证 `CircularDiffBuffer` R4 二进制序列化体积上界与 `PraxisSliceAuditService` 的 P99 延迟边界。

---

## 3. 关联文档导航

- [05. Rust N-API 原生加速内核与双轨等价桥](../01-architecture/05-rust-native-operator-kernel.md)
- [02. Rust `oxc-parser` 极速通道与双模补偿](../02-parsers-and-ast/02-oxc-fastpath.md)
