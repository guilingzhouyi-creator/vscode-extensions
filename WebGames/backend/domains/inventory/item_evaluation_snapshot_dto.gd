# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_evaluation_snapshot_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 封装经 ABC 三类属性求解、互斥过滤、非负下界截断与品质动态升格后的结算快照。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ItemEvaluationSnapshotDTO
extends RefCounted

# ==============================================================================
# 一、快照字段
# ==============================================================================

var item_uid: String = ""
var original_tier_rank: int = 1
var effective_tier_rank: int = 1
var is_tier_promoted: bool = false
var total_affix_score: float = 0.0

var active_stats: Dictionary = {}
var raw_increment_stats: Dictionary = {}
var raw_decrement_stats: Dictionary = {}

var active_affix_uids: Array = []
var suppressed_affix_uids: Array = []

# ==============================================================================
# 二、DTO 转换
# ==============================================================================

## 序列化结算快照为字典（各统计字典/数组深拷贝）
func to_dto() -> Dictionary:
	return {
		"item_uid": item_uid,
		"original_tier_rank": original_tier_rank,
		"effective_tier_rank": effective_tier_rank,
		"is_tier_promoted": is_tier_promoted,
		"total_affix_score": total_affix_score,
		"active_stats": active_stats.duplicate(true),
		"raw_increment_stats": raw_increment_stats.duplicate(true),
		"raw_decrement_stats": raw_decrement_stats.duplicate(true),
		"active_affix_uids": active_affix_uids.duplicate(true),
		"suppressed_affix_uids": suppressed_affix_uids.duplicate(true)
	}

## 从字典重建结算快照（缺省回退默认值 + 逐容器转型）
static func from_dto(d: Dictionary) -> ItemEvaluationSnapshotDTO:
	var dto := ItemEvaluationSnapshotDTO.new()
	if d == null:
		return dto

	dto.item_uid = str(d.get("item_uid", ""))
	dto.original_tier_rank = int(d.get("original_tier_rank", 1))
	dto.effective_tier_rank = int(d.get("effective_tier_rank", 1))
	dto.is_tier_promoted = bool(d.get("is_tier_promoted", false))
	dto.total_affix_score = float(d.get("total_affix_score", 0.0))
	dto.active_stats = (d.get("active_stats", {}) as Dictionary).duplicate(true)
	dto.raw_increment_stats = (d.get("raw_increment_stats", {}) as Dictionary).duplicate(true)
	dto.raw_decrement_stats = (d.get("raw_decrement_stats", {}) as Dictionary).duplicate(true)
	dto.active_affix_uids = (d.get("active_affix_uids", []) as Array).duplicate(true)
	dto.suppressed_affix_uids = (d.get("suppressed_affix_uids", []) as Array).duplicate(true)

	return dto
