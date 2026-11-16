# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_kmod_audio_media_and_tier3_pipeline.gd
# 架构定位: Integration Test Pipeline / KMOD Archive, External Audio Decode & Tier3 Isolation
# 依赖与触发: 上游: TestRegistry | 下游: Tier3ContentOverrideLoader, WorldModAffinityManager,
#           ModPackageArchiveReader, CutsceneHookRegistry, CutsceneAsyncLoader,
#           AssetPathResolver, AudioBusPipeline, UIAudioBridge, StarterLoadoutDispatcher
# 职责说明: 端到端验证 .kmod 归档显式装载、TOTAL_CONVERSION 非官方标记隔离、Dictionary 型
#           races_catalog 与 cutscenes/cutscene_hooks.json 注入、external .wav 解码、
#           异步媒体显式 STATUS_FAILED 错误码契约及 UIAudioBridge 流式音频分发链路。
# 退出语义与设计依据: 离线无头零泄漏回收（SANDBOX_ROOT 清理 + 单例全复位）
# ==============================================================================

## TestKmodAudioMediaAndTier3Pipeline：KMOD 全路径装载、音频解码与媒体失败显式化集成测试套件
class_name TestKmodAudioMediaAndTier3Pipeline
extends TestCase

const SANDBOX_ROOT: String = TestKmodMediaFixtureHelper.SANDBOX_ROOT


## 执行 KMOD 多媒体、Tier3 隔离与音视频解码全部回归测试
static func run_all_tests() -> Dictionary:
	TestKmodMediaFixtureHelper.reset_env()
	var results: Array[Dictionary] = []
	results.append(test_kmod_total_conversion_and_cutscene_manifest())
	results.append(test_audio_wav_decode_and_failure_status())
	results.append(test_ui_audio_bridge_mod_stream_and_loadout_key())
	TestKmodMediaFixtureHelper.reset_env()
	return TestCase.pack_results("KMOD 归档多媒体解码与 Tier3 中立隔离集成流水线", results)


## TC-KMEDIA-01: 显式 .kmod 归档加载 TOTAL_CONVERSION 不误认官方、races_catalog 与 cutscene_hooks 生效
static func test_kmod_total_conversion_and_cutscene_manifest() -> Dictionary:
	TestKmodMediaFixtureHelper.reset_env()
	TestFullChainBackendHelper.setup_env()
	var kmod_path := SANDBOX_ROOT.path_join("mods/mod_custom_realm_1.0.0.kmod")
	var wav_bytes := TestKmodMediaFixtureHelper.build_minimal_wav_bytes(8000, 16, 40)
	TestKmodMediaFixtureHelper.write_custom_realm_kmod(kmod_path, wav_bytes)

	var apply_res := Tier3ContentOverrideLoader.apply_enabled_packages([kmod_path])
	var applied_ok := bool(apply_res.get("success", false))
	var official_id := AssetPathResolver.get_active_official_mod_id()
	var affinity_mgr := WorldModAffinityManager.new()
	var non_official_ok := official_id.is_empty() \
		and not affinity_mgr._has_critical_missing_pack(["mod_custom_realm"], [{"pack_id": "mod_custom_realm", "pack_profile": "CONTENT_ADDON"}]) \
		and not affinity_mgr._has_critical_missing_pack(["official_kalar"], [{"pack_id": "official_kalar", "pack_profile": "EXPANSION"}]) \
		and affinity_mgr._has_critical_missing_pack(["official_kalar"], [{"pack_id": "official_kalar", "is_official": true, "pack_profile": "EXPANSION"}])

	var race_coeffs := GameConfig.get_dict("domains.attribute", "race_coefficients", {})
	var custom_race: Dictionary = race_coeffs.get("ASTRAL_ELF", {}) as Dictionary
	var race_ok := is_equal_approx(float(custom_race.get("AGI", 0.0)), 1.35)

	var hook_req := CutsceneHookRegistry.get_instance().match_narrative_hook("DAG_CUSTOM_REALM", "NODE_ENTRY", true)
	var hook_ok := hook_req != null and hook_req.cutscene_id == "cs_custom_entry"

	var archive_pkg := ModPackageArchiveReader.load_full_package_from_kmod(kmod_path)
	var assets_manifest: Dictionary = archive_pkg.get("assets_manifest", {}) as Dictionary
	var manifest_ok := int(assets_manifest.get("asset_count", 0)) == 1

	TestKmodMediaFixtureHelper.reset_env()
	var passed := applied_ok and non_official_ok and race_ok and hook_ok and manifest_ok
	return make_result("TC-KMEDIA-01: 显式 .kmod 加载 TOTAL_CONVERSION 隔离与 races/hooks/assets manifest 生效", passed, {
		"detail": "applied=%s non_official=%s('%s') race=%s hook=%s manifest=%s" % [
			applied_ok, non_official_ok, official_id, race_ok, hook_ok, manifest_ok
		]
	})


