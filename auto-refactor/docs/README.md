# 📚 auto-refactor 架构与规范文档库 | Documentation

> **auto-refactor** 规范化技术文档集合。统一采用 **功能分类前缀 + 语义化命名** 进行组织。  
> 历史原始设计草稿与调研记录已统一封存至工作区归档目录：[`archive/auto-refactor/docs-legacy/`](file:///c:/CODE_game-development/vscode-extensions/archive/auto-refactor/docs-legacy/)。

---

## 🗺️ 文档导航地图 (Documentation Map)

### 🏛️ 01. 核心架构与调度 (Architecture & Engine)
* [01-system-overview.md](./01-architecture/01-system-overview.md)：系统整体架构、多执行模式、并发 Worker 调度与 RSS 内存自愈。
* [02-pipeline-and-caching.md](./01-architecture/02-pipeline-and-caching.md)：L1 内存缓存 + L2 磁盘持久缓存架构与配置指纹隔离机制。
* [03-daemon-and-ipc.md](./01-architecture/03-daemon-and-ipc.md)：跨平台 Daemon 守护进程、NDJSON 通信协议与进程自愈。

### 🌲 02. 语法解析与 AST 适配 (Parsers & AST)
* [01-multilang-abstraction.md](./02-parsers-and-ast/01-multilang-abstraction.md)：`NormalizedNode` 统一通用抽象与 Rust (Tree-Sitter) 语言适配。
* [02-oxc-fastpath.md](./02-parsers-and-ast/02-oxc-fastpath.md)：基于 Rust `oxc-parser` 的极速解析与字节等价性语义补偿。
* [03-lazy-projection.md](./02-parsers-and-ast/03-lazy-projection.md)：零物化懒投影技术与稀疏消费遍历。

### ⚡ 03. 增量计算与 Diff 接入 (Incremental & Diff)
* [01-line-level-incremental.md](./03-incremental-and-diff/01-line-level-incremental.md)：行级增量子树复用 (`reuseSubtree`) 与 LineMap 坐标平移。
* [02-diff-interface-spec.md](./03-incremental-and-diff/02-diff-interface-spec.md)：Diff 接入规格、UTF-8 字节转码与 `scanDiff` / `scanDiffDelta` 双 API。

### 🔍 04. 规则引擎与内置分析器 (Analyzers & Rules)
* [01-builtin-rules.md](./04-analyzers-and-rules/01-builtin-rules.md)：常量提取 (`constants`)、圈复杂度 (`complexity`)、大文件拆分 (`fileSize`) 内置规则。
* [02-custom-analyzer-plugin.md](./04-analyzers-and-rules/02-custom-analyzer-plugin.md)：第三方自定义分析器插件契约与生命周期钩子。

### 📊 05. 规范、配置与性能基准 (Specs & Benchmarks)
* [01-config-and-reports.md](./05-specs-and-benchmarks/01-config-and-reports.md)：`config.schema.json` 规则配置与 JSON / SARIF / Text 报告格式。
* [02-performance-benchmarks.md](./05-specs-and-benchmarks/02-performance-benchmarks.md)：基准性能矩阵、吞吐量 Benchmark 与理论性能边界。

### 📐 06. 架构图表 (Diagrams)
* [class-diagram.mermaid](./diagrams/class-diagram.mermaid)：核心系统类图
* [sequence-diagram.mermaid](./diagrams/sequence-diagram.mermaid)：扫描分析时序图
* [diff-class-diagram.mermaid](./diagrams/diff-class-diagram.mermaid)：Diff 系统类图
* [diff-sequence-diagram.mermaid](./diagrams/diff-sequence-diagram.mermaid)：Diff 增量扫描时序图
