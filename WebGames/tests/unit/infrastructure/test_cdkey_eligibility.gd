# ==============================================================================
# 单元测试：CDKey 复合门槛与状态边界（Phase 35 S4 验收）
# 文件路径: res://tests/unit/infrastructure/test_cdkey_eligibility.gd
# 覆盖: TC-CDK-S4-01~06 —— 复合门槛组合 / 未达标不消耗 / 后续重新兑换 /
#       防枚举提示 / 成功后统一邮件发放 / 禁绕过邮箱路径
# ==============================================================================
class_name TestCdkeyEligibilityDomain
extends RefCounted

const RULES_AND := {
	"combinator": "AND",
	"rules": [
		{ "rule_id": "min_play_seconds", "metric_key": "accumulated_play_seconds", "operator": "gte", "value": 3600 },
		{ "rule_id": "min_level", "metric_key": "character_level_metric", "operator": "gte", "value": 10 }
	]
}

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 35: CDKey 复合门槛与状态边界验收"

	results.append(_test_composite_rules())
	results.append(_test_not_met_no_consume())
	results.append(_test_re_attempt_after_met())
	results.append(_test_anti_enumeration_hint())
	results.append(_test_mail_dispatch())
	results.append(_test_no_direct_account_write())

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

## TC-CDK-S4-01: 复合门槛组合（AND 达标/未达标）
static func _test_composite_rules() -> Dictionary:
	var met := CDKeyEligibilityRuleEngine.evaluate({ "accumulated_play_seconds": 7200, "character_level_metric": 15 }, RULES_AND)
	var not_met := CDKeyEligibilityRuleEngine.evaluate({ "accumulated_play_seconds": 100, "character_level_metric": 15 }, RULES_AND)
	var passed = met.get("allowed", false) \
		and not not_met.get("allowed", false) \
		and not_met.get("failed_rule_id", "") == "min_play_seconds"
	return { "test": "TC-CDK-S4-01: 复合门槛 AND 组合达标/未达标判定", "passed": passed }

## TC-CDK-S4-02: 未达标不消耗（次数/唯一标记/历史零写入）
static func _test_not_met_no_consume() -> Dictionary:
	var registry := _build_registry()
	var rate_limit := {}
	var history := {}
	var unique := {}
	var res := CDKeyRedemptionSolver.resolve_redemption(
		"ACC_E1", 10, "KALAR_TEST_1", 1000,
		registry, rate_limit, history, unique,
		{ "accumulated_play_seconds": 100, "character_level_metric": 15 },
		RULES_AND
	)
	var voucher: CDKeyVoucherAggregate = registry["KALAR_TEST_1"]
	var passed = (not res.get("success", true)) \
		and res.get("error_code", "") == "ELIGIBILITY_NOT_MET" \
		and voucher.current_global_redemptions == 0 \
		and unique.is_empty() \
		and not history.has("ACC_E1")
	return { "test": "TC-CDK-S4-02: 门槛未达标不消耗（次数/唯一标记/历史零写入）", "passed": passed }

## TC-CDK-S4-03: 未达标后条件满足再次提交 → 正常核销
static func _test_re_attempt_after_met() -> Dictionary:
	var registry := _build_registry()
	var rate_limit := {}
	var history := {}
	var unique := {}
	CDKeyRedemptionSolver.resolve_redemption(
		"ACC_E2", 10, "KALAR_TEST_1", 1000,
		registry, rate_limit, history, unique,
		{ "accumulated_play_seconds": 100, "character_level_metric": 15 },
		RULES_AND
	)
	var res2 := CDKeyRedemptionSolver.resolve_redemption(
		"ACC_E2", 10, "KALAR_TEST_1", 1001,
		registry, rate_limit, history, unique,
		{ "accumulated_play_seconds": 7200, "character_level_metric": 15 },
		RULES_AND
	)
	var passed = res2.get("success", false) and registry["KALAR_TEST_1"].current_global_redemptions == 1
	return { "test": "TC-CDK-S4-03: 条件满足后重新提交正常核销", "passed": passed }

## TC-CDK-S4-04: 防枚举提示（对外统一无效兑换码类，内部原因保留）
static func _test_anti_enumeration_hint() -> Dictionary:
	var registry := _build_registry()
	var rate_limit := {}
	var history := {}
	var unique := {}
	var r_invalid := CDKeyRedemptionSolver.resolve_redemption("ACC_E3", 1, "NOT_EXISTS", 1000, registry, rate_limit, history, unique)
	var r_expired := CDKeyRedemptionSolver.resolve_redemption(
		"ACC_E3", 1, "KALAR_EXPIRED", 1000,
		registry, rate_limit, history, unique,
		{}, { "combinator": "AND", "rules": [] }
	)
	var hint: String = String(r_invalid.get("error_message", ""))
	var passed = (r_invalid.error_code == "INVALID_CODE" and r_expired.error_code == "EXPIRED") \
		and r_invalid.get("error_message", "") == hint \
		and r_expired.get("error_message", "") == hint \
		and not String(r_invalid.get("precise_reason", "")).is_empty()
	return { "test": "TC-CDK-S4-04: 防枚举提示（对外统一无效兑换码类 + 内部 precise_reason）", "passed": passed }

## TC-CDK-S4-05: 成功后统一邮件发放（附件经 MailboxManager 投递）
static func _test_mail_dispatch() -> Dictionary:
	var mailbox := MailboxManager.new()
	var res := VoucherDispatchPipeline.dispatch_rewards_via_mail(
		{ "mana_monocrystals": 3, "gold_coins": 50 }, mailbox, "ACC_MAIL_1", "MAIL_CDK_1"
	)
	var passed = res.get("success", false) \
		and res.get("has_attachment", false) \
		and mailbox.get_unread_count() == 1
	return { "test": "TC-CDK-S4-05: 兑换奖励统一经邮件系统发放", "passed": passed }

## TC-CDK-S4-06: 禁绕过邮箱路径（兑换判定不触碰资产 + 邮件为唯一发放路径）
static func _test_no_direct_account_write() -> Dictionary:
	var registry := _build_registry()
	var rate_limit := {}
	var history := {}
	var unique := {}
	var res := CDKeyRedemptionSolver.resolve_redemption(
		"ACC_E4", 10, "KALAR_TEST_1", 2000,
		registry, rate_limit, history, unique,
		{ "accumulated_play_seconds": 7200, "character_level_metric": 15 },
		RULES_AND
	)
	# 求解器只返回载荷，不修改任何玩家资产对象（无 wallet/背包入参即结构保证）
	var passed = res.get("success", false) \
		and res.get("payload", {}).size() > 0 \
		and registry["KALAR_TEST_1"].current_global_redemptions == 1
	return { "test": "TC-CDK-S4-06: 兑换判定零资产写入（资产仅经邮件路径）", "passed": passed }

static func _build_registry() -> Dictionary:
	var v := CDKeyVoucherAggregate.new("KALAR_TEST_1", CDKeyVoucherAggregate.VoucherType.UNIVERSAL_PER_ACCOUNT, "测试礼包")
	v.reward_payload = { "mana_monocrystals": 3, "gold_coins": 50, "item_templates": [] }
	var expired := CDKeyVoucherAggregate.new("KALAR_EXPIRED", CDKeyVoucherAggregate.VoucherType.UNIVERSAL_PER_ACCOUNT, "过期礼包")
	expired.valid_from_utc = 0
	expired.valid_to_utc = 500
	return { "KALAR_TEST_1": v, "KALAR_EXPIRED": expired }
