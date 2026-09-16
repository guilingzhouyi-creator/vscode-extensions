# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/world_instance.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 世界数据与角色数据隔离容器：世界时间单调推进、世界持续状态保留、 历史影响片段只增不改。角色死亡不得回退本实例；新角色重新进入 已被影响的同一世界。配置由 config/domains/world.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name WorldInstance extends RefCounted

var world_id: String = ""
var world_time: Dictionary = {"tick": 0, "day": 1, "month": 1, "year": 1}
var world_state: Dictionary = {}
var history_fragments: Array[Dictionary] = []

func _init(p_world_id: String = "") -> void:
	world_id = p_world_id

## 世界时间推进（单调递增，死亡不重置；tick 每 ticks_per_day 联动 day）。
## 契约（Phase 31 S3）：旧档缺字段按默认归一化补齐，tick/day/month/year 不允许负值或倒退。
func advance_world_time(units: int = 1) -> void:
	if units <= 0:
		return
	_normalize_world_time()
	var ticks_per_day: int = maxi(1, GameConfig.get_int("domains.world", "continuity/ticks_per_day", 20))
	var total_ticks: int = int(world_time.get("tick", 0)) + units
	world_time["tick"] = total_ticks
	var new_days: int = total_ticks / ticks_per_day
	var old_days: int = int(world_time.get("day", 1)) - 1
	if new_days > old_days:
		world_time["day"] = old_days + 1 + (new_days - old_days)
	EventBusCore.get_instance().emit_domain_event("world.time_advanced", {"args": [units], "summary": {"world_id": world_id, "tick": world_time["tick"], "day": world_time["day"]}})

## 旧档缺字段归一化：tick/day/month/year 缺失或为负值时按默认补齐（不信任旧档字典结构）
func _normalize_world_time() -> void:
	var defaults := {"tick": 0, "day": 1, "month": 1, "year": 1}
	for key in defaults:
		var v: int = int(world_time.get(key, defaults[key]))
		if v < 0:
			v = defaults[key]
		world_time[key] = v

## 追加历史影响片段（只增不改 + 有界回收，防无限增长）
func append_history_fragment(fragment: Dictionary) -> void:
	if fragment.is_empty():
		return
	history_fragments.append(fragment)
	var max_fragments: int = maxi(1, GameConfig.get_int("domains.world", "continuity/max_history_fragments", 64))
	while history_fragments.size() > max_fragments:
		history_fragments.pop_front()

func serialize() -> Dictionary:
	return {"world_id": world_id, "world_time": world_time.duplicate(), "world_state": world_state.duplicate(), "history_fragments": history_fragments.duplicate()}

static func deserialize(d: Dictionary) -> WorldInstance:
	var inst := WorldInstance.new(String(d.get("world_id", "")))
	inst.world_time = d.get("world_time", inst.world_time)
	inst.world_state = d.get("world_state", {})
	inst.history_fragments = d.get("history_fragments", [])
	return inst