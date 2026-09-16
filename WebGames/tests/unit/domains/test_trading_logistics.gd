# ==============================================================================
# 单元测试：领域 11 交易系统与商队物流 (Trading & Logistics Tests)
# 文件路径: res://tests/unit/domains/test_trading_logistics.gd
# ==============================================================================
class_name TestTradingDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_supply_demand_elasticity())
	results.append(test_dumping_market_shock())
	results.append(test_caravan_logistics_and_arrival())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 11: 交易系统与跨国物流", "all_passed": all_passed, "results": results }

static func test_supply_demand_elasticity() -> Dictionary:
	var comm := TownMarketCommodity.new()
	comm.base_price = 100
	comm.supply_units = 20.0
	comm.demand_units = 80.0
	var p_shortage = MarketElasticityAndTradingSolver.calculate_market_price(comm)
	var passed = (p_shortage > comm.base_price)
	return { "test": "TC-TRD-01: 供需短缺引发弹性溢价计算", "passed": passed, "price": p_shortage }

static func test_dumping_market_shock() -> Dictionary:
	var comm := TownMarketCommodity.new()
	comm.base_price = 100
	comm.supply_units = 50.0
	comm.demand_units = 50.0
	var p_after_dump = MarketElasticityAndTradingSolver.simulate_dumping_impact(comm, 200.0)
	var passed = (p_after_dump < comm.base_price)
	return { "test": "TC-TRD-02: 大宗倾销引发局部集市价格暴跌断言", "passed": passed, "price": p_after_dump }

static func test_caravan_logistics_and_arrival() -> Dictionary:
	var caravan := TownMarketCommodity.TradeCaravanEntity.new()
	caravan.caravan_id = "CARAVAN_01"
	caravan.destination_town_id = "TOWN_EMPIRE"
	caravan.guards_count = 20
	var step1 = CaravanLogisticsFSM.advance_caravan_progress(caravan, 0.5, 0.2)
	var step2 = CaravanLogisticsFSM.advance_caravan_progress(caravan, 0.6, 0.2)
	var passed = (step1.progress == 0.5) and step2.arrived
	return { "test": "TC-TRD-03: 跨大陆商队物流安全运抵闭环", "passed": passed, "arrived": step2.arrived }
