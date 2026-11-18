# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_navigation/map_and_ecology_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/world.json | 信号: EventBus 领域广播
# 职责说明: 多介质阻抗 A* 最短路径求解、魔素畸变与兽潮爆发概率自平衡模型。 地形阻抗/A* 哨兵值/兽潮系数由 config/world.json 驱动。
# 退出语义与设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

## MapAndEcologySolver：Headless Discrete Solver / Numerical Calculator
class_name MapAndEcologySolver extends RefCounted

class WorldNavCache extends RefCounted:
	var terrain_impedances: Dictionary = {}
	var infinity: float = 99999999.0
	var default_distance: float = 10.0

static var _navigation_cache: WorldNavCache = null
static var _navigation_config_version: int = -1

static func _ensure_navigation_cache() -> WorldNavCache:
	var config_version: int = GameConfig.config_reload_version()
	if _navigation_cache != null and _navigation_config_version == config_version:
		return _navigation_cache
	var cache := WorldNavCache.new()
	cache.terrain_impedances = GameConfig.get_dict("domains.world", "terrain_impedance", {})
	cache.infinity = GameConfig.get_float("domains.world", "astar/infinity", 99999999.0)
	cache.default_distance = GameConfig.get_float("domains.world", "astar/default_distance", 10.0)
	_navigation_cache = cache
	_navigation_config_version = config_version
	return cache

## 获取两聚落节点间路径的地形移动阻抗系数
static func get_terrain_impedance(terrain: String) -> float:
	return float(_ensure_navigation_cache().terrain_impedances.get(terrain, 1.0))

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

	var navigation_config := _ensure_navigation_cache()
	var infinity: float = navigation_config.infinity
	var default_distance: float = navigation_config.default_distance
	var terrain_impedances: Dictionary = navigation_config.terrain_impedances

	var open_set: Array[String] = [start_node_id]
	var in_open: Dictionary = {start_node_id: true}
	var closed_set: Dictionary = {}
	var came_from: Dictionary = {}
	var path_cost_scores: Dictionary = {start_node_id: 0.0}

	while open_set.size() > 0:
		var best_index: int = _find_lowest_g_index(open_set, path_cost_scores, infinity)
		var current: String = open_set[best_index]

		if current == goal_node_id:
			var total_path := _reconstruct_path(came_from, current)
			return {"success": true, "path": total_path, "total_cost": path_cost_scores.get(current, 0.0)}

		var last_index: int = open_set.size() - 1
		if best_index != last_index:
			open_set[best_index] = open_set[last_index]
		open_set.pop_back()
		in_open.erase(current)
		closed_set[current] = true
		var current_node: WorldMapGraphNode = all_nodes[current]
		_relax_neighbors(current, current_node, all_nodes, path_cost_scores, came_from, open_set, in_open, closed_set, terrain_impedances, default_distance, infinity)

	return {"success": false, "path": [], "total_cost": 0.0}

static func _find_lowest_g_index(open_set: Array[String], path_cost_scores: Dictionary, infinity: float) -> int:
	var best_index: int = 0
	var lowest_cost: float = path_cost_scores.get(open_set[0], infinity)
	var count: int = open_set.size()
	for open_index in range(1, count):
		var score: float = path_cost_scores.get(open_set[open_index], infinity)
		if score < lowest_cost:
			lowest_cost = score
			best_index = open_index
	return best_index

static func _reconstruct_path(came_from: Dictionary, current: String) -> Array[String]:
	var total_path: Array[String] = [current]
	var cursor_node_id := current
	while came_from.has(cursor_node_id):
		cursor_node_id = came_from[cursor_node_id]
		total_path.append(cursor_node_id)
	total_path.reverse()
	return total_path

static func _relax_neighbors(
	current: String,
	current_node: WorldMapGraphNode,
	all_nodes: Dictionary,
	path_cost_scores: Dictionary,
	came_from: Dictionary,
	open_set: Array[String],
	in_open: Dictionary,
	closed_set: Dictionary,
	terrain_impedances: Dictionary,
	default_distance: float,
	infinity: float
) -> void:
	var current_cost: float = path_cost_scores.get(current, 0.0)
	for edge in current_node.outgoing_edges:
		var neighbor_id: String = edge.get("target_node_id", "")
		if closed_set.has(neighbor_id) or not all_nodes.has(neighbor_id):
			continue
		var neighbor_node: WorldMapGraphNode = all_nodes[neighbor_id]
		var edge_distance: float = float(edge.get("distance", default_distance))
		var terrain_impedance: float = float(terrain_impedances.get(neighbor_node.terrain_type, 1.0))
		var tentative_cost: float = current_cost + edge_distance * terrain_impedance

		if tentative_cost < path_cost_scores.get(neighbor_id, infinity):
			came_from[neighbor_id] = current
			path_cost_scores[neighbor_id] = tentative_cost
			if not in_open.has(neighbor_id):
				in_open[neighbor_id] = true
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

