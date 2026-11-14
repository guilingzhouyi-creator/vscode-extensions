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

## 获取单机世界 MOD 锁文件的物理全路径
func get_lock_file_path(world_id: String) -> String:
	if world_id.is_empty():
		return ""
	var archive_repository := WorldArchiveRepository.get_instance()
	if archive_repository != null:
		return archive_repository.get_world_dir(world_id) + LOCK_FILENAME
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

	var parsed_lock: Variant = JSON.parse_string(content)
	if not (parsed_lock is Dictionary):
		return {
			"exists": false,
			"error": "ERR_LOCK_FILE_CORRUPTED",
			"world_id": world_id,
			"locked_packs": []
		}

	var lock_payload := (parsed_lock as Dictionary).duplicate()
	lock_payload["exists"] = true
	lock_payload["world_id"] = world_id
	if not lock_payload.has("locked_packs"):
		lock_payload["locked_packs"] = []
	return lock_payload

## 提取包对象的基础字典（包含 pack_id/version/content_sha256/priority，避免循环体内瞬态堆分配）
func _serialize_pack_entry(pack_entry: Variant) -> Dictionary:
	if pack_entry is Dictionary:
		var source_map := pack_entry as Dictionary
		return {
			"pack_id": String(source_map.get("pack_id", source_map.get("id", ""))).strip_edges(),
			"version": String(source_map.get("version", "1.0.0")).strip_edges(),
			"content_sha256": String(source_map.get("content_sha256", "")).strip_edges(),
			"priority": int(source_map.get("priority", 100)),
			"pack_profile": String(source_map.get("pack_profile", "")).strip_edges(),
			"is_official": bool(source_map.get("is_official", false))
		}
	if pack_entry is String:
		return {
			"pack_id": String(pack_entry).strip_edges(),
			"version": "1.0.0",
			"content_sha256": "",
			"priority": 100
		}
	if pack_entry != null and pack_entry.has_method("to_dto"):
		var raw_dto: Variant = pack_entry.to_dto()
		if raw_dto is Dictionary:
			return _serialize_pack_entry(raw_dto)
	if pack_entry != null and "pack_id" in pack_entry:
		return {
			"pack_id": String(pack_entry.pack_id).strip_edges(),
			"version": String(pack_entry.version) if "version" in pack_entry else "1.0.0",
			"content_sha256": String(pack_entry.content_sha256) if "content_sha256" in pack_entry else "",
			"priority": int(pack_entry.priority) if "priority" in pack_entry else 100,
			"pack_profile": String(pack_entry.pack_profile) if "pack_profile" in pack_entry else "",
			"is_official": bool(pack_entry.is_official) if "is_official" in pack_entry else false
		}
	return {}

## 原子写落盘单机世界的 world_mod_lock.json
func save_world_mod_lock(world_id: String, active_packs: Array) -> Dictionary:
	if world_id.is_empty():
		return {"success": false, "error": "ERR_EMPTY_WORLD_ID"}

	var target_path := get_lock_file_path(world_id)

	var serialized_packs: Array[Dictionary] = []
	for pack_entry in active_packs:
		var entry := _serialize_pack_entry(pack_entry)
		if not entry.is_empty():
			serialized_packs.append(entry)

	var envelope: Dictionary = {
		"format_version": DEFAULT_FORMAT_VERSION,
		"world_id": world_id,
		"locked_timestamp_utc": int(Time.get_unix_time_from_system()),
		"locked_packs": serialized_packs
	}

	var json_text := JSON.stringify(envelope, "  ")
	var write_result: Dictionary = AtomicFileWriter.write_text_atomic(target_path, json_text)
	if not bool(write_result.get("success", false)):
		var stage: String = str(write_result.get("error_stage", ""))
		if stage == "tmp_open":
			return {"success": false, "error": "ERR_TMP_FILE_CREATE_FAILED"}
		return {"success": false, "error": "ERR_RENAME_FAILED", "code": int(write_result.get("error_code", ERR_FILE_CANT_WRITE))}

	return {
		"success": true,
		"world_id": world_id,
		"locked_count": serialized_packs.size()
	}

## 提取包标识（独立提取以避免循环体内瞬态堆分配）
func _extract_id_from_entry(pack_entry: Variant) -> String:
	if pack_entry is String:
		return String(pack_entry)
	if pack_entry is Dictionary:
		return String((pack_entry as Dictionary).get("pack_id", ""))
	if pack_entry != null and "pack_id" in pack_entry:
		return String(pack_entry.pack_id)
	return ""

## 构建当前已安装 MOD 包索引（pack_id -> serialized metadata）
func _build_installed_pack_index(installed_packs: Array) -> Dictionary:
	var installed_index: Dictionary = {}
	for installed_pack in installed_packs:
		var serialized := _serialize_pack_entry(installed_pack)
		var installed_pack_id := String(serialized.get("pack_id", "")).strip_edges()
		if not installed_pack_id.is_empty():
			installed_index[installed_pack_id] = serialized
	return installed_index


