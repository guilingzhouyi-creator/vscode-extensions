# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/dto/character_creation_presentation_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 跨域依赖: 上游: AuthoritativeReincarnationSolver / Orchestrator | 下游: Gateway / Client / UI | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 角色创建完成与权威解算后的表现层传输对象；汇聚六维雷达、身世描述、种族名称、生理概况、钱包与新手装备展示数据。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name CharacterCreationPresentationDTO
extends RefCounted

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
# 二、对象池与重置契约 (ADV-POOL-001)
# ==============================================================================

func reset_state() -> void:
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

static func from_dto(d: Dictionary) -> CharacterCreationPresentationDTO:
	var dto := CharacterCreationPresentationDTO.new()
	if d.is_empty():
		return dto
	dto.character_id = str(d.get("character_id", ""))
	dto.character_name = str(d.get("character_name", ""))
	dto.origin_id = str(d.get("origin_id", ""))
	dto.origin_name = str(d.get("origin_name", ""))
	dto.origin_desc = str(d.get("origin_desc", ""))
	dto.race_id = str(d.get("race_id", ""))
	dto.race_name = str(d.get("race_name", ""))
	dto.gender = str(d.get("gender", ""))

	var attr: Variant = d.get("attributes_radar", {})
	if attr is Dictionary:
		dto.attributes_radar = (attr as Dictionary).duplicate(true)
	var phys: Variant = d.get("physiology_summary", {})
	if phys is Dictionary:
		dto.physiology_summary = (phys as Dictionary).duplicate(true)
	var wallet: Variant = d.get("wallet_summary", {})
	if wallet is Dictionary:
		dto.wallet_summary = (wallet as Dictionary).duplicate(true)
	var equip: Variant = d.get("starter_equipment", [])
	if equip is Array:
		var raw_equip_arr: Array = (equip as Array).duplicate(true)
		var equip_arr: Array[Dictionary] = []
		for item in raw_equip_arr:
			if item is Dictionary:
				equip_arr.append(item as Dictionary)
		dto.starter_equipment = equip_arr
	var chron: Variant = d.get("world_chronicle", {})
	if chron is Dictionary:
		dto.world_chronicle = (chron as Dictionary).duplicate(true)
	var prol: Variant = d.get("prologue_preview", {})
	if prol is Dictionary:
		dto.prologue_preview = (prol as Dictionary).duplicate(true)
	return dto
