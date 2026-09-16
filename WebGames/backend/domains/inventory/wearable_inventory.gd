# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/wearable_inventory.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 随身穿戴暗格动态聚合、裸身容量 0 约束、负重超标拦截。 槽位清单/负重上限/分类判定由 config/domains/inventory.json 的 wearable 段驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name WearableInventoryAggregate extends RefCounted

const InventoryMetricSnapshotClass = preload("res://backend/domains/inventory/inventory_metric_snapshot.gd")

# ==============================================================================
# 一、仓储状态（含 Phase 64 增量度量缓存）
# ==============================================================================

var baseline_capacity: int = 0 # 裸身初始容量严格为 0，符合第一性原理约束
var max_carry_weight_kg: float = GameConfig.get_float("domains.inventory", "wearable/max_carry_weight_kg", 50.0)
var equipped_slots: Dictionary = _build_slot_map()
var storage_items: Array = []
var owner_account_id: String = ""

# Phase 64 性能加固：增量累加度量缓存与脏标记
var _cached_storage_volume: int = 0
var _cached_total_weight: float = 0.0
var _is_metric_dirty: bool = true

# ==============================================================================
# 二、容量与度量
# ==============================================================================

## 装配槽位映射表（wearable/slots 配置驱动，默认 7 槽全置空）
static func _build_slot_map() -> Dictionary:
	var map := {}
	for slot in GameConfig.get_array("domains.inventory", "wearable/slots", ["HEAD", "CHEST", "LEGS", "FEET", "MAIN_HAND", "OFF_HAND", "BACKPACK"]):
		map[slot] = null
	return map

## 刷新全量缓存度量（用于快照恢复或强制重校验）
func refresh_cached_metrics() -> void:
	var vol: int = 0
	var wt: float = 0.0
	for item in storage_items:
		if item is ItemEntity:
			vol += item.volume_slots
			wt += item.mass_kg
	for slot_val in equipped_slots.values():
		if slot_val is ItemEntity:
			wt += slot_val.mass_kg
	_cached_storage_volume = vol
	_cached_total_weight = wt
	_is_metric_dirty = false

## 获取当前背包度量快照不可变 DTO（Phase 64；脏标记仅内部使用，不入快照——refresh 后恒 false）
func get_metric_snapshot(race_bonus: float = 0.0) -> RefCounted:
	if _is_metric_dirty:
		refresh_cached_metrics()
	var max_cap := calculate_total_capacity(race_bonus)
	return InventoryMetricSnapshotClass.new(
		_cached_storage_volume,
		max_cap,
		_cached_total_weight,
		max_carry_weight_kg,
		storage_items.size()
	)

## 总容量计算：裸身容量 0 + 护甲/背包容积合计（种族加成后向下取整）
func calculate_total_capacity(race_bonus: float = 0.0) -> int:
	var armor_category := GameConfig.get_string("domains.inventory", "wearable/armor_category", "ARMOR_EQUIPMENT")
	var capacity_slots: Array = GameConfig.get_array("domains.inventory", "wearable/capacity_slots", ["BACKPACK"])
	var total = baseline_capacity
	for slot_key in equipped_slots:
		var slot_val = equipped_slots[slot_key]
		if slot_val is ItemEntity:
			if slot_val.category == armor_category or slot_key in capacity_slots:
				total += slot_val.volume_slots
	return int(floor(total * (1.0 + race_bonus)))

## 总负重：装备槽 + 背包物品质量合计（优先复用 O(1) 增量缓存）
func calculate_total_weight() -> float:
	if _is_metric_dirty:
		refresh_cached_metrics()
	return _cached_total_weight

## 入包判定：空引用/负值/重复 UID/容积超限/负重超限 逐项拦截（复用增量缓存）
func can_add_item(item: ItemEntity, race_bonus: float = 0.0) -> bool:
	if item == null or item.mass_kg < 0.0 or item.volume_slots < 0:
		return false
	if _contains_uid(item.item_uid):
		return false
	if _is_metric_dirty:
		refresh_cached_metrics()
	var current_vol := _cached_storage_volume
	var max_vol = calculate_total_capacity(race_bonus)
	if current_vol + item.volume_slots > max_vol:
		return false
	if _cached_total_weight + item.mass_kg > max_carry_weight_kg:
		return false
	return true

## 入包：校验通过后追加（空 UID 生成 INV_ 前缀 ID，置容器态与属主，增量累加缓存）
func add_item(item: ItemEntity, race_bonus: float = 0.0) -> bool:
	if not can_add_item(item, race_bonus):
		return false
	if item.item_uid.is_empty():
		item.item_uid = UniqueIdGenerator.next_id("INV_")
	storage_items.append(item)
	item.container_state = "INVENTORY"
	if not owner_account_id.is_empty():
		item.owner_account_id = owner_account_id
	if not _is_metric_dirty:
		_cached_storage_volume += item.volume_slots
		_cached_total_weight += item.mass_kg
	return true

# ==============================================================================
# 三、物品查找 / 移除 / 装备 / 卸装
# ==============================================================================

## 按 item_id 查找背包内首个物品（不存在返回 null）；
## 返回实例可直接交给 remove_item 完成按 id 移除
func find_item_by_item_id(item_id: String) -> ItemEntity:
	for item in storage_items:
		if item is ItemEntity and item.item_id == item_id:
			return item
	for item in equipped_slots.values():
		if item is ItemEntity and item.item_id == item_id:
			return item
	return null

