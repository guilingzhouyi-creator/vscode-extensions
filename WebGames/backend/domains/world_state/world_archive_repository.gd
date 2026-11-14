# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/world_archive_repository.gd
# 架构定位: Domain Repository / Persistence Engine
# 依赖与触发: 上游: GameBootstrap, WorldGateway | 下游: FileAccess, DirAccess, WorldInstance | 配置: config/domains/world_gateway/core.json | 信号: 无
# 职责说明: 负责单机世界档案的物理仓储、目录索引维护、世界子目录管理与状态原子落盘。
# 退出语义与设计依据: 业务域第一性原理 / 单机世界隔离拓扑与事务型原子落盘规范
# ==============================================================================

## WorldArchiveRepository：Domain Repository / Persistence Engine
class_name WorldArchiveRepository
extends RefCounted

const DOMAIN_WORLD_GATEWAY_CONFIG: String = "domains.world_gateway"
const DEFAULT_SP_ROOT_DIR: String = "user://worlds/sp/"
const DEFAULT_CATALOG_FILE: String = "world_catalog.json"
const DEFAULT_TMP_SUFFIX: String = ".tmp"
const DEFAULT_BACKUP_SUFFIX: String = ".bak"
const DEFAULT_FORMAT_VERSION: String = "1.0.0"

## 内存主索引缓存：world_id -> WorldArchiveSummaryDTO
var _worlds_cache: Dictionary = {}

## 目录索引装载标记
var _loaded: bool = false

## 自定义物理根目录（测试隔离沙箱专用）
var _custom_root_directory: String = ""

## 自定义目录索引文件路径（测试隔离沙箱专用）
var _custom_catalog_path: String = ""

## 全局单例引用
static var _instance: WorldArchiveRepository = null

# ==============================================================================
# 一、单例与生命周期管理
# ==============================================================================

## 获取仓储全局单例
static func get_instance() -> WorldArchiveRepository:
	if _instance == null:
		_instance = WorldArchiveRepository.new()
	return _instance

## 测试环境重置：清空内存索引并销毁单例
static func reset_for_tests() -> void:
	if _instance != null:
		_instance._worlds_cache.clear()
		_instance._custom_root_directory = ""
		_instance._custom_catalog_path = ""
		_instance._loaded = false
	_instance = null

## 检查是否已完成目录装载
func is_loaded() -> bool:
	return _loaded

## 设置自定义物理根目录（支持测试沙箱物理隔离）
func set_custom_root_dir(path: String) -> void:
	_custom_root_directory = path

## 设置自定义目录索引文件路径（支持测试沙箱物理隔离）
func set_custom_catalog_path(path: String) -> void:
	_custom_catalog_path = path

## 获取物理根目录路径
func get_root_dir() -> String:
	if not _custom_root_directory.is_empty():
		return _custom_root_directory if _custom_root_directory.ends_with("/") else _custom_root_directory + "/"
	var configured_directory: String = GameConfig.get_string(DOMAIN_WORLD_GATEWAY_CONFIG, "local_archive/root_dir", DEFAULT_SP_ROOT_DIR)
	return configured_directory if configured_directory.ends_with("/") else configured_directory + "/"

## 获取目录索引文件物理路径
func get_catalog_file_path() -> String:
	if not _custom_catalog_path.is_empty():
		return _custom_catalog_path
	var root_directory := get_root_dir()
	var filename: String = GameConfig.get_string(DOMAIN_WORLD_GATEWAY_CONFIG, "local_archive/catalog_file", DEFAULT_CATALOG_FILE)
	return root_directory + filename

## 获取世界独立存储子目录
func get_world_dir(world_id: String) -> String:
	return get_root_dir() + world_id + "/"

# ==============================================================================
# 二、目录索引加载与落盘
# ==============================================================================