## TC-KMEDIA-02: CutsceneAsyncLoader WAV 解码(.kmod!/ + user://)、is_resource_ready 修正与 STATUS_FAILED 显式报错
static func test_audio_wav_decode_and_failure_status() -> Dictionary:
	TestKmodMediaFixtureHelper.reset_env()
	var kmod_dir := SANDBOX_ROOT.path_join("media_mods")
	var kmod_path := kmod_dir.path_join("mod_audio_pack_1.0.0.kmod")
	var wav16 := TestKmodMediaFixtureHelper.build_minimal_wav_bytes(11025, 16, 48)
	var wav8 := TestKmodMediaFixtureHelper.build_minimal_wav_bytes(8000, 8, 32)
	TestKmodMediaFixtureHelper.write_media_pack_kmod(kmod_path, wav16)

	var local_wav := SANDBOX_ROOT.path_join("local_8bit.wav")
	TestKmodMediaFixtureHelper.write_raw_file(local_wav, wav8)
	var corrupt_wav := SANDBOX_ROOT.path_join("corrupt.wav")
	TestKmodMediaFixtureHelper.write_raw_file(corrupt_wav, "NOT_A_RIFF_WAVE_FILE".to_utf8_buffer())

	AssetPathResolver.set_test_roots_override([kmod_dir])
	var loader := CutsceneAsyncLoader.get_instance()
	loader.set_deterministic_mode(false)
	loader.clear_cache_and_tasks()

	var missing_ready := loader.is_resource_ready(SANDBOX_ROOT.path_join("absent.wav"))
	var signal_events: Array[String] = []
	var fail_cb := func(tid: int, _p: String, code: String) -> void:
		signal_events.append("%d:%s" % [tid, code])
	loader.load_failed.connect(fail_cb)

	var missing_holder: Dictionary = {"cb_ran": false, "res": "UNSET"}
	var missing_id := loader.request_load(SANDBOX_ROOT.path_join("absent.wav"), 1, func(res: Resource) -> void:
		missing_holder["cb_ran"] = true
		missing_holder["res"] = res
	)
	var missing_ok := (not missing_ready) \
		and bool(missing_holder.get("cb_ran", false)) \
		and missing_holder.get("res", "ERR") == null \
		and loader.get_task_status(missing_id) == CutsceneAsyncLoader.STATUS_FAILED \
		and loader.get_task_error_code(missing_id) == CutsceneAsyncLoader.ERR_MEDIA_MISSING \
		and loader.get_last_error_code(SANDBOX_ROOT.path_join("absent.wav")) == CutsceneAsyncLoader.ERR_MEDIA_MISSING \
		and signal_events.has("%d:%s" % [missing_id, CutsceneAsyncLoader.ERR_MEDIA_MISSING])

	var corrupt_id := loader.request_load(corrupt_wav)
	var corrupt_ok := loader.get_task_status(corrupt_id) == CutsceneAsyncLoader.STATUS_FAILED \
		and loader.get_task_error_code(corrupt_id) == CutsceneAsyncLoader.ERR_MEDIA_DECODE_FAILED

	var unsupported_uri := AssetPathResolver.resolve_unified_uri("mod://audio/track.mp3", "mod_audio_pack")
	var unsupported_id := loader.request_load(unsupported_uri)
	var unsupported_ok := loader.get_task_status(unsupported_id) == CutsceneAsyncLoader.STATUS_FAILED \
		and loader.get_task_error_code(unsupported_id) == CutsceneAsyncLoader.ERR_UNSUPPORTED_MEDIA_FORMAT

	var kmod_wav_uri := AssetPathResolver.resolve_unified_uri("mod://audio/chime.wav", "mod_audio_pack")
	var loaded_kmod: Dictionary = {"res": null}
	var ok_id := loader.request_load(kmod_wav_uri, 1, func(res: Resource) -> void:
		loaded_kmod["res"] = res
	)
	var kmod_stream: Variant = loaded_kmod.get("res", null)
	var kmod_wav_ok := kmod_stream is AudioStreamWAV \
		and (kmod_stream as AudioStreamWAV).mix_rate == 11025 \
		and (kmod_stream as AudioStreamWAV).format == AudioStreamWAV.FORMAT_16_BITS \
		and loader.get_task_status(ok_id) == CutsceneAsyncLoader.STATUS_LOADED \
		and loader.is_resource_ready(kmod_wav_uri)

	var local_loaded: Dictionary = {"res": null}
	loader.request_load(local_wav, 1, func(res: Resource) -> void:
		local_loaded["res"] = res
	)
	var local_stream: Variant = local_loaded.get("res", null)
	var local_wav_ok := local_stream is AudioStreamWAV \
		and (local_stream as AudioStreamWAV).mix_rate == 8000 \
		and (local_stream as AudioStreamWAV).format == AudioStreamWAV.FORMAT_8_BITS

	if loader.load_failed.is_connected(fail_cb):
		loader.load_failed.disconnect(fail_cb)
	TestKmodMediaFixtureHelper.reset_env()

	var passed := missing_ok and corrupt_ok and unsupported_ok and kmod_wav_ok and local_wav_ok
	return make_result("TC-KMEDIA-02: .kmod!/ 与 user:// WAV 解码、is_resource_ready 修正及 STATUS_FAILED 错误码", passed, {
		"missing_ok": missing_ok,
		"corrupt_ok": corrupt_ok,
		"unsupported_ok": unsupported_ok,
		"kmod_wav_ok": kmod_wav_ok,
		"local_wav_ok": local_wav_ok
	})


