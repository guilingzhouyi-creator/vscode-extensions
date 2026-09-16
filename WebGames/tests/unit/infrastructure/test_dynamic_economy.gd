# ==============================================================================
# 单元测试：动态市场经济与交易体系（Phase 38 S4 验收）
# 文件路径: res://tests/unit/infrastructure/test_dynamic_economy.gd
# 覆盖: TC-ECON-S4-01/02/03/07 —— 世界时间演化 / 成交量反馈 / 变化率上限 /
#       静态路径零回归（不退化固定价格表语义）
# ==============================================================================
class_name TestDynamicEconomyDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 38: 动态市场经济与交易体系验收"

	results.append(_test_time_evolution())
	results.append(_test_volume_feedback())
	results.append(_test_change_rate_cap())
	results.append(_test_static_path_unchanged())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

## TC-ECON-S4-01: 世界时间演化（同商品不同 tick 报价不同且非固定值）
static func _test_time_evolution() -> Dictionary:
	var c1 := _build_commodity()
	var c2 := _build_commodity()
	var p_tick5 := MarketElasticityAndTradingSolver.calculate_market_price(c1, 5)
	var p_tick17 := MarketElasticityAndTradingSolver.calculate_market_price(c2, 17)
	var p_tick5_again := MarketElasticityAndTradingSolver.calculate_market_price(_build_commodity(), 5)
	# 同 tick 同状态确定性一致；不同 tick 报价演化
	var passed = p_tick5 == p_tick5_again and p_tick5 != p_tick17
	return { "test": "TC-ECON-S4-01: 价格随世界时间演化（确定性且非固定值）", "passed": passed, "p5": p_tick5, "p17": p_tick17 }

## TC-ECON-S4-02: 成交量反馈（成交量变化反向影响报价）
static func _test_volume_feedback() -> Dictionary:
	var low_vol := _build_commodity()
	var high_vol := _build_commodity()
	high_vol.accumulated_volume = high_vol.supply_units * 5.0  # 大量成交 → 需求反馈推价
	var p_low := MarketElasticityAndTradingSolver.calculate_market_price(low_vol, 10)
	var p_high := MarketElasticityAndTradingSolver.calculate_market_price(high_vol, 10)
	var passed = p_high != p_low
	return { "test": "TC-ECON-S4-02: 成交量反馈影响报价（市场闭环）", "passed": passed, "p_low": p_low, "p_high": p_high }

## TC-ECON-S4-03: 单轮变化率上限（极端波动抑制——报价有界）
static func _test_change_rate_cap() -> Dictionary:
	var c := _build_commodity()
	# 首次定价（无 last_price——无上限约束）
	var first := MarketElasticityAndTradingSolver.calculate_market_price(c, 3)
	# 极端需求冲击后再次定价——变化率不得超过上次价 ± rate_max(0.25)
	c.demand_units = c.supply_units * 50.0
	var second := MarketElasticityAndTradingSolver.calculate_market_price(c, 4)
	var rate: float = abs(float(second - first)) / float(first)
	# 容忍度含 int(round) 边界（±1 价）；无变化率上限时 rate 将高达 ~390%——本断言验证上限真实生效
	var passed = rate <= 0.25 + 0.01
	return { "test": "TC-ECON-S4-03: 单轮变化率上限（极端波动抑制有界）", "passed": passed, "first": first, "second": second, "rate": rate }

## TC-ECON-S4-07: 静态路径零回归（world_tick 缺省 = 既有弹性定价不变）
static func _test_static_path_unchanged() -> Dictionary:
	var c := _build_commodity()
	var static_price := MarketElasticityAndTradingSolver.calculate_market_price(c)
	# base_price 100 × clamp(1 + 0.5×(50-50)/50) = 100
	var passed = static_price == 100
	return { "test": "TC-ECON-S4-07: 静态路径零回归（world_tick=0 保持既有弹性定价）", "passed": passed }

static func _build_commodity() -> TownMarketCommodity:
	var c := TownMarketCommodity.new()
	c.item_id = "TEST_ORE"
	c.base_price = 100
	c.supply_units = 50.0
	c.demand_units = 50.0
	c.elasticity_coef = 0.5
	return c
