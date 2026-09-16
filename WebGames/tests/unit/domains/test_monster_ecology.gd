# ==============================================================================
# 单元测试：领域 8 怪物生态与多部位破坏 (Monster Ecology Tests)
# 文件路径: res://tests/unit/domains/test_monster_ecology.gd
# ==============================================================================
class_name TestMonsterDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_monster_isomorphic_structure())
	results.append(test_part_destruction_and_ap_penalty())
	results.append(test_devour_evolution_and_overload())
	results.append(test_monster_ap_ai_decision())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 08: 怪物生态与多部位破坏", "all_passed": all_passed, "results": results }

static func test_monster_isomorphic_structure() -> Dictionary:
	var m := MonsterAggregateEntity.new()
	m.monster_id = "DRAGON_01"
	var p_wing := MonsterAggregateEntity.MonsterBodyPart.new()
	p_wing.part_id = "WING"
	p_wing.durability_max = 50.0
	p_wing.durability_current = 50.0
	p_wing.ap_penalty_on_break = 3
	m.body_parts["WING"] = p_wing

	var passed = (m.physiology.get_level("STR") == 3) and m.body_parts.has("WING")
	return { "test": "TC-MON-01: 怪物微观生理同构（统一等级底座）与部位结构挂载", "passed": passed }

static func test_part_destruction_and_ap_penalty() -> Dictionary:
	var m := MonsterAggregateEntity.new()
	var p_wing := MonsterAggregateEntity.MonsterBodyPart.new()
	p_wing.part_id = "WING"
	p_wing.durability_current = 30.0
	p_wing.durability_max = 30.0
	p_wing.ap_penalty_on_break = 3
	m.body_parts["WING"] = p_wing

	var res = MonsterEcologySolver.apply_part_damage(m, "WING", 40.0)
	var passed = res.broken and (res.ap_penalty == 3) and (m.body_parts["WING"].is_severed)
	return { "test": "TC-MON-02: 龙翼破坏与独立AP惩罚判定", "passed": passed, "res": res }

static func test_devour_evolution_and_overload() -> Dictionary:
	var m := MonsterAggregateEntity.new()
	m.physiology.set_level("CON", 3) # 统一等级：实际容纳上限 = 换算值 × 倍率
	var normal_evo = MonsterEcologySolver.evaluate_devour_evolution(m, 50.0, "FLAME_CORE")
	# 首次进化后 CON 升至 4 级（阈值 >607）：1000 远超阈值触发过载爆体
	var overload_evo = MonsterEcologySolver.evaluate_devour_evolution(m, 1000.0, "VOID_CORE")
	var passed = normal_evo.success and not overload_evo.success and (overload_evo.status == "OVERLOAD_EXPLOSION")
	return { "test": "TC-MON-03: 异兽基因同化与过载爆体律断言", "passed": passed, "evo": normal_evo }

static func test_monster_ap_ai_decision() -> Dictionary:
	var m := MonsterAggregateEntity.new()
	var act_neg = SwarmResonanceAndAIFSM.evaluate_monster_ai_action(m, -4)
	var act_pos = SwarmResonanceAndAIFSM.evaluate_monster_ai_action(m, 2)
	var passed = (act_neg == "BLOCK") and (act_pos == "SLASH")
	return { "test": "TC-MON-04: 负AP状态下AI自适应防守发卡决策", "passed": passed, "neg": act_neg, "pos": act_pos }
