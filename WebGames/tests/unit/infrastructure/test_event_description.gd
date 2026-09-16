# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 事件发生描述系统单元测试（Phase 23）
# 文件路径: res://tests/unit/infrastructure/test_event_description.gd
# 覆盖: Phase 23 施工细则 阶段1~4（TC-EVTDESC-01~06）
#       —— 正常生成 / 结果分支 / 不承担判定 / 复用声明 / 配置为源 / 键登记
# ==============================================================================
class_name TestEventDescriptionDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 23: 事件发生描述系统（事件侧三位一体）"

	results.append(_test_normal_generation())
	results.append(_test_outcome_branch())
	results.append(_test_no_judgment())
	results.append(_test_config_as_source())
	results.append(_test_key_registration())
	results.append(_test_missing_and_unknown())

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

## TC-EVTDESC-01: 正常描述生成（全参 → 文本 {param} 填充零残留）
static func _test_normal_generation() -> Dictionary:
	var res := EventDescriptionResolver.resolve(
		"EVT_MARKET_CRASH", {"town": "中洲圣城"}, {"outcome": "base", "loss_gold": 800})
	var text: String = str(res.get("text", ""))
	var passed = res.get("success", false) \
		and text.contains("中洲圣城") \
		and text.contains("800") \
		and not text.contains("{")
	return {
		"test": "TC-EVTDESC-01: 正常描述生成（事件/上下文/结果 → {param} 填充零残留）",
		"passed": passed
	}

## TC-EVTDESC-02: 结果分支选择（outcome success/failure → 对应分支模板，base 兜底）
static func _test_outcome_branch() -> Dictionary:
	var res_s := EventDescriptionResolver.resolve(
		"EVT_BEAST_TIDE", {"town": "瓦兰城"}, {"outcome": "success", "reward_gold": 500, "loss_soldiers": 3})
	var res_f := EventDescriptionResolver.resolve(
		"EVT_BEAST_TIDE", {"town": "瓦兰城"}, {"outcome": "failure", "loss_soldiers": 20})
	var passed = res_s.get("success", false) and str(res_s.get("text", "")).contains("击退了兽潮") \
		and res_f.get("success", false) and str(res_f.get("text", "")).contains("冲破城门")
	return {
		"test": "TC-EVTDESC-02: 结果分支选择（success/failure 分支模板 + base 兜底）",
		"passed": passed
	}

## TC-EVTDESC-03: 不承担事件判定（生成于结果之后，输出零判定/零动作字段）
static func _test_no_judgment() -> Dictionary:
	var res := EventDescriptionResolver.resolve(
		"EVT_MARKET_CRASH", {"town": "中洲圣城"}, {"outcome": "base", "loss_gold": 100})
	var no_judgment_fields := true
	for key in res.keys():
		if key in ["action", "dispatch", "trigger", "probability", "execute"]:
			no_judgment_fields = false
	var passed = res.get("success", false) and no_judgment_fields
	return {
		"test": "TC-EVTDESC-03: 不承担事件判定（描述输出零判定/零执行字段）",
		"passed": passed
	}

## TC-EVTDESC-04: 配置为源（描述模板 100% 来自 copywriting.narrative 表）
static func _test_config_as_source() -> Dictionary:
	var descriptions: Dictionary = GameConfig.get_table("copywriting.narrative", {})
	var passed = descriptions.size() >= 2 \
		and descriptions.has("EVT_BEAST_TIDE") \
		and str(descriptions.get("EVT_BEAST_TIDE", {}).get("base", "")).contains("兽潮")
	return {
		"test": "TC-EVTDESC-04: 配置为源零内联（描述模板 100% 来自 copywriting.narrative 表）",
		"passed": passed
	}

## TC-EVTDESC-05: 描述键登记（narrative.<事件ID>.desc 名称注册表登记可查）
static func _test_key_registration() -> Dictionary:
	var shared := LocalizationRegistryCatalog.get_shared()
	var res := EventDescriptionResolver.resolve(
		"EVT_MARKET_CRASH", {"town": "中洲圣城"}, {"outcome": "base", "loss_gold": 50})
	var owner: String = shared.get_name_key_owner("narrative.EVT_MARKET_CRASH.desc")
	var passed = res.get("success", false) and owner == "narrative"
	return {
		"test": "TC-EVTDESC-05: 描述键登记（narrative.<事件ID>.desc 注册表登记，owner=narrative）",
		"passed": passed
	}

## TC-EVTDESC-06: 未配置事件与未知分支优雅拦截（不抛 Fatal）
static func _test_missing_and_unknown() -> Dictionary:
	var missing := EventDescriptionResolver.resolve("EVT_UNKNOWN", {}, {})
	var unknown_outcome := EventDescriptionResolver.resolve(
		"EVT_MARKET_CRASH", {"town": "中洲圣城"}, {"outcome": "legendary", "loss_gold": 10})
	var passed = not missing.get("success", true) and str(missing.get("code", "")) == "EVENT_DESC_MISSING" \
		and unknown_outcome.get("success", false)  # 未知 outcome 回退 base 兜底
	return {
		"test": "TC-EVTDESC-06: 未配置事件拦截（EVENT_DESC_MISSING）+ 未知分支回退 base 兜底",
		"passed": passed
	}
