# ==============================================================================
# 单元测试：领域 12 NPC 智能生命与自主演化 (NPC Simulation Tests)
# 文件路径: res://tests/unit/domains/test_npc_simulation.gd
# ==============================================================================
class_name TestNPCDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_npc_isomorphic_structure())
	results.append(test_npc_goap_planner())
	results.append(test_npc_demise_and_legacy())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 12: NPC智能生命与自主演化", "all_passed": all_passed, "results": results }

static func test_npc_isomorphic_structure() -> Dictionary:
	var npc := AutonomousNPCEntity.new()
	npc.npc_id = "NPC_ELDER_01"
	npc.personal_name = "老法师甘道夫"
	var passed = (npc.physiology != null) and (npc.wallet != null) and npc.personality.has("courage")
	return { "test": "TC-NPC-01: NPC全域100%同构底座与五维性格矩阵", "passed": passed }

static func test_npc_goap_planner() -> Dictionary:
	var npc := AutonomousNPCEntity.new()
	npc.personality = { "courage": 0.2, "greed": 0.1, "rationality": 0.9, "piety": 0.8 }
	var goal = NPCAIAndEvolutionSolver.plan_npc_next_goal(npc)
	var passed = (goal == "CULTIVATE_MAGIC")
	return { "test": "TC-NPC-02: GOAP目标规划器自发驱动修炼行为", "passed": passed, "goal": goal }

static func test_npc_demise_and_legacy() -> Dictionary:
	var master := AutonomousNPCEntity.new()
	master.npc_id = "MASTER_TEST_1"
	master.personal_name = "无极剑圣"
	master.wallet.gold = 500
	var disciple := AutonomousNPCEntity.new()
	disciple.personal_name = "青年剑客"

	var res = NPCLifeCycleAndLegacyFSM.process_npc_natural_demise(master, disciple)
	var passed = (disciple.wallet.gold == 500) and (res.legacy_book != null)
	return { "test": "TC-NPC-03: 寿元大限著书立说与衣钵交接流水线", "passed": passed, "gold": disciple.wallet.gold }
