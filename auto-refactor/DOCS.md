# 📚 auto-refactor 技术架构总索引与 Praxis 交付白皮书 | Docs Index

> **权威真源指针**：本文档为 `auto-refactor` 静态分析审查与多智能体治理引擎的全局总索引（对应工作区 [`AGENTS.md`](../AGENTS.md) 权威指针）。  
> **存量文档归档说明**：重编前的历史版本文档快照已全量封存至工作区归档目录 `archive/auto-refactor/docs-snapshot-20260928/` 及项目内归档目录 `auto-refactor/archive/docs-snapshot-20260928/`（不参与构建与 CI）。

---

## 🏗️ 1. 实际项目技术栈全景矩阵 (Actual Tech Stack Matrix)

`auto-refactor` v0.4.0 采用 **TypeScript 编排层 + Rust N-API 原生算子内核** 的混合双轨架构，自底向上分为六大核心技术层次：

| 技术栈层次 | 核心模块与物理路径 | 关键技术构件与真实规模指标 |
| :--- | :--- | :--- |
| **L1. Rust N-API 原生加速内核** | `crates/auto-refactor-core`<br/>`crates/ops-{diff,graph,pattern,mask,clone}`<br/>`src/core/native/` | **6 个 Cargo 成员 Crate**：64-bit SWAR 行扫描、Bit-Parallel Myers 差分、Lengauer-Tarjan 支配树、Tarjan SCC、单趟词法脱敏状态机、MinHash+LSH 克隆检测；配齐 `src/core/native/` 纯 TS 100% 字节等价回退桥 |
| **L2. 跨语言解析与语义图底座** | `src/core/ast/`<br/>`src/core/semantic/`<br/>`src/core/cfg/` | **`NormalizedNode` + `SemanticGraph`**：支持 **TS/JS** (`oxc-parser` 0.144.0 + `typescript` 5.3)、**Python** (`tree-sitter-python`)、**Rust** (`tree-sitter-rust`)、**Go**、**GDScript 4**、**Shell**、**Markdown**、**JSON** 八大生态；按需投影 CFG / DFG / CallGraph |
| **L3. 四层规则分层体系与分析器** | `src/core/rules/registry.ts`<br/>`src/analyzers/*.ts`<br/>`src/core/messages/` | **30 个内置分析器包**（完整覆盖包括 `ANALYZER_GO_MODERN`、`ANALYZER_SHELL_LINT`、`ANALYZER_GATE_ARCHITECTURE` 在内的领域专家）、**325 条注册规则**（310 Canonical `FAMILY-TOPIC-NNN` + 15 Legacy Aliases，文档覆盖率 **325/325**；全工作区 SSOT 单源目录统一收录 **410 条规则**）；机读纯英文（SARIF 2.1.0 / CAPP）+ 人读标准中文双轨文案解耦 |
| **L4. 稀疏路由与双轨并发调度** | `src/core/router/sparseMoEGate.ts`<br/>`src/core/pipeline/dualTrackPipeline.ts`<br/>`src/core/scheduler/` | **27 专家 Sparse MoE 变更熵密（CED）路由器**（增量分析器绕过率 $\ge 70\%$）、`< 10ms` `ASTSliceExtractor` 局部切片快轨 + 全仓跨文件深轨、L1/L2 两级缓存与跨平台 NDJSON Daemon |
| **L5. 三平面质量度量与自治度** | `src/core/scoring/`<br/>`src/core/dynamic/`<br/>`src/core/evolution/` | **静态平面**（10 大支柱 + 倒数型密度饱和曲线 + 算术/几何混合短板惩罚）+ **动态遥测平面** (`DynamicEvidenceDTO` + `RiskFusionEngine`) + **演化反馈平面**（Git 挖掘 + 梯度下降调权 + 代码自治度指数 **CAI**） |
| **L6. Praxis 团队交付子系统** | `src/core/praxis/`<br/>`src/core/ring-buffer.ts`<br/>`src/core/rollback.ts` | **6 大正式治理服务门面** + **5 大 SPI 扩展端口**：涵盖语义 Diff 审查、Sub-10ms 切片审计与 CAPP 提示词、多 Agent 并发补丁冲突仲裁 (`GOV-AGN-001`)、重构轨迹配方学习 (`GOV-TRJ-001`)、反馈自适应监督器、`CircularDiffBuffer` R4 二进制转储与 TaskCard 原子级联回滚 |

---

## 🗂️ 2. 六层分层技术文档索引 (Layered Documentation Directory)

### 🏛️ 第一层：核心架构、调度流水线与 Rust 原生内核 (`docs/01-architecture/`)

