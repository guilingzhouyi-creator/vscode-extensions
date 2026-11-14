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
func preview_add_point(attributes_preview: Dictionary, attribute_key: String, remaining: int) -> Dictionary:
	if remaining <= 0:
		return {"success": false, "reason": "NO_POINTS_LEFT"}
	if not attributes_preview.has(attribute_key):
		return {"success": false, "reason": "INVALID_ATTR_KEY"}
	var updated: Dictionary = attributes_preview.duplicate(true)
	updated[attribute_key] = int(updated[attribute_key]) + 1
	return {
		"success": true,
		"attr": attribute_key,
		"new_val": updated[attribute_key],
		"remain": remaining - 1,
		"attributes": updated,
	}

## 异步创建权威角色契约 (对齐 CREATE_AUTHORITATIVE_CHARACTER)
func create_character_async(account_id: String, token: String, request_data: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.create_character_async: pure virtual method must be implemented by subclass")

## 异步命途资质骰点契约 (对齐 preview UI 属性兼容)
func roll_attributes_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.roll_attributes_async: pure virtual method must be implemented by subclass")

## 异步后端权威命途轮盘预览契约 (对齐 ROLL_CHARACTER_PREVIEW，返回 1~6 六维与身世/天赋)
func roll_destiny_preview_async(_account_id: String, _token: String, _request_data: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.roll_destiny_preview_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步获取创角前端只读 UI 适配快照 (对齐 GET_CREATION_UI_SNAPSHOT)
func get_creation_ui_snapshot_async(_account_id: String, _token: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICharacterService.get_creation_ui_snapshot_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})
