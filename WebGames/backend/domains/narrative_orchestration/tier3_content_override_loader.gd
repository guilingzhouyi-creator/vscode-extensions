# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/tier3_content_override_loader.gd
# 架构定位: Domain Service / Tier 3 Differential Content Override Engine
# 依赖与触发: 上游: WorldGatewayFSM, GameBootstrap | 下游: Tier3ContentRecordParser, Tier3ItemSkillOverrideApplier, Tier3RulesWorldOverrideApplier, GameConfig, ItemLoaderPipeline | 配置: config/domains/narrative_orchestration/core.json | 信号: config.mod_overlay_applied, config.mod_overlay_cleared
# 职责说明: 编排已启用模组包中的 Tier 3 content/ 差分数据加载与生命周期恢复，将解析与四域覆写委派给专用解析器和领域应用器，并在退回或切换至联机时恢复基础配置与物品注册表。
# 退出语义与设计依据: 业务领域第一性原理与非破坏性运行时覆盖契约
# ==============================================================================

## Tier3ContentOverrideLoader：Tier 3 content/ 差分规则解析与运行时覆盖层加载引擎
class_name Tier3ContentOverrideLoader
extends RefCounted

const Tier3ContentRecordParser = preload("res://backend/domains/narrative_orchestration/tier3_content_record_parser.gd")
const Tier3ItemSkillOverrideApplier = preload("res://backend/domains/narrative_orchestration/tier3_item_skill_override_applier.gd")
const Tier3RulesWorldOverrideApplier = preload("res://backend/domains/narrative_orchestration/tier3_rules_world_override_applier.gd")
const Tier3DomainContentOverrideApplier = preload("res://backend/domains/narrative_orchestration/tier3_domain_content_override_applier.gd")
const Tier3IdentityDestinyApplier = preload("res://backend/domains/narrative_orchestration/tier3_identity_destiny_applier.gd")

const MODE_MERGE: String = Tier3ContentRecordParser.MODE_MERGE
const MODE_REPLACE_ENTRY: String = Tier3ContentRecordParser.MODE_REPLACE_ENTRY
const MODE_TOTAL_PURGE: String = Tier3ContentRecordParser.MODE_TOTAL_PURGE

## 将模板与契约中的覆盖模式别名统一映射为规范三态策略
static func normalize_override_mode(raw_mode: String) -> String:
	return Tier3ContentRecordParser.normalize_override_mode(raw_mode)

## 应用已启用模组集合中的全品类差分覆盖（保留按包有序叠层并同步刷新下游运行时注册表）
static func apply_enabled_packages(ordered_packages: Array, item_catalog: Variant = null) -> Dictionary:
	var accumulator: Dictionary = {
		"working_tables": GameConfig.get_base_tables_snapshot(),
		"touched_tables": {},
		"purged_prefixes": [],
		"applied_packs": [],
		"applied_files": 0,
		"official_pack_id": "",
		"domain_counts": {
			"items": 0, "skills": 0, "rules": 0, "world": 0,
			"entities": 0, "quests": 0, "events": 0, "narratives": 0,
			"copywriting": 0, "races": 0, "cutscenes": 0
		}
	}
	for package_entry in ordered_packages:
		_process_single_package_override(package_entry, accumulator)

	var applied_files: int = int(accumulator["applied_files"])
	var touched_tables: Dictionary = accumulator["touched_tables"] as Dictionary
	if applied_files == 0 and touched_tables.is_empty():
		var reverted_previous := false
		if GameConfig.has_active_mod_overlay():
			var revert_summary: Dictionary = revert_all_overrides(item_catalog)
			reverted_previous = bool(revert_summary.get("had_overlay", false))
		return {
			"success": true,
			"applied_file_count": 0,
			"applied_packs": [],
			"reverted_previous_overlay": reverted_previous,
			"domain_counts": accumulator["domain_counts"]
		}

	var overlay_tables: Dictionary = _build_touched_overlay_tables(
		accumulator["working_tables"] as Dictionary,
		touched_tables
	)
	var applied_packs: Array[String] = []
	applied_packs.assign(accumulator["applied_packs"] as Array)
	var purged_prefixes: Array[String] = []
	purged_prefixes.assign(accumulator["purged_prefixes"] as Array)

	var apply_report: Dictionary = GameConfig.apply_mod_overlay_tables(
		overlay_tables,
		applied_packs,
		purged_prefixes
	)
	var catalog_reload_summary: Dictionary = _sync_item_catalog(item_catalog, String(accumulator["official_pack_id"]))
	return {
		"success": bool(apply_report.get("success", false)),
		"version": int(apply_report.get("version", GameConfig.config_reload_version())),
		"applied_file_count": applied_files,
		"applied_packs": applied_packs,
		"overlaid_tables": apply_report.get("overlaid_tables", []),
		"purged_prefixes": purged_prefixes,
		"domain_counts": accumulator["domain_counts"],
		"item_catalog_sync": catalog_reload_summary
	}

