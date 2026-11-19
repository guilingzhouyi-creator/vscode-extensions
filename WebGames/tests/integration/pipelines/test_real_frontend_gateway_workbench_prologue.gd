# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_real_frontend_gateway_workbench_prologue.gd
# 架构定位: Integration Test Pipeline / Headless Full-Stack Real UI Walkthrough
# 依赖与触发: 上游: TestRegistry | 下游: ServiceLocator (mode="real"), NavManager, AppRoot, AccountEntryView, WorldGatewayView, ModWorkbenchScreen, PrologueView
# 职责说明: 在真实无头 SceneTree 中实例化全套前端视图场景并开启 service_mode = "real"， 端到端驱动 注册/登录 ➔ 世界网关刷新 ➔ MOD 工坊启停预检 ➔ 建档创角 ➔ 交互式 DAG 序章分支推演 ➔ 主页 HUD 交接 ➔ ESC 清理注销与全节点回收。
# 退出语义与设计依据: 退出码: 返回全量断言结果 | 设计依据: 阶段验收矩阵 (TC-FGP-01 ~ TC-FGP-05)
# ==============================================================================

## TestRealFrontendGatewayWorkbenchPrologue：真实前端视图 + service_mode="real" 全链无头推演测试套件
class_name TestRealFrontendGatewayWorkbenchPrologue
extends TestCase

const AppRootScript = preload("res://frontend/app/app_root.gd")
const AccountEntryViewScript = preload("res://frontend/views/account_entry/account_entry_view.gd")
const WorldGatewayViewScript = preload("res://frontend/views/world_gateway/world_gateway_view.gd")
const ModWorkbenchScreenScript = preload("res://frontend/views/mod_workbench/mod_workbench_screen.gd")
const PrologueViewScript = preload("res://frontend/views/prologue/prologue_view.gd")
const MainHUDViewScript = preload("res://frontend/views/main_hud/main_hud_view.gd")

const WORLD_ID: String = "WORLD_FE_REAL_01"

## 执行真实前端视图全链推演验收测试
static func run_all_tests() -> Dictionary:
	_setup_frontend_real_env()
	var session_ctx := {}
	var results: Array[Dictionary] = []
	results.append(_test_tc_fgp_01_real_auth_and_gateway_mount(session_ctx))
	results.append(_test_tc_fgp_02_world_gateway_view_probes_and_banner(session_ctx))
	results.append(_test_tc_fgp_03_mod_workbench_toggle_and_precheck(session_ctx))
	results.append(_test_tc_fgp_04_world_creation_and_authoritative_char(session_ctx))
	results.append(_test_tc_fgp_05_prologue_dag_view_to_hud_and_teardown(session_ctx))
	_teardown_frontend_real_env(session_ctx)
	return TestCase.pack_results("真实前端场景与 RealServiceContainer 全流程无头推演流水线", results)

static func _setup_frontend_real_env() -> void:
	TestFullChainBackendHelper.setup_env()
	NavManager.reset_instance()
	ServiceLocator.set_mode("real")
	var app_root := AppRootScript.new()
	app_root.name = "TestFrontendRealAppRoot"
	var screen_layer := CanvasLayer.new()
	screen_layer.name = "ScreenLayer"
	var container := Control.new()
	container.name = "ScreenContainer"
	screen_layer.add_child(container)
	app_root.add_child(screen_layer)
	app_root.screen_container = container
	(Engine.get_main_loop() as SceneTree).root.add_child(app_root)
	NavManager.get_instance().bind_root(app_root)

static func _teardown_frontend_real_env(session_ctx: Dictionary) -> void:
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

## TC-FGP-01: real 服务模式下 AccountEntryView 注册与登录鉴权流转
static func _test_tc_fgp_01_real_auth_and_gateway_mount(session_ctx: Dictionary) -> Dictionary:
	var nav := NavManager.get_instance()
	session_ctx["app_root"] = nav.get("_app_root")
	var account_screen: AccountEntryViewScript = nav.push_screen("account_entry") as AccountEntryViewScript
	var mode_ok: bool = ServiceLocator.get_mode() == "real" and account_screen != null

	var reg_res: Dictionary = account_screen.submit_register("FrontendRealUser", "Pass_2026_OK")
	var login_res: Dictionary = account_screen.submit_login("FrontendRealUser", "Pass_2026_OK")
	session_ctx["account_id"] = str(login_res.get("account_id", account_screen.current_account_id))
	session_ctx["token"] = str(login_res.get("token", account_screen.current_session_token))

	var ok: bool = mode_ok and bool(reg_res.get("success", false)) \
		and bool(login_res.get("success", false)) \
		and not str(session_ctx["account_id"]).is_empty() \
		and not str(session_ctx["token"]).is_empty()
	return make_result("TC-FGP-01: real 服务模式下 AccountEntryView 注册登录实时鉴权", ok, {
		"account_id": session_ctx.get("account_id", "")
	})

## TC-FGP-02: WorldGatewayView 实例化并从 RealWorldService 探测官方基础包就绪
static func _test_tc_fgp_02_world_gateway_view_probes_and_banner(session_ctx: Dictionary) -> Dictionary:
	var nav := NavManager.get_instance()
	var gateway_screen: WorldGatewayViewScript = nav.push_screen("world_gateway", {
		"account_id": session_ctx.get("account_id", ""),
		"token": session_ctx.get("token", "")
	}) as WorldGatewayViewScript
	var ok: bool = gateway_screen != null \
		and gateway_screen.base_content_mod_ready \
		and gateway_screen.active_base_pack_id == "official_kalar" \
		and gateway_screen.create_world_btn != null \
		and not gateway_screen.create_world_btn.disabled
	return make_result("TC-FGP-02: WorldGatewayView 无头挂载与基础包探针就绪状态展示", ok, {
		"base_pack_id": gateway_screen.active_base_pack_id if gateway_screen != null else ""
	})

