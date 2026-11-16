# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_tier3_content_override_pipeline.gd
# 架构定位: Integration Test Suite / Tier 3 Differential Loader & Diagnostics Harness
# 跨域依赖: 上游: TestRegistry | 下游: TestTier3ContentOverrideHelper, ModManifestValidator, ModPackageDiscoverySolver, Tier3ContentOverrideLoader, GameConfig, ItemLoaderPipeline, PhysicalVerbRegistry, WorldGatewayFSM | 配置: config/domains/*.json | 信号: config.mod_overlay_applied, config.mod_overlay_cleared
# 职责说明: 全链路验证 MOD 清单结构化诊断（属性键白名单/包内重名/独立特质一致性）、统一多级 mods/ 磁盘发现优先级、Tier 3 content/ 在三种覆盖策略下的运行时覆盖效应，以及网关卸载或退出时向基础配置的原子回退。
# 设计依据: 阶段验收矩阵 (TC-T3MOD-01 ~ TC-T3MOD-06) 与非破坏性覆盖契约
# ==============================================================================

## TestTier3ContentOverridePipeline：Tier 3 content/ 运行时差分覆盖与诊断测试套件
class_name TestTier3ContentOverridePipeline
extends TestCase

const Helper = preload("res://tests/integration/pipelines/test_tier3_content_override_helper.gd")
const TEST_ACCOUNT_ID: String = "ACC_T3MOD_TEST_01"

## 执行全量 Tier 3 MOD 差分覆盖与诊断流水线测试 (TC-T3MOD-01 ~ TC-T3MOD-06)
static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_tc_t3mod_01_structured_validator_diagnostics())
	results.append(test_tc_t3mod_02_unified_mods_discovery_priority())
	results.append(test_tc_t3mod_03_tier3_merge_and_template_aliases())
	results.append(Helper.run_tc_t3mod_04_replace_entry())
	results.append(Helper.run_tc_t3mod_05_total_purge())
	results.append(test_tc_t3mod_06_gateway_lifecycle_revert_to_vanilla())
	return TestCase.pack_results("Tier 3 Content Override & Diagnostics Pipeline", results)

## TC-T3MOD-01: ModManifestValidator 结构化诊断、未知属性键、包内重复 origin_id 与独立特质检查
static func test_tc_t3mod_01_structured_validator_diagnostics() -> Dictionary:
	Helper.reset_mod_runtime_state()
	var invalid_manifest := {
		"pack_id": "mod_invalid_diag",
		"pack_name": "诊断校验样例",
		"version": "1.0.0",
		"author": "Tester",
		"engine_api_version": "1.0.0",
		"custom_origins": [
			{
				"origin_id": "ORIGIN_DUP_SAMPLE",
				"name": "测试身世一",
				"attribute_bonus": {"STR": 1, "LUCK": 2},
				"initial_gold": 100
			},
			{
				"origin_id": "ORIGIN_DUP_SAMPLE",
				"name": "测试身世二",
				"attribute_bonus": {"AGI": 1},
				"initial_gold": 50
			}
		],
		"custom_traits": {
			"TRAIT_BAD_SIGN": {
				"name": "极性冲突特质",
				"type": "POSITIVE",
				"cost": -2
			}
		}
	}
	var report: Dictionary = ModManifestValidator.precheck_single_mod(invalid_manifest)
	var errors_list: Array = report.get("errors", [])
	var diagnostics: Array = report.get("diagnostics", [])

	var has_unknown_attr := errors_list.has("ERR_DESTINY_UNKNOWN_ATTRIBUTE_KEY")
	var has_dup_origin := errors_list.has("ERR_DESTINY_DUPLICATE_ORIGIN_ID")
	var has_trait_imbalance := errors_list.has("ERR_DESTINY_CAUSALITY_IMBALANCE")
	var all_fields_populated := not diagnostics.is_empty()
	for diagnostic_entry in diagnostics:
		if not (diagnostic_entry is Dictionary):
			all_fields_populated = false
			break
		var entry_map: Dictionary = diagnostic_entry
		if str(entry_map.get("code", "")).is_empty() \
			or str(entry_map.get("field_path", "")).is_empty() \
			or str(entry_map.get("fix_suggestion", "")).is_empty():
			all_fields_populated = false
			break

	var passed := (not bool(report.get("valid", true))) \
		and has_unknown_attr and has_dup_origin and has_trait_imbalance and all_fields_populated
	Helper.reset_mod_runtime_state()
	return TestCase.make_result("TC-T3MOD-01: ModManifestValidator 结构化诊断与字段校验", passed, {
		"has_unknown_attr": has_unknown_attr,
		"has_dup_origin": has_dup_origin,
		"has_trait_imbalance": has_trait_imbalance,
		"all_fields_populated": all_fields_populated
	})

