# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/item_statistics/account_item_library.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_statistics.json | 信号: EventBus 领域广播
# 职责说明: 每个账号 UID 下挂载一棵物品 ID 库树： 根(account_id) → category_major → category_minor → canonical_id 叶节点； 分类节点沿路径递归聚合子树统计（current_quantity 与各事件累计量）； 递归操作：mount_item 递归建路径 / apply_item_delta 递归定位并自底向上重算 / query_subtree 递归遍历聚合 / query_all_items 递归收集叶节点。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name AccountItemLibraryAggregate
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
## Phase 44 P3：canonical_id → [major_key, minor_key] 定位索引（消除 find 全树线性扫）。
## 运行时加速结构，不入 serialize（root_node 为持久事实源）；挂载路径写入、
## 反序列化/restore 后由 _ensure_index 懒重建。
var _canonical_index: Dictionary = {}

func _init(p_account_id: String = "") -> void:
	account_id = p_account_id
	root_node = { "type": NODE_ROOT, "children": {} }

## 递归挂载物品：沿 category_major → category_minor → canonical_id 建路径（幂等）
func mount_item(canonical_id: String, category_major: String, category_minor: String) -> Dictionary:
	if canonical_id.is_empty():
		return { "success": false, "reason": "empty canonical_id" }
	var major_key := category_major if not category_major.is_empty() else "UNCATEGORIZED"
	var minor_key := category_minor if not category_minor.is_empty() else "UNSPECIFIED"

	var major: Dictionary = root_node["children"].get(major_key, {})
	if major.is_empty():
		major = { "type": NODE_CATEGORY_MAJOR, "name": major_key, "children": {}, "stats": _zero_stats() }
		root_node["children"][major_key] = major
	var minor: Dictionary = major["children"].get(minor_key, {})
	if minor.is_empty():
		minor = { "type": NODE_CATEGORY_MINOR, "name": minor_key, "children": {}, "stats": _zero_stats() }
		major["children"][minor_key] = minor
	var item_node: Dictionary = minor["children"].get(canonical_id, {})
	if item_node.is_empty():
		item_node = {
			"type": NODE_ITEM, "canonical_id": canonical_id,
			"category_major": major_key, "category_minor": minor_key,
			"stats": _zero_stats()
		}
		minor["children"][canonical_id] = item_node
	_canonical_index[canonical_id] = [major_key, minor_key] # P3：索引写入（幂等覆盖）
	_recalc_upwards(root_node, [major_key, minor_key])
	return { "success": true, "canonical_id": canonical_id }

## 物品事件落账：递归定位叶节点 → 更新该事件累计与当前持有（减量下限 0）→ 自底向上递归聚合
## 返回实际生效数量（减量触底时 actual < quantity）
func apply_item_delta(canonical_id: String, event_stat_key: String, quantity: int) -> Dictionary:
	if quantity <= 0 or not STAT_KEYS.has(event_stat_key):
		return { "success": false, "reason": "invalid delta" }
	var found: Dictionary = find_item_node(canonical_id)
	if found.is_empty():
		return { "success": false, "reason": "item not mounted" }
	var stats: Dictionary = found["node"]["stats"]
	var consumes_current := event_stat_key != STAT_GAINED and event_stat_key != STAT_FORGED
	var prev_current: int = int(stats.get(STAT_CURRENT, 0))
	stats[event_stat_key] = int(stats.get(event_stat_key, 0)) + quantity
	var actual_delta := quantity
	if consumes_current:
		actual_delta = mini(quantity, prev_current) # 下限 0：当前持有不可减成负数
	var current_delta := quantity if not consumes_current else -actual_delta
	stats[STAT_CURRENT] = prev_current + current_delta
	_apply_delta_upwards(root_node, [found["path"][0], found["path"][1]], event_stat_key, quantity, current_delta)
	return {
		"success": true, "canonical_id": canonical_id,
		"event_stat": event_stat_key, "actual_quantity": actual_delta
	}

## 递归定位叶节点（返回 {"node": ..., "path": [major, minor]}，未挂载返回空）
## Phase 44 P3：经 _canonical_index O(1) 定位（懒重建兜底），语义与线性扫等价
func find_item_node(canonical_id: String) -> Dictionary:
	_ensure_index()
	if _canonical_index.has(canonical_id):
		var loc: Array = _canonical_index[canonical_id]
		var major_key: String = str(loc[0])
		var minor_key: String = str(loc[1])
		var major: Dictionary = root_node["children"].get(major_key, {})
		if major.is_empty():
			return {}
		var minor: Dictionary = major["children"].get(minor_key, {})
		if minor.is_empty():
			return {}
		if minor["children"].has(canonical_id):
			return { "node": minor["children"][canonical_id], "path": [major_key, minor_key] }
	return {}

