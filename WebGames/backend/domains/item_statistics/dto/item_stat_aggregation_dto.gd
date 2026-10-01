# ==============================================================================
# 模块归属: 业务领域层 (Domains · 物品统计业务域)
# 文件路径: res://backend/domains/item_statistics/dto/item_stat_aggregation_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: ItemStatisticsService | 下游: InventoryDomain | 配置: config/domains/item_statistics.json
# 职责说明: 物品聚合统计数据载荷，提供跨域统计传输与对象池状态重置。
# ==============================================================================

class_name ItemStatAggregationDto
extends RefCounted

var total_items_tracked: int = 0
var total_value_accumulated: int = 0
var rarity_breakdown: Dictionary = {}
var category_counts: Dictionary = {}
var last_updated_utc: int = 0

func reset_state() -> void:
	total_items_tracked = 0
	total_value_accumulated = 0
	rarity_breakdown.clear()
	category_counts.clear()
	last_updated_utc = 0

func to_dto() -> Dictionary:
	return {
		"total_items_tracked": total_items_tracked,
		"total_value_accumulated": total_value_accumulated,
		"rarity_breakdown": rarity_breakdown.duplicate(true),
		"category_counts": category_counts.duplicate(true),
		"last_updated_utc": last_updated_utc
	}

static func from_dto(data: Dictionary) -> ItemStatAggregationDto:
	var dto := ItemStatAggregationDto.new()
	dto.total_items_tracked = int(data.get("total_items_tracked", 0))
	dto.total_value_accumulated = int(data.get("total_value_accumulated", 0))
	var raw_rarity = data.get("rarity_breakdown", {})
	if raw_rarity is Dictionary:
		dto.rarity_breakdown = raw_rarity.duplicate(true)
	var raw_cat = data.get("category_counts", {})
	if raw_cat is Dictionary:
		dto.category_counts = raw_cat.duplicate(true)
	dto.last_updated_utc = int(data.get("last_updated_utc", 0))
	return dto
