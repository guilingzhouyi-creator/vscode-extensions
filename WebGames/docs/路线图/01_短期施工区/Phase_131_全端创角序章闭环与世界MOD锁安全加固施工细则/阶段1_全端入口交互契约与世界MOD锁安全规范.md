# 施工细则：全端创角序章闭环与世界MOD锁安全加固 —— 阶段1：全端入口交互契约与世界MOD锁安全规范

> 施工开始日期: 2026-11-15
> 状态: 已验收 (Phase 131 Completed)

> [!NOTE]
> **【施工目标】** 本阶段锚定 WebGames P0 级别“全端交互闭环与世界 MOD 锁安全加固”改造的总体架构契约与不变量边界：彻底打通 **账号入口 (`AccountEntryView`) → 世界网关 (`WorldGatewayView`) → 权威创角 (`CharacterCreationView`) → 统一 DAG 序章 (`PrologueView`) → 主界面 (`MainHUDView`) → ESC 安全退出/停机** 全链路真实 UI 与协议流，同时堵死世界 MOD 锁空摘要落盘、安全降级绕过摘要篡改校验、联机/退出状态机清污残留与导航上下文丢失等安全漏洞。

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针

- 路线图与工程宪法: [AGENTS.md](../../../../../AGENTS.md) · [路线图总索引.md](../../路线图总索引.md) · [Phase_130 阶段1规范](../Phase_130_官方与三方MOD全插件化架构及去内置剧情与全端入口重构施工细则/阶段1_插件化官方MOD契约架构与引擎边界重构规范.md)
- 前端导航与视图边界: [nav_manager.gd](../../../../frontend/navigation/nav_manager.gd) · [account_entry_view.gd](../../../../frontend/views/account_entry/account_entry_view.gd) · [account_entry_tabs.gd](../../../../frontend/views/account_entry/account_entry_tabs.gd) · [world_gateway_view.gd](../../../../frontend/views/world_gateway/world_gateway_view.gd) · [world_gateway_tabs.gd](../../../../frontend/views/world_gateway/world_gateway_tabs.gd) · [world_gateway_realm_session_helper.gd](../../../../frontend/views/world_gateway/world_gateway_realm_session_helper.gd) · [main_hud_subpanels.gd](../../../../frontend/views/main_hud/main_hud_subpanels.gd)
- 领域边界适配器: [i_auth_service.gd](../../../../frontend/domain_boundary/interfaces/i_auth_service.gd) · [real_auth_service.gd](../../../../frontend/domain_boundary/services/real_auth_service.gd) · [mock_auth_service.gd](../../../../frontend/domain_boundary/mocks/mock_auth_service.gd) · [real_character_service.gd](../../../../frontend/domain_boundary/services/real_character_service.gd) · [real_world_service.gd](../../../../frontend/domain_boundary/services/real_world_service.gd) · [real_esc_menu_service.gd](../../../../frontend/domain_boundary/services/real_esc_menu_service.gd) · [real_lifecycle_service.gd](../../../../frontend/domain_boundary/services/real_lifecycle_service.gd)
- 后端状态机与锁守卫: [account_protocol_handler.gd](../../../../backend/domains/account/services/account_protocol_handler.gd) · [world_character_creation_orchestrator.gd](../../../../backend/domains/character_creation/world_character_creation_orchestrator.gd) · [world_gateway_fsm.gd](../../../../backend/domains/world_gateway/world_gateway_fsm.gd) · [world_gateway_realm_lock_helper.gd](../../../../backend/domains/world_gateway/world_gateway_realm_lock_helper.gd) · [world_gateway_mod_helper.gd](../../../../backend/domains/world_gateway/world_gateway_mod_helper.gd) · [save_load_routing_solver.gd](../../../../backend/domains/world_gateway/save_load_routing_solver.gd) · [anti_bridge_guard.gd](../../../../backend/domains/world_gateway/anti_bridge_guard.gd) · [world_mod_affinity_manager.gd](../../../../backend/domains/narrative_orchestration/world_mod_affinity_manager.gd) · [mod_package_discovery_solver.gd](../../../../backend/domains/narrative_orchestration/mod_package_discovery_solver.gd)

### 1.2 核心不变量约束断言

1. **全端单向真实鉴权与流程闭环不变量**:
   - 前端任意入口（登录、自动登录注册、选服、创角、进入世界、ESC 退出/停机）严禁伪造凭据字符串（废除 `"TOKEN_" + account_id`）或绕过 `ServiceLocator` 直接向 `UnifiedProtocolDispatcher` 发送空令牌 envelope（如 `MainHUDSubpanels` 原先直发空账户/空令牌 `ESC_EXIT_TO_GATEWAY` / `ESC_QUIT_GAME`）。
   - `AccountEntryTabs` 废除隐式 `select_mode(1, {}, [])` 静默切世回退；交互场景内登录/自动登录成功后进入 `world_gateway`，同时保留 `AccountEntryView.submit_login()` 在离线脱离场景树单元测试下的既有状态契约以保障存量断言稳定。
