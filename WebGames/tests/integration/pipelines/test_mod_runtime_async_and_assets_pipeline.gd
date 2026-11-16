# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_mod_runtime_async_and_assets_pipeline.gd
# 架构定位: Integration Test Pipeline / End-to-End Runtime, Async UI & KMOD Pipeline
# 依赖与触发: 上游: TestRegistry | 下游: Tier3ContentOverrideLoader, UIIntermediary,
#           PrologueExecutionKernel, CombatHandGenerator, MapAndEcologySolver,
#           RewardDispatchPipeline, AssetPathResolver, CutsceneAsyncLoader
# 职责说明: 端到端验证 MOD 多语言分桶热切换还原、序章 DAG Hook 与路由优先级、
#           .kmod 内嵌 skill_cards/cdkeys/mod_world_topology 运行时消费、真异步延迟回调时序、
#           以及 .kmod PNG ImageTexture 异步加载与防编码穿越阻断。
# 设计依据: 阶段验收矩阵 (DOD-P132-01 ~ DOD-P132-05)
# ==============================================================================

## TestModRuntimeAsyncAndAssetsPipeline：MOD 运行时全消费、真异步 UI 与 .kmod 资产验收流水线
class_name TestModRuntimeAsyncAndAssetsPipeline
extends TestCase

const AppRootScript = preload("res://frontend/app/app_root.gd")
const ModWorkbenchScreenScript = preload("res://frontend/views/mod_workbench/mod_workbench_screen.gd")
const PrologueViewScript = preload("res://frontend/views/prologue/prologue_view.gd")
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

	func set_mod_selection_async(_account_id: String, _token: String, selected_pack_ids: Array, result_callback: Callable, _custom_roots: Array = []) -> void:
		_enqueue("set_mod_selection", result_callback, {"success": true, "data": {"selected_pack_ids": selected_pack_ids.duplicate()}})

	func precheck_mod_stack_async(_account_id: String, _token: String, enabled_pack_ids: Array, result_callback: Callable, _custom_roots: Array = []) -> void:
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


## 执行 MOD 运行时与异步资产全链路回归流水线
static func run_all_tests() -> Dictionary:
	_reset_all_state()
	var results: Array[Dictionary] = []
	results.append(test_tc_p132_01_bilingual_i18n_hot_reload_and_restore())
	results.append(test_tc_p132_02_prologue_dag_hook_and_routing_priority())
	results.append(test_tc_p132_03_kmod_domain_tables_consumption())
	results.append(test_tc_p132_04_true_async_ui_deferred_chaining())
	results.append(test_tc_p132_05_kmod_png_image_texture_and_anti_traversal())
	_reset_all_state()
	return TestCase.pack_results("MOD运行时全消费与真异步及资产闭环流水线", results)


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
static func test_tc_p132_02_prologue_dag_hook_and_routing_priority() -> Dictionary:
	_reset_all_state()
	TestFullChainBackendHelper.setup_env()
	var official_pkg := ModPackageDiscoverySolver.load_full_mod_package_from_dir("res://mods/official_kalar")
	Tier3ContentOverrideLoader.apply_enabled_packages([official_pkg])

	var ctx := CharacterPrologueContext.new()
	ctx.account_id = "ACC_P132_02"
	ctx.character_id = "CHAR_P132_02"
	ctx.character_name = "曜石旅人"
	ctx.race_id = "HUMAN"
	ctx.origin_id = "BORDER_CITIZEN"

	var eng := PrologueExecutionKernel.create_dag_session(ctx, "BORDER_CITIZEN", {})
	var receipt := PrologueCutscenePort.get_last_hook_receipt()
	var official_hook_ok := eng != null and eng.graph != null and eng.graph.graph_id == "DAG_PROLOGUE_HUMAN_CAPITAL" \
		and PrologueCutscenePort.has_hook_interceptor() and bool(receipt.get("matched", false)) \
		and str(receipt.get("cutscene_id", "")) == "cs_prologue_awakening" \
		and CutsceneHookRegistry.get_instance().is_cutscene_viewed("cs_prologue_awakening")

	var route_pkg := _build_custom_routing_mod_package()
	Tier3ContentOverrideLoader.apply_enabled_packages([official_pkg, route_pkg])
	var routed_eng := PrologueExecutionKernel.create_dag_session(ctx, "BORDER_CITIZEN", {})
	var priority_route_ok := routed_eng != null and routed_eng.graph != null and routed_eng.graph.graph_id == "DAG_P132_ALT"

	Tier3ContentOverrideLoader.revert_all_overrides()
	var cleared_viewed := not CutsceneHookRegistry.get_instance().is_cutscene_viewed("cs_prologue_awakening")
	_reset_all_state()

	return make_result("TC-P132-02: 序章 DAG Hook 实触发、清除复位与高优先级路由统一解析", official_hook_ok and priority_route_ok and cleared_viewed, {
		"detail": "official_hook_ok=%s, priority_route_ok=%s, cleared_viewed=%s, graph='%s', receipt=%s" % [
			official_hook_ok, priority_route_ok, cleared_viewed,
			str(routed_eng.graph.graph_id) if (routed_eng != null and routed_eng.graph != null) else "null",
			str(receipt)
		]
	})


