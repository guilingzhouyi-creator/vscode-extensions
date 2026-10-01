# 施工细则：后端十阶段全链路配置驱动Hook与零默认值绑定 —— 阶段1：十阶段全链路上下文数据模型与可扩展Hook配置契约

> [!NOTE]
> **施工开始日期**: 2026-09-28
> **【施工目标】**: 建立跨十阶段（① 注册账号 $\to$ ⑩ 完全退出）的统一解耦会话上下文 DTO `SessionFlowContextDTO` 与配置驱动 Hook 契约，支持零默认值静默绑定与四层解耦无头调度。

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `WebGames/docs/README.md`、`WebGames/config/README.md`
- **核心不变量约束断言**: 纯后端逻辑传导（零前端 UI 耦合）、全模块配置驱动可扩展自定义 Hook、未接线插槽显式预留（`UNBOUND` / `PENDING_*`）严禁静默绑定默认值。
- **防漂移最高指示**: 坚持分层解耦无头架构，消除单一大类上帝对象，所有阶段通过轻量 Value Object `SessionFlowContextDTO` 与领域无关调度引擎 `LifecycleStageHookRegistry` 驱动。

## 一、 阶段目标与数据契约设计
1. 建立跨十阶段（① 注册账号 $\to$ ② 默认角色世界档案 $\to$ ③ 世界选择 $\to$ ④ 人物创建 $\to$ ⑤ 序章播放 $\to$ ⑥ 主界面 HUD $\to$ ⑦ ESC 菜单 $\to$ ⑧ 退出游戏 $\to$ ⑨ 保存完成 $\to$ ⑩ 完全退出）的解耦后端上下文数据模型 `SessionFlowContextDTO`。
2. 在 `config/domains/account.json`、`config/domains/world_gateway.json`、`config/domains/character_creation.json`、`config/domains/hardware_input.json` 与 `config/infrastructure/lifecycle.json` 中补齐十阶段 Hook 挂载表、序章阶段跃迁表、ESC 菜单动作表与未接线插槽哨兵策略。

## 二、 命令式施工执行清单 (Agent Execution Checklist)
- [x] Step 1: 在 `config/domains/account.json` 增设 `auth/hooks` 与 `save_slot/unwired_policy` 配置段。
- [x] Step 2: 在 `config/domains/world_gateway.json` 增设 `gateway_modes/available_modes` 与 `gateway_hooks` 配置段。
- [x] Step 3: 在 `config/domains/character_creation.json` 增设 `prologue_stages` 四阶段跃迁表与 `creation_hooks` 配置段。
- [x] Step 4: 在 `config/domains/hardware_input.json` 增设 `keyboard_shortcuts/toggle_escape_menu` 与 `escape_menu_actions` 配置段。
- [x] Step 5: 在 `config/infrastructure/lifecycle.json` 增设 `shutdown_hooks` 停机管线阶段配置与未接线槽位策略。
- [x] Step 6: 建立纯数据载体 `SessionFlowContextDTO` 与无状态插槽守卫 `UnwiredSlotGuardSolver`。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-95-01-01 | 配置表与代码引用双向一致 | `audit_config_unused.py` 扫描全配置表 | 0 违规，所有阶段与 Hook 键名 100% 登记 |
| DoD-95-01-02 | 未接线插槽哨兵显式声明 | `UnwiredSlotGuardSolver.validate_slots` 空值校验 | 所有未接线缺省位统一返回 `UNBOUND` 拦截，零硬编码默认值掩盖 |
