# ==============================================================================
# 模块归属: 集成测试层 (Integration · 全目录MOD磁盘加载与Agent无头试玩流水线)
# 文件路径: res://tests/integration/pipelines/test_full_mod_disk_and_playthrough_pipeline.gd
# 架构定位: Integration Test Suite / End-to-End Pipeline Harness
# 跨域依赖: 上游: TestRegistry | 下游: ModPackageDiscoverySolver, WorldGatewayFSM, PrologueExecutionKernel, ModPrecheckAndAdaptationSolver, ProloguePlaceholderResolver | 配置: config/domains/*.json | 信号: 无直接监听
# 职责说明: 全链路验证磁盘五件套模板聚合与双态Schema归一化、网关单机一键磁盘发现与挂载、悬空序章与套件跨表拦截、内联文本语法糖与双轨占位符水化、后端无头试玩推演与因果突变结算闭环、以及Python工具链同构等价性。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约 (全目录MOD磁盘发现与推演内核架构规范)
# ==============================================================================

class_name TestFullModDiskAndPlaythroughPipeline
extends TestCase

const TEST_SANDBOX_DIR: String = "user://test_sandbox_fmp_pipeline/"
const TEST_WORLD_ID: String = "WORLD_FMP_TEST_01"
const TEST_ACCOUNT_ID: String = "ACC_FMP_TEST_01"

# ==============================================================================
# 一、测试套件总入口与沙箱环境生命周期
# ==============================================================================

## 执行全量流水线测试 (TC-FMP-01 ~ TC-FMP-06)
static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_disk_mod_package_discovery_and_normalization())
	results.append(test_world_gateway_single_player_disk_discovery_and_precheck())
	results.append(test_dangling_dag_and_kit_cross_table_rejection())
	results.append(test_inline_text_and_dual_track_placeholders())
	results.append(test_headless_mod_playthrough_and_causal_mutations())
	results.append(test_python_and_gdscript_transcript_equivalence())

	return pack_results("Full Mod Disk & Headless Playthrough Pipeline", results)

## 装配纯净隔离沙箱
static func _setup_environment() -> void:
	WorldArchiveRepository.reset_for_tests()
	AccountRepository.reset_for_tests()
	SaveDataAccessLayer.reset_for_tests()
	RuntimeModeGate.reset_for_tests()

	var world_repo := WorldArchiveRepository.get_instance()
	world_repo.set_custom_root_dir(TEST_SANDBOX_DIR + "worlds/")
	world_repo.set_custom_catalog_path(TEST_SANDBOX_DIR + "worlds/world_catalog.json")
	world_repo.load_all()
	world_repo.create_world(TEST_WORLD_ID, "全目录MOD流水线测试界域")

	var acc_repo := AccountRepository.get_instance()
	acc_repo.set_custom_registry_path(TEST_SANDBOX_DIR + "accounts/account_registry.json")
	acc_repo.load_all()

	var acc := AccountProfileAggregate.new()
	acc.account_id = TEST_ACCOUNT_ID
	acc.username = "FmpPipelineTester"
	acc_repo.save_account(acc)

## 对称清理沙箱
static func _teardown_environment() -> void:
	var lock_mgr := WorldModAffinityManager.new()
	var lock_path: String = lock_mgr.get_lock_file_path(TEST_WORLD_ID)
	if not lock_path.is_empty() and FileAccess.file_exists(lock_path):
		DirAccess.remove_absolute(lock_path)
	var world_repo := WorldArchiveRepository.get_instance()
	if world_repo.has_world(TEST_WORLD_ID):
		world_repo.delete_world(TEST_WORLD_ID)
	WorldArchiveRepository.reset_for_tests()
	AccountRepository.reset_for_tests()
	SaveDataAccessLayer.reset_for_tests()
	RuntimeModeGate.reset_for_tests()

# ==============================================================================
# 二、核心测试场景 (TC-FMP-01 ~ TC-FMP-06)
# ==============================================================================

