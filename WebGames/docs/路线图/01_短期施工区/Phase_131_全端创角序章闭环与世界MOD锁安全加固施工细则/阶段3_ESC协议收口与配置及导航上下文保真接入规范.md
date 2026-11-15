# 施工细则：全端创角序章闭环与世界MOD锁安全加固 —— 阶段3：ESC协议收口与配置及导航上下文保真接入规范

> 施工开始日期: 2026-11-15
> 状态: 已验收 (Phase 131 Completed)

> [!NOTE]
> **【施工目标】** 本阶段聚焦横切基础设施、导航栈保真、ESC 协议收敛、网关 Tab 与联机验证交互接线以及双语配置对齐，确保玩家在整个生命周期（进入应用 → 返回网关 → 进入工作台再返回 → 游戏中呼出 ESC 菜单存盘返关/停机 → 校验联机界域并进入）中上下文不断裂、按钮全可用、文案双语全覆盖且通过全部架构护栏。

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针

- 前序阶段细则: [阶段1_全端入口交互契约与世界MOD锁安全规范.md](阶段1_全端入口交互契约与世界MOD锁安全规范.md) · [阶段2_网关创角链路重构与联机清污幂等状态机实现规范.md](阶段2_网关创角链路重构与联机清污幂等状态机实现规范.md)
- 导航与路由配置: [nav_manager.gd](../../../../frontend/navigation/nav_manager.gd) · [views.json](../../../../config/frontend/views.json)
- 主界面 ESC 与网关界面: [main_hud_subpanels.gd](../../../../frontend/views/main_hud/main_hud_subpanels.gd) · [real_esc_menu_service.gd](../../../../frontend/domain_boundary/services/real_esc_menu_service.gd) · [world_gateway_view.gd](../../../../frontend/views/world_gateway/world_gateway_view.gd) · [world_gateway_view.tscn](../../../../frontend/views/world_gateway/world_gateway_view.tscn) · [world_gateway_tabs.gd](../../../../frontend/views/world_gateway/world_gateway_tabs.gd) · [world_gateway_realm_session_helper.gd](../../../../frontend/views/world_gateway/world_gateway_realm_session_helper.gd)
- 双语本地化与官包摘要: [zh_CN.json](../../../../config/i18n/zh_CN.json) · [en_US.json](../../../../config/i18n/en_US.json) · [pack.json](../../../../mods/official_kalar/pack.json)

### 1.2 核心不变量约束断言

1. **导航回退零状态丢失不变量**: `NavManager` 在压栈切换屏面时须连同该屏的 `navigation_parameters` 一起压入并行参数栈；调用 `pop_screen()` 返回上一屏时恢复对应参数并安全传递至重新实例化的视图 `apply_snapshot(restored_params)`，同时保持既有 `_screen_stack: Array[String]` 对外深度与接口语义。
2. **ESC 单一服务口收敛不变量**: `MainHUDSubpanels` 及任何前端弹窗禁止直接构造裸包请求或调用 `UnifiedProtocolDispatcher`；必须经 `ServiceLocator.get_instance().esc_menu()`（兼容 Real 与 Mock 容器）携带真实会话上下文调用 `exit_to_gateway_async` 与 `quit_game_async`。
3. **双语零裸键值与配置注册表同步不变量**: 所有新增 UI 文案键（`ui.cc.*`、`ui.wg.mp.*` 新增联机/提示键、异常提示键）必须在 [zh_CN.json](../../../../config/i18n/zh_CN.json) 与 [en_US.json](../../../../config/i18n/en_US.json) 1:1 对称落地；新增的 `character_creation` 屏幕必须在 [nav_manager.gd](../../../../frontend/navigation/nav_manager.gd) 默认注册表与全链路路由表中同步登载，消除 `20` 与 `21` 计数漂移。

### 1.3 配置与接线防漂移最高指示

- **禁止前端视图直读业务配置**: 新增 [views.json](../../../../config/frontend/views.json) 中的 `character_creation` UI 默认文本/标签或布局预设不得在视图 `.gd` 中私自跨白名单直查业务规则表；权威创角选项（种族、出身、天赋）必须且只能经 `ICharacterService.get_creation_ui_snapshot_async()` 由后端返回。
- **物理卫生同步**: 所有修改后的 `.json` 配置文件与 `.tscn` 场景文件均需确保 UTF-8 无 BOM、LF 换行、单末尾换行与合法 JSON 语法，并经配置守卫与架构守卫复验。

---

## 一、 `NavManager` 注册与上下文栈保真改造规范

### 1.1 `NavManager` ([nav_manager.gd](../../../../frontend/navigation/nav_manager.gd))

| 改造区域 | 原有问题 | Phase 131 目标实现 |
| :--- | :--- | :--- |
| `_init_default_registry()` | 注册 20 个视图，缺少真实 `"character_creation"` 场景入口 | 注册 `"character_creation"` -> `"res://frontend/views/character_creation/character_creation_view.tscn"`（同步修正注释计数 `20` -> `21`） |
| `get_full_chain_navigation_table()` | `"character_creation"` 键仍回指 `"account_entry"` 旧面板 | 更新 `"character_creation"` 为 `"res://frontend/views/character_creation/character_creation_view.tscn"` 真实场景路径 |
| `_screen_param_stack` & `current_params` | `push_screen` / `switch_screen` 仅记录 `screen_id`，`pop_screen()` 硬传 `{}` 重建前屏导致 `account_id`/`token` 丢失 | 维护 `_current_screen_params: Dictionary` 与 `_screen_param_stack: Array[Dictionary]`；`push_screen` 压入旧屏与旧参数的深拷贝（必要时并入视图当前关键上下文）；`pop_screen` 出栈后传回完整参数还原前屏；`pop_to_root` 清空两栈 |

