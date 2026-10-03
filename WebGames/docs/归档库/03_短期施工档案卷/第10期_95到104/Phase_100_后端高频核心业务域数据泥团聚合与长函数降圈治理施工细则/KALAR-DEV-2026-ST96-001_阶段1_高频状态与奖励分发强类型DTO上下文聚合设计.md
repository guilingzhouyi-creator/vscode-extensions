---
档号: KALAR-DEV-2026-ST96-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST96 (Phase_100_后端高频核心业务域数据泥团聚合与长函数降圈治理施工细则)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_100_后端高频核心业务域数据泥团聚合与长函数降圈治理施工细则 —— 阶段1：高频状态与奖励分发强类型DTO上下文聚合设计
形成日期: 2026-10-01
归档日期: 2026-10-03（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 高频状态; 奖励分发强类型DTO上下文聚合设计; domains.json
---

# 施工细则：后端高频核心业务域数据泥团聚合与长函数降圈治理 —— 阶段1：高频状态与奖励分发强类型DTO上下文聚合设计

> [!NOTE]
> **【施工目标】**: 针对高频核心业务域（物品统计、任务因果、世界状态）中的数据泥团进行强类型 DTO 聚合，消除散装参数传递与未封装字典，确立统一的 Value Object 与对象池生命周期。
> **施工开始日期：** 2026-10-01
> **阶段状态：** ✅ 已验收 (Completed)；状态以[路线图总索引](../../../../路线图/路线图总索引.md)为准。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST96-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST96-002_阶段2_战斗协调器与鉴权流长函数拆解与降圈重构.md) ｜ [阶段3](KALAR-DEV-2026-ST96-003_阶段3_战斗时间轴与物品属性高频切片对象池化与缓存优化.md) ｜ [阶段4](KALAR-DEV-2026-ST96-004_阶段4_全域无头回归测试矩阵与二十项门禁对齐.md)

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `WebGames/docs/README.md`、`WebGames/config/README.md`
- **核心不变量约束断言**: 强类型 RefCounted DTO 承载全跨域数据流；所有 DTO 必须支持 `reset_state()` 满足高承压对象池化契约；序列化与反序列化通过 `to_dto()` 与 `from_dto()` 纯函数转换。
- **防漂移最高指示**: 杜绝在业务循环中直接传递无模式的裸 Dictionary，所有上下文通过统一 DTO 容器下发。

## 一、 阶段目标与数据契约设计
1. 建立 `ItemStatAggregationDto`（物品统计聚合 DTO）、`QuestRewardContextDto`（任务奖励分发上下文 DTO）以及 `HudMutationContextDto`（HUD 状态突变上下文 DTO）。
2. 在领域层接口中全面替换散装参数列表，统一接入 DTO 上下文模型。

## 二、 命令式施工执行清单 (Execution Checklist)
- [x] Step 1: 建立 `res://backend/domains/item_statistics/dto/item_stat_aggregation_dto.gd`。
- [x] Step 2: 建立 `res://backend/domains/quest_causality/dto/quest_reward_context_dto.gd`。
- [x] Step 3: 建立 `res://backend/domains/world_state/dto/hud_mutation_context_dto.gd`。
- [x] Step 4: 在 `domains.json` 中登记各领域 DTO 规范契约。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-100-01-01 | DTO 类型与重置接口完备性 | 实例化各 DTO 并调用 `reset_state()` | 字段重置为纯净初始态，0 悬挂指针 |
| DoD-100-01-02 | 序列化双向无损 | `from_dto(to_dto())` 对称测试 | 数据 100% 一致 |