## TC-P132-03: .kmod 打包内 skill_cards / cdkeys / mod_world_topology 运行时全消费
static func test_tc_p132_03_kmod_domain_tables_consumption() -> Dictionary:
	_reset_all_state()
	TestFullChainBackendHelper.setup_env()
	var kmod_path := _write_domain_tables_kmod(SANDBOX_ROOT.path_join("mod_p132_domains_1.0.0.kmod"))
	var pkg := ModPackageDiscoverySolver.load_full_mod_package_from_dir(kmod_path)
	var apply_res := Tier3ContentOverrideLoader.apply_enabled_packages([pkg])

	var hand_spec := CombatHandDrawDTO.HandDrawSpecDTO.new()
	hand_spec.is_first_encounter = true
	var hand_res := CombatHandGenerator.draw_cards_for_turn(hand_spec, DeterministicRNG.new(42))
	var card_ok := not hand_res.actual_cards.is_empty() \
		and str(hand_res.actual_cards[0].card_name) == "星芒突刺" \
		and str(hand_res.actual_cards[0].verb_type) == "LUNGE"

	var wallet := CharacterWalletEntity.new()
	var inv := WearableInventoryAggregate.new()
	inv.baseline_capacity = 10
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var cdk_res := RewardDispatchPipeline.redeem_cdkey("P132FREE", "ACC_P132_CDK", wallet, inv, catalog)
	var cdkey_ok := bool(cdk_res.get("success", false)) and wallet.gold == 777 and inv.storage_items.size() == 1 \
		and str(inv.storage_items[0].template_id) == "KALAR:EQUIP:WEAPON_BLADE:P132_STAR_ORB"

	var nodes_map := MapAndEcologySolver.build_topology_nodes_from_config()
	var path_res := MapAndEcologySolver.solve_shortest_impedance_path("NODE_GATE", "LM_SANCTUM", nodes_map)
	var landmarks := MapAndEcologySolver.get_active_landmarks()
	var world_ok := not landmarks.is_empty() and bool(path_res.get("success", false)) \
		and (path_res.get("path", []) as Array) == ["NODE_GATE", "LM_SANCTUM"]

	_reset_all_state()
	var ok := bool(apply_res.get("success", false)) and card_ok and cdkey_ok and world_ok
	return make_result("TC-P132-03: .kmod 手牌池(skill_cards)、兑换码(cdkeys)与世界拓扑(mod_world_topology)运行时消费", ok, {
		"card_ok": card_ok, "cdkey_ok": cdkey_ok, "world_ok": world_ok
	})


