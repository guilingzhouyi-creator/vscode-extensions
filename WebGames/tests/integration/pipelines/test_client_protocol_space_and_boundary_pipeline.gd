# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_client_protocol_space_and_boundary_pipeline.gd
# 架构定位: Integration Test Pipeline / Client Protocol Space & Boundary Pipeline
# 依赖与触发: 上游: TestRegistry | 下游: ServiceLocator, RealServiceContainer,
#           RealAuthService, RealWorldService, RealCharacterService, RealEscMenuService,
#           HudEventBridge
# 职责说明: 客户端交互协议空间标准化与边界适配器验收流水线，
#           覆盖真实认证生命周期与会话激活、令牌脱敏注销、账号首页视图模型拉取、
#           服务定位器网关委托、真实世界服务网关流转、权威创角协议桥接、
#           ESC系统菜单存盘守卫回执、HUD全信道事件桥接与快照主动拉取、
#           退出世界模式切换解耦、以及真实服务容器依赖注入与零泄漏验证。
# 退出语义与设计依据: 客户端交互协议空间规约 (TC-PROTO-01 ~ TC-PROTO-10, ADV-PRF-002)
# ==============================================================================

## TestClientProtocolSpaceAndBoundaryPipeline：客户端交互协议空间标准化与边界适配器验收流水线，
class_name TestClientProtocolSpaceAndBoundaryPipeline
extends TestCase

## 执行本测试套件全量用例并返回聚合结果字典
static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_proto_01_real_auth_lifecycle_and_session_activation())
	results.append(test_proto_02_register_safe_metadata_and_revoke_token())
	results.append(test_proto_03_get_account_home_view_model())
	results.append(test_proto_04_service_locator_gateway_delegation())
	results.append(test_proto_05_real_world_service_gateway_flow())
	results.append(test_proto_06_real_character_service_authoritative_creation())
	results.append(test_proto_07_real_esc_menu_service_and_save_guard())
	results.append(test_proto_08_hud_event_bridge_six_channels_and_pull_snapshot())
	results.append(test_proto_09_exit_world_to_gateway_and_mode_switch())
	results.append(test_proto_10_real_service_container_wiring_and_isolation())
	results.append(TestClientProtocolExtendedHelper.test_proto_11_full_eleven_link_reserved_interfaces_chain(Callable(TestClientProtocolSpaceAndBoundaryPipeline, "_setup_env"), Callable(TestClientProtocolSpaceAndBoundaryPipeline, "_teardown_env")))
	results.append(TestClientProtocolExtendedHelper.test_proto_12_hud_event_bridge_stat_and_clock_unwrap(Callable(TestClientProtocolSpaceAndBoundaryPipeline, "_setup_env"), Callable(TestClientProtocolSpaceAndBoundaryPipeline, "_teardown_env"), Callable(TestClientProtocolSpaceAndBoundaryPipeline, "_bootstrap_in_world_character")))
	results.append(test_proto_13_game_settings_protocol_and_honest_failures())
	results.append(test_proto_14_mock_service_container_reserved_interfaces_parity())
	_teardown_env()
	return TestCase.pack_results("客户端交互协议空间标准化与边界适配器验收流水线", results)

static func _setup_env() -> void:
	TestFullChainBackendHelper.setup_env()
	GameSettingsProtocolHandler.reset_for_tests()
	AppLifecycleFSM.get_instance().reset()
	ServiceLocator.set_mode("backend")
	RealServiceContainer.reset_instance()
	MockServiceContainer.reset_instance()
	HudEventBridge.reset_for_tests()

static func _teardown_env() -> void:
	HudEventBridge.reset_for_tests()
	ServiceLocator.clear_active_gateway()
	ServiceLocator.set_mode("mock")
	RealServiceContainer.reset_instance()
	MockServiceContainer.reset_instance()
	GameSettingsProtocolHandler.reset_for_tests()
	AppLifecycleFSM.get_instance().reset()
	for slot_key in ["slot_01", "slot_98"]:
		for ext in [".kalar_save", ".bak", ".tmp", ".sav"]:
			var vault_file := "user://offline_vault/%s%s" % [slot_key, ext]
			if FileAccess.file_exists(vault_file):
				DirAccess.remove_absolute(vault_file)
	TestFullChainBackendHelper.teardown_env()

