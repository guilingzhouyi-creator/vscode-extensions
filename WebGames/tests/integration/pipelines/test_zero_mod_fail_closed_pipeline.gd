# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_zero_mod_fail_closed_pipeline.gd
# 架构定位: Integration Test Pipeline / Zero-MOD Fail-Closed Guard
# 依赖与触发: 上游: TestRegistry | 下游: GameConfig, ModPrecheckAndAdaptationSolver,
#           GameModeRoutingSolver, WorldCharacterCreationOrchestrator,
#           PrologueExecutionKernel, WorldGatewayFSM, WorldGatewayView
# 职责说明: 验证纯引擎基座在零 MOD 与纯扩展包（无基础/全转化包）状态下的全域
#           Fail-Closed 拦截契约（ERR_NO_BASE_CONTENT_MOD）及网关 UI 缺包横幅表现。
# 设计依据: 阶段验收矩阵 (TC-ZMF-01 ~ TC-ZMF-05, DOD-P130-0401)
# ==============================================================================

## TestZeroModFailClosedPipeline：零 MOD 严格 Fail-Closed 与缺包 UI 防御集成测试套件
class_name TestZeroModFailClosedPipeline
extends TestCase

const WorldGatewayViewScript = preload("res://frontend/views/world_gateway/world_gateway_view.gd")
const WORLD_GATEWAY_SCENE = preload("res://frontend/views/world_gateway/world_gateway_view.tscn")

## 执行零 MOD Fail-Closed 全量回归测试
static func run_all_tests() -> Dictionary:
	TestCase.unmount_mod_overlay_for_test()
	var results: Array[Dictionary] = []
	results.append(test_zero_mod_clean_engine_baseline())
	results.append(test_empty_and_addon_only_precheck_rejected())
	results.append(test_zero_mod_default_world_routing_rejected())
	results.append(test_zero_mod_creation_and_prologue_fail_closed())
	results.append(test_zero_mod_gateway_selection_and_ui_banner())
	TestCase.unmount_mod_overlay_for_test()
	return TestCase.pack_results("零 MOD 严格 Fail-Closed 全链路验证流水线", results)

## TC-ZMF-01: 纯引擎底座不含任何硬编码卡拉尔剧情、物品或 DAG 图元
static func test_zero_mod_clean_engine_baseline() -> Dictionary:
	TestCase.unmount_mod_overlay_for_test()
	var has_overlay: bool = GameConfig.has_active_mod_overlay()
	var items_dict: Dictionary = GameConfig.get_dict("domains.items", "items", {})
	var mod_override_items: Array = GameConfig.get_array("items.mod_overrides", "items", [])
	var dag_dict: Dictionary = GameConfig.get_dict("narratives.prologue_dag_catalog", "dag_graphs", {})
	var worlds_dict: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})
	var kalar_dag: Variant = PrologueDagRegistry.get_graph_by_id("DAG_PROLOGUE_HUMAN_CAPITAL")

	var ok: bool = not has_overlay
	ok = assert_false(items_dict.has("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"), "TC-ZMF-01A: 纯引擎不得预置卡拉尔物品") and ok
	ok = assert_true(mod_override_items.is_empty(), "TC-ZMF-01A2: 纯引擎 items.mod_overrides 必须为空") and ok
	ok = assert_true(dag_dict.is_empty(), "TC-ZMF-01B: 未挂MOD时序章DAG图谱目录必须为空") and ok
	ok = assert_true(worlds_dict.is_empty(), "TC-ZMF-01C: 未挂MOD时网关默认世界目录必须为空") and ok
	ok = assert_true(kalar_dag == null, "TC-ZMF-01D: 未挂MOD不得解析到 DAG_PROLOGUE_HUMAN_CAPITAL") and ok
	return make_result("TC-ZMF-01: 纯引擎基座零硬编码世界观与 DAG 空载核验", ok)

## TC-ZMF-02: 空包与仅含量 CONTENT_ADDON 包预检返回 ERR_NO_BASE_CONTENT_MOD
static func test_empty_and_addon_only_precheck_rejected() -> Dictionary:
	var empty_res := ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list([], ["*"])
	var empty_ok: bool = not bool(empty_res.get("success", true)) \
		and str(empty_res.get("error_code", "")) == "ERR_NO_BASE_CONTENT_MOD"

	var addon_only := {
		"pack_id": "mod_pure_addon_zmf",
		"pack_name": "无基座纯扩展包",
		"version": "1.0.0",
		"author": "ZeroGuardTest",
		"pack_profile": "CONTENT_ADDON",
		"mod_tier": "EXPANSION",
		"custom_traits": {
			"ZMF_EXTRA_TRAIT": {"name": "附加特质", "type": "POSITIVE", "cost": 1, "desc": "仅附加定义"}
		},
		"paired_presets": []
	}
	var addon_res := ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list([addon_only], ["mod_pure_addon_zmf"])
	var addon_ok: bool = not bool(addon_res.get("success", true)) \
		and str(addon_res.get("error_code", "")) == "ERR_NO_BASE_CONTENT_MOD"

	var ok: bool = empty_ok and addon_ok
	return make_result("TC-ZMF-02: 空MOD栈与无基础包纯Addon预检 Fail-Closed 阻断", ok, {
		"empty_code": empty_res.get("error_code", ""),
		"addon_code": addon_res.get("error_code", "")
	})

