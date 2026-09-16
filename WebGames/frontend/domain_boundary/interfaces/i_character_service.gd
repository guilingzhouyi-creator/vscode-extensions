# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 角色养成服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_character_service.gd
# 职责: 规范背包负重、装备词缀聚合与潜能加点预览接口，隔离角色数值规则
# ==============================================================================
class_name ICharacterService
extends RefCounted

## 背包总负重：Σ(weight × qty)
func calculate_inventory_weight(items: Array) -> float:
	printerr("ICharacterService.calculate_inventory_weight: 纯虚函数必须由子类实现")
	return 0.0

## 装备词缀聚合（{atk, def, hp}）
func aggregate_equipment_modifiers(equipped_slots: Dictionary) -> Dictionary:
	printerr("ICharacterService.aggregate_equipment_modifiers: 纯虚函数必须由子类实现")
	return {}

## 潜能加点预览（返回 {success, attributes, remain} 或失败原因）
func preview_add_point(attributes_preview: Dictionary, attr_key: String, remaining: int) -> Dictionary:
	printerr("ICharacterService.preview_add_point: 纯虚函数必须由子类实现")
	return {"success": false, "reason": "NOT_IMPLEMENTED"}
