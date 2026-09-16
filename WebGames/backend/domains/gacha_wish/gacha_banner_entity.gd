# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/gacha_wish/gacha_banner_entity.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy, inventory | 配置: config/domains/gacha.json | 信号: EventBus 领域广播
# 职责说明: 祈愿卡池元数据、UP 角色/神器物品池、保底计数器状态契约 默认值由 config/domains/gacha.json 的 banner_defaults 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

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
static func deserialize(d: Dictionary) -> GachaBannerAggregate:
	var b := GachaBannerAggregate.new()
	if d == null or d.is_empty():
		return b
	b.banner_id = String(d.get("banner_id", b.banner_id))
	b.banner_title = String(d.get("banner_title", GameConfig.get_string("domains.gacha", "banner_defaults/fallback_title", "限时祈愿")))
	b.cost_per_pull_gold = maxi(0, int(d.get("cost_per_pull_gold", b.cost_per_pull_gold)))
	b.cost_per_pull_crystals = maxi(0, int(d.get("cost_per_pull_crystals", b.cost_per_pull_crystals)))
	b.current_pity_count = maxi(0, int(d.get("current_pity_count", b.current_pity_count)))
	b.is_next_guaranteed_up = bool(d.get("is_next_guaranteed_up", b.is_next_guaranteed_up))
	b.total_lifetime_pulls = maxi(0, int(d.get("total_lifetime_pulls", b.total_lifetime_pulls)))
	return b

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
func restore_progress(snap: Dictionary) -> void:
	if snap == null or snap.is_empty():
		return
	if snap.has("banner_id") and String(snap.get("banner_id")) != "" and snap.get("banner_id") != banner_id:
		push_warning("GachaBannerAggregate.restore_progress: 快照 banner_id 不匹配 ('%s' vs '%s')，拒绝跨池回滚。" % [snap.get("banner_id"), banner_id])
		return
	total_lifetime_pulls = maxi(0, int(snap.get("total_lifetime_pulls", total_lifetime_pulls)))
	current_pity_count = maxi(0, int(snap.get("current_pity_count", current_pity_count)))
	is_next_guaranteed_up = bool(snap.get("is_next_guaranteed_up", is_next_guaranteed_up))
