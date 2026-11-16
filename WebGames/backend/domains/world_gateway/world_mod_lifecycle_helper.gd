# ==============================================================================
# 模块归属: 业务领域层 (Domains · 世界网关集群 (World Gateway Domain))
# 文件路径: res://backend/domains/world_gateway/world_mod_lifecycle_helper.gd
# 架构定位: Domain Support Helper / MOD Deletion & Manifest Lifecycle Mutations
# 依赖与触发: 上游: WorldGatewayProtocolHandler | 下游: WorldModPackageOpsHelper, CausalityDagValidator, ModPrecheckAndAdaptationSolver, ModPackageDiscoverySolver
# 职责说明: 为游戏内 MOD 工坊与统一协议提供受保护的 MOD 包安全卸载删除、pack.json 清单元数据更新与 DAG 图元落盘能力。
# 退出语义与设计依据: 路径穿越防御、核心包保护、SHA-256 清单重算与拓扑闭环验证契约
# ==============================================================================

## WorldModLifecycleHelper：游戏内 MOD 删除卸载与清单元数据编辑助手
class_name WorldModLifecycleHelper
extends RefCounted


## 安全卸载或删除用户自建或本地非内置 MOD 包（目录或 .kmod 归档，保护官方核心基座包与非模组目录）
static func delete_mod_pack(request_payload: Dictionary) -> Dictionary:
	var pack_id := str(request_payload.get("pack_id", "")).strip_edges()
	if not WorldModPackageOpsHelper.is_safe_pack_identifier(pack_id):
		return {"success": false, "error_code": "ERR_INVALID_PACK_ID", "message": "Invalid pack_id"}
	if _is_protected_official_payload(request_payload):
		return {"success": false, "error_code": "ERR_PROTECTED_BASE_MOD", "message": "Official core pack cannot be deleted"}

	var target_root := WorldModPackageOpsHelper.resolve_target_root(request_payload)
	if target_root.is_empty() or target_root.contains(".."):
		return {"success": false, "error_code": "ERR_MOD_INVALID_TARGET_ROOT", "message": "Target root contains unsafe path segments"}

	var resolved_root := _globalize_if_virtual(target_root)
	var pack_directory := resolved_root.path_join(pack_id)
	var kmod_path := resolved_root.path_join("%s.kmod" % pack_id)
	var raw_root_path := str(request_payload.get("root_path", "")).strip_edges()
	if not raw_root_path.is_empty() and not raw_root_path.contains(".."):
		var candidate_directory := _globalize_if_virtual(raw_root_path.rstrip("/\\"))
		if candidate_directory.get_file() == pack_id:
			pack_directory = candidate_directory

	var disk_manifest := WorldModPackageOpsHelper.read_json_file(pack_directory.path_join("pack.json"))
	if not disk_manifest.is_empty() and _is_protected_official_payload(disk_manifest):
		return {"success": false, "error_code": "ERR_PROTECTED_BASE_MOD", "message": "Official core pack cannot be deleted"}

	var removed_paths: Array[String] = []
	var folder_outcome := _remove_mod_folder_if_present(pack_directory, removed_paths)
	if not bool(folder_outcome.get("success", true)):
		return folder_outcome

	if FileAccess.file_exists(kmod_path):
		if DirAccess.remove_absolute(kmod_path) == OK:
			removed_paths.append(kmod_path)
		else:
			return {"success": false, "error_code": "ERR_MOD_DELETE_FAILED", "message": "Failed removing .kmod archive"}

	if removed_paths.is_empty():
		return {"success": false, "error_code": "ERR_MOD_NOT_FOUND", "message": "Specified MOD package or archive not found"}

	return {
		"success": true,
		"pack_id": pack_id,
		"removed_paths": removed_paths,
		"delete_kind": "directory_and_archive" if removed_paths.size() > 1 else ("kmod" if removed_paths[0].ends_with(".kmod") else "directory"),
	}


