# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_character_service.gd
# 架构定位: Domain Boundary Interface / Character Service Contract
# 依赖与触发: 上游: Frontend Views, ServiceContainer | 下游: RealCharacterService, MockCharacterService
# 职责说明: 规范背包负重、装备词缀聚合、潜能加点预览与权威创角接口，隔离角色数值规则。
# 退出语义与设计依据: 前端无业务逻辑契约与领域边界服务解耦规范
# ==============================================================================

## ICharacterService：角色养成与权威创角服务抽象接口
class_name ICharacterService
extends RefCounted

## 背包总负重：Σ(weight × qty)
func calculate_inventory_weight(inventory_entries: Array) -> float:
	var total_weight := 0.0
	for inventory_entry in inventory_entries:
		if inventory_entry is Dictionary:
			total_weight += float(inventory_entry.get("weight", 0.0)) * float(inventory_entry.get("qty", 1))
	return total_weight

## 装备词缀聚合（{atk, def, hp}）
func aggregate_equipment_modifiers(equipped_slots: Dictionary) -> Dictionary:
	var total_attack := 0
	var total_defense := 0
	var total_health_points := 0
	for slot_key in equipped_slots.keys():
		var equipment_entry: Variant = equipped_slots.get(slot_key, null)
		if equipment_entry is Dictionary:
			total_attack += int(equipment_entry.get("atk", 0))
			total_defense += int(equipment_entry.get("def", 0))
			total_health_points += int(equipment_entry.get("hp", 0))
	return {"atk": total_attack, "def": total_defense, "hp": total_health_points}

## 潜能加点预览（返回 {success, attributes, remain} 或失败原因）
func preview_add_point(attributes_preview: Dictionary, attribute_key: String, remaining: int) -> Dictionary:
	if remaining <= 0:
		return {"success": false, "reason": "NO_POINTS_LEFT"}
	if not attributes_preview.has(attribute_key):
		return {"success": false, "reason": "INVALID_ATTR_KEY"}
	var updated_attributes: Dictionary = attributes_preview.duplicate(true)
	updated_attributes[attribute_key] = int(updated_attributes[attribute_key]) + 1
	return {
		"success": true,
		"attr": attribute_key,
		"new_val": updated_attributes[attribute_key],
		"remain": remaining - 1,
		"attributes": updated_attributes,
	}

## 异步创建权威角色契约 (对齐 CREATE_AUTHORITATIVE_CHARACTER)
func create_character_async(_account_id: String, _token: String, _request_payload: Dictionary, _result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.create_character_async: pure virtual method must be implemented by subclass")

## 异步命途资质骰点契约 (对齐 preview UI 属性兼容)
func roll_attributes_async(_result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.roll_attributes_async: pure virtual method must be implemented by subclass")

## 异步后端权威命途轮盘预览契约 (对齐 ROLL_CHARACTER_PREVIEW，返回 1~6 六维与身世/天赋)
func roll_destiny_preview_async(_account_id: String, _token: String, _request_payload: Dictionary, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.roll_destiny_preview_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步获取创角前端只读 UI 适配快照 (对齐 GET_CREATION_UI_SNAPSHOT)
func get_creation_ui_snapshot_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.get_creation_ui_snapshot_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})
