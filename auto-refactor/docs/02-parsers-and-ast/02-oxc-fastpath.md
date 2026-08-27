# OXC 快速解析引擎与等价性保证 (OXC Fastpath Parser)

> **所属模块**：`02-parsers-and-ast`  
> **核心源码**：`src/core/oxcAdapter.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 为什么引入 OXC Parser？

TypeScript 官方解析器（`ts.createSourceFile`）由纯 JavaScript 实现，在解析大型 TS/JS 代码库时往往成为 CPU 密集型瓶颈。

`oxc-parser` 是基于 Rust 编写的高性能 JavaScript/TypeScript 解析器，其纯解析吞吐速度比官方 TS 解析器快 **3 ~ 5 倍**，且内存占用极低。

---

## 2. 字节等价性硬门（Byte-Equivalence Guarantee）

引入新解析器的第一原则是**输出无感且完全等价**。`oxcAdapter` 通过精确的 AST 语义补偿规则，保证生成的 `Issue[]` 结果与原生 TS 引擎达到 **逐字节完全一致（Byte-for-Byte Identical）**：

### 2.1 核心语义补偿点
1. **类型字面量下降处理**：`TSAsExpression`（`as const` / `as any` / `satisfies`）与装饰器参数不直接跳过，而是递归下降映射，确保内嵌魔法数字被精准捕获。
2. **静态代码块 (`StaticBlock`)**：计算类静态块内函数与圈复杂度，对齐 TS 的嵌套深度计算逻辑。
3. **导出语法一致性**：`export *` 与 `export { x } from 'mod'` 的模块说明符与 TS 保持相同的字符串提取规则。

---

## 3. 惰性按需装载与降级策略

* **零冷启动损耗**：默认模式下不 require `oxc-parser` 二进制绑定，只有当用户显式指定 `--parser oxc` 或在配置中开启时才动态加载。
* **原生绑定自愈**：在缺少 C++ 原生运行库的受限环境中，若加载 Rust 动态链接库失败，引擎自动平滑降级至内置 TypeScript 原生解析器，保障高可用性。