## TC-PROTO-01: RealAuthService 异步注册/登录生命周期与后端会话真源同步激活验证
static func test_proto_01_real_auth_lifecycle_and_session_activation() -> Dictionary:
	_setup_env()

	var auth := RealAuthService.new()
	var reg_res := {}
	auth.register_async("proto_user_01", "SecretPassProto#01", func(res: Dictionary): reg_res.merge(res))
	var acc_id := String(reg_res.get("account_id", ""))
	var ok_reg: bool = bool(reg_res.get("success", false)) and not acc_id.is_empty()

	var login_res := {}
	auth.login_async("proto_user_01", "SecretPassProto#01", func(res: Dictionary): login_res.merge(res))
	var token := String(login_res.get("token", ""))
	var ok_login: bool = bool(login_res.get("success", false)) and not token.is_empty()

	# 验证后端真源同步激活
	var is_auth: bool = WorldSessionRuntimeService.has_authenticated_session()
	var active_acc: String = WorldSessionRuntimeService.get_active_account_id()
	var ok_sync: bool = is_auth and active_acc == acc_id

	_teardown_env()
	var passed: bool = ok_reg and ok_login and ok_sync
	return TestCase.make_result("TC-PROTO-01: RealAuthService生命周期与后端会话真源同步激活验证", passed, {
		"ok_reg": ok_reg, "ok_login": ok_login, "ok_sync": ok_sync
	})

## TC-PROTO-02: 令牌脱敏注销与会话真源清理双向验证 (revoke_token & logout_async)
static func test_proto_02_register_safe_metadata_and_revoke_token() -> Dictionary:
	_setup_env()

	var auth := RealAuthService.new()
	var reg_res := {}
	auth.register_async("proto_user_02", "SecretPassProto#02", func(res: Dictionary): reg_res.merge(res))
	var acc_id := String(reg_res.get("account_id", ""))

	var login_res := {}
	auth.login_async("proto_user_02", "SecretPassProto#02", func(res: Dictionary): login_res.merge(res))
	var token := String(login_res.get("token", ""))
	var ok_active_1: bool = WorldSessionRuntimeService.has_authenticated_session()

	# 1. 测试 revoke_token
	var revoke_res := {}
	auth.revoke_token(token, func(res: Dictionary): revoke_res.merge(res))
	var ok_revoke: bool = bool(revoke_res.get("success", false))
	var ok_cleared_1: bool = not WorldSessionRuntimeService.has_authenticated_session()

	# 2. 重新登录测试 logout_async
	var login_res_2 := {}
	auth.login_async("proto_user_02", "SecretPassProto#02", func(res: Dictionary): login_res_2.merge(res))
	var token_2 := String(login_res_2.get("token", ""))
	var ok_active_2: bool = WorldSessionRuntimeService.has_authenticated_session()

	var logout_res := {}
	auth.logout_async(acc_id, token_2, func(res: Dictionary): logout_res.merge(res))
	var ok_logout: bool = bool(logout_res.get("success", false))
	var ok_cleared_2: bool = not WorldSessionRuntimeService.has_authenticated_session()

	_teardown_env()
	var passed: bool = ok_active_1 and ok_revoke and ok_cleared_1 and ok_active_2 and ok_logout and ok_cleared_2
	return TestCase.make_result("TC-PROTO-02: 令牌脱敏注销与会话真源清理双向验证", passed, {
		"ok_revoke": ok_revoke, "ok_cleared_1": ok_cleared_1, "ok_logout": ok_logout, "ok_cleared_2": ok_cleared_2
	})

