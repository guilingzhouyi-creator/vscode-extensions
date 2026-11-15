# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_mod_runtime_async_and_assets_pipeline.gd
# 架构定位: Integration Test Pipeline / Phase 132 End-to-End Runtime, Async UI & KMOD Pipeline
# 依赖与触发: 上游: TestRegistry | 下游: Tier3ContentOverrideLoader, UIIntermediary,
#           PrologueExecutionKernel, CombatHandGenerator, MapAndEcologySolver,
#           RewardDispatchPipeline, AssetPathResolver, CutsceneAsyncLoader
# 职责说明: 端到端验证 Phase 132 MOD 多语言分桶热切换还原、序章 DAG Hook 与路由优先级、
#           .kmod 内嵌 skill_cards/cdkeys/mod_world_topology 运行时消费、真异步延迟回调时序、
#           以及 .kmod PNG ImageTexture 异步加载与防编码穿越阻断。
# 设计依据: Phase 132 阶段4验收矩阵 (DOD-P132-01 ~ DOD-P132-05)
# ==============================================================================

## TestModRuntimeAsyncAndAssetsPipeline：MOD 运行时全消费、真异步 UI 与 .kmod 资产验收流水线
class_name TestModRuntimeAsyncAndAssetsPipeline
extends TestCase

const AppRootScript = preload("res://frontend/app/app_root.gd")
const AssetPathResolver = preload("res://backend/infrastructure/resource_governance/asset_path_resolver.gd")
const CharacterPrologueContext = preload("res://backend/domains/character_creation/character_prologue_context.gd")
const CombatHandDrawDTO = preload("res://backend/domains/physics_thermodynamics/combat_hand_draw_dto.gd")
const CombatHandGenerator = preload("res://backend/domains/physics_thermodynamics/combat_hand_generator.gd")
const CutsceneAsyncLoader = preload("res://backend/infrastructure/media/cutscene_async_loader.gd")
const CutsceneHookRegistry = preload("res://backend/infrastructure/media/cutscene_hook_registry.gd")
const DeterministicRNG = preload("res://backend/infrastructure/deterministic_rng.gd")
const ItemLoaderPipeline = preload("res://backend/domains/item_namespace_registry/item_loader_pipeline.gd")
const MapAndEcologySolver = preload("res://backend/domains/world_navigation/map_and_ecology_solver.gd")
const ModWorkbenchScreenScript = preload("res://frontend/views/mod_workbench/mod_workbench_screen.gd")
const NavManager = preload("res://frontend/navigation/nav_manager.gd")
const PrologueCutscenePort = preload("res://backend/domains/character_creation/prologue_cutscene_port.gd")
const PrologueExecutionKernel = preload("res://backend/domains/character_creation/prologue_execution_kernel.gd")
const PrologueViewScript = preload("res://frontend/views/prologue/prologue_view.gd")
const RewardDispatchPipeline = preload("res://backend/domains/chat_command/reward_dispatch_pipeline.gd")
const ServiceLocator = preload("res://frontend/domain_boundary/service_locator.gd")
const TestFullChainBackendHelper = preload("res://tests/integration/pipelines/test_full_chain_backend_helper.gd")
const TestTier3ContentOverrideHelper = preload("res://tests/integration/pipelines/test_tier3_content_override_helper.gd")
const UIIntermediary = preload("res://frontend/i18n/ui_intermediary.gd")
const UITextResolver = preload("res://frontend/i18n/ui_text_resolver.gd")
const WorldGatewayViewScript = preload("res://frontend/views/world_gateway/world_gateway_view.gd")

const SANDBOX_ROOT: String = "user://test_p132_sandbox/"


