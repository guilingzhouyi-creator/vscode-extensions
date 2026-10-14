# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/spatial_movement/multi_entity_trigger_registry.gd
# 架构定位: Domain Entity / Aggregate Root
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_movement.json | 信号: EventBus 领域广播
# 职责说明: 依据 (trigger_id, entity_id) 复合键维护各实体在各触发区的独立状态，消除单实体串扰
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## MultiEntityTriggerRegistry：Domain Entity / Aggregate Root
class_name MultiEntityTriggerRegistry
extends RefCounted

## 二维复合状态表: trigger_id (String) -> Dictionary[entity_id (String) -> int (TriggerState)]
var _matrix: Dictionary = {}
var _total_count: int = 0

## 获取当前状态机或实体的当前状态值
func get_state(trigger_id: String, entity_id: String) -> int:
	var sub_dict: Variant = _matrix.get(trigger_id, null)
	if sub_dict == null or not (sub_dict is Dictionary):
		return SpatialTriggerFSM.TriggerState.OUTSIDE
	return (sub_dict as Dictionary).get(entity_id, SpatialTriggerFSM.TriggerState.OUTSIDE)

## 更新实体在空间触发区域内的当前交互状态
func update_state(trigger_id: String, entity_id: String, new_state: int) -> int:
	var sub_dict: Dictionary
	if not _matrix.has(trigger_id):
		sub_dict = {}
		_matrix[trigger_id] = sub_dict
	else:
		sub_dict = _matrix[trigger_id]

	var prev: int = sub_dict.get(entity_id, SpatialTriggerFSM.TriggerState.OUTSIDE)
	if not sub_dict.has(entity_id):
		_total_count += 1
	sub_dict[entity_id] = new_state
	return prev

## 从多实体触发注册表中移除指定实体的状态记录
func remove_entity(entity_id: String) -> void:
	var empty_triggers: Array[String] = []
	for trig_id in _matrix:
		var sub: Dictionary = _matrix[trig_id]
		if sub.erase(entity_id):
			_total_count = maxi(0, _total_count - 1)
			if sub.is_empty():
				empty_triggers.append(trig_id)
	for trig_id in empty_triggers:
		_matrix.erase(trig_id)

## 从多实体触发注册表中注销指定触发区域
func remove_trigger(trigger_id: String) -> void:
	if _matrix.has(trigger_id):
		var sub: Dictionary = _matrix[trigger_id]
		_total_count = maxi(0, _total_count - sub.size())
		_matrix.erase(trigger_id)

## 清空当前容器或管理器内的所有记录与缓存
func clear() -> int:
	var count := _total_count
	_matrix.clear()
	_total_count = 0
	return count

## 获取当前处于空间追踪状态的实体总数
func get_total_tracked_count() -> int:
	return maxi(0, _total_count)

static func _make_key(trigger_id: String, entity_id: String) -> String:
	return "%s::%s" % [trigger_id, entity_id]
