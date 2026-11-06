# 仓库系统性说明与核心架构规范 (System Specifications)

> 本目录为工作区系统性设计、静态度量模型、跨平台脚本治理与数学公理的权威说明手册。
> 采用**高内聚·分层解耦·严谨数学求真**架构，详尽阐释全工作区运行的核心算法、评估模型与工程契约。
> 工作区技术文档总索引请参见 [docs/README.md](../README.md)。

---

## 一、 系统说明文档索引矩阵

| 规约文档 | 核心主题 | 架构角色与主要覆盖内容 | 关联权威真源 |
| :--- | :--- | :--- | :--- |
| [**`quality-scoring-model.md`**](./quality-scoring-model.md) | **十维工程质量量化评分模型** | 详细阐述 10 大质量维度定义、双曲密度衰减曲线、加权几何平均、Jeffreys 先验置信度、技术债穿透机制与防刷分数学公理 | `auto-refactor/src/core/scoring/` |
| [**`script-governance-architecture.md`**](./script-governance-architecture.md) | **仓库级脚本工程治理体系** | 详细阐述语言域 × 职能域正交矩阵、PowerShell / Bash / Node.js 规范契约、同构双实现机制、Tier 1 内存流式门禁与性能短路模型 | `scripts/`、[scripts/README.md](../../scripts/README.md) |
| [**`rule-catalog-architecture.md`**](./rule-catalog-architecture.md) | **单源规则目录与元治理架构** | 阐明 SSOT 单源真源公理、3-3-3 标准命名拓扑、权威三字母词典、三阶别名网络、534 规则闭包与底层诊断/表现层解耦机制 | `scripts/common/rule-catalog.json` |
| [**`token-frugal-sentence-and-diagnostic-spec.md`**](./token-frugal-sentence-and-diagnostic-spec.md) | **高效 Token 句子压缩与诊断规范** | 阐明五维 Token 压缩协议、行业标准缩写与晦涩缩写边界矩阵、中心化模板字典规范及 >= 70% Token 节约率公理 | `auto-refactor/src/core/reporting/` |
| [**`workspace-timing-architecture.md`**](./workspace-timing-architecture.md) | **VS Code 扩展五层解耦架构** | 详述 UI/应用/领域/基础设施/工具五层严格解耦、RingBuffer + WAL Journal + JSON 三级崩溃恢复持久化及交互物理学契约 | `workspace-timing/` |
| [**`webgames-architecture-spec.md`**](./webgames-architecture-spec.md) | **WebGames 配置驱动解耦规范** | 阐释 Godot 4 纯逻辑引擎解耦、全域 `GameConfig` 单源驱动、`apply_snapshot` 单向快照注入、对象池零堆分配与四阶段方案纪律 | `WebGames/` |
| [**`gate-audit-checklist.md`**](./gate-audit-checklist.md) | **全域门禁审计核查清单** | 逐入口列出提交、推送与全量审查的判定项、留痕要求与失败处置口径，供人工复核或多智能体交叉复审时逐项打勾 | `scripts/common/gate-step-registry.json` |
| [**`agent-native-system-blueprint.md`**](../agent-native-system-blueprint.md) | **Agent-Native 顶层自治设计蓝图** | 阐明 Cell 平权自治体系、一体两面三层拓扑 Diff 引擎、R1~R5 记忆提纯管线与分形 Git 门禁体系 | `AGENTS.md` |
| [**`fractal-git/docs/README.md`**](../../fractal-git/docs/README.md) | **Taxis 分形 Git 高性能版本控制内核** | 10 大内核子系统架构、偏序集同态 CCD v2、Kirsch-Mitzenmacher 双哈希布隆过滤器、SWAR 差分、TIPSE 原位存储与自举基准规范 | `fractal-git/`、`fractal-git/docs/` |

---

## 二、 架构设计核心公理速查

1. **客观求真与零注水公理**：全仓所有静态分析与质量度量从 0 纯客观统计，严禁保底伪造、虚假倍数放大与固定加分；
2. **木桶短板敏感公理**：综合健康分采用加权几何平均（Weighted Geometric Mean），单轴严重滑坡将按对数惩罚显著拉低总分，杜绝多轴虚高掩盖单轴缺陷；
3. **同构双实现契约**：跨平台核心协作与打包脚本必须提供 PowerShell（`ps1/`）与 Bash（`sh/`）双实现，参数签名、退出码语义与质性诊断 1:1 对齐；
4. **两层双轨门禁防御**：Tier 1 本地极速左移判定（单进程内存流式，耗时毫秒级）与 Tier 2 远端 CI 主干看守无缝镜像；
5. **规则单源唯一权威**：全仓规则收口至 `scripts/common/rule-catalog.json`，严禁在任何地方虚构未登记规则（`RCFG-RULE-DRIFT`）。
