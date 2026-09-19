# 📚 auto-refactor 文档索引 | Docs Index

> auto-refactor 全部规范化设计与技术文档集合。
> 历史原始设计讨论与调研底稿已统一封存至工作区归档目录：`archive/auto-refactor/docs-legacy/`。

---

## 🆕 变更记录 | Changelog

### v0.4.0 (2026-09-19) — 自动化审查系统 VNext 体系级演进 (全域多语言·规则金字塔·Sparse MoE·轨迹学习)

| 升级模块 | 核心能力与架构演进 | 交付与影响 |
| :--- | :--- | :--- |
| **跨语言语义 IR** | 统一 `SemanticGraph` 拓扑底座，支持 TypeScript、Python、Rust 等多语言抽象语法投影与语义降解 | 实现跨语言统一拓扑遍历与零黑话规范 |
| **四层规则金字塔** | 构建 Layer 1 全域安全层、Layer 2 领域原型层、Layer 3 团队规范层、Layer 4 项目配置层，内置扩充至 146 条规则 | 单一真源规则注册表，零孤儿规则，覆盖率 100% |
| **八维质量度量** | 八大战略质量支柱、非线性缺陷惩罚与上限截断机制、有效代码密度与反刷分检测 | 彻底杜绝稀释刷分，量化得分客观精准 |
| **多 Agent 协作治理** | Agent 变更属性追踪、越级依赖与冲突检测、意图仲裁器与重复工作影响半径评估 | 发射 `GOV-AGN-001`，保障多智能体并行协作安全性 |
| **增量切片与 Sparse MoE** | AST 切片提取器、非对称稀疏激活架构（MoE CED，绕过率 $\ge 70\%$）、反向调用链影响面追踪 | 毫秒级增量响应，发射破坏性变更告警 `GOV-SLC-001` |
| **改造轨迹配方学习** | Bad $\rightarrow$ Good 轨迹学习、结构化重构配方提取、循环修改震荡拦截与死灰复燃反模式检测 | 发射 `GOV-TRJ-001`，提供 `IPraxisTrajectoryLearningService` |
| **Praxis 门面与 SPI** | 汇聚 Governance、SliceAudit、TrajectoryLearning 与 ReviewRunner 等强类型门面 | 完整保留 Praxis 团队接口与 SPI 扩展契约 |
| **全量并行测试流水线** | 扩充至 **53 套** 并行/异步测试套件，接入全自动化闭环承压基准 | 17.89s 内全量 PASS，一次性通过 20+ 项严苛门禁 |

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
| `validate-equivalence`、`validate-diff`、`validate-oxc-keypoints`、`fastpath-check`、`validate-baseline-ratchet`、`validate-suppression-gate` | 纯进程内 | ✅ 可运行，且是行为等价的硬门禁 |
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

### 6.4 棘轮信用语义（baseline 1.2.0）

棘轮把基线里的每一条记录当作**一次信用**，按报告顺序逐条消耗；某条发现消耗不到信用即判定为"新增"：

| 情形 | 判定 | 依据 |
|------|------|------|
| 某个"分析器\|规则\|文件"组比基线多出同类发现 | **新增** | 基线只记录 N 次，第 N+1 次无信用可用 |
| 同一行已有该规则的发现，再追加一条 | **新增** | id 为 `analyzer:rule:file:line`，一行多条共享同一 id，重数由严重度直方图承载，不再由"id 是否出现过"决定 |
| 已知发现由 warning 升级为 error（如越过 `fileLinesFail`） | **新增** | 低严重度信用不能吸收更高严重度的发现 |
| 已知发现由 error 降级为 warning | 不计新增 | 更高严重度的信用可吸收更低者——改进永远不算新增 |
| 1.0.0 / 1.1.0 旧基线 | 仅按重数判定 | 旧基线不含严重度信息，升级检测需重冻后生效（运行日志会明确提示） |

基线载荷：grouped 为 `{key, count, severities}`；id 为去重后的 `issues[]` 加 `severities{id: {severity: count}}`。重冻（`npm run gate:self:update`）的前提是**新增信用为零**——由 `gate:self` / `gate:self:warning` 与提交前的逐键比对（新增键必须落在已登记的抑制策略内）共同看守。

### 6.5 抑制与门禁判定

`--fail-on-severity` / `failOnIssue` 只统计**未抑制**的发现：被 `suppressions` 命中的发现保留在报告里（携带 `suppression.reason` 供审计），但不参与门禁计数。这与 `report.schema.json` 的字段说明、`gate-self.js` 的 `newBlocking` 统计保持一致；`validate-suppression-gate` 用一对仅相差抑制配置的夹具锁死该契约（抑制侧退出 0、对照侧退出 1）。

### 6.6 量化标准的单一真源（评分扣除表）

质量评分的「哪条规则扣哪个维度、扣多少分」不再散落在 if 链里，而是集中在 `src/core/scoring/dimensionRuleTable.ts`（数据模块）：每行 = 分析器 + 规则 id（自定义分析器可回退到片段匹配）+ 维度 + 分值 + 理由构造器；`dimensionDeductions` 只负责按「同一维度首个命中者胜出」执行该表，并叠加严重度技术债回退。架构/安全/性能三族仍由 `dimensionFamilyDeductions` 承担，但其扣除来源必须出现在 `scoringTypes.DIMENSION_ANALYZERS`（覆盖模型据此判定维度是否已测量）。

