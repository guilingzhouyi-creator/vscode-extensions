# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Loader Engine)
# 文件路径: res://backend/infrastructure/game_config_loader.gd
# 架构定位: Infrastructure I/O & Snapshot Builder Helper
# 依赖与触发: 上游: GameConfig | 下游: BinaryConfigReader, ConfigRouterEngine, SystemBaseMessages, DirAccess, FileAccess | 配置: res://config/**
# 职责说明: 为 GameConfig 承担物理目录扫描、.kdat/.json 单表加载、JIT 按需读盘、异步工作池装载及热重载快照差异计算，实现查询门面与 I/O 构表分层解耦。
# 退出语义与设计依据: 基础设施单向依赖与热重载原子构表契约
# ==============================================================================

## GameConfigLoader：配置表扫描、.kdat/.json 解码与热重载快照构建引擎
class_name GameConfigLoader
extends RefCounted

const CONFIG_DIR: String = "res://config/"
const EXT_JSON: String = ".json"
const EXT_KDAT: String = ".kdat"
const FILE_CONFIG_BUNDLE: String = "config.kdat"
const PATH_CONFIG_BUNDLE: String = "res://config/config.kdat"
const PATH_STORAGE_CATALOG_SCRIPT: String = "res://backend/domains/persistence_protocol/storage_resource_catalog.gd"
const PATH_AUX_WORKER_POOL_SCRIPT: String = "res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd"
const PATH_BATCH_LOAD_REQUEST_SCRIPT: String = "res://backend/domains/persistence_protocol/dto/batch_load_request_dto.gd"
const CAT_CONFIG: String = "config"
const METHOD_GET_INSTANCE: String = "get_instance"
const METHOD_RESOLVE_CONFIG_TABLE_ENTRY: String = "resolve_config_table_entry"
const METHOD_GET_CRITICAL_BOOT_ENTRIES: String = "get_critical_boot_entries"
const BATCH_ID_CONFIG_BULK: String = "config_bulk_async"

static var _override_config_bundle_path_for_test: String = ""


## 测试注入专用：覆写或清空 Monolithic config.kdat 路径探针（供无头测试验证发行包回退）
static func set_config_bundle_path_override_for_test(bundle_path: String) -> void:
	_override_config_bundle_path_for_test = bundle_path.strip_edges()


## 解析实际可用的 Monolithic config.kdat 路径（测试覆写 -> res://config/config.kdat -> 发行版可执行同级 config.kdat）
static func resolve_config_bundle_path() -> String:
	if not _override_config_bundle_path_for_test.is_empty():
		return _override_config_bundle_path_for_test if FileAccess.file_exists(_override_config_bundle_path_for_test) else ""
	if FileAccess.file_exists(PATH_CONFIG_BUNDLE):
		return PATH_CONFIG_BUNDLE
	if not AssetPathResolver.is_engineering_build():
		var exe_path := OS.get_executable_path().strip_edges()
		if not exe_path.is_empty():
			var adjacent_bundle := exe_path.get_base_dir().path_join(FILE_CONFIG_BUNDLE)
			if FileAccess.file_exists(adjacent_bundle):
				return adjacent_bundle
	return ""


## 从当前解析到的 Monolithic config.kdat 解码全量配置表快照（不存在或损坏时返回空字典）
static func load_bundle_tables_snapshot() -> Dictionary:
	var bundle_path := resolve_config_bundle_path()
	if bundle_path.is_empty():
		return {}
	return BinaryConfigReader.load_monolithic_bundle(bundle_path)


## 获取统一资源目录实例（动态解耦，杜绝跨层静态强引用）
static func get_catalog() -> Variant:
	if ResourceLoader.exists(PATH_STORAGE_CATALOG_SCRIPT):
		var catalog_script: Variant = load(PATH_STORAGE_CATALOG_SCRIPT)
		if catalog_script != null and catalog_script.has_method(METHOD_GET_INSTANCE):
			return catalog_script.get_instance()
	return null


