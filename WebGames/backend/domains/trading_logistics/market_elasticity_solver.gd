# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/trading_logistics/market_elasticity_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/trading.json | 信号: EventBus 领域广播
# 职责说明: 局部集市供需价格弹性方程、大宗倾销砸盘与平抑物价冲击求解。 定价 clamp 边界与保底价由 config/trading.json 的 market 段驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name MarketElasticityAndTradingSolver extends RefCounted

## 城镇集市局部供需弹性定价求解器。
## Phase 38 动态化：world_tick > 0 时叠加时间因子/成交量反馈/均值回归/变化率上限
## （economy.json 配置参数只作规则与权重——最终结果由运行时状态与时间共同计算，
## 不读永久固定数值；world_tick 缺省 0 = 既有静态弹性路径，零回归）。
static func calculate_market_price(commodity: TownMarketCommodity, world_tick: int = 0) -> int:
	# L1（Phase 55）：供需分母下限守卫（Inv-VD-1）——floor 与 supply 双 0 时 0/0 → inf/NaN 污染定价
	var safe_supply_floor := maxf(1.0, GameConfig.get_float("domains.trading", "market/safe_supply_floor", 1.0))
	var price_mult_min := GameConfig.get_float("domains.trading", "market/price_mult_min", 0.2)
	var price_mult_max := GameConfig.get_float("domains.trading", "market/price_mult_max", 5.0)
	var min_price := GameConfig.get_int("domains.trading", "market/min_price", 1)

	var safe_supply = max(safe_supply_floor, commodity.supply_units)
	var supply_gap = (commodity.demand_units - commodity.supply_units) / safe_supply
	var price_mult = clamp(1.0 + commodity.elasticity_coef * supply_gap, price_mult_min, price_mult_max)
	var base_result: int = maxi(min_price, int(round(float(commodity.base_price) * price_mult)))

	if world_tick > 0 and GameConfig.get_bool("domains.economy", "dynamic_market/enabled", true):
		return _apply_dynamic_factors(commodity, base_result, world_tick)
	return base_result

## Phase 38 动态因子：世界时间相位 + 成交量反馈 + 均值回归 + 单轮变化率上限（确定性纯函数）
static func _apply_dynamic_factors(commodity: TownMarketCommodity, base_price: int, world_tick: int) -> int:
	var time_cycle := maxi(1, GameConfig.get_int("domains.economy", "dynamic_market/time_cycle_ticks", 20))
	var time_weight := GameConfig.get_float("domains.economy", "dynamic_market/time_decay_factor", 0.02)
	var volume_weight := GameConfig.get_float("domains.economy", "dynamic_market/volume_feedback_strength", 0.1)
	var rate_max := GameConfig.get_float("domains.economy", "dynamic_market/price_change_rate_max", 0.25)
	var reversion := GameConfig.get_float("domains.economy", "dynamic_market/mean_reversion_strength", 0.05)

	# 时间因子：周期相位随世界时间演化（确定性——同 tick 同相位）
	var time_phase := float(world_tick % time_cycle) / float(time_cycle)
	var time_adjust := 1.0 + time_weight * sin(time_phase * TAU)
	# 成交量反馈：累计成交量相对供给的偏移（钳制在 ±1）
	var volume_adjust := 1.0 + volume_weight * clampf(
		commodity.accumulated_volume / maxf(1.0, commodity.supply_units), -1.0, 1.0
	)
	# 均值回归：向基础价收敛（防长期漂移）
	var dynamic_price := float(base_price) * time_adjust * volume_adjust
	dynamic_price += (float(commodity.base_price) - dynamic_price) * reversion
	# 单轮变化率上限：相对上次成交价的极端波动抑制
	if commodity.last_price > 0:
		var max_delta := float(commodity.last_price) * rate_max
		dynamic_price = clampf(dynamic_price, float(commodity.last_price) - max_delta, float(commodity.last_price) + max_delta)

	var result := maxi(GameConfig.get_int("domains.trading", "market/min_price", 1), int(round(dynamic_price)))
	commodity.last_price = result
	commodity.last_price_tick = world_tick
	return result

## 大宗商贸倾销价格冲击与砸盘求解器
static func simulate_dumping_impact(commodity: TownMarketCommodity, dumped_quantity: float) -> int:
	commodity.supply_units += dumped_quantity
	var new_price = calculate_market_price(commodity)
	return new_price
