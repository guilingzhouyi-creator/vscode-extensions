# 📚 auto-refactor 分层技术文档与 Praxis 交付中心 | Documentation Hub

> **当前文档基线**：`auto-refactor` v0.4.0（对齐 TypeScript + Rust N-API 六算子核、八语言语义 IR、30 内置分析器与 325 规则体系、153/153 测试套件、三平面质量度量与 Praxis 统一开发者 SDK 门面）。  
> **历史文档封存位置**：全量历史技术文档已完整封存至 [`archive/auto-refactor/docs-snapshot-20261010/`](../../archive/auto-refactor/docs-snapshot-20261010/) 与 [`archive/auto-refactor/docs-snapshot-20260928/`](../../archive/auto-refactor/docs-snapshot-20260928/)。

---

## 🗺️ 六层技术文档导航地图 (Six-Layer Documentation Map)

### 🏛️ L1. 核心架构、调度流水线与 Rust 原生内核 (`01-architecture/`)
* [01-system-overview.md](./01-architecture/01-system-overview.md)：系统六层单向依赖拓扑、`DualTrackPipeline` 双轨流水线、`SparseMoEGateRouter` 稀疏路由与 `LoadGovernor` 自适应限流。
* [02-pipeline-and-caching.md](./01-architecture/02-pipeline-and-caching.md)：`L1` 内存 + `L2` 磁盘两级增量缓存、`TopologyCache` 依赖边缓存与复合配置指纹隔离机制。
* [03-daemon-and-ipc.md](./01-architecture/03-daemon-and-ipc.md)：跨平台常驻守护进程（Named Pipe / Unix Socket）、NDJSON 流式通信协议、RSS 水位自愈与零感冷降级。
* [04-praxis-git-fractal-and-gating-spec.md](./01-architecture/04-praxis-git-fractal-and-gating-spec.md)：Praxis 分形 Git 工作树模型、`L1/L2/L3A` 三级递进门禁与 `PraxisRollbackEngine` 三级级联回滚规范。
* [05-rust-native-operator-kernel.md](./01-architecture/05-rust-native-operator-kernel.md)：`crates/` 下 6 大 Rust Cargo 原生算子库（`auto-refactor-core`, `ops-diff`, `ops-graph`, `ops-pattern`, `ops-mask`, `ops-clone`）与纯 TS 回退桥 100% 字节等价规范。

### 🌲 L2. 跨语言语法解析、语义 IR 与图分析底座 (`02-parsers-and-ast/`)
* [01-multilang-abstraction.md](./02-parsers-and-ast/01-multilang-abstraction.md)：`NormalizedNode` 归一化语法树、`SemanticGraph` 跨语言语义拓扑图与八大语言生态适配矩阵（TS/JS, Python, Rust, Go, GDScript, Shell, Markdown, JSON）。
* [02-oxc-fastpath.md](./02-parsers-and-ast/02-oxc-fastpath.md)：Rust `oxc-parser` 0.144.0 Mode A 零物化流式快轨、Mode B 按需物化补偿及与 `typescript` 编译器 100% 字节等价验证。
* [03-lazy-projection.md](./02-parsers-and-ast/03-lazy-projection.md)：按需懒投影控制流图 (`CFG`)、Lengauer-Tarjan 支配树、数据流生命周期图 (`DFG`) 与跨文件调用图 (`CallGraph`)。

### ⚡ L3. 行级增量计算、向量化 Diff 与流式底座 (`03-incremental-and-diff/`)
* [01-line-level-incremental.md](./03-incremental-and-diff/01-line-level-incremental.md)：`LineMap` 坐标平移、`reuseSubtree` 未变动子树零重算、`ASTSliceExtractor` 最小语法切片与 `CallChainImpactTracer` 爆炸半径追踪。
* [02-diff-interface-spec.md](./03-incremental-and-diff/02-diff-interface-spec.md)：64-bit SWAR 行扫描、FNV-1a 行哈希、Bit-Parallel Myers (BPM) / Histogram Diff 算法栈与 `scanDiffStream` 异步事件流契约。
* [03-praxis-integration-guide.md](./03-incremental-and-diff/03-praxis-integration-guide.md)：`CircularDiffBuffer` 环形缓冲、`Uint8Array` R4 二进制冷存淘汰与 `SemanticPraxisContextEnricher` 作用域富集指南。

