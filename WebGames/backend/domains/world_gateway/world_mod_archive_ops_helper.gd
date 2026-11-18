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
static func _is_skipped_source_file(normalized_rel: String) -> bool:
	var lower_rel := normalized_rel.to_lower()
	for suffix in [".uid", ".import", ".tmp", ".swp", ".kmod"]:
		if lower_rel.ends_with(suffix):
			return true
	for segment in normalized_rel.split("/"):
		if segment in [".git", "__pycache__", ".DS_Store", "Thumbs.db"]:
			return true
	return false


static func _build_normalized_mod_data(source_directory: String, pack_manifest: Dictionary, relative_files: Array[String]) -> Dictionary:
	var sanitized_meta := pack_manifest.duplicate(true)
	sanitized_meta.erase("content_sha256")
	sanitized_meta.erase("files_manifest")
	var mod_data: Dictionary = {
		"pack_metadata": sanitized_meta,
		"dag_graphs": {},
		"custom_i18n": {},
		"custom_i18n_by_locale": {},
		"custom_routing_rules": [],
		"prologue_routing_rules": [],
		"content_records": [],
	}
	relative_files.sort()
	for raw_rel in relative_files:
		var rel_path := raw_rel.replace("\\", "/")
		if rel_path == "pack.json" or _is_skipped_source_file(rel_path):
			continue
		if not rel_path.to_lower().ends_with(".json"):
			continue
		var full_path := source_directory.path_join(rel_path)
		var file_handle := FileAccess.open(full_path, FileAccess.READ)
		if file_handle == null:
			continue
		var parsed: Variant = JSON.parse_string(file_handle.get_as_text())
		file_handle.close()
		if parsed is Dictionary:
			ModPackageArchiveReader.merge_source_entry(rel_path, parsed as Dictionary, mod_data)
	return mod_data


static func _compute_bytes_sha256(payload: PackedByteArray) -> String:
	var hasher := HashingContext.new()
	hasher.start(HashingContext.HASH_SHA256)
	hasher.update(payload)
	return hasher.finish().hex_encode()


static func _build_archive_manifest_dict(
	pack_manifest: Dictionary,
	pack_id: String,
	version_text: String,
	binary_entries: Dictionary
) -> Dictionary:
	var sorted_paths: Array[String] = []
	for path_variant in binary_entries.keys():
		sorted_paths.append(String(path_variant))
	sorted_paths.sort()

	var sha_hasher := HashingContext.new()
	sha_hasher.start(HashingContext.HASH_SHA256)
	var files_manifest: Dictionary = {}
	for entry_path in sorted_paths:
		var entry_bytes := binary_entries[entry_path] as PackedByteArray
		sha_hasher.update(entry_path.to_utf8_buffer())
		sha_hasher.update(entry_bytes)
		files_manifest[entry_path] = {
			"sha256": _compute_bytes_sha256(entry_bytes),
			"size_bytes": entry_bytes.size(),
		}

	var content_sha := sha_hasher.finish().hex_encode()
	var archive_manifest := pack_manifest.duplicate(true)
	archive_manifest["archive_format_version"] = 2
	archive_manifest["manifest_schema"] = "kalar.mod_sdk.bundle_manifest.v1"
	archive_manifest["pack_id"] = pack_id
	archive_manifest["bundle_id"] = str(pack_manifest.get("bundle_id", pack_id))
	archive_manifest["pack_name"] = str(pack_manifest.get("pack_name", pack_id))
	archive_manifest["bundle_name"] = str(pack_manifest.get("bundle_name", archive_manifest["pack_name"]))
	archive_manifest["version"] = version_text
	archive_manifest["pack_profile"] = str(pack_manifest.get("pack_profile", "CONTENT_ADDON"))
	archive_manifest["kalar_sdk_version"] = str(pack_manifest.get("kalar_sdk_version", "1.0.0"))
	archive_manifest["created_timestamp_utc"] = Time.get_datetime_string_from_system(true, true) + "Z"
	archive_manifest["content_sha256"] = content_sha
	archive_manifest["files_manifest"] = files_manifest
	return archive_manifest


## 将开发期 JSON 模组目录编译封装为正式 .kmod 二进制归档包（manifest.kdat + mod_data.kdat + 媒体流）
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
	var mod_data := _build_normalized_mod_data(source_directory, pack_manifest, relative_files)
	var mod_data_kdat := BinaryConfigWriter.encode_kdat_buffer(mod_data, true, KDataHeaderDTO.PAYLOAD_MOD_PACKAGE)
	if mod_data_kdat.is_empty():
		return {"success": false, "error_code": "ERR_KDAT_ENCODE_FAILED", "message": "Failed to compile mod_data.kdat"}

	var binary_entries: Dictionary = {ModPackageArchiveReader.KMOD_DATA_FILENAME: mod_data_kdat}
	for raw_rel in relative_files:
		var rel_path := raw_rel.replace("\\", "/")
		if rel_path.to_lower().ends_with(".json") or _is_skipped_source_file(rel_path):
			continue
		binary_entries[rel_path] = FileAccess.get_file_as_bytes(source_directory.path_join(rel_path))

	var archive_manifest := _build_archive_manifest_dict(pack_manifest, pack_id, version_text, binary_entries)
	var manifest_kdat := BinaryConfigWriter.encode_kdat_buffer(archive_manifest, true, KDataHeaderDTO.PAYLOAD_MOD_PACKAGE)
	if manifest_kdat.is_empty():
		return {"success": false, "error_code": "ERR_KDAT_ENCODE_FAILED", "message": "Failed to compile manifest.kdat"}

	var packer := ZIPPacker.new()
	if packer.open(output_kmod) != OK:
		return {"success": false, "error_code": "ERR_KMOD_OPEN_FAILED", "message": "Failed to open target .kmod archive"}
	packer.start_file(ModPackageArchiveReader.KMOD_MANIFEST_FILENAME)
	packer.write_file(manifest_kdat)
	packer.close_file()

	var sorted_entry_paths: Array[String] = []
	for path_variant in binary_entries.keys():
		sorted_entry_paths.append(String(path_variant))
	sorted_entry_paths.sort()
	for entry_path in sorted_entry_paths:
		packer.start_file(entry_path)
		packer.write_file(binary_entries[entry_path] as PackedByteArray)
		packer.close_file()
	packer.close()
	return {
		"success": true,
		"pack_id": pack_id,
		"version": version_text,
		"kmod_path": output_kmod,
		"archive_format": "kmod_kdat_v2",
		"content_sha256": str(archive_manifest.get("content_sha256", "")),
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
