# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟边缘杂项服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_misc_edge_service.gd
# 职责: 突变槽位/去重/替换规则、掉落拾取与命名费用表（视图只消费结果）
# ==============================================================================
class_name MockMiscEdgeService
extends IMiscEdgeService

const NAME_TYPE_FEES: Array[int] = [100, 50, 1000, 200]

func activate_mutation(active: Array, item: Dictionary, max_slots: int) -> Dictionary:
	if active.size() >= max_slots:
		return {"success": false, "reason": "SLOTS_FULL", "mutations": active.duplicate(true)}
	for existing in active:
		if str(existing.get("id", "")) == str(item.get("id", "")):
			return {"success": false, "reason": "ALREADY_ACTIVE", "mutations": active.duplicate(true)}
	var updated: Array = active.duplicate(true)
	updated.append(item.duplicate(true))
	return {"success": true, "mutations": updated}

func replace_last_mutation(active: Array, item: Dictionary) -> Dictionary:
	if active.is_empty():
		return {"success": false, "reason": "NO_ACTIVE_MUTATION", "mutations": active.duplicate(true)}
	var updated: Array = active.duplicate(true)
	updated.pop_back()
	updated.append(item.duplicate(true))
	return {"success": true, "mutations": updated}

func pickup_loot(loot: Array, index: int) -> Dictionary:
	if index < 0 or index >= loot.size():
		return {"success": false, "reason": "INVALID_INDEX", "loot": loot.duplicate(true)}
	var updated: Array = loot.duplicate(true)
	var item: Dictionary = updated[index]
	updated.remove_at(index)
	return {"success": true, "loot": updated, "item": item}

func get_name_type_fee(type_index: int) -> int:
	if type_index < 0 or type_index >= NAME_TYPE_FEES.size():
		return NAME_TYPE_FEES[0]
	return NAME_TYPE_FEES[type_index]
