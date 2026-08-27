# 增量缓存与流水线机制 (Caching Pipeline & Fingerprints)

> **所属模块**：`01-architecture`  
> **核心源码**：`src/core/cache.ts`, `src/core/cacheKey.ts`, `src/core/analyzer.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 两级缓存架构 (Two-Level Cache)

为了在频繁修改代码的开发与 CI 流程中达到毫秒级响应，引擎设计了 **L1 内存缓存 + L2 磁盘持久缓存** 混合架构：

```
                    [文件变更检测流水线]
                            │
              ┌─────────────▼─────────────┐
              │  获取文件元数据 (mtime/size)│
              └─────────────┬─────────────┘
                            │
               L1 命中? (mtime + size 匹配)
                 ├──► 是 ──► [直接复用结果] (0 读磁盘, 0 解析, 0.01ms)
                 └──► 否 ──► [读取文件内容] ──► 计算 SHA-256 ContentHash
                                                       │
                                          L2 命中? (ContentHash 匹配)
                                            ├──► 是 ──► [复用 L2 结果] (0 解析, 0.2ms)
                                            └──► 否 ──► [进入 AST 解析与分析]
```

### 1.1 L1 内存缓存（Fast In-Memory Cache）
* **键构成**：`filePath + mtimeMs + sizeBytes`。
* **特性**：仅需一次 `fs.stat` 调用即可完成判定，耗时低于 0.05ms。完全避免读盘与哈希计算开销。

### 1.2 L2 磁盘持久缓存（Disk Persistent Cache）
* **存储位置**：项目根目录 `.auto-refactor-cache/` 下（自动在 `.gitignore` 中排除）。
* **键构成**：`SHA-256(文件内容) + 配置指纹 (ConfigFingerprint)`。
* **特性**：即使文件 `mtime` 被 touch 修改（例如 git checkout、分支切换），只要内容实质未变，即可通过 L2 命中直接读取上一次的分析结果。

---

## 2. 配置指纹计算 (Config Fingerprinting)

缓存有效性受全局扫描配置影响。当用户更改分析规则选项或阈值时，缓存必须精准失效，杜绝过时数据污染。

```typescript
// 配置指纹计算因子：
// 1. 启用的分析器列表与其精确 options
// 2. 全局阈值 thresholds (complexityWarn, minFileSize 等)
// 3. 自定义插件源码哈希 (CustomAnalyzerContentHash)
// 4. 解析器类型 (typescript / oxc)
```

通过将上述因子序列化计算 SHA-256 摘要，构成缓存目录的一级隔离隔离域，实现规则修改后**自动隔离旧缓存、零手工清缓存**。
