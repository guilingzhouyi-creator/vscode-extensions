# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 30 地缘商铺系统单元测试
# 文件路径: res://tests/unit/domains/test_spatial_merchant.gd
# ==============================================================================
class_name TestSpatialMerchantDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 30: 空间邻近感知与地缘商铺交易系统"

	results.append(_test_spatial_proximity_enforcement())
	results.append(_test_shelf_stock_and_wallet_purchase())
	results.append(_test_pre_deduction_rejection())
	results.append(_test_roaming_peddler_lifecycle())

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

static func _test_spatial_proximity_enforcement() -> Dictionary:
	var shop := MerchantShopAggregate.new("SHOP_BLACKSMITH", "老铁匠铺")
	shop.local_position = Vector2(10.0, 10.0)
	shop.interaction_radius_meters = 3.0
	shop.add_shelf_item("IRON_SWORD", 5, 20)

	var wallet := CharacterWalletEntity.new()
	wallet.gold = 100

	# 玩家肉身在 (50, 50)，距离 56 米 -> 拦截 (OUT_OF_PROXIMITY_RANGE)
	var res_far = ShopProximityTransactionSolver.buy_item(Vector2(50.0, 50.0), shop, 0, 1, wallet, null)

	# 玩家肉身走近到 (11, 10)，距离 1 米 -> 允许交易
	var res_near = ShopProximityTransactionSolver.buy_item(Vector2(11.0, 10.0), shop, 0, 1, wallet, null)

	var passed = (not res_far.success) and (res_far.error_code == "OUT_OF_PROXIMITY_RANGE") and res_near.success and (wallet.gold == 80) and (shop.shelf_inventory[0]["stock_count"] == 4)
	return {
		"test": "TC-SHOP-01: 拒绝隔空商城，肉身物理空间邻近半径检定",
		"passed": passed
	}

static func _test_shelf_stock_and_wallet_purchase() -> Dictionary:
	var shop := MerchantShopAggregate.new("SHOP_POTION", "炼金药铺")
	shop.local_position = Vector2.ZERO
	shop.add_shelf_item("POTION_HEAL", 2, 10) # 仅剩 2 瓶

	var wallet := CharacterWalletEntity.new()
	wallet.gold = 50

	# 尝试购买 5 瓶 -> 拦截 (INSUFFICIENT_STOCK)
	var res_over = ShopProximityTransactionSolver.buy_item(Vector2.ZERO, shop, 0, 5, wallet, null)
	var passed = (not res_over.success) and (res_over.error_code == "INSUFFICIENT_STOCK")
	return {
		"test": "TC-SHOP-02: 有限库存货架超额购买拦截",
		"passed": passed
	}

static func _test_pre_deduction_rejection() -> Dictionary:
	# TC-QUAL-S2-03：空库存、负数量和负价格交易 → 扣款前拒绝，货币和库存均不变化
	var wallet := CharacterWalletEntity.new()
	wallet.gold = 100
	var shop := MerchantShopAggregate.new("SHOP_GUARD", "守卫测试铺")
	shop.local_position = Vector2.ZERO
	shop.shelf_inventory.append({
		"item_template_id": "POTION_HEAL",
		"stock_count": 0,      # 空库存（等价 null 空货架语义：数量不足）
		"price_gold": 5,
		"price_silver": 0
	})
	shop.shelf_inventory.append({
		"item_template_id": "POTION_HEAL",
		"stock_count": -3,     # 负库存：非法货架数据，扣款前拒绝
		"price_gold": 5,
		"price_silver": 0
	})
	shop.shelf_inventory.append({
		"item_template_id": "POTION_HEAL",
		"stock_count": 5,
		"price_gold": -5,      # 负价格：非法定价，扣款前拒绝
		"price_silver": 0
	})
	# 空库存（stock_count 为 null/缺键 → INVALID_STOCK）
	var res_null = ShopProximityTransactionSolver.buy_item(Vector2.ZERO, shop, 0, 1, wallet, null)
	# 负库存 → INVALID_STOCK
	var res_neg_stock = ShopProximityTransactionSolver.buy_item(Vector2.ZERO, shop, 1, 1, wallet, null)
	# 负价格 → INVALID_PRICE
	var res_neg_price = ShopProximityTransactionSolver.buy_item(Vector2.ZERO, shop, 2, 1, wallet, null)
	# 负数量 / 零数量 → INVALID_BUY_COUNT（扣款前拒绝）
	var res_neg_count = ShopProximityTransactionSolver.buy_item(Vector2.ZERO, shop, 2, -1, wallet, null)
	var res_zero_count = ShopProximityTransactionSolver.buy_item(Vector2.ZERO, shop, 2, 0, wallet, null)
	var passed = (not res_null.success) and (res_null.error_code == "INSUFFICIENT_STOCK") \
		and (not res_neg_stock.success) and (res_neg_stock.error_code == "INVALID_STOCK") \
		and (not res_neg_price.success) and (res_neg_price.error_code == "INVALID_PRICE") \
		and (not res_neg_count.success) and (res_neg_count.error_code == "INVALID_BUY_COUNT") \
		and (not res_zero_count.success) and (res_zero_count.error_code == "INVALID_BUY_COUNT") \
		and (wallet.gold == 100) \
		and (shop.shelf_inventory[2]["stock_count"] == 5)
	return {
		"test": "TC-SHOP-04: 空库存/负库存/负价格/非正数量扣款前拒绝（货币与货架不变）",
		"passed": passed
	}

static func _test_roaming_peddler_lifecycle() -> Dictionary:
	var peddler = RoamingMerchantFSM.spawn_roaming_peddler("PEDDLER_01", "TOWN_VALAN", Vector2(5, 5), 1000, 3600)

	var active_1 = RoamingMerchantFSM.is_peddler_active(peddler, 2000) # 处于存续期
	var active_2 = RoamingMerchantFSM.is_peddler_active(peddler, 5000) # 已过撤摊时间戳

	var passed = active_1 and (not active_2) and (peddler.is_temporary)
	return {
		"test": "TC-SHOP-03: 地脉游荡神秘商人时效刷新与超时撤摊",
		"passed": passed
	}
