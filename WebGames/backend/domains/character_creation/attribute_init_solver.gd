# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/attribute_init_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 天命掷骰（4d6-Drop-Lowest）随机模拟与天平购点（27 Point-Buy）平衡算法， 产出统一 1~6 级 L1 等级；骰制与购点表由 config/domains/character_creation.json 驱动（零硬编码），RNG 实例可注入以保证「一个种子 = 一整套属性」的确定性。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AttributeInitSolver：Headless Discrete Solver / Numerical Calculator
class_name AttributeInitSolver extends RefCounted

# ==============================================================================
# 一、骰制配置（config/domains/character_creation.json attribute_init/dice/*）
# ==============================================================================

## 骰子数量（attribute_init/dice/count，默认 4）
static func _dice_count() -> int:
	return GameConfig.get_int("domains.character_creation", "attribute_init/dice/count", 4)

## 骰子面数（attribute_init/dice/sides，默认 6）
static func _dice_sides() -> int:
	return GameConfig.get_int("domains.character_creation", "attribute_init/dice/sides", 6)

## 丢弃最低骰数量（attribute_init/dice/drop_lowest，默认 1）
static func _drop_lowest() -> int:
	return GameConfig.get_int("domains.character_creation", "attribute_init/dice/drop_lowest", 1)

# ==============================================================================
# 二、天命掷骰算法（4d6-Drop-Lowest）
# ==============================================================================

## 4d6 掷骰去最低求和；rng 为空时回退共享实例，传入实例即可复现同一组掷骰结果。
## 契约：drop_lowest 收敛到 [0, size-1]（至少保留 1 骰），返回 [1, 24] 区间骰值总和。
static func roll_4d6_drop_lowest(rng: DeterministicRNG = null) -> int:
	var dice_rng := DeterministicRNG.resolve(rng)
	var rolls: Array = []
	var dice_count := _dice_count()
	var sides := _dice_sides()
	for roll_index in range(dice_count):
		rolls.append(dice_rng.randi_range(1, sides))
	rolls.sort()
	# 域收敛（Inv-VD-1/域内）：负值配置会以负起点 range 越界访问
	# （rolls[-size-1] 运行错误）；≥dice_count 则静默全丢（sum=0 恒 1 级）。下限收敛至少保留 1 骰
	var drop := clampi(_drop_lowest(), 0, maxi(0, rolls.size() - 1))
	var sum := 0
	for kept_index in range(drop, rolls.size()):
		sum += int(rolls[kept_index])
	return sum

## 六维共用同一 RNG 实例，保证「一个种子 = 一整套属性」。
## 契约：六维各掷一轮 4d6 后映射为统一等级，返回六维等级字典（确定性可复现）。
static func generate_rolled_attributes(rng: DeterministicRNG = null) -> Dictionary:
	var attribute_rng := DeterministicRNG.resolve(rng)
	return {
		"STR": map_roll_to_level(roll_4d6_drop_lowest(attribute_rng)),
		"CON": map_roll_to_level(roll_4d6_drop_lowest(attribute_rng)),
		"INT": map_roll_to_level(roll_4d6_drop_lowest(attribute_rng)),
		"AGI": map_roll_to_level(roll_4d6_drop_lowest(attribute_rng)),
		"SPR": map_roll_to_level(roll_4d6_drop_lowest(attribute_rng)),
		"VIT": map_roll_to_level(roll_4d6_drop_lowest(attribute_rng))
	}

## 天命掷骰结果 → 统一等级：3~18 线性映射到 1~6 级，上限随配置联动。
## 契约：roll 越界由 clamp 收敛进 [min_level, max_level]。
static func map_roll_to_level(roll: int) -> int:
	var ratio := float(AttributeConversionEngine.max_level()) / 18.0
	return int(clamp(ceil(float(roll) * ratio), float(AttributeConversionEngine.min_level()), float(AttributeConversionEngine.max_level())))

# ==============================================================================
# 三、天平购点平衡算法（Point-Buy）
# ==============================================================================

## 天平购点校验（统一等级 1~6）：每级消耗 = 等级数（1 级 1 点 … 6 级 6 点）。
## 契约：六维键缺失按 min 默认回退；越界或总消耗超限返回 { valid:false, reason }，
##       通过返回 { valid:true, total_spent, remaining_points }（无副作用）。
static func validate_point_buy_allocation(allocated_stats: Dictionary, max_points: int = -1) -> Dictionary:
	var required_keys: Array = GameConfig.get_array("domains.character_creation", "attribute_init/point_buy/required_keys", AttributeConversionEngine.DEFAULT_STAT_LIST)
	var total_limit := max_points if max_points >= 0 else GameConfig.get_int("domains.character_creation", "attribute_init/point_buy/total_points", 21)
	var min_level := AttributeConversionEngine.min_level()
	var max_level := AttributeConversionEngine.max_level()
	var total_spent := 0
	var out_of_range_template := GameConfig.get_string("narratives.character_creation", "point_buy_out_of_range", "Attribute %s out of range [%d, %d]: %d")

	for stat_key in required_keys:
		var stat_value: int = int(allocated_stats.get(stat_key, min_level))
		if stat_value < min_level or stat_value > max_level:
			var out_of_range_message := out_of_range_template % [stat_key, min_level, max_level, stat_value]
			return { "valid": false, "reason": out_of_range_message }
		total_spent += stat_value

	if total_spent > total_limit:
		var exceed_message := GameConfig.get_string("narratives.character_creation", "point_buy_exceed", "Total points spent %d exceeds limit %d") % [total_spent, total_limit]
		return { "valid": false, "reason": exceed_message }

	return { "valid": true, "total_spent": total_spent, "remaining_points": total_limit - total_spent }