| 文档路径 | 核心主题 | 状态 |
| :--- | :--- | :---: |
| [docs/01-architecture/01-system-overview.md](./docs/01-architecture/01-system-overview.md) | 六层单向架构全景、`DualTrackPipeline`、`SparseMoEGateRouter` 与 `LoadGovernor` | ✅ 已对齐 |
| [docs/01-architecture/02-pipeline-and-caching.md](./docs/01-architecture/02-pipeline-and-caching.md) | L1/L2 两级增量缓存、`TopologyCache`、`CacheKey` 指纹隔离与 `scanAsymmetric` | ✅ 已对齐 |
| [docs/01-architecture/03-daemon-and-ipc.md](./docs/01-architecture/03-daemon-and-ipc.md) | 跨平台守护进程（Named Pipe / UDS）、NDJSON 协议、RSS 自愈与冷扫描无损降级 | ✅ 已对齐 |
| [docs/01-architecture/04-praxis-git-fractal-and-gating-spec.md](./docs/01-architecture/04-praxis-git-fractal-and-gating-spec.md) | Praxis 分形 Git 工作树、`L1/L2/L3A` 三级门禁与 `PraxisRollbackEngine` 三级联动回滚 | ✅ 已对齐 |
| [docs/01-architecture/05-rust-native-operator-kernel.md](./docs/01-architecture/05-rust-native-operator-kernel.md) | Rust 6 Crate 原生算子库（`ops-diff/graph/pattern/mask/clone`）与纯 TS Shim 100% 字节等价规范 | ✅ 已对齐 |

### 🌲 第二层：跨语言解析、语义 IR 与图分析底座 (`docs/02-parsers-and-ast/`)

| 文档路径 | 核心主题 | 状态 |
| :--- | :--- | :---: |
| [docs/02-parsers-and-ast/01-multilang-abstraction.md](./docs/02-parsers-and-ast/01-multilang-abstraction.md) | `NormalizedNode` 统一语法树、`SemanticGraph` 跨语言语义 IR 与八语言适配矩阵 | ✅ 已对齐 |
| [docs/02-parsers-and-ast/02-oxc-fastpath.md](./docs/02-parsers-and-ast/02-oxc-fastpath.md) | Rust `oxc-parser` Mode A 零物化流式快轨、Mode B 物化补偿与 100% 字节等价验证 | ✅ 已对齐 |
| [docs/02-parsers-and-ast/03-lazy-projection.md](./docs/02-parsers-and-ast/03-lazy-projection.md) | 零物化懒投影控制流图 (`CFG`)、支配树、数据流图 (`DFG`) 与跨文件调用图 (`CallGraph`) | ✅ 已对齐 |

### ⚡ 第三层：行级增量计算、向量化 Diff 与流式底座 (`docs/03-incremental-and-diff/`)

| 文档路径 | 核心主题 | 状态 |
| :--- | :--- | :---: |
| [docs/03-incremental-and-diff/01-line-level-incremental.md](./docs/03-incremental-and-diff/01-line-level-incremental.md) | `LineMap` 行号平移、`reuseSubtree` 子树复用、`ASTSliceExtractor` 与 `CallChainImpactTracer` | ✅ 已对齐 |
| [docs/03-incremental-and-diff/02-diff-interface-spec.md](./docs/03-incremental-and-diff/02-diff-interface-spec.md) | 64-bit SWAR、FNV-1a、Bit-Parallel Myers / Histogram Diff 算法栈与 `scanDiffStream` 事件流 | ✅ 已对齐 |
| [docs/03-incremental-and-diff/03-praxis-integration-guide.md](./docs/03-incremental-and-diff/03-praxis-integration-guide.md) | `CircularDiffBuffer` 环形缓冲、`Uint8Array` R4 冷存淘汰与 `SemanticPraxisContextEnricher` | ✅ 已对齐 |

### 🔍 第四层：四层规则分层体系与内置分析器矩阵 (`docs/04-analyzers-and-rules/`)

| 文档路径 | 核心主题 | 状态 |
| :--- | :--- | :---: |
| [docs/04-analyzers-and-rules/01-builtin-rules.md](./docs/04-analyzers-and-rules/01-builtin-rules.md) | 四层规则分层体系、30 个内置分析器、双轨文案架构与 **325 条全量内置规则字典 (325/325)**（全工作区 SSOT 单源收录 410 条） | ✅ 已对齐 |
| [docs/04-analyzers-and-rules/02-custom-analyzer-plugin.md](./docs/04-analyzers-and-rules/02-custom-analyzer-plugin.md) | 声明式 `PatternKernel` 与编程式 `Analyzer` 插件契约、`cacheCustom` 隔离与评分表扩展 | ✅ 已对齐 |

