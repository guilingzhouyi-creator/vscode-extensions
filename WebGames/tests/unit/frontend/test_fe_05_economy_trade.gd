# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第5卷: 经济与交易系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_05_economy_trade.gd
# ==============================================================================
class_name TestFE05EconomyTrade
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 05: 经济与交易系统（钱包/商铺/集市/物流/物价图）"

	results.append(_test_wallet_currency_conversion())
	results.append(_test_shop_shelf_browser())
	results.append(_test_price_trend_graph_data())

	var passed_cnt = 0
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

static func _test_wallet_currency_conversion() -> Dictionary:
	var view = EconomyTradeView.new()
	view.set_wallet_snapshot(2, 50, 25, 10)
	var total_copper = view.calculate_total_copper_value()
	# 2*10000 + 50*100 + 25 = 20000 + 5000 + 25 = 25025

	var passed = (total_copper == 25025) and (view.wallet_mana_monocrystals == 10)
	view.free()
	return {
		"test": "TC-FE05-01: 钱包四级金属货币折算与魔单晶资产展示",
		"passed": passed
	}

static func _test_shop_shelf_browser() -> Dictionary:
	var view = EconomyTradeView.new()
	view.set_shop_shelves_snapshot("中央集市铁匠铺", [
		{ "item_id": "POTION_HP", "price_gold": 1, "stock": 50 },
		{ "item_id": "IRON_SWORD", "price_gold": 15, "stock": 3 }
	])

	var passed = (view.shop_shelves.size() == 2) and (view.shop_title == "中央集市铁匠铺")
	view.free()
	return {
		"test": "TC-FE05-02: 地缘商铺有限货架与单价库存浏览",
		"passed": passed
	}

static func _test_price_trend_graph_data() -> Dictionary:
	var view = EconomyTradeView.new()
	view.set_price_trend_snapshot([100, 105, 98, 120, 135, 130, 140])

	var passed = (view.price_trend_history.size() == 7) and (view.price_trend_history[6] == 140)
	view.free()
	return {
		"test": "TC-FE05-03: 集市大宗商品7日物价弹性走势数据装载",
		"passed": passed
	}