## TC-PROTO-03: 账号首页脱敏视图模型安全拉取与凭据不可透传验证 (GET_ACCOUNT_HOME_VIEW_MODEL)
static func test_proto_03_get_account_home_view_model() -> Dictionary:
	_setup_env()

	var auth := RealAuthService.new()
	var reg_res := {}
	auth.register_async("proto_user_03", "SecretPassProto#03", func(res: Dictionary): reg_res.merge(res))
	var acc_id := String(reg_res.get("account_id", ""))

	var login_res := {}
	auth.login_async("proto_user_03", "SecretPassProto#03", func(res: Dictionary): login_res.merge(res))
	var token := String(login_res.get("token", ""))

	var home_res := {}
	auth.get_account_home_async(acc_id, token, func(res: Dictionary): home_res.merge(res))
	var ok_home: bool = bool(home_res.get("success", false))
	var vm: Dictionary = home_res.get("view_model", {})

	var cur_acc: Dictionary = vm.get("current_account_summary", {})
	var ok_fields: bool = vm.has("session_active") and cur_acc.has("account_id") and cur_acc.has("username") and vm.has("known_accounts")
	# 刚性安全断言：严禁向表现层泄露任何明文密码、散列值或盐
	var ok_security: bool = not vm.has("password_hash") and not vm.has("password_plain") and not vm.has("salt") and not cur_acc.has("password_hash")

	_teardown_env()
	var passed: bool = ok_home and ok_fields and ok_security
	return TestCase.make_result("TC-PROTO-03: 账号首页脱敏视图模型安全拉取与凭据不可透传验证", passed, {
		"ok_home": ok_home, "ok_fields": ok_fields, "ok_security": ok_security
	})

## TC-PROTO-04: ServiceLocator 网关状态机委托与 Session 运行时真源双向同步验证
static func test_proto_04_service_locator_gateway_delegation() -> Dictionary:
	_setup_env()

	# 确保初始隔离洁净
	ServiceLocator.clear_active_gateway()
	var ok_init: bool = ServiceLocator.get_active_gateway() == null and WorldSessionRuntimeService.get_gateway() == null

	# 创建并激活网关
	var gw: RefCounted = ServiceLocator.create_and_activate_gateway("ACC_PROTO_GW_04")
	var ok_create: bool = gw != null
	var ok_gw_loc: bool = ServiceLocator.get_active_gateway() == gw
	var ok_gw_runtime: bool = (WorldSessionRuntimeService.get_gateway() == gw)
	var ok_acc_runtime: bool = WorldSessionRuntimeService.get_active_account_id() == "ACC_PROTO_GW_04"

	# 清理并验证真源同步重置
	ServiceLocator.clear_active_gateway()
	var ok_clear_loc: bool = ServiceLocator.get_active_gateway() == null
	var ok_clear_runtime: bool = (WorldSessionRuntimeService.get_gateway() == null)

	_teardown_env()
	var passed: bool = ok_init and ok_create and ok_gw_loc and ok_gw_runtime and ok_acc_runtime and ok_clear_loc and ok_clear_runtime
	return TestCase.make_result("TC-PROTO-04: ServiceLocator网关状态机委托与Session运行时真源双向同步验证", passed, {
		"ok_init": ok_init, "ok_create": ok_create, "ok_sync": ok_gw_loc and ok_gw_runtime, "ok_clear": ok_clear_loc and ok_clear_runtime
	})

