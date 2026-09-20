# OXC 极速解析路径与等价性保障 (OXC Fast-Path & Byte Equivalence)

> **所属模块**：`02-parsers-and-ast`  
> **核心源码**：`src/core/oxcAdapter.ts`, `scripts/bench-fastpath.js`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. OXC 快速路径的技术动机

官方 TypeScript 编译器（`typescript.createSourceFile`）是一个完备的重型编译器前端，其解析与构建完整 AST 过程在纯 JavaScript 运行时中开销显著（大文件平均解析耗时 5ms ~ 15ms）。

为了突破 V8 运行时的算力瓶颈，`auto-refactor` 引入了基于 Rust 构建的高性能解析器 **`oxc-parser`**：
* **原生 C 绑定 / SIMD 加速**：单文件解析耗时压缩至 **1.5ms ~ 2.2ms**，吞吐量提升 **3x ~ 5x**；
* **低内存足迹**：Rust 侧完成 AST 生成与词法扫描，极大减轻 V8 堆内存 GC 压力。

---

## 2. Mode A 与 Mode B 双模调度机制

由于 `oxc-parser` 输出的 ESTree AST 结构与 TS Compiler 原生 AST 存在细微语法语义差异，引擎引入了**双模自适应分发机制**：

```
                           [输入 TypeScript 源码]
                                     │
                     需深度类型语义或复杂类成员推导？
                       ├──► 否 ──► [Mode A: oxc 流式快速路径] (< 2ms)
                       │          • 极速词法与语法投影
                       │          • 直连流式分析器 (Streaming Analyzers)
                       │
                       └──► 是 ──► [Mode B: TS 完整物化路径] (兜底保障)
                                  • 完整 TypeScript 语义树物化
                                  • 复杂跨节点符号解析
```

* **Mode A（极速流式模式）**：适用于常量提取、圈复杂度、大文件尺寸等 90% 以上的标准代码质量规则；
* **Mode B（完整物化模式）**：当需要下钻复杂闭包、特定高级装饰器或复杂多层命名空间时自动平滑降级，确保分析结果不失真。

---

## 3. 严格的 100% 字节等价性保障

为了杜绝因底层解析器切换导致规则产出漂移，工程设立了专门的等价性防线：

* **自动化校验守卫 (`bench-fastpath.js --check`)**：
  在 CI/CD 中针对所有代表性样本文件，同时使用 TS Compiler 与 `oxc-parser` 执行全量分析；
* **逐字节比对断言**：断言两个引擎产出的 Issue 集合、位置区间（Line/Column/Offset）、严重度及重构建议**完全逐字节等价**（`byteIdentical: true`）。