## 仅只读诊断世界锁与已安装包之间的一致性、缺失与摘要/版本漂移
func diagnose_world_mods(world_id: String, installed_packs: Array) -> Dictionary:
	var lock_payload := load_world_mod_lock(world_id)
	var has_lock_file: bool = bool(lock_payload.get("exists", false))
	var installed_index := _build_installed_pack_index(installed_packs)
	var locked_list: Array = lock_payload.get("locked_packs", [])
	var missing_packs: Array[String] = []
	var version_drifts: Array[Dictionary] = []
	var digest_drifts: Array[Dictionary] = []
	var locked_ids: Array[String] = []

	for locked_pack in locked_list:
		_collect_lock_entry_drift(locked_pack, installed_index, locked_ids, missing_packs, version_drifts, digest_drifts)

	return {
		"world_id": world_id,
		"has_lock_file": has_lock_file,
		"locked_pack_ids": locked_ids,
		"locked_packs": locked_list.duplicate(true),
		"missing_packs": missing_packs,
		"version_drifts": version_drifts,
		"digest_drifts": digest_drifts,
		"is_clean": missing_packs.is_empty() and digest_drifts.is_empty() and version_drifts.is_empty()
	}


func _collect_lock_entry_drift(
	locked_pack: Variant,
	installed_index: Dictionary,
	locked_ids: Array[String],
	missing_packs: Array[String],
	version_drifts: Array[Dictionary],
	digest_drifts: Array[Dictionary]
) -> void:
	var locked_id := _extract_id_from_entry(locked_pack).strip_edges()
	if locked_id.is_empty():
		return
	locked_ids.append(locked_id)
	if not installed_index.has(locked_id):
		missing_packs.append(locked_id)
		return
	if not (locked_pack is Dictionary):
		return
	var locked_map := locked_pack as Dictionary
	var installed_map := installed_index[locked_id] as Dictionary
	var locked_version := String(locked_map.get("version", "")).strip_edges()
	var installed_version := String(installed_map.get("version", "")).strip_edges()
	if not locked_version.is_empty() and not installed_version.is_empty() and locked_version != installed_version:
		version_drifts.append({"pack_id": locked_id, "locked": locked_version, "installed": installed_version})
	var locked_sha := String(locked_map.get("content_sha256", "")).strip_edges()
	var installed_sha := String(installed_map.get("content_sha256", "")).strip_edges()
	if not locked_sha.is_empty() and not installed_sha.is_empty() and locked_sha != installed_sha:
		digest_drifts.append({"pack_id": locked_id, "locked": locked_sha, "installed": installed_sha})


## 对比当前世界锁定的 MOD 列表与当前安装的 MOD 并执行绑定裁定
func verify_and_bind_world_mods(world_id: String, installed_packs: Array, should_allow_safe_degrade: bool = false) -> Dictionary:
	if world_id.is_empty():
		return {"success": false, "error": "ERR_EMPTY_WORLD_ID"}

	var lock_payload := load_world_mod_lock(world_id)
	var has_lock_file: bool = bool(lock_payload.get("exists", false))

	# 1. 若初次进入且无锁文件，自动以当前 active_packs 固化创建锁文件
	if not has_lock_file:
		var save_result := save_world_mod_lock(world_id, installed_packs)
		if not bool(save_result.get("success", false)):
			return {"success": false, "error": "ERR_LOCK_INITIALIZE_FAILED"}
		return {
			"success": true,
			"status": "INITIALIZED",
			"world_id": world_id,
			"locked_count": installed_packs.size()
		}

	var diagnostic := diagnose_world_mods(world_id, installed_packs)
	var missing_packs: Array[String] = diagnostic["missing_packs"]
	var digest_drifts: Array[Dictionary] = diagnostic["digest_drifts"]
	var version_drifts: Array[Dictionary] = diagnostic["version_drifts"]

	# 3. 校验通过：无缺失且无不可逆摘要漂移
	if missing_packs.is_empty() and digest_drifts.is_empty():
		return {
			"success": true,
			"status": "VERIFIED",
			"world_id": world_id,
			"version_drifts": version_drifts
		}

	# 4. 缺少关键 MOD 或摘要冲突且不允许安全降级：拦截防坏档
	if not should_allow_safe_degrade:
		var failure_code := "ERR_MISSING_CRITICAL_MOD" if not missing_packs.is_empty() else "MOD_ERR_REALM_DIGEST_MISMATCH"
		return {
			"success": false,
			"error": failure_code,
			"missing_packs": missing_packs,
			"digest_drifts": digest_drifts,
			"version_drifts": version_drifts
		}

	# 5. 缺少 MOD 但允许降级：向 WorldInstance 追加 MOD_DETACHED 历史片段并回退安全存根
	_append_detached_fragment_to_world(world_id, missing_packs)

	return {
		"success": true,
		"status": "DEGRADED",
		"missing_packs": missing_packs,
		"digest_drifts": digest_drifts,
		"world_id": world_id
	}

## 记录脱落片段至目标单机世界（独立函数以降低圈复杂度与保持单一职责）
func _append_detached_fragment_to_world(world_id: String, missing_packs: Array[String]) -> void:
	var archive_repository := WorldArchiveRepository.get_instance()
	if archive_repository == null:
		return
	var world_instance: WorldInstance = archive_repository.load_world(world_id)
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
	archive_repository.save_world(world_instance)
