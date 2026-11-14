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

const MODE_MERGE: String = Tier3ContentRecordParser.MODE_MERGE
const MODE_REPLACE_ENTRY: String = Tier3ContentRecordParser.MODE_REPLACE_ENTRY
const MODE_TOTAL_PURGE: String = Tier3ContentRecordParser.MODE_TOTAL_PURGE

## 将模板与契约中的覆盖模式别名统一映射为规范三态策略
static func normalize_override_mode(raw_mode: String) -> String:
	return Tier3ContentRecordParser.normalize_override_mode(raw_mode)

## 应用已启用模组集合中的 Tier 3 content/ 差分覆盖并同步刷新运行时注册表
static func apply_enabled_packages(ordered_packages: Array, item_catalog: Variant = null) -> Dictionary:
	var working_tables: Dictionary = GameConfig.get_base_tables_snapshot()
	var touched_tables: Dictionary = {}
	var purged_prefixes: Array[String] = []
	var applied_packs: Array[String] = []
	var applied_files: int = 0
	var domain_counts: Dictionary = {
		"items": 0,
		"skills": 0,
		"rules": 0,
		"world": 0
	}

	for package_entry in ordered_packages:
		var package_root := Tier3ContentRecordParser.extract_package_root(package_entry)
		var pack_identifier := Tier3ContentRecordParser.extract_pack_identifier(package_entry)
		if package_root.is_empty():
			continue
		var content_records: Array[Dictionary] = Tier3ContentRecordParser.collect_content_records(package_root)
		if content_records.is_empty():
			continue
		var package_applied_files := _apply_package_records(
			content_records,
			working_tables,
			touched_tables,
			purged_prefixes,
			domain_counts
		)
		if package_applied_files > 0:
			applied_files += package_applied_files
			if not pack_identifier.is_empty() and not applied_packs.has(pack_identifier):
				applied_packs.append(pack_identifier)

	if applied_files == 0:
		var reverted_previous := false
		if GameConfig.has_active_mod_overlay():
			var revert_summary: Dictionary = revert_all_overrides(item_catalog)
			reverted_previous = bool(revert_summary.get("had_overlay", false))
		return {
			"success": true,
			"applied_file_count": 0,
			"applied_packs": [],
			"reverted_previous_overlay": reverted_previous,
			"domain_counts": domain_counts
		}

	var overlay_tables: Dictionary = {}
	for touched_table_key in touched_tables.keys():
		var table_name := String(touched_table_key)
		if working_tables.has(table_name):
			overlay_tables[table_name] = working_tables[table_name]

	var apply_report: Dictionary = GameConfig.apply_mod_overlay_tables(
		overlay_tables,
		applied_packs,
		purged_prefixes
	)
	var catalog_reload_summary: Dictionary = _sync_item_catalog(item_catalog)
	return {
		"success": bool(apply_report.get("success", false)),
		"version": int(apply_report.get("version", GameConfig.config_reload_version())),
		"applied_file_count": applied_files,
		"applied_packs": applied_packs,
		"overlaid_tables": apply_report.get("overlaid_tables", []),
		"purged_prefixes": purged_prefixes,
		"domain_counts": domain_counts,
		"item_catalog_sync": catalog_reload_summary
	}

## 撤销全部模组运行时覆盖层并将配置表与物品注册表恢复至基础状态
static func revert_all_overrides(item_catalog: Variant = null) -> Dictionary:
	var clear_report: Dictionary = GameConfig.clear_mod_overlay_tables()
	var had_overlay: bool = bool(clear_report.get("had_overlay", false))
	var catalog_reload_summary: Dictionary = {}
	if had_overlay or item_catalog != null:
		catalog_reload_summary = _sync_item_catalog(item_catalog)
	return {
		"success": bool(clear_report.get("success", true)),
		"had_overlay": had_overlay,
		"version": int(clear_report.get("version", GameConfig.config_reload_version())),
		"item_catalog_sync": catalog_reload_summary
	}

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
		var did_apply := false
		match category_name:
			"items":
				did_apply = Tier3ItemSkillOverrideApplier.apply_items_override(payload_map, override_mode, working_tables, touched_tables, purged_prefixes)
			"skills":
				did_apply = Tier3ItemSkillOverrideApplier.apply_skills_override(payload_map, override_mode, working_tables, touched_tables)
			"rules":
				did_apply = Tier3RulesWorldOverrideApplier.apply_rules_override(payload_map, override_mode, working_tables, touched_tables)
			"world":
				did_apply = Tier3RulesWorldOverrideApplier.apply_world_override(payload_map, override_mode, working_tables, touched_tables)
		if did_apply:
			applied_count += 1
			domain_counts[category_name] = int(domain_counts.get(category_name, 0)) + 1
	return applied_count

static func _sync_item_catalog(item_catalog: Variant) -> Dictionary:
	var target_catalog: Variant = item_catalog
	if target_catalog == null and GameBootstrap.is_assembled():
		target_catalog = GameBootstrap.catalog()
	if target_catalog is ItemRegistryCatalog:
		return ItemLoaderPipeline.reload_from_config(target_catalog as ItemRegistryCatalog)
	return {"skipped": true}