## 按优先级装载全量配置表（Monolithic Bundle 优先，回退递归收集文件清单并由 WorkerThreadPool 并行解析）
static func load_all_tables_into(target_tables: Dictionary, scan_failures: Array, scan_warnings: Array = []) -> void:
	var bundle_tables: Dictionary = load_bundle_tables_snapshot()
	if not bundle_tables.is_empty():
		for table_name in bundle_tables:
			target_tables[table_name] = bundle_tables[table_name]
		return
	var entries: Array[Dictionary] = []
	collect_config_entries_recursive(CONFIG_DIR, "", entries, scan_warnings)
	load_entries_parallel_into(entries, target_tables, scan_failures, scan_warnings)


## 递归收集配置目录中的表文件清单（同表 .kdat 优先于 .json；仅触碰 DirAccess 一次）
static func collect_config_entries_recursive(
	directory_path: String,
	table_prefix: String,
	out_entries: Array[Dictionary],
	scan_warnings: Array = []
) -> void:
	var directory_access := DirAccess.open(directory_path)
	if directory_access == null:
		scan_warnings.append(SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_DIR_MISSING, {"path": directory_path}))
		return
	var directory_files := directory_access.get_files()
	var scanned_tables: Dictionary = {}
	var json_candidates: Array[String] = []
	for file_name in directory_files:
		if file_name.ends_with(EXT_KDAT):
			var table_name: String = file_name.trim_suffix(EXT_KDAT)
			if not table_prefix.is_empty():
				table_name = table_prefix + "." + table_name
			out_entries.append({"path": directory_path + file_name, "table": table_name})
			scanned_tables[table_name] = true
		elif file_name.ends_with(EXT_JSON):
			json_candidates.append(file_name)
	for json_file_name in json_candidates:
		var table_name: String = json_file_name.trim_suffix(EXT_JSON)
		if not table_prefix.is_empty():
			table_name = table_prefix + "." + table_name
		if not scanned_tables.has(table_name):
			out_entries.append({"path": directory_path + json_file_name, "table": table_name})
	for subdirectory in directory_access.get_directories():
		var subtable_prefix: String = subdirectory if table_prefix.is_empty() else table_prefix + "." + subdirectory
		collect_config_entries_recursive(directory_path + subdirectory + "/", subtable_prefix, out_entries, scan_warnings)


## 收集尚未进入 existing_tables 的配置条目清单（供贪婪后台预热）
static func collect_missing_config_entries(existing_tables: Dictionary) -> Array[Dictionary]:
	var all_entries: Array[Dictionary] = []
	var ignored_warnings: Array = []
	collect_config_entries_recursive(CONFIG_DIR, "", all_entries, ignored_warnings)
	var missing_entries: Array[Dictionary] = []
	for entry in all_entries:
		var table_name: String = str(entry.get("table", ""))
		if not table_name.is_empty() and not existing_tables.has(table_name):
			missing_entries.append(entry)
	return missing_entries


## 后台预热线程体：并行解析缺失表并在互斥锁下无损汇入全局配置容器
static func execute_greedy_prefetch_worker(
	missing_entries: Array[Dictionary],
	tables: Dictionary,
	base_tables: Dictionary,
	base_tables_synced: bool,
	tables_mutex: Mutex,
	on_completed: Callable
) -> void:
	var prefetched_tables: Dictionary = {}
	var failures: Array = []
	var warnings: Array = []
	load_entries_parallel_into(missing_entries, prefetched_tables, failures, warnings)
	var duplicated_base: Dictionary = prefetched_tables.duplicate(true) if base_tables_synced else {}
	tables_mutex.lock()
	for table_name in prefetched_tables:
		if not tables.has(table_name):
			tables[table_name] = prefetched_tables[table_name]
			if base_tables_synced and duplicated_base.has(table_name):
				base_tables[table_name] = duplicated_base[table_name]
	tables_mutex.unlock()
	if on_completed.is_valid():
		on_completed.call_deferred(tables.size())