## 从物理介质装载 world_catalog.json 并构建内存索引
func load_all() -> Dictionary:
	_loaded = true
	_worlds_cache.clear()

	var catalog_path := get_catalog_file_path()
	var catalog_directory := catalog_path.get_base_dir()
	AtomicFileWriter.ensure_directory(catalog_directory)

	if not FileAccess.file_exists(catalog_path):
		return {"success": true, "count": 0, "error": ""}

	var file := FileAccess.open(catalog_path, FileAccess.READ)
	if file == null:
		return {"success": false, "count": 0, "error": "CATALOG_OPEN_FAILED"}
	var content := file.get_as_text()
	file.close()

	var json := JSON.new()
	if json.parse(content) != OK:
		return {"success": false, "count": 0, "error": "CATALOG_JSON_PARSE_ERROR"}

	var parsed: Variant = json.get_data()
	if not parsed is Dictionary:
		return {"success": false, "count": 0, "error": "INVALID_CATALOG_ROOT"}

	var root_dictionary: Dictionary = parsed
	var raw_worlds: Dictionary = root_dictionary.get("worlds", {})
	for world_key in raw_worlds.keys():
		var raw_world_entry: Variant = raw_worlds[world_key]
		if raw_world_entry is Dictionary:
			var archive_summary := WorldArchiveSummaryDTO.from_dto(raw_world_entry as Dictionary)
			if archive_summary != null and not archive_summary.world_id.is_empty():
				_worlds_cache[archive_summary.world_id] = archive_summary

	return {"success": true, "count": _worlds_cache.size(), "error": ""}

func _ensure_catalog_loaded() -> void:
	if not _loaded:
		load_all()

func _save_catalog_internal() -> Dictionary:
	var catalog_path := get_catalog_file_path()
	var catalog_directory := catalog_path.get_base_dir()
	AtomicFileWriter.ensure_directory(catalog_directory)

	var serialized_worlds: Dictionary = {}
	for world_key in _worlds_cache.keys():
		var summary: WorldArchiveSummaryDTO = _worlds_cache[world_key]
		if summary != null:
			serialized_worlds[world_key] = summary.to_dto()

	var envelope: Dictionary = {
		"format_version": DEFAULT_FORMAT_VERSION,
		"engine": "KalarWorldEngine_Godot4",
		"updated_timestamp_utc": int(Time.get_unix_time_from_system()),
		"world_count": _worlds_cache.size(),
		"worlds": serialized_worlds
	}

	var json_text := JSON.stringify(envelope, "\t")
	return _atomic_write_file(catalog_path, json_text)

# ==============================================================================
# 三、查询与摘要检索
# ==============================================================================

## 枚举所有已登记世界档案（按最后游玩时间倒序排列）
func list_worlds() -> Array[WorldArchiveSummaryDTO]:
	_ensure_catalog_loaded()
	var world_summaries: Array[WorldArchiveSummaryDTO] = []
	for world_key in _worlds_cache.keys():
		var summary: WorldArchiveSummaryDTO = _worlds_cache[world_key]
		if summary != null:
			world_summaries.append(summary)
	world_summaries.sort_custom(func(left_summary: WorldArchiveSummaryDTO, right_summary: WorldArchiveSummaryDTO) -> bool:
		return left_summary.last_played_timestamp_utc > right_summary.last_played_timestamp_utc
	)
	return world_summaries

## 获取指定世界档案摘要
func get_world_summary(world_id: String) -> WorldArchiveSummaryDTO:
	if world_id.is_empty():
		return null
	_ensure_catalog_loaded()
	return _worlds_cache.get(world_id, null)

## 检查指定世界是否存在
func has_world(world_id: String) -> bool:
	if world_id.is_empty():
		return false
	_ensure_catalog_loaded()
	return _worlds_cache.has(world_id)

# ==============================================================================
# 四、世界档案生命周期与持久化
# ==============================================================================

