# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_market_gacha_fixtures.gd
# 架构定位: Economy & Gacha Mock Fixture Module
# 依赖与触发: 上游: MockDataCatalog | 下游: 无（静态演示数据真源）
# 职责说明: 提供经济商贸与祈愿卡池域的静态模拟夹具。
# 退出语义与设计依据: 模拟数据单一真源与按域模块化拆分契约
# ==============================================================================

## 经济交易与祈愿卡池域静态模拟数据集
extends RefCounted

static func _auction(item_slug: String, cat_slug: String, bid: int, buyout: int, seller_slug: String) -> Dictionary:
	return {
		"name": "ui.fe05.mock.auction." + item_slug,
		"category": "ui.fe05.auction." + cat_slug,
		"current_bid": bid,
		"buyout": buyout,
		"seller": "ui.fe05.mock.seller." + seller_slug,
	}

static func _caravan(name_slug: String, route_slug: String, status_slug: String, cargo_slug: String, freight: int, escort_slug: String) -> Dictionary:
	return {
		"name": "ui.fe05.mock.caravan." + name_slug,
		"route": "ui.fe05.mock.route." + route_slug,
		"status": "ui.fe05.logistics." + status_slug,
		"cargo": "ui.fe05.mock.cargo." + cargo_slug,
		"freight": freight,
		"escort": "ui.fe05.logistics." + escort_slug,
	}

static func _up_item(slug: String, rarity: String, recent: bool) -> Dictionary:
	return {
		"name": "ui.fe06.mock.item." + slug,
		"rarity": rarity,
		"is_recently_added": recent,
	}

## 构建商店、拍卖行、商队物流与大宗资源模拟数据
static func build_economy_data() -> Dictionary:
	return {
		"wallet": {"gold": 50, "silver": 20, "copper": 500, "mana_monocrystals": 5},
		"shop_title": "Sandbox General Store",
		"shop_items": [
			{"id": "IRON_SWORD", "name": "ui.fe05.mock.shop.iron_sword", "price_copper": 5000, "stock": 12},
			{"id": "HEALTH_POTION", "name": "ui.fe05.mock.shop.health_potion", "price_copper": 800, "stock": 45},
			{"id": "MANA_CRYSTAL_S", "name": "ui.fe05.mock.shop.mana_crystal_s", "price_copper": 12000, "stock": 3},
		],
		"price_trend": [
			{"day": - 6, "iron_ore": 85},
			{"day": - 5, "iron_ore": 88},
			{"day": - 4, "iron_ore": 92},
			{"day": - 3, "iron_ore": 90},
			{"day": - 2, "iron_ore": 95},
			{"day": - 1, "iron_ore": 98},
			{"day": 0, "iron_ore": 102},
		],
		"auction_items": [
			_auction("mithril_ingot", "cat_material", 8500, 12000, "iron_forge"),
			_auction("ancient_scroll", "cat_scroll", 15000, 25000, "arcane_academy"),
			_auction("dragon_scale", "cat_material", 22000, 35000, "dragon_slayer"),
			_auction("wind_bow", "cat_weapon", 6800, 10000, "ranger_camp"),
		],
		"auction_my_listings": [
			{
				"name": "ui.fe05.mock.listing.iron_ore",
				"ask_price": 900,
				"status": "ui.fe05.auction.status_selling",
				"expires": "ui.fe05.mock.listing.expires_2d",
			},
			{
				"name": "ui.fe05.mock.listing.old_leather",
				"ask_price": 300,
				"status": "ui.fe05.auction.status_sold",
				"expires": "ui.fe05.mock.listing.expires_none",
			},
		],
		"caravan_entries": [
			_caravan("silver_grove", "silver_to_valan", "status_transit", "herbs", 500, "escort_done"),
			_caravan("iron_freight", "iron_to_valan", "status_waiting", "iron_ore", 800, "escort_pending"),
			_caravan("dragon_expedition", "dragon_to_iron", "status_escort", "mana_stone", 2000, "escort_mercenary"),
		],
		"resource_pools": [
			{"name": "ui.fe05.commodity.wood", "current": 1200, "max": 2000, "rate": 15},
			{"name": "ui.fe05.commodity.iron_ore", "current": 800, "max": 1500, "rate": 8},
			{"name": "ui.fe05.commodity.mana_crystal", "current": 45, "max": 100, "rate": 2},
			{"name": "ui.fe05.commodity.herbs", "current": 320, "max": 500, "rate": 5},
		],
	}

## 构建卡池保底计数与限定/常驻卡池模拟数据
static func build_gacha_data() -> Dictionary:
	var b := "ui.fe06.mock.banner."
	return {
		"pity_5star": 45,
		"pity_4star": 3,
		"currency_primogems": 32000,
		"banners": [
			{
				"banner_id": "BANNER_LIMITED_WARRIOR",
				"title": b + "limited_warrior.title",
				"subtitle": b + "limited_warrior.subtitle",
				"remaining_time": b + "limited_warrior.remaining",
				"up_items": [
					_up_item("flame_knight", "5", true),
					_up_item("dragon_spine_greatsword", "5", false),
					_up_item("wind_shortbow", "4", false),
				],
			},
			{
				"banner_id": "BANNER_PERMANENT",
				"title": b + "permanent.title",
				"subtitle": b + "permanent.subtitle",
				"remaining_time": b + "permanent.remaining",
				"up_items": [
					_up_item("mithril_guardian", "5", false),
					_up_item("arcane_staff", "4", true),
					_up_item("healing_potion_l", "3", false),
				],
			},
		],
	}
