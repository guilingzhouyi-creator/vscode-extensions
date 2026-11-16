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
const LocalizationRegistryCatalog = preload("res://backend/domains/localization_i18n/localization_registry_catalog.gd")
const ModPackageArchiveReader = preload("res://backend/domains/narrative_orchestration/mod_package_archive_reader.gd")

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
		"i18n_layers": [],
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
	var i18n_layers: Array = accumulator["i18n_layers"] as Array
	var applied_packs: Array[String] = []
	applied_packs.assign(accumulator["applied_packs"] as Array)
	var purged_prefixes: Array[String] = []
	purged_prefixes.assign(accumulator["purged_prefixes"] as Array)

	if applied_files == 0 and touched_tables.is_empty() and i18n_layers.is_empty():
		var reverted_previous := false
		if GameConfig.has_active_mod_overlay() or LocalizationRegistryCatalog.get_shared().unload_all_mod_translations() > 0 or GameConfig.clear_mod_i18n_dictionaries():
			var revert_summary: Dictionary = revert_all_overrides(item_catalog)
			reverted_previous = bool(revert_summary.get("had_overlay", false))
		return {
			"success": true,
			"applied_file_count": 0,
			"applied_packs": [],
			"reverted_previous_overlay": reverted_previous,
			"domain_counts": accumulator["domain_counts"]
		}

	var i18n_summary: Dictionary = _apply_mod_i18n_layers(i18n_layers, applied_packs)
	if applied_files == 0 and touched_tables.is_empty():
		return {
			"success": true,
			"version": GameConfig.config_reload_version(),
			"applied_file_count": 0,
			"applied_packs": applied_packs,
			"overlaid_tables": [],
			"purged_prefixes": purged_prefixes,
			"domain_counts": accumulator["domain_counts"],
			"i18n_sync": i18n_summary,
			"item_catalog_sync": {"skipped": true}
		}

	var overlay_tables: Dictionary = _build_touched_overlay_tables(
		accumulator["working_tables"] as Dictionary,
		touched_tables
	)

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
		"i18n_sync": i18n_summary,
		"item_catalog_sync": catalog_reload_summary
	}

## 撤销全部模组运行时覆盖层并将配置表与下游域注册表恢复至纯净引擎状态
static func revert_all_overrides(item_catalog: Variant = null) -> Dictionary:
	var clear_report: Dictionary = GameConfig.clear_mod_overlay_tables()
	var had_overlay: bool = bool(clear_report.get("had_overlay", false))
	var unloaded_i18n_count: int = _clear_mod_i18n_layers()
	GameBootstrap.clear_cutscene_viewed_records()
	var catalog_reload_summary: Dictionary = {}
	if had_overlay or item_catalog != null:
		catalog_reload_summary = _sync_item_catalog(item_catalog, "")
	return {
		"success": bool(clear_report.get("success", true)),
		"had_overlay": had_overlay or unloaded_i18n_count > 0,
		"unloaded_i18n_count": unloaded_i18n_count,
		"version": int(clear_report.get("version", GameConfig.config_reload_version())),
		"item_catalog_sync": catalog_reload_summary
	}

## 处理单个启用 MOD 包的 i18n、destinies 投射与 content 差分覆写记录
static func _process_single_package_override(package_entry: Variant, accumulator: Dictionary) -> void:
	var package_root := Tier3ContentRecordParser.extract_package_root(package_entry)
	var package_record: Dictionary = _resolve_package_dictionary(package_entry, package_root)
	var pack_identifier := Tier3ContentRecordParser.extract_pack_identifier(package_entry)
	if pack_identifier.is_empty():
		pack_identifier = Tier3ContentRecordParser.extract_pack_identifier(package_record)
	_record_official_pack_if_applicable(package_record, pack_identifier, accumulator)
	_append_package_i18n_and_destiny_overlays(package_record, package_root, pack_identifier, accumulator)

	if package_root.is_empty():
		return
	var content_records: Array[Dictionary] = Tier3ContentRecordParser.collect_content_records(package_root)
	if content_records.is_empty():
		return

	var purged_prefixes: Array[String] = []
	purged_prefixes.assign(accumulator["purged_prefixes"] as Array)
	var package_applied_files := _apply_package_records(
		content_records,
		accumulator["working_tables"] as Dictionary,
		accumulator["touched_tables"] as Dictionary,
		purged_prefixes,
		accumulator["domain_counts"] as Dictionary
	)
	accumulator["purged_prefixes"] = purged_prefixes
	if package_applied_files > 0:
		accumulator["applied_files"] = int(accumulator["applied_files"]) + package_applied_files
		_mark_pack_applied(accumulator["applied_packs"] as Array, pack_identifier)

static func _record_official_pack_if_applicable(
	package_record: Dictionary,
	pack_identifier: String,
	accumulator: Dictionary
) -> void:
	if pack_identifier.is_empty():
		return
	var profile := String(package_record.get("pack_profile", "")).strip_edges().to_upper()
	if profile == "OFFICIAL_BASE" or bool(package_record.get("is_official", false)):
		accumulator["official_pack_id"] = pack_identifier

static func _mark_pack_applied(applied_packs: Array, resolved_pack_id: String) -> void:
	if not resolved_pack_id.is_empty() and not applied_packs.has(resolved_pack_id):
		applied_packs.append(resolved_pack_id)

