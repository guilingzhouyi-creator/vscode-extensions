# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/dto/prologue_handoff_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 依赖与触发: 上游: PrologueExecutionKernel | 下游: WorldGatewayFSM, AuthoritativeHudSyncService | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 序章推演完结向大地图探索与主循环跃迁交接的标准数据传输对象；
#           严格守恒传递角色属性、装备道具、初始金币与因果突变标记。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约 (Inv-HANDOFF-CONSERVATION-2)
# ==============================================================================

## PrologueHandoffDTO：序章向大地图状态机与 HUD 水化交接的数据传输对象
class_name PrologueHandoffDTO
extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

# ==============================================================================
# 一、核心传输字段
# ==============================================================================

var account_id: String = ""
var character_id: String = ""
var character_name: String = ""
var race_id: String = "HUMAN"
var origin_id: String = ""
var allocated_attributes: Dictionary = {}
var initial_inventory_items: Array = []
var initial_gold: int = 0
var assigned_start_location_id: String = "CENTRAL_CONTINENT"
var active_mods: Array = []
var applied_mutations: Array = []
var timestamp_utc: int = 0

# ==============================================================================
# 二、对象池与重置契约 (ADV-PRF-002)
# ==============================================================================

## 复位对象内部字段，满足循环零堆分配池化要求
func reset_state() -> void:
	super.reset_state()
	account_id = ""
	character_id = ""
	character_name = ""
	race_id = "HUMAN"
	origin_id = ""
	allocated_attributes.clear()
	initial_inventory_items.clear()
	initial_gold = 0
	assigned_start_location_id = "CENTRAL_CONTINENT"
	active_mods.clear()
	applied_mutations.clear()
	timestamp_utc = 0

# ==============================================================================
# 三、序列化与工厂还原
# ==============================================================================

## 序列化为纯净数据字典
func to_dto() -> Dictionary:
	return {
		"account_id": account_id,
		"character_id": character_id,
		"character_name": character_name,
		"race_id": race_id,
		"origin_id": origin_id,
		"allocated_attributes": allocated_attributes.duplicate(true),
		"initial_inventory_items": initial_inventory_items.duplicate(true),
		"initial_gold": initial_gold,
		"assigned_start_location_id": assigned_start_location_id,
		"active_mods": active_mods.duplicate(true),
		"applied_mutations": applied_mutations.duplicate(true),
		"timestamp_utc": timestamp_utc
	}

## 从字典数据构造还原交接对象
static func from_dto(d: Dictionary) -> PrologueHandoffDTO:
	var inst := PrologueHandoffDTO.new()
	if d.is_empty():
		return inst
	inst.account_id = str(d.get("account_id", ""))
	inst.character_id = str(d.get("character_id", ""))
	inst.character_name = str(d.get("character_name", ""))
	inst.race_id = str(d.get("race_id", "HUMAN"))
	inst.origin_id = str(d.get("origin_id", ""))
	var raw_attrs: Variant = d.get("allocated_attributes", {})
	inst.allocated_attributes = (raw_attrs as Dictionary).duplicate(true) if raw_attrs is Dictionary else {}
	var raw_items: Variant = d.get("initial_inventory_items", [])
	inst.initial_inventory_items = (raw_items as Array).duplicate(true) if raw_items is Array else []
	inst.initial_gold = int(d.get("initial_gold", 0))
	inst.assigned_start_location_id = str(d.get("assigned_start_location_id", "CENTRAL_CONTINENT"))
	var raw_mods: Variant = d.get("active_mods", [])
	inst.active_mods = (raw_mods as Array).duplicate(true) if raw_mods is Array else []
	var raw_muts: Variant = d.get("applied_mutations", [])
	inst.applied_mutations = (raw_muts as Array).duplicate(true) if raw_muts is Array else []
	inst.timestamp_utc = int(d.get("timestamp_utc", 0))
	return inst