## 创建新世界：分配子目录，初始化元数据与世界实例，并原子同步索引表
func create_world(
	world_id: String,
	world_name: String,
	seed_value: int = 0,
	template_id: String = "WORLD_DEFAULT"
) -> Dictionary:
	if world_id.is_empty() or world_name.is_empty():
		return {"success": false, "error": "INVALID_ARGUMENT"}

	_ensure_catalog_loaded()

	var max_worlds: int = GameConfig.get_int(DOMAIN_WORLD_GATEWAY_CONFIG, "local_archive/max_worlds", 10)
	if _worlds_cache.size() >= max_worlds:
		return {"success": false, "error": "MAX_WORLDS_EXCEEDED"}

	if _worlds_cache.has(world_id):
		return {"success": false, "error": "WORLD_ALREADY_EXISTS"}

	var world_directory := get_world_dir(world_id)
	AtomicFileWriter.ensure_directory(world_directory)

	var current_timestamp := int(Time.get_unix_time_from_system())

	# 1. 创建初始 world_meta.json
	var metadata_payload := {
		"world_id": world_id,
		"world_name": world_name,
		"template_id": template_id,
		"seed_value": seed_value,
		"created_timestamp_utc": current_timestamp,
		"last_played_timestamp_utc": current_timestamp,
		"is_active": true
	}
	var metadata_write_outcome := _atomic_write_file(world_directory + "world_meta.json", JSON.stringify(metadata_payload, "\t"))
	if not bool(metadata_write_outcome.get("success", false)):
		return {"success": false, "error": "WORLD_META_WRITE_FAILED", "detail": metadata_write_outcome.get("error", "")}

	# 2. 创建初始 world_state.json (WorldInstance 实体序列化)
	var world_instance := WorldInstance.new(world_id)
	world_instance.world_time = {"tick": 0, "day": 1, "month": 1, "year": 1}
	world_instance.world_state = {"template_id": template_id, "seed_value": seed_value}
	var serialized_state := world_instance.serialize()
	var state_write_outcome := _atomic_write_file(world_directory + "world_state.json", JSON.stringify(serialized_state, "\t"))
	if not bool(state_write_outcome.get("success", false)):
		return {"success": false, "error": "WORLD_STATE_WRITE_FAILED", "detail": state_write_outcome.get("error", "")}

	# 3. 构建摘要条目登记至索引并原子更新 world_catalog.json
	var summary := WorldArchiveSummaryDTO.new(
		world_id,
		world_name,
		WorldGatewayModel.GameMode.SINGLE_PLAYER,
		seed_value,
		0,
		1,
		0,
		current_timestamp,
		current_timestamp,
		true
	)
	_worlds_cache[world_id] = summary
	var catalog_write_outcome := _save_catalog_internal()
	if not bool(catalog_write_outcome.get("success", false)):
		return {"success": false, "error": "CATALOG_WRITE_FAILED", "detail": catalog_write_outcome.get("error", "")}

	return {
		"success": true,
		"world_id": world_id,
		"summary": summary
	}

## 从对应子目录反序列化装配 WorldInstance 实体
func load_world(world_id: String) -> WorldInstance:
	if world_id.is_empty():
		return null

	_ensure_catalog_loaded()
	if not _worlds_cache.has(world_id):
		return null

	var world_directory := get_world_dir(world_id)
	var state_path := world_directory + "world_state.json"
	if not FileAccess.file_exists(state_path):
		var backup_path := state_path + DEFAULT_BACKUP_SUFFIX
		if not AtomicFileWriter.restore_from_backup(state_path, backup_path):
			return null

	var file := FileAccess.open(state_path, FileAccess.READ)
	if file == null:
		return null
	var content := file.get_as_text()
	file.close()

	var json := JSON.new()
	if json.parse(content) != OK:
		return null

	var parsed: Variant = json.get_data()
	if not parsed is Dictionary:
		return null

	return WorldInstance.deserialize(parsed as Dictionary)

