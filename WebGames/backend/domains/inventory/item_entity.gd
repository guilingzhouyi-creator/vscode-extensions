# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_entity.gd
# 架构定位: Domain Entity / Aggregate Root
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 万物物品聚合根、物理材质硬度、刃口常数与裸身容量 0 约束。 物品默认属性由 config/domains/inventory.json 的 item_defaults 段驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ItemEntity：Domain Entity / Aggregate Root
class_name ItemEntity extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

# ==============================================================================
# 一、序列化版本与分类常量
# ==============================================================================

const SERIALIZATION_VERSION: int = 2

## 物品分类常量（与 item_defaults/category 配置对齐）
const CATEGORY_WEAPON_BLADE: String = "WEAPON_BLADE"
const CATEGORY_WEAPON_BLUNT: String = "WEAPON_BLUNT"
const CATEGORY_WEAPON_POLE: String = "WEAPON_POLE"
const CATEGORY_ARMOR_EQUIPMENT: String = "ARMOR_EQUIPMENT"
const CATEGORY_CONSUMABLE_POTION: String = "CONSUMABLE_POTION"
const CATEGORY_CONSUMABLE_RATION: String = "CONSUMABLE_RATION"
const CATEGORY_MANA_CRYSTAL: String = "MANA_CRYSTAL"
const CATEGORY_CRAFTING_MATERIAL: String = "CRAFTING_MATERIAL"
const CATEGORY_MANUSCRIPT_GRIMOIRE: String = "MANUSCRIPT_GRIMOIRE"
const CATEGORY_QUEST_MISC: String = "QUEST_MISC"

# ==============================================================================
# 二、配置静态缓存与物品字段（默认值来自 item_defaults 配置段）
# ==============================================================================
class ItemDefaultsCache extends RefCounted:
	var custom_name: String = "未命名物品"
	var category: String = CATEGORY_QUEST_MISC
	var mass_kg: float = 1.0
	var volume_slots: int = 1
	var durability: float = 100.0
	var material_hardness: float = 10.0
	var combat_metrics: Dictionary = {}
	var affix_sockets: Dictionary = {}
	var market_base_price: int = 10
	var deserialize_name: String = "未知物品"

static var _defaults_cache: ItemDefaultsCache = null
static var _defaults_config_version: int = -1

static func _ensure_defaults() -> ItemDefaultsCache:
	if _defaults_cache != null and _defaults_config_version == GameConfig.config_reload_version():
		return _defaults_cache
	var defaults_cache := ItemDefaultsCache.new()
	defaults_cache.custom_name = GameConfig.get_string("domains.inventory", "item_defaults/custom_name", "未命名物品")
	defaults_cache.category = GameConfig.get_string("domains.inventory", "item_defaults/category", CATEGORY_QUEST_MISC)
	defaults_cache.mass_kg = GameConfig.get_float("domains.inventory", "item_defaults/mass_kg", 1.0)
	defaults_cache.volume_slots = GameConfig.get_int("domains.inventory", "item_defaults/volume_slots", 1)
	defaults_cache.durability = GameConfig.get_float("domains.inventory", "item_defaults/durability", 100.0)
	defaults_cache.material_hardness = GameConfig.get_float("domains.inventory", "item_defaults/material_hardness", 10.0)
	defaults_cache.combat_metrics = {
		"edge_sharpness": GameConfig.get_float("domains.inventory", "item_defaults/combat_metrics/edge_sharpness", 1.0),
		"reach_meters": GameConfig.get_float("domains.inventory", "item_defaults/combat_metrics/reach_meters", 1.0),
		"effective_armor": GameConfig.get_float("domains.inventory", "item_defaults/combat_metrics/effective_armor", 0.0),
		"elemental_resistances": {}
	}
	defaults_cache.affix_sockets = {
		"total_sockets": GameConfig.get_int("domains.inventory", "item_defaults/total_sockets", 2),
		"imprinted_runes": [],
		"dynamic_affixes": []
	}
	defaults_cache.market_base_price = GameConfig.get_int("domains.inventory", "item_defaults/market_base_price", 10)
	defaults_cache.deserialize_name = GameConfig.get_string("domains.inventory", "item_defaults/deserialize_name", "未知物品")
	_defaults_cache = defaults_cache
	_defaults_config_version = GameConfig.config_reload_version()
	return defaults_cache

