# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_quality_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 将物品声明（canonical_id + 主品质 + 神话区间端点）确定性解析为 唯一品质快照与数值基线；强制规范约束——唯一映射、区间端点从属、 未登记品质拒绝、特殊物品仅既有标准内扩展（禁绕过/重定义）
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ItemQualityResolver
extends RefCounted

# ==============================================================================
# 一、解析器状态
# ==============================================================================

var _registry: QualityTierRegistry

## 构造：注入品质登记表（单数据源，禁绕过注册系统直读配置）
func _init(registry: QualityTierRegistry) -> void:
	_registry = registry

# ==============================================================================
# 二、确定性解析入口
# ==============================================================================

## 确定性解析入口：
## - INV-3 区间端点从属：非神话级携带区间端点 → INTERVAL_OUTSIDE_MYTHIC；
## - 未登记主品质档 → UNREGISTERED_TIER（未登记物品不产生任何基线消费）；
## - 成功 → 主档 + 区间 + 强度/稀有度权重基线（唯一映射快照）。
func resolve(canonical_id: String, declared_tier: int, declared_interval: int) -> Dictionary:
	if not _registry.is_ready():
		return {"success": false, "code": "REGISTRY_NOT_READY", "canonical_id": canonical_id}
	if not ItemQualitySnapshot.is_interval_valid_for_tier(declared_interval, declared_tier):
		return {"success": false, "code": "INTERVAL_OUTSIDE_MYTHIC", "canonical_id": canonical_id}
	var baseline: Dictionary = _registry.get_tier_baseline(declared_tier)
	if baseline.is_empty():
		return {"success": false, "code": "UNREGISTERED_TIER", "canonical_id": canonical_id}
	var interval_baseline: Dictionary = {}
	if declared_interval != ItemQualitySnapshot.MythicInterval.NONE:
		interval_baseline = _registry.get_mythic_interval_baseline(declared_interval)
	var snap := ItemQualitySnapshot.new()
	snap.canonical_id = canonical_id
	snap.tier = declared_tier
	snap.mythic_interval = declared_interval
	snap.tier_level = ItemQualitySnapshot.tier_to_level(declared_tier)
	snap.strength_weight = float(interval_baseline.get("strength_weight", baseline.get("strength_weight", 1.0)))
	snap.rarity_weight = float(interval_baseline.get("rarity_weight", baseline.get("rarity_weight", 1.0)))
	return {
		"success": true,
		"snapshot": snap.to_dto(),
		"canonical_id": canonical_id,
		"tier": declared_tier,
		"mythic_interval": declared_interval,
		"strength_weight": snap.strength_weight,
		"rarity_weight": snap.rarity_weight,
	}

# ==============================================================================
# 三、便捷查询
# ==============================================================================

## 便捷查询：直接取强度基线（未登记/未就绪返回安全兜底 1.0，不抛 Fatal）
func get_strength_weight(canonical_id: String, declared_tier: int, declared_interval: int) -> float:
	var result := resolve(canonical_id, declared_tier, declared_interval)
	return float(result.get("strength_weight", 1.0))
