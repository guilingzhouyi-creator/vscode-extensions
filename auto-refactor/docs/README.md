# 📚 auto-refactor 架构与规范文档库 | Documentation

> **auto-refactor** 规范化技术文档集合。统一采用 **功能分类前缀 + 语义化命名** 进行组织。  
> 历史原始设计草稿与阶段施工工单已统一封存至工作区归档目录：[`archive/auto-refactor/docs-legacy/`](../../archive/auto-refactor/docs-legacy/)。

---

## 🗺️ 文档导航地图 (Documentation Map)

### 🏛️ 01. 核心架构与调度 (Architecture & Engine)
* [01-system-overview.md](./01-architecture/01-system-overview.md)：系统全景架构、DualTrack 双轨流水线、Sparse MoE 稀疏路由、AST 切片自审门禁与 RSS 内存自愈。
* [02-pipeline-and-caching.md](./01-architecture/02-pipeline-and-caching.md)：L1 内存缓存 + L2 磁盘持久缓存架构、非对称缓存探针与变更提示流水线。
* [03-daemon-and-ipc.md](./01-architecture/03-daemon-and-ipc.md)：跨平台 Daemon 守护进程、NDJSON 通信协议、心跳自愈与流式响应。
* [04-praxis-git-fractal-and-gating-spec.md](./01-architecture/04-praxis-git-fractal-and-gating-spec.md)：Praxis 分形 Git 工作树、两级门禁、三层联动回滚与智能体生命周期规范（v1.0.0-PROD-SPEC）。

### 🌲 02. 语法解析与 AST 适配 (Parsers & AST)
* [01-multilang-abstraction.md](./02-parsers-and-ast/01-multilang-abstraction.md)：`NormalizedNode` 统一通用抽象与五语言全覆盖适配矩阵（TypeScript、Python、Rust、GDScript、Markdown）。
* [02-oxc-fastpath.md](./02-parsers-and-ast/02-oxc-fastpath.md)：基于 Rust `oxc-parser` 的 Mode A 流式极速解析与 Mode B 物化补偿、100% 字节等价性检验。
* [03-lazy-projection.md](./02-parsers-and-ast/03-lazy-projection.md)：零物化懒投影技术、流式观察者遍历与多维索引构建。

### ⚡ 03. 增量计算与 Diff 接入 (Incremental & Diff)
* [01-line-level-incremental.md](./03-incremental-and-diff/01-line-level-incremental.md)：行级增量子树复用 (`reuseSubtree`)、LineMap 坐标平移与 64-bit SWAR 向量化加速。
* [02-diff-interface-spec.md](./03-incremental-and-diff/02-diff-interface-spec.md)：Diff 接入规格、FastDiff 与 Bit-Parallel Myers (BPM) 64 位并行差分算法及双通道/流式 API。
* [03-praxis-integration-guide.md](./03-incremental-and-diff/03-praxis-integration-guide.md)：Praxis 团队接口改造、五大 SPI 扩展插槽、跨文件逆向依赖闭包与原子回滚（另见 [PRAXIS_HANDOFF_REPORT.md](./PRAXIS_HANDOFF_REPORT.md) 交付摘要）。

### 🔍 04. 规则引擎与内置分析器 (Analyzers & Rules)
* [01-builtin-rules.md](./04-analyzers-and-rules/01-builtin-rules.md)：四层规则金字塔、155 条全量内置规则（100% 文档覆盖）、24 类全域治理规则与双轨文案架构。
* [02-custom-analyzer-plugin.md](./04-analyzers-and-rules/02-custom-analyzer-plugin.md)：第三方自定义分析器插件契约与生命周期钩子规范。

### 📊 05. 规范、配置与性能基准 (Specs & Benchmarks)
* [01-config-and-reports.md](./05-specs-and-benchmarks/01-config-and-reports.md)：`ar.config.json` 规则配置模式与 JSON / SARIF 2.1.0 / Text 结构化报告契约。
* [02-performance-benchmarks.md](./05-specs-and-benchmarks/02-performance-benchmarks.md)：全维基准性能台账、6 大维度量化评测对比与防劣化回归护栏。
* [03-comment-and-header-standard.md](./05-specs-and-benchmarks/03-comment-and-header-standard.md)：注释与文件头工业契约 v1.0.0（六字段模板、公有 API JSDoc、并发语义与棘轮纪律）。
* [04-cross-language-generalization.md](./05-specs-and-benchmarks/04-cross-language-generalization.md)：跨语言审查泛化方法与能力矩阵（四层边界、项目中立性不变量与接入规范）。
* [05-consumer-integration.md](./05-specs-and-benchmarks/05-consumer-integration.md)：消费方接入规范（配置模板、通用 runner、基线棘轮、退出码契约与 CI 样例）。
* [06-modernization-program.md](./05-specs-and-benchmarks/06-modernization-program.md)：六域现代化改造计划（常量化、规则集治理、零分配性能优化、多语言标准化）。
* [07-quantified-quality-standard.md](./05-specs-and-benchmarks/07-quantified-quality-standard.md)：十维量化质量度量模型（公式、权重、非线性惩罚与防刷分机制）。

### 📐 06. 架构图表 (Diagrams)
* [class-diagram.mermaid](./diagrams/class-diagram.mermaid)：核心系统类图。
* [sequence-diagram.mermaid](./diagrams/sequence-diagram.mermaid)：扫描分析时序图。
* [diff-class-diagram.mermaid](./diagrams/diff-class-diagram.mermaid)：Diff 系统类图。
* [diff-sequence-diagram.mermaid](./diagrams/diff-sequence-diagram.mermaid)：Diff 增量扫描时序图。