## TC-KMEDIA-03: UIAudioBridge 消费 sound_registry 异步触发 play_stream 及 StarterLoadout loc_name_key 优先
static func test_ui_audio_bridge_mod_stream_and_loadout_key() -> Dictionary:
	TestKmodMediaFixtureHelper.reset_env()
	var kmod_dir := SANDBOX_ROOT.path_join("bridge_mods")
	var kmod_path := kmod_dir.path_join("mod_ui_sound_1.0.0.kmod")
	TestKmodMediaFixtureHelper.write_media_pack_kmod(kmod_path, TestKmodMediaFixtureHelper.build_minimal_wav_bytes(16000, 16, 40))
	AssetPathResolver.set_test_roots_override([kmod_dir])
	var kmod_uri := AssetPathResolver.resolve_unified_uri("mod://audio/chime.wav", "mod_audio_pack")

	GameConfig.apply_mod_overlay_tables({
		"domains.event_driven_audio.core": {
			"sound_registry": {
				"ui_custom_chime": {"uri": kmod_uri, "bus": "ME"}
			}
		}
	}, ["mod_ui_sound_test"])
	var loader := CutsceneAsyncLoader.get_instance()
	loader.set_deterministic_mode(false)
	loader.clear_cache_and_tasks()

	var captured: Array[Dictionary] = []
	var bridge := UIAudioBridge.get_instance()
	var stream_cb := func(sid: String, stream: AudioStream, bus: String, vol: float) -> void:
		captured.append({"id": sid, "is_wav": stream is AudioStreamWAV, "bus": bus, "vol": vol})
	bridge.play_stream.connect(stream_cb)
	var task_id := bridge.play_mod_audio_async("ui_custom_chime", "", "ME", -2.5)
	if bridge.play_stream.is_connected(stream_cb):
		bridge.play_stream.disconnect(stream_cb)

	var bridge_ok := task_id > 0 and captured.size() == 1 \
		and str(captured[0].get("id", "")) == "ui_custom_chime" \
		and bool(captured[0].get("is_wav", false)) \
		and str(captured[0].get("bus", "")) == "ME" \
		and is_equal_approx(float(captured[0].get("vol", 0.0)), -2.5)

	var loc_catalog := LocalizationRegistryCatalog.get_shared()
	loc_catalog.register_translation("zh_CN", "item.custom.chime", "晨钟法器")
	var loc_item := {"loc_name_key": "item.custom.chime", "canonical_name_key": "item.legacy.chime"}
	var resolved_name := StarterLoadoutDispatcher._resolve_item_name("MOD:ITEM:CHIME", loc_item)
	var loadout_ok := resolved_name == "晨钟法器"

	TestKmodMediaFixtureHelper.reset_env()
	return make_result("TC-KMEDIA-03: UIAudioBridge MOD 音频流异步分发与新手物资 loc_name_key 优先读取", bridge_ok and loadout_ok, {
		"detail": "task_id=%d cap=%d bridge_ok=%s loadout_ok=%s resolved='%s'" % [
			task_id, captured.size(), bridge_ok, loadout_ok, resolved_name
		]
	})
