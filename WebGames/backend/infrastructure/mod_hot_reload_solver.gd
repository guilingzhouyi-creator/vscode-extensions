# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · MOD 现场热重载求解器)
# 文件路径: res://backend/infrastructure/mod_hot_reload_solver.gd
# 架构定位: Atomic MOD Precheck-Rollback Hot Reload State Machine
# 依赖与触发: 上游: CompanionIPCRouter, ModWorkbenchView | 下游: ModFileWatcherScanner, EventBusCore
# 职责说明: 编排本地 MOD 目录监控生命周期、预检门禁校验、原子状态提交与校验失败时的无损快照回滚。
# 退出语义与设计依据: 失败即自动回滚，绝不破坏运行期活跃配置；通过注入回调实现基础设施层与领域校验解耦
# ==============================================================================

## ModHotReloadSolver：MOD 热重载预检门禁与失败自动回滚状态机
class_name ModHotReloadSolver
extends RefCounted

const MAX_HISTORY_ENTRIES: int = 16

var _watched_directories: Array[String] = []
var _tracked_files: Dictionary = {}
var _last_valid_snapshot: Dictionary = {}
var _last_report: Dictionary = {}
var _reload_history: Array[Dictionary] = []
var _validate_callback: Callable = Callable()
var _apply_callback: Callable = Callable()
var _snapshot_callback: Callable = Callable()
var _revision_counter: int = 0


## 注入热重载预检回调、原子应用回调与状态快照读取回调（依赖倒置解耦领域校验器）
func bind_reload_pipeline(
	validate_callback: Callable,
	apply_callback: Callable,
	snapshot_getter: Callable = Callable()
) -> void:
	_validate_callback = validate_callback
	_apply_callback = apply_callback
	_snapshot_callback = snapshot_getter


## 注册待监听的本地 MOD 根目录并采样初始时间戳与 SHA-256 基线
func watch_directory(directory_path: String) -> Dictionary:
	var cleaned_directory: String = ModFileWatcherScanner.resolve_absolute_path(directory_path.strip_edges()).rstrip("/\\")
	if cleaned_directory.is_empty() or cleaned_directory.contains(".."):
		return {"success": false, "error_code": "ERR_HOT_RELOAD_INVALID_DIR", "directory": directory_path}
	if not DirAccess.dir_exists_absolute(cleaned_directory):
		return {"success": false, "error_code": "ERR_HOT_RELOAD_DIR_MISSING", "directory": cleaned_directory}
	if not _watched_directories.has(cleaned_directory):
		_watched_directories.append(cleaned_directory)

	var current_files: Dictionary = {}
	ModFileWatcherScanner.scan_directory_recursive(cleaned_directory, cleaned_directory, 0, current_files)
	for file_key in current_files.keys():
		_tracked_files[file_key] = current_files[file_key]

	_refresh_valid_snapshot_from_getter()
	return {
		"success": true,
		"directory": cleaned_directory,
		"tracked_file_count": current_files.size(),
	}


## 清空全部 MOD 监听目录与基线状态（用于对称退出或测试用例隔离）
func clear_watches() -> void:
	_watched_directories.clear()
	_tracked_files.clear()
	_last_valid_snapshot.clear()
	_last_report.clear()
	_reload_history.clear()
	_validate_callback = Callable()
	_apply_callback = Callable()
	_snapshot_callback = Callable()
	_revision_counter = 0


## 人为将指定文件基线时间戳设为过期（供无阻塞确定性测试触发变更扫描）
func invalidate_file_baseline_for_test(file_path: String) -> bool:
	var normalized_path: String = ModFileWatcherScanner.resolve_absolute_path(file_path.strip_edges())
	if not _tracked_files.has(normalized_path):
		return false
	var baseline_entry: Dictionary = _tracked_files[normalized_path] as Dictionary
	baseline_entry["sha256"] = "outdated_baseline_digest"
	baseline_entry["modified_time"] = -1
	_tracked_files[normalized_path] = baseline_entry
	return true