## 获取当前活跃世界地标列表（实时读取 domains.world#landmarks，受 Tier 3 MOD 覆写控制）
static func get_active_landmarks() -> Array:
	return GameConfig.get_array("domains.world", "landmarks", [])

## 从当前配置表的 mod_world_topology 与 landmarks 构建 A* 寻路消费节点图
static func build_topology_nodes_from_config() -> Dictionary:
	var topology: Dictionary = GameConfig.get_dict("domains.world", "mod_world_topology", {})
	var nodes_map: Dictionary = {}
	_ingest_topology_nodes(nodes_map, topology.get("nodes", []))
	_ingest_landmark_nodes(nodes_map, get_active_landmarks())
	_wire_topology_edges(nodes_map, topology.get("edges", []))
	return nodes_map

static func _ingest_topology_nodes(nodes_map: Dictionary, raw_nodes: Variant) -> void:
	if raw_nodes is Dictionary:
		var node_table := raw_nodes as Dictionary
		for raw_id in node_table.keys():
			_upsert_graph_node(nodes_map, String(raw_id), node_table[raw_id])
		return
	if raw_nodes is Array:
		for raw_entry in raw_nodes as Array:
			if raw_entry is Dictionary:
				var entry := raw_entry as Dictionary
				_upsert_graph_node(nodes_map, String(entry.get("node_id", "")), entry)

static func _ingest_landmark_nodes(nodes_map: Dictionary, landmarks: Array) -> void:
	for raw_landmark in landmarks:
		if not (raw_landmark is Dictionary):
			continue
		var landmark_entry := raw_landmark as Dictionary
		var landmark_id := String(landmark_entry.get("id", "")).strip_edges()
		if not landmark_id.is_empty() and not nodes_map.has(landmark_id):
			_upsert_graph_node(nodes_map, landmark_id, landmark_entry)

static func _upsert_graph_node(nodes_map: Dictionary, node_id: String, raw_entry: Variant) -> void:
	var clean_id := node_id.strip_edges()
	if clean_id.is_empty() or not (raw_entry is Dictionary):
		return
	var entry := raw_entry as Dictionary
	var graph_node := WorldMapGraphNode.new()
	graph_node.node_id = clean_id
	graph_node.node_name = String(entry.get("name", clean_id))
	if entry.has("continent_id"):
		graph_node.continent_id = String(entry.get("continent_id", ""))
	if entry.has("terrain_type"):
		graph_node.terrain_type = String(entry.get("terrain_type", "PLAINS"))
	if entry.has("regional_mana_density"):
		graph_node.regional_mana_density = float(entry.get("regional_mana_density", 1.0))
	graph_node.coordinates = Vector2(float(entry.get("x", 0.0)), float(entry.get("y", 0.0)))
	if entry.get("outgoing_edges") is Array:
		graph_node.outgoing_edges = (entry.get("outgoing_edges") as Array).duplicate(true)
	nodes_map[clean_id] = graph_node

static func _wire_topology_edges(nodes_map: Dictionary, raw_edges: Variant) -> void:
	if not (raw_edges is Array):
		return
	var default_distance: float = GameConfig.get_float("domains.world", "astar/default_distance", 10.0)
	for raw_edge in raw_edges as Array:
		if not (raw_edge is Dictionary):
			continue
		var edge := raw_edge as Dictionary
		var from_id := String(edge.get("from", "")).strip_edges()
		var to_id := String(edge.get("to", "")).strip_edges()
		if from_id.is_empty() or to_id.is_empty():
			continue
		if not nodes_map.has(from_id) or not nodes_map.has(to_id):
			continue
		var edge_distance := float(edge.get("distance", default_distance))
		var from_node := nodes_map[from_id] as WorldMapGraphNode
		from_node.outgoing_edges.append({"target_node_id": to_id, "distance": edge_distance})
		if bool(edge.get("bidirectional", true)):
			var to_node := nodes_map[to_id] as WorldMapGraphNode
			to_node.outgoing_edges.append({"target_node_id": from_id, "distance": edge_distance})
