# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/commission_quest/commission_settlement_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/commission_quest.json | 信号: EventBus 领域广播
# 职责说明: 判定冒险者资质阶位准入、计算组织手续费抽成并划拨双方钱包与公会金库
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name CommissionSettlementSolver
extends RefCounted

## 资质准入判定：冒险者阶位 ≥ 委托要求阶位
static func check_qualification(commission: CommissionAggregate, adventurer_tier: CommissionAggregate.CommissionTier) -> bool:
	return int(adventurer_tier) >= int(commission.required_tier)

## 佣金分成计算：组织税率钳制 [0,1] 后拆税金/净赏金（金库与冒险者钱包划拨）
static func calculate_payout_split(commission: CommissionAggregate) -> Dictionary:
	var total_gold = commission.reward_gold
	var total_crystals = commission.reward_mana_crystals

	var safe_tax_rate: float = clampf(commission.org_tax_rate, 0.0, 1.0)
	var tax_gold = int(round(float(total_gold) * safe_tax_rate))
	var net_gold = total_gold - tax_gold

	var tax_crystals = int(round(float(total_crystals) * safe_tax_rate))
	var net_crystals = total_crystals - tax_crystals

	return {
		"total_gold": total_gold,
		"tax_gold_to_guild": tax_gold,
		"net_gold_to_adventurer": net_gold,
		"total_crystals": total_crystals,
		"tax_crystals_to_guild": tax_crystals,
		"net_crystals_to_adventurer": net_crystals
	}
