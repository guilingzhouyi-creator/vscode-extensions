# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/item_statistics/account_item_library.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_statistics.json | 信号: EventBus 领域广播
# 职责说明: 每个账号 UID 下挂载一棵物品 ID 库树： 根(account_id) → category_major → category_minor → canonical_id 叶节点； 分类节点沿路径递归聚合子树统计（current_quantity 与各事件累计量）； 递归操作：mount_item 递归建路径 / apply_item_delta 递归定位并自底向上重算 / query_subtree 递归遍历聚合 / query_all_items 递归收集叶节点。
# 退出语义与设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

## AccountItemLibrary：Domain Logic Component
class_name AccountItemLibrary
extends RefCounted

const NODE_ROOT: String = "root"
const NODE_CATEGORY_MAJOR: String = "major"
const NODE_CATEGORY_MINOR: String = "minor"
const NODE_ITEM: String = "item"

const STAT_CURRENT: String = "current_quantity"
const STAT_GAINED: String = "total_gained"
const STAT_CONSUMED: String = "total_consumed"
const STAT_DESTROYED: String = "total_destroyed"
const STAT_TRADED: String = "total_traded"
const STAT_FORGED: String = "total_forged"
const STAT_CLAWED_BACK: String = "total_clawed_back"

const STAT_KEYS: Array[String] = [
	STAT_CURRENT, STAT_GAINED, STAT_CONSUMED, STAT_DESTROYED,
	STAT_TRADED, STAT_FORGED, STAT_CLAWED_BACK
]

var account_id: String = ""
var root_node: Dictionary = {}
## canonical_id → [major_key, minor_key] 定位索引（消除 find 全树线性扫）。
## 运行时加速结构，不入 serialize（root_node 为持久事实源）；挂载路径写入、
## 反序列化/restore 后由 _ensure_index 懒重建。
var _canonical_index: Dictionary = {}

## 初始化账号物品库聚合根。
func _init(initial_account_id: String = "") -> void:
	account_id = initial_account_id
	root_node = {"type": NODE_ROOT, "children": {}}

## 递归挂载物品：沿 category_major → category_minor → canonical_id 建路径（幂等）
func mount_item(canonical_id: String, category_major: String, category_minor: String) -> Dictionary:
	if canonical_id.is_empty():
		return {"success": false, "reason": "empty canonical_id"}
	var major_key := category_major if not category_major.is_empty() else "UNCATEGORIZED"
	var minor_key := category_minor if not category_minor.is_empty() else "UNSPECIFIED"

	var major: Dictionary = root_node["children"].get(major_key, {})
	if major.is_empty():
		major = {"type": NODE_CATEGORY_MAJOR, "name": major_key, "children": {}, "stats": _zero_stats()}
		root_node["children"][major_key] = major
	var minor: Dictionary = major["children"].get(minor_key, {})
	if minor.is_empty():
		minor = {"type": NODE_CATEGORY_MINOR, "name": minor_key, "children": {}, "stats": _zero_stats()}
		major["children"][minor_key] = minor
	var item_node: Dictionary = minor["children"].get(canonical_id, {})
	if item_node.is_empty():
		item_node = {
			"type": NODE_ITEM, "canonical_id": canonical_id,
			"category_major": major_key, "category_minor": minor_key,
			"stats": _zero_stats()
		}
		minor["children"][canonical_id] = item_node
	_canonical_index[canonical_id] = [major_key, minor_key] # 索引写入（幂等覆盖）
	return {"success": true, "canonical_id": canonical_id}

## 物品事件落账：递归定位叶节点 → 更新该事件累计与当前持有（减量下限 0）→ 自底向上递归聚合
## 返回实际生效数量（减量触底时 actual < quantity）
func apply_item_delta(canonical_id: String, event_stat_key: String, quantity: int) -> Dictionary:
	if quantity <= 0 or not STAT_KEYS.has(event_stat_key):
		return {"success": false, "reason": "invalid delta"}
	var found: Dictionary = find_item_node(canonical_id)
	if found.is_empty():
		return {"success": false, "reason": "item not mounted"}
	var stats: Dictionary = found["node"]["stats"]
	var should_consume_current := event_stat_key != STAT_GAINED and event_stat_key != STAT_FORGED
	var previous_current: int = int(stats.get(STAT_CURRENT, 0))
	stats[event_stat_key] = int(stats.get(event_stat_key, 0)) + quantity
	var actual_delta := quantity
	if should_consume_current:
		actual_delta = mini(quantity, previous_current) # 下限 0：当前持有不可减成负数
	var current_delta := quantity if not should_consume_current else -actual_delta
	stats[STAT_CURRENT] = previous_current + current_delta
	_apply_delta_upwards(root_node, [found["path"][0], found["path"][1]], event_stat_key, Vector2i(quantity, current_delta))
	return {
		"success": true, "canonical_id": canonical_id,
		"event_stat": event_stat_key, "actual_quantity": actual_delta
	}

## 递归定位叶节点（返回 {"node": ..., "path": [major, minor]}，未挂载返回空）
## 经 _canonical_index O(1) 定位（懒重建安全回退），语义与线性扫等价
func find_item_node(canonical_id: String) -> Dictionary:
	_ensure_index()
	if _canonical_index.has(canonical_id):
		var item_location: Array = _canonical_index[canonical_id]
		var major_key: String = str(item_location[0])
		var minor_key: String = str(item_location[1])
		var major: Dictionary = root_node["children"].get(major_key, {})
		if major.is_empty():
			return {}
		var minor: Dictionary = major["children"].get(minor_key, {})
		if minor.is_empty():
			return {}
		if minor["children"].has(canonical_id):
			return {"node": minor["children"][canonical_id], "path": [major_key, minor_key]}
	return {}

