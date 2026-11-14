# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_tier3_content_override_helper.gd
# 架构定位: Integration Test Harness Helper
# 依赖与触发: 由 TestTier3ContentOverridePipeline 调度执行
# 职责说明: 提供 Tier 3 MOD 测试沙箱清理、模拟包生成辅助及 TC-T3MOD-04 (REPLACE_ENTRY) 与 TC-T3MOD-05 (TOTAL_PURGE) 集成用例验证。
# 设计依据: Phase 129 阶段4验收矩阵 (TC-T3MOD-04 ~ TC-T3MOD-05) 与非破坏性覆盖契约
# ==============================================================================

## TestTier3ContentOverrideHelper：Tier 3 MOD 测试夹具构造与覆盖模式验证助手
class_name TestTier3ContentOverrideHelper
extends RefCounted

const Tier3ContentOverrideLoader = preload("res://backend/domains/narrative_orchestration/tier3_content_override_loader.gd")
const TEST_SANDBOX_ROOT: String = "user://test_sandbox_tier3_mod/"

## 递归删除沙箱临时目录
static func cleanup_directory_recursive(directory_path: String) -> void:
	if not DirAccess.dir_exists_absolute(directory_path):
		return
	var directory_access := DirAccess.open(directory_path)
	if directory_access == null:
		return
	directory_access.list_dir_begin()
	var entry_name := directory_access.get_next()
	while not entry_name.is_empty():
		if not entry_name.begins_with("."):
			var full_path := directory_path.path_join(entry_name)
			if directory_access.current_is_dir():
				cleanup_directory_recursive(full_path)
			DirAccess.remove_absolute(full_path)
		entry_name = directory_access.get_next()
	directory_access.list_dir_end()
	DirAccess.remove_absolute(directory_path)

## 写入测试用 JSON 配置载荷文件
static func write_json_file(file_path: String, payload: Variant) -> void:
	var parent_directory := file_path.get_base_dir()
	if not DirAccess.dir_exists_absolute(parent_directory):
		DirAccess.make_dir_recursive_absolute(parent_directory)
	var file_handle := FileAccess.open(file_path, FileAccess.WRITE)
	if file_handle != null:
		file_handle.store_string(JSON.stringify(payload, "  ") + "\n")
		file_handle.close()

## 回退所有 MOD 运行时覆盖层并清理测试沙箱目录
static func reset_mod_runtime_state() -> void:
	Tier3ContentOverrideLoader.revert_all_overrides()
	cleanup_directory_recursive(TEST_SANDBOX_ROOT)

## 构造包含 items/skills/rules/world 四域 MERGE 差分载荷的 Tier 3 测试模组包
static func create_tier3_merge_package(pack_directory: String) -> Dictionary:
	var manifest := {
		"pack_id": "mod_t3_merge_sample", "pack_name": "Tier3 Merge Sample",
		"version": "1.0.0", "author": "Tester", "engine_api_version": "1.0.0",
		"tier": "TIER_3_OVERHAUL", "pack_profile": "TOTAL_CONVERSION", "priority": 300,
		"dependencies": [], "incompatible_packs": [],
		"semantic_tags": ["total_conversion"], "is_active": true, "root_path": pack_directory
	}
	write_json_file(pack_directory.path_join("pack.json"), manifest)
	write_json_file(pack_directory.path_join("content/items/weapons.json"), {
		"override_mode": "APPEND_MERGE",
		"weapons": [
			{"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD", "base_market_value": 777},
			{
				"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:RUNE_CLAYMORE",
				"english_name": "rune_claymore", "loc_name_key": "item.rune_claymore.name",
				"category_major": "EQUIPMENT", "category_minor": "WEAPON_BLADE",
				"tier_rank": 4, "default_mass_kg": 4.2, "default_volume_slots": 3,
				"base_market_value": 1800, "search_aliases": ["符文大剑"]
			}
		]
	})
	write_json_file(pack_directory.path_join("content/skills/skills.json"), {
		"override_mode": "MERGE",
		"verbs": {"PIERCE": {"name": "穿", "k_mom": 1.3, "k_edge": 2.1, "base_ap": -2}}
	})
	write_json_file(pack_directory.path_join("content/rules/rules.json"), {
		"override_mode": "MERGE", "combat_constants": {"kinetic": {"energy_coef": 0.75}}
	})
	write_json_file(pack_directory.path_join("content/world/world_map.json"), {
		"override_mode": "MERGE", "terrain_impedance": {"SWAMP": 4.2},
		"map_id": "WORLD_MOD_TEST", "nodes": [{"node_id": "NODE_MOD_CITADEL"}]
	})
	return manifest

