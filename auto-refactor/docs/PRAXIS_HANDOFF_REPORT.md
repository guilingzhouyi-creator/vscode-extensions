# Praxis 团队对接交付总报告 (Executive Handoff Report)

> **交付版本**：`auto-refactor` v0.4.0  
> **交付状态**：全栈已落地并通过 **157/157 套自动化门禁与回归套件** 全量验证  
> **历史文档归档位置**：[`archive/auto-refactor/docs-snapshot-20261018/`](../../archive/auto-refactor/docs-snapshot-20261018/)、[`archive/auto-refactor/docs-snapshot-20261010/`](../../archive/auto-refactor/docs-snapshot-20261010/) 与 [`archive/auto-refactor/docs-snapshot-20260928/`](../../archive/auto-refactor/docs-snapshot-20260928/)

---

## 1. 交付物全景导航

针对 Praxis 多智能体（Multi-Agent）与分形工作单元（Multi-Cell）架构在增量代码审查、智能体毫秒级自检、并发冲突仲裁、自研率核算、虚拟工作区分叉与原子回滚的落地诉求，`auto-refactor` 已完成从底层 Rust 原生算子、LayerVFS 虚拟存储到顶层统一开发者 SDK 的全栈交付。

完整交付文档体系结构如下：

| 交付专册 | 文档名称 | 核心覆盖内容与技术规格 |
| :---: | :--- | :--- |
| **专册 01** | [Praxis 对接架构全景与核心 SPI 契约手册](./06-praxis-delivery/01-praxis-architecture-and-spi-contracts.md) | `PraxisCardContext`、`ReviewDiffHunk` 数据模型，身份溯源、语义富集、熔断阈值、环形缓冲 R4 归档、LayerVFS 存储适配与表现层双载荷渲染 SPI |
| **专册 02** | [Praxis 核心治理服务与开发者 SDK 门面手册](./06-praxis-delivery/02-praxis-six-governance-services-api.md) | 细粒度服务门面，以及核心统一开发者 SDK [`PraxisReviewClient`](../src/core/praxis/praxis-review-client.ts) (`createPraxisClient`) API 规范，含虚拟工作区分叉与沙箱投影接口 |
| **专册 03** | [Praxis 团队联调操作手册与交付验收矩阵](./06-praxis-delivery/03-praxis-integration-runbook-and-acceptance.md) | 基于 `createPraxisClient` 的双载荷接入范例、11 组 `SEMANTIC_OVERLAP_GROUPS` 并查集去重规范与 **157/157 自动化门禁矩阵** |
| **专册 04** | [Praxis-LayerVFS 瞬时工作区对接手册与联调规范](./06-praxis-delivery/04-praxis-layervfs-integration-guide.md) | LayerVFS CAS 内容寻址、FastCDC 动态分块、SQLite WAL 单文件存储、零拷贝分叉 (`< 3ms`)、物理投影与 MCTS 多智能体打擂裁判规范 |
| **专册 05** | [LayerVFS 虚拟分叉与 MCTS 探索树架构规范](./01-architecture/06-layervfs-virtual-storage-and-mcts.md) | LayerVFS 核心算法拓扑、Gear Hash 滚动切块、UCT 探索树评估模型与沙箱生命周期隔离规范 |
| **规范 01** | [配置模式与多格式报告契约](./05-specs-and-benchmarks/01-config-and-reports.md) | `auto-refactor.config.json` Schema、30 分析器与 338 规则阈值默认值、`.refactor-trajectory/` 紧凑账本规范 (< 350B, *Ms) |
| **规范 02** | [全维性能基准与原生算子加速台账](./05-specs-and-benchmarks/02-performance-benchmarks.md) | SWAR 64-bit 扫描 (6,448 MB/s)、BPM 差分 (17.8 µs)、增量子树复用 (17.8x)、6 大原生 Rust 算子加速比与 157/157 套件防劣化护栏 |
| **规范 03** | [规范文件头与有效注释密度 (ECD-C) 规范](./05-specs-and-benchmarks/03-comment-and-header-standard.md) | 六字段标准模块头 (`CMT-HDR-001`)、ECD-C 模型与真实注释规则字典 (`CMT-HDR-001`, `CMT-BAN-001`, `CMT-DEAD-001`, `CMT-MOJI-001`, `HYG-STB-002`) |
| **规范 05** | [外部工程接入与基线棘轮指南](./05-specs-and-benchmarks/05-consumer-integration.md) | Baseline 1.2.0 单向收紧棘轮机制、零高危债务防线 (`critical = 0, high = 0`) 及多端工程差异化配置 |
| **规范 07** | [三平面质量量化模型与代码自治度 (CAI) 规范](./05-specs-and-benchmarks/07-quantified-quality-standard.md) | 10 大细粒度维度到 8 大战略支柱映射、双曲饱和衰减、安全动态天花板、三平面风险共振 ($S^{1.0} \cdot D^{1.2} \cdot H^{0.8}$) 与 **CAI 2.0 纯客观 6 维自研率**（Jeffreys Beta 后验） |

---

## 2. 核心交付成果与系统特征

### 2.1 统计基准：30 分析器、338 规则、157 套测试套件