## 撤销全部模组运行时覆盖层并将配置表与下游域注册表恢复至纯净引擎状态
static func revert_all_overrides(item_catalog: Variant = null) -> Dictionary:
	var clear_report: Dictionary = GameConfig.clear_mod_overlay_tables()
	var had_overlay: bool = bool(clear_report.get("had_overlay", false))
	var catalog_reload_summary: Dictionary = {}
	if had_overlay or item_catalog != null:
		catalog_reload_summary = _sync_item_catalog(item_catalog, "")
	return {
		"success": bool(clear_report.get("success", true)),
		"had_overlay": had_overlay,
		"version": int(clear_report.get("version", GameConfig.config_reload_version())),
		"item_catalog_sync": catalog_reload_summary
	}

static func _process_single_package_override(package_entry: Variant, accumulator: Dictionary) -> void:
	var package_root := Tier3ContentRecordParser.extract_package_root(package_entry)
	var pack_identifier := Tier3ContentRecordParser.extract_pack_identifier(package_entry)
	var package_record: Dictionary = _resolve_package_dictionary(package_entry, package_root)
	var profile := String(package_record.get("pack_profile", "")).strip_edges().to_upper()
	if (profile == "OFFICIAL_BASE" or profile == "TOTAL_CONVERSION" or bool(package_record.get("is_official", false))) and not pack_identifier.is_empty():
		accumulator["official_pack_id"] = pack_identifier

	var working_tables := accumulator["working_tables"] as Dictionary
	var touched_tables := accumulator["touched_tables"] as Dictionary
	var applied_packs := accumulator["applied_packs"] as Array
	if Tier3IdentityDestinyApplier.apply_base_package_destinies_projection(package_record, working_tables, touched_tables):
		if not pack_identifier.is_empty() and not applied_packs.has(pack_identifier):
			applied_packs.append(pack_identifier)

	if package_root.is_empty():
		return
	var content_records: Array[Dictionary] = Tier3ContentRecordParser.collect_content_records(package_root)
	if content_records.is_empty():
		return

	var purged_prefixes: Array[String] = []
	purged_prefixes.assign(accumulator["purged_prefixes"] as Array)
	var package_applied_files := _apply_package_records(
		content_records,
		working_tables,
		touched_tables,
		purged_prefixes,
		accumulator["domain_counts"] as Dictionary
	)
	accumulator["purged_prefixes"] = purged_prefixes
	if package_applied_files > 0:
		accumulator["applied_files"] = int(accumulator["applied_files"]) + package_applied_files
		if not pack_identifier.is_empty() and not applied_packs.has(pack_identifier):
			applied_packs.append(pack_identifier)

static func _build_touched_overlay_tables(working_tables: Dictionary, touched_tables: Dictionary) -> Dictionary:
	var overlay_tables: Dictionary = {}
	for touched_table_key in touched_tables.keys():
		var table_name := String(touched_table_key)
		if working_tables.has(table_name):
			overlay_tables[table_name] = working_tables[table_name]
	return overlay_tables