---

## 二、 `MainHUDSubpanels` ESC 收口与 `WorldGateway` 交互完整性接入

### 2.1 `MainHUDSubpanels` ([main_hud_subpanels.gd](../../../../frontend/views/main_hud/main_hud_subpanels.gd))

1. **移除直接后端分发器调用**:
   - 删除或停止对 `UnifiedProtocolDispatcher` 的直接裸调用（同步确保前端视图不残留绕过边界层的通道）。
   - `on_menu_exit_to_gateway_pressed(host_view)`: 读取活跃 `account_id` / `session_token`（若空则由 `RealEscMenuService` 从 `WorldSessionRuntimeService` 补齐或按 Mock 服务约定执行）后调用 `ServiceLocator.get_instance().esc_menu().exit_to_gateway_async(account_id, token, false, callback)`；成功回调关闭菜单并触发 `NavManager.get_instance().pop_to_root("world_gateway", ...)` 返回网关并透传当前账号/令牌会话；失败展示本地化 Toast 提示。
   - `on_menu_quit_game_pressed(host_view)`: 调用 `ServiceLocator.get_instance().esc_menu().quit_game_async(account_id, token, {"save_before_quit": true}, callback)`，成功回调完成优雅停机或场景树安全退出。

### 2.2 `WorldGatewayView` Tab 同步与联机 Verified 入世链路

1. **页签切换联动状态机 ([world_gateway_view.gd](../../../../frontend/views/world_gateway/world_gateway_view.gd) & [world_gateway_tabs.gd](../../../../frontend/views/world_gateway/world_gateway_tabs.gd))**:
   - 在 `WorldGatewayView._connect_signals()` 连接 `mode_tab_container.tab_changed`，并在切换至 Single Player (index 0) / Multiplayer (index 1) 时幂等触发对应 `switch_gateway_mode(target_mode)`，保持 UI 页签与后端状态机 `context.selected_mode` 严密一致。
2. **联机摘要验签后可点击入世 (`VerifyRealmBtn` / 新增或复用进入触发)**:
   - 在 [world_gateway_realm_session_helper.gd](../../../../frontend/views/world_gateway/world_gateway_realm_session_helper.gd) 中补充完整回调链路：玩家选定远端界域服务器并点击 `VerifyRealmBtn` 验证远端清单与本地 SHA-256 通过 (`allowed == true`) 后，UI 更新认证通过状态并在玩家确认或一键“连接并进入界域”操作时经 `select_mode(MULTIPLAYER, ...)` + 角色状态分流跳转 `"character_creation"`（无联机角色）或调用 `enter_world_async` 进入 `"prologue"` / `"main_hud"`，不再止步于静态绿字状态刷新。

---

## 三、 本地化词典、`views.json` 与官包清单核对

| 配置与资产文件 | 改动范围与规范要求 | 验证核对方式 |
| :--- | :--- | :--- |
| [zh_CN.json](../../../../config/i18n/zh_CN.json) & [en_US.json](../../../../config/i18n/en_US.json) | 补全权威创角页 `ui.cc.*`（标题、种族、出身、特质、重骰、名字输入、确认/返回网关、错误反馈）与网关/ESC 新增提示键，保证中英键值集合 100% 对等 | `TestConfigurationGuard` / 双语全量键对齐检查 |
| [views.json](../../../../config/frontend/views.json) | 补齐 `character_creation` 视图仅含展示结构标签/占位声明的 UI 字段，不越界承载数值与剧情规则；清理或保持 `fe01_account_entry` 兼容键稳定 | `TestArchitectureGuardDomain` & `TestFrontendBoundaryGuard` |
| [pack.json](../../../../mods/official_kalar/pack.json) | 核对官方底座包 `content_sha256` 与实际包目录/打包算法约定一致性（如发现磁盘与自报摘要因 Phase 130/131 调整存在偏差，同步更新并在文档说明） | `ModPackageDiscoverySolver.compute_package_content_sha256` 与 `kalar_mod.py check` |

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 3.1: 改造 `NavManager` 新增 `"character_creation"` 默认注册、更新全链路由表并落地 `_screen_param_stack` 参数压栈/出栈保真机制。
- [x] Step 3.2: 收口 `MainHUDSubpanels` 的 ESC 返回网关与退出游戏逻辑至 `ServiceLocator.get_instance().esc_menu()`，移除直调 `UnifiedProtocolDispatcher`。
- [x] Step 3.3: 连接 `WorldGatewayView` 中 `ModeTabContainer.tab_changed` 同步切换网关模式，并打通 `VerifyRealmBtn` 验签成功后的入世/创角路由。
- [x] Step 3.4: 补全 `config/i18n/zh_CN.json`、`config/i18n/en_US.json` 与 `config/frontend/views.json` 节点及本地化键值对，并核对 `mods/official_kalar/pack.json` 摘要一致。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-P131-0301** | `NavManager` 栈参数无损回溯 | `push_screen("world_gateway", params)` -> `push_screen("mod_workbench", {})` -> `pop_screen()` | 出栈回到 `world_gateway` 后新实例完整保留原始 `account_id` 与 `token` 上下文 |
| **DOD-P131-0302** | ESC 返回网关与停机协议鉴权收口 | 在 `real` 模式下经 `MainHUDSubpanels` 触发退出网关与退出游戏 | 不再产生 `ERR_UNAUTHORIZED`；`ServiceLocator.esc_menu()` 正常落盘、清理世界会话并返回网关/停机 |
| **DOD-P131-0303** | 双语词典与配置门禁 100% 绿牌 | 运行 `TestConfigurationGuard` 与 `WebGames/scripts/ps1/audit-all.ps1` | 中英 i18n 零缺失键，JSON 语法、路径引用及配置语义白名单守卫零违规 |
