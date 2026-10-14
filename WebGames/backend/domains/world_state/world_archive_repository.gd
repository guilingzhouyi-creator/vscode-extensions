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
var _custom_root_dir: String = ""

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
		_instance._custom_root_dir = ""
		_instance._custom_catalog_path = ""
		_instance._loaded = false
	_instance = null

## 检查是否已完成目录装载
func is_loaded() -> bool:
	return _loaded

## 设置自定义物理根目录（支持测试沙箱物理隔离）
func set_custom_root_dir(path: String) -> void:
	_custom_root_dir = path

## 设置自定义目录索引文件路径（支持测试沙箱物理隔离）
func set_custom_catalog_path(path: String) -> void:
	_custom_catalog_path = path

## 获取物理根目录路径
func get_root_dir() -> String:
	if not _custom_root_dir.is_empty():
		return _custom_root_dir if _custom_root_dir.ends_with("/") else _custom_root_dir + "/"
	var dir: String = GameConfig.get_string(DOMAIN_WORLD_GATEWAY_CONFIG, "local_archive/root_dir", DEFAULT_SP_ROOT_DIR)
	return dir if dir.ends_with("/") else dir + "/"

## 获取目录索引文件物理路径
func get_catalog_file_path() -> String:
	if not _custom_catalog_path.is_empty():
		return _custom_catalog_path
	var root := get_root_dir()
	var filename: String = GameConfig.get_string(DOMAIN_WORLD_GATEWAY_CONFIG, "local_archive/catalog_file", DEFAULT_CATALOG_FILE)
	return root + filename

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

	var cat_path := get_catalog_file_path()
	var root_dir := cat_path.get_base_dir()
	_ensure_directory(root_dir)

	if not FileAccess.file_exists(cat_path):
		return {"success": true, "count": 0, "error": ""}

	var file := FileAccess.open(cat_path, FileAccess.READ)
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

	var root_dict: Dictionary = parsed
	var raw_worlds: Dictionary = root_dict.get("worlds", {})
	for wid in raw_worlds.keys():
		var raw_item: Variant = raw_worlds[wid]
		if raw_item is Dictionary:
			var dto := WorldArchiveSummaryDTO.from_dto(raw_item as Dictionary)
			if dto != null and not dto.world_id.is_empty():
				_worlds_cache[dto.world_id] = dto

	return {"success": true, "count": _worlds_cache.size(), "error": ""}

func _ensure_catalog_loaded() -> void:
	if not _loaded:
		load_all()

func _save_catalog_internal() -> Dictionary:
	var cat_path := get_catalog_file_path()
	var root_dir := cat_path.get_base_dir()
	_ensure_directory(root_dir)

	var worlds_dict: Dictionary = {}
	for wid in _worlds_cache.keys():
		var summary: WorldArchiveSummaryDTO = _worlds_cache[wid]
		if summary != null:
			worlds_dict[wid] = summary.to_dto()

	var envelope: Dictionary = {
		"format_version": DEFAULT_FORMAT_VERSION,
		"engine": "KalarWorldEngine_Godot4",
		"updated_timestamp_utc": int(Time.get_unix_time_from_system()),
		"world_count": _worlds_cache.size(),
		"worlds": worlds_dict
	}

	var json_str := JSON.stringify(envelope, "\t")
	return _atomic_write_file(cat_path, json_str)

# ==============================================================================
# 三、查询与摘要检索
# ==============================================================================

## 枚举所有已登记世界档案（按最后游玩时间倒序排列）
func list_worlds() -> Array[WorldArchiveSummaryDTO]:
	_ensure_catalog_loaded()
	var list: Array[WorldArchiveSummaryDTO] = []
	for wid in _worlds_cache.keys():
		var s: WorldArchiveSummaryDTO = _worlds_cache[wid]
		if s != null:
			list.append(s)
	list.sort_custom(func(a: WorldArchiveSummaryDTO, b: WorldArchiveSummaryDTO) -> bool:
		return a.last_played_timestamp_utc > b.last_played_timestamp_utc
	)
	return list

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
	seed_val: int = 0,
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

	var world_dir := get_world_dir(world_id)
	_ensure_directory(world_dir)

	var now := int(Time.get_unix_time_from_system())

	# 1. 创建初始 world_meta.json
	var meta_dict := {
		"world_id": world_id,
		"world_name": world_name,
		"template_id": template_id,
		"seed_value": seed_val,
		"created_timestamp_utc": now,
		"last_played_timestamp_utc": now,
		"is_active": true
	}
	var meta_res := _atomic_write_file(world_dir + "world_meta.json", JSON.stringify(meta_dict, "\t"))
	if not bool(meta_res.get("success", false)):
		return {"success": false, "error": "WORLD_META_WRITE_FAILED", "detail": meta_res.get("error", "")}

	# 2. 创建初始 world_state.json (WorldInstance 实体序列化)
	var inst := WorldInstance.new(world_id)
	inst.world_time = {"tick": 0, "day": 1, "month": 1, "year": 1}
	inst.world_state = {"template_id": template_id, "seed_value": seed_val}
	var state_dict := inst.serialize()
	var state_res := _atomic_write_file(world_dir + "world_state.json", JSON.stringify(state_dict, "\t"))
	if not bool(state_res.get("success", false)):
		return {"success": false, "error": "WORLD_STATE_WRITE_FAILED", "detail": state_res.get("error", "")}

	# 3. 构建摘要条目登记至索引并原子更新 world_catalog.json
	var summary := WorldArchiveSummaryDTO.new(
		world_id,
		world_name,
		WorldGatewayModel.GameMode.SINGLE_PLAYER,
		seed_val,
		0,
		1,
		0,
		now,
		now,
		true
	)
	_worlds_cache[world_id] = summary
	var cat_res := _save_catalog_internal()
	if not bool(cat_res.get("success", false)):
		return {"success": false, "error": "CATALOG_WRITE_FAILED", "detail": cat_res.get("error", "")}

	return {
		"success": true,
		"world_id": world_id,
		"summary": summary
	}