`validate-scoring-coverage` 现在锁死两件事：① 9 条代表规则必须扣到表中声明的维度；② 扣除来源 ⊆ 已声明的证据分析器（`techDebtRisk` 为文档化例外——严重度回退让每个分析器都能喂它）。历史教训：这些判断曾写成「消息片段」，而片段与规范化后的规则 id（`GOV-STD-002`/`PRF-MEM-001`/`HYG-DED-001`…）永不匹配，导致 `modernity` 等维度**永远无法被扣除却仍显示为"已测量"**；表化 + 上述两条断言即为此设的护栏。

### 6.7 数据表字面量策略（scoped suppression）

`hardcoded-string` 对「已知值表」类文件按**文件+规则**粒度登记豁免，判据与 `semanticLiterals.ts` 一致：表项本身即数据（规则 id、分析器 id、维度 id），提成具名标量只会让表失去可读性。当前登记三处：`dimensionRuleTable.ts`、`dimensionFamilyDeductions.ts`、`scoringTypes.ts`。其余产品代码（`src/**`）的字面量仍逐条要求提取；新增豁免必须在配置里写明理由，并在提交信息中记录规则级前后对照。

### 6.8 结构债台账（分类治理，禁再"按指标平推"）

基线里现存的结构债**不是同一种债**，按解法分三类登记；未分类前禁止再用"行数/CC 一刀切"的方式平推（历史上出现过「文件变短但函数 CC 不变」的假进展）：

| 类别 | 判据 | 当前规模（src） | 代表 | 正确解法 |
|------|------|------|------|------|
| A. 扁平派发表 | 同一形状的分支反复调用同一个回调/返回同一个结构 | 约 8 个 CC≥20 函数 | `applyQualityDimensionDeductions`（已在 22cb6eb 表化，CC 23→5）、`ConstantsAnalyzer.detectDuplicates`(23)、`RustAdapter.kindOf`(23)、`PythonAdapter.mapNode/kindOf`(20)、`inferSemanticLayer`(23)、`governance/rules/*.checkFile`(20-24) | **改数据表/查表**（键 → 结果），不是继续抽 helper |
| B. 真算法 | 复杂度来自算法本身（差分/求解/图遍历），抽 helper 只会掩盖 | CC≥20 中约 5 个 | `editDiff.fastDiff`(23)、`histogramDiff.solve`(22)、`editDiff.myersDiff`(20) | **保留并具名说明**（在文件头/函数 JSDoc 写清复杂度来源）；**不**加抑制、**不**拆 |
| C. 真缠绕 | 嵌套/早期返回缺失导致的深分支 | 其余 CC 13-19 多数 | `src/index.ts main`(24)、`dualTrackPipeline.executeDualTrack`(23)、`workerScheduler` 内匿名(21) | 抽 guard / 降嵌套 / 提前返回 |

大文件（src 40 个 ≥400 行，前 10：types 926、editDiff 850、architecture 824、api 824、dependencyGraph 817、comments 796、hygiene 792、cache 741、config 706、dataFlow 673）按同一原则处理：**先按职责切**（A/B/C 里属于哪一类就按哪一类切），切完必须复核目标函数的 CC 是否真的下降——只降行数不算完成。

护栏：`gate:self` 只在**新增**上阻断，因此"把告警搬进新文件"或"重冻基线"都不会被误判为进展；每次重冻必须附逐键比对（新增键要么为零，要么全部落在已登记抑制内）。

### 6.9 双轨文案分层契约（机读英文底座与人读中文规则解耦）

系统确立**双轨文案分层架构（Dual-Track Wording Architecture）**，明确执行机读底座与人读界面的职责边界：

| 层次轨道 | 物理目录与构件 | 语言底座 | 核心职责与消费方 |
| :--- | :--- | :--- | :--- |
| **机读/执行轨 (Machine / Agent Track)** | `src/core/messages/`<br/>`src/core/guidance/`<br/>`src/analyzers/` | **纯英文 (100% English Baseline)** | 提供高 Token 密度、确定性且高依从度的 LLM Agent 提示词（Guidance Prompts）、以及符合 SARIF 2.1.0 / CI 编译器标准的底层诊断（Issue Message / Suggestion / Rationale）。 |
| **人读/展示轨 (Human / Governance Track)** | `src/core/rules/entries/`<br/>`docs/` 规则表 | **标准中文 (Chinese Guidance)** | 提供直观、详实、易于团队开发者理解与遵循的规则摘要（summary）与修复指引（remediation）。 |

**门禁看守保证**：
- `validate-self-norms.js` (Check 4 & 5)：严格断言 `src/core/messages/` 与 `src/core/guidance/` 中的字符串字面量、以及分析器发射的诊断信息绝不包含未授权汉字（仅 `comments.ts` 中的文件头六要素 AST 匹配靶标享有受限白名单豁免）；
- `validate-rules-registry.js`：严格断言所有注册规则具备详尽指导，且严禁泄露 `<TODO...>`、`TBD` 等未决占位符。

---

## 📐 7. 架构图表 (Mermaid)

| 架构图 | 内容 |
|------|------|
| [docs/diagrams/class-diagram.mermaid](./docs/diagrams/class-diagram.mermaid) | 核心系统类图 |
| [docs/diagrams/sequence-diagram.mermaid](./docs/diagrams/sequence-diagram.mermaid) | 扫描分析时序图 |
| [docs/diagrams/diff-class-diagram.mermaid](./docs/diagrams/diff-class-diagram.mermaid) | Diff 系统类图 |
| [docs/diagrams/diff-sequence-diagram.mermaid](./docs/diagrams/diff-sequence-diagram.mermaid) | Diff 增量扫描时序图 |
