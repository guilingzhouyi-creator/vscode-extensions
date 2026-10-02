# 施工细则：快照测试工程模式与全域数据流插桩引擎 —— 阶段3：预置典型测试快照库、动态Builder与实时快照捕获器

> [!NOTE]
> **【施工目标】**: 构建典型测试快照目录（SnapshotCatalog）、提供流畅易用的链式构造器（TestSnapshotBuilder），并研发运行时状态实时冻结捕获器（SnapshotCaptureTool），使 Agent 与测试开发者能 3 行代码完成极端场景构造或现场抓取。
> **施工开始日期：** 2026-10-02
> **阶段状态：** ✅ 已验收 (Completed)；状态以[路线图总索引](../../路线图总索引.md)为准。

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `res://backend/domains/persistence_protocol/save_data_access_layer.gd`、`res://backend/domains/currency_economy/currency_entities.gd`、`res://backend/domains/lifecycle_physiology/physiology_entities.gd`
- **核心不变量约束断言**: 预置快照遵循各业务域配置真源基线；Builder 模式具备自防御参数校验与类型安全约束；捕获器经由单一真源 `build_save_payload` 无损抓取当前内存态。
- **防漂移最高指示**: 捕获器抓取的 JSON 必须 100% 能够被 `TestSnapshotBundleDTO.from_dict()` 重新解析并成功二次注入，形成闭环自愈。

## 一、 阶段目标与数据契约设计
1. 建立 `SnapshotCatalog`，提供 4 组工业级预置快照模板：
   - `FIXTURE_NOVICE_SPAWNED`：序章刚结束初生态（白板新手装，100 金币）；
   - `FIXTURE_MID_EXPLORER`：25级精灵族进阶态（精良装备，5000 金币，主城广场）；
   - `FIXTURE_LATE_HERO`：60级终局满装态（全套史诗词缀装备，50000 金币，100 魔单晶）；
   - `FIXTURE_COMBAT_CRITICAL`：极限残血战斗态（HP 5%，MP 0，虚弱状态，野外地牢）。
2. 建立 `TestSnapshotBuilder`，支持链式动态定制：
   - `.create(id).with_character(name, race, level).with_hp(hp, max_hp).with_gold(gold).with_item(item_dict).at_stage(stage).build()`
3. 建立 `SnapshotCaptureTool`，支持运行时一键捕获当前内存全域状态为快照 DTO 或 JSON。

## 二、 命令式施工执行清单 (Agent Execution Checklist)
- [x] Step 1: 建立 `res://dev_harness/snapshot_mode/snapshot_catalog.gd`。
- [x] Step 2: 建立 `res://dev_harness/snapshot_mode/test_snapshot_builder.gd`。
- [x] Step 3: 建立 `res://dev_harness/snapshot_mode/snapshot_capture_tool.gd`。
- [x] Step 4: 验证 Builder 动态组装与捕获器二次反灌一致性。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-102-03-01 | 预置快照模板合法性 | 读取 Catalog 四大模板 | 所有模板均通过契约校验，包含完整的生理、资产与世界信息 |
| DoD-102-03-02 | 链式 Builder 动态构造 | 连续链式调用设置数值与装备 | 生成的 DTO 准确反映所有调用设置，未设置字段保持防御缺省 |
| DoD-102-03-03 | 运行时快照冻结捕获与回灌 | 在任意测试场景触发 `capture_current_state()` | 成功抓取当前全域状态，且二次通过 `inject_and_hydrate()` 注入能 100% 完美复原 |

