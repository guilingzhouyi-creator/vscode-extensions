# 零物化懒投影技术 (Lazy Projection Fastpath)

> **所属模块**：`02-parsers-and-ast`  
> **核心源码**：`src/core/traverse.ts`, `src/core/typescriptAdapter.ts` (`TsNodeProjector`), `src/core/oxcAdapter.ts` (`OxcNodeProjector`)  
> **文档状态**：✅ **已落地实施，默认开启 (Default Enabled)**

---

## 1. 传统全量物化的性能开销

传统的 AST 静态分析流程：
1. `parse()` 将源码解析为底层原生 AST；
2. `mapNode()` 将整棵 AST **全量递归映射**为数万个 `NormalizedNode` JS 对象；
3. `traverse()` 遍历这些 `NormalizedNode` 对象执行规则检查。

在 1,000+ 文件的大型工程中，全量物化会创建数百万个微型包装对象，引发频繁的 V8 Major GC 与内存抖动。

---

## 2. 懒投影（Lazy Projection）核心架构

懒投影技术跳过整树前置物化，在 AST 深度优先遍历过程中按需投影当前节点：

```
           [底层 Native AST (ts.Node / Oxc AST)]
                            │
               遍历指针移动 (DFS Visitor)
                            │
            ┌───────────────▼───────────────┐
            │  命中分析器关心的语法节点特征?  │
            └───────────────┬───────────────┘
                            │
               ├──► 否 ──► [直接步进下一节点] (0 对象分配)
               └──► 是 ──► [按需即时物化 NormalizedNode]
                                    │
                         执行规则钩子 (Visitor Hooks)
```

### 2.1 稀疏消费矩阵 (Consumption Matrix)
通过对内置分析器的只读特征审计：
* 只有特定类型的语句（函数声明、控制流分支、字面量常量）才需要物化；
* 绝大多数注释、类型签名、普通表达式在遍历中直接被原生游标跳过。

---

## 3. 实测性能收益与安全阀

* **性能提升**：在轻量与重型语料库中，单文件解析与扫描开销降低 **20% ~ 40%**，端到端 Wall-clock 时间缩短 **10% ~ 12%**。
* **安全回退开关**：默认开启（`AR_FASTPATH !== '0'`）。若遇到未覆盖的边缘语法或投影抛错，引擎自动捕获并降级到全量物化路径，保障正确性绝无退化。
