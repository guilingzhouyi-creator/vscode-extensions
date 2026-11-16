# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_loader_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 从配置字典/JSON 批量加载并实例化物品注册表；提供 config/items/*.json 自动发现装配入口（build_catalog_from_config）与配置热重载回收 （reload_from_config：配置删除的物品自动注销、回收数字 ID 与名称键）
# 退出语义与设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

## ItemLoaderPipeline：Business Pipeline / Transaction Safe Orchestrator
class_name ItemLoaderPipeline
extends RefCounted

# ==============================================================================
# 一、批量注册
# ==============================================================================

## 批量注册：按 canonical_id 排序保证自动递增数字 ID 的确定性（跨平台/跨文件稳定）。
## numeric_id <= 0 的条目由 ItemRegistrySolver 自动递增分配（回收的空闲 ID 优先复用）。
static func load_from_dict_list(catalog: ItemRegistryCatalog, items_payload: Array) -> Dictionary:
	var sorted_entries := items_payload.duplicate()
	sorted_entries.sort_custom(
		func(left_item, right_item): return str(left_item.get("canonical_id", "")) < str(right_item.get("canonical_id", ""))
	)
	var loaded_count := 0
	var error_list: Array[Dictionary] = []
	var default_minor: String = GameConfig.get_string("domains.item_namespace_registry", "defaults/category_minor", "WEAPON_BLADE")

	for item_entry in sorted_entries:
		var prototype: Variant = _build_prototype(item_entry, default_minor)
		var register_result: Variant = ItemRegistrySolver.register_prototype(catalog, prototype)
		if register_result.success:
			loaded_count += 1
			# 统一名称注册表接线：物品名称键登记（域所有者 = item，en_US 英文基础词条必达）
			var localized_name_key: String = str(item_entry.get("loc_name_key", ""))
			if not localized_name_key.is_empty():
				LocalizationRegistryCatalog.get_shared().register_name_key(
					localized_name_key, "item", str(item_entry.get("english_name", localized_name_key)))
		else:
			error_list.append(register_result)

	return {
		"success": error_list.is_empty(),
		"loaded_count": loaded_count,
		"errors": error_list
	}

## 单个物品原型模板构建工厂（从热循环解耦实例化开销）
static func _build_prototype(item_entry: Dictionary, default_minor: String) -> ItemRegistryCatalog.ItemPrototypeTemplate:
	return ItemRegistryCatalog.ItemPrototypeTemplate.new(
		item_entry.get("canonical_id", ""),
		item_entry.get("numeric_id", 0),
		item_entry.get("loc_name_key", ""),
		item_entry.get("category_major", ItemRegistryCatalog.CATEGORY_MAJOR_EQUIPMENT),
		item_entry.get("category_minor", default_minor),
		item_entry.get("tier_rank", ItemRegistryCatalog.DEFAULT_TIER_RANK),
		item_entry.get("default_mass_kg", ItemRegistryCatalog.DEFAULT_MASS_KG),
		item_entry.get("default_volume_slots", ItemRegistryCatalog.DEFAULT_VOLUME_SLOTS),
		item_entry.get("base_market_value", ItemRegistryCatalog.DEFAULT_MARKET_VALUE),
		item_entry.get("search_aliases", []),
		item_entry.get("english_name", "")
	)

# ==============================================================================
# 二、装配与热重载
# ==============================================================================

## 装配入口：创建注册表并加载 config/items/*.json 全量物品定义（游戏启动时调用）
static func build_catalog_from_config() -> ItemRegistryCatalog:
	var catalog := ItemRegistryCatalog.new()
	load_all_from_config(catalog)
	return catalog

static func _collect_configured_items() -> Array:
	var table_names: Array = GameConfig.get_table_names().filter(
		func(table_name): return str(table_name).begins_with("items.")
	)
	table_names.sort()
	var all_items: Array = []
	var empty_items: Array = []
	for table_name in table_names:
		_append_config_table_items(all_items, str(table_name), empty_items)
	return all_items

static func _append_config_table_items(collected_items: Array, table_name: String, empty_items: Array) -> void:
	collected_items.append_array(GameConfig.get_array(table_name, "items", empty_items))

## 自动发现并加载全部 config/items/*.json 表（表名 "items.<文件名>"）：
## MOD / DLC 新增文件即自动收录，无需改装配代码。
static func load_all_from_config(catalog: ItemRegistryCatalog) -> Dictionary:
	return load_from_dict_list(catalog, _collect_configured_items())

