# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/wearable_inventory_aggregate.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 随身穿戴暗格动态聚合、裸身容量 0 约束、负重超标拦截。 槽位清单/负重上限/分类判定由 config/domains/inventory.json 的 wearable 段驱动。
# 退出语义与设计依据: 业务域第一性原理 / 穿戴背包聚合根架构规范
# ==============================================================================

## WearableInventoryAggregate：Domain Logic Component
class_name WearableInventoryAggregate extends RefCounted

const InventoryMetricSnapshotClass = preload("res://backend/domains/inventory/inventory_metric_snapshot.gd")
const ItemUIDGenerator = preload("res://backend/domains/item_namespace_registry/item_uid_generator.gd")

# ==============================================================================
# 一、仓储状态（含增量度量缓存）
# ==============================================================================

var baseline_capacity: int = 0 # 裸身初始容量严格为 0，符合第一性原理约束
var max_carry_weight_kg: float = GameConfig.get_float("domains.inventory", "wearable/max_carry_weight_kg", 50.0)
var equipped_slots: Dictionary = _build_slot_map()
var storage_items: Array = []
var owner_account_id: String = ""

## 护甲与扩展容器槽位配置快照缓存（随 GameConfig.config_reload_version() 自动失效）
class ArmorConfigCache extends RefCounted:
	var armor_category: String = "ARMOR_EQUIPMENT"
	var capacity_slot_set: Dictionary = {"BACKPACK": true}

static var _armor_config_cache: ArmorConfigCache = null
static var _armor_config_version: int = -1

static func _ensure_armor_cache() -> ArmorConfigCache:
	var config_version: int = GameConfig.config_reload_version()
	if _armor_config_cache != null and _armor_config_version == config_version:
		return _armor_config_cache
	var cache := ArmorConfigCache.new()
	cache.armor_category = GameConfig.get_string("domains.inventory", "wearable/armor_category", "ARMOR_EQUIPMENT")
	var slots: Array = GameConfig.get_array("domains.inventory", "wearable/capacity_slots", ["BACKPACK"])
	var slot_set: Dictionary = {}
	for slot_name in slots:
		slot_set[str(slot_name)] = true
	cache.capacity_slot_set = slot_set
	_armor_config_cache = cache
	_armor_config_version = config_version
	return cache

# 性能加固：增量累加度量缓存、UID 索引与脏标记
var _cached_storage_volume: int = 0
var _cached_total_weight: float = 0.0
var _uid_index: Dictionary = {}
var _is_metric_dirty: bool = true

# ==============================================================================
# 二、容量与度量
# ==============================================================================

## 装配槽位映射表（wearable/slots 配置驱动，默认 7 槽全置空）
static func _build_slot_map() -> Dictionary:
	var map := {}
	var slots: Array = GameConfig.get_array("domains.inventory", "wearable/slots", ["HEAD", "CHEST", "LEGS", "FEET", "MAIN_HAND", "OFF_HAND", "BACKPACK"])
	for slot in slots:
		map[slot] = null
	return map

## 刷新全量缓存度量（用于快照恢复或强制重校验）
func refresh_cached_metrics() -> void:
	var total_volume: int = 0
	var total_weight: float = 0.0
	_uid_index.clear()
	for item in storage_items:
		if item is ItemEntity:
			total_volume += item.volume_slots
			total_weight += item.mass_kg
			if not item.item_uid.is_empty():
				_uid_index[item.item_uid] = item
	for slot_item in equipped_slots.values():
		if slot_item is ItemEntity:
			total_weight += slot_item.mass_kg
			if not slot_item.item_uid.is_empty():
				_uid_index[slot_item.item_uid] = slot_item
	_cached_storage_volume = total_volume
	_cached_total_weight = total_weight
	_is_metric_dirty = false

## 获取当前背包度量快照不可变 DTO（脏标记仅内部使用，不入快照——refresh 后恒 false）
func get_metric_snapshot(race_bonus: float = 0.0) -> RefCounted:
	if _is_metric_dirty:
		refresh_cached_metrics()
	var max_capacity := calculate_total_capacity(race_bonus)
	return InventoryMetricSnapshotClass.new(
		_cached_storage_volume,
		max_capacity,
		_cached_total_weight,
		max_carry_weight_kg,
		storage_items.size()
	)

## 总容量计算：裸身容量 0 + 护甲/背包容积合计（种族加成后向下取整）
func calculate_total_capacity(race_bonus: float = 0.0) -> int:
	var armor_config := _ensure_armor_cache()
	var armor_category: String = armor_config.armor_category
	var capacity_slot_set: Dictionary = armor_config.capacity_slot_set
	var total: int = baseline_capacity
	for slot_key in equipped_slots:
		var slot_item: Variant = equipped_slots[slot_key]
		if slot_item is ItemEntity:
			if slot_item.category == armor_category or capacity_slot_set.has(str(slot_key)):
				total += slot_item.volume_slots
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
	var current_volume := _cached_storage_volume
	var max_volume: int = calculate_total_capacity(race_bonus)
	if current_volume + item.volume_slots > max_volume:
		return false
	if _cached_total_weight + item.mass_kg > max_carry_weight_kg:
		return false
	return true

## 入包：校验通过后追加（空 UID 生成 SRV_ 前缀 ID，置容器态与属主，增量累加缓存）
func add_item(item: ItemEntity, race_bonus: float = 0.0) -> bool:
	if not can_add_item(item, race_bonus):
		return false
	if item.item_uid.is_empty():
		item.item_uid = ItemUIDGenerator.generate_uid("SRV_")
	storage_items.append(item)
	item.container_state = "INVENTORY"
	if not owner_account_id.is_empty():
		item.owner_account_id = owner_account_id
	if not _is_metric_dirty:
		_cached_storage_volume += item.volume_slots
		_cached_total_weight += item.mass_kg
		if not item.item_uid.is_empty():
			_uid_index[item.item_uid] = item
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
	if _is_metric_dirty:
		refresh_cached_metrics()
	return _uid_index.get(item_uid, null) as ItemEntity

enum RemovalOutcome {
	NOT_FOUND = 0,
	REMOVED_STORAGE = 1,
	UNEQUIPPED_SLOT = 2,
}

## 按实例引用移除物品（存在并成功移除返回 true，否则 false，增量扣减缓存）
func remove_item(item: ItemEntity) -> bool:
	if item == null:
		return false
	var item_index := storage_items.find(item)
	if item_index < 0:
		return false
	storage_items.remove_at(item_index)
	item.container_state = "UNOWNED"
	if not _is_metric_dirty:
		_cached_storage_volume -= item.volume_slots
		_cached_total_weight -= item.mass_kg
		if _cached_storage_volume < 0:
			_cached_storage_volume = 0
		if _cached_total_weight < 0.0:
			_cached_total_weight = 0.0
		if not item.item_uid.is_empty():
			_uid_index.erase(item.item_uid)
	return true

## 从背包或已装备槽位统一移除指定物品，返回移除来源枚举（供销毁/追缴/分解等管线统一复用）
