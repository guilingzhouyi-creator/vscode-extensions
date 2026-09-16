# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/item_statistics/item_stat_delta_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_statistics.json | 信号: EventBus 领域广播
# 职责说明: 承载单个物品事件的统计量增量，用于自底向上常数时间 O(1) 路径累加
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ItemStatDeltaDTO
extends RefCounted

var canonical_id: String = ""
var category_major: String = ""
var category_minor: String = ""
var stat_key: String = ""
var delta_quantity: int = 0
var actual_applied: int = 0
var current_leaf_quantity: int = 0

func _init(
	p_canonical_id: String = "",
	p_major: String = "",
	p_minor: String = "",
	p_stat_key: String = "",
	p_delta: int = 0,
	p_actual: int = 0,
	p_leaf_qty: int = 0
) -> void:
	canonical_id = p_canonical_id
	category_major = p_major
	category_minor = p_minor
	stat_key = p_stat_key
	delta_quantity = p_delta
	actual_applied = p_actual
	current_leaf_quantity = p_leaf_qty

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

static func from_dto(data: Dictionary) -> RefCounted:
	var dto = load("res://backend/domains/item_statistics/item_stat_delta_dto.gd").new()
	if data.is_empty():
		return dto
	dto.canonical_id = str(data.get("canonical_id", ""))
	dto.category_major = str(data.get("category_major", ""))
	dto.category_minor = str(data.get("category_minor", ""))
	dto.stat_key = str(data.get("stat_key", ""))
	dto.delta_quantity = int(data.get("delta_quantity", 0))
	dto.actual_applied = int(data.get("actual_applied", 0))
	dto.current_leaf_quantity = int(data.get("current_leaf_quantity", 0))
	return dto
