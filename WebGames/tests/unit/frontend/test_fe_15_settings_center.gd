# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第15卷: 设置中心系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_15_settings_center.gd
# ==============================================================================
class_name TestFE15SettingsCenter
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 15: 设置中心系统（音画/多语言/15秒回滚）"

	results.append(_test_audio_volume_sliders())
	results.append(_test_resolution_15s_rollback_prompt())
	results.append(_test_locale_switch())

	var passed_cnt = 0
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

static func _test_audio_volume_sliders() -> Dictionary:
	var view = SettingsCenterView.new()
	view.set_volumes(0.8, 0.6, 0.9)

	var passed = is_equal_approx(view.volume_master, 0.8) and is_equal_approx(view.volume_bgm, 0.6)
	view.free()
	return {
		"test": "TC-FE15-01: 主音量与BGM/SE分路音量滑块响应",
		"passed": passed
	}

static func _test_resolution_15s_rollback_prompt() -> Dictionary:
	var view = SettingsCenterView.new()
	view.apply_resolution_with_countdown("2560x1440")
	var is_counting = view.is_in_resolution_revert_countdown and is_equal_approx(view.revert_seconds_remain, 15.0)
	view.confirm_resolution_change()
	var is_confirmed = not view.is_in_resolution_revert_countdown

	var passed = is_counting and is_confirmed and (view.selected_resolution == "2560x1440")
	view.free()
	return {
		"test": "TC-FE15-02: 分辨率切换15秒安全回滚倒计时与确认",
		"passed": passed
	}

static func _test_locale_switch() -> Dictionary:
	var view = SettingsCenterView.new()
	view.switch_locale("en_US")
	var passed = (view.selected_locale == "en_US")
	view.free()
	return {
		"test": "TC-FE15-03: 国际化多语言即时热切状态保持",
		"passed": passed
	}
