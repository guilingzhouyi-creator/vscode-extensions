# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/reincarnation_origin.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 种族与身世常数、初始金币/声望/阵营偏好、七大洲地缘出生点契约 全量数据由 config/domains/character_creation.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name ReincarnationOriginEngine extends RefCounted

# ==============================================================================
# 一、配置表读取（config/domains/character_creation.json）
# ==============================================================================

## 读取身世常数表（config/domains/character_creation.json origins 段，配置驱动）
static func _origins() -> Dictionary:
	return GameConfig.get_dict("domains.character_creation", "origins", {})

## 读取地缘出生点表（birth_regions 段，配置驱动）
static func _regions() -> Dictionary:
	return GameConfig.get_dict("domains.character_creation", "birth_regions", {})

# ==============================================================================
# 二、查询（带兜底回退）
# ==============================================================================

## 按身世 ID 取身世数据（未命中回退 fallback_origin 默认身世，杜绝空字典）。
## 契约：config 键 defaults/fallback_origin 驱动兜底（默认 IMPERIAL_NOBLE）。
static func get_origin(origin_id: String) -> Dictionary:
	var origins := _origins()
	if origins.has(origin_id):
		return origins[origin_id]
	var fallback := GameConfig.get_string("domains.character_creation", "defaults/fallback_origin", "IMPERIAL_NOBLE")
	return origins.get(fallback, {})

## 按区域 ID 取出生点数据（未命中回退 fallback_region 默认区域，杜绝空字典）。
## 契约：config 键 defaults/fallback_region 驱动兜底（默认 CENTRAL_CONTINENT）。
static func get_birth_region(region_id: String) -> Dictionary:
	var regions := _regions()
	if regions.has(region_id):
		return regions[region_id]
	var fallback := GameConfig.get_string("domains.character_creation", "defaults/fallback_region", "CENTRAL_CONTINENT")
	return regions.get(fallback, {})