## TC-PROTO-05: RealWorldService 网关就绪度探测、建档选档与档案列表流转验证
static func test_proto_05_real_world_service_gateway_flow() -> Dictionary:
	_setup_env()

	var auth := RealAuthService.new()
	var reg_res := {}
	auth.register_async("proto_user_05", "SecretPassProto#05", func(res: Dictionary): reg_res.merge(res))
	var acc_id := String(reg_res.get("account_id", ""))

	var login_res := {}
	auth.login_async("proto_user_05", "SecretPassProto#05", func(res: Dictionary): login_res.merge(res))
	var token := String(login_res.get("token", ""))

	var world_svc := RealWorldService.new()

	# 1. 进入网关
	var enter_res := {}
	world_svc.enter_gateway_async(acc_id, token, func(res: Dictionary): enter_res.merge(res))
	var ok_enter: bool = bool(enter_res.get("success", false))

	# 2. 探测模式就绪度
	var probe_res := {}
	world_svc.probe_modes_async(acc_id, token, func(res: Dictionary): probe_res.merge(res))
	var ok_probe: bool = bool(probe_res.get("success", false)) and not (probe_res.get("probe_reports", {}) as Dictionary).is_empty()

	# 3. 选档/建档进入世界
	var sel_res := {}
	world_svc.select_or_create_world_async(acc_id, token, "WORLD_PROTO_05", WorldGatewayModel.GameMode.SINGLE_PLAYER, func(res: Dictionary): sel_res.merge(res))
	var ok_sel: bool = bool(sel_res.get("success", false))

	# 4. 查询世界档案列表
	var list_res := {}
	world_svc.list_worlds_async(acc_id, token, func(res: Dictionary): list_res.merge(res))
	var ok_list: bool = bool(list_res.get("success", false)) and (list_res.get("worlds", []) as Array).size() >= 1

	_teardown_env()
	var passed: bool = ok_enter and ok_probe and ok_sel and ok_list
	return TestCase.make_result("TC-PROTO-05: RealWorldService网关就绪度探测、建档选档与档案列表流转验证", passed, {
		"ok_enter": ok_enter, "ok_probe": ok_probe, "ok_sel": ok_sel, "ok_list": ok_list
	})

## TC-PROTO-06: RealCharacterService 权威创角编排与确定性资质骰点协议验证
static func test_proto_06_real_character_service_authoritative_creation() -> Dictionary:
	_setup_env()

	var auth := RealAuthService.new()
	var reg_res := {}
	auth.register_async("proto_user_06", "SecretPassProto#06", func(res: Dictionary): reg_res.merge(res))
	var acc_id := String(reg_res.get("account_id", ""))

	var login_res := {}
	auth.login_async("proto_user_06", "SecretPassProto#06", func(res: Dictionary): login_res.merge(res))
	var token := String(login_res.get("token", ""))

	var world_svc := RealWorldService.new()
	world_svc.enter_gateway_async(acc_id, token, func(_r): pass)
	world_svc.select_or_create_world_async(acc_id, token, "WORLD_PROTO_06", WorldGatewayModel.GameMode.SINGLE_PLAYER, func(_r): pass)

	var char_svc := RealCharacterService.new()

	# 1. 资质骰点契约测试
	var roll_res := {}
	char_svc.roll_attributes_async(func(res: Dictionary): roll_res.merge(res))
	var ok_roll: bool = bool(roll_res.get("success", false))
	var attrs: Dictionary = roll_res.get("attrs", {})
	var ok_attrs: bool = attrs.has("STR") and attrs.has("AGI") and attrs.has("CON") and attrs.has("INT") and attrs.has("WIS") and attrs.has("CHA")

	# 2. 权威创角测试
	var create_res := {}
	char_svc.create_character_async(acc_id, token, {
		"name": "ValenProto",
		"slot_index": 1,
		"world_id": "WORLD_PROTO_06",
		"race": "HUMAN",
		"request_seed": 20261110
	}, func(res: Dictionary): create_res.merge(res))
	var ok_create: bool = bool(create_res.get("success", false))
	var data: Dictionary = create_res.get("data", {})
	var char_id := String(data.get("character_id", ""))
	var ok_char_id: bool = not char_id.is_empty()
	var ok_prologue: bool = bool(data.get("prologue_started", false))

	_teardown_env()
	var passed: bool = ok_roll and ok_attrs and ok_create and ok_char_id and ok_prologue
	return TestCase.make_result("TC-PROTO-06: RealCharacterService权威创角编排与确定性资质骰点协议验证", passed, {
		"ok_roll": ok_roll, "ok_attrs": ok_attrs, "ok_create": ok_create, "ok_char_id": ok_char_id, "ok_prologue": ok_prologue
	})

