# ==============================================================================
# 单元测试：任务世界与事件生命周期（Phase 32 S4 验收——覆盖 S2 已实现边界校验）
# 文件路径: res://tests/unit/infrastructure/test_task_world_event.gd
# 覆盖: TC-TWE-S4-01/02/03/04/06/07/08 —— 任务图结构校验 / 行军边界与零副作用 /
#       重复传承幂等 / 回放非法输入整批拒绝 / 多段事件名解析 / 旧档时间字段归一化
# ==============================================================================
class_name TestTaskWorldEventDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 32: 任务世界与事件生命周期验收"

	results.append(_test_quest_graph_invalid())
	results.append(_test_march_boundary_no_side_effect())
	results.append(_test_march_legal_step())
	results.append(_test_npc_legacy_idempotent())
	results.append(_test_replay_invalid_input())
	results.append(_test_event_channel_multi_segment())
	results.append(_test_world_time_normalize())

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

## TC-TWE-S4-01: 任务图结构校验（空路径 → QUEST_GRAPH_INVALID，完成标记不变）
static func _test_quest_graph_invalid() -> Dictionary:
	var quest := QuestObjectiveNode.QuestCausalityAggregate.new()
	quest.quest_id = "TWE_QUEST_1"
	var node := QuestObjectiveNode.new()
	node.target_state_key = "state.beast_slain"
	node.required_value = true
	node.solution_type = "COMBAT_FORCE"
	quest.objective_nodes["N1"] = node
	quest.solution_paths = [[]]   # 空路径不得视为成功
	var res := CausalityDAGSolver.evaluate_quest_completion(quest, { "state.beast_slain": true })
	var passed = res.get("code", "") == "QUEST_GRAPH_INVALID" and not quest.is_quest_finished
	return { "test": "TC-TWE-S4-01: 任务图空路径拒绝（QUEST_GRAPH_INVALID，完成标记不变）", "passed": passed }

## TC-TWE-S4-02: 行军边界（空 party → EMPTY_PARTY；负距离 → NEGATIVE_DISTANCE；零副作用）
static func _test_march_boundary_no_side_effect() -> Dictionary:
	var empty_party := WorldTravelAndSettlementFSM.MarchingParty.new()
	var dest := WorldMapGraphNode.new()
	dest.node_id = "ZONE_A"
	dest.terrain_type = "PLAINS"
	var r1 := WorldTravelAndSettlementFSM.execute_marching_step(empty_party, dest, 10.0)
	var empty_ok: bool = r1.get("code", "") == "EMPTY_PARTY" and empty_party.current_node_id.is_empty()

	var party := WorldTravelAndSettlementFSM.MarchingParty.new()
	party.party_id = "TWE_PARTY_1"
	party.ration_units = 50.0
	var r2 := WorldTravelAndSettlementFSM.execute_marching_step(party, dest, -5.0)
	var neg_ok: bool = r2.get("code", "") == "NEGATIVE_DISTANCE" \
		and party.current_node_id.is_empty() and party.ration_units == 50.0
	return { "test": "TC-TWE-S4-02: 行军边界拒绝（EMPTY_PARTY/NEGATIVE_DISTANCE，无副作用）", "passed": empty_ok and neg_ok }

## TC-TWE-S4-03: 行军合法路径（success + code 空 + 状态提交）
static func _test_march_legal_step() -> Dictionary:
	var party := WorldTravelAndSettlementFSM.MarchingParty.new()
	party.party_id = "TWE_PARTY_2"
	party.ration_units = 50.0
	var dest := WorldMapGraphNode.new()
	dest.node_id = "ZONE_B"
	dest.terrain_type = "PLAINS"
	var res := WorldTravelAndSettlementFSM.execute_marching_step(party, dest, 20.0)
	var passed = res.get("success", false) and res.get("code", "x") == "" \
		and party.current_node_id == "ZONE_B" and res.get("travel_hours", 0) > 0
	return { "test": "TC-TWE-S4-03: 行军合法路径提交（success/code 空/节点推进）", "passed": passed }

## TC-TWE-S4-04: 重复 NPC 传承幂等（来源 NPC 仅成功提交一次）
static func _test_npc_legacy_idempotent() -> Dictionary:
	var master := AutonomousNPCEntity.new()
	master.npc_id = "TWE_MASTER_1"
	master.personal_name = "传承师"
	master.wallet.gold = 300
	var disciple := AutonomousNPCEntity.new()
	disciple.personal_name = "传人"
	var first := NPCLifeCycleAndLegacyFSM.process_npc_natural_demise(master, disciple)
	var second := NPCLifeCycleAndLegacyFSM.process_npc_natural_demise(master, disciple)
	var passed = first.get("success", false) and second.get("code", "") == "LEGACY_ALREADY_COMMITTED"
	return { "test": "TC-TWE-S4-04: 重复传承幂等（第二次 LEGACY_ALREADY_COMMITTED）", "passed": passed }

## TC-TWE-S4-06: 回放非法输入整批拒绝（未登记 action → REPLAY_INPUT_INVALID）
static func _test_replay_invalid_input() -> Dictionary:
	var snaps: Array = []
	var sp := DeterministicInputSnapshot.new()
	sp.tick = 0
	sp.action_command = "NOT_A_REAL_VERB"
	sp.rng_seed = 1000
	snaps.append(sp)
	var res := DeterministicReplayEngine.simulate_replay(200.0, 5, snaps)
	var passed = res.get("code", "") == "REPLAY_INPUT_INVALID"
	return { "test": "TC-TWE-S4-06: 回放非法 action 整批拒绝（REPLAY_INPUT_INVALID）", "passed": passed }

## TC-TWE-S4-07: 多段 channel 事件名解析（完整事件名不截断，解析不崩溃）
static func _test_event_channel_multi_segment() -> Dictionary:
	var two_seg: String = EventBusCore.render_domain_event_text("world.clock", { "text": "t" })
	var three_seg: String = EventBusCore.render_domain_event_text("world.clock.advanced", { "text": "t3" })
	var passed = two_seg == "t" and three_seg == "t3"
	return { "test": "TC-TWE-S4-07: 多段 channel 事件名解析（两段/三段不截断不崩溃）", "passed": passed }

## TC-TWE-S4-08: 旧档缺时间字段归一化（world_time 缺 day/month/year → advance 归一化无崩溃）
static func _test_world_time_normalize() -> Dictionary:
	var world := WorldInstance.new("TWE_WORLD_1")
	world.world_time = { "tick": 3 }   # 缺 day/month/year 的旧档
	world.advance_world_time(5)
	var passed = int(world.world_time.get("tick", -1)) == 8 \
		and int(world.world_time.get("day", -1)) >= 1 \
		and int(world.world_time.get("month", -1)) >= 1
	return { "test": "TC-TWE-S4-08: 旧档时间字段归一化（缺字段补齐，tick 单调）", "passed": passed }
