# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_entity.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 万物物品聚合根、物理材质硬度、刃口常数与裸身容量 0 约束。 物品默认属性由 config/domains/inventory.json 的 item_defaults 段驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ItemEntity extends RefCounted

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
# 二、物品字段（默认值来自 item_defaults 配置段）
# ==============================================================================

var item_id: String = ""
# 实例全局唯一 UID（权威/可追溯/幂等，Phase 09）：发放来源前缀 + 单调计数 + 校验尾
var item_uid: String = ""
var template_id: String = ""
var custom_name: String = GameConfig.get_string("domains.inventory", "item_defaults/custom_name", "未命名物品")
# 合法分类: WEAPON_BLADE / WEAPON_BLUNT / WEAPON_POLE / ARMOR_EQUIPMENT / CONSUMABLE_POTION / CONSUMABLE_RATION / MANA_CRYSTAL / CRAFTING_MATERIAL / MANUSCRIPT_GRIMOIRE / QUEST_MISC
var category: String = GameConfig.get_string("domains.inventory", "item_defaults/category", CATEGORY_QUEST_MISC)
var mass_kg: float = GameConfig.get_float("domains.inventory", "item_defaults/mass_kg", 1.0)
var volume_slots: int = GameConfig.get_int("domains.inventory", "item_defaults/volume_slots", 1)
var durability_current: float = GameConfig.get_float("domains.inventory", "item_defaults/durability", 100.0)
var durability_max: float = GameConfig.get_float("domains.inventory", "item_defaults/durability", 100.0)
var material_hardness: float = GameConfig.get_float("domains.inventory", "item_defaults/material_hardness", 10.0)
var combat_metrics: Dictionary = {
	"edge_sharpness": GameConfig.get_float("domains.inventory", "item_defaults/combat_metrics/edge_sharpness", 1.0),
	"reach_meters": GameConfig.get_float("domains.inventory", "item_defaults/combat_metrics/reach_meters", 1.0),
	"effective_armor": GameConfig.get_float("domains.inventory", "item_defaults/combat_metrics/effective_armor", 0.0),
	"elemental_resistances": {}
}
var affix_sockets: Dictionary = {
	"total_sockets": GameConfig.get_int("domains.inventory", "item_defaults/total_sockets", 2),
	"imprinted_runes": [],
	"dynamic_affixes": []
}
var market_base_price: int = GameConfig.get_int("domains.inventory", "item_defaults/market_base_price", 10)
var quality_snapshot: Dictionary = {} # 品质等级统一度量快照（Phase 17：空=未声明，行为不变）
var container_state: String = "UNOWNED"
var owner_account_id: String = ""
var attribute_mounts: Array = [] # Phase 46: 物品属性双 UID 挂载条目 (Array[ItemAttributeMountInstance])

# ==============================================================================
# 三、序列化 / 反序列化 / 工厂
# ==============================================================================

