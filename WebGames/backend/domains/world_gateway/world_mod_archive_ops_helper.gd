# ==============================================================================
# 模块归属: 业务领域层 (Domains · 世界网关集群 (World Gateway Domain))
# 文件路径: res://backend/domains/world_gateway/world_mod_archive_ops_helper.gd
# 架构定位: Domain Support Helper / In-Game MOD Archive (.kmod) Pack & Install Operations
# 依赖与触发: 上游: WorldGatewayProtocolHandler | 下游: WorldModPackageOpsHelper, ModPackageDiscoverySolver
# 职责说明: 为游戏内 MOD 工坊与统一协议提供打包 .kmod 归档包与安全安装 .kmod/文件夹至 user://mods/ 的全流程能力。
# 退出语义与设计依据: 路径穿越防御、SHA-256 清单验签与本地校验规范
# ==============================================================================

## WorldModArchiveOpsHelper：游戏内 MOD 打包 (.kmod) 与安全安装助手
class_name WorldModArchiveOpsHelper
extends RefCounted

## 使用 Godot ZIPPacker 将指定 MOD 源目录打包为标准 .kmod 归档包
static func pack_mod_kmod(request_payload: Dictionary) -> Dictionary:
	var source_directory := str(request_payload.get("source_dir", "")).strip_edges()
	var global_source := ProjectSettings.globalize_path(source_directory) if (source_directory.begins_with("res://") or source_directory.begins_with("user://")) else source_directory
	if source_directory.is_empty() or not DirAccess.dir_exists_absolute(global_source):
		return {"success": false, "error_code": "ERR_MOD_SOURCE_NOT_FOUND", "message": "MOD source directory does not exist"}
	var pack_manifest := WorldModPackageOpsHelper.read_json_file(source_directory.path_join("pack.json"))
	if pack_manifest.is_empty():
		pack_manifest = WorldModPackageOpsHelper.read_json_file(source_directory.path_join("manifest.json"))
	var pack_id := str(pack_manifest.get("pack_id", source_directory.get_file())).strip_edges()
	if not WorldModPackageOpsHelper.is_safe_pack_identifier(pack_id):
		return {"success": false, "error_code": "ERR_INVALID_PACK_ID", "message": "Invalid or unsafe pack_id"}
	var version_text := str(pack_manifest.get("version", "1.0.0")).strip_edges()
	var output_kmod := str(request_payload.get("output_path", "")).strip_edges()
	if output_kmod.is_empty():
		var target_root := WorldModPackageOpsHelper.resolve_target_root(request_payload)
		WorldModPackageOpsHelper.ensure_directory_recursive(target_root)
		output_kmod = target_root.path_join("%s_v%s.kmod" % [pack_id, version_text])
	else:
		WorldModPackageOpsHelper.ensure_directory_recursive(output_kmod.get_base_dir())
	var relative_files: Array[String] = []
	WorldModPackageOpsHelper.collect_relative_files(source_directory, "", relative_files)
	var content_sha := ModPackageDiscoverySolver.compute_package_content_sha256(source_directory)
	pack_manifest["content_sha256"] = content_sha
	var packer := ZIPPacker.new()
	if packer.open(output_kmod) != OK:
		return {"success": false, "error_code": "ERR_KMOD_OPEN_FAILED", "message": "Failed to open target .kmod archive"}
	for relative_path in relative_files:
		if relative_path == "manifest.json" or relative_path == "pack.json":
			continue
		var file_bytes := FileAccess.get_file_as_bytes(source_directory.path_join(relative_path))
		packer.start_file(relative_path)
		packer.write_file(file_bytes)
		packer.close_file()
	packer.start_file("pack.json")
	packer.write_file((JSON.stringify(pack_manifest, "  ") + "\n").to_utf8_buffer())
	packer.close_file()
	var root_manifest := {
		"pack_id": pack_id,
		"pack_name": str(pack_manifest.get("pack_name", pack_id)),
		"version": version_text,
		"pack_profile": str(pack_manifest.get("pack_profile", "CONTENT_ADDON")),
		"content_sha256": content_sha,
	}
	packer.start_file("manifest.json")
	packer.write_file((JSON.stringify(root_manifest, "  ") + "\n").to_utf8_buffer())
	packer.close_file()
	packer.close()
	return {
		"success": true,
		"pack_id": pack_id,
		"version": version_text,
		"kmod_path": output_kmod,
		"content_sha256": content_sha,
	}

