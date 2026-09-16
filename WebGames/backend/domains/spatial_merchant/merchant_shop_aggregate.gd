# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/spatial_merchant/merchant_shop_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_merchant.json | 信号: EventBus 领域广播
# 职责说明: 物理商铺实体定义，挂载微观空间坐标、辐射交互半径与货架有限动态库存
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name MerchantShopAggregate
extends RefCounted

enum ShopType {
	TOWN_FIXED_STORE,       # 城镇常驻官方商铺
	BLACK_MARKET_STALL,     # 地下黑市隐秘摊位
	ROAMING_LEYLINE_PEDDLER # 地脉巡游神秘商人
}

var shop_id: String = ""                         # 商铺全局唯一 ID
var localized_name: String = ""                  # 商铺招牌名称
var shop_type: ShopType = ShopType.TOWN_FIXED_STORE
var owner_npc_id: String = ""                    # 店主 NPC ID

# 空间锚点与交互半径 (米制)
var location_town_id: String = GameConfig.get_string("domains.world", "node_defaults/town_id", "TOWN_VALAN")
var local_position: Vector2 = Vector2.ZERO
var interaction_radius_meters: float = GameConfig.get_float("domains.spatial_merchant", "shop/interaction_radius_meters", 3.5)       # 交互触发最大半径

# 游荡商人时效控制
var is_temporary: bool = false
var despawn_timestamp_utc: int = 0               # 撤摊转移时间戳

# 货架动态库存列表 (Array of Dictionary)
# [{"item_template_id": "POTION_HEALTH", "stock_count": 20, "price_gold": 5, "price_silver": 0}]
var shelf_inventory: Array[Dictionary] = []

## 商铺聚合构造（ID/招牌名/类型）
func _init(p_id: String = "", p_name: String = "", p_type: ShopType = ShopType.TOWN_FIXED_STORE) -> void:
	shop_id = p_id
	localized_name = p_name
	shop_type = p_type

## 上架货架商品（模板 ID/库存/金/银定价）
func add_shelf_item(template_id: String, count: int, price_gold: int, price_silver: int = 0) -> void:
	shelf_inventory.append({
		"item_template_id": template_id,
		"stock_count": count,
		"price_gold": price_gold,
		"price_silver": price_silver
	})
