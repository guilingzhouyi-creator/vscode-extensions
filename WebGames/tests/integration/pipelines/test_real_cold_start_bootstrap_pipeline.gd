# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_real_cold_start_bootstrap_pipeline.gd
# 架构定位: Integration Test Pipeline / Cold Start AppRoot Real Scene Bootstrap Verification
# 依赖与触发: 上游: TestRegistry | 下游: AppRoot, AppBootstrap, AppLifecycleFSM, NavManager,
#           ServiceLocator, RealVersionService, RealProtocolBridge, RealAuthService
# 职责说明: 离线挂载真实主场景 app_root.tscn，在不预置 Mock 或手工节点拼接的前提下验证
#           ServiceLocator real 模式冷启动、版本兼容握手、建角故障错误码透传与零节点泄漏回收。
# 退出语义与设计依据: 无头全真场景冷启动与零孤立节点回收门禁契约
# ==============================================================================

## TestRealColdStartBootstrapPipeline：全真主场景冷启动与边界协议健壮性回归套件
class_name TestRealColdStartBootstrapPipeline
extends TestCase

const AppBootstrapScript = preload("res://frontend/app/app_bootstrap.gd")
const AppRootScene = preload("res://frontend/app/app_root.tscn")


## 执行全真冷启动与协议健壮性集成测试矩阵
static func run_all_tests() -> Dictionary:
	_reset_cold_start_singletons()
	var results: Array[Dictionary] = []
	results.append(test_cold_01_app_root_scene_real_bootstrap())
	results.append(test_cold_02_version_compatible_and_null_protocol_bridge())
	results.append(test_cold_03_auth_create_character_error_code_mapping())
	_reset_cold_start_singletons()
	return TestCase.pack_results("全真冷启动 app_root.tscn 与边界协议健壮性集成流水线", results)


## TC-COLD-01: 实例化真实 app_root.tscn 完成 real 模式冷启动并无泄漏回收
static func test_cold_01_app_root_scene_real_bootstrap() -> Dictionary:
	_reset_cold_start_singletons()
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var app_root := AppRootScene.instantiate() as Control
	var tree := Engine.get_main_loop() as SceneTree
	if app_root != null and tree != null:
		tree.root.add_child(app_root)
		for child in app_root.get_children():
			for grandchild in child.get_children():
				if grandchild is Node and not grandchild.is_node_ready():
					grandchild.notification(Node.NOTIFICATION_READY)
		if not app_root.is_node_ready():
			app_root.notification(Node.NOTIFICATION_READY)

	var service_container := ServiceLocator.get_instance()
	var current_state: int = AppLifecycleFSM.get_instance().get_current_state()
	var stack_depth: int = NavManager.get_instance().get_stack_depth()
	var screen_node: Node = NavManager.get_instance().get_current_screen()
	var has_screen_node: bool = screen_node != null and is_instance_valid(screen_node)
	var screen_scene_path: String = str(screen_node.scene_file_path) if has_screen_node else ""

	if app_root != null and is_instance_valid(app_root):
		app_root.free()
	if tree != null:
		tree.set_auto_accept_quit(true)
	_reset_cold_start_singletons()
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))

	var passed: bool = (ServiceLocator.get_mode() == "real") \
		and (service_container is RealServiceContainer) \
		and (current_state == AppLifecycleFSM.AppState.AUTHENTICATING) \
		and (stack_depth == 1) \
		and has_screen_node \
		and (screen_scene_path == "res://frontend/views/account_entry/account_entry_view.tscn") \
		and ((orphan_after - orphan_before) == 0)
	return TestCase.make_result("TC-COLD-01: 真实 app_root.tscn real 模式冷启动直达账号入口并零泄漏回收", passed, {
		"detail": "mode=%s real=%s state=%s stack=%s node=%s path=%s orphan=%s" % [
			ServiceLocator.get_mode(),
			str(service_container is RealServiceContainer),
			str(current_state),
			str(stack_depth),
			str(has_screen_node),
			screen_scene_path,
			str(orphan_after - orphan_before)
		]
	})


