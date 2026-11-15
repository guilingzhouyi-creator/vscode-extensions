# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_registry_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 校验 ID 命名规范、防撞库冲突拦截、数字 ID 自动递增分配、 删除回收（注销）、建立倒排索引与模糊查找。 错误文案经 GameConfig.msg（item_namespace_registry）查表驱动。
# 退出语义与设计依据: 业务域第一性原理 / 物品命名空间注册与防撞库规范
# ==============================================================================

## ItemRegistrySolver：Headless Discrete Solver / Numerical Calculator
class_name ItemRegistrySolver
extends RefCounted

# ==============================================================================
# 一、ID 格式校验与注册
# ==============================================================================

## canonical_id 格式校验：<NAMESPACE>:<域>:<类>:<名> 四段以上，命名空间为大写字母数字下划线标识且各段非空
static func validate_canonical_id_format(canonical_id: String) -> bool:
	var parts: PackedStringArray = canonical_id.split(":")
	if parts.size() < 4:
		return false
	if not _is_valid_namespace_segment(parts[0]):
		return false
	for part in parts:
		if part.is_empty() or part != part.strip_edges():
			return false
	return true

static func _is_valid_namespace_segment(namespace_token: String) -> bool:
	if namespace_token.is_empty():
		return false
	for byte_index in range(namespace_token.length()):
		var unicode_value := namespace_token.unicode_at(byte_index)
		var is_upper := unicode_value >= 65 and unicode_value <= 90
		var is_digit := unicode_value >= 48 and unicode_value <= 57
		var is_underscore := unicode_value == 95
		if byte_index == 0 and not is_upper:
			return false
		if not (is_upper or is_digit or is_underscore):
			return false
	return true

static func _make_error(code: String, message: String) -> Dictionary:
	return {
		"success": false,
		"error_code": code,
		"message": message
	}

static func _validate_prototype_identity(catalog: ItemRegistryCatalog, prototype: ItemRegistryCatalog.ItemPrototypeTemplate) -> Dictionary:
	if not validate_canonical_id_format(prototype.canonical_id):
		return _make_error("ERR_INVALID_ID_FORMAT", _msg_fmt("invalid_id_format"))
	if catalog._canonical_registry.has(prototype.canonical_id):
		return _make_error("ERR_ID_COLLISION", _msg_fmt("id_collision", {"canonical_id": prototype.canonical_id}))
	if prototype.english_name.is_empty():
		return _make_error("ERR_ENGLISH_NAME_MISSING", _msg_fmt("english_name_missing", {"canonical_id": prototype.canonical_id}))
	if not _is_valid_english_name(prototype.english_name):
		return _make_error("ERR_ENGLISH_NAME_INVALID", _msg_fmt("english_name_invalid", {"english_name": prototype.english_name}))
	return {}

static func _validate_prototype_uniqueness(catalog: ItemRegistryCatalog, prototype: ItemRegistryCatalog.ItemPrototypeTemplate) -> Dictionary:
	if not prototype.loc_name_key.is_empty() and catalog._localization_key_to_canonical.has(prototype.loc_name_key):
		return _make_error("ERR_NAME_KEY_COLLISION", _msg_fmt("name_key_collision", {"loc_name_key": prototype.loc_name_key}))
	if catalog._english_name_to_canonical.has(prototype.english_name):
		return _make_error("ERR_ENGLISH_NAME_COLLISION", _msg_fmt("english_name_collision", {"english_name": prototype.english_name}))
	if prototype.numeric_id <= 0:
		prototype.numeric_id = catalog.allocate_numeric_id()
	elif catalog._numeric_to_canonical.has(prototype.numeric_id):
		return _make_error("ERR_NUMERIC_COLLISION", _msg_fmt("numeric_id_collision", {"numeric_id": prototype.numeric_id}))
	return {}

static func _commit_prototype_to_catalog(catalog: ItemRegistryCatalog, prototype: ItemRegistryCatalog.ItemPrototypeTemplate) -> void:
	catalog._canonical_registry[prototype.canonical_id] = prototype
	catalog._numeric_to_canonical[prototype.numeric_id] = prototype.canonical_id
	catalog.occupy_numeric_id(prototype.numeric_id)
	if not prototype.loc_name_key.is_empty():
		catalog._localization_key_to_canonical[prototype.loc_name_key] = prototype.canonical_id
	catalog._english_name_to_canonical[prototype.english_name] = prototype.canonical_id

	var seen_aliases: Dictionary = {}
	for alias in prototype.search_aliases:
		var key: String = str(alias).to_lower().strip_edges()
		if not key.is_empty() and not seen_aliases.has(key):
			seen_aliases[key] = true
			_append_alias_index_entry(catalog._alias_inverted_index, key, prototype.canonical_id)

static func _append_alias_index_entry(index: Dictionary, alias_key: String, canonical_id: String) -> void:
	if not index.has(alias_key):
		index[alias_key] = []
	(index[alias_key] as Array).append(canonical_id)

