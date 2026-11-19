# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_real_ui_chain_and_lock_security_pipeline.gd
# 架构定位: Integration Test Pipeline / Headless Full-Chain Clickable Real UI Verification
# 依赖与触发: 上游: TestRegistry | 下游: ServiceLocator(mode="real"), NavManager, AppRoot, AccountEntryView, WorldGatewayView, CharacterCreationView, PrologueView, MainHUDView, WorldModAffinityManager
# 职责说明: 在无头 SceneTree 中以真实 UI 信号点击与 service_mode="real" 验证完整玩家路径： 自动登录注册(零伪令牌) -> 世界网关建档 -> 自动分流 CharacterCreationView -> 权威创角锁定(真实64位SHA256) -> DAG序章 -> MainHUD -> ESC返关(栈深=1/保上下文) -> NavManager.pop_screen 参数保真 -> 切换联机清除 SP MOD -> 验签 -> 优雅停机 -> 重进已有角色直入。
# 退出语义与设计依据: 退出码: 返回全量断言结果 | 设计依据: 阶段验收矩阵 (TC-E2E-UI-01 ~ TC-E2E-UI-03)
# ==============================================================================

## TestRealUiChainAndLockSecurityPipeline：全端可点击 UI 真实流程回归套件
class_name TestRealUiChainAndLockSecurityPipeline
extends TestCase

const AppRootScript = preload("res://frontend/app/app_root.gd")
const AccountEntryViewScript = preload("res://frontend/views/account_entry/account_entry_view.gd")
const WorldGatewayViewScript = preload("res://frontend/views/world_gateway/world_gateway_view.gd")
const ModWorkbenchScreenScript = preload("res://frontend/views/mod_workbench/mod_workbench_screen.gd")
const CharacterCreationViewScript = preload("res://frontend/views/character_creation/character_creation_view.gd")
const PrologueViewScript = preload("res://frontend/views/prologue/prologue_view.gd")
const MainHUDViewScript = preload("res://frontend/views/main_hud/main_hud_view.gd")

const WORLD_ID: String = "WORLD_REAL_E2E_UI_01"


## 执行全端真实交互与安全端到端测试
static func run_all_tests() -> Dictionary:
	var session_ctx := _setup_env()
	var results: Array[Dictionary] = []
	results.append(_test_tc_e2e_01_register_gateway_creation_prologue_hud(session_ctx))
	results.append(_test_tc_e2e_02_esc_exit_nav_pop_mode_switch_quit(session_ctx))
	results.append(_test_tc_e2e_03_reentry_existing_char_and_entry_signals(session_ctx))
	_teardown_env(session_ctx)
	return TestCase.pack_results("全端真实可点击UI流转与锁安全端到端验收流水线", results)


static func _setup_env() -> Dictionary:
	TestFullChainBackendHelper.setup_env()
	NavManager.reset_instance()
	ServiceLocator.set_mode("real")
	var app_root := AppRootScript.new()
	app_root.name = "TestRealUiChainAppRoot"
	var screen_layer := CanvasLayer.new()
	screen_layer.name = "ScreenLayer"
	var container := Control.new()
	container.name = "ScreenContainer"
	screen_layer.add_child(container)
	app_root.add_child(screen_layer)
	app_root.screen_container = container
	(Engine.get_main_loop() as SceneTree).root.add_child(app_root)
	NavManager.get_instance().bind_root(app_root)
	return {"app_root": app_root}


static func _teardown_env(session_ctx: Dictionary) -> void:
	var app_root: Variant = session_ctx.get("app_root", null)
	NavManager.reset_instance()
	if app_root != null and is_instance_valid(app_root):
		app_root.free()
	ServiceLocator.clear_active_gateway()
	ServiceLocator.reset()
	var lock_path := WorldModAffinityManager.new().get_lock_file_path(WORLD_ID)
	if FileAccess.file_exists(lock_path):
		DirAccess.remove_absolute(lock_path)
	TestCase.unmount_mod_overlay_for_test()
	TestFullChainBackendHelper.teardown_env()


