# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/inventory_metric_snapshot.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 承载随身仓储的容积、负重、超载与满格度量快照。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name InventoryMetricSnapshot
extends RefCounted

# ==============================================================================
# 一、度量字段
# ==============================================================================

var total_capacity_slots: int = 0
var used_volume_slots: int = 0
var total_mass_kg: float = 0.0
var max_carry_weight_kg: float = 50.0
var item_count: int = 0
var is_overweight: bool = false
var is_full: bool = false

## 构造：全量注入并即时推导超载/满格布尔（weight 超限 or 容量用满）
func _init(
	p_used_vol: int = 0,
	p_cap: int = 0,
	p_mass: float = 0.0,
	p_max_wt: float = 50.0,
	p_count: int = 0
) -> void:
	used_volume_slots = p_used_vol
	total_capacity_slots = p_cap
	total_mass_kg = p_mass
	max_carry_weight_kg = p_max_wt
	item_count = p_count
	is_overweight = (p_mass > p_max_wt)
	is_full = (p_cap > 0 and p_used_vol >= p_cap)

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
static func from_dto(data: Dictionary) -> RefCounted:
	var snap = load("res://backend/domains/inventory/inventory_metric_snapshot.gd").new()
	if data.is_empty():
		return snap
	snap.total_capacity_slots = int(data.get("total_capacity_slots", 0))
	snap.used_volume_slots = int(data.get("used_volume_slots", 0))
	snap.total_mass_kg = float(data.get("total_mass_kg", 0.0))
	snap.max_carry_weight_kg = float(data.get("max_carry_weight_kg", 50.0))
	snap.item_count = int(data.get("item_count", 0))
	snap.is_overweight = bool(data.get("is_overweight", false))
	snap.is_full = bool(data.get("is_full", false))
	return snap
