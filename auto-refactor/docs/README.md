# 📚 auto-refactor 分层技术文档与 Praxis 交付中心 | Documentation Hub

> **当前文档基线**：`auto-refactor` v0.4.0（对齐 TypeScript + Rust N-API 六算子核、八语言语义 IR、<!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count -->内置分析器与 <!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor -->体系、<!-- METRICS:BEGIN test-suite-count -->**190 套**<!-- METRICS:END test-suite-count -->测试套件、LayerVFS 虚拟分叉与 MCTS 探索树、三平面质量度量与 Praxis 统一开发者 SDK 门面）。  
> **历史文档封存位置**：全量历史技术文档已完整封存至 [`archive/auto-refactor/docs-snapshot-20261018/`](../../archive/auto-refactor/docs-snapshot-20261018/)、[`archive/auto-refactor/docs-snapshot-20261010/`](../../archive/auto-refactor/docs-snapshot-20261010/) 与 [`archive/auto-refactor/docs-snapshot-20260928/`](../../archive/auto-refactor/docs-snapshot-20260928/)。

---

## 🗺️ 六层技术文档导航地图 (Six-Layer Documentation Map)

### 🏛️ L1. 核心架构、调度流水线与 Rust 原生内核 (`01-architecture/`)
* [01-system-overview.md](./01-architecture/01-system-overview.md)：系统六层单向依赖拓扑、`DualTrackPipeline` 双轨流水线、`SparseMoEGateRouter` 稀疏路由与 `LoadGovernor` 自适应限流。
* [02-pipeline-and-caching.md](./01-architecture/02-pipeline-and-caching.md)：`L1` 内存 + `L2` 磁盘两级增量缓存、`TopologyCache` 依赖边缓存与复合配置指纹隔离机制。
* [03-daemon-and-ipc.md](./01-architecture/03-daemon-and-ipc.md)：跨平台常驻守护进程（Named Pipe / Unix Socket）、NDJSON 流式通信协议、RSS 水位自愈与零感冷降级。
* [04-praxis-git-fractal-and-gating-spec.md](./01-architecture/04-praxis-git-fractal-and-gating-spec.md)：Praxis 分形 Git 工作树模型、LayerVFS 虚拟工作区分叉、`L1/L2/L3A` 三级递进门禁与 `PraxisRollbackEngine` 三级级联回滚规范。
* [05-rust-native-operator-kernel.md](./01-architecture/05-rust-native-operator-kernel.md)：`crates/` 下 6 大 Rust Cargo 原生算子库（`auto-refactor-core`, `ops-diff`, `ops-graph`, `ops-pattern`, `ops-mask`, `ops-clone`）与纯 TS 回退桥 100% 字节等价规范。
* [06-layervfs-virtual-storage-and-mcts.md](./01-architecture/06-layervfs-virtual-storage-and-mcts.md)：LayerVFS 虚拟分叉文件系统、FastCDC 动态切块、SQLite WAL CAS 存储、沙箱受控物理投影与 MCTS 重构探索锦标赛规范。

### 🌲 L2. 跨语言语法解析、语义 IR 与图分析底座 (`02-parsers-and-ast/`)
* [01-multilang-abstraction.md](./02-parsers-and-ast/01-multilang-abstraction.md)：`NormalizedNode` 归一化语法树、`SemanticGraph` 跨语言语义拓扑图与九类适配器 / 八种语言生态矩阵（TS/JS, Python, Rust, Go, GDScript, Shell, YAML, Markdown）。
* [02-oxc-fastpath.md](./02-parsers-and-ast/02-oxc-fastpath.md)：Rust `oxc-parser` 0.144.0 Mode A 零物化流式快轨、Mode B 按需物化补偿及与 `typescript` 编译器 100% 字节等价验证。
* [03-lazy-projection.md](./02-parsers-and-ast/03-lazy-projection.md)：按需懒投影控制流图 (`CFG`)、迭代式即时支配点、数据流生命周期图 (`DFG`) 与跨文件调用图 (`CallGraph`)。