## P3：索引懒重建——树有内容而索引为空（反序列化/restore 后）时全树收集一次
func _ensure_index() -> void:
	if not _canonical_index.is_empty() or root_node["children"].is_empty():
		return
	for major_key in root_node["children"]:
		var major: Dictionary = root_node["children"][major_key]
		for minor_key in major["children"]:
			var minor: Dictionary = major["children"][minor_key]
			for canonical_id in minor["children"]:
				_canonical_index[canonical_id] = [major_key, minor_key]

## 递归聚合分类子树统计（category_major 可选；缺省 = 全树）
func query_subtree(category_major: String = "", category_minor: String = "") -> Dictionary:
	var node: Dictionary = root_node
	if not category_major.is_empty():
		if not root_node["children"].has(category_major):
			return _zero_stats()
		node = root_node["children"][category_major]
		if not category_minor.is_empty():
			if not node["children"].has(category_minor):
				return _zero_stats()
			node = node["children"][category_minor]
	return _aggregate_recursive(node)

## 账号全量物品清单（递归收集叶节点）
func query_all_items() -> Array:
	var out: Array = []
	_collect_items_recursive(root_node, out)
	return out

func serialize() -> Dictionary:
	return { "account_id": account_id, "root_node": root_node }

# ==============================================================================
# 内部实现
# ==============================================================================

static func _zero_stats() -> Dictionary:
	var s := {}
	for k in STAT_KEYS:
		s[k] = 0
	return s

## 递归聚合节点（分类节点 = 子树之和；叶节点 = 自身统计）
static func _aggregate_recursive(node: Dictionary) -> Dictionary:
	var agg := _zero_stats()
	if node.get("type") == NODE_ITEM:
		for k in STAT_KEYS:
			agg[k] = int(node["stats"].get(k, 0))
		return agg
	for child in node["children"].values():
		var sub := _aggregate_recursive(child)
		for k in STAT_KEYS:
			agg[k] = int(agg[k]) + int(sub[k])
	return agg

## 递归收集物品叶节点
static func _collect_items_recursive(node: Dictionary, out: Array) -> void:
	if node.get("type") == NODE_ITEM:
		out.append({
			"canonical_id": node["canonical_id"],
			"category_major": node["category_major"],
			"category_minor": node["category_minor"],
			"stats": node["stats"]
		})
		return
	for child in node["children"].values():
		_collect_items_recursive(child, out)

## 自底向上常数时间 O(1) 路径增量累加（消除全量子树递归求和性能开销）
static func _apply_delta_upwards(root: Dictionary, path: Array, event_stat_key: String, event_delta: int, current_delta: int) -> void:
	if path.size() < 2:
		return
	var major_key: String = str(path[0])
	var minor_key: String = str(path[1])
	var major: Dictionary = root["children"].get(major_key, {})
	if major.is_empty():
		return
	var minor: Dictionary = major["children"].get(minor_key, {})
	if not minor.is_empty():
		var ms: Dictionary = minor["stats"]
		ms[event_stat_key] = int(ms.get(event_stat_key, 0)) + event_delta
		ms[STAT_CURRENT] = int(ms.get(STAT_CURRENT, 0)) + current_delta
	var maj_s: Dictionary = major["stats"]
	maj_s[event_stat_key] = int(maj_s.get(event_stat_key, 0)) + event_delta
	maj_s[STAT_CURRENT] = int(maj_s.get(STAT_CURRENT, 0)) + current_delta

## 自底向上递归重算路径上各分类节点的聚合统计（保留作为重构校验与全量同步基准）
static func _recalc_upwards(root: Dictionary, path: Array) -> void:
	var major_key: String = str(path[0])
	var minor_key: String = str(path[1])
	var major: Dictionary = root["children"].get(major_key, {})
	if major.is_empty():
		return
	var minor: Dictionary = major["children"].get(minor_key, {})
	if not minor.is_empty():
		minor["stats"] = _aggregate_recursive(minor)
	major["stats"] = _aggregate_recursive(major)
