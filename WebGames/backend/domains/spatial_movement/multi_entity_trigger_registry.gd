# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/spatial_movement/multi_entity_trigger_registry.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_movement.json | 信号: EventBus 领域广播
# 职责说明: 依据 (trigger_id, entity_id) 复合键维护各实体在各触发区的独立状态，消除单实体串扰
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name MultiEntityTriggerRegistry
extends RefCounted

## 复合状态表: "{trigger_id}::{entity_id}" -> int (TriggerState)
var _state_table: Dictionary = {}

func get_state(trigger_id: String, entity_id: String) -> int:
	var key := _make_key(trigger_id, entity_id)
	return _state_table.get(key, SpatialTriggerFSM.TriggerState.OUTSIDE)

func update_state(trigger_id: String, entity_id: String, new_state: int) -> int:
	var key := _make_key(trigger_id, entity_id)
	var prev: int = _state_table.get(key, SpatialTriggerFSM.TriggerState.OUTSIDE)
	_state_table[key] = new_state
	return prev

func remove_entity(entity_id: String) -> void:
	var suffix := "::" + entity_id
	var to_erase := []
	for k in _state_table.keys():
		if str(k).ends_with(suffix):
			to_erase.append(k)
	for rk in to_erase:
		_state_table.erase(rk)

func remove_trigger(trigger_id: String) -> void:
	var prefix := trigger_id + "::"
	var to_erase := []
	for k in _state_table.keys():
		if str(k).begins_with(prefix):
			to_erase.append(k)
	for rk in to_erase:
		_state_table.erase(rk)

func clear() -> void:
	_state_table.clear()

func get_total_tracked_count() -> int:
	return _state_table.size()

static func _make_key(trigger_id: String, entity_id: String) -> String:
	return "%s::%s" % [trigger_id, entity_id]
