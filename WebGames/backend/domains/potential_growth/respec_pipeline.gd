# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/potential_growth/respec_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/potential.json | 信号: EventBus 领域广播
# 职责说明: 扣除金币与魔单晶因果代价，全额返还已加潜能点；洗点洗的是中间系数结构层： - L1 等级回退至基础（min_level、进度归零）； - L2 阅历重塑层重置为 1.0（先天基础系数不重置）； - L3 随机动态加点实际值保留（永久性，洗点不逆转）。 代价公式由 config/domains/potential.json 驱动，文案由 narratives/potential.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name AttributeRespecPipeline extends RefCounted

## 洗点成本：金币指数曲线（历史次数封顶）+ 魔单晶按已分配点折算（M9 分子钳 0 Inv-TX-2）
static func calculate_respec_cost(engine: PotentialGrowthEngine, respec_count_history: int = 0) -> Dictionary:
	var base_gold := GameConfig.get_int("domains.potential", "respec/base_gold", 100)
	var exp_base := GameConfig.get_float("domains.potential", "respec/gold_exp_base", 2.0)
	var max_exp := GameConfig.get_int("domains.potential", "respec/max_history_exponent", 5)
	var gold_cost = base_gold * int(pow(exp_base, min(max_exp, respec_count_history)))
	var divisor := maxf(1.0, GameConfig.get_float("domains.potential", "respec/crystal_divisor", 20.0))
	# M9 双保险：分子钳 0（Inv-TX-2）——即使调用方绕过 deserialize 直接构造越序 engine，
	# 成本亦不可能为负（负成本扣减 = 反向增发魔单晶）
	var crystal_cost = int(floor(float(maxi(0, engine.lifetime_potential_earned - engine.unassigned_potential_points)) / divisor))
	return { "gold_cost": gold_cost, "crystal_cost": crystal_cost }

## 心核重构执行：扣费 → 全额返还潜能点 → L1 等级回退/L2 阅历重置/L3 动态保留 → 重算体魄
static func execute_heart_core_respec(
	sheet: CharacterPhysiologySheet,
	engine: PotentialGrowthEngine,
	wallet: CharacterWalletEntity,
	respec_count_history: int = 0
) -> Dictionary:
	var cost = calculate_respec_cost(engine, respec_count_history)
	if wallet.gold < cost.gold_cost or wallet.mana_monocrystals < cost.crystal_cost:
		var msg := GameConfig.get_string("narratives.potential", "insufficient_gold_crystal", "Insufficient gold or mana crystals for respec.")
		return { "success": false, "reason": msg }

	wallet.gold -= cost.gold_cost
	wallet.mana_monocrystals -= cost.crystal_cost

	engine.unassigned_potential_points = engine.lifetime_potential_earned
	var init_keys: Array = GameConfig.get_array("domains.potential", "growth/stat_list", ["STR", "CON", "INT", "AGI", "SPR", "VIT"])
	var reset := {}
	for k in init_keys:
		reset[k] = 0
	engine.allocated_points_history = reset

	# L1 等级回退：定向加点等级全部退回基础（min_level）、进度归零（等级域经统一校验）
	for k in init_keys:
		sheet.set_level(k, AttributeConversionEngine.min_level())
		sheet.set_progress(k, 0.0)

	# L2 阅历重塑层重置（洗点洗的是中间系数结构层；先天基础系数 base_coefficients 不重置）
	sheet.experience_reshape = {}

	# L3 随机动态加点实际值保留（永久性，洗点不逆转）——dynamic_adjustments 不动

	LifeCycleAndPhysiologySolver.calculate_somatic_function(sheet)

	EventBusCore.get_instance().emit_narrative_by_key(
		"potential/respec_success", "lifecycle", [cost.gold_cost, cost.crystal_cost, engine.unassigned_potential_points]
	)

	return { "success": true, "refunded_points": engine.unassigned_potential_points }
