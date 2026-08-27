# 📚 文档索引 | Docs Index

> auto-refactor 全部设计 / 规格 / 调研文档统一索引。路径均相对本仓库 `auto-refactor/`。
> 文档命名统一 kebab-case；mermaid 图为设计配套示意图。

---

## 设计文档 | Design Docs

| 文档 | 主题 | 状态 |
|------|------|------|
| [docs/p1-1-design.md](./docs/p1-1-design.md) | P1-1 懒投影（Lazy Projection）—— 投影模式等价门 + 性能收益 | ✅ 已实施（T01–T05 落地，默认已翻） |
| [docs/warm-scan-design.md](./docs/warm-scan-design.md) | warm-scan 基础设施 —— 持久 worker 池 + 两级增量缓存 + daemon | ✅ 已实施（validate-warm W1–W9 全绿，默认关） |
| [docs/system-design.md](./docs/system-design.md) | 行级增量（Line-level Incremental）—— 大文件小改动子树复用 | 📝 设计稿（只读调研 + 量化 + 设计） |
| [docs/multilang-architecture.md](./docs/multilang-architecture.md) | 多语言架构 —— TS/JS + Rust 每语言独立适配器 | ✅ 已实现 |
| [docs/oxc-feasibility.md](./docs/oxc-feasibility.md) | oxc-parser 替换可行性调研 —— 字节等价 | ✅ 结论 A 已按本文档实现 |

## 规格文档 | Specs

| 文档 | 主题 | 状态 |
|------|------|------|
| [docs/diff-interface-spec.md](./docs/diff-interface-spec.md) | Diff 系统接口接入规格 —— scanDiff / scanDiffDelta | 📝 设计稿（接口规格） |
| [docs/bench-baselines-spec.md](./docs/bench-baselines-spec.md) | 统一性能基准脚本规格（scripts/bench-baselines.js） | ✅ 规格定稿 |

## 性能分析与方案 | Performance

| 文档 | 主题 | 状态 |
|------|------|------|
| [docs/perf-boundary.md](./docs/perf-boundary.md) | 优化边界分析 —— 各维度收益上限 | ✅ 分析定稿（只分析不实现） |
| [docs/perf-optimization-plan.md](./docs/perf-optimization-plan.md) | 跨域性能优化方案 | 📝 方案设计（不实现） |
| [docs/feed-bottleneck-design.md](./docs/feed-bottleneck-design.md) | oxc 主线程 feed 瓶颈 —— 精确诊断 + ROI 裁决 | 📝 只读分析 + 设计 |
| [docs/p2-5-protocol-flatten-design.md](./docs/p2-5-protocol-flatten-design.md) | P2-5 协议压平 —— 数据先行 + ROI 裁决 | 📝 只读分析 + 设计 |

## 图 | Diagrams (mermaid)

| 图 | 内容 |
|------|------|
| [docs/class-diagram.mermaid](./docs/class-diagram.mermaid) | 核心类图（含增量投影器） |
| [docs/sequence-diagram.mermaid](./docs/sequence-diagram.mermaid) | 扫描时序图 |
| [docs/diff-class-diagram.mermaid](./docs/diff-class-diagram.mermaid) | Diff 系统类图 |
| [docs/diff-sequence-diagram.mermaid](./docs/diff-sequence-diagram.mermaid) | Diff 扫描时序图 |

---

> 🔗 代码内引用约定：`src/` 注释与 `config.schema.json` 中指向本文档的路径均为 `docs/<name>.md`。
> 🗑 已清理历史规划文档（NEXT_OPTIMIZATIONS / P3_DESIGN / REFACTOR_VALIDATION_REPORT / ARCHITECTURE_REPORT / PROJECT_REVIEW），如有溯源需求请查 git 历史。
