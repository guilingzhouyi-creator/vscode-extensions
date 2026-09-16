# ==============================================================================
# 单元测试：领域 13 身份爵位与主权建国 (Sovereignty & Realm Tests)
# 文件路径: res://tests/unit/domains/test_sovereignty_realm.gd
# ==============================================================================
class_name TestSovereigntyDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_nation_realm_entity())
	results.append(test_knighthood_promotion_solver())
	results.append(test_sovereignty_founding_and_palace_coup())
	results.append(test_stability_monotonic_no_rise())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 13: 身份爵位与主权建国", "all_passed": all_passed, "results": results }

static func test_nation_realm_entity() -> Dictionary:
	var nation := KnighthoodTitle.NationRealmAggregate.new()
	nation.nation_id = "NATION_EMPIRE"
	var s = nation.serialize()
	var passed = (s.nation_id == "NATION_EMPIRE") and (nation.stability_percent == 85.0)
	return { "test": "TC-SOV-01: 动态主权国家聚合实体构造", "passed": passed }

static func test_knighthood_promotion_solver() -> Dictionary:
	var title_knight = SovereigntyAndFeoffmentSolver.evaluate_knighthood_promotion(60.0, 150.0)
	var title_duke = SovereigntyAndFeoffmentSolver.evaluate_knighthood_promotion(6000.0, 15000.0)
	var passed = (title_knight == KnighthoodTitle.TitleRank.KNIGHT) and (title_duke == KnighthoodTitle.TitleRank.DUKE)
	return { "test": "TC-SOV-02: 战功与声望驱动男爵/公爵爵位动态晋升", "passed": passed, "knight": title_knight, "duke": title_duke }

static func test_sovereignty_founding_and_palace_coup() -> Dictionary:
	var new_nation = NationSovereigntyAndCoupFSM.establish_new_sovereign_nation("PLAYER_01", "自由联邦", ["TOWN_1", "TOWN_2"])
	var coup_res = NationSovereigntyAndCoupFSM.execute_palace_coup(new_nation, "USURPER_01", 1.0)
	var passed = (new_nation.territory_town_ids.size() == 2) and coup_res.success and (new_nation.sovereign_ruler_id == "USURPER_01")
	return { "test": "TC-SOV-03: 荒原建国与宫廷政变全域蝴蝶效应震荡", "passed": passed, "coup": coup_res }

static func test_stability_monotonic_no_rise() -> Dictionary:
	# M7（Phase 53）：政变稳定性单调不升（Inv-ON-3）——
	# 红证：旧 max(floor, cur-drop) 使低于下限的稳定性被失败政变抬升（20 → 40）
	var low := KnighthoodTitle.NationRealmAggregate.new()
	low.stability_percent = 20.0 # 低于 failure_floor=40
	NationSovereigntyAndCoupFSM.execute_palace_coup(low, "USURPER", 0.0) # 必失败
	var low_ok = is_equal_approx(low.stability_percent, 20.0) # 不抬升

	var high := KnighthoodTitle.NationRealmAggregate.new()
	high.stability_percent = 60.0
	NationSovereigntyAndCoupFSM.execute_palace_coup(high, "USURPER", 0.0)
	var high_ok = is_equal_approx(high.stability_percent, 45.0) # 60-15 正常下跌

	var suc := KnighthoodTitle.NationRealmAggregate.new()
	suc.stability_percent = 100.0
	NationSovereigntyAndCoupFSM.execute_palace_coup(suc, "USURPER", 1.0) # 必成功
	var suc_ok = is_equal_approx(suc.stability_percent, 65.0) # 100-35 正常下跌

	var passed = low_ok and high_ok and suc_ok
	return { "test": "TC-SOV-04: 政变稳定性单调不升（M7：低于下限不抬升、跌幅止于下限）", "passed": passed }
