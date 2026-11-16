# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_crafting_service.gd
# 架构定位: Domain Boundary Interface / Crafting Service Contract
# 依赖与触发: 上游: 制造工坊视图, ServiceContainer | 下游: MockCraftingService
# 职责说明: 规范强化成功率预测与分解产出计算接口，隔离底层制造公式与配置读取。
# 退出语义与设计依据: 表现层零制造概率计算与领域边界解耦契约
# ==============================================================================

## ICraftingService：制造工坊强化与分解服务抽象接口
class_name ICraftingService
extends RefCounted

## 预测强化成功率（返回 {success, rate}）；衰减公式与钳制在服务层
func preview_enhance_rate(_target_level: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "ICraftingService.preview_enhance_rate: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 分发锻造、强化与分解协议动作（默认兼容回执）
func dispatch_crafting_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