## TC-P132-04: 真异步延迟队列下网关、MOD 工坊及序章链式时序断言（零过早空读）
static func test_tc_p132_04_true_async_ui_deferred_chaining() -> Dictionary:
	_reset_all_state()
	ServiceLocator.set_mode("mock")
	var delayed_world := DelayedAsyncWorldService.new()
	var delayed_prologue := DelayedAsyncPrologueService.new()
	ServiceLocator.get_instance().register_service("world", delayed_world)
	ServiceLocator.get_instance().register_service("prologue", delayed_prologue)

	var app_root := _create_headless_app_root()
	var nav := NavManager.get_instance()
	var gateway := nav.push_screen("world_gateway", {"account_id": "ACC_ASYNC", "session_token": "TOK_ASYNC"}) as WorldGatewayViewScript
	var gw_pre_ok := gateway != null and gateway.saved_worlds.is_empty() and delayed_world.pending_count() > 0
	delayed_world.flush_one_batch()
	var gw_mid_ok := gateway != null and gateway.saved_worlds.size() == 1 and gateway.last_world_diagnostics.is_empty()
	delayed_world.flush_one_batch()
	var gw_post_ok := gateway != null and str(gateway.last_world_diagnostics.get("status", "")) == "MATCHED"

	var workbench := nav.push_screen("mod_workbench", {"account_id": "ACC_ASYNC", "session_token": "TOK_ASYNC"}) as ModWorkbenchScreenScript
	var mw_pre_ok := workbench != null and workbench.installed_packs.is_empty()
	delayed_world.flush_one_batch()
	var mw_list_ok := workbench != null and workbench.installed_packs.size() == 1
	workbench._get_tabs().commit_selection_and_precheck()
	var mw_chain_pre := delayed_world.last_op == "set_mod_selection" and workbench.precheck_report.is_empty()
	delayed_world.flush_one_batch()
	var mw_chain_mid := delayed_world.last_op == "precheck_mod_stack" and workbench.precheck_report.is_empty()
	delayed_world.flush_one_batch()
	var precheck_data: Dictionary = workbench.precheck_report.get("data", workbench.precheck_report) as Dictionary
	var mw_post_ok := bool(precheck_data.get("has_base_content_mod", false))

	var prologue := nav.push_screen("prologue", {"account_id": "ACC_ASYNC", "session_token": "TOK_ASYNC", "world_id": "W_P132_ASYNC"}) as PrologueViewScript
	var pro_pre_ok := prologue != null and prologue.current_node_id.is_empty() and delayed_prologue.last_op == "get_prologue_state"
	delayed_prologue.flush_one_batch()
	var pro_mid_ok := delayed_prologue.last_op == "start_prologue" and prologue.current_node_id.is_empty()
	delayed_prologue.flush_one_batch()
	var pro_post_ok := prologue.current_node_id == "NODE_ASYNC_01" and prologue.current_dag_id == "DAG_ASYNC_01"

	NavManager.reset_instance()
	app_root.free()
	_reset_all_state()

	var ok := gw_pre_ok and gw_mid_ok and gw_post_ok and mw_pre_ok and mw_list_ok \
		and mw_chain_pre and mw_chain_mid and mw_post_ok and pro_pre_ok and pro_mid_ok and pro_post_ok
	return make_result("TC-P132-04: 真异步延迟队列下网关/工坊/序章前不空读、回调后准确链式落盘", ok, {
		"detail": "gw=%s/%s/%s, mw=%s/%s/%s/%s/%s, pro=%s/%s/%s" % [
			gw_pre_ok, gw_mid_ok, gw_post_ok,
			mw_pre_ok, mw_list_ok, mw_chain_pre, mw_chain_mid, mw_post_ok,
			pro_pre_ok, pro_mid_ok, pro_post_ok
		]
	})


## TC-P132-05: .kmod 内嵌 PNG 解码为 ImageTexture 及编码路径穿越严格拦截
static func test_tc_p132_05_kmod_png_image_texture_and_anti_traversal() -> Dictionary:
	_reset_all_state()
	var assets_root := SANDBOX_ROOT.path_join("art_mods")
	var kmod_path := assets_root.path_join("mod_p132_art_1.2.0.kmod")
	var img := Image.create(2, 2, false, Image.FORMAT_RGBA8)
	img.fill(Color.CRIMSON)
	_write_single_file_kmod(kmod_path, "mod_p132_art", "1.2.0", "assets/cutscenes/awakening.png", img.save_png_to_buffer())

	AssetPathResolver.set_test_roots_override([assets_root])
	var uri := AssetPathResolver.resolve_unified_uri("mod://cutscenes/awakening.png", "mod_p132_art")
	var uri_ok := uri.ends_with(".kmod!/assets/cutscenes/awakening.png") and AssetPathResolver.asset_exists(uri)

	var loader := CutsceneAsyncLoader.get_instance()
	loader.set_deterministic_mode(false)
	loader.clear_cache_and_tasks()
	var holder: Dictionary = {"tex": null}
	loader.request_load(uri, 1, func(res: Resource) -> void:
		holder["tex"] = res
	)
	var tex: Variant = holder.get("tex", null)
	var tex_ok := tex is ImageTexture and (tex as ImageTexture).get_width() == 2

	var traversal_ok := AssetPathResolver.resolve_unified_uri("mod://mod_p132_art/%2e%2e/secret.png").is_empty() \
		and AssetPathResolver.resolve_mod_asset_path("mod_p132_art", "cutscenes/null%00.png").is_empty()

	loader.clear_cache_and_tasks()
	_reset_all_state()
	return make_result("TC-P132-05: .kmod PNG 解码为 ImageTexture 与编码路径穿越严格阻断", uri_ok and tex_ok and traversal_ok, {
		"detail": "uri_ok=%s('%s'), tex_ok=%s, traversal_ok=%s" % [uri_ok, uri, tex_ok, traversal_ok]
	})