### ⚡ L3. 行级增量计算、向量化 Diff 与流式底座 (`03-incremental-and-diff/`)
* [01-line-level-incremental.md](./03-incremental-and-diff/01-line-level-incremental.md)：`LineMap` 坐标平移、`reuseSubtree` 未变动子树零重算、`ASTSliceExtractor` 最小语法切片与 `CallChainImpactTracer` 爆炸半径追踪。
* [02-diff-interface-spec.md](./03-incremental-and-diff/02-diff-interface-spec.md)：64-bit SWAR 行扫描、FNV-1a 行哈希、Bit-Parallel Myers (BPM) 与低频锚点直方图差分的算法栈，及 `scanDiffStream` 异步事件流契约。
* [03-praxis-integration-guide.md](./03-incremental-and-diff/03-praxis-integration-guide.md)：`CircularDiffBuffer` 环形缓冲、`Uint8Array` R4 二进制冷存淘汰与 `SemanticPraxisContextEnricher` 作用域富集指南。
* [04-sparse-reference-replay.md](./03-incremental-and-diff/04-sparse-reference-replay.md)：稀疏参考滑动窗口重算 —— 复合锚点合并、签名变更的调用点桥接、三条退化边界、参考集排序规则、树级剪枝配合与流式符号视图边界。

### 🔍 L4. 四层规则分层体系与内置分析器矩阵 (`04-analyzers-and-rules/`)
* [01-builtin-rules.md](./04-analyzers-and-rules/01-builtin-rules.md)：四层规则分层体系、<!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count -->内置分析器包、机读英文 + 人读中文双轨文案契约，以及 **<!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor -->全量内置规则权威字典（门禁覆盖率达标，全工作区 SSOT 单源收录 <!-- METRICS:BEGIN rule-total -->**516 条规则**<!-- METRICS:END rule-total -->）**。
* [02-custom-analyzer-plugin.md](./04-analyzers-and-rules/02-custom-analyzer-plugin.md)：声明式 `PatternKernel` 与编程式 `Analyzer` 插件开发规范、`cacheCustom` 安全隔离及评分表接入流程。

### 📊 L5. 配置契约、三平面质量度量与性能基准 (`05-specs-and-benchmarks/`)
* [01-config-and-reports.md](./05-specs-and-benchmarks/01-config-and-reports.md)：`auto-refactor.config.json` 完整 Schema、32 分析器与 375 规则默认阈值、`.refactor-trajectory/` 紧凑账本规范 (< 350B, *Ms) 与 JSON/SARIF/Text 报告契约。
* [08-compact-agent-schema.md](./05-specs-and-benchmarks/08-compact-agent-schema.md)：AAS v1.0 智能体原生审查契约 —— 文件聚合、L1~L5 架构依赖拓扑排序、高密度代码锚点切片、修复配方与 5D 黎曼流形相空间张量。
* [02-performance-benchmarks.md](./05-specs-and-benchmarks/02-performance-benchmarks.md)：6 大核心算子性能基准台账（词法掩码 6,448 MB/s, 字内并行距离 17.8 µs）、<!-- METRICS:BEGIN test-suite-count -->**190 套**<!-- METRICS:END test-suite-count -->测试套件全量自测与防劣化回归护栏。
* [03-comment-and-header-standard.md](./05-specs-and-benchmarks/03-comment-and-header-standard.md)：规范六字段模块头契约 (`CMT-HDR-001`)、有效注释密度 (ECD-C) 算法模型与真实注释规则字典。
* [04-cross-language-generalization.md](./05-specs-and-benchmarks/04-cross-language-generalization.md)：项目中立性不变量 (`validate-project-neutrality`) 与文件语义角色自动推导 (`file-role-inference.ts`)。
* [05-consumer-integration.md](./05-specs-and-benchmarks/05-consumer-integration.md)：外部工程接入指南 —— `baseline.json` 1.2.0 信用模型、自适应弹性债务限额、AAS v1.0 协议集成与 `fractal-git` / `workspace-timing` / `WebGames` 对接契约。
* [06-modernization-program.md](./05-specs-and-benchmarks/06-modernization-program.md)：五大语言现代化规则包 (`*-modern`)、常量单一真源拓扑治理与结构债 ABC 分类治理法。
* [07-quantified-quality-standard.md](./05-specs-and-benchmarks/07-quantified-quality-standard.md)：10 细粒度维度到 8 战略支柱映射、双曲饱和衰减、安全动态上限、三平面风险共振 ($S^{1.0} \cdot D^{1.2} \cdot H^{0.8}$) 与 **CAI 2.0 纯客观 6 维自研率**（Jeffreys Beta 后验）。

