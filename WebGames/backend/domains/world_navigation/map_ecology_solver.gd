# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_navigation/map_ecology_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/world.json | 信号: EventBus 领域广播
# 职责说明: 多介质阻抗 A* 最短路径求解、魔素畸变与兽潮爆发概率自平衡模型。 地形阻抗/A* 哨兵值/兽潮系数由 config/world.json 驱动。
# 设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

class_name MapAndEcologySolver extends RefCounted

static func get_terrain_impedance(terrain: String) -> float:
	return GameConfig.get_float("domains.world", "terrain_impedance/" + terrain, 1.0)

## 基于图论阻抗权重的 A* 最短路径求解器
static func solve_shortest_impedance_path(
	start_node_id: String,
	goal_node_id: String,
	all_nodes: Dictionary # node_id -> WorldMapGraphNode
) -> Dictionary:
	if not all_nodes.has(start_node_id) or not all_nodes.has(goal_node_id):
		return {"success": false, "path": [], "total_cost": 0.0}

	if start_node_id == goal_node_id:
		return {"success": true, "path": [start_node_id], "total_cost": 0.0}

	var infinity := GameConfig.get_float("domains.world", "astar/infinity", 99999999.0)
	var default_distance := GameConfig.get_float("domains.world", "astar/default_distance", 10.0)

	var open_set: Array[String] = [start_node_id]
	var came_from: Dictionary = {}
	var g_score: Dictionary = {start_node_id: 0.0}

	while open_set.size() > 0:
		var current := _find_lowest_g_node(open_set, g_score, infinity)

		if current == goal_node_id:
			var total_path := _reconstruct_path(came_from, current)
			return {"success": true, "path": total_path, "total_cost": g_score.get(current, 0.0)}

		open_set.erase(current)
		var current_node: WorldMapGraphNode = all_nodes[current]
		_relax_neighbors(current, current_node, all_nodes, g_score, came_from, open_set, default_distance, infinity)

	return {"success": false, "path": [], "total_cost": 0.0}

static func _find_lowest_g_node(open_set: Array[String], g_score: Dictionary, infinity: float) -> String:
	var best_node := open_set[0]
	var lowest_g: float = g_score.get(best_node, infinity)
	for node in open_set:
		var score: float = g_score.get(node, infinity)
		if score < lowest_g:
			lowest_g = score
			best_node = node
	return best_node

static func _reconstruct_path(came_from: Dictionary, current: String) -> Array[String]:
	var total_path: Array[String] = [current]
	var cur := current
	while came_from.has(cur):
		cur = came_from[cur]
		total_path.push_front(cur)
	return total_path

static func _relax_neighbors(
	current: String,
	current_node: WorldMapGraphNode,
	all_nodes: Dictionary,
	g_score: Dictionary,
	came_from: Dictionary,
	open_set: Array[String],
	default_distance: float,
	infinity: float
) -> void:
	for edge in current_node.outgoing_edges:
		var neighbor_id: String = edge.get("target_node_id", "")
		if not all_nodes.has(neighbor_id):
			continue
		var neighbor_node: WorldMapGraphNode = all_nodes[neighbor_id]
		var dist: float = edge.get("distance", default_distance)
		var imp: float = get_terrain_impedance(neighbor_node.terrain_type)
		var tentative_g: float = g_score.get(current, 0.0) + dist * imp

		if tentative_g < g_score.get(neighbor_id, infinity):
			came_from[neighbor_id] = current
			g_score[neighbor_id] = tentative_g
			if not neighbor_id in open_set:
				open_set.append(neighbor_id)

## 魔素畸变与兽潮爆发概率自平衡模型
## P_swarm = clamp((mana_density - mana_baseline) * mana_coefficient + (1.0 - public_order / order_normalize) * order_coefficient, 0.0, 1.0)
static func evaluate_beast_swarm_risk(mana_density: float, public_order: float) -> float:
	var mana_baseline := GameConfig.get_float("domains.world", "swarm_risk/mana_baseline", 1.0)
	var mana_coefficient := GameConfig.get_float("domains.world", "swarm_risk/mana_coefficient", 0.2)
	var order_normalize := GameConfig.get_float("domains.world", "swarm_risk/order_normalize", 100.0)
	var order_coefficient := GameConfig.get_float("domains.world", "swarm_risk/order_coefficient", 0.3)

	var mana_factor: float = maxf(0.0, mana_density - mana_baseline) * mana_coefficient
	var order_factor: float = (1.0 - clampf(public_order / order_normalize, 0.0, 1.0)) * order_coefficient
	return clampf(mana_factor + order_factor, 0.0, 1.0)
