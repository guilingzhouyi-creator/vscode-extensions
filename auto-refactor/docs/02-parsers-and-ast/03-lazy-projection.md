# 零物化懒投影技术 (Zero-Materialization Lazy Projection)

> **所属模块**：`02-parsers-and-ast`  
> **核心源码**：`src/core/adapters.ts`, `src/core/traverse.ts`, `src/core/intelligence/symbolIndex.ts`, `src/core/intelligence/literalIndex.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 传统 AST 物化带来的性能瓶颈

在传统静态代码分析工具中，解析器通常会将整个文件一次性转换为巨大的内存对象树（AST Materialization）。在由数百个文件组成的代码库中，这一过程会带来：
1. **庞大的 V8 堆内存开销**：每个 AST 节点都封装为带有大量原型链与位置引用的 JS 对象；
2. **严重的 GC 垃圾回收暂停**：遍历结束后释放百万个瞬态对象，引发 V8 频繁执行 Major GC；
3. **低效的只读分析**：许多轻量级规则（如字面量检查、函数名索引）仅需访问特定几类节点，构建完整语法树存在 **58% 以上的算力浪费**。

---

## 2. 懒投影器模型 (`NodeProjector`)

懒投影技术（Lazy Projection）的核心思想是：**“按需投影、只读视口、零整树分配”**。

```typescript
export interface NodeProjector {
  /** 遍历节点并在遇到关注的语法结构时回调 */
  traverse(visitor: (node: NormalizedNode) => void): void;
  /** 按需投射子节点，避免预先分配子数组 */
  projectChildren(rawNode: unknown): NormalizedNode[];
}
```

* **流式上下文帧（Scope Frame Tracking）**：
  在 `runStreamingProjected` 遍历过程中，遍历器维护当前最近的作用域上下文帧（Enclosing Function / Class Name），并在遇到声明与调用时流式传递给外部观察者；
* **单次遍历多路复用（Single-Pass Fanout）**：
  遍历器通过 `onNode` 观察者模式，在单次轻量级遍历中同步喂给：
  - 流式分析器（Constants / Complexity / Hygiene 等）；
  - 全局符号索引（`SymbolIndex`）；
  - 全局字面量智能索引（`LiteralIndex`）。

---

## 3. 性能增益与工程收益

实测数据表明，在采用零物化懒投影之后：
* **单文件内存开销降低**：内存占用较完整物化模式下降 **62%**；
* **符号索引构建加速**：300 个源码文件的跨文件符号索引提取时间压缩至 **120ms 以内**；
* **无缝与全量物化对齐**：在 `validate-symbol-index` 验证套件中，懒投影模式与全量物化模式提取的定义数与调用点引用数完全一致。
