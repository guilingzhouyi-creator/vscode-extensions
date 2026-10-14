# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/world_mod_affinity_manager.gd
# 架构定位: Domain Service / World Mod Binding Manager
# 依赖与触发: 上游: WorldGatewayFSM | 下游: WorldArchiveRepository, WorldInstance | 配置: config/domains/narrative_orchestration/core.json | 信号: EventBus 领域广播
# 职责说明: 管理单机世界专属的 MOD 锁文件，执行初次绑定固化、一致性校验与安全降级防坏档守卫
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldModAffinityManager：Domain Service / World Mod Binding Manager
class_name WorldModAffinityManager
extends RefCounted

const LOCK_FILENAME: String = "world_mod_lock.json"
const DEFAULT_FORMAT_VERSION: String = "1.0.0"
const DEFAULT_TMP_SUFFIX: String = ".tmp"
const DEFAULT_BACKUP_SUFFIX: String = ".bak"

## 获取单机世界 MOD 锁文件的物理全路径
func get_lock_file_path(world_id: String) -> String:
	if world_id.is_empty():
		return ""
	var repo := WorldArchiveRepository.get_instance()
	if repo != null:
		return repo.get_world_dir(world_id) + LOCK_FILENAME
	return "user://worlds/sp/%s/%s" % [world_id, LOCK_FILENAME]

## 读取指定单机世界的锁文件数据
func load_world_mod_lock(world_id: String) -> Dictionary:
	var path := get_lock_file_path(world_id)
	if path.is_empty() or not FileAccess.file_exists(path):
		return {
			"exists": false,
			"world_id": world_id,
			"locked_packs": []
		}

	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {
			"exists": false,
			"error": "ERR_LOCK_FILE_OPEN_FAILED",
			"world_id": world_id,
			"locked_packs": []
		}

	var content := file.get_as_text()
	file.close()

	var parsed_val: Variant = JSON.parse_string(content)
	if not (parsed_val is Dictionary):
		return {
			"exists": false,
			"error": "ERR_LOCK_FILE_CORRUPTED",
			"world_id": world_id,
			"locked_packs": []
		}

	var result := (parsed_val as Dictionary).duplicate()
	result["exists"] = true
	result["world_id"] = world_id
	if not result.has("locked_packs"):
		result["locked_packs"] = []
	return result

## 提取包对象的基础字典（独立提取以避免循环体内瞬态堆分配）
func _serialize_pack_entry(item: Variant) -> Dictionary:
	if item is Dictionary:
		return (item as Dictionary).duplicate()
	if item is String:
		return {
			"pack_id": String(item),
			"version": "1.0.0",
			"priority": 100
		}
	if item != null and item.has_method("to_dto"):
		return item.to_dto()
	if item != null and "pack_id" in item:
		var pid: String = String(item.pack_id)
		var ver: String = String(item.version) if "version" in item else "1.0.0"
		var prio: int = int(item.priority) if "priority" in item else 100
		return {
			"pack_id": pid,
			"version": ver,
			"priority": prio
		}
	return {}

## 原子写落盘单机世界的 world_mod_lock.json
func save_world_mod_lock(world_id: String, active_packs: Array) -> Dictionary:
	if world_id.is_empty():
		return {"success": false, "error": "ERR_EMPTY_WORLD_ID"}

	var target_path := get_lock_file_path(world_id)
	var dir_path := target_path.get_base_dir()
	if not dir_path.is_empty() and not DirAccess.dir_exists_absolute(dir_path):
		DirAccess.make_dir_recursive_absolute(dir_path)

	var serialized_packs: Array[Dictionary] = []
	for p in active_packs:
		var entry := _serialize_pack_entry(p)
		if not entry.is_empty():
			serialized_packs.append(entry)

	var envelope: Dictionary = {
		"format_version": DEFAULT_FORMAT_VERSION,
		"world_id": world_id,
		"locked_timestamp_utc": int(Time.get_unix_time_from_system()),
		"locked_packs": serialized_packs
	}

	var json_str := JSON.stringify(envelope, "  ")
	var tmp_path := target_path + DEFAULT_TMP_SUFFIX
	var bak_path := target_path + DEFAULT_BACKUP_SUFFIX

	var file := FileAccess.open(tmp_path, FileAccess.WRITE)
	if file == null:
		return {"success": false, "error": "ERR_TMP_FILE_CREATE_FAILED"}
	file.store_string(json_str)
	file.flush()
	file.close()

	if FileAccess.file_exists(target_path):
		if FileAccess.file_exists(bak_path):
			DirAccess.remove_absolute(bak_path)
		DirAccess.copy_absolute(target_path, bak_path)
		DirAccess.remove_absolute(target_path)

	var rename_err := DirAccess.rename_absolute(tmp_path, target_path)
	if rename_err != OK:
		return {"success": false, "error": "ERR_RENAME_FAILED", "code": rename_err}

	return {
		"success": true,
		"world_id": world_id,
		"locked_count": serialized_packs.size()
	}