var item_id: String = ""
# 实例全局唯一 UID（权威/可追溯/幂等）：发放来源前缀 + 单调计数 + 校验尾
var item_uid: String = ""
var template_id: String = ""
var custom_name: String = ""
# 合法分类: WEAPON_BLADE / WEAPON_BLUNT / WEAPON_POLE / ARMOR_EQUIPMENT / CONSUMABLE_POTION / CONSUMABLE_RATION / MANA_CRYSTAL / CRAFTING_MATERIAL / MANUSCRIPT_GRIMOIRE / QUEST_MISC
var category: String = ""
var mass_kg: float = 0.0
var volume_slots: int = 0
var durability_current: float = 0.0
var durability_max: float = 0.0
var material_hardness: float = 0.0
var combat_metrics: Dictionary = {}
var affix_sockets: Dictionary = {}
var market_base_price: int = 0
var quality_snapshot: Dictionary = {} # 品质等级统一度量快照（空=未声明，行为不变）
var container_state: String = "UNOWNED"
var owner_account_id: String = ""
var attribute_mounts: Array = [] # 物品属性双 UID 挂载条目 (Array[ItemAttributeMountInstance])

func _init() -> void:
	reset_state()

## 状态重置与池化复用契约（ADV-PRF-002）：快速应用静态配置缓存默认值
func reset_state() -> void:
	super.reset_state()
	var defaults_cache := _ensure_defaults()
	item_id = ""
	item_uid = ""
	template_id = ""
	custom_name = defaults_cache.custom_name
	category = defaults_cache.category
	mass_kg = defaults_cache.mass_kg
	volume_slots = defaults_cache.volume_slots
	durability_current = defaults_cache.durability
	durability_max = defaults_cache.durability
	material_hardness = defaults_cache.material_hardness
	combat_metrics = defaults_cache.combat_metrics.duplicate(true)
	affix_sockets = defaults_cache.affix_sockets.duplicate(true)
	market_base_price = defaults_cache.market_base_price
	quality_snapshot.clear()
	container_state = "UNOWNED"
	owner_account_id = ""
	attribute_mounts.clear()

# ==============================================================================
# 三、序列化 / 反序列化 / 工厂
# ==============================================================================

## 序列化物品为字典（attribute_mounts 转为 DTO 数组，嵌套容器深拷贝）
func serialize() -> Dictionary:
	var mounts_dto: Array = []
	for mount_entry in attribute_mounts:
		if mount_entry is ItemAttributeMountInstance:
			mounts_dto.append(mount_entry.to_dto())
		elif mount_entry is Dictionary:
			mounts_dto.append(mount_entry)

	return {
		"serialization_version": SERIALIZATION_VERSION,
		"item_id": item_id,
		"item_uid": item_uid,
		"template_id": template_id,
		"custom_name": custom_name,
		"category": category,
		"mass_kg": mass_kg,
		"volume_slots": volume_slots,
		"durability_current": durability_current,
		"durability_max": durability_max,
		"material_hardness": material_hardness,
		"combat_metrics": combat_metrics.duplicate(true),
		"affix_sockets": affix_sockets.duplicate(true),
		"market_base_price": market_base_price,
		"quality_snapshot": quality_snapshot.duplicate(true),
		"container_state": container_state,
		"owner_account_id": owner_account_id,
		"attribute_mounts": mounts_dto
	}

## 挂载物品属性（绑定实例到当前物品 UID，追加进挂载列表）
func mount_attribute(mount: ItemAttributeMountInstance) -> void:
	if mount:
		mount.item_uid = item_uid
		attribute_mounts.append(mount)

