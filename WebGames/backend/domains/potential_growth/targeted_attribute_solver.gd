# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/potential_growth/targeted_attribute_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/potential.json | 信号: EventBus 领域广播
# 职责说明: 玩家定向加点：潜能点 → 统一等级提升（1~6 级，经 AttributeConversionEngine 规则校验），成本曲线按等级破阶递减 C(L) = base + floor((L-base)/tier_size)。 加点只动 L1 等级层（显示等级），底层实际值由换算引擎统一得出。 公式参数由 config/domains/potential.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name TargetedAttributeSolver extends RefCounted

const STAT_STR: String = "STR"
const STAT_CON: String = "CON"
const STAT_INT: String = "INT"
const STAT_AGI: String = "AGI"
const STAT_SPR: String = "SPR"
const STAT_VIT: String = "VIT"

const DEFAULT_STAT_LIST: Array[String] = [STAT_STR, STAT_CON, STAT_INT, STAT_AGI, STAT_SPR, STAT_VIT]

## 破阶成本（按统一等级）：C(L) = base + floor((L - base) / tier_size)
## 默认 1 + floor((L-1)/2)：1~2 级 1 点 / 3~4 级 2 点 / 5~6 级 3 点
static func calculate_point_cost_for_next_stat(current_level: int) -> int:
	var base := GameConfig.get_int("domains.potential", "point_cost/base", 1)
	# L1（Phase 55）：分母下限守卫（Inv-VD-1）——tier_size=0 配置会 int/int 除零（对齐 respec maxf(1,…) 惯例）
	var tier_size := maxi(1, GameConfig.get_int("domains.potential", "point_cost/tier_size", 2))
	return base + int(floor(max(0, current_level - base) / tier_size))

## 定向加点：潜能点 → 等级 +1（统一 6 级上限，超限拒绝），底层实际值经换算引擎联动
static func allocate_targeted_point(
	sheet: CharacterPhysiologySheet,
	engine: PotentialGrowthEngine,
	stat_name: String
) -> Dictionary:
	var allowed: Array = GameConfig.get_array("domains.potential", "growth/stat_list", DEFAULT_STAT_LIST)
	if not stat_name in allowed:
		var msg := GameConfig.get_string("narratives.potential", "invalid_stat", "Invalid stat name: %s") % stat_name
		return { "success": false, "reason": msg }

	var cur_level: int = sheet.get_level(stat_name)
	if cur_level >= AttributeConversionEngine.max_level():
		var msg_max := GameConfig.get_string("narratives.potential", "max_level_reached", "Attribute %s already at max level %d") % [stat_name, AttributeConversionEngine.max_level()]
		return { "success": false, "reason": msg_max }

	var cost = calculate_point_cost_for_next_stat(cur_level)
	if engine.unassigned_potential_points < cost:
		var msg2 := GameConfig.get_string("narratives.potential", "not_enough_points", "Not enough potential points. Need %d, have %d") % [cost, engine.unassigned_potential_points]
		return { "success": false, "reason": msg2 }

	engine.unassigned_potential_points -= cost
	engine.allocated_points_history[stat_name] = engine.allocated_points_history.get(stat_name, 0) + cost

	# 统一规则校验：等级提升经 set_level（1~6 级上限），失败整体回滚
	if not sheet.set_level(stat_name, cur_level + 1):
		engine.unassigned_potential_points += cost
		engine.allocated_points_history[stat_name] = engine.allocated_points_history.get(stat_name, 0) - cost
		var msg3 := GameConfig.get_string("narratives.potential", "max_level_reached", "Attribute %s already at max level %d") % [stat_name, AttributeConversionEngine.max_level()]
		return { "success": false, "reason": msg3 }

	LifeCycleAndPhysiologySolver.calculate_somatic_function(sheet)
	return {
		"success": true,
		"cost": cost,
		"new_level": cur_level + 1,
		"new_actual_value": sheet.get_actual_value(stat_name),
		"remaining_points": engine.unassigned_potential_points
	}
