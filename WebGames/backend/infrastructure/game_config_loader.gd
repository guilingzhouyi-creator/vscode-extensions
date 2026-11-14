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

const BinaryConfigReader = preload("res://backend/infrastructure/binary_config_reader.gd")
const ConfigRouterEngine = preload("res://backend/infrastructure/config_router_engine.gd")
const SystemBaseMessages = preload("res://backend/infrastructure/logging/system_base_messages.gd")

const CONFIG_DIR: String = "res://config/"
const EXT_JSON: String = ".json"
const EXT_KDAT: String = ".kdat"
const PATH_CONFIG_BUNDLE: String = "res://config/config.kdat"
const PATH_STORAGE_CATALOG_SCRIPT: String = "res://backend/domains/persistence_protocol/storage_resource_catalog.gd"
const PATH_AUX_WORKER_POOL_SCRIPT: String = "res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd"
const PATH_BATCH_LOAD_REQUEST_SCRIPT: String = "res://backend/domains/persistence_protocol/dto/batch_load_request_dto.gd"
const CAT_CONFIG: String = "config"
const METHOD_GET_INSTANCE: String = "get_instance"
const METHOD_RESOLVE_CONFIG_TABLE_ENTRY: String = "resolve_config_table_entry"
const METHOD_GET_CRITICAL_BOOT_ENTRIES: String = "get_critical_boot_entries"
const BATCH_ID_CONFIG_BULK: String = "config_bulk_async"


## 获取统一资源目录实例（动态解耦，杜绝跨层静态强引用）
static func get_catalog() -> Variant:
	if ResourceLoader.exists(PATH_STORAGE_CATALOG_SCRIPT):
		var catalog_script: Variant = load(PATH_STORAGE_CATALOG_SCRIPT)
		if catalog_script != null and catalog_script.has_method(METHOD_GET_INSTANCE):
			return catalog_script.get_instance()
	return null


## 按优先级装载全量配置表（Monolithic Bundle 优先，回退递归目录扫描）
static func load_all_tables_into(out_tables: Dictionary, scan_failures: Array, scan_warnings: Array = []) -> void:
	if FileAccess.file_exists(PATH_CONFIG_BUNDLE):
		var bundle_data: Dictionary = BinaryConfigReader.load_monolithic_bundle(PATH_CONFIG_BUNDLE)
		if not bundle_data.is_empty():
			for table_name in bundle_data:
				out_tables[table_name] = bundle_data[table_name]
			return
	scan_dir_into(CONFIG_DIR, "", out_tables, scan_failures, scan_warnings)


## JIT 靶向按需加载单个配置表（消除冷启动全局阻塞）
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
	elif FileAccess.file_exists(base_path + EXT_JSON):
		load_single_table_into(base_path + EXT_JSON, target_name, tables, scan_failures, scan_warnings)


## 同步极速加载 L0 核心底座配置表
static func load_l0_entries_into(tables: Dictionary, scan_failures: Array, scan_warnings: Array = []) -> int:
	var catalog: Variant = get_catalog()
	var loaded_count: int = 0
	if catalog != null and catalog.has_method(METHOD_GET_CRITICAL_BOOT_ENTRIES):
		for entry in catalog.get_critical_boot_entries():
			var table_name: String = str(entry.metadata.get("table_name", ""))
			if not table_name.is_empty() and not tables.has(table_name):
				load_single_table_into(entry.physical_path, table_name, tables, scan_failures, scan_warnings)
				loaded_count += 1
	return loaded_count


## 尝试向异步储存工作池提交配置表批量装载任务（条件不满足返回 false 供同步回退）
static func try_enqueue_async_config_batch(
	tables: Dictionary,
	on_item_loaded: Callable,
	on_batch_completed: Callable
) -> bool:
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
		return {"success": false, "subtable": resolved, "error": "FILE_NOT_FOUND", "file_path": file_path}

	var json := JSON.new()
	var text: String = FileAccess.get_file_as_string(file_path)
	if json.parse(text) != OK:
		return {"success": false, "subtable": resolved, "error": "JSON_PARSE_FAILED", "details": json.get_error_message()}

	var data: Variant = json.get_data()
	if not (data is Dictionary):
		return {"success": false, "subtable": resolved, "error": "NOT_A_JSON_OBJECT"}
	return {"success": true, "data": data}


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
	dir_path: String,
	table_prefix: String,
	out_tables: Dictionary,
	scan_failures: Array,
	scan_warnings: Array = []
) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		scan_warnings.append(SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_DIR_MISSING, {"path": dir_path}))
		return
	var scanned_tables: Dictionary = {}
	for file_name in dir.get_files():
		if file_name.ends_with(EXT_KDAT):
			var table_name: String = file_name.trim_suffix(EXT_KDAT)
			if not table_prefix.is_empty():
				table_name = table_prefix + "." + table_name
			load_single_table_into(dir_path + file_name, table_name, out_tables, scan_failures, scan_warnings)
			scanned_tables[table_name] = true
	for file_name in dir.get_files():
		if file_name.ends_with(EXT_JSON):
			var table_name: String = file_name.trim_suffix(EXT_JSON)
			if not table_prefix.is_empty():
				table_name = table_prefix + "." + table_name
			if not scanned_tables.has(table_name):
				load_single_table_into(dir_path + file_name, table_name, out_tables, scan_failures, scan_warnings)
	for sub_dir in dir.get_directories():
		var sub_prefix: String = sub_dir if table_prefix.is_empty() else table_prefix + "." + sub_dir
		scan_dir_into(dir_path + sub_dir + "/", sub_prefix, out_tables, scan_failures, scan_warnings)


## 加载单张 .kdat 或 .json 表文件写入 out_tables
static func load_single_table_into(
	file_path: String,
	table_name: String,
	out_tables: Dictionary,
	scan_failures: Array,
	scan_warnings: Array = []
) -> void:
	if file_path.ends_with(EXT_KDAT):
		var kdat_data: Variant = BinaryConfigReader.load_kdat_file(file_path)
		if kdat_data != null and (kdat_data is Dictionary):
			out_tables[table_name] = kdat_data
			return
		scan_failures.append(SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_KDAT_FAIL, {"path": file_path}))
		scan_warnings.append(SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_KDAT_WARN, {"path": file_path}))
		return

	var json := JSON.new()
	var text: String = FileAccess.get_file_as_string(file_path)
	var parse_error: Error = json.parse(text)
	if parse_error != OK:
		scan_failures.append(SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_JSON_FAIL, {"path": file_path, "line": json.get_error_line()}))
		scan_warnings.append(SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_JSON_WARN, {
			"path": file_path, "error": json.get_error_message(), "line": json.get_error_line()
		}))
		return
	var data: Variant = json.get_data()
	if data is Dictionary:
		out_tables[table_name] = data
	else:
		scan_failures.append(SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_ROOT_OBJECT, {"path": file_path}))
		scan_warnings.append(SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_ROOT_WARN, {"path": file_path}))
