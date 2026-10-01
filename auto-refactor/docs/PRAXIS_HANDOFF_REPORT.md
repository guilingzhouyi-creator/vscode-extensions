# Praxis 团队对接交付总报告 (Executive Handoff Report)

> **交付版本**：`auto-refactor` v0.4.0  
> **状态**：全栈已落地并通过 135 套自动化门禁验证  
> **历史文档归档位置**：`archive/auto-refactor/docs-snapshot-20260928/`

---

## 1. 交付物全景导航

针对 Praxis 多智能体（Multi-Agent）与分形工作单元（Multi-Cell）架构的实际研发需求，`auto-refactor` 已完成从底层向量化差分算子到顶层多智能体治理门面的全栈交付。完整技术规范按职责分为以下专册：

| 专册编号 | 文档名称 | 核心覆盖内容 |
| :---: | :--- | :--- |
| **专册 01** | [Praxis 对接架构全景与五大 SPI 契约手册](./06-praxis-delivery/01-praxis-architecture-and-spi-contracts.md) | `PraxisCardContext`、`ReviewDiffHunk`、`PraxisVerdict` 数据模型，以及溯源、富集、熔断阈值、环形缓冲 R4 转储、回滚门禁五大 SPI 扩展插槽规范 |
| **专册 02** | [Praxis 六大核心治理服务门面 API 手册](./06-praxis-delivery/02-praxis-six-governance-services-api.md) | `IPraxisDiffGovernanceService`、`IPraxisSliceAuditService`、`IPraxisMultiAgentGovernanceService`、`IPraxisTrajectoryLearningService`、`FeedbackAdaptiveSupervisor` 与 `PraxisRollbackEngine` 详细 API |
| **专册 03** | [Praxis 团队联调操作手册与交付验收矩阵](./06-praxis-delivery/03-praxis-integration-runbook-and-acceptance.md) | 单 Agent 切片自审、多 Agent 合入仲裁、流式 Diff 与卡级原子回滚的完整 TypeScript 接入范例、降级 SLA 与验收脚本清单 |
| **架构 04** | [分形 Git 工作树与多级门禁回滚规范](./01-architecture/04-praxis-git-fractal-and-gating-spec.md) | 分形 Git 分支模型、L1/L2/L3A 多级门禁升级协议与三级级联回滚架构设计 |
| **增量 03** | [Praxis 增量 Diff 管道与环形缓冲接入指南](./03-incremental-and-diff/03-praxis-integration-guide.md) | `CircularDiffBuffer` 内存管理、R4 二进制淘汰协议与增量语义图联动细节 |

---

## 2. 核心交付能力摘要

### 2.1 六大核心服务门面与源码映射

| 交付模块 | 导出符号 (`src/api.ts`) | 源码真源路径 | 解决的核心工程痛点 |
| :--- | :--- | :--- | :--- |
| **语义 Diff 审查门面** | `PraxisDiffGovernanceService`<br/>`defaultPraxisDiffGovernanceService` | `src/core/praxis/diffGovernance.ts` | 将行级 Diff 与跨语言 `SemanticGraph` 结合，输出逆向依赖闭包与八支柱补丁质量分 |
| **毫秒级切片审计门面** | `PraxisSliceAuditService`<br/>`defaultPraxisSliceAuditService` | `src/core/praxis/sliceAuditService.ts` | Sub-10ms 局部语法切片提取、Sparse MoE 稀疏路由（绕过 $\ge 70\%$ 无关分析器）、输出 CAPP 紧凑英文提示词 |
| **多 Agent 协作治理门面** | `PraxisMultiAgentGovernanceService`<br/>`defaultPraxisMultiAgentGovernanceService` | `src/core/praxis/multiAgentGovernance.ts` | 拦截并发补丁冲突、跨 Agent 循环依赖 (`GOV-AGN-001`) 与重复开发冗余，自动评选最优候选补丁 |
| **重构轨迹学习门面** | `PraxisTrajectoryLearningService`<br/>`defaultPraxisTrajectoryLearningService` | `src/core/praxis/trajectoryLearningService.ts` | 从 Bad$\rightarrow$Good 演进记录提炼 `RefactoringRecipe`，识别并拦截循环修改震荡 (`GOV-TRJ-001`) |
| **反馈自适应监督器** | `FeedbackAdaptiveSupervisor` | `src/core/praxis/feedback-adaptive-supervisor.ts` | 基于线上崩溃与回滚台账动态演化静态/动态/反馈三平面权重 $(W_s, W_d, W_f)$，抑制高误报规则 |
| **流式 Diff 与原子回滚底座** | `scanDiffStream`<br/>`CircularDiffBuffer`<br/>`PraxisRollbackEngine` | `src/core/stream.ts`<br/>`src/core/ring-buffer.ts`<br/>`src/core/rollback.ts` | 异步生成器实时推流、`Uint8Array` R4 冷存淘汰，以及按 Hunk 或按整张 TaskCard 的逆序无损原子回滚 |

### 2.2 关键性能基准与质量指标

1. **向量化扫描与差分吞吐**：64-bit SWAR 行边界扫描吞吐达 **6,400+ MB/s**；Bit-Parallel Myers 64 位并行差分较传统 Myers 提速 **2.4x+**；5,000 行代码 10 处分散编辑增量重审仅需 **~3.5 ms**（较全量扫描提速 **17.8x**）。
2. **原生与纯 TS 双轨 100% 等价**：`crates/` 下 6 个 Rust 原生算子库（`ops-diff`, `ops-graph`, `ops-pattern`, `ops-mask`, `ops-clone`, `auto-refactor-core`）与 `src/core/native/` 纯 TS 回退桥通过 `npm run validate-native-parity` 字节级等价校验。
3. **规则与文档 100% 闭环**：内置 **26 个分析器**、**243 条注册规则**（含 `GOV-AGN-001` 多智能体冲突、`GOV-SLC-001` 破坏性切片、`GOV-TRJ-001` 轨迹回归），文档覆盖率 **243/243**。
