# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 38 多语言国际化单元测试
# 文件路径: res://tests/unit/domains/test_localization_i18n.gd
# ==============================================================================
class_name TestLocalizationI18nDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 38: 全域多语言国际化与动态插值引擎"

	results.append(_test_dynamic_parameter_interpolation())
	results.append(_test_multi_tier_fallback_hierarchy())
	results.append(_test_hot_switch_language_locale())

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

static func _test_dynamic_parameter_interpolation() -> Dictionary:
	var catalog := LocalizationRegistryCatalog.new()
	catalog.current_locale = "zh_CN"
	catalog.register_translation("zh_CN", "combat.hit", "{attacker} 使用 {weapon} 击中了 {target}，造成 {dmg} 点物理伤害")

	var params := {
		"attacker": "亚瑟",
		"weapon": "秘银长剑",
		"target": "哥布林督军",
		"dmg": 128
	}
	var res = LocalizationSolver.translate(catalog, "combat.hit", params)
	var expected = "亚瑟 使用 秘银长剑 击中了 哥布林督军，造成 128 点物理伤害"

	var passed = (res == expected)
	return {
		"test": "TC-I18N-01: 动态参数占位符精准字符串插值与格式化",
		"passed": passed
	}

static func _test_multi_tier_fallback_hierarchy() -> Dictionary:
	var catalog := LocalizationRegistryCatalog.new()
	catalog.current_locale = "ja_JP"
	catalog.fallback_locale = "en_US"

	# ja_JP 缺词条，但在 en_US 存在
	catalog.register_translation("en_US", "item.potion.name", "Health Potion")
	var res_fallback = LocalizationSolver.translate(catalog, "item.potion.name")

	# 两个语言都缺失 -> 最终兜底返回原始 key
	var res_missing = LocalizationSolver.translate(catalog, "item.unknown_key.name")

	var passed = (res_fallback == "Health Potion") and (res_missing == "[item.unknown_key.name]")
	return {
		"test": "TC-I18N-02: 多层级语言包回退与缺失词条安全兜底",
		"passed": passed
	}

static func _test_hot_switch_language_locale() -> Dictionary:
	var catalog := LocalizationRegistryCatalog.new()
	catalog.register_translation("zh_CN", "ui.start_game", "进入世界")
	catalog.register_translation("en_US", "ui.start_game", "Enter World")

	catalog.current_locale = "zh_CN"
	var t_zh = LocalizationSolver.translate(catalog, "ui.start_game")

	I18nHotReloadPipeline.switch_language(catalog, "en_US")
	var t_en = LocalizationSolver.translate(catalog, "ui.start_game")

	var passed = (t_zh == "进入世界") and (t_en == "Enter World")
	return {
		"test": "TC-I18N-03: 语言环境即时热重载与无缝动态响应",
		"passed": passed
	}
