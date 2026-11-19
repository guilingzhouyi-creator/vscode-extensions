# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_crafting_service.gd
# 架构定位: Domain Boundary Mock / Simulated Crafting Service
# 依赖与触发: 上游: MockServiceContainer, 制造工坊视图 | 下游: GameConfig
# 职责说明: 提供模拟制造工坊服务，基于 GameConfig 计算强化成功率线性衰减与上下限钳制。
# 退出语义与设计依据: 配置驱动数值读取收敛至领域边界层契约
# ==============================================================================

## MockCraftingService：制造工坊强化成功率模拟服务
class_name MockCraftingService
extends ICraftingService

const RULES_SECTION := "frontend.views"
const RULES_KEY := "fe12_crafting_workshop"

## 根据目标强化等级与 GameConfig 衰减参数计算钳制后的强化成功率
func preview_enhance_rate(target_level: int) -> Dictionary:
	var decay := GameConfig.get_float(RULES_SECTION, RULES_KEY + "/success_rate_decay_per_level", 0.05)
	var min_rate := GameConfig.get_float(RULES_SECTION, RULES_KEY + "/min_success_rate", 0.1)
	var max_rate := GameConfig.get_float(RULES_SECTION, RULES_KEY + "/max_success_rate", 1.0)
	var success_rate := clampf(1.0 - float(maxi(0, target_level)) * decay, min_rate, max_rate)
	return {"success": true, "rate": success_rate}

## 模拟分发锻造、强化与分解协议动作
func dispatch_crafting_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