## 更新本地 MOD 的 pack.json 清单元数据及可选 DAG 图表，并重算内容 SHA-256 与执行静态合规预检
static func update_mod_manifest(request_payload: Dictionary) -> Dictionary:
	var pack_id := str(request_payload.get("pack_id", "")).strip_edges()
	if not WorldModPackageOpsHelper.is_safe_pack_identifier(pack_id):
		return {"success": false, "error_code": "ERR_INVALID_PACK_ID", "message": "Invalid pack_id"}

	var pack_directory := _resolve_pack_directory_for_edit(request_payload, pack_id)
	if pack_directory.is_empty():
		return {"success": false, "error_code": "ERR_MOD_NOT_FOUND", "message": "Target MOD directory not found"}

	var manifest_path := pack_directory.path_join("pack.json")
	var manifest_payload := WorldModPackageOpsHelper.read_json_file(manifest_path)
	if manifest_payload.is_empty():
		return {"success": false, "error_code": "ERR_INVALID_MOD_MANIFEST", "message": "Existing pack.json not found or invalid"}

	_apply_editable_manifest_fields(manifest_payload, request_payload)

	var dag_outcome := _maybe_write_updated_dag_graph(pack_directory, manifest_payload, request_payload)
	if not bool(dag_outcome.get("success", true)):
		return dag_outcome

	manifest_payload["content_sha256"] = ModPackageDiscoverySolver.compute_package_content_sha256(pack_directory)
	if not WorldModPackageOpsHelper.write_json_file(manifest_path, manifest_payload):
		return {"success": false, "error_code": "ERR_MOD_MANIFEST_WRITE_FAILED", "message": "Failed writing updated pack.json"}

	var precheck_outcome := ModPrecheckAndAdaptationSolver.precheck_single_mod(manifest_payload)
	return {
		"success": true,
		"pack_id": pack_id,
		"root_path": pack_directory,
		"manifest": manifest_payload,
		"precheck_valid": bool(precheck_outcome.get("valid", false)),
		"precheck_errors": precheck_outcome.get("errors", []),
	}


static func _is_protected_official_payload(payload_map: Dictionary) -> bool:
	return bool(payload_map.get("is_official", false)) or str(payload_map.get("pack_profile", "")) == "OFFICIAL_BASE"


static func _remove_mod_folder_if_present(pack_directory: String, removed_paths: Array[String]) -> Dictionary:
	if not DirAccess.dir_exists_absolute(pack_directory):
		return {"success": true}
	var has_manifest := FileAccess.file_exists(pack_directory.path_join("pack.json")) or FileAccess.file_exists(pack_directory.path_join("manifest.json"))
	if not has_manifest:
		return {"success": false, "error_code": "ERR_INVALID_MOD_DIRECTORY", "message": "Refusing to delete directory lacking pack.json"}
	if _remove_directory_recursive(pack_directory):
		removed_paths.append(pack_directory)
		return {"success": true}
	return {"success": false, "error_code": "ERR_MOD_DELETE_FAILED", "message": "Failed deleting MOD directory"}


static func _globalize_if_virtual(candidate_path: String) -> String:
	if candidate_path.begins_with("res://") or candidate_path.begins_with("user://"):
		return ProjectSettings.globalize_path(candidate_path)
	return candidate_path


static func _resolve_pack_directory_for_edit(request_payload: Dictionary, pack_id: String) -> String:
	var raw_root_path := str(request_payload.get("root_path", "")).strip_edges()
	if not raw_root_path.is_empty() and not raw_root_path.contains(".."):
		var explicit_path := _globalize_if_virtual(raw_root_path.rstrip("/\\"))
		if DirAccess.dir_exists_absolute(explicit_path):
			return explicit_path
	var target_root := WorldModPackageOpsHelper.resolve_target_root(request_payload)
	if target_root.is_empty() or target_root.contains(".."):
		return ""
	var pack_directory := _globalize_if_virtual(target_root).path_join(pack_id)
	return pack_directory if DirAccess.dir_exists_absolute(pack_directory) else ""


