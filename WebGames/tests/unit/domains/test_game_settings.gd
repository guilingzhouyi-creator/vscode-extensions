# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 26 全局设置系统单元测试
# 文件路径: res://tests/unit/domains/test_game_settings.gd
# ==============================================================================
class_name TestGameSettingsDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 26: 全局设置中心与渲染管线配置系统"

	results.append(_test_settings_serialization_and_persistence())
	results.append(_test_settings_validation_and_clamp())
	results.append(_test_auto_revert_safety_guard())
	# Phase 56 L5 新增：反序列化子段类型守卫
	results.append(_test_corrupt_section_type_falls_back())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_settings_serialization_and_persistence() -> Dictionary:
	var s1 := GameSettingsAggregate.new()
	s1.audio_settings["master_volume"] = 0.65
	s1.render_settings["resolution_width"] = 2560
	s1.render_settings["resolution_height"] = 1440

	var serialized_str = SettingsPersistenceService.save_to_memory_string(s1)

	var s2 := GameSettingsAggregate.new()
	var load_ok = SettingsPersistenceService.load_from_memory_string(s2, serialized_str)

	var passed = load_ok and (is_equal_approx(s2.audio_settings["master_volume"], 0.65)) and (s2.render_settings["resolution_width"] == 2560)
	return {
		"test": "TC-SET-01: 全局设置序列化与反序列化完整性",
		"passed": passed
	}

static func _test_settings_validation_and_clamp() -> Dictionary:
	var s := GameSettingsAggregate.new()
	s.audio_settings["bgm_volume"] = 2.5 # 超界
	s.ui_visual_settings["ui_scale"] = 0.2 # 过小

	var driver := SettingsApplyDriver.new()
	driver.validate_and_sanitize(s)

	var passed = (s.audio_settings["bgm_volume"] == 1.0) and (s.ui_visual_settings["ui_scale"] == 0.75)
	return {
		"test": "TC-SET-02: 设置数值边界防护与自适应 Clamp 修正",
		"passed": passed
	}

static func _test_auto_revert_safety_guard() -> Dictionary:
	var s := GameSettingsAggregate.new()
	s.render_settings["resolution_width"] = 1920
	s.render_settings["resolution_height"] = 1080

	var driver := SettingsApplyDriver.new()
	driver.apply_resolution_with_revert_guard(s, 3840, 2160, "EXCLUSIVE_FULLSCREEN")

	# 模拟 16 秒后未确认
	var reverted = driver.tick_revert_timer(16.0, s)
	var passed = reverted and (s.render_settings["resolution_width"] == 1920) and (s.render_settings["resolution_height"] == 1080)
	return {
		"test": "TC-SET-03: 分辨率切换 15 秒未确认安全自动回滚",
		"passed": passed
	}

## L5（Phase 56）：反序列化子段类型守卫——损坏文件（audio 非 Dictionary）不再 typed 崩溃，回退默认段
static func _test_corrupt_section_type_falls_back() -> Dictionary:
	var s := GameSettingsAggregate.new()
	var default_audio: float = s.audio_settings.get("master_volume", 0.0)

	s.deserialize({ "audio": "CORRUPTED" }) # 旧实现：var a: Dictionary = data["audio"] 运行错误
	var crash_free = is_equal_approx(float(s.audio_settings.get("master_volume", 0.0)), default_audio)

	s.deserialize({ "audio": { "master_volume": 0.3 }, "render": 42 })
	var merge_ok = is_equal_approx(float(s.audio_settings.get("master_volume", 0.0)), 0.3) \
		and is_equal_approx(float(s.render_settings.get("resolution_width", 0)), 1920.0)
	var passed = crash_free and merge_ok
	return { "test": "TC-SET-04: 子段类型守卫（L5：坏类型回退默认、合法段正常合并）", "passed": passed }
