# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/item_statistics/item_stat_delta_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_statistics.json | 信号: EventBus 领域广播
# 职责说明: 承载单个物品事件的统计量增量，用于自底向上常数时间 O(1) 路径累加
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ItemStatDeltaDTO：Value Object DTO / Data Transport Model
class_name ItemStatDeltaDTO
extends RefCounted

var canonical_id: String = ""
var category_major: String = ""
var category_minor: String = ""
var stat_key: String = ""
var delta_quantity: int = 0
var actual_applied: int = 0
var current_leaf_quantity: int = 0

## 初始化物品统计增量传输对象。
func _init(
	initial_canonical_id: String = "",
	initial_category_major: String = "",
	initial_category_minor: String = "",
	initial_stat_key: String = "",
	initial_delta_quantity: int = 0,
	initial_actual_applied: int = 0,
	initial_leaf_quantity: int = 0
) -> void:
	canonical_id = initial_canonical_id
	category_major = initial_category_major
	category_minor = initial_category_minor
	stat_key = initial_stat_key
	delta_quantity = initial_delta_quantity
	actual_applied = initial_actual_applied
	current_leaf_quantity = initial_leaf_quantity

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"canonical_id": canonical_id,
		"category_major": category_major,
		"category_minor": category_minor,
		"stat_key": stat_key,
		"delta_quantity": delta_quantity,
		"actual_applied": actual_applied,
		"current_leaf_quantity": current_leaf_quantity
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> RefCounted:
	var delta_record := ItemStatDeltaDTO.new()
	if data.is_empty():
		return delta_record
	delta_record.canonical_id = str(data.get("canonical_id", ""))
	delta_record.category_major = str(data.get("category_major", ""))
	delta_record.category_minor = str(data.get("category_minor", ""))
	delta_record.stat_key = str(data.get("stat_key", ""))
	delta_record.delta_quantity = int(data.get("delta_quantity", 0))
	delta_record.actual_applied = int(data.get("actual_applied", 0))
	delta_record.current_leaf_quantity = int(data.get("current_leaf_quantity", 0))
	return delta_record
