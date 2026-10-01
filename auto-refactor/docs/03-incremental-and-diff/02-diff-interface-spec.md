# 02. 高性能差分算法栈与流式 Diff 规格

> **所属层级**：L3 增量计算与向量化 Diff (`docs/03-incremental-and-diff/`)  
> **对应代码真源**：`src/core/diff/edit-diff.ts`、`src/core/ast/swar.ts`、`src/core/stream.ts`、`crates/ops-diff/`

---

## 1. 四级向量化差分算法栈

为了同时满足微秒级局部编辑定界与万行级大文件精确重构比对，`src/core/diff/edit-diff.ts` 与 `crates/ops-diff/` 实现了四级自适应差分算子栈：

| 算法层级 | 导出函数 (`src/api.ts`) | 时间复杂度 | 适用场景与核心加速原理 |
| :--- | :--- | :---: | :--- |
| **L0. SWAR 64-bit 行边界与哈希** | `computeLineStarts`<br/>`computeLineStartsAndHashes`<br/>`fnv1a32` / `hashLines` | $O(N / 8)$ | 利用 64 位寄存器字内并行（SIMD Within A Register）一次扫描 8 字节定位 `\n`，同步计算每行 32 位 FNV-1a 哈希，将字符串比较降维为 `Uint32Array` 整数比较 |
| **L1. 前后缀剥离极速差分 (`fastDiff`)** | `fastDiff`<br/>`computeEditRanges` | $O(N)$ | 先通过 64 位步进剥离首尾完全相同的公共前缀（Common Prefix）与公共后缀（Common Suffix），对单点连续插入/删除直接以 $O(1)$ 确定变更区间 |
| **L2. 64 位字并行 Myers (`myersDiff`)** | `myersDiff`<br/>`computeEditRangesWithOps` | $O\left(\lceil M/64 \rceil \cdot N\right)$ | 基于 Hyyrö / Myers Bit-Parallel 位向量并行算法与对角线贪婪搜索，在 `Uint32Array` 行哈希上求解最短编辑脚本（SES），较传统动态规划提速 **2.4x+** |
| **L3. 低频锚点直方图差分 (`histogramDiff`)** | `histogramDiff`<br/>`computeDetailedHunks` | $O(N \log N)$ | 优先选取出现频次最低的唯一代码行（如函数签名、唯一声明）作为对齐锚点递归切分，彻底消除大段大括号 `{}` / 空行移动导致的错位面条式 Diff |

---

## 2. 统一 Diff 输入契约 (`DiffInput`)

`scanDiff`、`scanDiffDelta` 与 `scanDiffStream` 接受三种形态的增量输入载荷（定义于 `src/core/types.ts`）：

1. **`kind: 'full'`（双文本内存对比）**：直接传入 `{ kind: 'full', filePath, oldContent, newContent }`（支持 `string` 或 `Uint8Array` Buffer 零拷贝传入），由引擎内部调用 `computeDetailedHunks` 实时计算差分。
2. **`kind: 'ranges'`（已知编辑行区间）**：传入 `{ kind: 'ranges', filePath, newContent, editRanges }`，直接跳过差分计算进入子树复用与切片审查。
3. **`kind: 'unified'`（标准 Unified Diff 补丁文本）**：传入 Git 标准 `@@ -a,b +c,d @@` 补丁文本，自动解析还原变更区间。

---

## 3. 响应式异步流式管道 (`scanDiffStream`)

位于 `src/core/stream.ts` 的 `scanDiffStream(inputs, options)` 采用 `AsyncGenerator` 流式架构，使消费方无需等待全部文件扫描结束即可实时消费每一个审查完成的 Hunk：

```ts
export type DiffStreamEvent =
    | { type: 'file_start'; filePath: string; timestamp: number }
    | { type: 'hunk_ready'; filePath: string; hunk: ReviewDiffHunk; verdict: PraxisVerdict }
    | { type: 'file_done'; filePath: string; hunkCount: number; durationMs: number }
    | { type: 'stream_end'; totalFiles: number; totalHunks: number; totalMs: number };
```

- **背压感知（Backpressure-Aware）**：基于 `for await (const ev of scanDiffStream(...))` 协议，当下游 UI 渲染或网络传输繁忙暂停拉取时，上游差分计算自动挂起让出事件循环，保证高并发下内存水位平稳。

---

## 4. 关联文档导航

- [01. 行级增量子树复用与 AST 切片提取](./01-line-level-incremental.md)
- [03. Praxis 增量 Diff 管道与环形缓冲接入指南](./03-praxis-integration-guide.md)
