# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_crafting_service.gd
# 架构定位: Domain Boundary Adapter / Real Crafting Service Bridge
# 依赖与触发: 上游: CraftingWorkshopView, ServiceContainer, ServiceLocator | 下游: EquipmentEnhancementSolver, RealProtocolBridge, GameConfig
# 职责说明: 实现 ICraftingService 接口，直连 domains.workshop 强化概率表与成本求解器，并经统一协议执行锻造与分解。
# 退出语义与设计依据: 表现层零制造概率公式计算与领域边界解耦契约
# ==============================================================================

## RealCraftingService：直连后端装备强化求解器、工坊概率表与协议派发的真实制造服务
class_name RealCraftingService
extends "res://frontend/domain_boundary/interfaces/i_crafting_service.gd"

## 预测强化目标等级成功率及金币/魔单晶消耗（直读 domains.workshop 权威概率表）
func preview_enhance_rate(target_level: int) -> Dictionary:
	var max_enhance_level: int = maxi(1, GameConfig.get_int("domains.workshop", "enhancement/max_level", 15))
	var bounded_level: int = maxi(0, mini(target_level, max_enhance_level))
	var configured_rates: Dictionary = GameConfig.get_dict("domains.workshop", "enhancement/success_rates", {})
	var level_key := str(bounded_level)
	var fallback_rate: float = GameConfig.get_float("domains.workshop", "enhancement/fallback_rate", 0.05)
	var resolved_rate: float = float(configured_rates.get(level_key, clampf(1.0 - float(bounded_level) * 0.05, fallback_rate, 1.0)))
	var enhance_cost: Dictionary = EquipmentEnhancementSolver.calculate_enhance_cost(maxi(0, bounded_level - 1))
	return {
		"success": true,
		"target_level": bounded_level,
		"rate": resolved_rate,
		"gold_cost": int(enhance_cost.get("gold_cost", 0)),
		"crystal_cost": int(enhance_cost.get("crystal_cost", 0)),
	}

## 分发制造/强化/分解协议动作至后端工作台域处理器
func dispatch_crafting_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return RealProtocolBridge.dispatch_flat("crafting", action_type, payload_data)
