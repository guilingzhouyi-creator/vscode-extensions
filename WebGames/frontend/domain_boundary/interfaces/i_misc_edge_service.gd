# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 边缘杂项服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_misc_edge_service.gd
# 职责: 规范突变激活/替换、掉落拾取与命名费用接口，隔离杂项规则
# ==============================================================================
class_name IMiscEdgeService
extends RefCounted

## 激活突变（槽位上限与重复校验）→ {success, mutations, reason}
func activate_mutation(active: Array, item: Dictionary, max_slots: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IMiscEdgeService.activate_mutation: pure virtual method must be implemented by subclass")
	return {"success": false, "reason": "NOT_IMPLEMENTED"}

## 替换末位已激活突变 → {success, mutations, reason}
func replace_last_mutation(active: Array, item: Dictionary) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IMiscEdgeService.replace_last_mutation: pure virtual method must be implemented by subclass")
	return {"success": false, "reason": "NOT_IMPLEMENTED"}

## 拾取掉落物 → {success, loot, item, reason}
func pickup_loot(loot: Array, index: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IMiscEdgeService.pickup_loot: pure virtual method must be implemented by subclass")
	return {"success": false, "reason": "NOT_IMPLEMENTED"}

## 命名类型费用（越界回退默认档）
func get_name_type_fee(type_index: int) -> int:
	EventBusCore.get_instance().emit_log("error", "IMiscEdgeService.get_name_type_fee: pure virtual method must be implemented by subclass")
	return 0