## TC-COLD-02: RealVersionService 必须输出 compatible，RealProtocolBridge 对 null 响应显式报错
static func test_cold_02_version_compatible_and_null_protocol_bridge() -> Dictionary:
	_reset_cold_start_singletons()
	ServiceLocator.set_mode("real")
	var version_reply: Dictionary = {}
	ServiceLocator.get_instance().version().check_version_async(func(payload: Dictionary) -> void:
		version_reply.merge(payload, true)
	)
	var null_reply: Dictionary = {}
	RealProtocolBridge.reply_callback(func(payload: Dictionary) -> void:
		null_reply.merge(payload, true)
	, null, "snapshot", {"fallback": true})
	_reset_cold_start_singletons()

	var version_ok: bool = bool(version_reply.get("success", false)) \
		and bool(version_reply.get("compatible", false)) \
		and version_reply.has("version") \
		and version_reply.has("latest_version")
	var null_snapshot: Dictionary = null_reply.get("snapshot", {}) as Dictionary
	var null_bridge_ok: bool = (not bool(null_reply.get("success", true))) \
		and (str(null_reply.get("error_code", "")) == "ERR_PROTOCOL_NULL_RESPONSE") \
		and bool(null_snapshot.get("fallback", false))
	return TestCase.make_result("TC-COLD-02: RealVersionService 兼容握手字段完备与空响应桥接非静默失败", version_ok and null_bridge_ok, {
		"version_reply": version_reply,
		"null_reply": null_reply
	})


## TC-COLD-03: RealAuthService.create_character_async 对缺失账号与槽位占用保留具体错码及映射消息
static func test_cold_03_auth_create_character_error_code_mapping() -> Dictionary:
	_reset_cold_start_singletons()
	TestFullChainBackendHelper.setup_env()
	var auth := RealAuthService.new()
	var missing_acct_reply: Dictionary = {}
	auth.create_character_async("NON_EXISTENT_COLD_ACCT", {"name": "ProbeHero", "slot_id": "slot_1"}, func(reply: Dictionary) -> void:
		missing_acct_reply.merge(reply, true)
	)
	var empty_name_reply: Dictionary = {}
	auth.create_character_async("ANY_ACCT", {"name": "   ", "slot_id": "slot_1"}, func(reply: Dictionary) -> void:
		empty_name_reply.merge(reply, true)
	)
	var registered: Dictionary = {}
	auth.register_async("cold_slot_probe_user", "Pass123#Cold", func(reply: Dictionary) -> void:
		registered.merge(reply, true)
	)
	var duplicate_slot_reply: Dictionary = {}
	var first_create_reply: Dictionary = {}
	var acct_id: String = str(registered.get("account_id", ""))
	if not acct_id.is_empty():
		auth.create_character_async(acct_id, {"name": "ProbeSlotFirst", "slot_id": "SLOT_01"}, func(reply: Dictionary) -> void:
			first_create_reply.merge(reply, true)
		)
		auth.create_character_async(acct_id, {"name": "ProbeSlotSecond", "slot_id": "SLOT_01"}, func(reply: Dictionary) -> void:
			duplicate_slot_reply.merge(reply, true)
		)
	_reset_cold_start_singletons()

	var missing_ok: bool = (not bool(missing_acct_reply.get("success", true))) \
		and (str(missing_acct_reply.get("error_code", "")) == "ERR_ACCOUNT_NOT_FOUND")
	var empty_ok: bool = (not bool(empty_name_reply.get("success", true))) \
		and (str(empty_name_reply.get("error_code", "")) == "ERR_NAME_EMPTY")
	var dup_slot_code: String = str(duplicate_slot_reply.get("error_code", ""))
	var dup_slot_msg: String = str(duplicate_slot_reply.get("message", ""))
	var slot_ok: bool = bool(registered.get("success", false)) \
		and bool(first_create_reply.get("success", false)) \
		and (not bool(duplicate_slot_reply.get("success", true))) \
		and (dup_slot_code == "SLOT_OCCUPIED") \
		and (dup_slot_msg == "ui.fe01.char_create.error_slot_occupied")
	return TestCase.make_result("TC-COLD-03: 创角异步错误码与国际化键精确透传不退化", missing_ok and empty_ok and slot_ok, {
		"missing_acct_reply": missing_acct_reply,
		"empty_name_reply": empty_name_reply,
		"first_create_reply": first_create_reply,
		"duplicate_slot_reply": duplicate_slot_reply
	})


static func _reset_cold_start_singletons() -> void:
	AppBootstrapScript.reset_for_tests()
	DialogManager.reset_instance()
	DrawerManager.reset_instance()
	ContextMenuManager.reset_instance()
	TooltipManager.reset_instance()
	ModalManager.reset_instance()
	FocusInputManager.reset_instance()
	RedDotTreeManager.reset_instance()
	UIAudioBridge.reset_instance()
	ThemeManager.reset_instance()
	AppLifecycleFSM.reset_instance()
	NavManager.reset_instance()
	ServiceLocator.clear_active_gateway()
	ServiceLocator.reset()
	RealServiceContainer.reset_instance()
	UIIntermediary.teardown_for_tests()
	UITextResolver.reset_instance()
	UIBindingRegistry.reset_instance()
	TestFullChainBackendHelper.teardown_env()
