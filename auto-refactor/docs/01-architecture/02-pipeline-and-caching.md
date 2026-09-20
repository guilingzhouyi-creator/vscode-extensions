# 增量缓存与流水线机制 (Caching Pipeline & Fingerprints)

> **所属模块**：`01-architecture`  
> **核心源码**：`src/core/cache.ts`, `src/core/cacheKey.ts`, `src/core/scanner/cacheProbe.ts`, `src/core/scanner/diffHints.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 两级缓存架构与探针流水线

为了在频繁修改代码的本地开发与 CI 门禁中达到毫秒级响应，引擎设计了 **L1 内存缓存 + L2 磁盘持久缓存 + 非对称探针流水线** 的三阶加速架构：

```
                    [文件变更检测与探针流水线]
                                │
               ┌────────────────▼────────────────┐
               │    非对称探针 (Cache Probe)     │
               │   提取文件元数据 (mtime / size)  │
               └────────────────┬────────────────┘
                                │
                 L1 判定: mtime + size 是否完全一致？
                   ├──► 是 ──► [直接内存复用] (0 磁盘 IO, 0 解析, <0.01ms)
                   └──► 否 ──► [异步流式读取文件] ──► 计算 ContentHash
                                                          │
                                         L2 判定: ContentHash + 指纹是否命中？
                                           ├──► 是 ──► [复用磁盘反序列化结果] (0.2ms)
                                           └──► 否 ──► [送入 AST 解析与规则分析]
```

### 1.1 L1 内存缓存（Fast In-Memory Cache）
* **键构成**：`filePath + mtimeMs + sizeBytes`。
* **特性**：仅通过一次轻量 `fs.stat` 即可判定，耗时 $<0.05\text{ms}$。完全避免不必要的文件读取与哈希计算开销。

### 1.2 L2 磁盘持久缓存（Disk Persistent Cache）
* **存储位置**：项目根目录 `.auto-refactor-cache/` 下（自动在 `.gitignore` 中声明排除）。
* **键构成**：`SHA-256(文件内容) + 配置指纹 (ConfigFingerprint)`。
* **特性**：即使文件 `mtime` 被 touch 或通过 git checkout 刷新，只要文件实质内容未变，即可通过 L2 命中直接读取上一次的序列化诊断发现，大幅缩短冷启动重算时间。

---

## 2. 非对称缓存探针 (`cacheProbe.ts`) 与变更提示 (`diffHints.ts`)

在 Asymmetric DualTrack 模式与增量扫描中，引擎使用专门的探针调度器：

1. **`probeSingleFileCache`**：针对传入文件进行快速探针探测，并行区分出 `cacheHits`、`cacheMisses` 与 `incrementalCandidates`；
2. **`processChangedFileHint`**：当编辑器或版本控制系统提供了变更范围提示（Diff Hints）时，系统直接定位受影响的局部 AST 子树，跳过全局分析；
3. **`processUnchangedFile`**：对确定未修改的文件，直接沿用历史缓存的跨文件符号依赖，无需重新提取导出的符号与字面量。

---

## 3. 全局配置指纹计算 (Config Fingerprinting)

缓存有效性受全局扫描配置影响。当用户更改分析规则选项或阈值时，缓存必须精准失效，杜绝过时数据污染。

```typescript
// 配置指纹核心计算因子：
// 1. 启用的分析器集合及其配置参数 (analyzers options)
// 2. 全局阈值 thresholds (complexityWarn, minFileSize 等)
// 3. 声明式字面量容忍策略规则哈希 (LiteralPolicyHash)
// 4. 自定义插件源码哈希 (CustomAnalyzerContentHash)
// 5. 解析器类型与模式 (typescript / oxc)
```

通过将上述因子序列化计算 SHA-256 摘要，构成缓存目录的一级逻辑隔离域，实现规则修改后**自动隔离旧缓存、零手工清缓存**。
