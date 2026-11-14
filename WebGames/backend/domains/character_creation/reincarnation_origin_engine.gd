# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/reincarnation_origin_engine.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 种族与身世常数、初始金币/声望/阵营偏好、七大洲地缘出生点契约 全量数据由 config/domains/character_creation.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
## ReincarnationOriginEngine：Domain Logic Component
class_name ReincarnationOriginEngine extends RefCounted

## 读取身世常数表（MOD 清单优先，其次读取运行期覆盖后的 domains.character_creation）
static func _origins(adapted_mod_manifest: Dictionary = {}) -> Dictionary:
	var manifest: Dictionary = DestinyModManifestDTO.unwrap_adapted_manifest(adapted_mod_manifest)
	var mod_origins: Variant = manifest.get("origins_catalog", manifest.get("origins", {}))
	if mod_origins is Dictionary and not (mod_origins as Dictionary).is_empty():
		return mod_origins as Dictionary
	return GameConfig.get_dict("domains.character_creation", "origins", {})

## 读取地缘出生点表（birth_regions / world regions，配置/MOD 驱动）
static func _regions(adapted_mod_manifest: Dictionary = {}) -> Dictionary:
	var manifest: Dictionary = DestinyModManifestDTO.unwrap_adapted_manifest(adapted_mod_manifest)
	var mod_regions: Variant = manifest.get("birth_region_map", {})
	if mod_regions is Dictionary and not (mod_regions as Dictionary).is_empty():
		return mod_regions as Dictionary
	return GameConfig.get_dict("domains.character_creation", "birth_regions", {})

## 按身世 ID 取身世数据（未命中回退 MOD 规则配置或空字典，严禁硬编码 Kalar 身世）
static func get_origin(origin_id: String, adapted_mod_manifest: Dictionary = {}) -> Dictionary:
	var origins := _origins(adapted_mod_manifest)
	if origins.has(origin_id):
		return origins[origin_id]
	var fallback := GameConfig.get_string("domains.character_creation", "defaults/fallback_origin", "")
	if fallback.is_empty():
		return {}
	return origins.get(fallback, {})

## 按区域 ID 取出生点数据（未命中回退 MOD 规则配置或空字典，严禁硬编码 Kalar 区域）
static func get_birth_region(region_id: String, adapted_mod_manifest: Dictionary = {}) -> Dictionary:
	var regions := _regions(adapted_mod_manifest)
	if regions.has(region_id):
		var raw_region: Variant = regions[region_id]
		return raw_region if raw_region is Dictionary else {"birth_region_id": str(raw_region)}
	var fallback := GameConfig.get_string("domains.character_creation", "defaults/fallback_region", "")
	if fallback.is_empty():
		return {}
	var fallback_entry: Variant = regions.get(fallback, {})
	return fallback_entry if fallback_entry is Dictionary else {"birth_region_id": str(fallback_entry)}
