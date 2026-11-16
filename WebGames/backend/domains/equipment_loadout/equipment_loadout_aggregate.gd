# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/equipment_loadout/equipment_loadout_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/equipment.json | 信号: EventBus 领域广播
# 职责说明: 战备槽位物理聚合（槽位清单、装备/卸下、序列化与槽位引用快照恢复）； 槽位清单与默认值由 config/domains/equipment.json 驱动（代码零硬编码）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## EquipmentLoadoutAggregate：Domain Entity / Aggregate Root
class_name EquipmentLoadoutAggregate extends RefCounted

# ==============================================================================
# 一、战备套元数据（config/domains/equipment.json 驱动）
# ==============================================================================

## 战备套唯一 ID（loadout_defaults/loadout_id 配置，默认 LOADOUT_SET_01）
var loadout_id: String = GameConfig.get_string("domains.equipment", "loadout_defaults/loadout_id", "LOADOUT_SET_01")
## 战备套展示名（loadout_defaults/loadout_name 配置，默认「标准战备套」）
var loadout_name: String = GameConfig.get_string("domains.equipment", "loadout_defaults/loadout_name", "标准战备套")

# ==============================================================================
# 二、槽位映射构建
# ==============================================================================

## 槽位映射表（slots 配置驱动，默认 10 槽全置空）
var slots: Dictionary = _build_slot_map()

## 装配槽位映射表（domains.equipment slots 配置驱动，默认 10 槽全置空）
static func _build_slot_map() -> Dictionary:
	var slot_map := {}
	var slot_list: Array = GameConfig.get_array("domains.equipment", "slots", ["HEAD", "CHEST", "LEGS", "FEET", "HANDS", "MAIN_HAND", "OFF_HAND", "NECK", "RING_1", "RING_2"])
	for slot_name in slot_list:
		slot_map[str(slot_name)] = null
	return slot_map

# ==============================================================================
# 三、装备 / 卸下
# ==============================================================================

## 按槽位取已装备物品（未占用返回 null）
func get_equipped_item(slot_name: String) -> ItemEntity:
	return slots.get(slot_name, null)

## 装备：替换旧物（旧物置 UNOWNED）并置新物 EQUIPPED，返回旧物
func equip(slot_name: String, equipment_item: ItemEntity) -> ItemEntity:
	if not slots.has(slot_name):
		return null
	var previous_item: Variant = slots[slot_name]
	slots[slot_name] = equipment_item
	if equipment_item is ItemEntity:
		equipment_item.container_state = "EQUIPPED"
	if previous_item is ItemEntity:
		previous_item.container_state = "UNOWNED"
	return previous_item

## 卸下：清槽并置 UNOWNED，返回旧物
func unequip(slot_name: String) -> ItemEntity:
	if not slots.has(slot_name):
		return null
	var previous_item: Variant = slots[slot_name]
	slots[slot_name] = null
	if previous_item is ItemEntity:
		previous_item.container_state = "UNOWNED"
	return previous_item

## 按实例引用反查槽位并卸下（处置销毁已穿戴物品时与 inventory 侧联动清槽）；
## 未持有该实例返回空串。O(槽位数) 线性查找，槽位数为个位数常数。
func unequip_item_ref(target_item: ItemEntity) -> String:
	if target_item == null:
		return ""
	for slot_name in slots:
		if slots[slot_name] == target_item:
			slots[slot_name] = null
			target_item.container_state = "UNOWNED"
			return slot_name
	return ""

# ==============================================================================
# 四、序列化 / 反序列化
# ==============================================================================

## 序列化战备套（槽位物品载荷 + loadout 元数据）
func serialize() -> Dictionary:
	var serialized_slots := {}
	for slot_key in slots:
		var slot_item: Variant = slots[slot_key]
		if slot_item is ItemEntity:
			serialized_slots[slot_key] = slot_item.serialize()
	return { "loadout_id": loadout_id, "loadout_name": loadout_name, "slots": serialized_slots }

## 从字典重建战备套（槽位键作实例判别子，同模板多件迁移 UID 互异）
static func deserialize(serialized_loadout: Dictionary) -> EquipmentLoadoutAggregate:
	var loadout := EquipmentLoadoutAggregate.new()
	loadout.loadout_id = serialized_loadout.get("loadout_id", GameConfig.get_string("domains.equipment", "loadout_defaults/fallback_id", "LOADOUT_01"))
	loadout.loadout_name = serialized_loadout.get("loadout_name", GameConfig.get_string("domains.equipment", "loadout_defaults/fallback_name", "战备套"))
	var raw_slots: Variant = serialized_loadout.get("slots", {})
	for slot_key in raw_slots:
		if loadout.slots.has(slot_key) and raw_slots[slot_key] is Dictionary:
			loadout.slots[slot_key] = ItemEntity.deserialize(raw_slots[slot_key]) # 槽位键作实例判别子：同模板多件迁移 UID 互异
	return loadout

# ==============================================================================
# 五、槽位引用快照与恢复
# ==============================================================================

## 槽位引用快照（SURFACE_LOADOUT）：仅记录 槽位名 → item_uid，不持有实例引用。
## 配合 inventory.restore() 的重建式恢复使用——按 uid 反查重建实例回挂，杜绝双簿记引用断裂（M5）。
func snapshot_slots() -> Dictionary:
	var slot_snapshot := {}
	for slot_name in slots:
		var slot_item: Variant = slots[slot_name]
		if slot_item is ItemEntity:
			slot_snapshot[slot_name] = slot_item.item_uid
	return slot_snapshot

## 依 item_uid 从 inventory 反查重建实例回挂；调用时序约束：先 inventory.restore() 再本方法。
## 幂等：先清空全部槽位（命中实例置 UNOWNED），再按快照逐槽回挂（未找到的 uid 槽位保持空）。
func restore_slots(slot_snapshot: Dictionary, inventory: WearableInventoryAggregate = null) -> void:
	if slot_snapshot == null:
		return
	for slot_name in slots:
		var current_item: Variant = slots[slot_name]
		if current_item is ItemEntity:
			current_item.container_state = "UNOWNED"
		slots[slot_name] = null
	for slot_name in slot_snapshot:
		if not slots.has(slot_name):
			continue
		var restored_item: ItemEntity = inventory.find_item_by_item_uid(str(slot_snapshot[slot_name])) if inventory != null else null
		if restored_item != null:
			slots[slot_name] = restored_item
			restored_item.container_state = "EQUIPPED"