## 按预先分段路径遍历配置表节点（支持字典键与非负数组整数下标）
static func traverse_table_path(table: Variant, path_parts: PackedStringArray) -> Variant:
	var current_node: Variant = table
	for part in path_parts:
		if current_node is Dictionary and current_node.has(part):
			current_node = current_node[part]
		elif current_node is Array and part.is_valid_int():
			var array_index := part.to_int()
			if array_index >= 0 and array_index < (current_node as Array).size():
				current_node = (current_node as Array)[array_index]
			else:
				return null
		else:
			return null
	return current_node


## 利用 WorkerThreadPool 组任务并发读取并解析配置表条目数组写入 target_tables
static func load_entries_parallel_into(
	entries: Array[Dictionary],
	target_tables: Dictionary,
	scan_failures: Array,
	scan_warnings: Array = []
) -> void:
	var entry_count := entries.size()
	if entry_count == 0:
		return
	var slot_results: Array = []
	slot_results.resize(entry_count)
	var parse_worker := func(entry_index: int) -> void:
		var entry: Dictionary = entries[entry_index]
		slot_results[entry_index] = _parse_single_table_entry(str(entry["path"]), str(entry["table"]))
	if entry_count == 1:
		parse_worker.call(0)
	else:
		var task_id := WorkerThreadPool.add_group_task(parse_worker, entry_count, -1, true, "LoadGameConfigTables")
		WorkerThreadPool.wait_for_group_task_completion(task_id)
	for entry_index in range(entry_count):
		var slot_result: Dictionary = slot_results[entry_index]
		if bool(slot_result.get("ok", false)):
			target_tables[str(slot_result["table"])] = slot_result["data"]
			continue
		if slot_result.has("failure"):
			scan_failures.append(slot_result["failure"])
		if slot_result.has("warning"):
			scan_warnings.append(slot_result["warning"])


## JIT 靶向按需加载单个配置表（消除冷启动全局阻塞，发行态自动回退至 config.kdat）
static func ensure_table_loaded_jit(
	table_name: String,
	tables: Dictionary,
	scan_failures: Array,
	scan_warnings: Array = []
) -> void:
	var target_name: String = ConfigRouterEngine.resolve_table_name(table_name)
	if tables.has(target_name):
		return
	var catalog: Variant = get_catalog()
	if catalog != null and catalog.has_method(METHOD_RESOLVE_CONFIG_TABLE_ENTRY):
		var entry: Variant = catalog.resolve_config_table_entry(target_name)
		if entry != null and not str(entry.physical_path).is_empty():
			var path_kdat: String = str(entry.physical_path).trim_suffix(EXT_JSON) + EXT_KDAT
			if FileAccess.file_exists(path_kdat):
				load_single_table_into(path_kdat, target_name, tables, scan_failures, scan_warnings)
				return
			elif FileAccess.file_exists(entry.physical_path):
				load_single_table_into(entry.physical_path, target_name, tables, scan_failures, scan_warnings)
				return

	var parts: PackedStringArray = target_name.split(".")
	var base_path: String = CONFIG_DIR + "/".join(parts)
	if FileAccess.file_exists(base_path + EXT_KDAT):
		load_single_table_into(base_path + EXT_KDAT, target_name, tables, scan_failures, scan_warnings)
		return
	if FileAccess.file_exists(base_path + EXT_JSON):
		load_single_table_into(base_path + EXT_JSON, target_name, tables, scan_failures, scan_warnings)
		return

	var bundle_tables: Dictionary = load_bundle_tables_snapshot()
	var resolved_bundle_key: String = _resolve_bundle_table_key(bundle_tables, target_name)
	if not resolved_bundle_key.is_empty():
		tables[resolved_bundle_key] = bundle_tables[resolved_bundle_key]


static func _resolve_bundle_table_key(bundle_tables: Dictionary, table_name: String) -> String:
	if bundle_tables.has(table_name) and bundle_tables[table_name] is Dictionary:
		return table_name
	var core_key: String = table_name + ".core"
	if bundle_tables.has(core_key) and bundle_tables[core_key] is Dictionary:
		return core_key
	var resolved_alias: String = ConfigRouterEngine.resolve_table_name(table_name)
	if bundle_tables.has(resolved_alias) and bundle_tables[resolved_alias] is Dictionary:
		return resolved_alias
	return ""


