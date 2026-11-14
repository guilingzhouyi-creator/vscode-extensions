# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_attribute_definition.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 定义解耦后的 Attribute UID、ABC 分类、计算类型、非负上下界及词缀互斥/协同标签。 分类/计算类型枚举双形态解析，value_min 非负钳制（Inv-VD-3 区间有序）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ItemAttributeDefinition：Domain Logic Component
class_name ItemAttributeDefinition
extends RefCounted

# ==============================================================================
# 一、分类与计算类型枚举
# ==============================================================================

## 属性 ABC 分类：增量 / 减量 / 特殊词缀
enum AttributeCategory {
	INCREMENT,       ## A类：增量属性（正向数值增强）
	DECREMENT,       ## B类：减量属性（负向数值削减/代价诅咒）
	SPECIAL_AFFIX    ## C类：特殊词缀属性（机制改变/稀有被动/默认隐藏）
}

## 计算类型：固定数值 / 百分比 / 布尔开关 / 标签触发
enum CalculationType {
	FLAT_ADD,        ## 固定数值加减
	PERCENT_ADD,     ## 百分比加减
	BOOLEAN_FLAG,    ## 布尔特性开启
	TAG_TRIGGER      ## 标签机制触发
}

# ==============================================================================
# 二、属性定义字段
# ==============================================================================

var attribute_uid: String = ""
var canonical_id: String = ""
var category: AttributeCategory = AttributeCategory.INCREMENT
var target_stat: String = ""
var calculation_type: CalculationType = CalculationType.FLAT_ADD
var base_value: float = 0.0
var value_min: float = 0.0
var value_max: float = 99999.0
var affix_score: float = 0.0
var appraisal_requirement: Dictionary = {}
var conflict_tags: Array = []
var synergy_tags: Array = []

# ==============================================================================
# 三、DTO 转换
# ==============================================================================

## 从字典重建属性定义（ABC 分类/计算类型双形态解析，value_min 非负钳制）
static func from_dto(data: Dictionary) -> ItemAttributeDefinition:
	var definition := ItemAttributeDefinition.new()
	if data == null:
		return definition

	definition.attribute_uid = str(data.get("attribute_uid", ""))
	definition.canonical_id = str(data.get("canonical_id", ""))

	var category_text := str(data.get("category", "INCREMENT")).to_upper()
	match category_text:
		"DECREMENT":
			definition.category = AttributeCategory.DECREMENT
		"SPECIAL_AFFIX":
			definition.category = AttributeCategory.SPECIAL_AFFIX
		_:
			definition.category = AttributeCategory.INCREMENT

	definition.target_stat = str(data.get("target_stat", ""))

	var calculation_text := str(data.get("calculation_type", "FLAT_ADD")).to_upper()
	match calculation_text:
		"PERCENT_ADD":
			definition.calculation_type = CalculationType.PERCENT_ADD
		"BOOLEAN_FLAG":
			definition.calculation_type = CalculationType.BOOLEAN_FLAG
		"TAG_TRIGGER":
			definition.calculation_type = CalculationType.TAG_TRIGGER
		_:
			definition.calculation_type = CalculationType.FLAT_ADD

	definition.base_value = float(data.get("base_value", 0.0))
	definition.value_min = maxf(0.0, float(data.get("value_min", 0.0)))
	definition.value_max = float(data.get("value_max", 99999.0))
	definition.affix_score = maxf(0.0, float(data.get("affix_score", 0.0)))
	definition.appraisal_requirement = (data.get("appraisal_requirement", {}) as Dictionary).duplicate(true)
	definition.conflict_tags = (data.get("conflict_tags", []) as Array).duplicate(true)
	definition.synergy_tags = (data.get("synergy_tags", []) as Array).duplicate(true)

	return definition

## 序列化属性定义为字典（枚举转字符串 + 数组深拷贝）
func to_dto() -> Dictionary:
	var category_text := "INCREMENT"
	match category:
		AttributeCategory.DECREMENT:
			category_text = "DECREMENT"
		AttributeCategory.SPECIAL_AFFIX:
			category_text = "SPECIAL_AFFIX"

	var calculation_text := "FLAT_ADD"
	match calculation_type:
		CalculationType.PERCENT_ADD:
			calculation_text = "PERCENT_ADD"
		CalculationType.BOOLEAN_FLAG:
			calculation_text = "BOOLEAN_FLAG"
		CalculationType.TAG_TRIGGER:
			calculation_text = "TAG_TRIGGER"

	return {
		"attribute_uid": attribute_uid,
		"canonical_id": canonical_id,
		"category": category_text,
		"target_stat": target_stat,
		"calculation_type": calculation_text,
		"base_value": base_value,
		"value_min": value_min,
		"value_max": value_max,
		"affix_score": affix_score,
		"appraisal_requirement": appraisal_requirement.duplicate(true),
		"conflict_tags": conflict_tags.duplicate(true),
		"synergy_tags": synergy_tags.duplicate(true)
	}
