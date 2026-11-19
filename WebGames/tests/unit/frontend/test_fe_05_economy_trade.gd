# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第5卷: 经济与交易系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_05_economy_trade.gd
# ==============================================================================
class_name TestFE05EconomyTrade
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 05: 经济与交易系统（钱包/商铺/集市/物流/物价图）"

	results.append(_test_wallet_currency_conversion())
	results.append(_test_shop_shelf_browser())
	results.append(_test_price_trend_graph_data())
	results.append(_test_mounted_real_economy_trade())

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
	view.apply_snapshot({"wallet_gold": 2, "wallet_silver": 50, "wallet_copper": 25, "wallet_crystals": 10})
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
	view.apply_snapshot({"shop_title": "中央集市铁匠铺", "shop_shelves": [
		{"item_id": "POTION_HP", "price_gold": 1, "stock": 50},
		{"item_id": "IRON_SWORD", "price_gold": 15, "stock": 3}
	]})

	var passed = (view.shop_shelves.size() == 2) and (view.shop_title == "中央集市铁匠铺")
	view.free()
	return {
		"test": "TC-FE05-02: 地缘商铺有限货架与单价库存浏览",
		"passed": passed
	}

static func _test_price_trend_graph_data() -> Dictionary:
	var view = EconomyTradeView.new()
	view.apply_snapshot({"price_trend": [100, 105, 98, 120, 135, 130, 140]})

	var passed = (view.price_trend_history.size() == 7) and (view.price_trend_history[6] == 140)
	view.free()
	return {
		"test": "TC-FE05-03: 集市大宗商品7日物价弹性走势数据装载",
		"passed": passed
	}

static func _test_mounted_real_economy_trade() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/economy_trade/economy_trade_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: EconomyTradeView = mount_handle.get("view", null) as EconomyTradeView
	if mounted_view != null:
		mounted_view.apply_snapshot({"wallet_gold": 3, "wallet_silver": 20, "wallet_copper": 10, "wallet_crystals": 5})
		mounted_view._on_tab_changed(1)
		mounted_view._on_shop_confirm_pressed()
		mounted_view._on_tab_changed(0)
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and mounted_view.calculate_total_copper_value() == 32010
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE05-04: 真场景挂载 economy_trade_view.tscn（real 模式页签切换与零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}
