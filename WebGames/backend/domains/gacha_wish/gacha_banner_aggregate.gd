# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/gacha_wish/gacha_banner_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy, inventory | 配置: config/domains/gacha.json | 信号: EventBus 领域广播
# 职责说明: 祈愿卡池元数据、UP 角色/神器物品池、保底计数器状态契约 默认值由 config/domains/gacha.json 的 banner_defaults 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## GachaBannerAggregate：Domain Entity / Aggregate Root
class_name GachaBannerAggregate extends RefCounted

var banner_id: String = GameConfig.get_string("domains.gacha", "banner_defaults/banner_id", "BANNER_LEGENDARY_HERO")
var banner_title: String = GameConfig.get_string("domains.gacha", "banner_defaults/banner_title", "【始源神兵 · 极光湮灭】限时祈愿")
var cost_per_pull_gold: int = GameConfig.get_int("domains.gacha", "banner_defaults/cost_per_pull_gold", 100)
var cost_per_pull_crystals: int = GameConfig.get_int("domains.gacha", "banner_defaults/cost_per_pull_crystals", 1)

var current_pity_count: int = 0
var is_next_guaranteed_up: bool = false
var total_lifetime_pulls: int = 0

var up_5star_item_ids: Array = GameConfig.get_array("domains.gacha", "banner_defaults/up_5star_item_ids", ["ITEM_MYTHIC_BLADE_01"])
var standard_5star_item_ids: Array = GameConfig.get_array("domains.gacha", "banner_defaults/standard_5star_item_ids", ["ITEM_HEROIC_ARMOR_01", "ITEM_ARCHMAGE_STAFF_01"])
var standard_4star_item_ids: Array = GameConfig.get_array("domains.gacha", "banner_defaults/standard_4star_item_ids", ["ITEM_ELVEN_BOW", "ITEM_RUNIC_SHIELD", "ITEM_ELIXIR_HIGH"])
var standard_3star_item_ids: Array = GameConfig.get_array("domains.gacha", "banner_defaults/standard_3star_item_ids", ["ITEM_IRON_SWORD", "ITEM_HEALTH_POTION", "ITEM_TRAVEL_RATION"])

## 序列化当前实体或对象状态为字典结构
func serialize() -> Dictionary:
	return {
		"banner_id": banner_id,
		"banner_title": banner_title,
		"cost_per_pull_gold": cost_per_pull_gold,
		"cost_per_pull_crystals": cost_per_pull_crystals,
		"current_pity_count": current_pity_count,
		"is_next_guaranteed_up": is_next_guaranteed_up,
		"total_lifetime_pulls": total_lifetime_pulls
	}

## 反序列化：缺键一律沿用字段初值（即 banner_defaults 配置缺省），默认值单点化于此。
## banner_title 刻意保留独立的 fallback_title 键（损坏存档回落「限时祈愿」短题）。
static func deserialize(serialized_payload: Dictionary) -> GachaBannerAggregate:
	var banner := GachaBannerAggregate.new()
	if serialized_payload == null or serialized_payload.is_empty():
		return banner
	banner.banner_id = String(serialized_payload.get("banner_id", banner.banner_id))
	banner.banner_title = String(serialized_payload.get("banner_title", GameConfig.get_string("domains.gacha", "banner_defaults/fallback_title", "限时祈愿")))
	banner.cost_per_pull_gold = maxi(0, int(serialized_payload.get("cost_per_pull_gold", banner.cost_per_pull_gold)))
	banner.cost_per_pull_crystals = maxi(0, int(serialized_payload.get("cost_per_pull_crystals", banner.cost_per_pull_crystals)))
	banner.current_pity_count = maxi(0, int(serialized_payload.get("current_pity_count", banner.current_pity_count)))
	banner.is_next_guaranteed_up = bool(serialized_payload.get("is_next_guaranteed_up", banner.is_next_guaranteed_up))
	banner.total_lifetime_pulls = maxi(0, int(serialized_payload.get("total_lifetime_pulls", banner.total_lifetime_pulls)))
	return banner

## 事务进度快照（SURFACE_COUNTER）：保底三字段整体采集，附带 banner_id 防跨池串扰。
## 与 wallet/inventory 快照同点使用——事务失败时整面回滚，杜绝「退款但保底免费累积」。
func snapshot_progress() -> Dictionary:
	return {
		"banner_id": banner_id,
		"total_lifetime_pulls": total_lifetime_pulls,
		"current_pity_count": current_pity_count,
		"is_next_guaranteed_up": is_next_guaranteed_up,
	}

## 事务进度回滚：按快照还原保底字段（幂等、防脏数据与防跨池串扰）。
func restore_progress(snapshot: Dictionary) -> void:
	if snapshot == null or snapshot.is_empty():
		return
	if snapshot.has("banner_id") and String(snapshot.get("banner_id")) != "" and snapshot.get("banner_id") != banner_id:
		EventBusCore.get_instance().emit_log("warn", TemplateFormatter.format("GachaBannerAggregate.restore_progress: snapshot banner_id mismatch ('{snapshot}' vs '{current}'); cross-pool rollback rejected.", {"snapshot": snapshot.get("banner_id"), "current": banner_id}))
		return
	total_lifetime_pulls = maxi(0, int(snapshot.get("total_lifetime_pulls", total_lifetime_pulls)))
	current_pity_count = maxi(0, int(snapshot.get("current_pity_count", current_pity_count)))
	is_next_guaranteed_up = bool(snapshot.get("is_next_guaranteed_up", is_next_guaranteed_up))
