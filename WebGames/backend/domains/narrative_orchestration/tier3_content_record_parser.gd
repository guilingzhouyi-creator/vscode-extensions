# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/tier3_content_record_parser.gd
# 架构定位: Domain Component / Tier 3 Content Record Scanner & Dict Merge Helper
# 依赖与触发: 上游: Tier3ContentOverrideLoader, Tier3ItemSkillOverrideApplier, Tier3RulesWorldOverrideApplier | 下游: ModPackageDiscoverySolver
# 职责说明: 负责解析模组根目录或 .kmod 压缩包内 Tier 3 content/ 与顶层 JSON 差分记录，归一化覆盖策略并提供字典深度合并辅助能力。
# 退出语义与设计依据: 业务领域第一性原理与非破坏性运行时覆盖契约
# ==============================================================================

## Tier3ContentRecordParser：Tier 3 差分记录扫描解析与字典合并助手
class_name Tier3ContentRecordParser
extends RefCounted

const MODE_MERGE: String = "MERGE"
const MODE_REPLACE_ENTRY: String = "REPLACE_ENTRY"
const MODE_TOTAL_PURGE: String = "TOTAL_PURGE"

## 将模板与契约中的覆盖模式别名统一映射为规范三态策略
static func normalize_override_mode(raw_mode: String) -> String:
	var normalized := raw_mode.strip_edges().to_upper()
	if normalized == "REPLACE_ENTRY":
		return MODE_REPLACE_ENTRY
	if normalized == "TOTAL_PURGE" or normalized == "REPLACE_EXISTING" or normalized == "FULL_OVERRIDE":
		return MODE_TOTAL_PURGE
	return MODE_MERGE

## 从模组条目提取磁盘根路径
static func extract_package_root(package_entry: Variant) -> String:
	if package_entry is Dictionary:
		return String((package_entry as Dictionary).get("root_path", "")).strip_edges()
	if package_entry is Object and package_entry.get("root_path") != null:
		return String(package_entry.get("root_path")).strip_edges()
	return ""

## 从模组条目提取规范 pack_id
static func extract_pack_identifier(package_entry: Variant) -> String:
	if package_entry is Dictionary:
		return String((package_entry as Dictionary).get("pack_id", "")).strip_edges()
	if package_entry is Object and package_entry.get("pack_id") != null:
		return String(package_entry.get("pack_id")).strip_edges()
	return ""

## 收集单个目录型模组或 .kmod 归档内的有效差分记录
static func collect_content_records(package_root: String) -> Array[Dictionary]:
	if package_root.ends_with(".kmod"):
		return _collect_kmod_content_records(package_root)
	return _collect_directory_content_records(package_root)

static func _classify_relative_content_path(relative_path: String) -> String:
	var normalized := relative_path.replace("\\", "/").strip_edges().to_lower()
	if normalized == "items.json" or normalized.begins_with("content/items/"):
		return "items"
	if normalized == "skills.json" or normalized.begins_with("content/skills/"):
		return "skills"
	if normalized == "game_rules.json" or normalized.begins_with("content/rules/"):
		return "rules"
	if normalized == "world.json" or normalized.begins_with("content/world/"):
		return "world"
	return ""

static func _collect_directory_content_records(package_root: String) -> Array[Dictionary]:
	var collected: Array[Dictionary] = []
	var top_level_files: Array[String] = ["items.json", "skills.json", "game_rules.json", "world.json"]
	for top_filename in top_level_files:
		var top_file_path := package_root.path_join(top_filename)
		if FileAccess.file_exists(top_file_path):
			_append_json_file_record(collected, top_filename, top_file_path)

	var content_directory := package_root.path_join("content")
	if DirAccess.dir_exists_absolute(content_directory):
		var subpaths: Array[String] = []
		_scan_json_relative_paths(content_directory, "content", subpaths)
		subpaths.sort()
		for rel_path in subpaths:
			_append_json_file_record(collected, rel_path, package_root.path_join(rel_path))
	return collected

