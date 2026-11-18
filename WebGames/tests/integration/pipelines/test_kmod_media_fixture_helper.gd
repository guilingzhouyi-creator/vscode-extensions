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


## 写入含 races_catalog、cutscenes/cutscene_hooks 与 assets/manifest 的全转换 .kmod
static func write_custom_realm_kmod(kmod_path: String, wav_bytes: PackedByteArray) -> void:
	DirAccess.make_dir_recursive_absolute(kmod_path.get_base_dir())
	var packer := ZIPPacker.new()
	if packer.open(kmod_path) != OK:
		return
	pack_json(packer, "pack.json", {
		"pack_id": "mod_custom_realm",
		"pack_name": "Custom Realm TC",
		"version": "1.0.0",
		"pack_profile": "TOTAL_CONVERSION",
		"priority": 300,
		"is_active": true
	})
	pack_json(packer, "races_catalog.json", {
		"races_catalog": {
			"ASTRAL_ELF": {"attribute_coefficients": {"AGI": 1.35}}
		}
	})
	pack_json(packer, "cutscenes/cutscene_registry.json", {
		"cutscenes": {"cs_custom_entry": {"duration_sec": 3.0, "is_placeholder": true}}
	})
	pack_json(packer, "cutscenes/cutscene_hooks.json", {
		"hooks": [{
			"hook_id": "hook_custom_entry",
			"trigger_type": "NARRATIVE_NODE_PRE",
			"target_filter": {"dag_id": "DAG_CUSTOM_REALM", "node_id": "NODE_ENTRY"},
			"cutscene_id": "cs_custom_entry"
		}]
	})
	pack_json(packer, "assets/manifest.json", {
		"asset_count": 1,
		"assets": ["assets/audio/chime.wav"]
	})
	packer.start_file("assets/audio/chime.wav")
	packer.write_file(wav_bytes)
	packer.close_file()
	packer.close()


## 写入含合法 WAV 与非法后缀音频的 .kmod 测试包
static func write_media_pack_kmod(kmod_path: String, wav_bytes: PackedByteArray) -> void:
	DirAccess.make_dir_recursive_absolute(kmod_path.get_base_dir())
	var packer := ZIPPacker.new()
	if packer.open(kmod_path) != OK:
		return
	pack_json(packer, "pack.json", {"pack_id": "mod_audio_pack", "version": "1.0.0"})
	packer.start_file("assets/audio/chime.wav")
	packer.write_file(wav_bytes)
	packer.close_file()
	packer.start_file("assets/audio/track.mp3")
	packer.write_file("ID3_DUMMY".to_utf8_buffer())
	packer.close_file()
	packer.close()


## 向 ZIPPacker 写入 JSON 字典条目
static func pack_json(packer: ZIPPacker, entry_path: String, payload: Variant) -> void:
	packer.start_file(entry_path)
	packer.write_file(JSON.stringify(payload).to_utf8_buffer())
	packer.close_file()


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