## 反序列化：缺键一律沿用字段初值（即 item_defaults 配置缺省），默认值单点化于此。
## 两处刻意保留的差异默认回退：custom_name 走独立的 deserialize_name 键（损坏存档回落
## 「未知物品」而非「未命名物品」）；combat_metrics / affix_sockets 缺键回落空字典
## （非配置富缺省，与既有存档兼容语义一致）。
static func deserialize(data: Dictionary, _instance_discriminator: String = "") -> ItemEntity:
	var item := ItemEntity.new()
	if data == null:
		return item
	item.item_id = str(data.get("item_id", item.item_id))
	item.item_uid = data.get("item_uid", "")
	item.template_id = str(data.get("template_id", item.template_id))
	# 缺省 UID 重设默认值：自动分配新架构标准服务端发放 UID（权威/可追溯/合规）
	if item.item_uid.is_empty():
		var generated_uid := ItemUIDGenerator.generate_uid("SRV_")
		if generated_uid.is_empty():
			generated_uid = "SRV_00000001" + "SRV_1".sha256_text().substr(0, 2)
		item.item_uid = generated_uid
	item.custom_name = data.get("custom_name", _ensure_defaults().deserialize_name)
	item.category = data.get("category", item.category)
	item.mass_kg = maxf(0.0, float(data.get("mass_kg", item.mass_kg)))
	item.volume_slots = maxi(0, int(data.get("volume_slots", item.volume_slots)))
	item.durability_current = clampf(float(data.get("durability_current", item.durability_current)), 0.0, maxf(0.0, float(data.get("durability_max", item.durability_max))))
	item.durability_max = maxf(0.0, float(data.get("durability_max", item.durability_max)))
	item.material_hardness = maxf(0.0, float(data.get("material_hardness", item.material_hardness)))
	item.combat_metrics = (data.get("combat_metrics", {}) as Dictionary).duplicate(true) if data.get("combat_metrics", {}) is Dictionary else {}
	item.affix_sockets = (data.get("affix_sockets", {}) as Dictionary).duplicate(true) if data.get("affix_sockets", {}) is Dictionary else {}
	item.market_base_price = maxi(0, int(data.get("market_base_price", item.market_base_price)))
	item.quality_snapshot = (data.get("quality_snapshot", {}) as Dictionary).duplicate(true) if data.get("quality_snapshot", {}) is Dictionary else {}
	item.container_state = str(data.get("container_state", item.container_state))
	item.owner_account_id = str(data.get("owner_account_id", item.owner_account_id))

	var raw_mounts: Variant = data.get("attribute_mounts", [])
	if raw_mounts is Array:
		for mount_data in raw_mounts:
			if mount_data is Dictionary:
				item.attribute_mounts.append(ItemAttributeMountInstance.from_dto(mount_data))

	return item

## 物品载荷统一工厂：跨域 payload 字典 -> ItemEntity，杜绝各管线手工逐字段赋值漂移。
## 键名契约（canonical，括号内为兼容别名，检索顺序 canonical 优先）：
##   template_id（item_template_id）——同时写入 item_id 与 template_id；
##   name（custom_name / item_name）——显示名；
##   mass_kg / volume_slots —— 物理属性。
## fallback_* 仅在 payload 未提供对应键时生效；未提供的字段保持本实体配置初值
## （fallback_mass_kg 传负值、fallback_volume_slots 传 0 表示「无领域默认回退，回落配置初值」）。
static func from_payload(
	payload: Dictionary,
	fallback_template_id: String = "",
	fallback_name: String = "",
	fallback_mass_kg: float = -1.0,
	fallback_volume_slots: int = 0
) -> ItemEntity:
	var item := ItemEntity.new()
	var resolved_template_id := ""
	if payload.has("item_id"):
		item.item_id = str(payload["item_id"])
		resolved_template_id = str(payload.get("template_id", item.item_id))
	elif payload.has("template_id"):
		resolved_template_id = str(payload["template_id"])
		item.item_id = resolved_template_id
	elif payload.has("item_template_id"):
		resolved_template_id = str(payload["item_template_id"])
		item.item_id = resolved_template_id
	else:
		resolved_template_id = fallback_template_id
		item.item_id = resolved_template_id
	item.template_id = resolved_template_id
	if payload.has("name"):
		item.custom_name = str(payload["name"])
	elif payload.has("custom_name"):
		item.custom_name = str(payload["custom_name"])
	elif payload.has("item_name"):
		item.custom_name = str(payload["item_name"])
	elif not fallback_name.is_empty():
		item.custom_name = fallback_name
	if payload.has("mass_kg"):
		item.mass_kg = float(payload["mass_kg"])
	elif fallback_mass_kg >= 0.0:
		item.mass_kg = fallback_mass_kg
	if payload.has("volume_slots"):
		item.volume_slots = int(payload["volume_slots"])
	elif fallback_volume_slots > 0:
		item.volume_slots = fallback_volume_slots
	if payload.has("item_uid"):
		item.item_uid = str(payload["item_uid"])
	return item