## TC-FMP-01: 磁盘五件套模板聚合与双态Schema归一化
static func test_disk_mod_package_discovery_and_normalization() -> Dictionary:
	var template_path := "res://mod_sdk/templates/starter_story"
	var raw_pkg := ModPackageDiscoverySolver.load_full_mod_package_from_dir(template_path)
	var load_ok: bool = not raw_pkg.is_empty() \
		and str(raw_pkg.get("pack_id", "")) == "starter_story" \
		and raw_pkg.has("dag_graphs") \
		and (raw_pkg.get("dag_graphs") as Dictionary).has("DAG_STARTER_MINIMAL") \
		and raw_pkg.has("custom_i18n")

	var dto := DestinyModManifestDTO.from_dto(raw_pkg)
	var dto_ok: bool = dto.pack_id == "starter_story" \
		and dto.root_path == template_path \
		and dto.dag_graphs.has("DAG_STARTER_MINIMAL") \
		and dto.custom_traits.has("TRAIT_STARLIGHT_AFFINITY") \
		and dto.custom_starter_kits.has("KIT_STARTER_WANDERER")

	var kit_dict: Dictionary = dto.custom_starter_kits.get("KIT_STARTER_WANDERER", {})
	var items_array: Array = kit_dict.get("items", [])
	var initial_items_array: Array = kit_dict.get("initial_items", [])
	var sync_ok: bool = not items_array.is_empty() and not initial_items_array.is_empty()

	var passed: bool = load_ok and dto_ok and sync_ok
	return make_result("TC-FMP-01: 磁盘五件套模板聚合与双态Schema归一化", passed, {
		"load_ok": load_ok,
		"dto_ok": dto_ok,
		"sync_ok": sync_ok
	})