static func _scan_json_relative_paths(directory_path: String, relative_prefix: String, collected_paths: Array[String]) -> void:
	var entries: Dictionary = ModPackageDiscoverySolver.collect_directory_entries(directory_path)
	for subdirectory_variant in entries.get("dirs", []):
		var subdirectory_name := str(subdirectory_variant)
		_scan_json_relative_paths(directory_path.path_join(subdirectory_name), relative_prefix + "/" + subdirectory_name, collected_paths)
	for file_variant in entries.get("files", []):
		var file_name := str(file_variant)
		if file_name.ends_with(".json"):
			collected_paths.append(relative_prefix + "/" + file_name)

static func _append_json_file_record(target_records: Array[Dictionary], relative_path: String, full_path: String) -> void:
	var category := _classify_relative_content_path(relative_path)
	if category.is_empty():
		return
	var file_handle := FileAccess.open(full_path, FileAccess.READ)
	if file_handle == null:
		return
	var parsed: Variant = JSON.parse_string(file_handle.get_as_text())
	if parsed is Dictionary:
		target_records.append({
			"category": category,
			"relative_path": relative_path,
			"payload": parsed
		})

static func _collect_kmod_content_records(kmod_path: String) -> Array[Dictionary]:
	var collected: Array[Dictionary] = []
	var reader := ZIPReader.new()
	if reader.open(kmod_path) != OK:
		return collected
	var entry_names: PackedStringArray = reader.get_files()
	var sorted_paths: Array[String] = []
	for entry_name in entry_names:
		var path_text := String(entry_name)
		if path_text.ends_with(".json") and not _classify_relative_content_path(path_text).is_empty():
			sorted_paths.append(path_text)
	sorted_paths.sort()
	for sorted_path in sorted_paths:
		var category := _classify_relative_content_path(sorted_path)
		var raw_text := reader.read_file(sorted_path).get_string_from_utf8()
		var parsed: Variant = JSON.parse_string(raw_text)
		if parsed is Dictionary:
			collected.append({
				"category": category,
				"relative_path": sorted_path,
				"payload": parsed
			})
	reader.close()
	return collected

## 确保目标工作配置表存在并登记为已修改表
static func ensure_working_table(working_tables: Dictionary, touched_tables: Dictionary, table_name: String) -> Dictionary:
	if not working_tables.has(table_name):
		working_tables[table_name] = {}
	touched_tables[table_name] = true
	return working_tables[table_name] as Dictionary

## 按覆盖策略将节段键值写入目标工作表
static func apply_dictionary_sections(
	source_map: Dictionary,
	section_keys: Array,
	target_table: Dictionary,
	override_mode: String
) -> bool:
	var changed := false
	for section_key_variant in section_keys:
		var section_key := String(section_key_variant)
		if not source_map.has(section_key):
			continue
		changed = true
		_assign_section_value(target_table, section_key, source_map[section_key], override_mode)
	return changed

static func _assign_section_value(target_table: Dictionary, section_key: String, section_payload: Variant, override_mode: String) -> void:
	if override_mode == MODE_MERGE and (section_payload is Dictionary) and (target_table.get(section_key) is Dictionary):
		deep_merge_dictionary(target_table[section_key] as Dictionary, section_payload as Dictionary)
	elif section_payload is Dictionary:
		target_table[section_key] = (section_payload as Dictionary).duplicate(true)
	elif section_payload is Array:
		target_table[section_key] = (section_payload as Array).duplicate(true)
	else:
		target_table[section_key] = section_payload

## 对嵌套字典执行原地深合并并在末端执行深拷贝
static func deep_merge_dictionary(target_table: Dictionary, patch_table: Dictionary) -> void:
	for raw_key in patch_table.keys():
		var patch_value: Variant = patch_table[raw_key]
		if patch_value is Dictionary:
			if target_table.get(raw_key) is Dictionary:
				deep_merge_dictionary(target_table[raw_key] as Dictionary, patch_value as Dictionary)
			else:
				target_table[raw_key] = (patch_value as Dictionary).duplicate(true)
		elif patch_value is Array:
			target_table[raw_key] = (patch_value as Array).duplicate(true)
		else:
			target_table[raw_key] = patch_value
