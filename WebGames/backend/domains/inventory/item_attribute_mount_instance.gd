# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_attribute_mount_instance.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 承载 Item UID 与 Attribute UID 关联、实例动态浮动数值、可见性状态与防篡改审计。 可见性三态（可见/隐藏/已鉴定）控制数值与机制生效边界。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ItemAttributeMountInstance：Domain Logic Component
class_name ItemAttributeMountInstance
extends RefCounted

# ==============================================================================
# 一、可见性状态与挂载字段
# ==============================================================================

## 可见性三态：已知可见 / 隐藏未鉴定 / 经鉴定已激活
enum VisibilityState {
	VISIBLE,    ## 已知可见（A类、B类默认处于此状态）
	HIDDEN,     ## 隐藏未鉴定（C类默认处于此状态，数值与机制不生效）
	APPRAISED   ## 经鉴定已激活（已完全揭示，机制生效）
}

var mount_id: String = ""
var item_uid: String = ""
var attribute_uid: String = ""
var category: ItemAttributeDefinition.AttributeCategory = ItemAttributeDefinition.AttributeCategory.INCREMENT
var current_value: float = 0.0
var visibility: VisibilityState = VisibilityState.VISIBLE
var is_active: bool = true
var appraisal_audit: Dictionary = {
	"is_appraised": false,
	"appraised_timestamp": 0,
	"appraiser_actor_id": "",
	"audit_signature": ""
}

# ==============================================================================
# 二、DTO 转换
# ==============================================================================

## 从字典重建挂载实例（分类/可见性双形态解析 + 防篡改审计载荷深拷贝）
static func from_dto(serialized_mount: Dictionary) -> ItemAttributeMountInstance:
	var instance := ItemAttributeMountInstance.new()
	if serialized_mount == null:
		return instance

	instance.mount_id = str(serialized_mount.get("mount_id", ""))
	instance.item_uid = str(serialized_mount.get("item_uid", ""))
	instance.attribute_uid = str(serialized_mount.get("attribute_uid", ""))

	var category_text := str(serialized_mount.get("category", "INCREMENT")).to_upper()
	match category_text:
		"DECREMENT":
			instance.category = ItemAttributeDefinition.AttributeCategory.DECREMENT
		"SPECIAL_AFFIX":
			instance.category = ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX
		_:
			instance.category = ItemAttributeDefinition.AttributeCategory.INCREMENT

	instance.current_value = float(serialized_mount.get("current_value", 0.0))

	var visibility_text := str(serialized_mount.get("visibility", "VISIBLE")).to_upper()
	match visibility_text:
		"HIDDEN":
			instance.visibility = VisibilityState.HIDDEN
		"APPRAISED":
			instance.visibility = VisibilityState.APPRAISED
		_:
			instance.visibility = VisibilityState.VISIBLE

	instance.is_active = bool(serialized_mount.get("is_active", true))
	instance.appraisal_audit = (serialized_mount.get("appraisal_audit", {}) as Dictionary).duplicate(true)

	return instance

## 序列化挂载实例为字典（枚举转字符串 + 审计载荷深拷贝）
func to_dto() -> Dictionary:
	var category_text := "INCREMENT"
	match category:
		ItemAttributeDefinition.AttributeCategory.DECREMENT:
			category_text = "DECREMENT"
		ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
			category_text = "SPECIAL_AFFIX"

	var visibility_text := "VISIBLE"
	match visibility:
		VisibilityState.HIDDEN:
			visibility_text = "HIDDEN"
		VisibilityState.APPRAISED:
			visibility_text = "APPRAISED"

	return {
		"mount_id": mount_id,
		"item_uid": item_uid,
		"attribute_uid": attribute_uid,
		"category": category_text,
		"current_value": current_value,
		"visibility": visibility_text,
		"is_active": is_active,
		"appraisal_audit": appraisal_audit.duplicate(true)
	}
