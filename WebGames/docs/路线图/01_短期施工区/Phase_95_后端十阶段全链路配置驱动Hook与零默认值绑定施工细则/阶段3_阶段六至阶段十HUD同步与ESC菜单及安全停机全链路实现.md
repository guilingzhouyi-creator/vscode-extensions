# 施工细则：后端十阶段全链路配置驱动Hook与零默认值绑定 —— 阶段3：阶段六至阶段十HUD同步与ESC菜单及安全停机全链路实现

> [!NOTE]
> **施工开始日期**: 2026-09-28
> **【施工目标】**: 实现阶段六至阶段十（HUD 同步 $\to$ ESC 菜单 $\to$ 退出请求 $\to$ 保存落盘 $\to$ 完全退出）解耦调度，建立通用阶段 Hook 执行引擎 `LifecycleStageHookRegistry` 与停机安全资源有序释放。

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `WebGames/backend/domains/world_state/`、`WebGames/backend/domains/hardware_input/`、`WebGames/backend/domains/lifecycle/`
- **核心不变量约束断言**: 真实种族/生理属性/钱包数据无损同步至 HUD；ESC 菜单支持配置驱动动作；停机保存严格防伪造防静默兜底；停机资源按优先级降序释放。
- **防漂移最高指示**: 消除单一上帝类，通过 `LifecycleStageHookRegistry` 与各领域无状态静态方法配合，确保架构清晰、职责内聚。

## 一、 核心算法与传导链改造
1. `HudStateSyncService`: `trigger_initial_world_sync` 支持传入 `race_id` 及从 `physiology.race_id` 自动提取真实种族，消除 `"HUMAN"` 硬编码覆盖；未接线模式下保留 `UNBOUND`。
2. `InputDeviceStateAggregate`: 从 `domains.hardware_input` 的 `keyboard_shortcuts` 动态加载按键映射（含 `toggle_escape_menu`），并提供 `resolve_escape_menu_action()` 解析配置驱动的 ESC 菜单动作路由。
3. `GameLifecycleService`: 接入 `infrastructure.lifecycle` 的 `shutdown_hooks`，维护 `_shutdown_resources` 优先级队列并在停机管线中按序执行 `ShutdownResourceDescriptor.execute_cleanup()`；未接线严格模式下空存档槽位返回 `UNBOUND_SAVE_SLOT`，不静默绑定 `"quicksave_exit"`。
4. `LifecycleStageHookRegistry`: 提供纯配置驱动的 10 阶段管线调度与前置/后置 Hook 挂载机制，结合 `UnwiredSlotGuardSolver` 看守全链路数据完整性。

## 二、 命令式施工执行清单 (Agent Execution Checklist)
- [x] Step 1: 改造 `hud_state_sync_service.gd`，修复 `trigger_initial_world_sync` 种族硬编码并支持 `UNBOUND` 预留。
- [x] Step 2: 改造 `input_device_state_aggregate.gd`，实现 `keyboard_shortcuts` 与 `escape_menu_actions` 配置驱动加载。
- [x] Step 3: 改造 `game_lifecycle_service.gd`，实现 `ShutdownResourceDescriptor` 优先级释放与未接线存档槽位拦截。
- [x] Step 4: 实现 `LifecycleStageHookRegistry`，提供阶段调度与 Hook 挂载机制。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-95-03-01 | 阶段 ⑥~⑩ 传导与停机闭环 | `LifecycleStageHookRegistry` 调度 Stage 6~10 与优雅停机 | HUD 真实种族同步 $\to$ ESC 菜单状态 $\to$ 退出请求 $\to$ 落盘校验 $\to$ 资源有序释放与 `STOPPED` 终态 |
| DoD-95-03-02 | 复杂度与静态类型门禁 | `audit_gd.py` 静态审查全量文件 | 新增与修改方法 `CC < 10`、嵌套 $\le 3$、`GOV-TYP-001 = 0` |