### 📊 第五层：配置契约、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)

| 文档路径 | 核心主题 | 状态 |
| :--- | :--- | :---: |
| [docs/05-specs-and-benchmarks/01-config-and-reports.md](./docs/05-specs-and-benchmarks/01-config-and-reports.md) | `auto-refactor.config.json` 配置模式、抑制策略、JSON / SARIF 2.1.0 / Text 报告与退出码 | ✅ 已对齐 |
| [docs/05-specs-and-benchmarks/02-performance-benchmarks.md](./docs/05-specs-and-benchmarks/02-performance-benchmarks.md) | 六大核心算子基准性能台账、热路径消融评测与防劣化回归护栏 | ✅ 已对齐 |
| [docs/05-specs-and-benchmarks/03-comment-and-header-standard.md](./docs/05-specs-and-benchmarks/03-comment-and-header-standard.md) | 六字段模块文件头契约、有效注释密度 (ECD-C) 算法与 `gate:comments` 棘轮 | ✅ 已对齐 |
| [docs/05-specs-and-benchmarks/04-cross-language-generalization.md](./docs/05-specs-and-benchmarks/04-cross-language-generalization.md) | 项目中立性护栏 (`validate-project-neutrality`) 与文件语义角色推导 (`file-role-inference.ts`) | ✅ 已对齐 |
| [docs/05-specs-and-benchmarks/05-consumer-integration.md](./docs/05-specs-and-benchmarks/05-consumer-integration.md) | `baseline.json` 1.2.0 信用消耗语义、单向棘轮与兄弟工程 (`workspace-timing` / `WebGames`) 接入 | ✅ 已对齐 |
| [docs/05-specs-and-benchmarks/06-modernization-program.md](./docs/05-specs-and-benchmarks/06-modernization-program.md) | 五大语言现代化规则包 (`*-modern`)、常量单源拓扑治理与结构债 ABC 分类治理法 | ✅ 已对齐 |
| [docs/05-specs-and-benchmarks/07-quantified-quality-standard.md](./docs/05-specs-and-benchmarks/07-quantified-quality-standard.md) | 三平面质量量化模型（静态十大支柱 + 动态遥测 + 演化反馈）与代码自治度指数 (`CAI`) | ✅ 已对齐 |

### 🤝 第六层：对接 Praxis 团队交付文档专层 (`docs/06-praxis-delivery/`)

| 文档路径 | 核心主题 | 状态 |
| :--- | :--- | :---: |
| [docs/PRAXIS_HANDOFF_REPORT.md](./docs/PRAXIS_HANDOFF_REPORT.md) | **Praxis 团队对接交付总报告（Executive Handoff Report）** | ✅ 已交付 |
| [docs/06-praxis-delivery/01-praxis-architecture-and-spi-contracts.md](./docs/06-praxis-delivery/01-praxis-architecture-and-spi-contracts.md) | Praxis 对接架构全景、核心数据契约（`PraxisCardContext` / `ReviewDiffHunk`）与五大 SPI 扩展插槽手册 | ✅ 已交付 |
| [docs/06-praxis-delivery/02-praxis-six-governance-services-api.md](./docs/06-praxis-delivery/02-praxis-six-governance-services-api.md) | Praxis 六大核心治理服务门面（Diff、Slice、MultiAgent、Trajectory、FeedbackSupervisor、Rollback）API 手册 | ✅ 已交付 |
| [docs/06-praxis-delivery/03-praxis-integration-runbook-and-acceptance.md](./docs/06-praxis-delivery/03-praxis-integration-runbook-and-acceptance.md) | Praxis 团队端到端 TypeScript 联调代码范例、异常降级 SLA 与自动化验收矩阵 | ✅ 已交付 |
| [docs/praxis-integration-guide.md](./docs/praxis-integration-guide.md) | **Praxis 统一客户端 SDK (IPraxisReviewClient)、一体两面三层拓扑 Diff 与面向 Agent 结构化指令集成手册** | ✅ 已交付 |

### 📐 架构图表 (`docs/diagrams/`)

