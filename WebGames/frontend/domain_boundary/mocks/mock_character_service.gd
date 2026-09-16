# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟角色养成服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_character_service.gd
# 职责: 负重求和、装备词缀聚合与潜能加点守卫（视图只消费结果）
# ==============================================================================
class_name MockCharacterService
extends ICharacterService

func calculate_inventory_weight(items: Array) -> float:
	var total := 0.0
	for item in items:
		if item is Dictionary:
			total += float(item.get("weight", 0.0)) * float(item.get("qty", 1))
	return total

func aggregate_equipment_modifiers(equipped_slots: Dictionary) -> Dictionary:
	var total_atk := 0
	var total_def := 0
	var total_hp := 0
	for key in equipped_slots.keys():
		var item: Variant = equipped_slots.get(key, null)
		if item is Dictionary:
			total_atk += int(item.get("atk", 0))
			total_def += int(item.get("def", 0))
			total_hp += int(item.get("hp", 0))
	return {"atk": total_atk, "def": total_def, "hp": total_hp}

func preview_add_point(attributes_preview: Dictionary, attr_key: String, remaining: int) -> Dictionary:
	if remaining <= 0:
		return {"success": false, "reason": "NO_POINTS_LEFT"}
	if not attributes_preview.has(attr_key):
		return {"success": false, "reason": "INVALID_ATTR_KEY"}
	var updated: Dictionary = attributes_preview.duplicate(true)
	updated[attr_key] = int(updated[attr_key]) + 1
	return {
		"success": true,
		"attr": attr_key,
		"new_val": updated[attr_key],
		"remain": remaining - 1,
		"attributes": updated,
	}