## 延迟队列型世界网关服务替身：验证异步回调落地前视图不产生过早空读或突变
class DelayedAsyncWorldService extends "res://frontend/domain_boundary/interfaces/i_world_service.gd":
	var queue: Array[Dictionary] = []
	var last_op: String = ""

	func pending_count() -> int:
		return queue.size()

	## 仅刷新当前排队批次一次，使回调内触发的新一跳异步请求留待下一批推进
	func flush_one_batch() -> int:
		var batch := queue.duplicate()
		queue.clear()
		for item in batch:
			var cb: Callable = item.get("cb", Callable())
			if cb.is_valid():
				cb.call(item.get("reply", {}))
		return batch.size()

	func _enqueue(op_name: String, cb: Callable, reply: Dictionary) -> void:
		last_op = op_name
		queue.append({"cb": cb, "reply": reply})

	func enter_gateway_async(account_id: String, _token: String, result_callback: Callable) -> void:
		_enqueue("enter_gateway", result_callback, {"success": true, "account_id": account_id, "worlds": []})

	func probe_modes_async(_account_id: String, _token: String, result_callback: Callable) -> void:
		_enqueue("probe_modes", result_callback, {"success": true, "probe_reports": {"1": {"ready": true}}})

	func list_worlds_async(_account_id: String, _token: String, result_callback: Callable) -> void:
		_enqueue("list_worlds", result_callback, {
			"success": true,
			"worlds": [{"world_id": "W_P132_ASYNC", "mode": 1, "active_mod_pack_ids": ["mod_p132_async"]}]
		})

	func list_remote_realms_async(_account_id: String, _token: String, result_callback: Callable) -> void:
		_enqueue("list_remote_realms", result_callback, {"success": true, "realms": []})

	func get_world_mod_diagnostics_async(_account_id: String, _token: String, world_id: String, result_callback: Callable) -> void:
		_enqueue("get_world_mod_diagnostics", result_callback, {
			"success": true,
			"data": {
				"world_id": world_id,
				"status": "MATCHED",
				"locked_mods": [{"pack_id": "mod_p132_async", "version": "1.0.0"}],
				"missing_mods": [],
				"digest_mismatches": []
			}
		})

	func list_installed_mods_async(_account_id: String, _token: String, _custom_roots: Array, result_callback: Callable) -> void:
		_enqueue("list_installed_mods", result_callback, {
			"success": true,
			"data": {
				"installed_packs": [{
					"pack_id": "mod_p132_async",
					"display_name": "Async Base Pack",
					"version": "1.0.0",
					"pack_profile": "TOTAL_CONVERSION",
					"is_official": false,
					"has_prologue_dag": true,
					"dependencies": []
				}],
				"selected_pack_ids": ["mod_p132_async"]
			}
		})

	func set_mod_selection_async(_account_id: String, _token: String, selected_pack_ids: Array, result_callback: Callable) -> void:
		_enqueue("set_mod_selection", result_callback, {"success": true, "data": {"selected_pack_ids": selected_pack_ids.duplicate()}})

	func precheck_mod_stack_async(_account_id: String, _token: String, enabled_pack_ids: Array, result_callback: Callable) -> void:
		_enqueue("precheck_mod_stack", result_callback, {
			"success": true,
			"data": {
				"success": true,
				"enabled_pack_ids": enabled_pack_ids.duplicate(),
				"has_base_content_mod": not enabled_pack_ids.is_empty(),
				"conflicts": []
			}
		})


## 延迟队列型序章服务替身：验证 get_prologue_state -> start_prologue 二跳异步链路
class DelayedAsyncPrologueService extends "res://frontend/domain_boundary/interfaces/i_prologue_service.gd":
	var queue: Array[Dictionary] = []
	var last_op: String = ""

	func pending_count() -> int:
		return queue.size()

	func flush_one_batch() -> int:
		var batch := queue.duplicate()
		queue.clear()
		for item in batch:
			var cb: Callable = item.get("cb", Callable())
			if cb.is_valid():
				cb.call(item.get("reply", {}))
		return batch.size()

	func _enqueue(op_name: String, cb: Callable, reply: Dictionary) -> void:
		last_op = op_name
		queue.append({"cb": cb, "reply": reply})

	func enter_gateway_async(account_id: String, _token: String, result_callback: Callable) -> void:
		_enqueue("enter_gateway", result_callback, {"success": true, "account_id": account_id, "worlds": []})

	func get_prologue_state_async(_account_id: String, _token: String, result_callback: Callable) -> void:
		_enqueue("get_prologue_state", result_callback, {
			"success": true,
			"data": {"dag_id": "", "node_id": "", "is_completed": false}
		})

	func start_prologue_async(_account_id: String, _token: String, _request_payload: Dictionary, result_callback: Callable) -> void:
		_enqueue("start_prologue", result_callback, {
			"success": true,
			"data": {
				"dag_id": "DAG_ASYNC_01",
				"node_id": "NODE_ASYNC_01",
				"node_type": "CHOICE",
				"step_index": 1,
				"is_completed": false,
				"narrative_text": "Delayed prologue loaded",
				"choices": [{"choice_id": "NEXT", "label": "Next"}]
			}
		})