## TC-T3MOD-04: REPLACE_ENTRY 整条替换不保留被替换条目的旧子键
static func run_tc_t3mod_04_replace_entry() -> Dictionary:
	reset_mod_runtime_state()
	var pack_directory := TEST_SANDBOX_ROOT + "mod_t3_replace"
	var manifest := {"pack_id": "mod_t3_replace", "root_path": pack_directory}
	write_json_file(pack_directory.path_join("pack.json"), manifest)
	write_json_file(pack_directory.path_join("content/skills/skills.json"), {
		"override_mode": "REPLACE_ENTRY",
		"verbs": {"SLASH": {"name": "重劈", "k_mom": 2.4, "k_edge": 1.0, "base_ap": -4}}
	})
	write_json_file(pack_directory.path_join("content/rules/rules.json"), {
		"override_mode": "REPLACE_ENTRY",
		"combat_constants": {"kinetic": {"energy_coef": 0.9}}
	})

	Tier3ContentOverrideLoader.apply_enabled_packages([manifest])
	var slash_verb := PhysicalVerbRegistry.get_verb("SLASH")
	var stab_verb := PhysicalVerbRegistry.get_verb("STAB")
	var replace_verb_ok := str(slash_verb.get("name", "")) == "重劈" and not slash_verb.has("desc")
	var sibling_verb_ok := str(stab_verb.get("name", "")) == "刺"
	var kinetic_replaced := is_equal_approx(GameConfig.get_float("domains.combat", "kinetic/energy_coef", 0.0), 0.9) \
		and GameConfig.get_float("domains.combat", "kinetic/mass_floor", -1.0) < 0.0

	reset_mod_runtime_state()
	var passed := replace_verb_ok and sibling_verb_ok and kinetic_replaced
	return TestCase.make_result("TC-T3MOD-04: REPLACE_ENTRY 条目全量替换语义", passed, {
		"replace_verb_ok": replace_verb_ok,
		"sibling_verb_ok": sibling_verb_ok,
		"kinetic_replaced": kinetic_replaced
	})

## TC-T3MOD-05: TOTAL_PURGE (及 REPLACE_EXISTING 别名) 全量替换指定集合并维持安全默认键
static func run_tc_t3mod_05_total_purge() -> Dictionary:
	reset_mod_runtime_state()
	var catalog: ItemRegistryCatalog = ItemLoaderPipeline.build_catalog_from_config()
	var pack_directory := TEST_SANDBOX_ROOT + "mod_t3_purge"
	var manifest := {"pack_id": "mod_t3_purge", "root_path": pack_directory}
	write_json_file(pack_directory.path_join("pack.json"), manifest)
	write_json_file(pack_directory.path_join("content/items/items.json"), {
		"override_mode": "TOTAL_PURGE",
		"items": [{
			"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:SOLO_BLADE",
			"english_name": "solo_blade", "loc_name_key": "item.solo_blade.name",
			"category_major": "EQUIPMENT", "category_minor": "WEAPON_BLADE",
			"tier_rank": 5, "default_mass_kg": 2.0, "default_volume_slots": 2, "base_market_value": 999
		}]
	})
	write_json_file(pack_directory.path_join("content/skills/skills.json"), {
		"override_mode": "REPLACE_EXISTING",
		"verbs": {"ARCANE_STRIKE": {"name": "灵击", "k_mom": 1.6, "k_edge": 1.6, "base_ap": -2}}
	})

	var official_pkg: Dictionary = ModPackageDiscoverySolver.load_full_mod_package_from_dir("res://mods/official_kalar")
	Tier3ContentOverrideLoader.apply_enabled_packages([official_pkg, manifest], catalog)
	var solo_present := catalog.get_prototype("KALAR:EQUIP:WEAPON_BLADE:SOLO_BLADE") != null
	var vanilla_item_purged := catalog.get_prototype("KALAR:CONSUM:ALCHEMY:POTION_MANA") == null
	var verbs_table := GameConfig.get_dict("domains.combat", "verbs", {})
	var mod_verb_present := verbs_table.has("ARCANE_STRIKE")
	var vanilla_verb_purged := not verbs_table.has("STAB")
	var fallback_kept := verbs_table.has("_fallback")

	Tier3ContentOverrideLoader.revert_all_overrides(catalog)
	var base_reverted := not GameConfig.has_active_mod_overlay() \
		and catalog.get_prototype("KALAR:EQUIP:WEAPON_BLADE:SOLO_BLADE") == null \
		and GameConfig.get_dict("domains.combat", "verbs", {}).has("STAB")
	Tier3ContentOverrideLoader.apply_enabled_packages([official_pkg], catalog)
	var reverted_ok := base_reverted and catalog.get_prototype("KALAR:CONSUM:ALCHEMY:POTION_MANA") != null

	reset_mod_runtime_state()
	var passed := solo_present and vanilla_item_purged and mod_verb_present and vanilla_verb_purged and fallback_kept and reverted_ok
	return TestCase.make_result("TC-T3MOD-05: TOTAL_PURGE 全量清洗与回退一致性", passed, {
		"solo_present": solo_present,
		"vanilla_item_purged": vanilla_item_purged,
		"mod_verb_present": mod_verb_present,
		"vanilla_verb_purged": vanilla_verb_purged,
		"fallback_kept": fallback_kept,
		"reverted_ok": reverted_ok
	})
