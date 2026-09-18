# 📚 auto-refactor 文档索引 | Docs Index

> auto-refactor 全部规范化设计与技术文档集合。
> 历史原始设计讨论与调研底稿已统一封存至工作区归档目录：`archive/auto-refactor/docs-legacy/`。

---

## 🆕 变更记录 | Changelog

### v0.3.0 (2026-09-05) — 联动 workspace-timing v0.4.9 工程审查系统

| 变更项 | 说明 | 影响 |
|--------|------|------|
| **新增三类内置分析器** | `secrets`（密钥泄露扫描）/ `unused-export`（未使用导出）/ `cycles`（循环依赖）随 v0.4.9 联动纳入 workspace-timing 六层门禁（L0~L5） | 与 `docs/04-analyzers-and-rules/01-builtin-rules.md` 规则清单对齐 |
| **Praxis 门禁与回滚规范文档化** | `docs/01-architecture/04-praxis-git-fractal-and-gating-spec.md`（v1.0.0-PROD-SPEC）与 `docs/03-incremental-and-diff/03-praxis-integration-guide.md` 落地 | 分形 Git 工作树 / 两级门禁 / 三层回滚 / 五大 SPI 契约有据可查 |

> 注：v0.2.x 未发布独立 tag/tgz（0.1.1 后直接进入 0.3.0），中间改动并入本版。
> 本文件历史原始设计讨论与调研底稿已统一封存至工作区归档目录：`archive/auto-refactor/docs-legacy/`。

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
| [docs/01-architecture/04-praxis-git-fractal-and-gating-spec.md](./docs/01-architecture/04-praxis-git-fractal-and-gating-spec.md) | Praxis 分形 Git 工作树、两级门禁、三层联动回滚与智能体生命周期（v1.0.0-PROD-SPEC） | ✅ 已落地 |

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
| [docs/03-incremental-and-diff/03-praxis-integration-guide.md](./docs/03-incremental-and-diff/03-praxis-integration-guide.md) | Praxis 团队接口改造、五大 SPI 扩展插槽与定制 Diff 底座接入 | ✅ 已落地 |
| [PRAXIS_HANDOFF_REPORT.md](./docs/PRAXIS_HANDOFF_REPORT.md) | Praxis 定制高性能 Diff 底座交付摘要与索引（引向 01-architecture/04 与 03-incremental-and-diff/03） | ✅ 已落地 |

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

## 🛡️ 6. 门禁与验证矩阵 (Gates & Verification Matrix)

### 6.1 一站式门禁

| 命令 | 覆盖范围 | 契约 |
|------|----------|------|
| `npm run gate` | build → format:check → lint → gate:comments → gate:self → gate:self:warning → test | 提交前唯一入口，任一环失败即阻断 |
| `npm run gate:self` | 自扫棘轮（error 级） | `newBlocking(error)` 必须为 0 |
| `npm run gate:self:warning` | 自扫棘轮（warning 级） | 新增 warning 同样阻断，防止"把告警搬进新文件"式改造 |
| `npm run gate:self:update` | 重冻基线 | **仅在 findings 真实下降后执行**；禁止用它掩盖新增告警 |
| `npm run gate:comments` | 注释/文档头一致性棘轮 | 新增注释违规即阻断 |

**评审纪律（非自动化）**：新增文件不得携带 `large-file`/`high-complexity` 超标；改造提交应同时给出 findings 前后对照。

### 6.2 可移植验证矩阵

| 校验 | 运行依赖 | 受限环境（无命名管道 / 禁止子进程捕获） |
|------|----------|------------------------------------------|
| `validate-equivalence`、`validate-diff`、`validate-oxc-keypoints`、`fastpath-check` | 纯进程内 | ✅ 可运行，且是行为等价的硬门禁 |
| `validate-warm`、`validate-diff` 的 daemon 回环场景 | Windows 命名管道 / Unix socket（daemon IPC） | ⚠️ 需在允许命名管道的终端补跑 |
| `validate-diff-interface`、`validate-review-memory`、`validate-consumer-runner`、`validate-data-flow` | `spawnSync` 捕获子进程输出 | ⚠️ 报 EPERM / `exit=null`，属环境限制而非回归 |

### 6.3 受限环境下的暖缓存等价验证

daemon 不可用时，用进程内模式覆盖 `scanWithCache` 的 L1/L2 路径：

```js
const { scan, scanWarm } = require('./dist/api');
const opts = { root: 'samples', format: 'json', logLevel: 'silent' };
const fresh = await scan(opts);
const w1 = await scanWarm({ ...opts, daemon: 'off', cache: true, cacheDir });   // 空缓存
const w2 = await scanWarm({ ...opts, daemon: 'off', cache: true, cacheDir });   // 热缓存
// 断言：两次 report 与新扫描逐字节一致；w2.stats.cacheHit > 0 且 analyzed === 0
```

---

## 📐 7. 架构图表 (Mermaid)

| 架构图 | 内容 |
|------|------|
| [docs/diagrams/class-diagram.mermaid](./docs/diagrams/class-diagram.mermaid) | 核心系统类图 |
| [docs/diagrams/sequence-diagram.mermaid](./docs/diagrams/sequence-diagram.mermaid) | 扫描分析时序图 |
| [docs/diagrams/diff-class-diagram.mermaid](./docs/diagrams/diff-class-diagram.mermaid) | Diff 系统类图 |
| [docs/diagrams/diff-sequence-diagram.mermaid](./docs/diagrams/diff-sequence-diagram.mermaid) | Diff 增量扫描时序图 |
