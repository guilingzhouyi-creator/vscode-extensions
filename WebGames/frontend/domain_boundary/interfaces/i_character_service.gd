# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 角色养成服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_character_service.gd
# 职责: 规范背包负重、装备词缀聚合与潜能加点预览接口，隔离角色数值规则
# ==============================================================================
class_name ICharacterService
extends RefCounted

## 背包总负重：Σ(weight × qty)
func calculate_inventory_weight(items: Array) -> float:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.calculate_inventory_weight: pure virtual method must be implemented by subclass")
	return 0.0

## 装备词缀聚合（{atk, def, hp}）
func aggregate_equipment_modifiers(equipped_slots: Dictionary) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.aggregate_equipment_modifiers: pure virtual method must be implemented by subclass")
	return {}

## 潜能加点预览（返回 {success, attributes, remain} 或失败原因）
func preview_add_point(attributes_preview: Dictionary, attr_key: String, remaining: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.preview_add_point: pure virtual method must be implemented by subclass")
	return {"success": false, "reason": "NOT_IMPLEMENTED"}

## 异步创建权威角色契约 (对齐 CREATE_AUTHORITATIVE_CHARACTER)
func create_character_async(account_id: String, token: String, req_data: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.create_character_async: pure virtual method must be implemented by subclass")

## 异步命途资质骰点契约 (对齐 ROLL_CHARACTER_PREVIEW)
func roll_attributes_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.roll_attributes_async: pure virtual method must be implemented by subclass")