## 扫描受监控目录的 .json 文件变更，执行语法与业务预检并在失败时自动回滚
func poll_and_apply_changes() -> Dictionary:
	if _watched_directories.is_empty():
		return _build_idle_report()

	var latest_files: Dictionary = ModFileWatcherScanner.collect_watched_json_files(_watched_directories)
	var changed_paths: Array[String] = ModFileWatcherScanner.collect_changed_paths(_tracked_files, latest_files)
	if changed_paths.is_empty():
		return _build_idle_report()

	var previous_snapshot: Dictionary = _capture_live_or_cached_snapshot()
	var parse_outcome: Dictionary = ModFileWatcherScanner.validate_changed_json_files(changed_paths, latest_files)
	if not bool(parse_outcome.get("valid", false)):
		return _rollback_on_failure(changed_paths, parse_outcome, previous_snapshot)

	var pipeline_outcome: Dictionary = _run_injected_validation(changed_paths, latest_files)
	if not bool(pipeline_outcome.get("valid", true)):
		return _rollback_on_failure(changed_paths, pipeline_outcome, previous_snapshot)

	_commit_baseline_updates(changed_paths, latest_files)
	if _apply_callback.is_valid():
		_apply_callback.call(changed_paths.duplicate(), latest_files.duplicate(true))
	_refresh_valid_snapshot_from_getter()

	_revision_counter += 1
	var success_report: Dictionary = _build_reload_report(true, false, "", changed_paths, "")
	_record_history(success_report)
	EventBusCore.get_instance().emit_log(LogConstants.LEVEL_LOWER_INFO, "MOD hot reload applied")
	return success_report


## 返回当前监听状态、已追踪文件数、累计热更版本号与最近一次报告
func get_status() -> Dictionary:
	return {
		"watched_directories": _watched_directories.duplicate(),
		"tracked_file_count": _tracked_files.size(),
		"revision": _revision_counter,
		"last_report": _last_report.duplicate(true),
		"history_count": _reload_history.size(),
	}


func _rollback_on_failure(changed_paths: Array[String], failure_outcome: Dictionary, previous_snapshot: Dictionary) -> Dictionary:
	_last_valid_snapshot = previous_snapshot.duplicate(true)
	var error_code: String = str(failure_outcome.get("error_code", "ERR_MOD_HOT_RELOAD_VALIDATION_FAILED"))
	var failure_reason: String = str(failure_outcome.get("message", "MOD hot reload precheck failed"))
	var report: Dictionary = _build_reload_report(false, true, error_code, changed_paths, failure_reason)
	report["restored_snapshot"] = _last_valid_snapshot.duplicate(true)
	_record_history(report)
	EventBusCore.get_instance().emit_log(LogConstants.LEVEL_LOWER_WARN, failure_reason)
	return report


func _run_injected_validation(changed_paths: Array[String], latest_files: Dictionary) -> Dictionary:
	if not _validate_callback.is_valid():
		return {"valid": true}
	var outcome: Variant = _validate_callback.call(changed_paths.duplicate(), latest_files.duplicate(true))
	if outcome is Dictionary:
		return outcome as Dictionary
	return {"valid": bool(outcome)}


func _commit_baseline_updates(changed_paths: Array[String], latest_files: Dictionary) -> void:
	for path_entry in changed_paths:
		if latest_files.has(path_entry):
			_tracked_files[path_entry] = latest_files[path_entry]
		else:
			_tracked_files.erase(path_entry)


func _refresh_valid_snapshot_from_getter() -> void:
	if not _snapshot_callback.is_valid():
		return
	var captured_snapshot: Variant = _snapshot_callback.call()
	if captured_snapshot is Dictionary:
		_last_valid_snapshot = (captured_snapshot as Dictionary).duplicate(true)


func _capture_live_or_cached_snapshot() -> Dictionary:
	if _snapshot_callback.is_valid():
		var live_snapshot: Variant = _snapshot_callback.call()
		if live_snapshot is Dictionary:
			return (live_snapshot as Dictionary).duplicate(true)
	return _last_valid_snapshot.duplicate(true)


func _build_idle_report() -> Dictionary:
	return {
		"success": true,
		"changed": false,
		"rolled_back": false,
		"revision": _revision_counter,
		"changed_files": [],
	}


func _build_reload_report(
	succeeded: bool,
	rolled_back: bool,
	error_code: String,
	changed_paths: Array[String],
	failure_reason: String
) -> Dictionary:
	return {
		"success": succeeded,
		"changed": not changed_paths.is_empty(),
		"rolled_back": rolled_back,
		"error_code": error_code,
		"message": failure_reason,
		"revision": _revision_counter,
		"changed_files": changed_paths.duplicate(),
	}


func _record_history(report_entry: Dictionary) -> void:
	_last_report = report_entry.duplicate(true)
	_reload_history.append(_last_report)
	if _reload_history.size() > MAX_HISTORY_ENTRIES:
		_reload_history.pop_front()