static func _build_custom_routing_mod_package() -> Dictionary:
	var route_dir := SANDBOX_ROOT.path_join("mod_p132_route")
	var rules := [{"rule_id": "R_P132_HIGH", "priority": 999, "origin_id": "BORDER_CITIZEN", "dag_id": "DAG_P132_ALT"}]
	TestTier3ContentOverrideHelper.write_json_file(route_dir.path_join("pack.json"), {
		"pack_id": "mod_p132_route", "pack_name": "P132 Route", "version": "1.0.0",
		"pack_profile": "CONTENT_ADDON", "mod_tier": "EXPANSION", "priority": 350, "is_active": true,
		"prologue_routing_rules": rules
	})
	TestTier3ContentOverrideHelper.write_json_file(route_dir.path_join("routing_rules.json"), {
		"prologue_routing_rules": rules
	})
	TestTier3ContentOverrideHelper.write_json_file(route_dir.path_join("dag_graphs/DAG_P132_ALT.json"), {
		"dag_id": "DAG_P132_ALT", "entry_node_id": "N_ALT_0", "terminal_node_id": "N_ALT_1",
		"nodes": {
			"N_ALT_0": {"node_type": "START_ENTRY", "narrative_key": "narrative.p132.alt0"},
			"N_ALT_1": {"node_type": "TERMINAL_EXIT", "narrative_key": "narrative.p132.alt1", "required_prerequisites": ["N_ALT_0"]}
		},
		"edges": [{"from": "N_ALT_0", "to": "N_ALT_1"}]
	})
	return ModPackageDiscoverySolver.load_full_mod_package_from_dir(route_dir)


static func _write_domain_tables_kmod(kmod_path: String) -> String:
	DirAccess.make_dir_recursive_absolute(kmod_path.get_base_dir())
	var packer := ZIPPacker.new()
	if packer.open(kmod_path) != OK:
		return kmod_path
	_pack_json_entry(packer, "pack.json", {
		"pack_id": "mod_p132_domains", "pack_name": "P132 Domains", "version": "1.0.0",
		"pack_profile": "TOTAL_CONVERSION", "mod_tier": "TOTAL_CONVERSION", "priority": 280, "is_active": true
	})
	_pack_json_entry(packer, "content/items/p132_items.json", {
		"override_mode": "MERGE",
		"items": [{
			"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:P132_STAR_ORB", "english_name": "p132_star_orb",
			"loc_name_key": "item.p132_star_orb.name", "category_major": "EQUIPMENT",
			"category_minor": "WEAPON_BLADE", "tier_rank": 3, "default_mass_kg": 1.0,
			"default_volume_slots": 1, "base_market_value": 300
		}]
	})
	_pack_json_entry(packer, "content/skills/p132_skills.json", {
		"override_mode": "MERGE",
		"verbs": {"LUNGE": {"name": "突刺", "k_mom": 1.2, "k_edge": 1.1, "base_ap": -2}},
		"skill_cards": [{"card_id": "CARD_P132_ASTRAL", "verb_type": "LUNGE", "name": "星芒突刺", "ap_cost": -1, "base_potency": 42.0}]
	})
	_pack_json_entry(packer, "content/rules/p132_rules.json", {
		"override_mode": "MERGE",
		"cdkeys": {"P132FREE": {"gold": 777, "crystals": 5, "item_id": "KALAR:EQUIP:WEAPON_BLADE:P132_STAR_ORB", "item_name": "星辰宝珠"}}
	})
	_pack_json_entry(packer, "content/world/p132_world.json", {
		"override_mode": "MERGE", "map_id": "MAP_P132", "map_name": "星辉裂隙", "default_entry_node": "NODE_GATE",
		"nodes": [{"node_id": "NODE_GATE", "name": "星门", "terrain_type": "PLAINS", "x": 0.0, "y": 0.0}],
		"edges": [{"from": "NODE_GATE", "to": "LM_SANCTUM", "distance": 6.5, "bidirectional": true}],
		"landmarks": [{"id": "LM_SANCTUM", "name": "苍穹圣所", "terrain_type": "PLAINS", "x": 10.0, "y": 0.0}]
	})
	packer.close()
	return kmod_path


static func _write_single_file_kmod(kmod_path: String, pack_id: String, ver: String, entry_path: String, raw_bytes: PackedByteArray) -> void:
	DirAccess.make_dir_recursive_absolute(kmod_path.get_base_dir())
	var packer := ZIPPacker.new()
	if packer.open(kmod_path) != OK:
		return
	_pack_json_entry(packer, "pack.json", {"pack_id": pack_id, "version": ver})
	packer.start_file(entry_path)
	packer.write_file(raw_bytes)
	packer.close_file()
	packer.close()


static func _pack_json_entry(packer: ZIPPacker, entry_path: String, payload: Variant) -> void:
	packer.start_file(entry_path)
	packer.write_file(JSON.stringify(payload).to_utf8_buffer())
	packer.close_file()


static func _create_headless_app_root() -> Node:
	NavManager.reset_instance()
	var app_root := AppRootScript.new()
	app_root.name = "TestPhase132AppRoot"
	var screen_layer := CanvasLayer.new()
	screen_layer.name = "ScreenLayer"
	var container := Control.new()
	container.name = "ScreenContainer"
	screen_layer.add_child(container)
	app_root.add_child(screen_layer)
	app_root.screen_container = container
	(Engine.get_main_loop() as SceneTree).root.add_child(app_root)
	NavManager.get_instance().bind_root(app_root)
	return app_root


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
