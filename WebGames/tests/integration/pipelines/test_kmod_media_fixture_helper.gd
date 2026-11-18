# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines Helper)
# 文件路径: res://tests/integration/pipelines/test_kmod_media_fixture_helper.gd
# 架构定位: Integration Test Fixture Helper / KMOD Media & WAV Sample Builder
# 依赖与触发: 上游: TestKmodAudioMediaAndTier3Pipeline | 下游: UIAudioBridge, CutsceneAsyncLoader,
#           CutsceneHookRegistry, AssetPathResolver, Tier3ContentOverrideLoader, LocalizationRegistryCatalog
# 职责说明: 为 KMOD 归档打包、合成 PCM WAV 字节流以及沙盒单例复位提供离线夹具辅助。
# 退出语义与设计依据: 离线测试沙盒隔离与零泄漏复位契约
# ==============================================================================

## TestKmodMediaFixtureHelper：KMOD 合成打包、WAV 样例构造与沙盒环境复位夹具
class_name TestKmodMediaFixtureHelper
extends RefCounted

const SANDBOX_ROOT: String = "user://test_kmod_media_sandbox/"


## 构建并写入纯二进制 .kmod 归档测试夹具（manifest.kdat + mod_data.kdat + 流式媒体，零明文 JSON）
static func write_binary_kmod_package(
	kmod_path: String,
	manifest_dict: Dictionary,
	source_entries: Dictionary = {},
	media_entries: Dictionary = {}
) -> void:
	DirAccess.make_dir_recursive_absolute(kmod_path.get_base_dir())
	var mod_data: Dictionary = {
		"pack_metadata": manifest_dict.duplicate(true),
		"dag_graphs": {},
		"custom_i18n": {},
		"custom_i18n_by_locale": {},
		"custom_routing_rules": [],
		"prologue_routing_rules": [],
		"content_records": [],
	}
	var sorted_sources: Array[String] = []
	for key_var in source_entries.keys():
		sorted_sources.append(String(key_var))
	sorted_sources.sort()
	for rel_path in sorted_sources:
		var entry_val: Variant = source_entries[rel_path]
		if entry_val is Dictionary:
			ModPackageArchiveReader.merge_source_entry(rel_path, entry_val as Dictionary, mod_data)

	var mod_data_kdat := BinaryConfigWriter.encode_kdat_buffer(mod_data, true, KDataHeaderDTO.PAYLOAD_MOD_PACKAGE)
	var binary_entries: Dictionary = {ModPackageArchiveReader.KMOD_DATA_FILENAME: mod_data_kdat}
	for media_key in media_entries.keys():
		binary_entries[String(media_key)] = media_entries[media_key]

	var sorted_paths: Array[String] = []
	for path_var in binary_entries.keys():
		sorted_paths.append(String(path_var))
	sorted_paths.sort()

	var sha_hasher := HashingContext.new()
	sha_hasher.start(HashingContext.HASH_SHA256)
	var files_manifest: Dictionary = {}
	for entry_path in sorted_paths:
		var raw_bytes := binary_entries[entry_path] as PackedByteArray
		sha_hasher.update(entry_path.to_utf8_buffer())
		sha_hasher.update(raw_bytes)
		var item_hasher := HashingContext.new()
		item_hasher.start(HashingContext.HASH_SHA256)
		item_hasher.update(raw_bytes)
		files_manifest[entry_path] = {
			"sha256": item_hasher.finish().hex_encode(),
			"size_bytes": raw_bytes.size(),
		}

	var full_manifest := manifest_dict.duplicate(true)
	var p_id := str(full_manifest.get("pack_id", "test_mod"))
	full_manifest["archive_format_version"] = 2
	full_manifest["bundle_id"] = str(full_manifest.get("bundle_id", p_id))
	full_manifest["bundle_name"] = str(full_manifest.get("bundle_name", full_manifest.get("pack_name", p_id)))
	full_manifest["content_sha256"] = sha_hasher.finish().hex_encode()
	full_manifest["files_manifest"] = files_manifest
	var manifest_kdat := BinaryConfigWriter.encode_kdat_buffer(full_manifest, true, KDataHeaderDTO.PAYLOAD_MOD_PACKAGE)

	var packer := ZIPPacker.new()
	if packer.open(kmod_path) != OK:
		return
	packer.start_file(ModPackageArchiveReader.KMOD_MANIFEST_FILENAME)
	packer.write_file(manifest_kdat)
	packer.close_file()
	for entry_path in sorted_paths:
		packer.start_file(entry_path)
		packer.write_file(binary_entries[entry_path] as PackedByteArray)
		packer.close_file()
	packer.close()