2. **世界网关 → 权威创角 → 序章 → 主界面严格状态跃迁不变量**:
   - 选择单机存档后，若目标世界/槽位尚未绑定已就绪角色（`CHARACTER_PENDING` / 无可用角色或 `requires_character_creation`），`WorldGatewayView` 必须路由至已注册的独立 `character_creation` 权威创角屏（禁止直调 `enter_world` 触发 `DIRECT_WORLD_BYPASS_BLOCKED`）；若已绑定就绪角色，则自动挂载并依据 `prologue_required` 决定跃迁 `prologue` 或 `main_hud`。
   - 新增全端创角视图 `res://frontend/views/character_creation/` 下所有 `.gd` 脚本须统一 `extends BaseScreen`，严格通过 `ICharacterService` 消费受控 schema、轮盘预览与权威落盘，零直连后端类、零硬编码 `Color` 字面量、零旧契约退化。
3. **世界 MOD 锁完整摘要与篡改零容忍不变量 (Fail-Closed)**:
   - `world_mod_lock.json` 持久化时，所有锁条目必须携带经盘面与发现器解析/计算的真实 `version` 与 64 位小写 HEX `content_sha256`（禁止因 `active_mods` 或 `enabled_pack_ids` 为纯 `String` 列表而落盘空摘要 `""`）。
   - `digest_drifts`（摘要篡改/内容漂移）与关键依赖冲突属于安全边界违例：无论是重进单机世界还是读档二次加载（`SaveLoadRoutingSolver`），即使上层传入 `allow_safe_degrade = true`，也必须严格 Fail-Closed 拒载并返回结构化漂移诊断；安全降级（`MOD_DETACHED`）仅允许用于“基础底座完整且摘要一致，仅非核心可选扩展包缺失”的场景。
   - 若单机世界已存在 `world_mod_lock.json`，即使 `select_mode` 先前因自动发现填充了 `adapted_mod_manifest`，`WorldGatewayRealmLockHelper` 仍必须核对已挂载栈与锁定栈的一致性，出现偏差时强制按 `locked_pack_ids` 重排重挂或阻断。
4. **联机隔离、错误回滚与导航栈参数保真不变量**:
   - `switch_gateway_mode(MULTIPLAYER)` 时：若请求显式携带非官方 `custom_mods`，严格拦截 `SECURITY_ERR_MULTIPLAYER_MOD_POISONING`；若仅为洁净模式切换且残留单机本地 MOD，须先调用 `purge_and_fallback_to_vanilla()` 并清零选包状态再推进状态机。`select_mode(MULTIPLAYER)` 继续拦截调用方预先挂载的第三方毒化 `active_mods`（守住 `TC-MSS-02` 契约）。
   - `verify_and_reconcile_realm_manifest()` 验证失败与 `exit_to_gateway()` 退回时，须完整清零 `_selected_mod_pack_ids`、`_has_explicit_mod_selection`、`_realm_manifest` 与 FSM/运行时叠层，杜绝跨会话越权污染。
   - `NavManager.pop_screen()` 必须随栈帧保存与恢复上一屏的 `navigation_parameters`，保证从 `mod_workbench` 或 `character_creation` 返回 `world_gateway` 时 `account_id`/`token`/`world_id` 会话不丢失。

### 1.3 架构与交互防漂移最高指示

- **零新假门面、零存量测试破坏**: 所有改动必须围绕真实玩家可点击操作与安全守卫闭环展开，禁止删减或削弱既有 Guard/Integration 断言，亦禁止在前端或测试中通过“跳过创角/伪造 token/忽略 `digest_drifts`”掩盖漏洞。
- **5D ELOC 模块化纪律**: 本次改动涉及的前后端视图、网关及锁文件模块须严格遵守工作区 5D 复杂度门禁（单文件建议控制在 `<= 120` ELOC，高聚合协调文件不超过 `180` ELOC，圈复杂度 `CC <= 15`，嵌套深度 `<= 4`）；超出预算时必须在阶段 2/3 中拆分为内聚助算器。

---

## 一、 现状全链缺陷映射与契约重塑总表