## TC-FGP-03: 跳转 ModWorkbenchScreen 切换启停触发缺包警示后恢复预检通过
static func _test_tc_fgp_03_mod_workbench_toggle_and_precheck(_session_ctx: Dictionary) -> Dictionary:
	var nav := NavManager.get_instance()
	var gateway_screen: WorldGatewayViewScript = nav.get_current_screen() as WorldGatewayViewScript
	if gateway_screen != null and gateway_screen.open_mod_workbench_btn != null:
		gateway_screen.open_mod_workbench_btn.pressed.emit()

	var workbench: ModWorkbenchScreenScript = nav.get_current_screen() as ModWorkbenchScreenScript
	var mounted_ok: bool = workbench != null and not workbench.installed_packs.is_empty()
	var toggle_off_blocked := false
	var restore_on_passed := false

	if mounted_ok:
		workbench.focused_pack_index = 0
		var tabs_ctrl = workbench._get_tabs()
		if "official_kalar" in workbench.selected_pack_ids:
			tabs_ctrl.toggle_focused_pack()
		var off_report: Dictionary = tabs_ctrl.commit_selection_and_precheck()
		toggle_off_blocked = not bool(off_report.get("success", true))

		if not ("official_kalar" in workbench.selected_pack_ids):
			tabs_ctrl.toggle_focused_pack()
		var on_report: Dictionary = tabs_ctrl.commit_selection_and_precheck()
		restore_on_passed = bool(on_report.get("success", false))
		workbench.back_btn.pressed.emit()

	var back_to_gateway: bool = nav.get_current_screen() is WorldGatewayViewScript
	var ok: bool = mounted_ok and toggle_off_blocked and restore_on_passed and back_to_gateway
	return make_result("TC-FGP-03: ModWorkbenchScreen 启停校验与预检诊断交互流转", ok, {
		"toggle_off_blocked": toggle_off_blocked,
		"restore_on_passed": restore_on_passed,
		"back_to_gateway": back_to_gateway
	})

## TC-FGP-04: 网关创建新世界档案并走真实服务完成权威创角与快照适配
static func _test_tc_fgp_04_world_creation_and_authoritative_char(session_ctx: Dictionary) -> Dictionary:
	var nav := NavManager.get_instance()
	var gateway_screen: WorldGatewayViewScript = nav.get_current_screen() as WorldGatewayViewScript
	var account_id := str(session_ctx.get("account_id", ""))
	var token := str(session_ctx.get("token", ""))
	if gateway_screen == null:
		return make_result("TC-FGP-04: 网关建档与真实服务权威创角", false)

	gateway_screen.new_world_id_edit.text = WORLD_ID
	gateway_screen.create_world_btn.pressed.emit()
	var world_selected: bool = gateway_screen.selected_world_id == WORLD_ID

	var char_service := ServiceLocator.get_instance().character()
	var ui_snap_reply: Dictionary = {}
	char_service.get_creation_ui_snapshot_async(account_id, token, func(rep: Dictionary) -> void:
		ui_snap_reply.merge(rep, true)
	)
	var snap_ok: bool = bool(ui_snap_reply.get("success", false))

	var create_reply: Dictionary = {}
	char_service.create_character_async(account_id, token, {
		"world_id": WORLD_ID,
		"slot_index": 1,
		"character_name": "KalarHero",
		"request_seed": 202604
	}, func(rep: Dictionary) -> void:
		create_reply.merge(rep, true)
	)
	var create_data: Dictionary = create_reply.get("data", create_reply) as Dictionary
	var char_id := str(create_data.get("character_id", ""))

	gateway_screen.enter_world_btn.pressed.emit()
	var entered_prologue: bool = nav.get_current_screen() is PrologueViewScript
	var ok: bool = world_selected and snap_ok and bool(create_reply.get("success", false)) and entered_prologue
	return make_result("TC-FGP-04: 网关建档、真实权威创角并自动跃迁 PrologueView", ok, {
		"world_selected": world_selected,
		"char_id": char_id,
		"entered_prologue": entered_prologue
	})

## TC-FGP-05: PrologueView DAG 分支推进终态后交接至 MainHUDView
static func _test_tc_fgp_05_prologue_dag_view_to_hud_and_teardown(_session_ctx: Dictionary) -> Dictionary:
	var nav := NavManager.get_instance()
	var prologue: PrologueViewScript = nav.get_current_screen() as PrologueViewScript
	if prologue == null:
		return make_result("TC-FGP-05: PrologueView DAG 分支推演并交接 MainHUDView", false)

	var init_ok: bool = prologue.current_dag_id == "DAG_PROLOGUE_HUMAN_CAPITAL" \
		and prologue.current_node_id == "NODE_AWAKEN_PLAZA"
	prologue.choose_branch("LOOK_AROUND")
	if not prologue.is_completed:
		prologue.choose_branch("TALK_GUARD")
	if not prologue.is_completed:
		prologue.choose_branch("ENTER_WORLD")
	var completed_ok: bool = prologue.is_completed \
		and prologue.narrative_rich_label != null \
		and not prologue.narrative_history.is_empty()

	prologue.enter_world_hud_btn.pressed.emit()
	var on_hud: bool = nav.get_current_screen() is MainHUDViewScript
	var ok: bool = init_ok and completed_ok and on_hud
	return make_result("TC-FGP-05: PrologueView DAG 交互推演完结并切换至 MainHUDView", ok, {
		"init_ok": init_ok,
		"completed_ok": completed_ok,
		"on_hud": on_hud
	})
