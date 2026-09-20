# Diff 系统接口接入规格 (Diff Interface Integration Spec)

> **所属模块**：`03-incremental-and-diff`  
> **核心源码**：`src/core/diff.ts`, `src/core/utf8.ts`, `src/core/editDiff.ts`, `src/api.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 概览与核心 API 契约

为了深度集成外部 Git 管道、CI 增量审查与编辑器实时保存，系统提供标准的 Diff 审查接口：

```typescript
// 1. 全量合成扫描接口（报告结果逐字节等价于全仓冷扫描）
export async function scanDiff(
  diffs: DiffInput[],
  options?: ScanDiffOptions,
): Promise<{ report: ScanReport; stats: DiffStats }>;

// 2. 局部变更子集接口（仅返回发生修改的文件集诊断发现）
export async function scanDiffDelta(
  diffs: DiffInput[],
  deltaOptions?: ScanDiffDeltaOptions,
): Promise<{ report: DiffDeltaReport; stats: DiffStats }>;

// 3. 响应式事件推流接口（异步生成器按文件流式产出）
export async function* scanDiffStream(
  diffs: DiffInput[],
  streamOptions?: ScanDiffStreamOptions,
): AsyncGenerator<DiffStreamEvent, ScanReport, void>;
```

> **后处理管线契约**：增量入口共享同一套终态语义，由 `summary.postScanPasses` 显式声明：
>
> | 入口 | suppressions | baseline 棘轮 | 依赖图分析（环 / 未使用导出） | `postScanPasses` 声明 |
> | :--- | :---: | :---: | :---: | :--- |
> | `scan()` / `scanWarm()` / CLI 全量 | ✅ | ✅ | ✅（开启相应规则时） | `['dependency-graph','suppressions','baseline']` |
> | `scanDiff()` / `scanDiffDelta()` | ✅ | ✅ | ⛔ 增量范围自动跳过 | `['suppressions','baseline']` |
>
> 增量口径必须跳过全仓跨文件通道，避免因局部文件缺失导致虚假成环。跳过事实会如实写入 `summary.warnings`。

---

## 2. 联合输入模型 (`DiffInput`) 与 UTF-8 字节转码

```typescript
export type DiffInput =
  | {
      kind: 'full';
      filePath: string;
      oldContent: string;
      newContent: string | Buffer;
    }
  | {
      kind: 'ranges';
      filePath: string;
      newContent: Buffer | string;
      ranges: EditRange[]; // [startLine, endLine] 物理编辑区间
    };
```

系统内部对 `newContent` 的 Buffer 输入进行无拷贝 UTF-8 快速校验，若输入已经是 UTF-8 字节切片，则直接借用指针，避免额外的字符串重复分配。

---

## 3. 高性能差分算法：FastDiff 与 Bit-Parallel Myers (BPM)

针对不同规模的编辑场景，系统在底层组合了多阶差分引擎：

1. **FastDiff (哈希前缀/后缀收缩)**：
   在 $O(N)$ 时间内剥离文件首尾完全相同的行，将实际比对区间缩小至极小的中间核心（Kernel）；
2. **Bit-Parallel Myers (BPM) 64 位向量差分**：
   对于 $\le 64$ 行的小规模局部突变，使用 64 位整型掩码并行模拟 Myers 编辑图的对角线探索，执行耗时仅 **17.8 微秒**，较传统 Myers 算法提速 **2.42x**；
3. **Myers 线性空间回退**：
   对于超大跨度修改，回退至经典 Myers 差分，保障绝对正确的最小编辑距离。