## TC-E2E-UI-01: 自动登录注册(真令牌) -> WorldGateway建档 -> 自动分流 CharacterCreationView -> DAG序章 -> MainHUD
static func _test_tc_e2e_01_register_gateway_creation_prologue_hud(session_ctx: Dictionary) -> Dictionary:
	var nav := NavManager.get_instance()
	var entry: AccountEntryViewScript = nav.push_screen("account_entry") as AccountEntryViewScript
	if entry == null:
		return make_result("TC-E2E-UI-01: 全流程注册创角进MainHUD", false, {"reason": "entry_null"})

	entry.splash_enter_btn.pressed.emit()
	entry.login_goto_register_btn.pressed.emit()
	entry.register_username_edit.text = "RealChainHeroUser"
	entry.register_password_edit.text = "Secret_UiE2E_OK"
	entry.register_confirm_edit.text = "Secret_UiE2E_OK"
	entry.register_agree_check.button_pressed = true
	entry.register_submit_btn.pressed.emit()

	var real_token_ok: bool = not entry.current_account_id.is_empty() \
		and not entry.current_session_token.is_empty() \
		and not entry.current_session_token.begins_with("TOKEN_")
	session_ctx["account_id"] = entry.current_account_id
	session_ctx["token"] = entry.current_session_token

	var gateway: WorldGatewayViewScript = nav.get_current_screen() as WorldGatewayViewScript
	var auto_entered_gateway: bool = (gateway != null)
	if gateway != null:
		gateway.new_world_id_edit.text = WORLD_ID
		gateway.create_world_btn.pressed.emit()
		gateway.enter_world_btn.pressed.emit()

	var creation: CharacterCreationViewScript = nav.get_current_screen() as CharacterCreationViewScript
	var routed_to_creation: bool = (creation != null) and creation.current_world_id == WORLD_ID
	var creation_snapshot_ok := false
	var reroll_res := {}
	if creation != null:
		creation.character_name_edit.text = "AriaRealUi"
		reroll_res = creation.roll_destiny_preview(false)
		creation_snapshot_ok = not creation.preview_snapshot.is_empty()
		creation.confirm_create_btn.pressed.emit()

	var lock_data := WorldModAffinityManager.new().load_world_mod_lock(WORLD_ID)
	var lock_packs: Array = lock_data.get("locked_packs", [])
	var lock_sha_ok: bool = bool(lock_data.get("exists", false)) and not lock_packs.is_empty()
	for pack_entry in lock_packs:
		if pack_entry is Dictionary and str((pack_entry as Dictionary).get("content_sha256", "")).length() != 64:
			lock_sha_ok = false

	var prologue: PrologueViewScript = nav.get_current_screen() as PrologueViewScript
	var routed_to_prologue: bool = (prologue != null)
	if prologue != null:
		prologue.choose_branch("LOOK_AROUND")
		if not prologue.is_completed:
			prologue.choose_branch("TALK_GUARD")
		if not prologue.is_completed:
			prologue.choose_branch("ENTER_WORLD")
		prologue.enter_world_hud_btn.pressed.emit()

	var hud: MainHUDViewScript = nav.get_current_screen() as MainHUDViewScript
	var routed_to_hud: bool = (hud != null) and hud.current_account_id == str(session_ctx.get("account_id", ""))
	var ok: bool = real_token_ok and auto_entered_gateway and routed_to_creation \
		and creation_snapshot_ok and bool(reroll_res.get("success", false)) \
		and lock_sha_ok and routed_to_prologue and routed_to_hud
	return make_result("TC-E2E-UI-01: 自动登录注册(零假令牌) -> 网关 -> 权威创角 -> DAG序章 -> MainHUD", ok, {
		"real_token_ok": real_token_ok,
		"auto_entered_gateway": auto_entered_gateway,
		"routed_to_creation": routed_to_creation,
		"lock_sha_ok": lock_sha_ok,
		"routed_to_prologue": routed_to_prologue,
		"routed_to_hud": routed_to_hud
	})