static func _apply_editable_manifest_fields(manifest_payload: Dictionary, request_payload: Dictionary) -> void:
	var updates: Dictionary = request_payload.get("manifest_updates", request_payload) if request_payload.get("manifest_updates") is Dictionary else request_payload
	for string_key in ["display_name", "pack_name", "version", "author", "description"]:
		if not updates.has(string_key):
			continue
		var text_value := str(updates.get(string_key, "")).strip_edges()
		if not text_value.is_empty():
			manifest_payload[string_key] = text_value
	if updates.has("display_name") and not updates.has("pack_name"):
		manifest_payload["pack_name"] = manifest_payload.get("display_name", manifest_payload.get("pack_id", ""))
	if updates.has("priority"):
		manifest_payload["priority"] = int(updates.get("priority", manifest_payload.get("priority", 100)))
	if updates.has("is_active"):
		manifest_payload["is_active"] = bool(updates.get("is_active", true))
	if updates.has("has_prologue_dag"):
		manifest_payload["has_prologue_dag"] = bool(updates.get("has_prologue_dag", false))
	if updates.has("pack_profile"):
		var normalized_profile := str(updates.get("pack_profile", "CONTENT_ADDON")).strip_edges().to_upper()
		if normalized_profile in ["CONTENT_ADDON", "TOTAL_CONVERSION", "SYSTEM_EXTENSION", "OFFICIAL_BASE"]:
			manifest_payload["pack_profile"] = normalized_profile
	if updates.has("dependencies") and updates.get("dependencies") is Array:
		manifest_payload["dependencies"] = (updates.get("dependencies") as Array).duplicate()
	if updates.has("incompatible_packs") and updates.get("incompatible_packs") is Array:
		manifest_payload["incompatible_packs"] = (updates.get("incompatible_packs") as Array).duplicate()


static func _maybe_write_updated_dag_graph(pack_directory: String, manifest_payload: Dictionary, request_payload: Dictionary) -> Dictionary:
	if not request_payload.has("dag_graph") or not (request_payload.get("dag_graph") is Dictionary):
		return {"success": true}
	var raw_dag: Dictionary = request_payload.get("dag_graph") as Dictionary
	var graph_dto := NarrativeDAGGraphDTO.from_dto(raw_dag)
	var validation := CausalityDagValidator.validate_graph(graph_dto)
	if not bool(validation.get("is_valid", false)):
		return {
			"success": false,
			"error_code": str(validation.get("error_code", "MOD_ERR_INVALID_DAG")),
			"message": str(validation.get("message", "DAG topology validation failed")),
		}
	var dag_id := graph_dto.dag_id if not graph_dto.dag_id.is_empty() else "DAG_MAIN"
	var dag_directory := pack_directory.path_join("dag_graphs")
	WorldModPackageOpsHelper.ensure_directory_recursive(dag_directory)
	var dag_file := dag_directory.path_join("%s.json" % dag_id)
	if not WorldModPackageOpsHelper.write_json_file(dag_file, graph_dto.to_dto()):
		return {"success": false, "error_code": "ERR_MOD_DAG_WRITE_FAILED", "message": "Failed writing DAG graph JSON"}
	manifest_payload["has_prologue_dag"] = true
	return {"success": true}


static func _remove_directory_entry(directory_handle: DirAccess, directory_path: String, entry_name: String) -> bool:
	if entry_name == "." or entry_name == "..":
		return true
	if directory_handle.current_is_dir():
		return _remove_directory_recursive(directory_path.path_join(entry_name))
	return directory_handle.remove(entry_name) == OK


static func _remove_directory_recursive(directory_path: String) -> bool:
	var directory_handle := DirAccess.open(directory_path)
	if directory_handle == null:
		return false
	directory_handle.list_dir_begin()
	var entry_name := directory_handle.get_next()
	var all_removed := true
	while entry_name != "":
		if not _remove_directory_entry(directory_handle, directory_path, entry_name):
			all_removed = false
			break
		entry_name = directory_handle.get_next()
	directory_handle.list_dir_end()
	if not all_removed:
		return false
	return DirAccess.remove_absolute(directory_path) == OK