## TC-T3MOD-02: ModPackageDiscoverySolver 统一扫描路径与高优先级目录覆盖
static func test_tc_t3mod_02_unified_mods_discovery_priority() -> Dictionary:
	Helper.reset_mod_runtime_state()
	var default_roots: Array[String] = ModPackageDiscoverySolver.get_discovery_roots()
	var has_user_root := default_roots.has("user://mods/") and default_roots.has("user://mods/narratives/")
	var has_mod_root := default_roots.has("res://mods/") or default_roots.any(func(root_text: String) -> bool: return root_text.ends_with("mods/"))

	var lower_root := Helper.TEST_SANDBOX_ROOT + "mods/narratives/"
	var higher_root := Helper.TEST_SANDBOX_ROOT + "mods/"
	Helper.write_json_file(lower_root + "shared_pack/pack.json", {
		"pack_id": "shared_pack",
		"pack_name": "LowPriorityVersion",
		"version": "1.0.0",
		"engine_api_version": "1.0.0"
	})
	Helper.write_json_file(higher_root + "shared_pack/pack.json", {
		"pack_id": "shared_pack",
		"pack_name": "HighPriorityVersion",
		"version": "2.0.0",
		"engine_api_version": "1.0.0"
	})

	var discovered: Array[NarrativePackManifestDTO] = ModPackageDiscoverySolver.scan_installed_packs([lower_root, higher_root])
	var resolved_shared: NarrativePackManifestDTO = null
	for entry in discovered:
		if entry.pack_id == "shared_pack":
			resolved_shared = entry
			break
	var override_ok := resolved_shared != null and resolved_shared.version == "2.0.0" and resolved_shared.pack_name == "HighPriorityVersion"
	var passed := has_user_root and has_mod_root and override_ok
	Helper.reset_mod_runtime_state()
	return TestCase.make_result("TC-T3MOD-02: 统一 mods/ 发现根目录与优先级覆盖", passed, {
		"has_user_root": has_user_root,
		"has_mod_root": has_mod_root,
		"override_ok": override_ok
	})

