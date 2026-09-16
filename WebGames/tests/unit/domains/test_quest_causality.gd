# ==============================================================================
# 单元测试：领域 9 任务系统与因果事件链 (Quest Causality Tests)
# 文件路径: res://tests/unit/domains/test_quest_causality.gd
# ==============================================================================
class_name TestQuestDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_quest_dag_structure())
	results.append(test_stealth_branch_resolution())
	results.append(test_faction_reputation_and_bounty())
	results.append(test_quest_item_reward_dispatch())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 09: 任务系统与因果事件链", "all_passed": all_passed, "results": results }

static func test_quest_dag_structure() -> Dictionary:
	var quest := QuestObjectiveNode.QuestCausalityAggregate.new()
	quest.quest_id = "QUEST_ARTIFACT"

	var n_combat := QuestObjectiveNode.new()
	n_combat.node_id = "KILL_BOSS"
	n_combat.solution_type = "COMBAT_FORCE"
	n_combat.target_state_key = "boss_alive"
	n_combat.required_value = false

	var n_stealth := QuestObjectiveNode.new()
	n_stealth.node_id = "STEAL_KEY"
	n_stealth.solution_type = "STEALTH_THEFT"
	n_stealth.target_state_key = "has_key"
	n_stealth.required_value = true

	quest.objective_nodes = { "KILL_BOSS": n_combat, "STEAL_KEY": n_stealth }
	quest.solution_paths = [["KILL_BOSS"], ["STEAL_KEY"]]

	var passed = (quest.objective_nodes.size() == 2) and (quest.solution_paths.size() == 2)
	return { "test": "TC-QST-01: 任务因果DAG多手段分支结构定义", "passed": passed }

static func test_stealth_branch_resolution() -> Dictionary:
	var quest := QuestObjectiveNode.QuestCausalityAggregate.new()
	var n_combat := QuestObjectiveNode.new()
	n_combat.node_id = "KILL_BOSS"
	n_combat.solution_type = "COMBAT_FORCE"
	n_combat.target_state_key = "boss_alive"
	n_combat.required_value = false

	var n_stealth := QuestObjectiveNode.new()
	n_stealth.node_id = "STEAL_KEY"
	n_stealth.solution_type = "STEALTH_THEFT"
	n_stealth.target_state_key = "has_key"
	n_stealth.required_value = true

	quest.objective_nodes = { "KILL_BOSS": n_combat, "STEAL_KEY": n_stealth }
	quest.solution_paths = [["KILL_BOSS"], ["STEAL_KEY"]]

	var world_facts := { "boss_alive": true, "has_key": true } # 隐匿成功，BOSS未击杀
	var res = CausalityDAGSolver.evaluate_quest_completion(quest, world_facts)
	var passed = res.is_completed and (res.solution_type == "STEALTH_THEFT")
	return { "test": "TC-QST-02: 隐匿潜行偷取分支非暴力达成断言", "passed": passed, "type": res.solution_type }

static func test_faction_reputation_and_bounty() -> Dictionary:
	var quest := QuestObjectiveNode.QuestCausalityAggregate.new()
	quest.quest_title = "劫掠帝国运粮队"
	quest.faction_reputation_rewards = { "EMPIRE": -60, "REBELS": 50 }
	var cur_rep := { "EMPIRE": 0, "REBELS": 0 }

	var res = FactionBountyAndCausalityFSM.apply_quest_settlement("PLAYER_01", quest, cur_rep)
	var passed = (cur_rep["EMPIRE"] == -60) and res.bounty_triggered
	return { "test": "TC-QST-03: 阵营好感撕裂与恶名通缉状态机跃迁", "passed": passed, "bounty": res.bounty_triggered }

static func test_quest_item_reward_dispatch() -> Dictionary:
	var catalog := ItemRegistryCatalog.new()
	var proto = ItemRegistryCatalog.ItemPrototypeTemplate.new(
		"KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 1, "item.mithril.name",
		"EQUIPMENT", "WEAPON_BLADE", 1, 1.5, 2, 100, [], "mithril_longsword"
	)
	ItemRegistrySolver.register_prototype(catalog, proto)
	var inventory := WearableInventoryAggregate.new()
	inventory.baseline_capacity = 4 # 裸身容量 0 是设计约束，测试装配须显式给容量
	var ok_res := QuestRewardDispatch.dispatch_item_rewards([{"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "count": 1}], catalog, inventory)
	var bad_res := QuestRewardDispatch.dispatch_item_rewards([{"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:NOPE", "count": 1}], catalog, inventory)
	var passed: bool = ok_res.success and ok_res.granted == 1 and inventory.storage_items.size() == 1 \
		and inventory.storage_items[0].item_uid.begins_with("QST_") \
		and (not bad_res.success) and bad_res.error_code == "ITEM_NOT_REGISTERED"
	return {"test": "TC-P11-QST-01: 任务奖励统一事实源闭环（已登记+UID 前缀 QST_，未登记拒入账）", "passed": passed}