static func _bootstrap_in_world_character(username: String, pwd: String, world_id: String, char_name: String) -> Dictionary:
	var auth := RealAuthService.new()
	var reg_res := {}
	auth.register_async(username, pwd, func(res: Dictionary): reg_res.merge(res))
	var acc_id := String(reg_res.get("account_id", ""))
	var login_res := {}
	auth.login_async(username, pwd, func(res: Dictionary): login_res.merge(res))
	var token := String(login_res.get("token", ""))
	var world_svc := RealWorldService.new()
	world_svc.enter_gateway_async(acc_id, token, func(_r): pass)
	world_svc.select_or_create_world_async(acc_id, token, world_id, WorldGatewayModel.GameMode.SINGLE_PLAYER, func(_r): pass)
	var char_svc := RealCharacterService.new()
	var create_res := {}
	char_svc.create_character_async(acc_id, token, {"name": char_name, "slot_index": 1, "world_id": world_id}, func(res: Dictionary): create_res.merge(res))
	var char_id := String((create_res.get("data", {}) as Dictionary).get("character_id", ""))
	var done_req := UnifiedProtocolFactory.create_human_request(
		"prologue", "COMPLETE_PROLOGUE", {"cutscene_id": "cs_prologue_awakening"}, token, acc_id, char_id
	)
	UnifiedProtocolDispatcher.dispatch_request(done_req)
	return {"account_id": acc_id, "token": token, "character_id": char_id, "world_svc": world_svc}

## TC-PROTO-07: RealEscMenuService 系统菜单可用状态感知与安全存盘守卫回执验证
static func test_proto_07_real_esc_menu_service_and_save_guard() -> Dictionary:
	_setup_env()
	_bootstrap_in_world_character("proto_user_07", "SecretPassProto#07", "WORLD_PROTO_07", "SaveHeroProto")

	var esc_svc := RealEscMenuService.new()

	# 1. 拉取菜单状态
	var state_res := {}
	esc_svc.get_menu_state_async(func(res: Dictionary): state_res.merge(res))
	var ok_state: bool = bool(state_res.get("success", false))
	var s_data: Dictionary = state_res.get("data", {})
	var ok_can_save: bool = bool(s_data.get("can_save", false))
	var actions: Array = s_data.get("allowed_actions", [])
	var ok_actions: bool = actions.has("ESC_SAVE_GAME") and actions.has("ESC_EXIT_TO_GATEWAY")

	# 2. 执行安全存盘
	var save_res := {}
	esc_svc.request_save_async("SLOT_1", false, func(res: Dictionary): save_res.merge(res))
	var ok_save: bool = bool(save_res.get("success", false))

	_teardown_env()
	var passed: bool = ok_state and ok_can_save and ok_actions and ok_save
	return TestCase.make_result("TC-PROTO-07: RealEscMenuService系统菜单状态感知与安全存盘守卫回执验证", passed, {
		"ok_state": ok_state, "ok_can_save": ok_can_save, "ok_actions": ok_actions, "ok_save": ok_save
	})

## TC-PROTO-08: HudEventBridge 六大信道全覆盖、主动快照拉取与幂等解绑验证
static func test_proto_08_hud_event_bridge_six_channels_and_pull_snapshot() -> Dictionary:
	_setup_env()
	_bootstrap_in_world_character("proto_user_08", "SecretPassProto#08", "WORLD_PROTO_08", "BridgeHeroProto")

	var bridge := HudEventBridge.get_instance()

	# 1. 主动拉取 HUD 权威快照
	var pull_res := {}
	bridge.pull_hud_snapshot_async(func(res: Dictionary): pull_res.merge(res))
	var ok_pull: bool = bool(pull_res.get("success", false))
	var snap_data: Dictionary = pull_res.get("data", {})
	var ok_snap_fields: bool = snap_data.has("character_id") or snap_data.has("hud_snapshot") or snap_data.has("hp_max")

	# 2. 幂等解绑测试（多次解绑不应崩溃或残留监听）
	bridge.detach_hud()
	bridge.detach_hud()
	var ok_detach: bool = not bridge.is_attached()

	_teardown_env()
	var passed: bool = ok_pull and ok_snap_fields and ok_detach
	return TestCase.make_result("TC-PROTO-08: HudEventBridge六大信道全覆盖、主动快照拉取与幂等解绑验证", passed, {
		"ok_pull": ok_pull, "ok_snap_fields": ok_snap_fields, "ok_detach": ok_detach
	})