| 图表路径 | 内容说明 |
| :--- | :--- |
| [docs/diagrams/class-diagram.mermaid](./docs/diagrams/class-diagram.mermaid) | 六层架构核心类图（`Scanner`, `DualTrackPipeline`, `SemanticGraph`, `NativeBridge`, `QualityScorer`） |
| [docs/diagrams/sequence-diagram.mermaid](./docs/diagrams/sequence-diagram.mermaid) | 双轨扫描流水线与三平面质量评分时序图 |
| [docs/diagrams/diff-class-diagram.mermaid](./docs/diagrams/diff-class-diagram.mermaid) | Praxis 子系统六大治理服务门面、五大 SPI 与回滚引擎类图 |
| [docs/diagrams/diff-sequence-diagram.mermaid](./docs/diagrams/diff-sequence-diagram.mermaid) | Praxis 多智能体切片自审、流式 Diff (`scanDiffStream`)、冲突仲裁与卡级原子回滚时序图 |

---

## 🛡️ 3. 一站式构建与门禁验证矩阵 (Gates & Verification Matrix)

| 命令 | 覆盖范围 | 门禁契约 |
| :--- | :--- | :--- |
| `npm run gate` | `gate:rust` $\rightarrow$ `build` $\rightarrow$ `format:check` $\rightarrow$ `lint` $\rightarrow$ `gate:comments` $\rightarrow$ `gate:self` $\rightarrow$ `npm test` | 提交前唯一闭环入口，135+ 套并行与串行套件任一环失败即阻断 |
| `npm run gate:rust` | `cargo clippy -- -D warnings` + `cargo fmt --check` + `cargo test`（全 6 个 Crate） | Rust 原生算子库零告警、全测试通过 |
| `npm run gate:self` | 引擎自扫基线棘轮（error 级） | `newBlocking(error)` 必须恒为 `0` |
| `npm run gate:self:slice` | AST 语义切片增量自审 (`scripts/gate-self-slice.js`) | 毫秒级局部语法树突变自检 |
| `npm run gate:comments` | 注释与六字段模块头一致性棘轮 (`scripts/gate-comments.js`) | 新增注释或模块头违规即阻断 |
| `npm run validate-rules-registry` | 规则注册表、发射集与 `01-builtin-rules.md` 双向对齐校验 | 325/325 规则注册与文档覆盖率 100%，零孤儿规则，全工作区 410 规则对齐 |
| `npm run validate-docs` | Markdown 文档围栏闭合 (`DOC-FEN-001`)、死链 (`DOC-LNK-001`) 与重复段落 (`DOC-DUP-001`) 校验 | 文档中心全量 `.md` 零违规 |
| `npm run validate-praxis` | Praxis Diff 算子、五大 SPI、环形缓冲 R4 转储、流式事件与卡级回滚集成套件 | 6 大核心集成测试套件断言成立 |
| `auto-refactor gate` | `composite-quality-gate` 复合质量门禁结构化报告 | 统一评估静态分数、动态遥测、ELOC 密度、QED 投资回报、缺陷密度与债务变化，支持 `--stage pre-commit\|pre-push\|ci` |

---

## 💻 4. 生产级 CLI 命令全景 (CLI Commands Reference)

`auto-refactor` 提供九大核心 CLI 子命令，全量集成于统一参数解析与运行时分发引擎：

| 子命令 | 命令语法与参数示例 | 核心职责与交付输出 |
| :--- | :--- | :--- |
| `scan` | `auto-refactor scan --format <json\|sarif\|text\|agent> [options]` | 全仓/局部静态扫描与质量评估，支持双轨流水线、L1/L2 缓存与自动修复 (`--fix`) |
| `gate` | `auto-refactor gate [--stage pre-commit\|pre-push\|ci] [--root <dir>]` | 评估 `composite-quality-gate` 复合质量门禁阈值，生成多维结构化门禁裁定报告 |
| `self-test` | `auto-refactor self-test` | 运行内置已知违规 Corpus 固件测试，校验 30 专精分析器全量触发语义 |
| `daemon` | `auto-refactor daemon start\|stop\|status [--root <dir>]` | 管理跨平台后台常驻守护进程（Named Pipe / UDS），提供毫秒级热扫描加速 |
| `symbols` | `auto-refactor symbols <name> [--root <dir>]` | 查询 AST 符号定义、跨文件引用拓扑与调用链索引深度 |
| `guide` | `auto-refactor guide <file> [--domain <d>] [--line <l>]` | 提取当前文件/领域的智能体治理守卫提示词与活动规则引导上下文 |
| `trajectory` | `auto-refactor trajectory [<file>\|--summary]` | 检查全局 review 紧凑账本历史大盘或单文件修订演化轨迹 |
| `memory` | `auto-refactor memory` | 查看活跃审查内存索引记录数、历史修订池及拓扑缓存容量 |
| `stats` | `auto-refactor stats [--root <dir>]` | 统计目标工程的代码体积、物理 LOC、有效逻辑 ELOC、代码密度比与稀释率大盘 |