## 序列化物品为字典（attribute_mounts 转为 DTO 数组，嵌套容器深拷贝）
func serialize() -> Dictionary:
	var mounts_dto: Array = []
	for m in attribute_mounts:
		if m is ItemAttributeMountInstance:
			mounts_dto.append(m.to_dto())
		elif m is Dictionary:
			mounts_dto.append(m)

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
## 两处刻意保留的差异兜底：custom_name 走独立的 deserialize_name 键（损坏存档回落
## 「未知物品」而非「未命名物品」）；combat_metrics / affix_sockets 缺键回落空字典
## （非配置富缺省，与既有存档兼容语义一致）。
static func deserialize(d: Dictionary, legacy_discriminator: String = "") -> ItemEntity:
	var item := ItemEntity.new()
	if d == null:
		return item
	item.item_id = str(d.get("item_id", item.item_id))
	item.item_uid = d.get("item_uid", "")
	item.template_id = str(d.get("template_id", item.template_id))
	# 旧档无 uid：确定性迁移派生（可复现，不改变原型语义）；
	# legacy_discriminator 供同模板多实例（item_id 相同）区分，防迁移 UID 碰撞
	if item.item_uid.is_empty() and not item.template_id.is_empty():
		item.item_uid = migrate_legacy_uid(item.template_id, item.item_id, legacy_discriminator)
	item.custom_name = d.get("custom_name", GameConfig.get_string("domains.inventory", "item_defaults/deserialize_name", "未知物品"))
	item.category = d.get("category", item.category)
	item.mass_kg = maxf(0.0, float(d.get("mass_kg", item.mass_kg)))
	item.volume_slots = maxi(0, int(d.get("volume_slots", item.volume_slots)))
	item.durability_current = clampf(float(d.get("durability_current", item.durability_current)), 0.0, maxf(0.0, float(d.get("durability_max", item.durability_max))))
	item.durability_max = maxf(0.0, float(d.get("durability_max", item.durability_max)))
	item.material_hardness = maxf(0.0, float(d.get("material_hardness", item.material_hardness)))
	item.combat_metrics = (d.get("combat_metrics", {}) as Dictionary).duplicate(true) if d.get("combat_metrics", {}) is Dictionary else {}
	item.affix_sockets = (d.get("affix_sockets", {}) as Dictionary).duplicate(true) if d.get("affix_sockets", {}) is Dictionary else {}
	item.market_base_price = maxi(0, int(d.get("market_base_price", item.market_base_price)))
	item.quality_snapshot = (d.get("quality_snapshot", {}) as Dictionary).duplicate(true) if d.get("quality_snapshot", {}) is Dictionary else {}
	item.container_state = str(d.get("container_state", item.container_state))
	item.owner_account_id = str(d.get("owner_account_id", item.owner_account_id))

	var raw_mounts = d.get("attribute_mounts", [])
	if raw_mounts is Array:
		for m_data in raw_mounts:
			if m_data is Dictionary:
				item.attribute_mounts.append(ItemAttributeMountInstance.from_dto(m_data))

	return item

## 物品载荷统一工厂：跨域 payload 字典 -> ItemEntity，杜绝各管线手工逐字段赋值漂移。
## 键名契约（canonical，括号内为兼容别名，检索顺序 canonical 优先）：
##   template_id（item_template_id）——同时写入 item_id 与 template_id；
##   name（custom_name / item_name）——显示名；
##   mass_kg / volume_slots —— 物理属性。
## fallback_* 仅在 payload 未提供对应键时生效；未提供的字段保持本实体配置初值
## （fallback_mass_kg 传负值、fallback_volume_slots 传 0 表示「无领域兜底，回落配置初值」）。
static func from_payload(
	payload: Dictionary,
	fallback_template_id: String = "",
	fallback_name: String = "",
	fallback_mass_kg: float = -1.0,
	fallback_volume_slots: int = 0
) -> ItemEntity:
	var item := ItemEntity.new()
	var tpl := ""
	if payload.has("item_id"):
		item.item_id = str(payload["item_id"])
		tpl = str(payload.get("template_id", item.item_id))
	elif payload.has("template_id"):
		tpl = str(payload["template_id"])
		item.item_id = tpl
	elif payload.has("item_template_id"):
		tpl = str(payload["item_template_id"])
		item.item_id = tpl
	else:
		tpl = fallback_template_id
		item.item_id = tpl
	item.template_id = tpl
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

## 旧档 UID 确定性迁移：template_id + item_id（+ 可选实例判别子）→ 固定派生（可复现、零随机）。
## 判别子用于同模板多实例（item_id 相同）区分：传入槽位键/序号等每实例唯一值，
## 缺省空串保持原行为（唯一 item_id 场景向后兼容）。
static func migrate_legacy_uid(template_id: String, legacy_item_id: String, instance_discriminator: String = "") -> String:
	var raw := template_id + ":" + legacy_item_id
	if not instance_discriminator.is_empty():
		raw += ":" + instance_discriminator
	return "LGC_" + raw.sha256_text().substr(0, 20)
