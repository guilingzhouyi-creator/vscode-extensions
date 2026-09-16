# ==============================================================================
# 单元测试：配置驱动与规则执行体系（Phase 36 S4 验收）
# 文件路径: res://tests/unit/infrastructure/test_rule_scope.gd
# 覆盖: TC-RULE-S4-01~05 —— 作用域覆盖 / 组合 negate / 运行时注入无残留 /
#       非法配置受控失败 / 无规则默认允许
# ==============================================================================
class_name TestRuleScopeDomain
extends RefCounted

const GLOBAL_RULES := {
	"combinator": "AND",
	"rules": [
		{ "rule_id": "min_play_seconds", "metric_key": "accumulated_play_seconds", "operator": "gte", "value": 3600 },
		{ "rule_id": "min_level", "metric_key": "character_level_metric", "operator": "gte", "value": 5 }
	]
}

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 36: 配置驱动与规则执行体系验收"

	results.append(_test_scope_override())
	results.append(_test_negate_rule())
	results.append(_test_runtime_metrics_no_residue())
	results.append(_test_invalid_rule_rejected())
	results.append(_test_no_rules_default_allowed())

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

## TC-RULE-S4-01: 作用域覆盖（兑换码级覆盖全局同 rule_id）
static func _test_scope_override() -> Dictionary:
	var voucher_rules := {
		"combinator": "AND",
		"rules": [
			{ "rule_id": "min_level", "metric_key": "character_level_metric", "operator": "gte", "value": 50 }
		]
	}
	var merged := CDKeyEligibilityRuleEngine.merge_rules(GLOBAL_RULES, voucher_rules)
	# 同 rule_id（min_level）被兑换码级覆盖为 50；min_play_seconds 保留全局
	var count: int = int(merged.get("rules", []).size())
	var passed = count == 2 \
		and CDKeyEligibilityRuleEngine.evaluate(
			{ "accumulated_play_seconds": 7200, "character_level_metric": 30 }, merged
		).get("allowed", false) == false \
		and CDKeyEligibilityRuleEngine.evaluate(
			{ "accumulated_play_seconds": 7200, "character_level_metric": 60 }, merged
		).get("allowed", false) == true
	return { "test": "TC-RULE-S4-01: 兑换码级规则按 rule_id 覆盖全局（作用域合并）", "passed": passed }

## TC-RULE-S4-02: negate（NOT 单规则取反）
static func _test_negate_rule() -> Dictionary:
	var rules := {
		"combinator": "AND",
		"rules": [
			{ "rule_id": "not_vip_only", "metric_key": "is_vip", "operator": "eq", "value": true, "negate": true }
		]
	}
	var not_vip: bool = bool(CDKeyEligibilityRuleEngine.evaluate({ "is_vip": false }, rules).get("allowed", false))
	var vip: bool = bool(CDKeyEligibilityRuleEngine.evaluate({ "is_vip": true }, rules).get("allowed", false))
	var passed = not_vip == true and vip == false
	return { "test": "TC-RULE-S4-02: negate 单规则取反（NOT 语义）", "passed": passed }

## TC-RULE-S4-03: 运行时指标注入无跨次残留（纯函数）
static func _test_runtime_metrics_no_residue() -> Dictionary:
	var r1 := CDKeyEligibilityRuleEngine.evaluate({ "accumulated_play_seconds": 100 }, GLOBAL_RULES)
	var r2 := CDKeyEligibilityRuleEngine.evaluate({ "accumulated_play_seconds": 7200, "character_level_metric": 10 }, GLOBAL_RULES)
	var r3 := CDKeyEligibilityRuleEngine.evaluate({ "accumulated_play_seconds": 7200, "character_level_metric": 10 }, GLOBAL_RULES)
	var passed = (not r1.get("allowed", true)) and r2.get("allowed", false) \
		and String(r2.get("failed_rule_id", "x")) == "" and String(r3.get("failed_rule_id", "y")) == ""
	return { "test": "TC-RULE-S4-03: 运行时指标注入纯函数无跨次残留（两次同输入同结果）", "passed": passed }

## TC-RULE-S4-04: 非法规则配置受控失败（未知 operator/缺指标）
static func _test_invalid_rule_rejected() -> Dictionary:
	var bad_operator := CDKeyEligibilityRuleEngine.evaluate(
		{ "m": 1 },
		{ "combinator": "AND", "rules": [{ "rule_id": "r1", "metric_key": "m", "operator": "evil", "value": 0 }] }
	)
	var missing_metric := CDKeyEligibilityRuleEngine.evaluate(
		{},
		{ "combinator": "AND", "rules": [{ "rule_id": "r2", "metric_key": "not_provided", "operator": "gte", "value": 1 }] }
	)
	var passed = (not bad_operator.get("allowed", true)) and (not missing_metric.get("allowed", true))
	return { "test": "TC-RULE-S4-04: 非法规则/缺指标受控判定失败", "passed": passed }

## TC-RULE-S5-05: 无规则配置默认允许
static func _test_no_rules_default_allowed() -> Dictionary:
	var empty := CDKeyEligibilityRuleEngine.evaluate({}, { "combinator": "AND", "rules": [] })
	var no_rules := CDKeyEligibilityRuleEngine.evaluate({}, {})
	var passed = empty.get("allowed", false) and no_rules.get("allowed", false)
	return { "test": "TC-RULE-S4-05: 无规则配置默认允许（显式默认行为）", "passed": passed }