## 原子写落盘更新目标世界的 world_state.json 与总索引表中的最后游玩时间
func save_world(world_instance: WorldInstance) -> Dictionary:
	if world_instance == null or world_instance.world_id.is_empty():
		return {"success": false, "error": "INVALID_INSTANCE"}

	_ensure_catalog_loaded()
	var resolved_world_id := world_instance.world_id
	var world_directory := get_world_dir(resolved_world_id)
	AtomicFileWriter.ensure_directory(world_directory)

	var serialized_state := world_instance.serialize()
	var state_write_outcome := _atomic_write_file(world_directory + "world_state.json", JSON.stringify(serialized_state, "\t"))
	if not bool(state_write_outcome.get("success", false)):
		return {"success": false, "error": "WORLD_STATE_WRITE_FAILED", "detail": state_write_outcome.get("error", "")}

	var current_timestamp := int(Time.get_unix_time_from_system())
	var summary: WorldArchiveSummaryDTO = _worlds_cache.get(resolved_world_id, null)
	if summary == null:
		summary = WorldArchiveSummaryDTO.new(
			resolved_world_id,
			resolved_world_id,
			WorldGatewayModel.GameMode.SINGLE_PLAYER,
			0,
			int(world_instance.world_time.get("tick", 0)),
			int(world_instance.world_time.get("day", 1)),
			0,
			current_timestamp,
			current_timestamp,
			true
		)
		_worlds_cache[resolved_world_id] = summary
	else:
		summary.last_played_timestamp_utc = current_timestamp
		summary.current_tick = int(world_instance.world_time.get("tick", 0))
		summary.current_day = int(world_instance.world_time.get("day", 1))

	var catalog_write_outcome := _save_catalog_internal()
	if not bool(catalog_write_outcome.get("success", false)):
		return {"success": false, "error": "CATALOG_WRITE_FAILED", "detail": catalog_write_outcome.get("error", "")}

	return {"success": true, "world_id": resolved_world_id}

## 安全物理删除指定世界档案子目录与目录索引
func delete_world(world_id: String) -> bool:
	if world_id.is_empty():
		return false

	_ensure_catalog_loaded()
	if not _worlds_cache.has(world_id):
		return false

	_worlds_cache.erase(world_id)

	var world_directory := get_world_dir(world_id)
	_remove_directory_recursive(world_directory)

	var catalog_write_outcome := _save_catalog_internal()
	return bool(catalog_write_outcome.get("success", false))

# ==============================================================================
# 五、底层原子写与目录操作
# ==============================================================================

func _atomic_write_file(file_path: String, content: String) -> Dictionary:
	var write_outcome: Dictionary = AtomicFileWriter.write_text_atomic(file_path, content)
	if bool(write_outcome.get("success", false)):
		return {"success": true, "error": ""}
	var stage: String = str(write_outcome.get("error_stage", ""))
	var error_code: int = int(write_outcome.get("error_code", ERR_FILE_CANT_WRITE))
	if stage == "tmp_open":
		return {"success": false, "error": TemplateFormatter.format("TMP_OPEN_FAILED: {error}", {"error": str(error_code)})}
	return {"success": false, "error": TemplateFormatter.format("RENAME_FAILED: {error}", {"error": error_code})}

func _remove_directory_recursive(directory_path: String) -> void:
	if not DirAccess.dir_exists_absolute(directory_path):
		return
	var directory_access := DirAccess.open(directory_path)
	if directory_access == null:
		return
	directory_access.list_dir_begin()
	var entry_name := directory_access.get_next()
	while not entry_name.is_empty():
		if not directory_access.current_is_dir():
			var file_path := directory_path + ("/" if not directory_path.ends_with("/") else "") + entry_name
			DirAccess.remove_absolute(file_path)
		entry_name = directory_access.get_next()
	directory_access.list_dir_end()
	DirAccess.remove_absolute(directory_path)