## 判定已有物品原型与最新配置条目是否发生字段变化
static func _is_prototype_modified(
	existing_prototype: ItemRegistryCatalog.ItemPrototypeTemplate,
	candidate_entry: Dictionary,
	default_minor_category: String
) -> bool:
	var target_minor := str(candidate_entry.get("category_minor", default_minor_category))
	var target_major := str(candidate_entry.get("category_major", ItemRegistryCatalog.CATEGORY_MAJOR_EQUIPMENT))
	var target_tier := int(candidate_entry.get("tier_rank", ItemRegistryCatalog.DEFAULT_TIER_RANK))
	var target_mass := float(candidate_entry.get("default_mass_kg", ItemRegistryCatalog.DEFAULT_MASS_KG))
	var target_volume := int(candidate_entry.get("default_volume_slots", ItemRegistryCatalog.DEFAULT_VOLUME_SLOTS))
	var target_value := int(candidate_entry.get("base_market_value", ItemRegistryCatalog.DEFAULT_MARKET_VALUE))
	var target_localization_key := str(candidate_entry.get("loc_name_key", ""))
	var target_english_name := str(candidate_entry.get("english_name", ""))
	if existing_prototype.category_major != target_major or existing_prototype.category_minor != target_minor:
		return true
	if existing_prototype.tier_rank != target_tier or not is_equal_approx(existing_prototype.default_mass_kg, target_mass):
		return true
	if existing_prototype.default_volume_slots != target_volume or existing_prototype.base_market_value != target_value:
		return true
	if existing_prototype.loc_name_key != target_localization_key or existing_prototype.english_name != target_english_name:
		return true
	return false

static func _enqueue_modified_item_entry(
	catalog: ItemRegistryCatalog,
	candidate_entry: Dictionary,
	candidate_id: String,
	default_minor_category: String,
	new_items: Array
) -> bool:
	var existing_prototype: ItemRegistryCatalog.ItemPrototypeTemplate = catalog._canonical_registry[candidate_id]
	if not _is_prototype_modified(existing_prototype, candidate_entry, default_minor_category):
		return false
	var preserved_numeric := existing_prototype.numeric_id
	ItemRegistrySolver.unregister_prototype(catalog, candidate_id)
	var replacement_entry: Dictionary = candidate_entry.duplicate(true)
	if int(replacement_entry.get("numeric_id", 0)) <= 0:
		replacement_entry["numeric_id"] = preserved_numeric
	new_items.append(replacement_entry)
	return true

## 配置热重载回收：同步注册表与 config/items/*.json 的差异——
## 配置中已删除的物品自动注销（数字 ID 与名称键回空闲池），已修改物品原位更新，新增物品自动注册。
static func reload_from_config(catalog: ItemRegistryCatalog) -> Dictionary:
	var all_items: Array = _collect_configured_items()

	var configured_ids: Dictionary = {}
	for raw_item in all_items:
		if raw_item is Dictionary:
			var configured_id := str((raw_item as Dictionary).get("canonical_id", ""))
			if not configured_id.is_empty():
				configured_ids[configured_id] = true

	var unregistered: Array = []
	for registered_id in catalog._canonical_registry.keys():
		if not configured_ids.has(str(registered_id)):
			var unregister_result: Variant = ItemRegistrySolver.unregister_prototype(catalog, str(registered_id))
			if unregister_result.success:
				unregistered.append(str(registered_id))

	# 2) 已登记物品若字段发生覆写（如 Tier 3 模组覆盖），保留原数字 ID 执行原位更新；新物品走增量注册
	var default_minor_category: String = GameConfig.get_string("domains.item_namespace_registry", "defaults/category_minor", "WEAPON_BLADE")
	var updated_count: int = 0
	var new_items: Array = []
	for item_entry in all_items:
		if not (item_entry is Dictionary):
			continue
		var candidate_entry: Dictionary = item_entry
		var candidate_id := str(candidate_entry.get("canonical_id", ""))
		if candidate_id.is_empty():
			continue
		if not catalog._canonical_registry.has(candidate_id):
			new_items.append(candidate_entry)
		elif _enqueue_modified_item_entry(catalog, candidate_entry, candidate_id, default_minor_category, new_items):
			updated_count += 1
	var load_result := load_from_dict_list(catalog, new_items)
	return {
		"unregistered": unregistered,
		"updated_count": updated_count,
		"registered_count": load_result.get("loaded_count", 0),
		"errors": load_result.get("errors", [])
	}

# ==============================================================================
# 三、内部实现
# ==============================================================================

## 判断物品是否存在于配置数据（canonical_id 匹配）
static func _has_item(items_payload: Array, canonical_id: String) -> bool:
	for item_entry in items_payload:
		if str(item_entry.get("canonical_id", "")) == canonical_id:
			return true
	return false
