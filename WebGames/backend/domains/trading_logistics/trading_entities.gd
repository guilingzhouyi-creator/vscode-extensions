# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/trading_logistics/trading_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/trading.json | 信号: EventBus 领域广播
# 职责说明: 城镇局部集市商品库存供需弹性参数、跨国商队货单与护卫编队。 默认商品/商队参数由 config/trading.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name TownMarketCommodity extends RefCounted

var item_id: String = ""
var item_name: String = GameConfig.get_string("domains.trading", "commodity_defaults/item_name", "精炼秘银")
var base_price: int = GameConfig.get_int("domains.trading", "commodity_defaults/base_price", 100)
var supply_units: float = GameConfig.get_float("domains.trading", "commodity_defaults/supply_units", 50.0)
var demand_units: float = GameConfig.get_float("domains.trading", "commodity_defaults/demand_units", 50.0)
var elasticity_coef: float = GameConfig.get_float("domains.trading", "commodity_defaults/elasticity_coef", 0.5)

# Phase 38 动态市场反馈字段（运行时状态——交易行为与时间演化反向影响市场）
var last_price: int = -1              # 上次成交价（变化率上限比较基准；-1 = 未定价）
var accumulated_volume: float = 0.0   # 累计成交量（成交量反馈输入）
var last_price_tick: int = 0          # 上次定价的世界刻度（时间演化相位基准）

class TradeCaravanEntity extends RefCounted:
	var caravan_id: String = ""
	var origin_town_id: String = GameConfig.get_string("domains.trading", "caravan_defaults/origin_town_id", "TOWN_A")
	var destination_town_id: String = GameConfig.get_string("domains.trading", "caravan_defaults/destination_town_id", "TOWN_B")
	var cargo_manifest: Array = [] # [{ "item_id": "...", "quantity": 20, "unit_cost": 80 }]
	var guards_count: int = GameConfig.get_int("domains.trading", "caravan_defaults/guards_count", 10)
	var progress_ratio: float = 0.0 # 0.0 ~ 1.0
	var is_intercepted: bool = false
