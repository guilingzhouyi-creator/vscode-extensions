# Rust 原生算子与纯 TS Shim 100% 字节等价性契约

## 一、 为什么必须 100% 字节等价？

`auto-refactor` 支持在具备 Rust N-API 原生支持的高性能机器上全速运行，同时也支持在轻量环境或原生动态链接库编译不可用时，无缝透明地回退至纯 TypeScript 实现（`pure-TS shim`）。

若两端输出的哈希值、行号偏移量、支配树排序有丝毫偏差，会导致在不同环境下运行 `npm test` 或生成 `SARIF` 报告时产生不确定性差异（Non-deterministic drift）。因此两端必须保持 **100% 语义与字节等价**。

---

## 二、 核心算子等价性校验矩阵

| 算子领域 | 核心算法与数据结构 | Rust 原生 Crate | Pure-TS 回退文件 | 验收脚本 |
| :--- | :--- | :--- | :--- | :--- |
| **行扫描与脱敏** | 64-bit SWAR 向量化脱敏状态机 | `crates/ops-mask` | `src/core/native/native-mask-shim.ts` | `validate-native-parity.js` |
| **Myers 差分** | Bit-Parallel Myers 差分算法 | `crates/ops-diff` | `src/core/native/native-diff-shim.ts` | `validate-equivalence.js` |
| **支配树与控制流** | Tarjan SCC 与 Lengauer-Tarjan 支配树 | `crates/ops-graph` | `src/core/native/native-flow-shim.ts` | `validate-control-flow-graph.js` |
| **代码克隆检测** | MinHash + b-Bit LSH 局部敏感哈希 | `crates/ops-clone` | `src/core/native/native-clone-shim.ts` | `validate-native-bridge.js` |

---

## 三、 等价性硬性判定标准

1. **确定性键排序**：所有生成的 JSON 载荷与元数据结构必须对键进行确定性拓扑排序；
2. **字符与行号偏移**：UTF-8 字符边界与换行符（LF）行偏移计算在两端必须严格一致，禁止单字节与多字节字符切分偏移；
3. **浮点与边界断言**：统计得分与相似度分值统一保留 4 位精度，杜绝因浮点数底层精度差异引起的假漂移。
