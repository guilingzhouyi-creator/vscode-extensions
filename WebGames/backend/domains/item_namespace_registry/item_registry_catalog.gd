# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_registry_catalog.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 维护全域不可变物品原型模板、双向数字压缩映射、统一英文名索引与别名倒排索引。 三标识（canonical_id / numeric_id / english_name 小写归一）唯一映射，注册即建索引。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ItemRegistryCatalog
extends RefCounted

# ==============================================================================
# 一、默认值与分类常量
# ==============================================================================

const DEFAULT_MASS_KG: float = 1.5
const DEFAULT_VOLUME_SLOTS: int = 2
const DEFAULT_MARKET_VALUE: int = 100
const DEFAULT_TIER_RANK: int = 1

const CATEGORY_MAJOR_EQUIPMENT: String = "EQUIPMENT"
const CATEGORY_MAJOR_CONSUMABLE: String = "CONSUMABLE"
const CATEGORY_MAJOR_MATERIAL: String = "MATERIAL"
const CATEGORY_MAJOR_QUEST: String = "QUEST"

# ==============================================================================
# 二、物品原型模板实体
# ==============================================================================

## 物品原型模板：三标识 + 分类/品阶/品质/物理属性/别名（注册期不可变快照）
class ItemPrototypeTemplate extends RefCounted:
	var canonical_id: String = ""              # 如 "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"（后端 ID 判定）
	var english_name: String = ""              # 统一英文名（底层规范化标准，如 "mithril_longsword"；必填，注册缺失即拒）
	var numeric_id: int = 0                    # 压缩数字 ID (1~N)；0 表示未分配，注册时自动递增分配
	var loc_name_key: String = ""              # "item.mithril_longsword.name"（i18n 呈现键，前端按区域适配）
	var loc_desc_key: String = ""              # "item.mithril_longsword.desc"
	var category_major: String = CATEGORY_MAJOR_EQUIPMENT
	var category_minor: String = GameConfig.get_string("domains.item_namespace_registry", "defaults/category_minor", "WEAPON_BLADE")
	var tier_rank: int = GameConfig.get_int("domains.item_namespace_registry", "defaults/tier_rank", DEFAULT_TIER_RANK)                     # 品阶 (1:普通, 2:精良, 3:稀有, 4:史诗, 5:传说, 6:神圣)
	var quality_tier: int = -1     # 品质等级 (Phase 17: 1普通~6古代；-1=未声明，默认不参与解析)
	var mythic_interval: int = 0   # 神话区间端点 (0=无, 1=准神器, 2=真神器；仅 quality_tier=5 神话级生效)
	var default_mass_kg: float = GameConfig.get_float("domains.item_namespace_registry", "defaults/default_mass_kg", DEFAULT_MASS_KG)
	var default_volume_slots: int = GameConfig.get_int("domains.item_namespace_registry", "defaults/default_volume_slots", DEFAULT_VOLUME_SLOTS)
	var base_market_value: int = GameConfig.get_int("domains.item_namespace_registry", "defaults/base_market_value", DEFAULT_MARKET_VALUE)
	var search_aliases: Array = []             # 别名列表 (如 ["秘银剑", "蓝晶长刃"])

	## 构造：全量注入（english_name 注册前小写归一，杜绝大小写冲突）
	func _init(
		p_id: String = "",
		p_num: int = 0,
		p_loc_name: String = "",
		p_major: String = CATEGORY_MAJOR_EQUIPMENT,
		p_minor: String = "WEAPON_BLADE",
		p_tier: int = DEFAULT_TIER_RANK,
		p_mass: float = DEFAULT_MASS_KG,
		p_vol: int = DEFAULT_VOLUME_SLOTS,
		p_price: int = DEFAULT_MARKET_VALUE,
		p_aliases: Array = [],
		p_english: String = ""
	) -> void:
		canonical_id = p_id
		english_name = p_english.strip_edges().to_lower()  # 注册前归一：查重/索引/解析统一小写，杜绝大小写冲突
		numeric_id = p_num
		loc_name_key = p_loc_name
		category_major = p_major
		category_minor = p_minor
		tier_rank = p_tier
		default_mass_kg = p_mass
		default_volume_slots = p_vol
		base_market_value = p_price
		search_aliases = p_aliases

# ==============================================================================
# 三、注册表索引状态
# ==============================================================================

# 字符串键 -> ItemPrototypeTemplate
var _canonical_registry: Dictionary = {}
# 压缩数字 ID -> Canonical String ID
var _numeric_to_canonical: Dictionary = {}
# 本地化展示名键 -> Canonical String ID（名称键唯一性校验索引）
var _loc_key_to_canonical: Dictionary = {}
# 统一英文名（小写）-> Canonical String ID（GM 命令/底层规范化解析索引）
var _english_name_to_canonical: Dictionary = {}
# 别名/名称倒排索引 (lowercase_term -> Array[canonical_id])
var _alias_inverted_index: Dictionary = {}
# 数字 ID 分配高水位（单调递增，仅记录已分配过的最大 ID）
var _highest_numeric_id: int = 0
# 已释放数字 ID 空闲池（升序，分配时优先复用，实现「删除回收」）
var _freed_numeric_ids: Array[int] = []

# ==============================================================================
# 四、查询接口
# ==============================================================================

## 按 canonical_id 取原型模板（未登记返回 null）
func get_prototype(canonical_id: String) -> ItemPrototypeTemplate:
	return _canonical_registry.get(canonical_id, null)

## 压缩数字 ID 反查 canonical_id（未占用返回空串）
func get_canonical_id_by_numeric(num_id: int) -> String:
	return _numeric_to_canonical.get(num_id, "")

## 本地化展示键反查 canonical_id（未登记返回空串）
func get_canonical_id_by_loc_key(loc_key: String) -> String:
	return _loc_key_to_canonical.get(loc_key, "")

## 统一英文名（小写归一）反查 canonical_id（未登记返回空串）
func get_canonical_id_by_english_name(english_name: String) -> String:
	return _english_name_to_canonical.get(english_name.strip_edges().to_lower(), "")

## 别名/名称倒排检索（小写化 + 去空白，未命中返回空数组）
func search_by_alias(term: String) -> Array:
	var key = term.to_lower().strip_edges()
	return _alias_inverted_index.get(key, [])

# ==============================================================================
# 五、数字 ID 分配与回收
# ==============================================================================

## 分配下一个数字 ID：优先复用空闲池最小 ID，否则取高水位 +1（自动递增占用）
func allocate_numeric_id() -> int:
	if not _freed_numeric_ids.is_empty():
		var reused := _freed_numeric_ids[0]
		_freed_numeric_ids.remove_at(0)
		return reused
	_highest_numeric_id += 1
	return _highest_numeric_id

## 显式占用指定数字 ID（配置直填场景）：从空闲池移除并刷新高水位
func occupy_numeric_id(num_id: int) -> void:
	if num_id <= 0:
		return
	_freed_numeric_ids.erase(num_id)
	if num_id > _highest_numeric_id:
		_highest_numeric_id = num_id

## 释放数字 ID 回空闲池（删除回收）：仍在占用或已在池中则忽略
func release_numeric_id(num_id: int) -> void:
	if num_id <= 0:
		return
	if _numeric_to_canonical.has(num_id):
		return
	if _freed_numeric_ids.has(num_id):
		return
	_freed_numeric_ids.append(num_id)
	_freed_numeric_ids.sort()
