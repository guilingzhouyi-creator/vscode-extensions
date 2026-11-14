# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/inventory_metric_snapshot.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 承载随身仓储的容积、负重、超载与满格度量快照。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## InventoryMetricSnapshot：Value Object DTO / Data Transport Model
class_name InventoryMetricSnapshot
extends RefCounted

# ==============================================================================
# 一、度量字段
# ==============================================================================
## 读取默认最大负重阈值（千克）
static func get_default_max_carry_weight_kg() -> float:
	return GameConfig.get_float("domains.inventory.core", "wearable/max_carry_weight_kg", 50.0)

var total_capacity_slots: int = 0
var used_volume_slots: int = 0
var total_mass_kg: float = 0.0
var max_carry_weight_kg: float = 50.0
var item_count: int = 0
var is_overweight: bool = false
var is_full: bool = false

## 构造：全量注入并即时推导超载/满格布尔（weight 超限 or 容量用满）
func _init(
	initial_used_volume_slots: int = 0,
	initial_total_capacity_slots: int = 0,
	initial_total_mass_kg: float = 0.0,
	initial_max_carry_weight_kg: float = 50.0,
	initial_item_count: int = 0
) -> void:
	used_volume_slots = initial_used_volume_slots
	total_capacity_slots = initial_total_capacity_slots
	total_mass_kg = initial_total_mass_kg
	max_carry_weight_kg = initial_max_carry_weight_kg
	item_count = initial_item_count
	is_overweight = (initial_total_mass_kg > initial_max_carry_weight_kg)
	is_full = (initial_total_capacity_slots > 0 and initial_used_volume_slots >= initial_total_capacity_slots)

# ==============================================================================
# 二、DTO 转换
# ==============================================================================

## 序列化为字典（遥测/存档/前端渲染共用）
func to_dto() -> Dictionary:
	return {
		"total_capacity_slots": total_capacity_slots,
		"used_volume_slots": used_volume_slots,
		"total_mass_kg": total_mass_kg,
		"max_carry_weight_kg": max_carry_weight_kg,
		"item_count": item_count,
		"is_overweight": is_overweight,
		"is_full": is_full
	}

## 从字典反序列化（缺省字段回退默认；空字典返回全默认快照）
static func from_dto(serialized_snapshot: Dictionary) -> RefCounted:
	var snapshot: InventoryMetricSnapshot = InventoryMetricSnapshot.new()
	if serialized_snapshot.is_empty():
		return snapshot
	snapshot.total_capacity_slots = int(serialized_snapshot.get("total_capacity_slots", 0))
	snapshot.used_volume_slots = int(serialized_snapshot.get("used_volume_slots", 0))
	snapshot.total_mass_kg = float(serialized_snapshot.get("total_mass_kg", 0.0))
	snapshot.max_carry_weight_kg = float(serialized_snapshot.get("max_carry_weight_kg", get_default_max_carry_weight_kg()))
	snapshot.item_count = int(serialized_snapshot.get("item_count", 0))
	snapshot.is_overweight = bool(serialized_snapshot.get("is_overweight", false))
	snapshot.is_full = bool(serialized_snapshot.get("is_full", false))
	return snapshot