## 安全安装 .kmod 归档文件或 MOD 文件夹至目标 mods 目录（默认 user://mods/）
static func install_mod_pack(request_payload: Dictionary) -> Dictionary:
	var source_path := str(request_payload.get("source_path", "")).strip_edges()
	if source_path.is_empty():
		return {"success": false, "error_code": "ERR_MOD_SOURCE_EMPTY", "message": "Install source_path is empty"}
	var target_root := WorldModPackageOpsHelper.resolve_target_root(request_payload)
	if not WorldModPackageOpsHelper.ensure_directory_recursive(target_root):
		return {"success": false, "error_code": "ERR_MOD_DIR_CREATE_FAILED", "message": "Failed to ensure target mods directory"}
	if source_path.to_lower().ends_with(".kmod") or FileAccess.file_exists(source_path):
		return _install_kmod_file(source_path, target_root)
	return _install_mod_directory(source_path, target_root)

static func _install_kmod_file(source_path: String, target_root: String) -> Dictionary:
	if not FileAccess.file_exists(source_path):
		return {"success": false, "error_code": "ERR_KMOD_NOT_FOUND", "message": "Archive file not found"}
	var fallback_id := source_path.get_file().get_basename()
	var manifest := ModPackageDiscoverySolver._parse_manifest_from_kmod(source_path, fallback_id)
	if manifest == null or not WorldModPackageOpsHelper.is_safe_pack_identifier(manifest.pack_id):
		return {"success": false, "error_code": "ERR_INVALID_KMOD_MANIFEST", "message": "Archive missing valid manifest"}
	var target_filename := source_path.get_file()
	if not target_filename.to_lower().ends_with(".kmod"):
		target_filename = "%s.kmod" % manifest.pack_id
	var destination_path := target_root.path_join(target_filename)
	var archive_bytes := FileAccess.get_file_as_bytes(source_path)
	var output_handle := FileAccess.open(destination_path, FileAccess.WRITE)
	if output_handle == null:
		return {"success": false, "error_code": "ERR_KMOD_INSTALL_WRITE_FAILED", "message": "Failed to copy .kmod package"}
	output_handle.store_buffer(archive_bytes)
	output_handle.close()
	return {
		"success": true,
		"pack_id": manifest.pack_id,
		"installed_path": destination_path,
		"install_kind": "kmod",
	}

static func _install_mod_directory(source_directory: String, target_root: String) -> Dictionary:
	var pack_manifest := WorldModPackageOpsHelper.read_json_file(source_directory.path_join("pack.json"))
	if pack_manifest.is_empty():
		pack_manifest = WorldModPackageOpsHelper.read_json_file(source_directory.path_join("manifest.json"))
	if pack_manifest.is_empty():
		return {"success": false, "error_code": "ERR_INVALID_MOD_MANIFEST", "message": "Directory missing pack.json or manifest.json"}
	var pack_id := str(pack_manifest.get("pack_id", source_directory.get_file())).strip_edges()
	if not WorldModPackageOpsHelper.is_safe_pack_identifier(pack_id):
		return {"success": false, "error_code": "ERR_INVALID_PACK_ID", "message": "Invalid pack_id"}
	var relative_files: Array[String] = []
	WorldModPackageOpsHelper.collect_relative_files(source_directory, "", relative_files)
	if relative_files.is_empty():
		return {"success": false, "error_code": "ERR_EMPTY_MOD_DIR", "message": "Source MOD directory has no files"}
	var destination_directory := target_root.path_join(pack_id)
	for relative_path in relative_files:
		var destination_file := destination_directory.path_join(relative_path)
		WorldModPackageOpsHelper.ensure_directory_recursive(destination_file.get_base_dir())
		var file_bytes := FileAccess.get_file_as_bytes(source_directory.path_join(relative_path))
		var output_handle := FileAccess.open(destination_file, FileAccess.WRITE)
		if output_handle == null:
			return {"success": false, "error_code": "ERR_MOD_INSTALL_COPY_FAILED", "message": "Failed writing MOD file"}
		output_handle.store_buffer(file_bytes)
		output_handle.close()
	return {
		"success": true,
		"pack_id": pack_id,
		"installed_path": destination_directory,
		"install_kind": "directory",
	}
