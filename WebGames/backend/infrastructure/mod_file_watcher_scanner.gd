# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · MOD 文件变更扫描器)
# 文件路径: res://backend/infrastructure/mod_file_watcher_scanner.gd
# 架构定位: Recursive JSON Modification Time & SHA-256 Diff Scanner
# 依赖与触发: 上游: ModHotReloadSolver | 下游: FileAccess, DirAccess, ProjectSettings
# 职责说明: 递归采集受监控 MOD 目录内全部 JSON 文件的修改时间与 SHA-256 指纹，比对基线差异并校验变更文件的 JSON 语法完整性。
# 退出语义与设计依据: 纯扫描与静态 JSON 校验模块，零状态变更副作用，严格执行深度与虚拟路径隔离
# ==============================================================================

## ModFileWatcherScanner：MOD 目录递归文件指纹采集与 JSON 语法预检扫描器
class_name ModFileWatcherScanner
extends RefCounted

const MAX_SCAN_DEPTH: int = 8


## 将 res:// 或 user:// 虚拟路径转换为全局本地路径
static func resolve_absolute_path(candidate_path: String) -> String:
	if candidate_path.begins_with("res://") or candidate_path.begins_with("user://"):
		return ProjectSettings.globalize_path(candidate_path)
	return candidate_path


## 采集受监控目录列表内全部 JSON 文件的最新时间戳与 SHA-256 映射
static func collect_watched_json_files(watched_directories: Array[String]) -> Dictionary:
	var latest_files: Dictionary = {}
	for root_directory in watched_directories:
		if DirAccess.dir_exists_absolute(root_directory):
			scan_directory_recursive(root_directory, root_directory, 0, latest_files)
	return latest_files


## 递归扫描单个目录并将 JSON 文件指纹填入目标字典
static func scan_directory_recursive(
	root_directory: String,
	current_directory: String,
	depth_level: int,
	collected_files: Dictionary
) -> void:
	if depth_level > MAX_SCAN_DEPTH:
		return
	var directory_handle := DirAccess.open(current_directory)
	if directory_handle == null:
		return
	directory_handle.list_dir_begin()
	var entry_name: String = directory_handle.get_next()
	while entry_name != "":
		_visit_directory_entry(directory_handle, root_directory, current_directory, entry_name, depth_level, collected_files)
		entry_name = directory_handle.get_next()
	directory_handle.list_dir_end()


## 比对基线追踪映射与最新文件指纹映射，返回排序后的变更路径清单
static func collect_changed_paths(tracked_files: Dictionary, latest_files: Dictionary) -> Array[String]:
	var changed_paths: Array[String] = []
	for latest_path in latest_files.keys():
		if not tracked_files.has(latest_path):
			changed_paths.append(str(latest_path))
			continue
		var prior_entry: Dictionary = tracked_files[latest_path] as Dictionary
		var next_entry: Dictionary = latest_files[latest_path] as Dictionary
		var time_changed: bool = int(prior_entry.get("modified_time", 0)) != int(next_entry.get("modified_time", 0))
		var hash_changed: bool = str(prior_entry.get("sha256", "")) != str(next_entry.get("sha256", ""))
		if time_changed or hash_changed:
			changed_paths.append(str(latest_path))

	for tracked_path in tracked_files.keys():
		if not latest_files.has(tracked_path):
			changed_paths.append(str(tracked_path))
	changed_paths.sort()
	return changed_paths


## 逐一校验发生变化或缺失文件的非空性与 JSON 语法有效性
static func validate_changed_json_files(changed_paths: Array[String], latest_files: Dictionary) -> Dictionary:
	for candidate_path in changed_paths:
		if not latest_files.has(candidate_path):
			return {"valid": false, "error_code": "ERR_MOD_FILE_REMOVED", "message": "Watched MOD file removed: %s" % candidate_path}
		var text_content: String = FileAccess.get_file_as_string(candidate_path)
		if text_content.is_empty():
			return {"valid": false, "error_code": "ERR_MOD_EMPTY_JSON", "message": "Empty MOD JSON file: %s" % candidate_path}
		var parsed_object: Variant = JSON.parse_string(text_content)
		if not (parsed_object is Dictionary) and not (parsed_object is Array):
			return {"valid": false, "error_code": "ERR_MOD_JSON_SYNTAX", "message": "Invalid JSON syntax in MOD file: %s" % candidate_path}
	return {"valid": true}


static func _visit_directory_entry(
	directory_handle: DirAccess,
	root_directory: String,
	current_directory: String,
	entry_name: String,
	depth_level: int,
	collected_files: Dictionary
) -> void:
	if entry_name.begins_with("."):
		return
	var entry_path: String = current_directory.path_join(entry_name)
	if directory_handle.current_is_dir():
		scan_directory_recursive(root_directory, entry_path, depth_level + 1, collected_files)
		return
	if entry_name.to_lower().ends_with(".json"):
		collected_files[entry_path] = _make_file_fingerprint(root_directory, entry_path)


static func _make_file_fingerprint(root_directory: String, file_path: String) -> Dictionary:
	return {
		"root_directory": root_directory,
		"modified_time": int(FileAccess.get_modified_time(file_path)),
		"sha256": FileAccess.get_file_as_string(file_path).sha256_text(),
	}
