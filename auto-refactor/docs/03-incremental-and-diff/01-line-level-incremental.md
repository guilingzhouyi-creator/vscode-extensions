# 行级增量子树复用机制 (Line-Level Incremental Analysis)

> **所属模块**：`03-incremental-and-diff`  
> **核心源码**：`src/core/incremental.ts`, `src/core/incrementalState.ts`, `src/core/lineMap.ts`, `src/core/editDiff.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 为什么需要行级增量？

对于 5,000 行以上的大型代码文件，即使开发者只微调了其中 1 行代码：
* 全量重新解析与全量规则评估依然需要花费数十毫秒甚至更久；
* 绝大部分未修改的顶层函数与类方法的 AST 结构及其分析发现与上一版本**完全等价**。

行级增量技术旨在识别文件内部的具体编辑区间，**仅对被修改命中的函数子树执行重新分析，无缝复用未变子树的分析结果**。

---

## 2. 核心架构与复用决策 (`reuseSubtree`)

```
   旧文件版本 (oldContent)                    新文件版本 (newContent)
  ┌─ Block A: function A() ─┐              ┌─ Block A: function A() ─┐
  │ 保持未变                │ ───────────► │ 复用旧子树 AST & 诊断   │
  ╞═ Block B: function B() ═╡              ╞═ Block B: function B() ═╡
  │ 产生修改 (Old Version)  │ ─ (编辑突变) ─► │ 重新物化与执行深度分析 │
  ╠═ Block C: function C() ═╣              ╠═ Block C: function C() ═╣
  │ 保持未变 (行号向下平移) │ ───────────► │ LineMap 坐标平移后复用  │
  └─────────────────────────┘              └─────────────────────────┘
```

### 2.1 复用判定三要素
一个 AST 函数子树是否能够安全复用，必须同时满足：
1. **起始特征对齐**：函数的 `startLine` 与 `startColumn` 坐标通过 `LineMap` 校验映射；
2. **源码字节等价**：提取的源码切片 `sourceText` 与旧版本子树严格逐字节相同；
3. **独立性边界完整**：该子树不依赖外部被修改作用域的符号定义或破坏性签名变更。

---

## 3. 64 位 SWAR ASCII 向量化扫描与 LineMap 坐标平移

在处理大文件差分时，文本逐字符遍历往往成为瓶颈。引擎引入了硬件对齐的 **64-bit SWAR (SIMD Within A Register)** 算法：

* **8 字节单周期扫描**：通过 64 位整型位运算，每次时钟周期并行扫描 8 个字节的 ASCII 文本；
* **极速吞吐**：在 600KB+ 源码缓冲区上达到 **6,448.4 MB/s** 的纯 ASCII 判定吞吐；
* **LineMap 坐标精准平移**：
  当文件上方发生插入或删除时，`LineMap` 自动累加并记录物理位移 `lineDelta`，无损平移复用子树上的所有 Issue 位置，确保报告中的物理行列号始终指向当前最新版本。
