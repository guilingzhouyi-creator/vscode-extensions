# ==============================================================================
# 单元测试：领域 22 精英变异与地牢狂暴 (Elite Mutation Tests)
# 文件路径: res://tests/unit/domains/test_elite_mutation.gd
# ==============================================================================
class_name TestEliteMutationDomain extends RefCounted

static func test_backend_affix_roll() -> Dictionary:
	# Phase 40 GAP-04 算法主权（TC-GAP-S2-04/05 + TC-FINAL-AFFIX-01/03）
	var first = GenericAffixSolver.roll_random_affixes(3, 2, DeterministicRNG.from_seed(20260902))
	var second = GenericAffixSolver.roll_random_affixes(3, 2, DeterministicRNG.from_seed(20260902))
	var det_ok := first.size() == 2 and second.size() == 2 and first == second
	# 无 tier_99 池 → 回退 global 池且非空（TC-GAP-S2-05）
	var fallback = GenericAffixSolver.roll_random_affixes(99, 2, DeterministicRNG.from_seed(1))
	var fallback_ok := fallback.size() == 2
	# count 超池容量 → 截断为池大小，不崩溃
	var clamped = GenericAffixSolver.roll_random_affixes(3, 99, DeterministicRNG.from_seed(2))
	var clamp_ok := clamped.size() == 3
	var passed := det_ok and fallback_ok and clamp_ok
	return {"test": "TC-GAP-S2-04/05: 后端词缀加权滚动（同种子确定性 + tier 回退 global + 容量截断）", "passed": passed}

static func test_pick_weighted_zero_safe() -> Dictionary:
	# Phase 40 TC-GAP-S2-06 / TC-FINAL-AFFIX-06：权重 0 不入选；全零退化均匀；空池返回 null
	var rng := DeterministicRNG.from_seed(7)
	var mixed := [{"aff_id": "A", "weight": 0}, {"aff_id": "B", "weight": 10}, {"aff_id": "C", "weight": 0}]
	var only_b := true
	for i in range(30):
		var v = rng.pick_weighted(mixed, "weight")
		if v == null or not (v is Dictionary) or v.get("aff_id", "") != "B":
			only_b = false
			break
	var zero_pool := [{"aff_id": "A", "weight": 0}, {"aff_id": "B", "weight": 0}]
	var degraded = rng.pick_weighted(zero_pool, "weight")
	var degrade_ok := degraded != null and (degraded is Dictionary)
	var empty_ok := rng.pick_weighted([], "weight") == null
	var passed := only_b and degrade_ok and empty_ok
	return {"test": "TC-GAP-S2-06/TC-FINAL-AFFIX-06: pick_weighted 零权重排除/退化/空池安全", "passed": passed}

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_elite_affix_application())
	results.append(test_generic_berserk_trigger())
	results.append(test_backend_affix_roll())
	results.append(test_pick_weighted_zero_safe())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 22: 精英变异与地牢狂暴", "all_passed": all_passed, "results": results }

static func test_elite_affix_application() -> Dictionary:
	var monster := EliteMonsterAggregate.new()
	var base_str = float(monster.physiology.base_coefficients.get("STR", 1.0))
	monster.apply_affixes(["VAMPIRIC", "SWIFT"])

	# VAMPIRIC 增强 str 1.25x（L2 系数修正：等级不变、底层实际值联动）, SWIFT 增强 agi 1.5x
	var passed = is_equal_approx(float(monster.physiology.base_coefficients.get("STR", 1.0)), base_str * 1.25) \
		and (monster.elite_affix_ids.size() == 2)
	return { "test": "TC-ELITE-01: 精英多重词缀动态注入与 L2 系数修正", "passed": passed }

static func test_generic_berserk_trigger() -> Dictionary:
	var monster := EliteMonsterAggregate.new()
	var triggered = GenericBerserkFSM.check_and_trigger_berserk(monster, 20.0, 100.0, 10) # 20% <= 30%
	var passed = triggered and monster.is_berserk and (monster.rage_level == 100.0)
	return { "test": "TC-ELITE-02: 低血线阈值通用狂暴状态机激怒", "passed": passed }
