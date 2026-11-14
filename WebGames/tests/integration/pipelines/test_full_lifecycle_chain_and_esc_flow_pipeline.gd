# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_full_lifecycle_chain_and_esc_flow_pipeline.gd
# 架构定位: Integration Test Pipeline / Acceptance Harness
# 跨域依赖: 上游: TestRegistry | 下游: account, world_gateway, character_creation, world_state, lifecycle, frontend
# 职责说明: 全链路生命周期与ESC菜单后端双分流无头集成测试流水线
# 设计依据: 业务域第一性原理与全链路闭环架构契约
# ==============================================================================

class_name TestFullLifecycleChainAndEscFlowPipeline
extends TestCase

const AccountRegistrationDTO = preload("res://backend/domains/account/dto/account_registration_dto.gd")
const AuthService = preload("res://backend/domains/account/auth_service.gd")
const ClientSecretVault = preload("res://backend/infrastructure/client_secret_vault.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const AntiBridgeGuard = preload("res://backend/domains/world_gateway/anti_bridge_guard.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const UnifiedProtocolDispatcher = preload("res://backend/domains/world_state/services/unified_protocol_dispatcher.gd")
const EscMenuBackendService = preload("res://backend/domains/world_state/services/esc_menu_backend_service.gd")
const HudEventBridge = preload("res://frontend/systems/hud_event_bridge.gd")
const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/game_lifecycle_model.gd")
const GameLifecycleService = preload("res://backend/domains/lifecycle/game_lifecycle_service.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const ServiceLocator = preload("res://frontend/domain_boundary/service_locator.gd")
const AccountEntryView = preload("res://frontend/views/account_entry/account_entry_view.gd")
const CutsceneHookRegistry = preload("res://backend/infrastructure/media/cutscene_hook_registry.gd")
const PrologueHandoffDTO = preload("res://backend/domains/character_creation/dto/prologue_handoff_dto.gd")
const MainHUDView = preload("res://frontend/views/main_hud/main_hud_view.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	_reset_env()
	results.append(test_tc_flc_01_account_registration_and_guest_creation())
	results.append(test_tc_flc_02_gateway_selection_and_mode_readiness())
	results.append(test_tc_flc_03_character_creation_and_slot_binding())
	results.append(test_tc_flc_04_prologue_narrative_and_cutscene_hook())
	results.append(test_tc_flc_05_hud_authoritative_snapshot_and_event_bridge())
	results.append(test_tc_flc_06_esc_menu_readiness_and_auto_save())
	results.append(test_tc_flc_07_esc_exit_to_archive_and_memory_scrubbing())
	results.append(test_tc_flc_08_gateway_switching_and_anti_bridge_isolation())
	results.append(test_tc_flc_09_account_logout_and_secret_vault_clearing())
	results.append(test_tc_flc_10_account_landing_view_state_reset())
	results.append(test_tc_flc_11_game_exit_graceful_shutdown_pipeline())
	_reset_env()
	return TestCase.pack_results("全链路生命周期与ESC菜单后端双分流无头集成测试流水线", results)

static func _reset_env() -> void:
	SaveDataAccessLayer.reset_for_tests()
	GameLifecycleManager.reset_for_test()
	HumanControlLeaseManager.reset_for_tests()
	UnifiedProtocolFactory.reset_for_tests()
	HudEventBridge.reset_for_tests()
	UnifiedProtocolDispatcher.reset_custom_handlers_for_tests()
	ServiceLocator.reset()

## -----------------------------------------------------------------------------
## TC-FLC-01: 注册账号与生成游客速通凭证
## -----------------------------------------------------------------------------
static func test_tc_flc_01_account_registration_and_guest_creation() -> Dictionary:
	var reg_req := AccountRegistrationDTO.Request.new()
	reg_req.username = "test_adventurer"
	reg_req.password_plain = "kalar_secret_pwd_99"
	reg_req.device_fingerprint = "FP_FLC_TEST_01"

	var reg_resp := AuthService.register_account(reg_req)
	var reg_ok: bool = reg_resp.success and not reg_resp.account_id.is_empty()

	var guest_rng := DeterministicRNG.new(12345)
	var guest_acc := AuthService.create_guest_account("FP_GUEST_01", guest_rng)
	var guest_ok: bool = guest_acc.is_guest_mode and not guest_acc.account_id.is_empty()
	var hash_ok: bool = not AuthService.hash_password("test_pass").is_empty()

	var passed: bool = reg_ok and guest_ok and hash_ok
	return make_result("TC-FLC-01: 注册账号与生成游客速通凭证", passed, {
		"reg_account_id": reg_resp.account_id,
		"guest_account_id": guest_acc.account_id
	})

## -----------------------------------------------------------------------------
## TC-FLC-02: 进入世界网关，选定单机模式与初始世界
## -----------------------------------------------------------------------------
static func test_tc_flc_02_gateway_selection_and_mode_readiness() -> Dictionary:
	var gw := WorldGatewayFSM.new("ACC_FLC_GW_01")
	var enter_res: Dictionary = gw.enter_gateway()
	var enter_ok: bool = bool(enter_res.get("success", false))

	var probe_res: Dictionary = enter_res.get("probe_reports", {})
	var probe_ok: bool = not probe_res.is_empty()

	var select_res: Dictionary = gw.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
	var select_ok: bool = bool(select_res.get("success", false))
	var phase_ok: bool = (gw.context.current_phase == WorldGatewayModel.GatewayPhase.CHARACTER_PENDING)

	ServiceLocator.set_active_gateway(gw)
	var locator_ok: bool = (ServiceLocator.get_active_gateway() == gw)

	var passed: bool = enter_ok and probe_ok and select_ok and phase_ok and locator_ok
	return make_result("TC-FLC-02: 进入世界网关选定单机模式与初始世界", passed, {
		"phase": gw.context.current_phase
	})

## -----------------------------------------------------------------------------
## TC-FLC-03: 创角强类型参数收敛与槽位绑定
## -----------------------------------------------------------------------------
static func test_tc_flc_03_character_creation_and_slot_binding() -> Dictionary:
	var gw: WorldGatewayFSM = ServiceLocator.get_active_gateway() as WorldGatewayFSM
	if gw == null:
		gw = WorldGatewayFSM.new("ACC_FLC_GW_01")
		gw.enter_gateway()
		gw.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
		ServiceLocator.set_active_gateway(gw)

	var attach_res := gw.attach_ready_character("CHAR_HERO_VALAN_01")
	var attach_ok: bool = bool(attach_res.get("success", false))
	var permitted_ok: bool = (gw.context.current_phase == WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED)

	var enter_world_res := gw.enter_world()
	var enter_world_ok: bool = bool(enter_world_res.get("success", false))
	var in_world_ok: bool = (gw.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD)

	var passed: bool = attach_ok and permitted_ok and enter_world_ok and in_world_ok
	return make_result("TC-FLC-03: 创角强类型参数收敛与槽位绑定", passed, {
		"phase": gw.context.current_phase,
		"char_id": gw.context.active_character_id
	})

## -----------------------------------------------------------------------------
## TC-FLC-04: 序章推进、媒体 Hook 触发与 PrologueHandoffDTO 大地图交接
## -----------------------------------------------------------------------------
static func test_tc_flc_04_prologue_narrative_and_cutscene_hook() -> Dictionary:
	var hook_registry := CutsceneHookRegistry.new()
	var hook_data := {
		"cutscene_id": "CS_VALAN_AWAKEN",
		"trigger_type": CutsceneHookRegistry.TRIGGER_NARRATIVE_NODE_PRE,
		"target_filter": {"dag_id": "DAG_PROLOGUE", "node_id": "NODE_VALAN_AWAKEN"}
	}
	hook_registry.register_hook(hook_data)
	var matched_req := hook_registry.match_narrative_hook("DAG_PROLOGUE", "NODE_VALAN_AWAKEN", true)
	var query_ok: bool = (matched_req != null and matched_req.cutscene_id == "CS_VALAN_AWAKEN")

	var handoff := PrologueHandoffDTO.new()
	handoff.account_id = "ACC_FLC_GW_01"
	handoff.character_id = "CHAR_HERO_VALAN_01"
	handoff.character_name = "Valan Hero"
	handoff.assigned_start_location_id = "VALAN_CAPITAL"

	var dto := handoff.to_dto()
	var restored := PrologueHandoffDTO.from_dto(dto)
	var handoff_ok: bool = (restored.character_id == handoff.character_id) and (restored.assigned_start_location_id == handoff.assigned_start_location_id)

	var passed: bool = query_ok and handoff_ok
	return make_result("TC-FLC-04: 序章推进媒体Hook触发与PrologueHandoffDTO交接", passed, {
		"matched_ok": query_ok,
		"location_id": restored.assigned_start_location_id
	})

## -----------------------------------------------------------------------------
## TC-FLC-05: 主页 HUD 首帧拉取与总线广播消费验证
## -----------------------------------------------------------------------------
static func test_tc_flc_05_hud_authoritative_snapshot_and_event_bridge() -> Dictionary:
	var snap := AuthoritativeHudSyncService.get_authoritative_snapshot({"character_id": "CHAR_HERO_VALAN_01", "account_id": "ACC_FLC_GW_01", "slot_id": "SLOT_01"})
	var snap_ok: bool = (snap != null and snap.character_id == "CHAR_HERO_VALAN_01")

	var bridge := HudEventBridge.get_instance()
	var hud_view := MainHUDView.new()
	bridge.attach_hud(hud_view)
	var attach_ok: bool = bridge.is_attached()

	bridge.detach_hud()
	var detach_ok: bool = not bridge.is_attached()
	hud_view.free()

	var passed: bool = snap_ok and attach_ok and detach_ok
	return make_result("TC-FLC-05: 主页HUD首帧拉取与总线广播消费验证", passed, {
		"character_id": snap.character_id if snap != null else ""
	})

## -----------------------------------------------------------------------------
## TC-FLC-06: 前端 ESC 菜单后端显示服务逻辑（就绪查询与自动存档刷盘）
## -----------------------------------------------------------------------------
static func test_tc_flc_06_esc_menu_readiness_and_auto_save() -> Dictionary:
	var req_readiness := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_QUERY_READINESS", {}
	)
	var resp_readiness := EscMenuBackendService.handle_esc_action(req_readiness, null)
	var readiness_ok: bool = resp_readiness.success

	var req_save := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_SAVE_GAME", {"slot_id": "SLOT_01"}
	)
	var resp_save := EscMenuBackendService.handle_esc_action(req_save, null)
	var save_ok: bool = resp_save.success

	var passed: bool = readiness_ok and save_ok
	return make_result("TC-FLC-06: ESC菜单后端服务就绪查询与自动存档刷盘", passed, {
		"readiness_success": readiness_ok,
		"save_success": save_ok
	})

## -----------------------------------------------------------------------------
## TC-FLC-07: ESC 退出到世界档案（自动存盘并洗脱网关内存）
## -----------------------------------------------------------------------------
static func test_tc_flc_07_esc_exit_to_archive_and_memory_scrubbing() -> Dictionary:
	var gw: WorldGatewayFSM = ServiceLocator.get_active_gateway() as WorldGatewayFSM
	if gw == null:
		gw = WorldGatewayFSM.new("ACC_FLC_GW_01")
		gw.enter_gateway()
		gw.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
		gw.attach_ready_character("CHAR_HERO_VALAN_01")
		gw.enter_world()
		ServiceLocator.set_active_gateway(gw)

	var in_world_before: bool = (gw.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD)

	var req_exit := UnifiedProtocolFactory.create_human_request(
		"world_gateway", "ESC_EXIT_TO_GATEWAY", {"auto_save": true}
	)
	var resp_exit := EscMenuBackendService.handle_esc_action(req_exit, gw)
	var exit_ok: bool = resp_exit.success

	var phase_scrubbed: bool = (gw.context.current_phase == WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED)
	var mode_scrubbed: bool = (gw.context.selected_mode == WorldGatewayModel.GameMode.UNSELECTED)
	var char_scrubbed: bool = gw.context.active_character_id.is_empty()

	var passed: bool = in_world_before and exit_ok and phase_scrubbed and mode_scrubbed and char_scrubbed
	return make_result("TC-FLC-07: ESC退出到世界档案自动存盘并洗脱网关内存", passed, {
		"phase_after": gw.context.current_phase,
		"mode_after": gw.context.selected_mode
	})

## -----------------------------------------------------------------------------
## TC-FLC-08: 切换运行网关（模式隔离与反投毒隔离验证）
## -----------------------------------------------------------------------------
static func test_tc_flc_08_gateway_switching_and_anti_bridge_isolation() -> Dictionary:
	var gw: WorldGatewayFSM = ServiceLocator.get_active_gateway() as WorldGatewayFSM
	if gw == null:
		gw = WorldGatewayFSM.new("ACC_FLC_GW_01")
		gw.enter_gateway()
		ServiceLocator.set_active_gateway(gw)

	var reselect_res := gw.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
	var reselect_ok: bool = bool(reselect_res.get("success", false))

	var hot_swap_res := gw.select_mode(WorldGatewayModel.GameMode.MULTIPLAYER, {}, [])
	var hot_swap_blocked: bool = not bool(hot_swap_res.get("success", false))

	gw.exit_to_gateway()
	var final_scrub_ok: bool = (gw.context.current_phase == WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED)

	var passed: bool = reselect_ok and hot_swap_blocked and final_scrub_ok
	return make_result("TC-FLC-08: 切换运行网关模式隔离与反投毒隔离验证", passed, {
		"reselect_ok": reselect_ok,
		"hot_swap_blocked": hot_swap_blocked
	})

## -----------------------------------------------------------------------------
## TC-FLC-09: 退出账号（会话注销与机密凭证双向擦除）
## -----------------------------------------------------------------------------
static func test_tc_flc_09_account_logout_and_secret_vault_clearing() -> Dictionary:
	var raw_token := "TOKEN_FLC_SESSION_ALPHA_99"
	var masked := ClientSecretVault.mask_in_memory_token(raw_token)
	var mask_ok: bool = not masked.is_empty()
	var revealed := ClientSecretVault.reveal_in_memory_token(masked)
	var reveal_ok: bool = (revealed == raw_token)

	var reg_req := AccountRegistrationDTO.Request.new()
	reg_req.username = "logout_user"
	reg_req.password_plain = "pwd_logout_123"
	AuthService.register_account(reg_req)

	var account := AccountRepository.get_instance().find_by_username("logout_user")
	var auth_res: Dictionary = AuthService.authenticate_local("logout_user", "pwd_logout_123", account)
	var login_token: String = str(auth_res.get("token", ""))
	var token_active: bool = AuthService.validate_token(login_token).get("success", false)

	var revoke_res: bool = AuthService.revoke_token(login_token)
	var token_revoked: bool = not AuthService.validate_token(login_token).get("success", false)

	var passed: bool = mask_ok and reveal_ok and token_active and revoke_res and token_revoked
	return make_result("TC-FLC-09: 退出账号会话注销与机密凭证双向擦除", passed, {
		"token_revoked": token_revoked
	})

## -----------------------------------------------------------------------------
## TC-FLC-10: 账号首页（表单状态复位与网关上下文清空）
## -----------------------------------------------------------------------------
static func test_tc_flc_10_account_landing_view_state_reset() -> Dictionary:
	var view := AccountEntryView.new()
	var login_res := view.submit_login("landing_hero", "pwd123")
	var login_ok: bool = bool(login_res.get("success", false))

	view.select_server("LOCAL_OFFLINE")
	var has_gw_before: bool = (ServiceLocator.get_active_gateway() != null)

	view.selected_character_slot = "SLOT_01"
	view._on_char_enter_pressed()
	var active_gw = ServiceLocator.get_active_gateway()
	var in_world_ok: bool = (active_gw != null and active_gw.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD)

	var logout_res := view.logout_account()
	var logout_ok: bool = bool(logout_res.get("success", false))

	var state_reset: bool = (view.current_state == AccountEntryView.EntryState.LOGIN)
	var id_reset: bool = view.current_account_id.is_empty()
	var gw_cleared: bool = (ServiceLocator.get_active_gateway() == null)

	view.free()

	var passed: bool = login_ok and has_gw_before and in_world_ok and logout_ok and state_reset and id_reset and gw_cleared
	return make_result("TC-FLC-10: 账号首页表单状态复位与网关上下文清空", passed, {
		"state_reset": state_reset,
		"in_world_ok": in_world_ok,
		"gw_cleared": gw_cleared
	})

## -----------------------------------------------------------------------------
## TC-FLC-11: 退出游戏（五阶段优雅停机管线闭环）
## -----------------------------------------------------------------------------
static func test_tc_flc_11_game_exit_graceful_shutdown_pipeline() -> Dictionary:
	var shut_req := GameShutdownDTO.Request.new()
	shut_req.session_token = "TOKEN_FLC_SHUTDOWN_01"
	shut_req.account_id = "ACC_FLC_SHUTDOWN_01"
	shut_req.exit_reason = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	shut_req.target_save_slot = "SLOT_01"

	var shut_resp := GameLifecycleService.execute_graceful_shutdown(shut_req)
	var resp_valid: bool = (shut_resp != null)
	var resp_ok: bool = resp_valid and shut_resp.is_success

	var passed: bool = resp_ok
	return make_result("TC-FLC-11: 退出游戏五阶段优雅停机管线闭环", passed, {
		"is_success": shut_resp.is_success if resp_valid else false
	})