| 缺陷编号 | 所属子链 | 现行代码真实断点 | Phase 131 目标契约 |
| :--- | :--- | :--- | :--- |
| **DEF-P0-01** | 登录与注册鉴权 | [account_entry_tabs.gd](../../../../frontend/views/account_entry/account_entry_tabs.gd) `register_backend_flow` 缺少 `auto_login: true`，且自造 `"TOKEN_" + account_id`；`IAuthService.register_async` 无 `auto_login` 参数 | `IAuthService/RealAuthService/MockAuthService` 支持可选 `auto_login: bool = false`；注册即用后端真实签发的 `session_token` 与 `account_id` 激活网关会话 |
| **DEF-P0-02** | 账号入口场景与旧通道 | [account_entry_view.tscn](../../../../frontend/views/account_entry/account_entry_view.tscn) 绑定 4 个不存在方法 (`_on_char_slot_0..2_pressed`, `_on_char_reroll_pressed`)；`advance_gateway_to_world()` 仍残存 `select_mode(1, {}, [])` | 补齐或收口槽位/重骰回调消除断联；废除 `select_mode(1, {}, [])`，真实场景树登录后直入 `world_gateway`，离线单元测试保持 `EntryState` 兼容 |
| **DEF-P0-03** | 网关创角→序章断链 | [world_gateway_view.gd](../../../../frontend/views/world_gateway/world_gateway_view.gd) 缺少 `CHARACTER_PENDING` 跳转独立创角视图链路；[nav_manager.gd](../../../../frontend/navigation/nav_manager.gd) 将 `"character_creation"` 占位指回 `"account_entry"` | 注册真实 `character_creation` 屏（`res://frontend/views/character_creation/character_creation_view.tscn`）；网关依 `character_status` / `requires_character_creation` 自动分流至创角屏或直入序章/HUD |
| **DEF-P0-04** | ESC / 停机协议绕过 | [main_hud_subpanels.gd](../../../../frontend/views/main_hud/main_hud_subpanels.gd) 直调 `UnifiedProtocolDispatcher.dispatch_request` 传空 token；[world_gateway_realm_session_helper.gd](../../../../frontend/views/world_gateway/world_gateway_realm_session_helper.gd) 误调 `lifecycle_service.quit_game_async` | HUD ESC 面板统一经 `ServiceLocator.get_instance().esc_menu()` 调 `exit_to_gateway_async` / `quit_game_async`；网关退出统一调用 `lifecycle_service.request_graceful_shutdown_async` |
| **DEF-P0-05** | 导航栈与网关 Tab 失步 | `NavManager.pop_screen()` 以 `{}` 重建前屏丢失上下文；`ModeTabContainer` 页签切换未联动 `switch_gateway_mode`；`VerifyRealmBtn` 验证后缺少直入入口 | `_screen_stack` 并行存储 `params` 快照实现 `pop_screen()` 参数无损恢复；连接 `ModeTabContainer.tab_changed` 同步网关模式；联机验证通过后支持经授权进入或明确创建/挂载联机角色 |
| **DEF-P0-06** | 世界 MOD 锁空摘要落盘 | [world_character_creation_orchestrator.gd](../../../../backend/domains/character_creation/world_character_creation_orchestrator.gd) 将 `Array[String]` 传入 `save_world_mod_lock` 致 `content_sha256: ""`、`version: "1.0.0"` | `WorldModAffinityManager` 新增元信息补全器：结合 `ModPackageDiscoverySolver` 与目录哈希计算补全 `version` 与 `content_sha256` 后原子写入 |
| **DEF-P0-07** | 安全降级绕过摘要篡改 | [world_mod_affinity_manager.gd](../../../../backend/domains/narrative_orchestration/world_mod_affinity_manager.gd) 与 [save_load_routing_solver.gd](../../../../backend/domains/world_gateway/save_load_routing_solver.gd) 在 `digest_drifts` 非空时仍允许 `allow_safe_degrade` / 读档放行 | `not digest_drifts.is_empty()` 在重进与读档全链路无条件 Fail-Closed 阻断并返回 `MOD_ERR_REALM_DIGEST_MISMATCH` / 漂移详情 |
| **DEF-P0-08** | 自动发现覆盖世界锁与清污残留 | [world_gateway_realm_lock_helper.gd](../../../../backend/domains/world_gateway/world_gateway_realm_lock_helper.gd) 因 `adapted_mod_manifest` 非空跳过核对 `locked_ids`；`switch_gateway_mode(MULTIPLAYER)`、`exit_to_gateway()` 与失败 `verify_and_reconcile_realm_manifest()` 清污不完整 | 有锁必校验并强行收敛至 `locked_pack_ids`；切联机前清污残留本地 SP MOD（保留显式传毒拦截）；`exit_to_gateway` 与联机验签失败执行全量状态/叠层双清 |

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 1.1: 确认 `Phase_131` 四阶段细则契约边界及与 `Phase_130` 存量测试基线的零冲突兼容性。
- [x] Step 1.2: 冻结 `IAuthService.register_async(..., auto_login)`、`"character_creation"` 导航路由表与 `NavManager` 参数栈契约。
- [x] Step 1.3: 冻结 `world_mod_lock.json` 元数据摘要填充、`digest_drifts` 无条件 Fail-Closed 及网关模式切换清污状态转移表。
- [x] Step 1.4: 等待用户 `"批准"` 后进入 Round 2 源码实施。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-P131-0101** | 阶段 1 文档结构与指针完整性 | 运行 `pwsh -File WebGames/scripts/ps1/audit-docs.ps1` | 返回退出码 `0`，零 `PHASE-*` 命名/链接/代码块违规告警 |
| **DOD-P131-0102** | P0 全链缺陷与契约无遗漏映射 | 核对 DEF-P0-01 至 DEF-P0-08 与 Phase 131 目标矩阵 | 前端 5 大断点 + 后端锁安全 3 大漏洞均有明确契约与防回退红线 |
| **DOD-P131-0103** | Round 1 零源码修改纪律 | 执行 `git status -s` | 仅存在 `Phase_131` 细则文档与 `路线图总索引.md` 变更，零 `.gd`/`.tscn`/`.json` 代码改动 |