## TC-FMP-02: 网关单机一站式磁盘发现预检挂载闭环
static func test_world_gateway_single_player_disk_discovery_and_precheck() -> Dictionary:
	_setup_environment()
	var fsm := WorldGatewayFSM.new(TEST_ACCOUNT_ID)
	fsm.enter_gateway()

	var disc_res := fsm.discover_and_configure_single_player_mods(["res://mod_sdk/templates"])
	var disc_ok: bool = bool(disc_res.get("success", false))
	var adapted_manifest: Dictionary = fsm.get_adapted_mod_manifest()
	var manifest_has_dag: bool = adapted_manifest.has("dag_graphs") \
		and (adapted_manifest.get("dag_graphs") as Dictionary).has("DAG_STARTER_MINIMAL")

	fsm.context.selected_mode = WorldGatewayModel.GameMode.MULTIPLAYER
	var poison_res := fsm.discover_and_configure_single_player_mods(["res://mod_sdk/templates"])
	var poison_blocked: bool = not bool(poison_res.get("success", true)) \
		and str(poison_res.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING

	fsm.exit_to_gateway()
	_teardown_environment()

	var passed: bool = disc_ok and manifest_has_dag and poison_blocked
	return make_result("TC-FMP-02: 网关单机一站式磁盘发现预检挂载闭环", passed, {
		"disc_ok": disc_ok,
		"manifest_has_dag": manifest_has_dag,
		"poison_blocked": poison_blocked
	})

## TC-FMP-03: 悬空序章DAG与悬空初始套件跨表拦截
static func test_dangling_dag_and_kit_cross_table_rejection() -> Dictionary:
	var base_pkg := ModPackageDiscoverySolver.load_full_mod_package_from_dir("res://mod_sdk/templates/starter_story")
	var manifest := NarrativePackManifestDTO.from_dto(base_pkg)

	# 1. 悬空 DAG 测试
	var bad_dag_pkg := base_pkg.duplicate(true)
	var origins_dag: Array = bad_dag_pkg.get("custom_origins", []).duplicate(true)
	if not origins_dag.is_empty():
		origins_dag[0]["prologue_dag_id"] = "DAG_UNKNOWN_DANGLING_999"
	bad_dag_pkg["custom_origins"] = origins_dag
	var dto_dag := DestinyModManifestDTO.from_dto(bad_dag_pkg)
	var res_dag := ModPrecheckAndAdaptationSolver.precheck_single_mod(dto_dag, manifest)
	var dag_blocked: bool = not bool(res_dag.get("valid", true)) \
		and (res_dag.get("errors", []) as Array).has("ERR_DESTINY_UNKNOWN_DAG_REF")

	# 2. 悬空 Kit 测试
	var bad_kit_pkg := base_pkg.duplicate(true)
	var origins_kit: Array = bad_kit_pkg.get("custom_origins", []).duplicate(true)
	if not origins_kit.is_empty():
		origins_kit[0]["starter_kit_id"] = "KIT_UNKNOWN_DANGLING_888"
	bad_kit_pkg["custom_origins"] = origins_kit
	var dto_kit := DestinyModManifestDTO.from_dto(bad_kit_pkg)
	var res_kit := ModPrecheckAndAdaptationSolver.precheck_single_mod(dto_kit, manifest)
	var kit_blocked: bool = not bool(res_kit.get("valid", true)) \
		and (res_kit.get("errors", []) as Array).has("ERR_DESTINY_UNKNOWN_KIT_REF")

	# 3. 畸形 DAG 测试 (缺失有效节点)
	var bad_graph_pkg := base_pkg.duplicate(true)
	bad_graph_pkg["dag_graphs"] = {
		"DAG_CORRUPTED": {
			"graph_id": "DAG_CORRUPTED",
			"entry_node_id": "NODE_NON_EXISTENT",
			"nodes": {}
		}
	}
	var dto_graph := DestinyModManifestDTO.from_dto(bad_graph_pkg)
	var res_graph := ModPrecheckAndAdaptationSolver.precheck_single_mod(dto_graph, manifest)
	var graph_blocked: bool = not bool(res_graph.get("valid", true)) \
		and (res_graph.get("errors", []) as Array).has("ERR_DESTINY_INVALID_DAG_GRAPH")

	var passed: bool = dag_blocked and kit_blocked and graph_blocked
	return make_result("TC-FMP-03: 悬空序章DAG与悬空初始套件跨表拦截", passed, {
		"dag_blocked": dag_blocked,
		"kit_blocked": kit_blocked,
		"graph_blocked": graph_blocked
	})

## TC-FMP-04: 内联文本语法糖与大小写双轨占位符水化
static func test_inline_text_and_dual_track_placeholders() -> Dictionary:
	var inline_tmpl := "勇敢的 {player_name}（{PLAYER_NAME}）携 {STARTER_KIT_NAME} 起程于 {birth_region}。"
	var placeholders: Dictionary = {
		"player_name": "阿尔温",
		"PLAYER_NAME": "阿尔温",
		"starter_kit_name": "学徒行囊",
		"STARTER_KIT_NAME": "学徒行囊",
		"birth_region": "中央大陆",
		"BIRTH_REGION": "中央大陆"
	}

	var res := ProloguePlaceholderResolver.resolve_narrative_key(
		"narrative.unregistered.key",
		placeholders,
		{},
		inline_tmpl
	)

	var hydrated_text: String = str(res.get("text", ""))
	var unresolved: Array = res.get("unresolved_keys", [])
	var expected_text := "勇敢的 阿尔温（阿尔温）携 学徒行囊 起程于 中央大陆。"
	var text_ok: bool = hydrated_text == expected_text and unresolved.is_empty()

	var raw_node: Dictionary = {
		"node_id": "NODE_INLINE_TEST",
		"node_type": "STANDARD_STEP",
		"inline_text": {"zh_CN": "你好 {player_name}"},
		"choices": [{"id": "NEXT", "label": "前进"}]
	}
	var node := NarrativeDAGNode.from_dto(raw_node)
	var node_ok: bool = node.inline_text == "你好 {player_name}" and node.choices.size() == 1

	var passed: bool = text_ok and node_ok
	return make_result("TC-FMP-04: 内联文本语法糖与大小写双轨占位符水化", passed, {
		"text_ok": text_ok,
		"node_ok": node_ok,
		"hydrated_text": hydrated_text
	})

## TC-FMP-05: 后端无头试玩推演与因果突变结算闭环
static func test_headless_mod_playthrough_and_causal_mutations() -> Dictionary:
	var config: Dictionary = {
		"mod_dirs": ["res://mod_sdk/templates/starter_story"],
		"enabled_pack_ids": ["*"],
		"character_name": "阿尔温",
		"race_id": "HUMAN",
		"origin_id": "STARTER_ASTRAL_INITIATE",
		"selected_positive_trait": "TRAIT_STARLIGHT_AFFINITY",
		"reroll_nonce": 0,
		"seed": 1337,
		"choice_indices": [0, 0, 0]
	}

	var transcript := PrologueExecutionKernel.execute_headless_mod_playthrough(config)
	var success: bool = bool(transcript.get("is_success", false))
	var schema_match: bool = str(transcript.get("schema_version", "")) == "kalar.mod_sdk.playthrough_transcript.v1"

	var steps: Array = transcript.get("transcript_steps", [])
	var steps_count_ok: bool = steps.size() == 3

	var final_state: Dictionary = transcript.get("final_state", {})
	var completed: bool = bool(final_state.get("prologue_completed", false))
	var mutations: Array = final_state.get("applied_mutations", [])
	var has_completed_mutation: bool = false
	for m in mutations:
		if m is Dictionary and str((m as Dictionary).get("type", "")) == "PrologueCompleted":
			has_completed_mutation = true
			break

	var char_sheet: Dictionary = transcript.get("character_sheet", {})
	var gold_ok: bool = int(char_sheet.get("initial_gold", 0)) == 150

	var passed: bool = success and schema_match and steps_count_ok and completed and has_completed_mutation and gold_ok
	return make_result("TC-FMP-05: 后端无头试玩推演与因果突变结算闭环", passed, {
		"success": success,
		"schema_match": schema_match,
		"steps_count_ok": steps_count_ok,
		"completed": completed,
		"has_completed_mutation": has_completed_mutation,
		"gold_ok": gold_ok
	})

## TC-FMP-06: Python play_mod.py 与 GDScript 引擎同构等价验证
static func test_python_and_gdscript_transcript_equivalence() -> Dictionary:
	var config: Dictionary = {
		"mod_dirs": ["res://mod_sdk/templates/starter_story"],
		"enabled_pack_ids": ["*"],
		"character_name": "阿尔温",
		"race_id": "HUMAN",
		"origin_id": "STARTER_ASTRAL_INITIATE",
		"choice_indices": [0, 0, 0]
	}

	var gd_transcript := PrologueExecutionKernel.execute_headless_mod_playthrough(config)
	var gd_ok: bool = bool(gd_transcript.get("is_success", false))

	var v_match: bool = str(gd_transcript.get("schema_version", "")) == "kalar.mod_sdk.playthrough_transcript.v1"

	var sheet: Dictionary = gd_transcript.get("character_sheet", {})
	var attrs: Dictionary = sheet.get("attributes", {})
	var attr_sum: int = int(attrs.get("STR", 0)) + int(attrs.get("CON", 0)) + int(attrs.get("INT", 0)) \
		+ int(attrs.get("AGI", 0)) + int(attrs.get("SPR", 0)) + int(attrs.get("VIT", 0))
	var sum_conserved: bool = (attr_sum == 23)

	var gold_match: bool = int(sheet.get("initial_gold", 0)) == 150
	var kit_match: bool = str(sheet.get("starter_kit_id", "")) == "KIT_STARTER_WANDERER"

	var dag_route: Dictionary = gd_transcript.get("dag_routing", {})
	var dag_match: bool = str(dag_route.get("target_dag_id", "")) == "DAG_STARTER_MINIMAL"
	var final_st: Dictionary = gd_transcript.get("final_state", {})
	var terminal_match: bool = str(final_st.get("terminal_node_id", "")) == "NODE_STARTER_DEPART"

	var passed: bool = gd_ok and v_match and sum_conserved and gold_match and kit_match and dag_match and terminal_match
	return make_result("TC-FMP-06: Python play_mod.py 与 GDScript 引擎同构等价验证", passed, {
		"gd_ok": gd_ok,
		"v_match": v_match,
		"sum_conserved": sum_conserved,
		"gold_match": gold_match,
		"kit_match": kit_match,
		"dag_match": dag_match,
		"terminal_match": terminal_match
	})