## 同步极速加载 L0 核心基础配置表（发行态当 res://config/ 被剔除时整包从 config.kdat 装入）
static func load_l0_entries_into(tables: Dictionary, scan_failures: Array, scan_warnings: Array = []) -> int:
	var catalog: Variant = get_catalog()
	var loaded_count: int = 0
	var bundle_cache: Dictionary = {}
	var bundle_probed: bool = false
	if catalog != null and catalog.has_method(METHOD_GET_CRITICAL_BOOT_ENTRIES):
		for entry in catalog.get_critical_boot_entries():
			var table_name: String = str(entry.metadata.get("table_name", ""))
			if table_name.is_empty() or tables.has(table_name):
				continue
			if FileAccess.file_exists(entry.physical_path):
				load_single_table_into(entry.physical_path, table_name, tables, scan_failures, scan_warnings)
				loaded_count += 1
				continue
			if not bundle_probed:
				bundle_cache = load_bundle_tables_snapshot()
				bundle_probed = true
			var bundle_key: String = _resolve_bundle_table_key(bundle_cache, table_name)
			if not bundle_key.is_empty():
				tables[bundle_key] = bundle_cache[bundle_key]
				loaded_count += 1
	return loaded_count


## 尝试向异步储存工作池提交配置表批量装载任务（条件不满足或存在单体 config.kdat 时返回 false 供同步整包回退）
static func try_enqueue_async_config_batch(
	tables: Dictionary,
	on_item_loaded: Callable,
	on_batch_completed: Callable
) -> bool:
	if not resolve_config_bundle_path().is_empty():
		return false
	var catalog: Variant = get_catalog()
	if catalog == null or not ResourceLoader.exists(PATH_AUX_WORKER_POOL_SCRIPT):
		return false

	var pool_script: Variant = load(PATH_AUX_WORKER_POOL_SCRIPT)
	var pool: Variant = pool_script.get_instance() if pool_script != null else null
	var batch_script: Variant = load(PATH_BATCH_LOAD_REQUEST_SCRIPT)
	if pool == null or batch_script == null:
		return false

	var batch_request: Variant = batch_script.new(BATCH_ID_CONFIG_BULK)
	for entry in catalog.get_entries_by_category(CAT_CONFIG):
		var table_name: String = str(entry.metadata.get("table_name", ""))
		if not table_name.is_empty() and not tables.has(table_name):
			batch_request.add_entry(entry)

	batch_request.on_item_loaded = on_item_loaded
	batch_request.on_batch_completed = on_batch_completed
	pool.enqueue_batch(batch_request)
	return true


## 解析并读取单张 JSON 配置表（供热重载单子表使用）
static func load_single_subtable_json(resolved: String) -> Dictionary:
	var parts: PackedStringArray = resolved.split(".")
	var file_path: String = CONFIG_DIR + "/".join(parts) + EXT_JSON
	if not FileAccess.file_exists(file_path):
		return {"success": false, "subtable": resolved, "error_code": "FILE_NOT_FOUND", "file_path": file_path}

	var json := JSON.new()
	var text: String = FileAccess.get_file_as_string(file_path)
	if json.parse(text) != OK:
		return {"success": false, "subtable": resolved, "error_code": "JSON_PARSE_FAILED", "details": json.get_error_message()}

	var parsed_payload: Variant = json.get_data()
	if not (parsed_payload is Dictionary):
		return {"success": false, "subtable": resolved, "error_code": "NOT_A_JSON_OBJECT"}
	return {"success": true, "data": parsed_payload}


## 检测当前快照缺失的必需配置表清单
static func collect_missing_required(tables: Dictionary, required_tables: Array) -> Array:
	var missing: Array = []
	for table_name in required_tables:
		if not tables.has(table_name):
			missing.append(table_name)
	return missing