## 按权威 item_uid 精确查找（UID 优先于 item_id，防同模板多实例误命中）
func find_item_by_item_uid(item_uid: String) -> ItemEntity:
	if item_uid.is_empty():
		return null
	for item in storage_items:
		if item is ItemEntity and item.item_uid == item_uid:
			return item
	for item in equipped_slots.values():
		if item is ItemEntity and item.item_uid == item_uid:
			return item
	return null

## 按实例引用移除物品（存在并成功移除返回 true，否则 false，增量扣减缓存）
func remove_item(item: ItemEntity) -> bool:
	if item == null:
		return false
	var idx := storage_items.find(item)
	if idx < 0:
		return false
	storage_items.remove_at(idx)
	item.container_state = "UNOWNED"
	if not _is_metric_dirty:
		_cached_storage_volume -= item.volume_slots
		_cached_total_weight -= item.mass_kg
		if _cached_storage_volume < 0:
			_cached_storage_volume = 0
		if _cached_total_weight < 0.0:
			_cached_total_weight = 0.0
	return true

## 装备：槽位存在/槽空/UID 未占用校验，置 EQUIPPED 态并归属（增量累加负重）
func equip_item(slot: String, item: ItemEntity) -> bool:
	if not equipped_slots.has(slot) or item == null:
		return false
	if equipped_slots[slot] != null or _contains_uid(item.item_uid):
		return false
	equipped_slots[slot] = item
	item.container_state = "EQUIPPED"
	if not owner_account_id.is_empty():
		item.owner_account_id = owner_account_id
	if not _is_metric_dirty:
		_cached_total_weight += item.mass_kg
	return true

## 卸装：清槽并返回物品（置 UNOWNED 态，增量扣减负重）
func unequip_item(slot: String) -> ItemEntity:
	if not equipped_slots.has(slot):
		return null
	var item = equipped_slots[slot]
	equipped_slots[slot] = null
	if item is ItemEntity:
		item.container_state = "UNOWNED"
		if not _is_metric_dirty:
			_cached_total_weight -= item.mass_kg
			if _cached_total_weight < 0.0:
				_cached_total_weight = 0.0
	return item

# ==============================================================================
# 四、快照 / 恢复 / 统一序列化
# ==============================================================================

## UID 占用判定（背包 + 装备槽全域，空 UID 恒 false）
func _contains_uid(item_uid: String) -> bool:
	if item_uid.is_empty():
		return false
	for item in storage_items:
		if item is ItemEntity and item.item_uid == item_uid:
			return true
	for item in equipped_slots.values():
		if item is ItemEntity and item.item_uid == item_uid:
			return true
	return false

## 深快照：物品级序列化往返（serialize/deserialize 重建），快照与运行实例完全解耦。
## 回滚可完整恢复装备槽、所有权、锁定与词缀/符文/耐久等深层字段，而非仅恢复数组结构
## （P39 清单2：原 duplicate() 浅拷贝对物品深层字段的就地变更无法回滚）。
func snapshot() -> Dictionary:
	var storage_payloads: Array = []
	for item in storage_items:
		if item is ItemEntity:
			storage_payloads.append(item.serialize())
	var equipped_payloads := {}
	for slot_key in equipped_slots:
		var slot_item = equipped_slots[slot_key]
		equipped_payloads[slot_key] = slot_item.serialize() if slot_item is ItemEntity else null
	return {
		"storage_payloads": storage_payloads,
		"equipped_payloads": equipped_payloads,
		"owner_account_id": owner_account_id
	}

## 快照恢复：唯一入口仅接受 snapshot() 深载荷（storage_payloads/equipped_payloads），
## 按载荷重建全新实例（含 item_uid，保持实例可追溯性）；旧引用快照浅拷贝路径已退役
func restore(snapshot_data: Dictionary) -> void:
	if snapshot_data == null:
		return
	owner_account_id = str(snapshot_data.get("owner_account_id", owner_account_id))
	if snapshot_data.has("storage_payloads"):
		# 深快照路径：按载荷重建全新实例（含 item_uid，保持实例可追溯性）
		var rebuilt_storage: Array = []
		for raw in snapshot_data.get("storage_payloads", []):
			if raw is Dictionary:
				rebuilt_storage.append(ItemEntity.deserialize(raw))
		storage_items = rebuilt_storage
		var rebuilt_slots := {}
		var raw_slots: Dictionary = snapshot_data.get("equipped_payloads", {})
		for slot_key in raw_slots:
			var raw = raw_slots[slot_key]
			rebuilt_slots[slot_key] = ItemEntity.deserialize(raw) if raw is Dictionary else null
		equipped_slots = rebuilt_slots
	else:
		# 无深载荷：空容器恢复 + 审计警告（不静默吞掉畸形快照；旧引用路径已退役）
		push_warning("RestorePayloadMissing: wearable_inventory 快照缺失 storage_payloads，已按空容器恢复")
		storage_items = []
		equipped_slots = {}
	for item in storage_items:
		if item is ItemEntity:
			item.container_state = "INVENTORY"
	for item in equipped_slots.values():
		if item is ItemEntity:
			item.container_state = "EQUIPPED"
	_is_metric_dirty = true
	refresh_cached_metrics()

## 统一数据标准序列化（Inv-SV-2）：接入 SaveDomainContract 统一接口
func serialize() -> Dictionary:
	return snapshot()

## 统一数据标准反序列化（Inv-SV-2）：静态工厂方法重构聚合
static func deserialize(data: Dictionary) -> WearableInventoryAggregate:
	var inv := WearableInventoryAggregate.new()
	inv.restore(data)
	return inv
