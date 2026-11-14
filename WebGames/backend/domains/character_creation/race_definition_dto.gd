# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/race_definition_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 承载配置驱动种族定义（races_catalog 词条）的元数据： - race_id / canonical_name_key：种族标识与本地化名称键 - is_enabled / canary_feature_tag：启用态与灰度扩展标签（多种族灰度预留） - base_stat_modifiers：六维基础属性修正（配置驱动，不写死种族） - innate_traits / allowed_genders：默认先天特质与可选性别枚举 关联细则: 阶段1 §1.1（RaceDefinitionDTO 元数据契约）
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## RaceDefinitionDTO：Value Object DTO / Data Transport Model
class_name RaceDefinitionDTO
extends RefCounted

# ==============================================================================
# 一、字段（种族定义元数据）
# ==============================================================================

var race_id: String = "HUMAN"                  # 种族唯一标识
var canonical_name_key: String = ""            # 本地化名称键（i18n 表路由）
var is_enabled: bool = true                    # 启用态（false 走 Canary 灰度校验）
var canary_feature_tag: String = ""            # 灰度扩展标签（多种族灰度预留）
var base_stat_modifiers: Dictionary = {}       # 六维基础属性修正（配置驱动）
var innate_traits: Array[String] = []          # 默认先天特质 ID 清单
var allowed_genders: Array[String] = ["MALE", "FEMALE"] # 可选性别枚举

# ==============================================================================
# 二、序列化与反序列化
# ==============================================================================

## 序列化种族定义为字典（base_stat_modifiers 等嵌套数组/字典深拷贝）
func to_dto() -> Dictionary:
	return {
		"race_id": race_id,
		"canonical_name_key": canonical_name_key,
		"is_enabled": is_enabled,
		"canary_feature_tag": canary_feature_tag,
		"base_stat_modifiers": base_stat_modifiers.duplicate(true),
		"innate_traits": innate_traits.duplicate(),
		"allowed_genders": allowed_genders.duplicate()
	}

## 从字典反序列化种族定义（Array[String] 字段逐元素转换，禁整表 duplicate 赋类型化数组）。
## 契约：空字典返回默认人族定义；缺失字段按各自默认值补齐（旧档兼容）。
static func from_dto(raw_data: Dictionary) -> RaceDefinitionDTO:
	var definition_dto := RaceDefinitionDTO.new()
	if raw_data.is_empty():
		return definition_dto
	definition_dto.race_id = str(raw_data.get("race_id", "HUMAN"))
	definition_dto.canonical_name_key = str(raw_data.get("canonical_name_key", ""))
	definition_dto.is_enabled = bool(raw_data.get("is_enabled", true))
	definition_dto.canary_feature_tag = str(raw_data.get("canary_feature_tag", ""))
	definition_dto.base_stat_modifiers = (raw_data.get("base_stat_modifiers", {}) as Dictionary).duplicate(true)
	# Array[String] 字段逐元素转换（禁止整表 duplicate 赋给类型化数组，避免运行时类型错误）
	definition_dto.innate_traits.clear()
	for trait_id in (raw_data.get("innate_traits", []) as Array):
		definition_dto.innate_traits.append(str(trait_id))
	definition_dto.allowed_genders.clear()
	for gender_name in (raw_data.get("allowed_genders", ["MALE", "FEMALE"]) as Array):
		definition_dto.allowed_genders.append(str(gender_name))
	return definition_dto
