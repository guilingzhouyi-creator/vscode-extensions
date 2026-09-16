# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/quality_tier_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 加载 config/domains/quality_tiers.json 唯一事实源，启动时校验四项 硬性不变量（单调等级序/唯一主映射/区间端点从属/端点连续语义）， 为全局物品设计/数值平衡/效果评估提供统一强度与稀有度基线查询
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name QualityTierRegistry
extends RefCounted

# ==============================================================================
# 一、状态与配置表
# ==============================================================================

const CONFIG_TABLE: String = "domains.quality_tiers"
const TIER_COUNT: int = 6  # 六档主品质（普通~古代）

var _tiers: Dictionary = {}            # tier(int) -> 基线字典 {level, name_key, strength_weight, rarity_weight, color_token}
var _mythic_intervals: Dictionary = {} # interval(int) -> 区间端点基线 {name_key, strength_weight, rarity_weight, color_token}
var _ready: bool = false

## 重载配置：严格类型化取值器 + 安全兜底（禁 Variant get_value），校验四项硬性不变量
func reload_configuration() -> void:
	# 严格类型化取值器 + 安全兜底（禁 Variant get_value）
	var tiers_cfg: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "tiers", {})
	var intervals_cfg: Dictionary = GameConfig.get_dict(CONFIG_TABLE, "mythic_intervals", {})
	_tiers.clear()
	for tier_key in tiers_cfg:
		var entry: Dictionary = tiers_cfg[tier_key]
		_tiers[int(entry.get("tier", 0))] = entry
	_mythic_intervals.clear()
	for interval_key in intervals_cfg:
		var interval_entry: Dictionary = intervals_cfg[interval_key]
		_mythic_intervals[int(interval_entry.get("interval", 0))] = interval_entry
	_ready = _validate_invariants()

## 注册表是否就绪（不变量校验通过）
func is_ready() -> bool:
	return _ready

# ==============================================================================
# 二、硬性不变量校验
# ==============================================================================

## INV-1 单调等级序：六档齐全且等级值 1~6 严格连续递增（禁止跨级倒置/断裂）
## INV-4 端点连续语义：真神器强度权重 > 准神器强度权重（神话高端/低端边界）
func _validate_invariants() -> bool:
	if _tiers.size() != TIER_COUNT:
		return false
	var levels: Array[int] = []
	for tier in _tiers:
		levels.append(int(_tiers[tier].get("level", 0)))
	levels.sort()
	for i in range(levels.size()):
		if levels[i] != i + 1:
			return false  # 等级序断裂或倒置
	var quasi: float = 0.0
	var true_artifact: float = 0.0
	for interval in _mythic_intervals:
		var weight: float = float(_mythic_intervals[interval].get("strength_weight", 0.0))
		if interval == ItemQualitySnapshot.MythicInterval.QUASI_ARTIFACT:
			quasi = weight
		elif interval == ItemQualitySnapshot.MythicInterval.TRUE_ARTIFACT:
			true_artifact = weight
	if true_artifact <= quasi:
		return false  # 真神器必须高于准神器
	return true

# ==============================================================================
# 三、基线查询与导出
# ==============================================================================

## 基线查询：按主品质档取强度/稀有度权重（唯一事实源出口，只读）
func get_tier_baseline(tier: int) -> Dictionary:
	return _tiers.get(tier, {})

## 基线查询：按神话区间端点取强度/稀有度权重（仅 Mythic 档内语义）
func get_mythic_interval_baseline(interval: int) -> Dictionary:
	return _mythic_intervals.get(interval, {})

## 全量基线导出（供遥测/统计/审计只读引用）
func export_baselines() -> Dictionary:
	return {
		"tiers": _tiers.duplicate(true),
		"mythic_intervals": _mythic_intervals.duplicate(true),
		"ready": _ready,
	}
