# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 角色养成服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_character_service.gd
# 职责: 规范背包负重、装备词缀聚合与潜能加点预览接口，隔离角色数值规则
# ==============================================================================
class_name ICharacterService
extends RefCounted

## 背包总负重：Σ(weight × qty)
func calculate_inventory_weight(items: Array) -> float:
	var total := 0.0
	for item in items:
		if item is Dictionary:
			total += float(item.get("weight", 0.0)) * float(item.get("qty", 1))
	return total

## 装备词缀聚合（{atk, def, hp}）
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

## 潜能加点预览（返回 {success, attributes, remain} 或失败原因）
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

## 异步创建权威角色契约 (对齐 CREATE_AUTHORITATIVE_CHARACTER)
func create_character_async(account_id: String, token: String, req_data: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.create_character_async: pure virtual method must be implemented by subclass")

## 异步命途资质骰点契约 (对齐 ROLL_CHARACTER_PREVIEW)
func roll_attributes_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.roll_attributes_async: pure virtual method must be implemented by subclass")