## 从对应子目录反序列化水化 WorldInstance 实体
func load_world(world_id: String) -> WorldInstance:
	if world_id.is_empty():
		return null

	_ensure_catalog_loaded()
	if not _worlds_cache.has(world_id):
		return null

	var world_dir := get_world_dir(world_id)
	var state_path := world_dir + "world_state.json"
	if not FileAccess.file_exists(state_path):
		var bak_path := state_path + DEFAULT_BACKUP_SUFFIX
		if FileAccess.file_exists(bak_path):
			DirAccess.copy_absolute(bak_path, state_path)
		else:
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
func save_world(instance: WorldInstance) -> Dictionary:
	if instance == null or instance.world_id.is_empty():
		return {"success": false, "error": "INVALID_INSTANCE"}

	_ensure_catalog_loaded()
	var wid := instance.world_id
	var world_dir := get_world_dir(wid)
	_ensure_directory(world_dir)

	var state_dict := instance.serialize()
	var state_res := _atomic_write_file(world_dir + "world_state.json", JSON.stringify(state_dict, "\t"))
	if not bool(state_res.get("success", false)):
		return {"success": false, "error": "WORLD_STATE_WRITE_FAILED", "detail": state_res.get("error", "")}

	var now := int(Time.get_unix_time_from_system())
	var summary: WorldArchiveSummaryDTO = _worlds_cache.get(wid, null)
	if summary == null:
		summary = WorldArchiveSummaryDTO.new(
			wid,
			wid,
			WorldGatewayModel.GameMode.SINGLE_PLAYER,
			0,
			int(instance.world_time.get("tick", 0)),
			int(instance.world_time.get("day", 1)),
			0,
			now,
			now,
			true
		)
		_worlds_cache[wid] = summary
	else:
		summary.last_played_timestamp_utc = now
		summary.current_tick = int(instance.world_time.get("tick", 0))
		summary.current_day = int(instance.world_time.get("day", 1))

	var cat_res := _save_catalog_internal()
	if not bool(cat_res.get("success", false)):
		return {"success": false, "error": "CATALOG_WRITE_FAILED", "detail": cat_res.get("error", "")}

	return {"success": true, "world_id": wid}

## 安全物理删除指定世界档案子目录与目录索引
func delete_world(world_id: String) -> bool:
	if world_id.is_empty():
		return false

	_ensure_catalog_loaded()
	if not _worlds_cache.has(world_id):
		return false

	_worlds_cache.erase(world_id)

	var world_dir := get_world_dir(world_id)
	_remove_directory_recursive(world_dir)

	var cat_res := _save_catalog_internal()
	return bool(cat_res.get("success", false))

# ==============================================================================
# 五、底层原子写与目录操作
# ==============================================================================

func _atomic_write_file(file_path: String, content: String) -> Dictionary:
	var tmp_path := file_path + DEFAULT_TMP_SUFFIX
	var tmp_file := FileAccess.open(tmp_path, FileAccess.WRITE)
	if tmp_file == null:
		return {"success": false, "error": "TMP_OPEN_FAILED: %s" % str(FileAccess.get_open_error())}

	tmp_file.store_string(content)
	tmp_file.flush()
	tmp_file.close()

	if FileAccess.file_exists(file_path):
		var bak_path := file_path + DEFAULT_BACKUP_SUFFIX
		DirAccess.copy_absolute(file_path, bak_path)

	var rename_err := DirAccess.rename_absolute(tmp_path, file_path)
	if rename_err != OK:
		DirAccess.remove_absolute(tmp_path)
		return {"success": false, "error": "RENAME_FAILED: %d" % rename_err}

	return {"success": true, "error": ""}

func _ensure_directory(path: String) -> void:
	if not DirAccess.dir_exists_absolute(path):
		DirAccess.make_dir_recursive_absolute(path)

func _remove_directory_recursive(dir_path: String) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		return
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var fname := dir.get_next()
	while not fname.is_empty():
		if not dir.current_is_dir():
			var file_path := dir_path + ("/" if not dir_path.ends_with("/") else "") + fname
			DirAccess.remove_absolute(file_path)
		fname = dir.get_next()
	dir.list_dir_end()
	DirAccess.remove_absolute(dir_path)
