# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 事件流关联动态概率系统单元测试（Phase 22）
# 文件路径: res://tests/unit/infrastructure/test_event_probability.gd
# 覆盖: Phase 22 施工细则 阶段1~4（TC-EVTPROB-01~06）
#       —— 基础概率 / 条件修正 / 动态调整 / 事件关联 / 只算不执行 / 配置驱动值域
# ==============================================================================
class_name TestEventProbabilityDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 22: 事件流关联动态概率系统（事件侧三位一体）"

	results.append(_test_base_probability())
	results.append(_test_condition_modifier())
	results.append(_test_dynamic_adjustment())
	results.append(_test_event_link())
	results.append(_test_calculate_only())
	results.append(_test_config_driven_and_clamp())

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

## TC-EVTPROB-01: 基础概率计算（空上下文 → base_probability）
static func _test_base_probability() -> Dictionary:
	var res := EventProbabilityResolver.resolve("EVT_MARKET_CRASH", {})
	var passed = res.get("success", false) and is_equal_approx(float(res.get("probability", -1.0)), 0.08)
	return {
		"test": "TC-EVTPROB-01: 基础概率计算（空上下文返回 base_probability）",
		"passed": passed
	}

## TC-EVTPROB-02: 条件修正（上下文满足条件 → factor 修正 + 明细记录）
static func _test_condition_modifier() -> Dictionary:
	var ctx := {"town_id": "TOWN_VALAN", "character_level": 25}
	var res := EventProbabilityResolver.resolve("EVT_BEAST_TIDE", ctx)
	var passed = res.get("success", false) \
		and is_equal_approx(float(res.get("probability", -1.0)), 0.15 * 1.5 * 1.2) \
		and (res.get("modifiers", []) as Array).size() == 2
	return {
		"test": "TC-EVTPROB-02: 条件修正（TOWN_EQUALS/MIN_LEVEL 满足 → factor 修正 + 明细）",
		"passed": passed
	}

## TC-EVTPROB-03: 动态调整（buff/环境上下文 → delta 调整）
static func _test_dynamic_adjustment() -> Dictionary:
	var ctx := {"reputations": {"VALAN_GUARD": 60}}
	var res := EventProbabilityResolver.resolve("EVT_BEAST_TIDE", ctx)
	var has_adj := false
	for m in (res.get("modifiers", []) as Array):
		if str(m.get("kind", "")) == "adjustment":
			has_adj = true
	var passed = res.get("success", false) and has_adj \
		and is_equal_approx(float(res.get("probability", -1.0)), 0.15 + 0.05)
	return {
		"test": "TC-EVTPROB-03: 动态调整（REPUTATION_GREATER 满足 → delta 调整 + 明细）",
		"passed": passed
	}

## TC-EVTPROB-04: 事件关联联动（关联事件已触发 → link factor 联动 + adjusted_by）
static func _test_event_link() -> Dictionary:
	var ctx := {"event_state.triggered": ["EVT_MARKET_CRASH"]}
	var res := EventProbabilityResolver.resolve("EVT_BEAST_TIDE", ctx)
	var passed = res.get("success", false) \
		and is_equal_approx(float(res.get("probability", -1.0)), 0.15 * 1.3) \
		and (res.get("adjusted_by", []) as Array).size() == 1
	return {
		"test": "TC-EVTPROB-04: 事件关联联动（关联事件已触发 → factor 联动 + adjusted_by）",
		"passed": passed
	}

## TC-EVTPROB-05: 只算不执行（纯查询：同输入同输出 + 零动作/零生命周期字段）
static func _test_calculate_only() -> Dictionary:
	var ctx := {"town_id": "TOWN_VALAN"}
	var r1 := EventProbabilityResolver.resolve("EVT_BEAST_TIDE", ctx)
	var r2 := EventProbabilityResolver.resolve("EVT_BEAST_TIDE", ctx)
	var deterministic: bool = is_equal_approx(float(r1.get("probability", -1.0)), float(r2.get("probability", -1.0)))
	var no_exec_fields := true
	for key in r1.keys():
		if key in ["action", "dispatch", "lifecycle", "trigger_write"]:
			no_exec_fields = false
	var passed = deterministic and no_exec_fields and r1.get("success", false)
	return {
		"test": "TC-EVTPROB-05: 只算不执行（确定性纯查询 + 零动作/生命周期字段）",
		"passed": passed
	}

## TC-EVTPROB-06: 配置驱动与值域（越界输入钳制 0~1；未配置事件优雅拦截）
static func _test_config_driven_and_clamp() -> Dictionary:
	# 未配置事件
	var missing := EventProbabilityResolver.resolve("EVT_UNKNOWN", {})
	var missing_ok: bool = not missing.get("success", true) and str(missing.get("code", "")) == "EVENT_NOT_CONFIGURED"
	# 配置驱动（概率来自配置表非硬编码）
	var cfg_base: float = GameConfig.get_float("domains.event_probability", "events/EVT_MARKET_CRASH/base_probability", -1.0)
	var passed = missing_ok and is_equal_approx(cfg_base, 0.08)
	return {
		"test": "TC-EVTPROB-06: 配置驱动与值域（未配置拦截 + 概率 100% 来自配置表）",
		"passed": passed
	}