func _index_minor_node(major_key: String, minor_key: String, minor: Dictionary) -> void:
	for canonical_id in minor["children"]:
		_canonical_index[canonical_id] = [major_key, minor_key]

func _index_major_node(major_key: String, major: Dictionary) -> void:
	for minor_key in major["children"]:
		var minor: Dictionary = major["children"][minor_key]
		_index_minor_node(major_key, String(minor_key), minor)

## 索引懒重建——树有内容而索引为空（反序列化/restore 后）时全树收集一次
func _ensure_index() -> void:
	if not _canonical_index.is_empty() or root_node["children"].is_empty():
		return
	for major_key in root_node["children"]:
		var major: Dictionary = root_node["children"][major_key]
		_index_major_node(major_key, major)

## 分类子树统计查询（直读增量维护 stats；全树查询仅累加一级主分类节点）
func query_subtree(category_major: String = "", category_minor: String = "") -> Dictionary:
	if not category_major.is_empty():
		if not root_node["children"].has(category_major):
			return _zero_stats()
		var major_node: Dictionary = root_node["children"][category_major]
		if not category_minor.is_empty():
			if not major_node["children"].has(category_minor):
				return _zero_stats()
			var minor_node: Dictionary = major_node["children"][category_minor]
			return (minor_node["stats"] as Dictionary).duplicate() if minor_node.has("stats") else _aggregate_recursive(minor_node)
		return (major_node["stats"] as Dictionary).duplicate() if major_node.has("stats") else _aggregate_recursive(major_node)
	var aggregated_metrics := _zero_stats()
	for child in root_node["children"].values():
		var child_node: Dictionary = child as Dictionary
		var child_metrics: Dictionary = child_node["stats"] if child_node.has("stats") else _aggregate_recursive(child_node)
		_accumulate_stats(aggregated_metrics, child_metrics)
	return aggregated_metrics

## 账号全量物品清单（递归收集叶节点）
func query_all_items() -> Array:
	var collected_items: Array = []
	_collect_items_recursive(root_node, collected_items)
	return collected_items

## 序列化当前实体或对象状态为字典结构
func serialize() -> Dictionary:
	return {"account_id": account_id, "root_node": root_node}

# ==============================================================================
# 内部实现
# ==============================================================================

static func _zero_stats() -> Dictionary:
	var stats_map := {}
	for stat_key in STAT_KEYS:
		stats_map[stat_key] = 0
	return stats_map

static func _accumulate_stats(aggregated_stats: Dictionary, child_stats: Dictionary) -> void:
	for stat_key in STAT_KEYS:
		aggregated_stats[stat_key] = int(aggregated_stats[stat_key]) + int(child_stats[stat_key])

## 递归聚合节点（分类节点 = 子树之和；叶节点 = 自身统计）
static func _aggregate_recursive(node: Dictionary) -> Dictionary:
	var aggregated_stats := _zero_stats()
	if node.get("type") == NODE_ITEM:
		for stat_key in STAT_KEYS:
			aggregated_stats[stat_key] = int(node["stats"].get(stat_key, 0))
		return aggregated_stats
	for child in node["children"].values():
		var child_stats := _aggregate_recursive(child)
		_accumulate_stats(aggregated_stats, child_stats)
	return aggregated_stats

## 递归收集物品叶节点
static func _collect_items_recursive(node: Dictionary, collected_items: Array) -> void:
	if node.get("type") == NODE_ITEM:
		collected_items.append({
			"canonical_id": node["canonical_id"],
			"category_major": node["category_major"],
			"category_minor": node["category_minor"],
			"stats": node["stats"]
		})
		return
	for child in node["children"].values():
		_collect_items_recursive(child, collected_items)

static func _resolve_category_nodes(root: Dictionary, path: Array) -> Array[Dictionary]:
	var nodes: Array[Dictionary] = []
	if path.size() < 2:
		return nodes
	var major: Dictionary = root["children"].get(str(path[0]), {})
	if major.is_empty():
		return nodes
	var minor: Dictionary = major["children"].get(str(path[1]), {})
	if not minor.is_empty():
		nodes.append(minor)
	nodes.append(major)
	return nodes

static func _apply_node_stat_delta(node_stats: Dictionary, event_stat_key: String, deltas: Vector2i) -> void:
	node_stats[event_stat_key] = int(node_stats.get(event_stat_key, 0)) + deltas.x
	node_stats[STAT_CURRENT] = int(node_stats.get(STAT_CURRENT, 0)) + deltas.y

## 自底向上常数时间 O(1) 路径增量累加（消除全量子树递归求和性能开销）
static func _apply_delta_upwards(root: Dictionary, path: Array, event_stat_key: String, deltas: Vector2i) -> void:
	for node in _resolve_category_nodes(root, path):
		_apply_node_stat_delta(node["stats"], event_stat_key, deltas)

## 自底向上递归重算路径上各分类节点的聚合统计（保留作为重构校验与全量同步基准）
static func _recalc_upwards(root: Dictionary, path: Array) -> void:
	for node in _resolve_category_nodes(root, path):
		node["stats"] = _aggregate_recursive(node)
