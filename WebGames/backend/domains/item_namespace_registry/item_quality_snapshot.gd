# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_quality_snapshot.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 定义游戏全局物品品质等级统一度量体系的数据契约—— 六档主品质单调序列（普通→精品→史诗→传奇→神话→古代）、 神话级内部连续区间端点（准神器/真神器，非独立等级）、 物品唯一映射（恰好一个主品质 + 至多一个神话区间端点）的 DTO 载体
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ItemQualitySnapshot：Value Object DTO / Data Transport Model
class_name ItemQualitySnapshot
extends RefCounted

# ==============================================================================
# 一、品质等级与区间端点枚举
# ==============================================================================

# 1. 主品质等级枚举（六档，等级值严格单调递增，禁止跨级倒置）
enum QualityTier {
	COMMON, # 普通   = 等级 1
	FINE, # 精品   = 等级 2
	EPIC, # 史诗   = 等级 3
	LEGENDARY, # 传奇   = 等级 4
	MYTHIC, # 神话   = 等级 5
	ANCIENT, # 古代   = 等级 6
}

# 2. 神话级内部区间端点（仅 Mythic 档内生效，非独立主等级）
enum MythicInterval {
	NONE, # 非神话级或未细分
	QUASI_ARTIFACT, # 准神器：神话级低端边界
	TRUE_ARTIFACT, # 真神器：神话级高端边界
}

# ==============================================================================
# 二、核心属性字段
# ==============================================================================

# 3. 核心属性与字段定义
var canonical_id: String = ""
var tier: QualityTier = QualityTier.COMMON
var mythic_interval: MythicInterval = MythicInterval.NONE
var tier_level: int = 1 # 1~6，由 QualityTier 单调映射
var strength_weight: float = 1.0 # 强度基线权重（由 quality_tiers 配置表驱动）
var rarity_weight: float = 1.0 # 稀有度/掉落权重（由 quality_tiers 配置表驱动）

# ==============================================================================
# 三、等级映射与校验
# ==============================================================================

## 等级值单调映射：QualityTier -> 1~6（唯一事实源，禁止跨级倒置）
static func tier_to_level(quality_tier: QualityTier) -> int:
	match quality_tier:
		QualityTier.COMMON:
			return 1
		QualityTier.FINE:
			return 2
		QualityTier.EPIC:
			return 3
		QualityTier.LEGENDARY:
			return 4
		QualityTier.MYTHIC:
			return 5
		QualityTier.ANCIENT:
			return 6
		_:
			return 1

## 区间端点从属校验：非神话级不得携带区间端点（INV-3）
static func is_interval_valid_for_tier(interval: MythicInterval, quality_tier: QualityTier) -> bool:
	if interval == MythicInterval.NONE:
		return true
	return quality_tier == QualityTier.MYTHIC

# ==============================================================================
# 四、DTO 数据交换契约
# ==============================================================================

## 序列化为字典（品质/区间枚举转整型，前端消费契约）
func to_dto() -> Dictionary:
	return {
		"canonical_id": canonical_id,
		"tier": int(tier),
		"mythic_interval": int(mythic_interval),
		"tier_level": tier_level,
		"strength_weight": strength_weight,
		"rarity_weight": rarity_weight,
	}

## 从字典反序列化还原（缺省字段回退默认等级与权重）
static func from_dto(serialized_snapshot: Dictionary) -> ItemQualitySnapshot:
	var snapshot := ItemQualitySnapshot.new()
	snapshot.canonical_id = str(serialized_snapshot.get("canonical_id", ""))
	snapshot.tier = int(serialized_snapshot.get("tier", QualityTier.COMMON)) as QualityTier
	snapshot.mythic_interval = int(serialized_snapshot.get("mythic_interval", MythicInterval.NONE)) as MythicInterval
	snapshot.tier_level = int(serialized_snapshot.get("tier_level", tier_to_level(snapshot.tier)))
	snapshot.strength_weight = float(serialized_snapshot.get("strength_weight", 1.0))
	snapshot.rarity_weight = float(serialized_snapshot.get("rarity_weight", 1.0))
	return snapshot
