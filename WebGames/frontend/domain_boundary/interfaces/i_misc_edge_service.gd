# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_misc_edge_service.gd
# 架构定位: Domain Boundary Interface / Miscellaneous Gameplay Service Contract
# 依赖与触发: 上游: 突变/拾取/命名相关边缘视图, ServiceContainer | 下游: MockMiscEdgeService
# 职责说明: 规范突变槽位激活与替换、地面掉落拾取与命名类型计费接口，隔离杂项业务规则。
# 退出语义与设计依据: 表现层零杂项规则演算与领域边界解耦契约
# ==============================================================================

## IMiscEdgeService：突变激活、拾取与命名费用边界服务抽象接口
class_name IMiscEdgeService
extends RefCounted

## 激活突变（槽位上限与重复校验）→ {success, mutations, error_code}
func activate_mutation(_active_mutations: Array, _mutation_entry: Dictionary, _max_slots: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IMiscEdgeService.activate_mutation: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 替换末位已激活突变 → {success, mutations, error_code}
func replace_last_mutation(_active_mutations: Array, _mutation_entry: Dictionary) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IMiscEdgeService.replace_last_mutation: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 拾取掉落物 → {success, loot, item, error_code}
func pickup_loot(_loot_entries: Array, _loot_index: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IMiscEdgeService.pickup_loot: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 命名类型费用（越界回退默认档）
func get_name_type_fee(_type_index: int) -> int:
	EventBusCore.get_instance().emit_log("error", "IMiscEdgeService.get_name_type_fee: pure virtual method must be implemented by subclass")
	return 0

## 分发核名、更名、伪装、拾取与突变协议动作
func dispatch_misc_action(_action_type: String, _payload_data: Dictionary = {}) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IMiscEdgeService.dispatch_misc_action: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}
