# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/spatial_merchant/roaming_merchant_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/spatial_merchant.json | 信号: EventBus 领域广播
# 职责说明: 管理游荡商人定居点停靠刷新、停留时限耗尽自动拔营与交易阻断
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name RoamingMerchantFSM
extends RefCounted

## 生成游荡商贩：临时标记 + 停靠位置 + 停留时限（默认 7200s）
static func spawn_roaming_peddler(
	shop_id: String,
	town_id: String,
	spawn_pos: Vector2,
	current_time_utc: int,
	stay_duration_seconds: int = 7200
) -> MerchantShopAggregate:
	var peddler := MerchantShopAggregate.new(shop_id, _msg("roaming_merchant_name"), MerchantShopAggregate.ShopType.ROAMING_LEYLINE_PEDDLER)
	peddler.location_town_id = town_id
	peddler.local_position = spawn_pos
	peddler.is_temporary = true
	peddler.despawn_timestamp_utc = current_time_utc + stay_duration_seconds
	return peddler

## 商贩存活判定：临时商贩按停留时限过期，常驻商贩恒活跃
static func is_peddler_active(peddler: MerchantShopAggregate, current_time_utc: int) -> bool:
	if not peddler.is_temporary:
		return true
	return current_time_utc < peddler.despawn_timestamp_utc

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("spatial_merchant", key)
