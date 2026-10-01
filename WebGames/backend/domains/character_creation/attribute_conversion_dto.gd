# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色与成长集群 (Character Progression))
# 文件路径: res://backend/domains/character_creation/attribute_conversion_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: character_creation | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 封装角色生理属性与战斗属性换算引擎的输入与输出上下文（GOV-DAT-001）。
# 设计依据: 业务领域第一性原理 / Phase 97 施工细则规范
# ==============================================================================

class_name AttributeConversionDTO
extends RefCounted

var base_attributes: Dictionary = {}
var race_id: String = ""
var profession_id: String = ""
var level: int = 1
var modifier_tags: Array[String] = []
var extra_context: Dictionary = {}

func _init(
	p_base_attributes: Dictionary = {},
	p_race_id: String = "",
	p_profession_id: String = "",
	p_level: int = 1,
	p_modifier_tags: Array[String] = [],
	p_extra_context: Dictionary = {}
) -> void:
	base_attributes = p_base_attributes
	race_id = p_race_id
	profession_id = p_profession_id
	level = p_level
	modifier_tags = p_modifier_tags
	extra_context = p_extra_context