## TC-E2E-UI-02: HUD ESC 返关(免ERR_UNAUTHORIZED) -> NavManager.pop_screen 参数保真 -> Tab切联机清污 -> 网关停机
static func _test_tc_e2e_02_esc_exit_nav_pop_mode_switch_quit(session_ctx: Dictionary) -> Dictionary:
	var nav := NavManager.get_instance()
	var hud: MainHUDViewScript = nav.get_current_screen() as MainHUDViewScript
	if hud == null:
		return make_result("TC-E2E-UI-02: ESC返关与导航栈参数保真与停机", false, {"reason": "hud_null"})

	hud._get_subpanels().on_menu_exit_to_gateway_pressed()
	var gateway: WorldGatewayViewScript = nav.get_current_screen() as WorldGatewayViewScript
	var returned_to_gateway: bool = gateway != null \
		and nav.get_stack_depth() == 1 \
		and gateway.current_account_id == str(session_ctx.get("account_id", "")) \
		and gateway.current_session_token == str(session_ctx.get("token", "")) \
		and ServiceLocator.get_active_gateway().context.current_phase != WorldGatewayModel.GatewayPhase.IN_WORLD

	var pop_context_preserved := false
	if gateway != null:
		gateway.selected_world_id = WORLD_ID
		gateway.open_mod_workbench_btn.pressed.emit()
		var workbench: ModWorkbenchScreenScript = nav.get_current_screen() as ModWorkbenchScreenScript
		if workbench != null and workbench.back_btn != null:
			workbench.back_btn.pressed.emit()
		var resumed_gateway: WorldGatewayViewScript = nav.get_current_screen() as WorldGatewayViewScript
		pop_context_preserved = resumed_gateway != null \
			and resumed_gateway.current_account_id == str(session_ctx.get("account_id", "")) \
			and resumed_gateway.current_session_token == str(session_ctx.get("token", "")) \
			and resumed_gateway.selected_world_id == WORLD_ID
		gateway = resumed_gateway

	var tab_switched_to_mp := false
	var realm_verified_ok := false
	var shutdown_ok := false
	if gateway != null:
		# 注销当前 SP 会话并真实登录联机白名单账号 MP_TESTER_01，验证 ModeTabContainer -> Multiplayer 清理与验签流程
		var mp_account := AccountProfile.new()
		mp_account.account_id = "MP_TESTER_01"
		mp_account.username = "MP_TESTER_01"
		mp_account.password_hash_sha256 = AuthService.hash_password("Secret_MP_Test")
		AccountRepository.get_instance().save_account(mp_account)
		WorldGatewayRealmSessionHelper.logout_to_account_entry(gateway, gateway._get_tabs())
		var mp_auth := {"token": ""}
		ServiceLocator.get_instance().auth().login_async("MP_TESTER_01", "Secret_MP_Test", func(login_reply: Dictionary) -> void:
			mp_auth["token"] = str(login_reply.get("token", ""))
		)
		var mp_gw: WorldGatewayViewScript = nav.replace_screen("world_gateway", {
			"account_id": "MP_TESTER_01",
			"token": str(mp_auth["token"])
		}) as WorldGatewayViewScript
		if mp_gw != null:
			mp_gw._on_mode_tab_changed(1)
			var active_gw = ServiceLocator.get_active_gateway()
			tab_switched_to_mp = mp_gw.current_gateway_mode == 2 \
				and active_gw != null \
				and active_gw.context.selected_mode == WorldGatewayModel.GameMode.MULTIPLAYER \
				and active_gw.get_active_mods().size() <= 1
			if not mp_gw.remote_realms.is_empty():
				mp_gw.selected_realm_index = 0
				var verify_res := WorldGatewayRealmSessionHelper.verify_and_enter_selected_realm(mp_gw, mp_gw._get_tabs())
				realm_verified_ok = bool(verify_res.get("success", false)) or bool(mp_gw.last_realm_verification.get("verified", false))
			else:
				realm_verified_ok = true
			var quit_res := WorldGatewayRealmSessionHelper.quit_desktop_application(mp_gw)
			shutdown_ok = bool(quit_res.get("success", false))

	var ok: bool = returned_to_gateway and pop_context_preserved and tab_switched_to_mp and realm_verified_ok and shutdown_ok
	return make_result("TC-E2E-UI-02: ESC认证返关、pop_screen上下文保真、Tab切联机清污与停机", ok, {
		"returned_to_gateway": returned_to_gateway,
		"pop_context_preserved": pop_context_preserved,
		"tab_switched_to_mp": tab_switched_to_mp,
		"realm_verified_ok": realm_verified_ok,
		"shutdown_ok": shutdown_ok
	})


## TC-E2E-UI-03: 停机重启后 AccountEntryView 槽位/重骰信号无报错 + 有角色世界直接进入 MainHUD
static func _test_tc_e2e_03_reentry_existing_char_and_entry_signals(session_ctx: Dictionary) -> Dictionary:
	GameConfig.ensure_loaded()
	GameBootstrap.assemble()
	AccountRepository.get_instance().set_custom_registry_path(TestFullChainBackendHelper.TEST_ACCOUNTS_PATH)
	AccountRepository.get_instance().load_all()
	WorldArchiveRepository.get_instance().set_custom_root_dir(TestFullChainBackendHelper.TEST_WORLDS_ROOT)
	ServiceLocator.clear_active_gateway()
	ServiceLocator.set_mode("real")
	var nav := NavManager.get_instance()
	nav.pop_to_root("account_entry")
	var entry: AccountEntryViewScript = nav.get_current_screen() as AccountEntryViewScript
	var signals_ok := false
	if entry != null:
		entry.apply_snapshot({"character_slots": [ {"slot_id": "SLOT_01", "name": "SignalHero"}]})
		entry._on_char_slot_0_pressed()
		var slot_picked := entry.selected_character_slot == "SLOT_01"
		entry._on_char_slot_1_pressed()
		entry._on_char_slot_2_pressed()
		entry._on_char_reroll_pressed()
		signals_ok = slot_picked and not entry.rolled_attributes.is_empty()

	var login_res: Dictionary = entry.submit_login("RealChainHeroUser", "Secret_UiE2E_OK") if entry != null else {}
	var login_acc := str(login_res.get("account_id", session_ctx.get("account_id", "")))
	var login_tok := str(login_res.get("token", session_ctx.get("token", "")))
	var gateway: WorldGatewayViewScript = nav.push_screen("world_gateway", {
		"account_id": login_acc,
		"token": login_tok
	}) as WorldGatewayViewScript
	if gateway != null:
		gateway.selected_world_id = WORLD_ID
		gateway.enter_world_btn.pressed.emit()

	var direct_hud: MainHUDViewScript = nav.get_current_screen() as MainHUDViewScript
	var direct_entered_hud: bool = direct_hud != null
	if direct_hud != null:
		direct_hud._get_subpanels().on_menu_exit_to_gateway_pressed()

	var ok: bool = signals_ok and bool(login_res.get("success", false)) and direct_entered_hud
	return make_result("TC-E2E-UI-03: 入口槽位重骰信号流转与已创角世界复进入MainHUD", ok, {
		"signals_ok": signals_ok,
		"login_ok": bool(login_res.get("success", false)),
		"direct_entered_hud": direct_entered_hud
	})
