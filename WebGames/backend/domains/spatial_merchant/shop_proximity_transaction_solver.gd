# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/spatial_merchant/shop_proximity_transaction_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_merchant.json | 信号: EventBus 领域广播
# 职责说明: 检定肉身物理距离 (D <= R)、扣除有限库存与货架货币扣减结算
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name ShopProximityTransactionSolver
extends RefCounted

## 空间邻近检定：肉身距离 D ≤ 交互半径 R
static func check_spatial_proximity(
	player_pos: Vector2,
	shop: MerchantShopAggregate
) -> bool:
	return SpatialMath.within_radius(player_pos, shop.local_position, shop.interaction_radius_meters)

## 货架购买五段流水：邻近/货架库存/价格钱包/背包空间检定后原子扣款扣库存（失败回滚快照）
static func buy_item(
	player_pos: Vector2,
	shop: MerchantShopAggregate,
	item_index: int,
	buy_count: int,
	wallet: CharacterWalletEntity,
	inventory: WearableInventoryAggregate,
	library: AccountItemLibraryAggregate = null
) -> Dictionary:
	if shop == null or wallet == null:
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	var max_buy_count := maxi(1, GameConfig.get_int("domains.spatial_merchant", "transaction/max_buy_count", 100))
	if buy_count <= 0 or buy_count > max_buy_count:
		return {"success": false, "error_code": "INVALID_BUY_COUNT"}
	# 1. 空间邻近检定
	if not check_spatial_proximity(player_pos, shop):
		return {
			"success": false,
			"error_code": "OUT_OF_PROXIMITY_RANGE",
			"error_message": _msg("shop_too_far") % shop.interaction_radius_meters
		}

	# 2. 货架索引与库存检定
	if item_index < 0 or item_index >= shop.shelf_inventory.size():
		return {
			"success": false,
			"error_code": "INVALID_SHELF_INDEX",
			"error_message": _msg("goods_not_found")
		}

	var shelf_item: Dictionary = shop.shelf_inventory[item_index]
	# 空库存/负值/非法类型数据守卫：null、非整数或负库存一律拒绝，杜绝穿透到扣款分支
	var raw_stock = shelf_item.get("stock_count")
	if not (raw_stock is int) or int(raw_stock) < 0:
		return {"success": false, "error_code": "INVALID_STOCK", "error_message": _msg("stock_insufficient") % 0}
	var available_stock: int = raw_stock
	if available_stock < buy_count:
		return {
			"success": false,
			"error_code": "INSUFFICIENT_STOCK",
			"error_message": _msg("stock_insufficient") % available_stock
		}

	# 3. 价格与钱包检定（null/非整数/负价格统一 INVALID_PRICE，扣款前拒绝）
	var raw_gold = shelf_item.get("price_gold")
	var raw_silver = shelf_item.get("price_silver")
	if not (raw_gold is int and raw_silver is int) or int(raw_gold) < 0 or int(raw_silver) < 0:
		return {"success": false, "error_code": "INVALID_PRICE"}
	var unit_gold: int = raw_gold
	var unit_silver: int = raw_silver
	var total_gold = unit_gold * buy_count
	var total_silver = unit_silver * buy_count

	if wallet.gold < total_gold or wallet.silver < total_silver:
		return {
			"success": false,
			"error_code": "INSUFFICIENT_FUNDS",
			"error_message": _msg("funds_insufficient")
		}

	# 4. 背包空间检定
	var fallback_tpl := GameConfig.get_string("domains.spatial_merchant", "goods/fallback_template_id", "ITEM_GOODS")
	var template_id = shelf_item.get("item_template_id", fallback_tpl)
	var new_item: ItemEntity = null
	if inventory != null:
		var catalog := GameBootstrap.catalog()
		var proto = catalog.get_prototype(str(template_id))
		if proto == null:
			return {"success": false, "error_code": "ITEM_NOT_REGISTERED"}
		new_item = ItemInstanceFactory.build_instance(proto, proto.english_name, "SHOP_")
		new_item.mass_kg *= float(buy_count)
		new_item.volume_slots *= buy_count
	var wallet_snapshot := wallet.to_dictionary()
	var inventory_snapshot := inventory.snapshot() if inventory != null else {}
	if inventory != null and not inventory.add_item(new_item):
		return {
			"success": false,
			"error_code": "INVENTORY_FULL",
			"error_message": _msg("inventory_full")
		}

	# 物品统计：购买 = 商品进入背包（获得），消耗的是货币而非物品
	if library != null and not template_id.is_empty():
		ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_GRANTED, template_id, buy_count)

	# 5. 执行扣款与库存扣减
	var paid := wallet.apply_transaction({"gold": -total_gold, "silver": -total_silver}, true)
	if not paid.get("success", false):
		if inventory != null:
			inventory.restore(inventory_snapshot)
		wallet.from_dictionary(wallet_snapshot)
		return {"success": false, "error_code": paid.get("error_code", "TRANSACTION_FAILED")}
	shelf_item["stock_count"] = available_stock - buy_count

	return {
		"success": true,
		"item_template_id": template_id,
		"purchased_count": buy_count,
		"cost_gold": total_gold,
		"cost_silver": total_silver,
		"remaining_stock": shelf_item["stock_count"]
	}

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("spatial_merchant", key)
