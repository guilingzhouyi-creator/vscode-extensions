# 📚 auto-refactor 文档索引 | Docs Index

> auto-refactor 全部规范化设计与技术文档集合。
> 历史原始设计讨论与调研底稿已统一封存至工作区归档目录：`archive/auto-refactor/docs-legacy/`。

---

## 🆕 变更记录 | Changelog

### v0.1.1 (2026-08-28) — 缺陷修复（字节等价与性能基准零回归）

| 修复项 | 说明 | 影响 |
|--------|------|------|
| **CLI 无值 flag 吞参修复** | `parseArgs` 重构：布尔 flag（`--fail-on-issue` / `--cache` / `--daemon` / `--respect-gitignore` 等）默认置 `true`，仅显式 `=false` 或紧跟独立 token `true|false` 时才消费下一参数；带值 flag 才取下一 token | 修复 `--fail-on-issue --format json` 中 `--format` 被吞、输出格式静默丢失的问题 |
| **glob `**/` 段边界修复** | `globToRegExp`：`**/` 改为 `(?:.*/)?`（零或多个完整路径段），不再用 `.*` 吞掉分隔符边界 | 修复 `a/**/b.ts` 误匹配 `a/xxb.ts`，include/exclude 语义与标准 glob 一致 |
| **坏配置显式告警** | `resolveConfig`：配置文件存在但解析失败时 `console.warn` 告警并回退默认值，不再静默忽略 | 用户配置写错（如尾逗号）时 CI 可即时发现 |

验证：`npm test` 全套 validate（等价性/暖缓存/oxc 关键点/diff/praxis/codec）通过；`bench-fastpath.js --check` 字节等价通过；`benchmark.js` 300 文件 median ≈103ms，与历史基线持平。

---

## 🏛️ 1. 核心架构与调度 (Architecture)

| 文档 | 主题 | 状态 |
|------|------|:---:|
| [docs/01-architecture/01-system-overview.md](./docs/01-architecture/01-system-overview.md) | 系统整体架构、执行模式、并发 Worker 调度与 RSS 自愈 | ✅ 已落地 |
| [docs/01-architecture/02-pipeline-and-caching.md](./docs/01-architecture/02-pipeline-and-caching.md) | L1/L2 两级增量缓存与配置指纹隔离机制 | ✅ 已落地 |
| [docs/01-architecture/03-daemon-and-ipc.md](./docs/01-architecture/03-daemon-and-ipc.md) | 跨平台 Daemon 守护进程、NDJSON 通信与生命周期 | ✅ 已落地 |

## 🌲 2. 语法解析与 AST 适配 (Parsers & AST)

| 文档 | 主题 | 状态 |
|------|------|:---:|
| [docs/02-parsers-and-ast/01-multilang-abstraction.md](./docs/02-parsers-and-ast/01-multilang-abstraction.md) | NormalizedNode 统一抽象与 Rust (Tree-Sitter) 语言适配 | ✅ 已落地 |
| [docs/02-parsers-and-ast/02-oxc-fastpath.md](./docs/02-parsers-and-ast/02-oxc-fastpath.md) | Rust oxc-parser 快速解析与字节等价性补偿 | ✅ 已落地 |
| [docs/02-parsers-and-ast/03-lazy-projection.md](./docs/02-parsers-and-ast/03-lazy-projection.md) | 零物化懒投影技术与稀疏消费遍历 | ✅ 已落地 |

## ⚡ 3. 增量计算与 Diff 接入 (Incremental & Diff)

| 文档 | 主题 | 状态 |
|------|------|:---:|
| [docs/03-incremental-and-diff/01-line-level-incremental.md](./docs/03-incremental-and-diff/01-line-level-incremental.md) | 行级增量子树复用 (reuseSubtree) 与坐标平移 | ✅ 已落地 |
| [docs/03-incremental-and-diff/02-diff-interface-spec.md](./docs/03-incremental-and-diff/02-diff-interface-spec.md) | Diff 接入规格、UTF-8 字节转码与双通道 API | ✅ 已落地 |

## 🔍 4. 规则引擎与内置分析器 (Analyzers & Rules)

| 文档 | 主题 | 状态 |
|------|------|:---:|
| [docs/04-analyzers-and-rules/01-builtin-rules.md](./docs/04-analyzers-and-rules/01-builtin-rules.md) | 常量提取、圈复杂度、大文件等内置分析规则 | ✅ 已落地 |
| [docs/04-analyzers-and-rules/02-custom-analyzer-plugin.md](./docs/04-analyzers-and-rules/02-custom-analyzer-plugin.md) | 第三方自定义分析器插件契约与生命周期钩子 | ✅ 已落地 |

## 📊 5. 规范与性能基准 (Specs & Benchmarks)

| 文档 | 主题 | 状态 |
|------|------|:---:|
| [docs/05-specs-and-benchmarks/01-config-and-reports.md](./docs/05-specs-and-benchmarks/01-config-and-reports.md) | config.schema 规则配置与 JSON / SARIF / Text 报告格式 | ✅ 已落地 |
| [docs/05-specs-and-benchmarks/02-performance-benchmarks.md](./docs/05-specs-and-benchmarks/02-performance-benchmarks.md) | 基准性能矩阵、吞吐量 Benchmark 与理论性能边界 | ✅ 已落地 |

## 📐 6. 架构图表 (Mermaid)

| 架构图 | 内容 |
|------|------|
| [docs/diagrams/class-diagram.mermaid](./docs/diagrams/class-diagram.mermaid) | 核心系统类图 |
| [docs/diagrams/sequence-diagram.mermaid](./docs/diagrams/sequence-diagram.mermaid) | 扫描分析时序图 |
| [docs/diagrams/diff-class-diagram.mermaid](./docs/diagrams/diff-class-diagram.mermaid) | Diff 系统类图 |
| [docs/diagrams/diff-sequence-diagram.mermaid](./docs/diagrams/diff-sequence-diagram.mermaid) | Diff 增量扫描时序图 |
