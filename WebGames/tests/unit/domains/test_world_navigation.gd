# ==============================================================================
# 单元测试：领域 3 七大洲阻抗寻路与城镇生态 (World Navigation Tests)
# 文件路径: res://tests/unit/domains/test_world_navigation.gd
# ==============================================================================
class_name TestWorldNavigationDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_town_settlement_entity())
	results.append(test_impedance_astar_pathfinding())
	results.append(test_beast_swarm_risk())
	results.append(test_marching_ration_consumption())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 03: 七大洲阻抗寻路与城镇定居点", "all_passed": all_passed, "results": results }

static func test_town_settlement_entity() -> Dictionary:
	var town := WorldMapGraphNode.TownSettlementAggregate.new()
	town.town_id = "TOWN_001"
	town.town_name = "苍穹王城"
	var s = town.serialize()
	var passed = (s.town_id == "TOWN_001") and (town.population_count == 5000)
	return { "test": "TC-WORLD-01: 城镇定居点实体构造与基础参数", "passed": passed }

static func test_impedance_astar_pathfinding() -> Dictionary:
	var n_start := WorldMapGraphNode.new()
	n_start.node_id = "A"
	n_start.terrain_type = "PLAINS"
	n_start.outgoing_edges = [
		{ "target_node_id": "B_SWAMP", "distance": 10.0 },
		{ "target_node_id": "C_PLAINS", "distance": 12.0 }
	]

	var n_swamp := WorldMapGraphNode.new()
	n_swamp.node_id = "B_SWAMP"
	n_swamp.terrain_type = "SWAMP" # 阻抗 2.5 -> cost 10 * 2.5 = 25
	n_swamp.outgoing_edges = [{ "target_node_id": "D_GOAL", "distance": 10.0 }]

	var n_plains := WorldMapGraphNode.new()
	n_plains.node_id = "C_PLAINS"
	n_plains.terrain_type = "PLAINS" # 阻抗 1.0 -> cost 12 * 1.0 = 12
	n_plains.outgoing_edges = [{ "target_node_id": "D_GOAL", "distance": 5.0 }]

	var n_goal := WorldMapGraphNode.new()
	n_goal.node_id = "D_GOAL"
	n_goal.terrain_type = "PLAINS"

	var map_nodes := { "A": n_start, "B_SWAMP": n_swamp, "C_PLAINS": n_plains, "D_GOAL": n_goal }
	var res = MapAndEcologySolver.solve_shortest_impedance_path("A", "D_GOAL", map_nodes)
	var passed = res.success and (res.path == ["A", "C_PLAINS", "D_GOAL"])
	return { "test": "TC-WORLD-02: 智能规避高阻抗沼泽选择平原最优路径", "passed": passed, "path": res.path }

static func test_beast_swarm_risk() -> Dictionary:
	var low_risk = MapAndEcologySolver.evaluate_beast_swarm_risk(1.0, 90.0)
	var high_risk = MapAndEcologySolver.evaluate_beast_swarm_risk(3.5, 20.0)
	var passed = (low_risk < 0.1) and (high_risk > 0.6)
	return { "test": "TC-WORLD-03: 魔素畸变与治安崩溃双因素兽潮风险计算", "passed": passed, "low": low_risk, "high": high_risk }

static func test_marching_ration_consumption() -> Dictionary:
	var party := WorldTravelAndSettlementFSM.MarchingParty.new()
	party.party_id = "TEST_PARTY_1"
	party.ration_units = 50.0
	var dest := WorldMapGraphNode.new()
	dest.node_id = "SWAMP_ZONE_1"
	dest.terrain_type = "SWAMP" # 阻抗 2.5
	var step = WorldTravelAndSettlementFSM.execute_marching_step(party, dest, 20.0)
	var passed = (step.travel_hours > 0) and (step.ration_consumed > 0.0) and not step.is_starving
	return { "test": "TC-WORLD-04: 沼泽地质阻抗行军时间与口粮损耗推进", "passed": passed, "consumed": step.ration_consumed }