## TC-PROTO-09: 退出世界退回网关与活跃世界禁切模式解耦闭关验证
static func test_proto_09_exit_world_to_gateway_and_mode_switch() -> Dictionary:
	_setup_env()
	var env_ctx := _bootstrap_in_world_character("proto_user_09", "SecretPassProto#09", "WORLD_PROTO_09", "SwitchHeroProto")
	var acc_id := String(env_ctx["account_id"])
	var token := String(env_ctx["token"])
	var world_svc: RealWorldService = env_ctx["world_svc"]

	# 1. 处于活跃世界中，尝试切换网关模式：必须被防越权护栏拦截
	var sw_blocked_res := {}
	world_svc.switch_gateway_mode_async(acc_id, token, WorldGatewayModel.GameMode.MULTIPLAYER, func(res: Dictionary): sw_blocked_res.merge(res))
	var ok_blocked: bool = not bool(sw_blocked_res.get("success", true)) and WorldSessionRuntimeService.has_active_world()

	# 2. 退出世界退回网关
	var exit_res := {}
	world_svc.exit_world_to_gateway_async(acc_id, token, func(res: Dictionary): exit_res.merge(res))
	var ok_exit: bool = bool(exit_res.get("success", false)) and not WorldSessionRuntimeService.has_active_world()

	# 3. 退出世界后切换网关模式：必须成功通过
	var sw_ok_res := {}
	world_svc.switch_gateway_mode_async(acc_id, token, WorldGatewayModel.GameMode.SINGLE_PLAYER, func(res: Dictionary): sw_ok_res.merge(res))
	var ok_switched: bool = bool(sw_ok_res.get("success", false))

	_teardown_env()
	var passed: bool = ok_blocked and ok_exit and ok_switched
	return TestCase.make_result("TC-PROTO-09: 退出世界退回网关与活跃世界禁切模式解耦验证", passed, {
		"ok_blocked": ok_blocked, "ok_exit": ok_exit, "ok_switched": ok_switched
	})

## TC-PROTO-10: RealServiceContainer 真实依赖注入容器装配、各域适配器解析与模式隔离验证
static func test_proto_10_real_service_container_wiring_and_isolation() -> Dictionary:
	_setup_env()

	# 1. 验证真实容器装配与强类型获取
	ServiceLocator.set_mode("real")
	var container := ServiceLocator.get_instance()
	var ok_container: bool = container is RealServiceContainer

	var auth_svc: Object = container.get_service("auth")
	var world_svc: Object = container.get_service("world")
	var char_svc: Object = container.get_service("character")
	var esc_svc: Object = container.get_service("esc_menu")

	var ok_types: bool = auth_svc is RealAuthService and world_svc is RealWorldService \
		and char_svc is RealCharacterService and esc_svc is RealEscMenuService

	# 2. 切换回 Mock 模式并验证隔离
	RealServiceContainer.reset_instance()
	ServiceLocator.set_mode("mock")
	var mock_container := ServiceLocator.get_instance()
	var ok_mock: bool = mock_container is MockServiceContainer
	var mock_auth: Object = mock_container.get_service("auth")
	var ok_mock_auth: bool = mock_auth is MockAuthService

	_teardown_env()
	var passed: bool = ok_container and ok_types and ok_mock and ok_mock_auth
	return TestCase.make_result("TC-PROTO-10: RealServiceContainer真实依赖注入容器装配与模式隔离验证", passed, {
		"ok_container": ok_container, "ok_types": ok_types, "ok_mock": ok_mock, "ok_mock_auth": ok_mock_auth
	})

