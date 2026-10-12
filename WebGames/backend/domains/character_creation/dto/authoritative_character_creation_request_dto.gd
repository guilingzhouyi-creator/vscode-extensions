# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/dto/authoritative_character_creation_request_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 跨域依赖: 上游: Gateway / Client / UI | 下游: AuthoritativeReincarnationSolver | 配置: config/domains/character_creation/core.json | 信号: 无
# 职责说明: 客户端向世界网关发起的权威角色创建请求传输对象；承载基础意图入参及请求种子，严格由后端权威解算器执行零信任清洗。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name AuthoritativeCharacterCreationRequestDTO
extends RefCounted

# ==============================================================================
# 一、请求契约字段
# ==============================================================================

var account_id: String = ""
var slot_id: int = 0
var world_id: String = ""
var character_name: String = ""
var request_seed: int = 0
var extra_custom_fields: Dictionary = {}

# ==============================================================================
# 二、对象池与重置契约 (ADV-PRF-002)
# ==============================================================================

func reset_state() -> void:
	account_id = ""
	slot_id = 0
	world_id = ""
	character_name = ""
	request_seed = 0
	extra_custom_fields.clear()

# ==============================================================================
# 三、序列化与工厂方法
# ==============================================================================

func to_dto() -> Dictionary:
	return {
		"account_id": account_id,
		"slot_id": slot_id,
		"world_id": world_id,
		"character_name": character_name,
		"request_seed": request_seed,
		"extra_custom_fields": extra_custom_fields.duplicate(true)
	}

static func from_dto(d: Dictionary) -> AuthoritativeCharacterCreationRequestDTO:
	var dto := AuthoritativeCharacterCreationRequestDTO.new()
	if d.is_empty():
		return dto
	dto.account_id = str(d.get("account_id", ""))
	dto.slot_id = int(d.get("slot_id", 0))
	dto.world_id = str(d.get("world_id", ""))
	dto.character_name = str(d.get("character_name", ""))
	dto.request_seed = int(d.get("request_seed", 0))
	var extra: Variant = d.get("extra_custom_fields", {})
	if extra is Dictionary:
		dto.extra_custom_fields = (extra as Dictionary).duplicate(true)
	return dto