### 🔍 L4. 四层规则金字塔与内置分析器矩阵 (`04-analyzers-and-rules/`)
* [01-builtin-rules.md](./04-analyzers-and-rules/01-builtin-rules.md)：四层规则金字塔、30 个内置分析器包、机读英文 + 人读中文双轨文案契约，以及 **325 条全量内置规则权威字典（325/325 门禁覆盖）**。
* [02-custom-analyzer-plugin.md](./04-analyzers-and-rules/02-custom-analyzer-plugin.md)：声明式 `PatternKernel` 与编程式 `Analyzer` 插件开发规范、`cacheCustom` 安全隔离及评分表接入流程。

### 📊 L5. 配置契约、三平面质量度量与性能基准 (`05-specs-and-benchmarks/`)
* [01-config-and-reports.md](./05-specs-and-benchmarks/01-config-and-reports.md)：`auto-refactor.config.json` 完整 Schema、30 分析器与 325 规则默认阈值、`.refactor-trajectory/` 紧凑账本规范 (< 350B, *Ms) 与 JSON/SARIF/Text 报告契约。
* [02-performance-benchmarks.md](./05-specs-and-benchmarks/02-performance-benchmarks.md)：6 大核心算子性能基准台账（SWAR 6,448 MB/s, BPM 17.8 µs）、153/153 测试套件全量自测与防劣化回归护栏。
* [03-comment-and-header-standard.md](./05-specs-and-benchmarks/03-comment-and-header-standard.md)：规范六字段模块头契约 (`CMT-HDR-001`)、有效注释密度 (ECD-C) 算法模型与真实注释规则字典。
* [04-cross-language-generalization.md](./05-specs-and-benchmarks/04-cross-language-generalization.md)：项目中立性不变量 (`validate-project-neutrality`) 与文件语义角色自动推导 (`file-role-inference.ts`)。
* [05-consumer-integration.md](./05-specs-and-benchmarks/05-consumer-integration.md)：`baseline.json` 1.2.0 信用消耗语义、零高危债务防线 (`critical = 0, high = 0`) 以及 `workspace-timing` / `WebGames` 差异化接入范式。
* [06-modernization-program.md](./05-specs-and-benchmarks/06-modernization-program.md)：五大语言现代化规则包 (`*-modern`)、常量单一真源拓扑治理与结构债 ABC 分类治理法。
* [07-quantified-quality-standard.md](./05-specs-and-benchmarks/07-quantified-quality-standard.md)：10 细粒度维度到 8 战略支柱映射、双曲饱和衰减、安全动态天花板、三平面风险共振 ($S^{1.0} \cdot D^{1.2} \cdot H^{0.8}$) 与 **CAI 2.0 纯客观 6 维自研率**（Jeffreys Beta 后验）。

### 🤝 L6. 对接 Praxis 团队专属交付专层 (`06-praxis-delivery/`)
* [PRAXIS_HANDOFF_REPORT.md](./PRAXIS_HANDOFF_REPORT.md)：**Praxis 团队对接交付总报告（Executive Handoff）**（30 分析器、325 规则体系、153/153 测试套件）。
* [01-praxis-architecture-and-spi-contracts.md](./06-praxis-delivery/01-praxis-architecture-and-spi-contracts.md)：`PraxisCardContext`、`ReviewDiffHunk` 数据模型，底层差分 AST 完备性与表现层去重双层解耦公理，以及**六大核心 SPI 扩展插槽**（含表现层 SPI）。
* [02-praxis-six-governance-services-api.md](./06-praxis-delivery/02-praxis-six-governance-services-api.md)：七大核心治理服务与统一开发者 SDK 门面 [`PraxisReviewClient`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/praxis/praxis-review-client.ts) (`createPraxisClient`) API 完整手册。
* [03-praxis-integration-runbook-and-acceptance.md](./06-praxis-delivery/03-praxis-integration-runbook-and-acceptance.md)：端到端 TypeScript 联调代码范例、11 组 `SEMANTIC_OVERLAP_GROUPS` 并查集去重消费规范与 **153/153 自动化验收矩阵**。

### 📐 架构图表 (`diagrams/`)
* [class-diagram.mermaid](./diagrams/class-diagram.mermaid)：核心引擎类图（引入 `AutonomyScorer`, `RiskFusionEngine`, `PraxisReviewClient`）。
* [sequence-diagram.mermaid](./diagrams/sequence-diagram.mermaid)：双轨扫描、三平面风险共振评分与 CAI 自研率终结时序图。
* [diff-class-diagram.mermaid](./diagrams/diff-class-diagram.mermaid)：Praxis 治理门面、`PraxisReviewClient` SDK 与 `PraxisPresentationAdapter` 类图。
* [diff-sequence-diagram.mermaid](./diagrams/diff-sequence-diagram.mermaid)：Praxis 多 Agent 切片审计、11 组并查集语义聚合与一体两面双载荷派发时序图。