## 写入含 races_catalog、cutscenes/cutscene_hooks 与 assets/manifest 的全转换二进制 .kmod
static func write_custom_realm_kmod(kmod_path: String, wav_bytes: PackedByteArray) -> void:
	var manifest := {
		"pack_id": "mod_custom_realm",
		"pack_name": "Custom Realm TC",
		"version": "1.0.0",
		"pack_profile": "TOTAL_CONVERSION",
		"priority": 300,
		"is_active": true,
	}
	var source_entries := {
		"races_catalog.json": {
			"races_catalog": {
				"ASTRAL_ELF": {"attribute_coefficients": {"AGI": 1.35}}
			}
		},
		"cutscenes/cutscene_registry.json": {
			"cutscenes": {"cs_custom_entry": {"duration_sec": 3.0, "is_placeholder": true}}
		},
		"cutscenes/cutscene_hooks.json": {
			"hooks": [{
				"hook_id": "hook_custom_entry",
				"trigger_type": "NARRATIVE_NODE_PRE",
				"target_filter": {"dag_id": "DAG_CUSTOM_REALM", "node_id": "NODE_ENTRY"},
				"cutscene_id": "cs_custom_entry",
			}]
		},
		"assets/manifest.json": {
			"asset_count": 1,
			"assets": ["assets/audio/chime.wav"],
		},
	}
	write_binary_kmod_package(kmod_path, manifest, source_entries, {"assets/audio/chime.wav": wav_bytes})


## 写入含合法 WAV 与非法后缀音频的二进制 .kmod 测试包
static func write_media_pack_kmod(kmod_path: String, wav_bytes: PackedByteArray) -> void:
	write_binary_kmod_package(
		kmod_path,
		{"pack_id": "mod_audio_pack", "version": "1.0.0"},
		{},
		{
			"assets/audio/chime.wav": wav_bytes,
			"assets/audio/track.mp3": "ID3_DUMMY".to_utf8_buffer(),
		}
	)


## 写入原始二进制测试文件到沙盒路径
static func write_raw_file(file_path: String, data: PackedByteArray) -> void:
	DirAccess.make_dir_recursive_absolute(file_path.get_base_dir())
	var file_handle := FileAccess.open(file_path, FileAccess.WRITE)
	if file_handle != null:
		file_handle.store_buffer(data)
		file_handle.close()


## 构造标准 RIFF/WAVE 单声道 PCM 样本字节流
static func build_minimal_wav_bytes(sample_rate: int, bits_per_sample: int, sample_count: int) -> PackedByteArray:
	@warning_ignore("integer_division")
	var bytes_per_sample: int = bits_per_sample / 8
	var data_size: int = sample_count * bytes_per_sample
	var wav_buffer := PackedByteArray()
	wav_buffer.resize(44 + data_size)
	_write_ascii4(wav_buffer, 0, "RIFF")
	wav_buffer.encode_u32(4, 36 + data_size)
	_write_ascii4(wav_buffer, 8, "WAVE")
	_write_ascii4(wav_buffer, 12, "fmt ")
	wav_buffer.encode_u32(16, 16)
	wav_buffer.encode_u16(20, 1)
	wav_buffer.encode_u16(22, 1)
	wav_buffer.encode_u32(24, sample_rate)
	wav_buffer.encode_u32(28, sample_rate * bytes_per_sample)
	wav_buffer.encode_u16(32, bytes_per_sample)
	wav_buffer.encode_u16(34, bits_per_sample)
	_write_ascii4(wav_buffer, 36, "data")
	wav_buffer.encode_u32(40, data_size)
	return wav_buffer


static func _write_ascii4(target_buffer: PackedByteArray, offset: int, text: String) -> void:
	var raw_ascii := text.to_ascii_buffer()
	for byte_index in range(mini(4, raw_ascii.size())):
		target_buffer[offset + byte_index] = raw_ascii[byte_index]


## 复位媒体加载器、路径解析器、Tier3 覆写、多语言目录与沙盒临时目录
static func reset_env() -> void:
	UIAudioBridge.reset_instance()
	CutsceneAsyncLoader.get_instance().clear_cache_and_tasks()
	CutsceneAsyncLoader.get_instance().set_deterministic_mode(true)
	CutsceneHookRegistry.get_instance().clear_for_tests()
	AssetPathResolver.reset_for_tests()
	Tier3ContentOverrideLoader.revert_all_overrides()
	LocalizationRegistryCatalog.reset_shared()
	TestCase.unmount_mod_overlay_for_test()
	TestFullChainBackendHelper.teardown_env()
	TestTier3ContentOverrideHelper.cleanup_directory_recursive(SANDBOX_ROOT)
