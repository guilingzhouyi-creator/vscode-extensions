# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_attribute_mount_instance.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 承载 Item UID 与 Attribute UID 关联、实例动态浮动数值、可见性状态与防伪审计。 可见性三态（可见/隐藏/已鉴定）控制数值与机制生效边界。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

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

## 从字典重建挂载实例（分类/可见性双形态解析 + 防伪审计载荷深拷贝）
static func from_dto(d: Dictionary) -> ItemAttributeMountInstance:
	var inst := ItemAttributeMountInstance.new()
	if d == null:
		return inst

	inst.mount_id = str(d.get("mount_id", ""))
	inst.item_uid = str(d.get("item_uid", ""))
	inst.attribute_uid = str(d.get("attribute_uid", ""))

	var cat_str := str(d.get("category", "INCREMENT")).to_upper()
	match cat_str:
		"DECREMENT":
			inst.category = ItemAttributeDefinition.AttributeCategory.DECREMENT
		"SPECIAL_AFFIX":
			inst.category = ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX
		_:
			inst.category = ItemAttributeDefinition.AttributeCategory.INCREMENT

	inst.current_value = float(d.get("current_value", 0.0))

	var vis_str := str(d.get("visibility", "VISIBLE")).to_upper()
	match vis_str:
		"HIDDEN":
			inst.visibility = VisibilityState.HIDDEN
		"APPRAISED":
			inst.visibility = VisibilityState.APPRAISED
		_:
			inst.visibility = VisibilityState.VISIBLE

	inst.is_active = bool(d.get("is_active", true))
	inst.appraisal_audit = (d.get("appraisal_audit", {}) as Dictionary).duplicate(true)

	return inst

## 序列化挂载实例为字典（枚举转字符串 + 审计载荷深拷贝）
func to_dto() -> Dictionary:
	var cat_str := "INCREMENT"
	match category:
		ItemAttributeDefinition.AttributeCategory.DECREMENT:
			cat_str = "DECREMENT"
		ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
			cat_str = "SPECIAL_AFFIX"

	var vis_str := "VISIBLE"
	match visibility:
		VisibilityState.HIDDEN:
			vis_str = "HIDDEN"
		VisibilityState.APPRAISED:
			vis_str = "APPRAISED"

	return {
		"mount_id": mount_id,
		"item_uid": item_uid,
		"attribute_uid": attribute_uid,
		"category": cat_str,
		"current_value": current_value,
		"visibility": vis_str,
		"is_active": is_active,
		"appraisal_audit": appraisal_audit.duplicate(true)
	}
