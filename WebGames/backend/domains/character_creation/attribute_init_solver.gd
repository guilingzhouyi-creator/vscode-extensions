# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/attribute_init_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 天命掷骰（4d6-Drop-Lowest）随机模拟与天平购点（27 Point-Buy）平衡算法， 产出统一 1~6 级 L1 等级；骰制与购点表由 config/domains/character_creation.json 驱动（零硬编码），RNG 实例可注入以保证「一个种子 = 一整套属性」的确定性。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name AttributeInitializationSolver extends RefCounted

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
## 契约：drop_lowest 收敛到 [0, size-1]（保底保留 1 骰），返回 [1, 24] 区间骰值总和。
static func roll_4d6_drop_lowest(rng: DeterministicRNG = null) -> int:
	var dice_rng := DeterministicRNG.resolve(rng)
	var rolls: Array = []
	var cnt := _dice_count()
	var sides := _dice_sides()
	for i in range(cnt):
		rolls.append(dice_rng.randi_range(1, sides))
	rolls.sort()
	# L1（Phase 55）：drop_lowest 域收敛（Inv-VD-1/域内）——负值配置以负起点 range 越界访问
	#（rolls[-size-1] 运行错误）；≥cnt 则静默全丢（sum=0 恒 1 级）。收敛保底至少保留 1 骰
	var drop := clampi(_drop_lowest(), 0, maxi(0, rolls.size() - 1))
	var sum := 0
	for i in range(drop, rolls.size()):
		sum += int(rolls[i])
	return sum

## 六维共用同一 RNG 实例，保证「一个种子 = 一整套属性」。
## 契约：六维各掷一轮 4d6 后映射为统一等级，返回六维等级字典（确定性可复现）。
static func generate_rolled_attributes(rng: DeterministicRNG = null) -> Dictionary:
	var attr_rng := DeterministicRNG.resolve(rng)
	return {
		"STR": map_roll_to_level(roll_4d6_drop_lowest(attr_rng)),
		"CON": map_roll_to_level(roll_4d6_drop_lowest(attr_rng)),
		"INT": map_roll_to_level(roll_4d6_drop_lowest(attr_rng)),
		"AGI": map_roll_to_level(roll_4d6_drop_lowest(attr_rng)),
		"SPR": map_roll_to_level(roll_4d6_drop_lowest(attr_rng)),
		"VIT": map_roll_to_level(roll_4d6_drop_lowest(attr_rng))
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
## 契约：六维键缺失按 min 兜底；越界或总消耗超限返回 { valid:false, reason }，
##       通过返回 { valid:true, total_spent, remaining_points }（无副作用）。
static func validate_point_buy_allocation(allocated_stats: Dictionary, max_points: int = -1) -> Dictionary:
	var required_keys: Array = GameConfig.get_array("domains.character_creation", "attribute_init/point_buy/required_keys", ["STR", "CON", "INT", "AGI", "SPR", "VIT"])
	var total_limit := max_points if max_points >= 0 else GameConfig.get_int("domains.character_creation", "attribute_init/point_buy/total_points", 21)
	var min_v := AttributeConversionEngine.min_level()
	var max_v := AttributeConversionEngine.max_level()
	var total_spent := 0

	for k in required_keys:
		var val = int(allocated_stats.get(k, min_v))
		if val < min_v or val > max_v:
			var msg := GameConfig.get_string("narratives.character_creation", "point_buy_out_of_range", "Attribute %s out of range [%d, %d]: %d") % [k, min_v, max_v, val]
			return { "valid": false, "reason": msg }
		total_spent += val

	if total_spent > total_limit:
		var msg2 := GameConfig.get_string("narratives.character_creation", "point_buy_exceed", "Total points spent %d exceeds limit %d") % [total_spent, total_limit]
		return { "valid": false, "reason": msg2 }

	return { "valid": true, "total_spent": total_spent, "remaining_points": total_limit - total_spent }
