# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_loader_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 从配置字典/JSON 批量加载并实例化物品注册表；提供 config/items/*.json 自动发现装配入口（build_catalog_from_config）与配置热重载回收 （reload_from_config：配置删除的物品自动注销、回收数字 ID 与名称键）
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ItemLoaderPipeline
extends RefCounted

# ==============================================================================
# 一、批量注册
# ==============================================================================

## 批量注册：按 canonical_id 排序保证自动递增数字 ID 的确定性（跨平台/跨文件稳定）。
## numeric_id <= 0 的条目由 ItemRegistrySolver 自动递增分配（回收的空闲 ID 优先复用）。
static func load_from_dict_list(catalog: ItemRegistryCatalog, items_data: Array) -> Dictionary:
	var sorted_data := items_data.duplicate()
	sorted_data.sort_custom(
		func(a, b): return str(a.get("canonical_id", "")) < str(b.get("canonical_id", ""))
	)
	var loaded_count := 0
	var error_list: Array[Dictionary] = []

	for item_dict in sorted_data:
		var proto = ItemRegistryCatalog.ItemPrototypeTemplate.new(
			item_dict.get("canonical_id", ""),
			item_dict.get("numeric_id", 0),
			item_dict.get("loc_name_key", ""),
			item_dict.get("category_major", ItemRegistryCatalog.CATEGORY_MAJOR_EQUIPMENT),
			item_dict.get("category_minor", GameConfig.get_string("domains.item_namespace_registry", "defaults/category_minor", "WEAPON_BLADE")),
			item_dict.get("tier_rank", ItemRegistryCatalog.DEFAULT_TIER_RANK),
			item_dict.get("default_mass_kg", ItemRegistryCatalog.DEFAULT_MASS_KG),
			item_dict.get("default_volume_slots", ItemRegistryCatalog.DEFAULT_VOLUME_SLOTS),
			item_dict.get("base_market_value", ItemRegistryCatalog.DEFAULT_MARKET_VALUE),
			item_dict.get("search_aliases", []),
			item_dict.get("english_name", "")
		)

		var res = ItemRegistrySolver.register_prototype(catalog, proto)
		if res.success:
			loaded_count += 1
			# Phase 19 统一名称注册表接线：物品名称键登记（域所有者 = item，en_US 英文底座必达）
			var loc_key: String = str(item_dict.get("loc_name_key", ""))
			if not loc_key.is_empty():
				LocalizationRegistryCatalog.get_shared().register_name_key(
					loc_key, "item", str(item_dict.get("english_name", loc_key)))
		else:
			error_list.append(res)

	return {
		"success": error_list.is_empty(),
		"loaded_count": loaded_count,
		"errors": error_list
	}

# ==============================================================================
# 二、装配与热重载
# ==============================================================================

## 装配入口：创建注册表并加载 config/items/*.json 全量物品定义（游戏启动时调用）
static func build_catalog_from_config() -> ItemRegistryCatalog:
	var catalog := ItemRegistryCatalog.new()
	load_all_from_config(catalog)
	return catalog

## 自动发现并加载全部 config/items/*.json 表（表名 "items.<文件名>"）：
## MOD / DLC 新增文件即自动收录，无需改装配代码。
static func load_all_from_config(catalog: ItemRegistryCatalog) -> Dictionary:
	var table_names: Array = GameConfig.get_table_names().filter(
		func(name): return str(name).begins_with("items.")
	)
	table_names.sort()
	var all_items: Array = []
	for table_name in table_names:
		all_items.append_array(GameConfig.get_array(str(table_name), "items", []))
	return load_from_dict_list(catalog, all_items)

## 配置热重载回收：同步注册表与 config/items/*.json 的差异——
## 配置中已删除的物品自动注销（数字 ID 与名称键回空闲池），新增物品自动注册。
static func reload_from_config(catalog: ItemRegistryCatalog) -> Dictionary:
	var all_items: Array = []
	for table_name in GameConfig.get_table_names():
		if not str(table_name).begins_with("items."):
			continue
		all_items.append_array(GameConfig.get_array(str(table_name), "items", []))

	var unregistered: Array = []
	for canonical_id in catalog._canonical_registry.keys():
		if not _has_item(all_items, str(canonical_id)):
			var res = ItemRegistrySolver.unregister_prototype(catalog, str(canonical_id))
			if res.success:
				unregistered.append(str(canonical_id))

	# 2) 增量注册：仅注册配置中尚未登记的新物品（已存在的保持原数字 ID 不变）
	var new_items: Array = []
	for item_dict in all_items:
		var cid := str(item_dict.get("canonical_id", ""))
		if not cid.is_empty() and not catalog._canonical_registry.has(cid):
			new_items.append(item_dict)
	var load_res = load_from_dict_list(catalog, new_items)
	return {
		"unregistered": unregistered,
		"registered_count": load_res.get("loaded_count", 0),
		"errors": load_res.get("errors", [])
	}

# ==============================================================================
# 三、内部实现
# ==============================================================================

## 判断物品是否存在于配置数据（canonical_id 匹配）
static func _has_item(items_data: Array, canonical_id: String) -> bool:
	for item_dict in items_data:
		if str(item_dict.get("canonical_id", "")) == canonical_id:
			return true
	return false
