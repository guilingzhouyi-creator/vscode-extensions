# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/dto/character_creation_presentation_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 依赖与触发: 上游: AuthoritativeReincarnationSolver / Orchestrator | 下游: Gateway / Client / UI | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 角色创建完成与权威解算后的表现层传输对象；汇聚六维雷达、身世描述、种族名称、生理概况、钱包与新手装备展示数据。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## CharacterCreationPresentationDTO：Data Transfer Object (DTO)
class_name CharacterCreationPresentationDTO
extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

# ==============================================================================
# 一、表现层契约字段
# ==============================================================================

var character_id: String = ""
var character_name: String = ""
var origin_id: String = ""
var origin_name: String = ""
var origin_desc: String = ""
var race_id: String = ""
var race_name: String = ""
var gender: String = ""
var attributes_radar: Dictionary = {}
var physiology_summary: Dictionary = {}
var wallet_summary: Dictionary = {}
var starter_equipment: Array[Dictionary] = []
var world_chronicle: Dictionary = {}
var prologue_preview: Dictionary = {}

# ==============================================================================
# 二、对象池与重置契约 (ADV-PRF-002)
# ==============================================================================
## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	super.reset_state()
	character_id = ""
	character_name = ""
	origin_id = ""
	origin_name = ""
	origin_desc = ""
	race_id = ""
	race_name = ""
	gender = ""
	attributes_radar.clear()
	physiology_summary.clear()
	wallet_summary.clear()
	starter_equipment.clear()
	world_chronicle.clear()
	prologue_preview.clear()

# ==============================================================================
# 三、序列化与工厂方法
# ==============================================================================

## 序列化当前创角展示对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"character_id": character_id,
		"character_name": character_name,
		"origin_id": origin_id,
		"origin_name": origin_name,
		"origin_desc": origin_desc,
		"race_id": race_id,
		"race_name": race_name,
		"gender": gender,
		"attributes_radar": attributes_radar.duplicate(true),
		"physiology_summary": physiology_summary.duplicate(true),
		"wallet_summary": wallet_summary.duplicate(true),
		"starter_equipment": starter_equipment.duplicate(true),
		"world_chronicle": world_chronicle.duplicate(true),
		"prologue_preview": prologue_preview.duplicate(true)
	}

## 从输入字典反序列化还原传输对象
static func from_dto(raw_data: Dictionary) -> CharacterCreationPresentationDTO:
	var presentation_dto := CharacterCreationPresentationDTO.new()
	if raw_data.is_empty():
		return presentation_dto
	presentation_dto.character_id = str(raw_data.get("character_id", ""))
	presentation_dto.character_name = str(raw_data.get("character_name", ""))
	presentation_dto.origin_id = str(raw_data.get("origin_id", ""))
	presentation_dto.origin_name = str(raw_data.get("origin_name", ""))
	presentation_dto.origin_desc = str(raw_data.get("origin_desc", ""))
	presentation_dto.race_id = str(raw_data.get("race_id", ""))
	presentation_dto.race_name = str(raw_data.get("race_name", ""))
	presentation_dto.gender = str(raw_data.get("gender", ""))

	var raw_attributes: Variant = raw_data.get("attributes_radar", {})
	if raw_attributes is Dictionary:
		presentation_dto.attributes_radar = (raw_attributes as Dictionary).duplicate(true)
	var raw_physiology: Variant = raw_data.get("physiology_summary", {})
	if raw_physiology is Dictionary:
		presentation_dto.physiology_summary = (raw_physiology as Dictionary).duplicate(true)
	var wallet: Variant = raw_data.get("wallet_summary", {})
	if wallet is Dictionary:
		presentation_dto.wallet_summary = (wallet as Dictionary).duplicate(true)
	var raw_equipment: Variant = raw_data.get("starter_equipment", [])
	if raw_equipment is Array:
		var cloned_equipment_list: Array = (raw_equipment as Array).duplicate(true)
		var equipment_list: Array[Dictionary] = []
		for item in cloned_equipment_list:
			if item is Dictionary:
				equipment_list.append(item as Dictionary)
		presentation_dto.starter_equipment = equipment_list
	var raw_chronicle: Variant = raw_data.get("world_chronicle", {})
	if raw_chronicle is Dictionary:
		presentation_dto.world_chronicle = (raw_chronicle as Dictionary).duplicate(true)
	var raw_prologue: Variant = raw_data.get("prologue_preview", {})
	if raw_prologue is Dictionary:
		presentation_dto.prologue_preview = (raw_prologue as Dictionary).duplicate(true)
	return presentation_dto