| 指标维度 | 交付指标 | 验证命令与真源 |
| :--- | :---: | :--- |
| **内置分析器规模** | **30 个** | [`config.ts`](../src/core/config/config.ts) `BUILTIN_ANALYZERS` 数组 |
| **注册规则总数** | **338 条** | [`scripts/validate-rules-registry.js`](../scripts/validate-rules-registry.js) 100% 闭环通过 |
| **规则字典覆盖率** | **338 / 338 (100%)** | 每一个注册规则在文档与规则表中均有定义行（工作区 SSOT 收录 473 条） |
| **自动化测试套件** | **157 / 157 全量 PASS** | 151 套独立并行验证套件 + 5 套串行/状态套件 + 单元套件 (`npm test`) |
| **高危技术债基线** | **0 项 (Critical = 0, High = 0)** | 零高危债务刚性防线，违者 CI Fail-Closed 阻断 |

### 2.2 核心交付组件一览

1. **统一开发者总门面 SDK ([`PraxisReviewClient`](../src/core/praxis/praxis-review-client.ts))**：
   - 提供 `createPraxisClient()` 极简工厂，整合全工作区扫描、单文件审查、增量 Diff 治理、工作区虚拟分叉与合入门禁；
   - **一体两面双载荷交付 (Dual-Faced Delivery)**：
     - **机器面 (Agent Face)**：保留 100% 完整差分 AST 与精确语法定位，产出 CAPP 紧凑提示词与 Markdown 指令；
     - **人读面 (Human Face / UI)**：产出富文本诊断卡片与状态徽标，应用并查集去重降噪。
2. **LayerVFS 虚拟分叉与 MCTS 探索树 ([`src/core/praxis/vfs/`](../src/core/praxis/vfs/))**：
   - **FastCDC 动态内容感知切块**：Gear Hash 滚动状态机，切块吞吐率 $> 1.2\text{ GB/s}$；
   - **CAS 块级去重存储与 SQLite WAL 底座**：Node 24 原生 `node:sqlite` 持久化，微秒级虚拟工作区分叉（Fork $< 3\text{ms}$）、快照原子闪回（Rollback $< 1\text{ms}$）；
   - **沙箱受控物理投影引擎**：全异步零阻塞 I/O，工作目录强制锁定在临时目录，超时 124 退出码强杀守卫，`cleanOnClose()` 零物理残留；
   - **MCTS 重构探索锦标赛**：结合 UCT 树搜索与 $\Delta \text{CC}$ + AST 深度收益多维度量，自动淘汰劣质重构方案，剪枝优选合并。
3. **11 组语义重叠规则并查集去重 ([`semantic-correlation.ts`](../src/core/praxis/presentation/semantic-correlation.ts))**：
   - 贯彻「底层 AST 完备性与表现层去重双层解耦公理」；
   - 11 组语义重叠规则族在同坐标触发时，并查集算法自动选举主卡，将次级违规规约至 `correlatedRules` 元数据，彻底根除 UI 冗余提示。
4. **客观代码自研率模型 (CAI 2.0 — [`autonomy-scorer.ts`](../src/core/scoring/autonomy-scorer.ts))**：
   - 纯客观 6 大正交自研率维度：`effectiveLocAutonomy` ($R_{loc}$, 0.30)、`symbolCallAutonomy` ($R_{call}$, 0.20)、`domainKernelDensity` ($R_{domain}$, 0.15)、`codeOriginality` ($R_{pure}$, 0.15)、`supplyChainResilience` ($R_{supply}$, 0.10)、`criticalPathAutonomy` ($R_{critical}$, 0.10)；
   - 基于 **Jeffreys 无偏先验 $\text{Beta}(0.5, 0.5)$** 计算 $95\%$ 置信区间与样本充分度 $S$，严格保障小样本不虚标；
   - 划分 L1~L5 五级工业自研等级，盘点项目外部第三方 SDK 清单。
5. **三平面风险融合引擎 ([`risk-fusion-engine.ts`](../src/core/scoring/risk-fusion-engine.ts))**：
   - 非线性风险共振模型：$Risk_i = S_i^{1.0} \cdot D_i^{1.2} \cdot H_i^{0.8}$；
   - 双向印证放大（$1.3\times$）、单向冷路径抑制（$0.35\times$）与隐蔽运行时瓶颈捕获。
6. **Rust N-API 六大原生算子与双轨等价桥 ([`native-bridge.ts`](../src/core/native/native-bridge.ts))**：
   - `crates/` 下 6 个原生算子（`ops-mask`, `ops-diff`, `ops-graph`, `ops-clone`, `ops-pattern`, `auto-refactor-core`）；
   - SWAR 64-bit 扫描 6,448 MB/s (5.8x)，BPM 差分 17.8 µs (2.4x)；
   - 纯 TypeScript 回退实现通过 `npm run validate-native-parity` 字节级等价验证。

---

## 3. 验收确认与后续支持

本交付报告经全量自动化测试与代码单一真源交叉校验。Praxis 各研发单元可直接以 `@auto-refactor` 作为依赖引入，通过 `createPraxisClient` 开启高置信度代码审查、沙箱投影与治理。