### 🤝 L6. 对接 Praxis 团队专属交付专层 (`06-praxis-delivery/`)
* [05-consumer-integration.md](./05-specs-and-benchmarks/05-consumer-integration.md)：**外部工程接入与智能体审查总指南**（<!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count -->内置分析器、<!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor -->体系、<!-- METRICS:BEGIN test-suite-count -->**190 套**<!-- METRICS:END test-suite-count -->测试套件、AAS v1.0 协议规范与三大核心工程接入实测契约）。
* [01-praxis-architecture-and-spi-contracts.md](./06-praxis-delivery/01-praxis-architecture-and-spi-contracts.md)：`PraxisCardContext`、`ReviewDiffHunk` 数据模型，底层差分 AST 完备性与表现层去重双层解耦公理，以及**核心 SPI 扩展插槽**（含表现层与 LayerVFS 存储 SPI）。
* [02-praxis-six-governance-services-api.md](./06-praxis-delivery/02-praxis-six-governance-services-api.md)：核心治理服务与统一开发者 SDK 门面 [`PraxisReviewClient`](../src/core/praxis/praxis-review-client.ts) (`createPraxisClient`) API 完整手册，含虚拟工作区分叉与沙箱投影接口。
* [03-praxis-integration-runbook-and-acceptance.md](./06-praxis-delivery/03-praxis-integration-runbook-and-acceptance.md)：端到端 TypeScript 联调代码范例、<!-- METRICS:BEGIN overlap-cluster-count -->**11 个**<!-- METRICS:END overlap-cluster-count -->语义重叠聚类族的并查集去重消费规范与 <!-- METRICS:BEGIN test-suite-count -->**190 套**<!-- METRICS:END test-suite-count -->自动化验收矩阵。
* [04-praxis-layervfs-integration-guide.md](./06-praxis-delivery/04-praxis-layervfs-integration-guide.md)：LayerVFS 虚拟工作区集成实战指南、FastCDC 切块、CAS 零拷贝分叉、沙箱投影执行与 MCTS 重构锦标赛对接手册。
* [praxis-integration-guide.md](./praxis-integration-guide.md)：**Praxis 统一客户端 SDK (IPraxisReviewClient)、一体两面三层拓扑 Diff 与面向 Agent 结构化指令集成手册**。

### 📐 架构图表 (`diagrams/`)
* [class-diagram.mermaid](./diagrams/class-diagram.mermaid)：核心引擎类图（引入 `AutonomyScorer`, `RiskFusionEngine`, `PraxisReviewClient`）。
* [sequence-diagram.mermaid](./diagrams/sequence-diagram.mermaid)：双轨扫描、三平面风险共振评分与 CAI 自研率终结时序图。
* [diff-class-diagram.mermaid](./diagrams/diff-class-diagram.mermaid)：Praxis 治理门面、`PraxisReviewClient` SDK 与 `PraxisPresentationAdapter` 类图。
* [diff-sequence-diagram.mermaid](./diagrams/diff-sequence-diagram.mermaid)：Praxis 多 Agent 切片审计、语义重叠聚类并查集聚合与一体两面双载荷派发时序图。
* [layervfs-architecture.mermaid](./diagrams/layervfs-architecture.mermaid)：LayerVFS 毫秒级虚拟分叉、CAS 存储、受控沙箱物理投影与 MCTS 锦标赛时序拓扑图。