## 提取包标识（独立提取以避免循环体内瞬态堆分配）
func _extract_id_from_entry(item: Variant) -> String:
	if item is String:
		return String(item)
	if item is Dictionary:
		return String((item as Dictionary).get("pack_id", ""))
	if item != null and "pack_id" in item:
		return String(item.pack_id)
	return ""

## 对比当前世界锁定的 MOD 列表与当前安装的 MOD 并执行绑定裁定
func verify_and_bind_world_mods(world_id: String, installed_packs: Array, allow_safe_degrade: bool = false) -> Dictionary:
	if world_id.is_empty():
		return {"success": false, "error": "ERR_EMPTY_WORLD_ID"}

	var lock_data := load_world_mod_lock(world_id)
	var lock_exists: bool = bool(lock_data.get("exists", false))

	# 1. 若初次进入且无锁文件，自动以当前 active_packs 固化创建锁文件
	if not lock_exists:
		var save_res := save_world_mod_lock(world_id, installed_packs)
		if not bool(save_res.get("success", false)):
			return {"success": false, "error": "ERR_LOCK_INITIALIZE_FAILED"}
		return {
			"success": true,
			"status": "INITIALIZED",
			"world_id": world_id,
			"locked_count": installed_packs.size()
		}

	# 2. 已有锁文件，收集已安装与已锁定标识集合
	var installed_set: Dictionary = {}
	for inst_p in installed_packs:
		var inst_id := _extract_id_from_entry(inst_p)
		if not inst_id.is_empty():
			installed_set[inst_id] = true

	var locked_list: Array = lock_data.get("locked_packs", [])
	var missing_packs: Array[String] = []
	for lock_p in locked_list:
		var lock_id := _extract_id_from_entry(lock_p)
		if not lock_id.is_empty() and not installed_set.has(lock_id):
			missing_packs.append(lock_id)

	# 3. 校验通过：无缺失 MOD
	if missing_packs.is_empty():
		return {
			"success": true,
			"status": "VERIFIED",
			"world_id": world_id
		}

	# 4. 缺少关键 MOD 且不允许安全降级：拦截防坏档
	if not allow_safe_degrade:
		return {
			"success": false,
			"error": "ERR_MISSING_CRITICAL_MOD",
			"missing_packs": missing_packs
		}

	# 5. 缺少 MOD 但允许降级：向 WorldInstance 追加 MOD_DETACHED 历史片段并回退安全存根
	_append_detached_fragment_to_world(world_id, missing_packs)

	return {
		"success": true,
		"status": "DEGRADED",
		"missing_packs": missing_packs,
		"world_id": world_id
	}

## 记录脱落片段至目标单机世界（独立函数以降低圈复杂度与保持单一职责）
func _append_detached_fragment_to_world(world_id: String, missing_packs: Array[String]) -> void:
	var repo := WorldArchiveRepository.get_instance()
	if repo == null:
		return
	var world_instance: WorldInstance = repo.load_world(world_id)
	if world_instance == null:
		return

	var missing_copy: Array[String] = []
	missing_copy.assign(missing_packs.duplicate())

	var fragment: Dictionary = {
		"event": "MOD_DETACHED",
		"type": "MOD_DETACHED",
		"timestamp_utc": int(Time.get_unix_time_from_system()),
		"missing_packs": missing_copy,
		"reason": "SAFE_DEGRADE"
	}
	world_instance.append_history_fragment(fragment)
	repo.save_world(world_instance)
