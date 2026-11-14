# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/trading_logistics/trade_caravan_entity.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: CaravanLogisticsFSM | 下游: GameConfig | 配置: config/domains/trading.json
# 职责说明: 跨国商队货运行动实体模型，记录起止城镇、货单、护卫与行进进度。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
## TradeCaravanEntity：跨国商队货运行动实体模型，记录起止城镇、货单、护卫与行进进度。
class_name TradeCaravanEntity
extends RefCounted

var caravan_id: String = ""
var origin_town_id: String = GameConfig.get_string(
	"domains.trading",
	"caravan_defaults/origin_town_id",
	"TOWN_A"
)
var destination_town_id: String = GameConfig.get_string(
	"domains.trading",
	"caravan_defaults/destination_town_id",
	"TOWN_B"
)
var cargo_manifest: Array = [] # [{ "item_id": "...", "quantity": 20, "unit_cost": 80 }]
var guards_count: int = GameConfig.get_int("domains.trading", "caravan_defaults/guards_count", 10)
var progress_ratio: float = 0.0 # 0.0 ~ 1.0
var is_intercepted: bool = false