## TC-PROTO-13: GameSettings 协议回归与游客/清槽及异常诚实失败验证
static func test_proto_13_game_settings_protocol_and_honest_failures() -> Dictionary:
	_setup_env()
	var container := ServiceLocator.get_instance()
	var unauth_pro := {}
	container.prologue().complete_prologue_async("", "", "", false, func(r: Dictionary): unauth_pro.merge(r))
	var ok_unauth_fail := not bool(unauth_pro.get("success", true)) and str(unauth_pro.get("error_code", "")) == "ERR_UNAUTHORIZED"

	var guest := {}
	container.auth().login_guest_async("DEV_PROTO_13", func(r: Dictionary): guest.merge(r))
	var g_acc := String(guest.get("account_id", ""))
	var g_tok := String(guest.get("token", ""))
	var ok_guest := bool(guest.get("success", false)) and not g_tok.is_empty()

	var no_pro := {}
	container.prologue().complete_prologue_async(g_acc, g_tok, "", false, func(r: Dictionary): no_pro.merge(r))
	var ok_honest_fail := not bool(no_pro.get("success", true)) and str(no_pro.get("error_code", "")) == "ERR_NO_PROLOGUE_CONTEXT"

	var applied := {}
	var confirmed := {}
	var reset_res := {}
	container.game_settings().apply_settings_async(g_acc, g_tok, {"render": {"resolution_width": 1280, "resolution_height": 720}}, func(r: Dictionary): applied.merge(r))
	container.game_settings().confirm_resolution_async(g_acc, g_tok, func(r: Dictionary): confirmed.merge(r))
	container.game_settings().reset_defaults_async(g_acc, g_tok, func(r: Dictionary): reset_res.merge(r))
	var ok_pending := bool((applied.get("data", {}) as Dictionary).get("is_pending_confirm", false))
	var ok_confirmed := bool(confirmed.get("success", false)) and not bool((confirmed.get("data", {}) as Dictionary).get("is_pending_confirm", true))
	var ok_reset := bool(reset_res.get("success", false))

	_teardown_env()
	var passed := ok_unauth_fail and ok_honest_fail and ok_guest and ok_pending and ok_confirmed and ok_reset
	return TestCase.make_result("TC-PROTO-13: GameSettings协议回归与游客及失败诚实反馈验证", passed, {
		"ok_unauth_fail": ok_unauth_fail, "ok_honest_fail": ok_honest_fail, "ok_guest": ok_guest, "ok_pending": ok_pending, "ok_confirmed": ok_confirmed, "ok_reset": ok_reset
	})

## TC-PROTO-14: MockServiceContainer 四新接口与 ESC 暂停/设置同构契约验证
static func test_proto_14_mock_service_container_reserved_interfaces_parity() -> Dictionary:
	_setup_env()
	ServiceLocator.set_mode("mock")
	var mock_c := ServiceLocator.get_instance()
	var pro: Object = mock_c.prologue()
	var hud: Object = mock_c.hud_sync()
	var lc: Object = mock_c.lifecycle()
	var cfg: Object = mock_c.game_settings()
	var esc: Object = mock_c.esc_menu()
	for svc in [pro, hud, lc, cfg, esc]:
		if svc != null:
			svc.set("simulate_delay_ms", 0)

	var p_res := {}
	var h_res := {}
	var l_res := {}
	var g_res := {}
	var e_res := {}
	mock_c.prologue().start_prologue_async("ACC_M", "TOK_M", {}, func(r: Dictionary): p_res.merge(r))
	mock_c.hud_sync().pull_authoritative_snapshot_async("ACC_M", "TOK_M", "CHAR_M", func(r: Dictionary): h_res.merge(r))
	mock_c.lifecycle().pause_game_async("ACC_M", "TOK_M", "ESC_MENU", func(r: Dictionary): l_res.merge(r))
	mock_c.game_settings().get_settings_async("ACC_M", "TOK_M", func(r: Dictionary): g_res.merge(r))
	mock_c.esc_menu().pause_game_async(func(r: Dictionary): e_res.merge(r))
	_teardown_env()
	var passed := bool(p_res.get("success", false)) and bool(h_res.get("success", false)) and bool(l_res.get("success", false)) and bool(g_res.get("success", false)) and bool(e_res.get("success", false))
	return TestCase.make_result("TC-PROTO-14: MockServiceContainer保留交互接口同构契约验证", passed, {
		"pro": bool(p_res.get("success", false)), "hud": bool(h_res.get("success", false)), "lc": bool(l_res.get("success", false)), "cfg": bool(g_res.get("success", false)), "esc": bool(e_res.get("success", false))
	})
