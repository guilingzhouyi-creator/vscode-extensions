# ==============================================================================
# 模块归属: 业务领域层 (Domains · 世界网关集群 (World Gateway Domain))
# 文件路径: res://backend/domains/world_gateway/world_mod_package_ops_helper.gd
# 架构定位: Domain Support Helper / In-Game MOD Skeleton Creation & Path Primitives
# 依赖与触发: 上游: WorldGatewayProtocolHandler, WorldModArchiveOpsHelper | 下游: ModPrecheckAndAdaptationSolver, ModPackageDiscoverySolver
# 职责说明: 为游戏内 MOD 工坊与统一协议提供安全的包标识校验、目录/JSON 原语及合规 MOD 骨架目录创建能力。
# 退出语义与设计依据: 路径穿越防御、SHA-256 清单验签与本地校验规范
# ==============================================================================

## WorldModPackageOpsHelper：游戏内 MOD 标识校验与骨架创建助手
class_name WorldModPackageOpsHelper
extends RefCounted

const DEFAULT_MODS_SANDBOX_ROOT: String = "user://mods/"

## 校验并清洗安全的模组 pack_id / 目录名（禁止路径分隔与穿越符）
static func is_safe_pack_identifier(pack_id: String) -> bool:
	var clean_id := pack_id.strip_edges()
	if clean_id.is_empty() or clean_id.length() > 64:
		return false
	for forbidden_token in ["/", "\\", "..", ":", "*", "?", "\"", "<", ">", "|", " "]:
		if clean_id.contains(forbidden_token):
			return false
	return true

## 规范化目标根目录路径，保证以斜杠结尾并在空输入时回落默认沙盒目录
static func normalize_directory_path(raw_path: String) -> String:
	var cleaned := raw_path.strip_edges()
	if cleaned.is_empty():
		cleaned = DEFAULT_MODS_SANDBOX_ROOT
	if not cleaned.ends_with("/"):
		cleaned += "/"
	return cleaned

## 从请求载荷中解析目标根目录（优先 target_root/install_root，其次 custom_roots[0]）
static func resolve_target_root(request_payload: Dictionary) -> String:
	var raw_root := str(request_payload.get("target_root", request_payload.get("install_root", "")))
	if raw_root.strip_edges().is_empty():
		var roots_value: Variant = request_payload.get("custom_roots", [])
		if roots_value is Array and not (roots_value as Array).is_empty():
			raw_root = str((roots_value as Array)[0])
	return normalize_directory_path(raw_root)

## 递归确保目标目录存在（支持 res:// 与 user:// 虚拟路径转换）
static func ensure_directory_recursive(directory_path: String) -> bool:
	var absolute_path := ProjectSettings.globalize_path(directory_path) if (directory_path.begins_with("res://") or directory_path.begins_with("user://")) else directory_path
	return DirAccess.make_dir_recursive_absolute(absolute_path) == OK

## 将字典载荷以缩进 UTF-8 JSON 格式写入目标文件
static func write_json_file(file_path: String, payload: Dictionary) -> bool:
	var file_handle := FileAccess.open(file_path, FileAccess.WRITE)
	if file_handle == null:
		return false
	file_handle.store_string(JSON.stringify(payload, "  ") + "\n")
	file_handle.close()
	return true

## 读取并解析目标 JSON 文件为字典（缺失或非字典返回空字典）
static func read_json_file(file_path: String) -> Dictionary:
	if not FileAccess.file_exists(file_path):
		return {}
	var file_handle := FileAccess.open(file_path, FileAccess.READ)
	if file_handle == null:
		return {}
	var parsed: Variant = JSON.parse_string(file_handle.get_as_text())
	file_handle.close()
	return parsed as Dictionary if parsed is Dictionary else {}

## 递归遍历目录收集相对文件路径清单
static func collect_relative_files(base_directory: String, relative_prefix: String, files_out: Array[String]) -> void:
	var current_directory := base_directory.path_join(relative_prefix) if not relative_prefix.is_empty() else base_directory
	var directory_handle := DirAccess.open(current_directory)
	if directory_handle == null:
		return
	directory_handle.list_dir_begin()
	var entry_name := directory_handle.get_next()
	while not entry_name.is_empty():
		if entry_name == "." or entry_name == "..":
			entry_name = directory_handle.get_next()
			continue
		var relative_path := relative_prefix.path_join(entry_name) if not relative_prefix.is_empty() else entry_name
		if directory_handle.current_is_dir():
			collect_relative_files(base_directory, relative_path, files_out)
		else:
			files_out.append(relative_path)
		entry_name = directory_handle.get_next()
	directory_handle.list_dir_end()

## 在目标目录创建合规的 MOD 骨架目录并执行单包静态预检
static func create_mod_pack(request_payload: Dictionary) -> Dictionary:
	var pack_id := str(request_payload.get("pack_id", "")).strip_edges()
	if not is_safe_pack_identifier(pack_id):
		return {"success": false, "error_code": "ERR_INVALID_PACK_ID", "message": "Invalid pack_id format"}
	var target_root := resolve_target_root(request_payload)
	var pack_directory := target_root.path_join(pack_id)
	var content_directory := pack_directory.path_join("content")
	var assets_directory := pack_directory.path_join("assets")
	if not ensure_directory_recursive(content_directory) or not ensure_directory_recursive(assets_directory):
		return {"success": false, "error_code": "ERR_MOD_DIR_CREATE_FAILED", "message": "Failed to create MOD directories"}
	var display_name := str(request_payload.get("display_name", request_payload.get("pack_name", pack_id))).strip_edges()
	if display_name.is_empty():
		display_name = pack_id
	var pack_profile := str(request_payload.get("pack_profile", "CONTENT_ADDON")).strip_edges().to_upper()
	if not (pack_profile in ["CONTENT_ADDON", "TOTAL_CONVERSION", "SYSTEM_EXTENSION"]):
		pack_profile = "CONTENT_ADDON"
	var version_text := str(request_payload.get("version", "1.0.0")).strip_edges()
	if version_text.is_empty():
		version_text = "1.0.0"
	var manifest_payload := {
		"pack_id": pack_id,
		"pack_name": display_name,
		"display_name": display_name,
		"version": version_text,
		"author": str(request_payload.get("author", "Creator")),
		"engine_api_version": "1.0.0",
		"pack_profile": pack_profile,
		"is_official": false,
		"is_active": true,
		"priority": int(request_payload.get("priority", 100)),
		"dependencies": request_payload.get("dependencies", []) if request_payload.get("dependencies") is Array else [],
		"incompatible_packs": [],
		"provided_domains": ["world", "copywriting"],
		"has_prologue_dag": false,
		"description": str(request_payload.get("description", "Custom creator MOD package")),
	}
	write_json_file(assets_directory.path_join("manifest.json"), {"schema_version": "1.0.0", "assets": []})
	write_json_file(content_directory.path_join("events.json"), {"events": []})
	manifest_payload["content_sha256"] = ModPackageDiscoverySolver.compute_package_content_sha256(pack_directory)
	if not write_json_file(pack_directory.path_join("pack.json"), manifest_payload):
		return {"success": false, "error_code": "ERR_MOD_MANIFEST_WRITE_FAILED", "message": "Failed to write pack.json"}
	var precheck_outcome := ModPrecheckAndAdaptationSolver.precheck_single_mod(manifest_payload)
	return {
		"success": true,
		"pack_id": pack_id,
		"root_path": pack_directory,
		"target_root": target_root,
		"manifest": manifest_payload,
		"precheck_valid": bool(precheck_outcome.get("valid", false)),
	}
