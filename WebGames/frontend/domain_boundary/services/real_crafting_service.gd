# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_crafting_service.gd
# 架构定位: Domain Boundary Adapter / Real Crafting Service Bridge
# 依赖与触发: 上游: CraftingWorkshopView, ServiceContainer, ServiceLocator | 下游: EquipmentEnhancementSolver, GameConfig
# 职责说明: 实现 ICraftingService 接口，经由后端工坊配置与强化成本求解器计算强化成功率与消耗。
# 退出语义与设计依据: 表现层零制造概率公式计算与领域边界解耦契约
# ==============================================================================

## RealCraftingService：直连后端装备强化求解器与工坊配置的真实制造服务
class_name RealCraftingService
extends "res://frontend/domain_boundary/interfaces/i_crafting_service.gd"

const EquipmentEnhancementSolver = preload("res://backend/domains/workshop_forge/equipment_enhancement_solver.gd")

## 预测强化目标等级成功率及金币/魔单晶消耗
func preview_enhance_rate(target_level: int) -> Dictionary:
	var max_enhance_level: int = maxi(1, GameConfig.get_int("domains.workshop", "enhancement/max_level", 15))
	var bounded_level: int = maxi(0, mini(target_level, max_enhance_level))
	var decay_per_level: float = GameConfig.get_float("frontend.views", "fe12_crafting_workshop/success_rate_decay_per_level", 0.05)
	var floor_rate: float = GameConfig.get_float("frontend.views", "fe12_crafting_workshop/min_success_rate", 0.1)
	var ceiling_rate: float = GameConfig.get_float("frontend.views", "fe12_crafting_workshop/max_success_rate", 1.0)
	var resolved_rate: float = clampf(1.0 - float(bounded_level) * decay_per_level, floor_rate, ceiling_rate)
	var enhance_cost: Dictionary = EquipmentEnhancementSolver.calculate_enhance_cost(maxi(0, bounded_level - 1))
	return {
		"success": true,
		"target_level": bounded_level,
		"rate": resolved_rate,
		"gold_cost": int(enhance_cost.get("gold_cost", 0)),
		"crystal_cost": int(enhance_cost.get("crystal_cost", 0)),
	}
