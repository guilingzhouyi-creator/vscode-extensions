# 仓库系统性说明与核心架构规范 (System Specifications)

> 本目录为工作区系统性设计、静态度量模型、跨平台脚本治理与数学公理的权威说明手册。
> 采用**高内聚·分层解耦·严谨数学求真**架构，详尽阐释全工作区运行的核心算法、评估模型与工程契约。

---

## 一、 系统说明文档索引矩阵

| 文档名称 | 核心主题 | 架构角色与主要覆盖内容 | 关联权威真源 |
| :--- | :--- | :--- | :--- |
| [quality-scoring-model.md](./quality-scoring-model.md) | **十维工程质量量化评分模型** | 详细阐述 10 大质量维度定义、双曲密度衰减曲线、加权几何平均、Jeffreys 先验置信度、技术债穿透机制与防刷分数学公理 | `auto-refactor/src/core/scoring/` |
| [script-governance-architecture.md](./script-governance-architecture.md) | **仓库级脚本工程治理体系** | 详细阐述语言域 × 职能域正交矩阵、PowerShell / Bash / Node.js 规范契约、同构双实现机制、Tier 1 内存流式门禁与性能短路模型 | `scripts/`、`scripts/README.md` |
| [agent-native-system-blueprint.md](../agent-native-system-blueprint.md) | **Agent-Native 顶层自治蓝图** | Cell 平权自治体系、一体两面三层拓扑 Diff 引擎、R1~R5 记忆提纯管线与分形 Git 门禁 | `AGENTS.md` |

---

## 二、 架构设计核心公理速查

1. **客观求真与零注水公理**：全仓所有静态分析与质量度量从 0 纯客观统计，严禁保底伪造、虚假倍数放大；
2. **木桶短板敏感公理**：综合健康分采用加权几何平均（Weighted Geometric Mean），单轴严重滑坡将按对数惩罚显著拉低总分，杜绝多轴虚高掩盖单轴缺陷；
3. **同构双实现契约**：跨平台核心协作与打包脚本必须提供 PowerShell（`ps1/`）与 Bash（`sh/`）双实现，参数签名、退出码语义与质性诊断 1:1 对齐；
4. **两层双轨门禁防御**：Tier 1 本地极速左移判定（单进程内存流式，耗时毫秒级）与 Tier 2 远端 CI 主干看守无缝镜像。