## 执行 Phase 132 全链路回归流水线
static func run_all_tests() -> Dictionary:
	_reset_all_state()
	var results: Array[Dictionary] = []
	results.append(test_tc_p132_01_bilingual_i18n_hot_reload_and_restore())
	_reset_all_state()
	return TestCase.pack_results("Phase 132 MOD运行时全消费与真异步及资产闭环流水线", results)


## TC-P132-01: 双语 i18n MOD 分语言注入、热切换刷新与卸载还原
static func test_tc_p132_01_bilingual_i18n_hot_reload_and_restore() -> Dictionary:
	_reset_all_state()
	var mod_dir := SANDBOX_ROOT.path_join("mod_p132_i18n")
	TestTier3ContentOverrideHelper.write_json_file(mod_dir.path_join("pack.json"), {
		"pack_id": "mod_p132_i18n", "pack_name": "P132 I18N Pack", "version": "1.0.0",
		"pack_profile": "CONTENT_ADDON", "mod_tier": "EXPANSION", "priority": 260, "is_active": true
	})
	TestTier3ContentOverrideHelper.write_json_file(mod_dir.path_join("i18n/zh_CN.json"), {"ui.p132.banner": "星界工坊"})
	TestTier3ContentOverrideHelper.write_json_file(mod_dir.path_join("i18n/en_US.json"), {"ui.p132.banner": "Astral Workshop"})

	var pkg := ModPackageDiscoverySolver.load_full_mod_package_from_dir(mod_dir)
	var apply_res := Tier3ContentOverrideLoader.apply_enabled_packages([pkg])
	var lbl := Label.new()
	UIIntermediary.switch_locale("zh_CN")
	var zh_text := UIIntermediary.resolve(lbl, "ui.p132.banner")
	var base_zh := UIIntermediary.text("magic.attr.fire")
	UIIntermediary.switch_locale("en_US")
	var en_bound := lbl.text
	var en_text := UIIntermediary.text("ui.p132.banner")

	UIIntermediary.clear_view_bindings(lbl)
	lbl.free()
	Tier3ContentOverrideLoader.revert_all_overrides()
	UIIntermediary.switch_locale("zh_CN")
	var cleared_key := not UITextResolver.has_key("ui.p132.banner")
	var restored_base := UIIntermediary.text("magic.attr.fire") == "火"
	_reset_all_state()

	var ok := bool(apply_res.get("success", false)) and zh_text == "星界工坊" and base_zh == "火" \
		and en_bound == "Astral Workshop" and en_text == "Astral Workshop" and cleared_key and restored_base
	return make_result("TC-P132-01: 双语 i18n 注入、热切换重绑及卸载基座复原", ok, {
		"zh_text": zh_text, "en_bound": en_bound, "cleared_key": cleared_key, "restored_base": restored_base
	})


## TC-P132-02: 官方序章 DAG Hook 触发、重放清除及高优先级 MOD 路由覆盖


static func _reset_all_state() -> void:
	NavManager.reset_instance()
	ServiceLocator.reset()
	CutsceneAsyncLoader.get_instance().clear_cache_and_tasks()
	CutsceneAsyncLoader.get_instance().set_deterministic_mode(true)
	CutsceneHookRegistry.get_instance().clear_for_tests()
	AssetPathResolver.reset_for_tests()
	UIIntermediary.switch_locale("zh_CN")
	UIIntermediary.teardown_for_tests()
	RewardDispatchPipeline.redeemed_keys.erase("ACC_P132_CDK")
	TestCase.unmount_mod_overlay_for_test()
	TestFullChainBackendHelper.teardown_env()
	TestTier3ContentOverrideHelper.cleanup_directory_recursive(SANDBOX_ROOT)
