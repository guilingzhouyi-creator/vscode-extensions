# Diff 系统接口接入规格 (Diff Interface Integration Spec)

> **所属模块**：`03-incremental-and-diff`  
> **核心源码**：`src/core/diff.ts`, `src/core/utf8.ts`, `src/core/editDiff.ts`, `src/api.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 概览与双 API 契约

为了完美接入外部 Git Diff 工具链与 VS Code 保存事件，系统提供两个标准 Diff 接口：

```typescript
// 1. 全量扫描接口（逐字节等于冷扫描）
export async function scanDiff(
  diffs: DiffInput[],
  options: ScanDiffOptions = {},
): Promise<{ report: ScanReport; stats: DiffStats }>;

// 2. 变更子集接口（仅返回变更文件集结果）
export async function scanDiffDelta(
  diffs: DiffInput[],
  options: ScanDiffOptions = {},
): Promise<{ report: DiffDeltaReport; stats: DiffStats }>;
```

> **后处理管线契约（2026-09-15）**：所有入口共享**同一套终态语义**，差异只在能否使用跨文件事实，并由 `summary.postScanPasses` 显式声明：
>
> | 入口 | suppressions | baseline 棘轮 | 依赖图（环 / 未使用导出） | `postScanPasses` |
> | :--- | :---: | :---: | :---: | :--- |
> | `scan()` / `scanWarm()` / CLI 全量 | ✅ | ✅ | ✅（`detectCycles`/`detectUnusedExports` 开启时） | `['dependency-graph','suppressions','baseline']`（按实际执行项） |
> | `scanDiff()` / `scanDiffDelta()` | ✅ | ✅ | ⛔ 跳过 | `['suppressions','baseline']` |
> | CLI `scan --diff`（`git status` 变更集） | ✅ | ✅ | ⛔ 跳过 | `['suppressions','baseline']` |
>
> 增量口径**必须**跳过跨文件通道：图只覆盖部分文件时会凭空造环、也会漏掉真实环；跳过事实会写入 `summary.warnings`（`incremental scope: cross-file passes … skipped`）。`scanDiff`（全文件集）与 `scanDiffDelta`（变更子集）因此保持 `delta ≡ filter(diff)` 的契约——两者都不含跨文件发现。
>
> `scan()`/`scanWarm()` 与 CLI 全量逐字段一致，由 `validate-postscan-parity` 锁定；增量三入口的语义由 `validate-diff-interface` 锁定。

---

## 2. 联合输入模型 (`DiffInput`)

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
      newContent: string | Buffer;
      editRanges: EditRange[]; // UTF-8 字节偏移，入口自动转码
      oldContent?: string;
    };
```

---

## 3. UTF-8 字节偏移向 UTF-16 坐标转换

外部 Diff 系统通常以 UTF-8 字节为基准，而 JavaScript V8 引擎以 UTF-16 code-unit 编址。
系统在入口通过 `utf8ToUtf16Offset` 构建二分码点映射表：
* 自动处理 ASCII（1 字节 ↔ 1 code-unit）、多字节字符（2~3 字节 ↔ 1 code-unit）与 Emoji/代理对（4 字节 ↔ 2 code-units）；
* 续字节偏移自动向左吸附至合法码点边界，杜绝字符串切片乱码。

---

## 4. 三级路由状态机 (`routeDiff`)

每个变更文件依次经过快速裁决：
1. `byteEqual`：内容无改动，直接复用旧结果（0 解析开销）；
2. `incremental`：大文件且改动行数低于阈值，执行行级增量子树复用；
3. `full`：小文件、全局语法结构变化或异常抛错，安全降级至全量重扫。
