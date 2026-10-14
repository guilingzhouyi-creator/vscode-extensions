# ==============================================================================
# 模块归属: 业务领域层 (Domains · 物品统计业务域)
# 文件路径: res://backend/domains/item_statistics/dto/item_stat_aggregation_dto.gd
# 架构定位: 值对象数据传输模型
# 依赖与触发: 上游: ItemStatisticsService | 下游: InventoryDomain | 配置: config/domains/item_statistics.json
# 职责说明: 物品聚合统计数据载荷，提供跨域统计传输与对象池状态重置。
# 退出语义与设计依据: 退出语义: 纯数据结构传输 | 设计依据: 物品统计聚合数据传输模型规约
# ==============================================================================

## ItemStatAggregationDto：物品统计聚合数据传输模型
class_name ItemStatAggregationDto
extends RefCounted

var total_items_tracked: int = 0
var total_value_accumulated: int = 0
var rarity_breakdown: Dictionary = {}
var category_counts: Dictionary = {}
var last_updated_utc: int = 0

## 重置内部统计数据状态，供对象池无堆分配复用
func reset_state() -> void:
	total_items_tracked = 0
	total_value_accumulated = 0
	rarity_breakdown.clear()
	category_counts.clear()
	last_updated_utc = 0

## 序列化当前统计数据载荷为字典结构
func to_dto() -> Dictionary:
	return {
		"total_items_tracked": total_items_tracked,
		"total_value_accumulated": total_value_accumulated,
		"rarity_breakdown": rarity_breakdown.duplicate(true),
		"category_counts": category_counts.duplicate(true),
		"last_updated_utc": last_updated_utc
	}

## 从字典数据反序列化还原统计聚合数据传输对象
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
