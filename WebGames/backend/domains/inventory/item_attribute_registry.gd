# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_attribute_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 加载 config/domains/item_attributes.json 中的属性全量定义，支持热重载与快速索引。 倒置区间定义（value_min > value_max）拒绝登记并告警（Inv-VD-3 区间有序不变量）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ItemAttributeRegistry
extends RefCounted

# ==============================================================================
# 一、单例与状态
# ==============================================================================

static var _shared: ItemAttributeRegistry = null

var _definitions: Dictionary = {}

## 共享注册表单例（懒加载 + 首次重载配置）
static func get_shared() -> ItemAttributeRegistry:
	if _shared == null:
		_shared = ItemAttributeRegistry.new()
		_shared.reload_configuration()
	return _shared

## 重载属性定义：解析 item_attributes.json，倒置区间（Inv-VD-3）拒绝登记并告警
func reload_configuration() -> void:
	_definitions.clear()
	var raw_attrs: Dictionary = GameConfig.get_dict("domains.item_attributes", "attributes", {})
	for attr_uid in raw_attrs.keys():
		var d: Dictionary = (raw_attrs[attr_uid] as Dictionary).duplicate(true)
		d["attribute_uid"] = str(attr_uid)
		var def := ItemAttributeDefinition.from_dto(d)
		# L11（Phase 55）：clamp 区间有序不变量（Inv-VD-3）——value_min > value_max 的倒置定义
		# 拒绝登记并告警（旧实现静默登记 → 求值 clampf 恒返 value_max 的静默数值错误）
		if def.value_min > def.value_max:
			push_warning("item_attributes: %s 倒置定义 value_min(%s) > value_max(%s)，拒绝登记" % [str(attr_uid), def.value_min, def.value_max])
			continue
		_definitions[str(attr_uid)] = def

# ==============================================================================
# 二、查询接口
# ==============================================================================

## 按属性 UID 取定义（空表先重载；未登记返回 null）
func get_definition(attribute_uid: String) -> ItemAttributeDefinition:
	if _definitions.is_empty():
		reload_configuration()
	return _definitions.get(attribute_uid, null)

## 属性 UID 是否已登记（空表先重载）
func has_definition(attribute_uid: String) -> bool:
	if _definitions.is_empty():
		reload_configuration()
	return _definitions.has(attribute_uid)

## 全量定义副本（防外部突变）
func get_all_definitions() -> Dictionary:
	if _definitions.is_empty():
		reload_configuration()
	return _definitions.duplicate()