## TC-T3MOD-03: Tier 3 MERGE/APPEND_MERGE 差分叠加向 GameConfig、ItemLoaderPipeline 与 PhysicalVerbRegistry 传播
static func test_tc_t3mod_03_tier3_merge_and_template_aliases() -> Dictionary:
	Helper.reset_mod_runtime_state()
	var catalog: ItemRegistryCatalog = ItemLoaderPipeline.build_catalog_from_config()
	var official_pkg: Dictionary = ModPackageDiscoverySolver.load_full_mod_package_from_dir("res://mods/official_kalar")
	var pack_directory := Helper.TEST_SANDBOX_ROOT + "mod_t3_merge"
	var manifest := Helper.create_tier3_merge_package(pack_directory)

	var apply_summary: Dictionary = Tier3ContentOverrideLoader.apply_enabled_packages([official_pkg, manifest], catalog)
	var energy_coef_ok := is_equal_approx(GameConfig.get_float("domains.combat", "kinetic/energy_coef", 0.0), 0.75)
	var velocity_floor_preserved := is_equal_approx(GameConfig.get_float("domains.combat", "kinetic/velocity_floor", 0.0), 0.1)
	var swamp_ok := is_equal_approx(GameConfig.get_float("domains.world", "terrain_impedance/SWAMP", 0.0), 4.2)
	var topology_ok := GameConfig.get_string("domains.world", "mod_world_topology/map_id", "") == "WORLD_MOD_TEST"
	var new_verb_ok := str(PhysicalVerbRegistry.get_verb("PIERCE").get("name", "")) == "穿"
	var vanilla_verb_ok := str(PhysicalVerbRegistry.get_verb("SLASH").get("name", "")) == "劈"

	var iron_proto: ItemRegistryCatalog.ItemPrototypeTemplate = catalog.get_prototype("KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD")
	var claymore_proto: ItemRegistryCatalog.ItemPrototypeTemplate = catalog.get_prototype("KALAR:EQUIP:WEAPON_BLADE:RUNE_CLAYMORE")
	var potion_proto: ItemRegistryCatalog.ItemPrototypeTemplate = catalog.get_prototype("KALAR:CONSUM:ALCHEMY:POTION_MANA")
	var items_ok := iron_proto != null and iron_proto.base_market_value == 777 \
		and claymore_proto != null and claymore_proto.base_market_value == 1800 \
		and potion_proto != null

	Helper.reset_mod_runtime_state()
	var passed := bool(apply_summary.get("success", false)) and energy_coef_ok and velocity_floor_preserved \
		and swamp_ok and topology_ok and new_verb_ok and vanilla_verb_ok and items_ok
	return TestCase.make_result("TC-T3MOD-03: Tier 3 MERGE 与模板兼容字段加载效应", passed, {
		"energy_coef_ok": energy_coef_ok,
		"velocity_floor_preserved": velocity_floor_preserved,
		"swamp_ok": swamp_ok,
		"topology_ok": topology_ok,
		"new_verb_ok": new_verb_ok,
		"vanilla_verb_ok": vanilla_verb_ok,
		"items_ok": items_ok
	})

## TC-T3MOD-06: WorldGatewayFSM 单机激活 Tier 3 与退出回退彻底恢复基础配置
static func test_tc_t3mod_06_gateway_lifecycle_revert_to_vanilla() -> Dictionary:
	Helper.reset_mod_runtime_state()
	var baseline_coef := GameConfig.get_float("domains.combat", "kinetic/energy_coef", 0.5)
	var pack_directory := Helper.TEST_SANDBOX_ROOT + "mod_gw_t3"
	var manifest := Helper.create_tier3_merge_package(pack_directory)

	var gateway := WorldGatewayFSM.new(TEST_ACCOUNT_ID)
	var enter_report := gateway.enter_gateway()
	var precheck_report := gateway.precheck_and_configure_single_player_mods([manifest])
	var tier3_summary: Dictionary = precheck_report.get("tier3_overlay_summary", {})
	var active_during_sp := GameConfig.has_active_mod_overlay() \
		and int(tier3_summary.get("applied_file_count", 0)) == 4 \
		and is_equal_approx(GameConfig.get_float("domains.combat", "kinetic/energy_coef", 0.0), 0.75)

	gateway.purge_and_fallback_to_vanilla()
	var reverted_after_purge := (not GameConfig.has_active_mod_overlay()) \
		and is_equal_approx(GameConfig.get_float("domains.combat", "kinetic/energy_coef", 0.0), baseline_coef) \
		and str(PhysicalVerbRegistry.get_verb("PIERCE").get("name", "")) != "穿"

	Helper.reset_mod_runtime_state()
	var passed := bool(enter_report.get("success", false)) \
		and bool(precheck_report.get("success", false)) \
		and active_during_sp \
		and reverted_after_purge
	return TestCase.make_result("TC-T3MOD-06: WorldGatewayFSM 单机生效与回退恢复基础配置", passed, {
		"active_during_sp": active_during_sp,
		"reverted_after_purge": reverted_after_purge
	})