## 比对新旧配置表快照集合，返回 added / changed / removed 变更摘要
static func diff_table_snapshots(old_tables: Dictionary, built_tables: Dictionary) -> Dictionary:
	var added: Array = []
	var changed: Array = []
	for table_key in built_tables:
		if not old_tables.has(table_key):
			added.append(table_key)
		elif old_tables[table_key] != built_tables[table_key]:
			changed.append(table_key)
	var removed: Array = []
	for table_key in old_tables:
		if not built_tables.has(table_key):
			removed.append(table_key)
	return {"added": added, "changed": changed, "removed": removed}


## 递归扫描配置目录并加载 (.kdat 优先于 .json)
static func scan_dir_into(
	directory_path: String,
	table_prefix: String,
	target_tables: Dictionary,
	scan_failures: Array,
	scan_warnings: Array = []
) -> void:
	var directory_access := DirAccess.open(directory_path)
	if directory_access == null:
		scan_warnings.append(SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_DIR_MISSING, {"path": directory_path}))
		return
	var directory_files := directory_access.get_files()
	var scanned_tables: Dictionary = {}
	var json_candidates: Array[String] = []
	for file_name in directory_files:
		if file_name.ends_with(EXT_KDAT):
			var table_name: String = file_name.trim_suffix(EXT_KDAT)
			if not table_prefix.is_empty():
				table_name = table_prefix + "." + table_name
			load_single_table_into(directory_path + file_name, table_name, target_tables, scan_failures, scan_warnings)
			scanned_tables[table_name] = true
		elif file_name.ends_with(EXT_JSON):
			json_candidates.append(file_name)
	for json_file_name in json_candidates:
		var table_name: String = json_file_name.trim_suffix(EXT_JSON)
		if not table_prefix.is_empty():
			table_name = table_prefix + "." + table_name
		if not scanned_tables.has(table_name):
			load_single_table_into(directory_path + json_file_name, table_name, target_tables, scan_failures, scan_warnings)
	for subdirectory in directory_access.get_directories():
		var subtable_prefix: String = subdirectory if table_prefix.is_empty() else table_prefix + "." + subdirectory
		scan_dir_into(directory_path + subdirectory + "/", subtable_prefix, target_tables, scan_failures, scan_warnings)


## 加载单张 .kdat 或 .json 表文件写入 target_tables
static func load_single_table_into(
	file_path: String,
	table_name: String,
	target_tables: Dictionary,
	scan_failures: Array,
	scan_warnings: Array = []
) -> void:
	var parsed_result := _parse_single_table_entry(file_path, table_name)
	if bool(parsed_result.get("ok", false)):
		target_tables[table_name] = parsed_result["data"]
		return
	if parsed_result.has("failure"):
		scan_failures.append(parsed_result["failure"])
	if parsed_result.has("warning"):
		scan_warnings.append(parsed_result["warning"])


static func _parse_single_table_entry(file_path: String, table_name: String) -> Dictionary:
	if file_path.ends_with(EXT_KDAT):
		var kdat_payload: Variant = BinaryConfigReader.load_kdat_file(file_path)
		if kdat_payload != null and (kdat_payload is Dictionary):
			return {"ok": true, "table": table_name, "data": kdat_payload}
		return {
			"ok": false,
			"failure": SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_KDAT_FAIL, {"path": file_path}),
			"warning": SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_KDAT_WARN, {"path": file_path})
		}

	var json := JSON.new()
	var text: String = FileAccess.get_file_as_string(file_path)
	var parse_error: Error = json.parse(text)
	if parse_error != OK:
		return {
			"ok": false,
			"failure": SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_JSON_FAIL, {"path": file_path, "line": json.get_error_line()}),
			"warning": SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_JSON_WARN, {
				"path": file_path, "error": json.get_error_message(), "line": json.get_error_line()
			})
		}
	var parsed_payload: Variant = json.get_data()
	if parsed_payload is Dictionary:
		return {"ok": true, "table": table_name, "data": parsed_payload}
	return {
		"ok": false,
		"failure": SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_ROOT_OBJECT, {"path": file_path}),
		"warning": SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_ROOT_WARN, {"path": file_path})
	}
