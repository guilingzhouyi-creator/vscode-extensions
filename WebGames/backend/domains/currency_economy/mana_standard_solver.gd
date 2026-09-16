# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/currency_economy/mana_standard_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/currency.json | 信号: EventBus 领域广播
# 职责说明: 魔单晶本位购买力平价 (PPP) 换算、七大洲汇率跨国套利收益求解。 本位换算常数由 config/currency.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CurrencyAndManaStandardSolver extends RefCounted

## 魔单晶战略能源本位换算器 (购买力平价 PPP 求解)
static func convert_mana_crystals_to_gold(crystals_count: int, continent_ppp_ratio: float = 1.0) -> int:
	var base_gold_per_crystal := GameConfig.get_int("domains.currency", "mana_standard/base_gold_per_crystal", 100)
	var ppp_floor := GameConfig.get_float("domains.currency", "mana_standard/ppp_floor", 0.1)
	return int(floor(float(crystals_count * base_gold_per_crystal) * max(ppp_floor, continent_ppp_ratio)))

## 七大洲汇率购买力平价套利收益求解器
static func calculate_cross_continent_arbitrage(
	base_price_gold: float,
	export_continent_rate: float,
	import_continent_rate: float
) -> Dictionary:
	var buy_cost = base_price_gold * export_continent_rate
	var sell_revenue = base_price_gold * import_continent_rate
	var gross_profit = sell_revenue - buy_cost
	var profit_margin = gross_profit / max(1.0, buy_cost)

	return {
		"buy_cost_gold": buy_cost,
		"sell_revenue_gold": sell_revenue,
		"gross_profit_gold": gross_profit,
		"profit_margin_percent": profit_margin * 100.0
	}