static func _resolve_package_dictionary(package_entry: Variant, package_root: String) -> Dictionary:
	if package_entry is Dictionary:
		var record := package_entry as Dictionary
		if record.has("custom_races") or record.has("custom_starter_kits") or package_root.is_empty():
			return record
		var full_loaded := ModPackageDiscoverySolver.load_full_mod_package_from_dir(package_root)
		return full_loaded if not full_loaded.is_empty() else record
	if package_entry is Object and not package_root.is_empty():
		return ModPackageDiscoverySolver.load_full_mod_package_from_dir(package_root)
	return {}

static func _apply_package_records(
	content_records: Array[Dictionary],
	working_tables: Dictionary,
	touched_tables: Dictionary,
	purged_prefixes: Array[String],
	domain_counts: Dictionary
) -> int:
	var applied_count: int = 0
	for record in content_records:
		var category_name := String(record.get("category", ""))
		var payload_variant: Variant = record.get("payload", {})
		if not (payload_variant is Dictionary):
			continue
		var payload_map: Dictionary = payload_variant
		var override_mode := normalize_override_mode(String(payload_map.get("override_mode", MODE_MERGE)))
		var did_apply := _dispatch_category_override(
			category_name, payload_map, override_mode, working_tables, touched_tables, purged_prefixes
		)
		if did_apply:
			applied_count += 1
			domain_counts[category_name] = int(domain_counts.get(category_name, 0)) + 1
	return applied_count

static func _dispatch_category_override(
	category_name: String,
	payload_map: Dictionary,
	override_mode: String,
	working_tables: Dictionary,
	touched_tables: Dictionary,
	purged_prefixes: Array[String]
) -> bool:
	match category_name:
		"items":
			return Tier3ItemSkillOverrideApplier.apply_items_override(payload_map, override_mode, working_tables, touched_tables, purged_prefixes)
		"skills":
			return Tier3ItemSkillOverrideApplier.apply_skills_override(payload_map, override_mode, working_tables, touched_tables)
		"rules":
			return Tier3RulesWorldOverrideApplier.apply_rules_override(payload_map, override_mode, working_tables, touched_tables)
		"world":
			return Tier3RulesWorldOverrideApplier.apply_world_override(payload_map, override_mode, working_tables, touched_tables)
		"entities":
			return Tier3DomainContentOverrideApplier.apply_entities_override(payload_map, override_mode, working_tables, touched_tables)
		"quests":
			return Tier3DomainContentOverrideApplier.apply_quests_override(payload_map, override_mode, working_tables, touched_tables)
		"events":
			return Tier3DomainContentOverrideApplier.apply_events_override(payload_map, override_mode, working_tables, touched_tables)
		"narratives":
			return Tier3DomainContentOverrideApplier.apply_narratives_override(payload_map, override_mode, working_tables, touched_tables)
		"copywriting":
			return Tier3DomainContentOverrideApplier.apply_copywriting_override(payload_map, override_mode, working_tables, touched_tables)
		"races":
			return Tier3IdentityDestinyApplier.apply_races_override(payload_map, override_mode, working_tables, touched_tables)
		"cutscenes":
			return Tier3DomainContentOverrideApplier.apply_cutscenes_override(payload_map, override_mode, working_tables, touched_tables)
	return false

static func _sync_item_catalog(item_catalog: Variant, official_mod_id: String = "") -> Dictionary:
	var target_catalog: Variant = item_catalog
	if target_catalog == null and GameBootstrap.is_assembled():
		target_catalog = GameBootstrap.catalog()
	var reload_summary := GameBootstrap.reload_domain_registries_from_config(target_catalog, official_mod_id)
	var item_sync: Variant = reload_summary.get("item_catalog_sync", {"skipped": true})
	return (item_sync as Dictionary) if (item_sync is Dictionary) else {"skipped": true}