static func _append_package_i18n_and_destiny_overlays(
	package_record: Dictionary,
	package_root: String,
	pack_identifier: String,
	accumulator: Dictionary
) -> void:
	var applied_packs := accumulator["applied_packs"] as Array
	var custom_i18n_by_locale: Dictionary = _extract_package_i18n_by_locale(package_record, package_root)
	if not custom_i18n_by_locale.is_empty():
		var resolved_pack_id := pack_identifier if not pack_identifier.is_empty() else String(package_record.get("pack_id", ""))
		(accumulator["i18n_layers"] as Array).append({
			"pack_id": resolved_pack_id,
			"by_locale": custom_i18n_by_locale
		})
		_mark_pack_applied(applied_packs, resolved_pack_id)

	var applied_destinies := Tier3IdentityDestinyApplier.apply_base_package_destinies_projection(
		package_record,
		accumulator["working_tables"] as Dictionary,
		accumulator["touched_tables"] as Dictionary
	)
	if applied_destinies:
		_mark_pack_applied(applied_packs, pack_identifier)

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
		if package_root.ends_with(".kmod"):
			var kmod_loaded := ModPackageArchiveReader.load_full_package_from_kmod(package_root)
			return kmod_loaded if not kmod_loaded.is_empty() else record
		var full_loaded := ModPackageDiscoverySolver.load_full_mod_package_from_dir(package_root)
		return full_loaded if not full_loaded.is_empty() else record
	if (package_entry is Object or package_entry is String) and not package_root.is_empty():
		if package_root.ends_with(".kmod"):
			return ModPackageArchiveReader.load_full_package_from_kmod(package_root)
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

static func _extract_package_i18n_by_locale(package_record: Dictionary, package_root: String) -> Dictionary:
	var raw_by_locale: Variant = package_record.get("custom_i18n_by_locale", {})
	if raw_by_locale is Dictionary and not (raw_by_locale as Dictionary).is_empty():
		return raw_by_locale as Dictionary
	var flat_i18n: Variant = package_record.get("custom_i18n", {})
	if flat_i18n is Dictionary and not (flat_i18n as Dictionary).is_empty():
		return {"zh_CN": flat_i18n}
	if not package_root.is_empty():
		var full_loaded := ModPackageDiscoverySolver.load_full_mod_package_from_dir(package_root)
		var loaded_by_locale: Variant = full_loaded.get("custom_i18n_by_locale", {})
		if loaded_by_locale is Dictionary and not (loaded_by_locale as Dictionary).is_empty():
			return loaded_by_locale as Dictionary
		var loaded_flat: Variant = full_loaded.get("custom_i18n", {})
		if loaded_flat is Dictionary and not (loaded_flat as Dictionary).is_empty():
			return {"zh_CN": loaded_flat}
	return {}

static func _apply_mod_i18n_layers(i18n_layers: Array, applied_packs: Array) -> Dictionary:
	var catalog := LocalizationRegistryCatalog.get_shared()
	catalog.unload_all_mod_translations()
	var merged_by_locale: Dictionary = {}
	var registered_key_count: int = 0
	for layer_variant in i18n_layers:
		if not (layer_variant is Dictionary):
			continue
		var layer := layer_variant as Dictionary
		var pack_id := String(layer.get("pack_id", ""))
		var by_locale_variant: Variant = layer.get("by_locale", {})
		if not (by_locale_variant is Dictionary):
			continue
		var by_locale := by_locale_variant as Dictionary
		for raw_locale in by_locale.keys():
			var locale_entries: Variant = by_locale[raw_locale]
			if not (locale_entries is Dictionary) or (locale_entries as Dictionary).is_empty():
				continue
			var normalized_locale: String = ModPackageArchiveReader.normalize_locale_code(String(raw_locale))
			var locale_map := locale_entries as Dictionary
			catalog.merge_mod_translations(pack_id, normalized_locale, locale_map, true)
			if not merged_by_locale.has(normalized_locale):
				merged_by_locale[normalized_locale] = {}
			var bucket := merged_by_locale[normalized_locale] as Dictionary
			for raw_key in locale_map.keys():
				bucket[String(raw_key)] = String(locale_map[raw_key])
			registered_key_count += locale_map.size()
	if merged_by_locale.is_empty():
		GameConfig.clear_mod_i18n_dictionaries()
	else:
		GameConfig.set_mod_i18n_dictionaries(merged_by_locale)
	EventBusCore.get_instance().emit_domain_event("localization_i18n.updated", {
		"args": [merged_by_locale.keys(), applied_packs],
		"category_key": "system",
		"action": "mod_overlay_applied",
		"locales": merged_by_locale.keys(),
		"key_count": registered_key_count
	})
	return {"locales": merged_by_locale.keys(), "key_count": registered_key_count}

static func _clear_mod_i18n_layers() -> int:
	var catalog := LocalizationRegistryCatalog.get_shared()
	var unloaded_count: int = catalog.unload_all_mod_translations()
	var cleared_frontend_mirror: bool = GameConfig.clear_mod_i18n_dictionaries()
	if unloaded_count > 0 or cleared_frontend_mirror:
		EventBusCore.get_instance().emit_domain_event("localization_i18n.updated", {
			"args": [[], []],
			"category_key": "system",
			"action": "mod_overlay_cleared",
			"locales": [],
			"key_count": 0
		})
	return unloaded_count