## TC-ZMF-03: 零 MOD 状态网关默认世界解析确定拒绝 ERR_NO_BASE_CONTENT_MOD
static func test_zero_mod_default_world_routing_rejected() -> Dictionary:
	TestCase.unmount_mod_overlay_for_test()
	var route_res := GameModeRoutingSolver.resolve_mode_entry(
		"ACC_ZMF_ROUTE_01",
		WorldGatewayModel.GameMode.SINGLE_PLAYER,
		{},
		[],
		{}
	)
	var ok: bool = not route_res.success and route_res.error_code == "ERR_NO_BASE_CONTENT_MOD"
	return make_result("TC-ZMF-03: 零 MOD 默认世界解析阻断 ERR_NO_BASE_CONTENT_MOD", ok, {
		"error_code": route_res.error_code
	})

## TC-ZMF-04: 零 MOD 权威创角、序章启动与新手套件发放全线 Fail-Closed
static func test_zero_mod_creation_and_prologue_fail_closed() -> Dictionary:
	TestFullChainBackendHelper.setup_env()
	TestCase.unmount_mod_overlay_for_test()

	var world_id := "WORLD_ZMF_ISOLATED_01"
	var world := WorldInstance.new(world_id)
	WorldArchiveRepository.get_instance().save_world(world)

	var create_req := AuthoritativeCharacterCreationRequestDTO.new()
	create_req.account_id = "ACC_ZMF_CHAR"
	create_req.world_id = world_id
	create_req.slot_id = 1
	create_req.character_name = "ZeroTester"
	create_req.request_seed = 1024

	var char_res := WorldCharacterCreationOrchestrator.create_character_authoritative(create_req, null, {})
	var char_blocked: bool = not bool(char_res.get("success", true)) \
		and str(char_res.get("error_code", "")) == "ERR_NO_BASE_CONTENT_MOD"

	var opening := OpeningEventStreamDTO.new()
	opening.account_id = "ACC_ZMF_CHAR"
	opening.character_id = "CHAR_ZMF_01"
	opening.character_name = "ZeroTester"
	opening.race_id = "HUMAN"
	opening.world_id = world_id

	var prologue_res := PrologueExecutionKernel.boot_character_prologue(opening, "HUMAN", false, {})
	var prologue_blocked: bool = not bool(prologue_res.get("success", true)) \
		and str(prologue_res.get("error_code", "")) == "ERR_NO_BASE_CONTENT_MOD"

	var p_ctx := CharacterPrologueContext.new()
	p_ctx.account_id = "ACC_ZMF_CHAR"
	p_ctx.character_id = "CHAR_ZMF_01"
	p_ctx.race_id = "HUMAN"
	var kit_res := StarterLoadoutDispatcher.dispatch_starter_kit(p_ctx, {})
	var kit_blocked: bool = not bool(kit_res.get("success", true)) \
		and str(kit_res.get("error_code", "")) == "ERR_NO_BASE_CONTENT_MOD"

	TestFullChainBackendHelper.teardown_env()
	TestCase.unmount_mod_overlay_for_test()
	var ok: bool = char_blocked and prologue_blocked and kit_blocked
	return make_result("TC-ZMF-04: 零 MOD 权威创角/序章启动/套件发放 Fail-Closed", ok, {
		"char_error": char_res.get("error_code", ""),
		"prologue_error": prologue_res.get("error_code", ""),
		"kit_error": kit_res.get("error_code", "")
	})

## TC-ZMF-05: 网关空选择阻断与 WorldGatewayView 缺少基础 MOD 横幅锁定状态渲染
static func test_zero_mod_gateway_selection_and_ui_banner() -> Dictionary:
	var fsm := WorldGatewayFSM.new("ACC_ZMF_GW_01")
	fsm.enter_gateway()
	var empty_sel := fsm.set_mod_selection([])
	var fsm_blocked: bool = not bool(empty_sel.get("success", true)) \
		and str(empty_sel.get("error_code", "")) == "ERR_NO_BASE_CONTENT_MOD"

	var view: WorldGatewayViewScript = WORLD_GATEWAY_SCENE.instantiate() as WorldGatewayViewScript
	var tree_root := (Engine.get_main_loop() as SceneTree).root
	tree_root.add_child(view)
	if not view.is_node_ready():
		view.notification(Node.NOTIFICATION_READY)
	view.apply_snapshot({
		"base_content_mod_ready": false,
		"worlds": [],
		"realms": []
	})
	var btn_disabled: bool = view.create_world_btn != null and view.create_world_btn.disabled
	var banner_ok: bool = view.base_mod_banner_label != null and not view.base_mod_banner_label.text.is_empty()
	view.free()

	var ok: bool = fsm_blocked and btn_disabled and banner_ok
	return make_result("TC-ZMF-05: 网关零选阻断与 WorldGatewayView 缺包禁止建档表现", ok, {
		"fsm_code": empty_sel.get("error_code", ""),
		"btn_disabled": btn_disabled
	})
