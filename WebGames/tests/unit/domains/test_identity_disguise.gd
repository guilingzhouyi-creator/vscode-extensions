# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 29 身份与假名系统单元测试
# 文件路径: res://tests/unit/domains/test_identity_disguise.gd
# ==============================================================================
class_name TestIdentityDisguiseDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 29: 角色同名身份与假名伪装欺诈系统"

	results.append(_test_non_unique_names_and_uuid_integrity())
	results.append(_test_alias_reputation_isolation())
	results.append(_test_unmask_exposure_causal_merge())
	# Phase 53 M6 新增：败露锁存幂等 + 搬运归零 + 记账路由
	results.append(_test_repeat_exposure_idempotent_and_routing())

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

static func _test_non_unique_names_and_uuid_integrity() -> Dictionary:
	# 允许同名同姓的两个独立角色
	var char1 := CharacterIdentityAggregate.new("UUID_0001", "亚瑟·潘德拉贡")
	var char2 := CharacterIdentityAggregate.new("UUID_0002", "亚瑟·潘德拉贡")

	var passed = (char1.true_canonical_name == char2.true_canonical_name) and (char1.character_uuid != char2.character_uuid)
	return {
		"test": "TC-ID-01: 非唯一同名自由与底层不可变 UUID 物理自洽",
		"passed": passed
	}

static func _test_alias_reputation_isolation() -> Dictionary:
	var actor := CharacterIdentityAggregate.new("UUID_ACTOR_01", "纯良农夫亚瑟")
	actor.add_alias_mask("ALIAS_CROW", "无名黑鸦刺客", 80.0)
	actor.equip_alias("ALIAS_CROW")

	# 穿戴假名下作恶通缉 5000 金币
	IdentityExposurePipeline.record_deed(actor, 0, 5000)

	# 常态下真身恶名仍为 0，对外显示为假名
	var passed = (actor.get_current_public_display_name() == "无名黑鸦刺客") and (actor.base_true_infamy_bounty == 0) and (actor.alias_slots["ALIAS_CROW"].accumulated_infamy_bounty == 5000)
	return {
		"test": "TC-ID-02: 假名面具下的声望恶名完全隔离",
		"passed": passed
	}

static func _test_unmask_exposure_causal_merge() -> Dictionary:
	var actor := CharacterIdentityAggregate.new("UUID_ACTOR_02", "知名骑士加文")
	actor.add_alias_mask("ALIAS_BANDIT", "夜行大盗", 40.0)
	actor.equip_alias("ALIAS_BANDIT")
	IdentityExposurePipeline.record_deed(actor, 0, 8000)

	# 洞察力大成功看穿真身
	var exposed = IdentityDeceptionSolver.evaluate_insight_check(50.0, 10.0, 40.0, 20.0)
	var merge_res = IdentityExposurePipeline.trigger_unmask_exposure(actor, "ALIAS_BANDIT")

	var passed = exposed and merge_res.success and (actor.base_true_infamy_bounty == 8000) and (actor.get_current_public_display_name() == "知名骑士加文")
	return {
		"test": "TC-ID-03: 假名当场败露与恶名赏金 100% 穿透合并回真身",
		"passed": passed
	}

## M6（Phase 53）：败露锁存 + 搬运归零 + 已败露记账路由——
## 重复曝光幂等返回（0 搬运）、源字段清零、败露后 re-equip 的 record_deed 直记真身（红证：修复前二次曝光 double-count）
static func _test_repeat_exposure_idempotent_and_routing() -> Dictionary:
	var actor := CharacterIdentityAggregate.new("UUID_ACTOR_M6", "隐修士兰斯")
	actor.add_alias_mask("ALIAS_SPY", "间谍黑鸦", 60.0)
	actor.equip_alias("ALIAS_SPY")
	IdentityExposurePipeline.record_deed(actor, 0, 7000)
	IdentityExposurePipeline.record_deed(actor, 10, 0)

	var first := IdentityExposurePipeline.trigger_unmask_exposure(actor, "ALIAS_SPY")
	var second := IdentityExposurePipeline.trigger_unmask_exposure(actor, "ALIAS_SPY")

	var profile = actor.alias_slots["ALIAS_SPY"]
	# 败露后重新穿戴该假名再记账 → 守卫直记真身（alias 不累积）
	actor.equip_alias("ALIAS_SPY")
	IdentityExposurePipeline.record_deed(actor, 0, 300)

	var passed = first.success and first.error_code == "OK" \
		and second.success and second.error_code == "ALREADY_COMPROMISED" \
		and second.transferred_infamy_bounty == 0 \
		and actor.base_true_infamy_bounty == 7300 \
		and actor.base_true_reputation == 10 \
		and profile.is_compromised \
		and profile.accumulated_infamy_bounty == 0 and profile.accumulated_reputation == 0
	return {
		"test": "TC-ID-04: 败露锁存幂等与归零路由（M6：重复曝光零搬运、已败露记账直记真身）",
		"passed": passed
	}
