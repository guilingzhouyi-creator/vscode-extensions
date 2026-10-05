# Rust 原生算子与纯 TS Shim 100% 字节等价性契约

## 一、 为什么必须 100% 字节等价？

`auto-refactor` 支持在具备 Rust N-API 原生支持的高性能机器上全速运行，同时也支持在轻量环境或原生动态链接库编译失败时，无缝透明地回退至纯 TypeScript 实现（`pure-TS shim`）。

若两端输出的哈希值、行号偏移量、支配树排序有丝毫偏差，会导致在不同环境下运行 `npm test` 或生成 `SARIF` 报告时产生不确定性差异（Non-deterministic drift）。

---

## 二、 核心算子等价性校验矩阵

| 算子领域 | Rust 原生 Crate | Pure-TS 回退文件 | 验收脚本 |
| :--- | :--- | :--- | :--- |
| **行扫描与脱敏** | `crates/ops-mask` | `src/core/native/native-mask-shim.ts` | `validate-native-parity.js` |
| **Myers 差分** | `crates/ops-diff` | `src/core/native/native-diff-shim.ts` | `validate-equivalence.js` |
| **支配树与控制流** | `crates/ops-graph` | `src/core/native/native-flow-shim.ts` | `validate-control-flow-graph.js` |
| **代码克隆检测** | `crates/ops-clone` | `src/core/native/native-clone-shim.ts` | `validate-native-bridge.js` |
