# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色与成长集群 (Character Progression))
# 文件路径: res://backend/domains/character_creation/attribute_conversion_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: character_creation | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 封装角色生理属性与战斗属性换算引擎的输入与输出上下文（GOV-DAT-001）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AttributeConversionDTO：Value Object DTO / Data Transport Model
class_name AttributeConversionDTO
extends RefCounted

var base_attributes: Dictionary = {}
var race_id: String = ""
var profession_id: String = ""
var level: int = 1
var modifier_tags: Array[String] = []
var extra_context: Dictionary = {}

func _init(
	base_attrs: Dictionary = {},
	race: String = "",
	profession: String = "",
	char_level: int = 1,
	tags: Array[String] = [],
	extra_ctx: Dictionary = {}
) -> void:
	base_attributes = base_attrs
	race_id = race
	profession_id = profession
	level = char_level
	modifier_tags = tags
	extra_context = extra_ctx