## 注册物品原型模板：
## - 校验链：ID 格式 → canonical_id 冲突 → 展示名键唯一 → 统一英文名唯一 → 数字 ID 冲突；
## - numeric_id <= 0 时自动递增分配（回收的空闲 ID 优先复用）；
## - 别名索引去重（空别名与同物品重复别名忽略，跨物品同义词保留多值）。
static func register_prototype(catalog: ItemRegistryCatalog, prototype: ItemRegistryCatalog.ItemPrototypeTemplate) -> Dictionary:
	var identity_error: Dictionary = _validate_prototype_identity(catalog, prototype)
	if not identity_error.is_empty():
		return identity_error

	var uniqueness_error: Dictionary = _validate_prototype_uniqueness(catalog, prototype)
	if not uniqueness_error.is_empty():
		return uniqueness_error

	_commit_prototype_to_catalog(catalog, prototype)
	return {
		"success": true,
		"canonical_id": prototype.canonical_id,
		"numeric_id": prototype.numeric_id
	}

# ==============================================================================
# 二、注销回收 / 解析 / 检索
# ==============================================================================

## 注销物品原型（配置删除后的回收入口）：
## 同步清理倒排索引、英文名索引、数字映射、名称键索引与主注册表，并将数字 ID 释放回空闲池。
static func unregister_prototype(catalog: ItemRegistryCatalog, canonical_id: String) -> Dictionary:
	var prototype: Variant = catalog._canonical_registry.get(canonical_id)
	if prototype == null:
		return {
			"success": false,
			"error_code": "ERR_NOT_FOUND",
			"message": _msg_fmt("not_found", {"canonical_id": canonical_id})
		}

	for alias in prototype.search_aliases:
		var key: String = str(alias).to_lower().strip_edges()
		if catalog._alias_inverted_index.has(key):
			var ids: Array = catalog._alias_inverted_index[key]
			ids.erase(canonical_id)
			if ids.is_empty():
				catalog._alias_inverted_index.erase(key)

	catalog._numeric_to_canonical.erase(prototype.numeric_id)
	catalog.release_numeric_id(prototype.numeric_id)
	if not prototype.loc_name_key.is_empty():
		catalog._localization_key_to_canonical.erase(prototype.loc_name_key)
	if not prototype.english_name.is_empty():
		catalog._english_name_to_canonical.erase(prototype.english_name)
	catalog._canonical_registry.erase(canonical_id)

	return {
		"success": true,
		"canonical_id": canonical_id,
		"numeric_id": prototype.numeric_id
	}

## 严格按统一英文名解析（GM /give 唯一合法入口）：
## 仅接受底层规范化英文名（大小写不敏感）；中文别名、数字 ID、canonical_id 一律拒绝。
static func resolve_by_english_name(catalog: ItemRegistryCatalog, name: String) -> Dictionary:
	var canonical_id: String = catalog.get_canonical_id_by_english_name(name)
	if canonical_id.is_empty():
		return {"success": false, "canonical_id": ""}
	return {"success": true, "canonical_id": canonical_id}

## 由原型构建物品实例载荷（服务器批量发放 / GM 发放共用）：
## template_id 落 canonical_id，质量/体积取原型值（原型为单一事实源，载荷不再携带物理属性）；
## 显示名由调用方传入（呈现层配置，i18n 由前端按 loc_name_key 适配）。
static func build_instance_payload(prototype: ItemRegistryCatalog.ItemPrototypeTemplate, display_name: String) -> Dictionary:
	return {
		"template_id": prototype.canonical_id,
		"name": display_name,
		"mass_kg": prototype.default_mass_kg,
		"volume_slots": prototype.default_volume_slots
	}

## 检索（前端命名空间搜索 UI 用）：canonical_id 直击 → 统一英文名 → 多语言别名倒排命中
static func resolve_search_term(catalog: ItemRegistryCatalog, search_term: String) -> Array:
	var clean_term: String = search_term.to_lower().strip_edges()
	var direct_match: Variant = catalog.get_prototype(search_term.to_upper())
	if direct_match != null:
		return [direct_match.canonical_id]
	var by_english: String = catalog.get_canonical_id_by_english_name(clean_term)
	if not by_english.is_empty():
		return [by_english]
	return catalog.search_by_alias(clean_term)

# ==============================================================================
# 三、配置读取
# ==============================================================================

## 统一英文名格式断言：仅允许小写字母/数字/下划线（底层规范化标准）
static func _is_valid_english_name(name: String) -> bool:
	for character_index in range(name.length()):
		var current_character := name[character_index]
		if not (current_character >= "a" and current_character <= "z") and not (current_character >= "0" and current_character <= "9") and current_character != "_":
			return false
	return true

## 错误文案查表并注入 {param} 命名占位符（item_namespace_registry 域）
static func _msg_fmt(key: String, format_parameters: Dictionary = {}) -> String:
	return GameConfig.msg_fmt("item_namespace_registry", key, format_parameters)
