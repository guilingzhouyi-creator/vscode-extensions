# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_registry_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 校验 ID 命名规范、防撞库冲突拦截、数字 ID 自动递增分配、 删除回收（注销）、建立倒排索引与模糊查找。 错误文案经 GameConfig.msg（item_namespace_registry）查表驱动。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ItemRegistrySolver
extends RefCounted

# ==============================================================================
# 一、ID 格式校验与注册
# ==============================================================================

## canonical_id 格式校验：KALAR:<域>:<类>:<名> 四段以上，各段非空
static func validate_canonical_id_format(canonical_id: String) -> bool:
	var parts = canonical_id.split(":")
	if parts.size() < 4:
		return false
	if parts[0] != "KALAR":
		return false
	for part in parts:
		if part.is_empty():
			return false
	return true

## 注册物品原型模板：
## - 校验链：ID 格式 → canonical_id 冲突 → 展示名键唯一 → 统一英文名唯一 → 数字 ID 冲突；
## - numeric_id <= 0 时自动递增分配（回收的空闲 ID 优先复用）；
## - 别名索引去重（空别名与同物品重复别名忽略，跨物品同义词保留多值）。
static func register_prototype(catalog: ItemRegistryCatalog, proto: ItemRegistryCatalog.ItemPrototypeTemplate) -> Dictionary:
	if not validate_canonical_id_format(proto.canonical_id):
		return {
			"success": false,
			"error_code": "ERR_INVALID_ID_FORMAT",
			"message": _msg("invalid_id_format")
		}

	if catalog._canonical_registry.has(proto.canonical_id):
		return {
			"success": false,
			"error_code": "ERR_ID_COLLISION",
			"message": _msg("id_collision") % proto.canonical_id
		}

	if proto.english_name.is_empty():
		return {
			"success": false,
			"error_code": "ERR_ENGLISH_NAME_MISSING",
			"message": _msg("english_name_missing") % proto.canonical_id
		}
	if not _is_valid_english_name(proto.english_name):
		return {
			"success": false,
			"error_code": "ERR_ENGLISH_NAME_INVALID",
			"message": _msg("english_name_invalid") % proto.english_name
		}

	if not proto.loc_name_key.is_empty() and catalog._loc_key_to_canonical.has(proto.loc_name_key):
		return {
			"success": false,
			"error_code": "ERR_NAME_KEY_COLLISION",
			"message": _msg("name_key_collision") % proto.loc_name_key
		}

	if not proto.english_name.is_empty() and catalog._english_name_to_canonical.has(proto.english_name):
		return {
			"success": false,
			"error_code": "ERR_ENGLISH_NAME_COLLISION",
			"message": _msg("english_name_collision") % proto.english_name
		}

	if proto.numeric_id <= 0:
		proto.numeric_id = catalog.allocate_numeric_id()
	elif catalog._numeric_to_canonical.has(proto.numeric_id):
		return {
			"success": false,
			"error_code": "ERR_NUMERIC_COLLISION",
			"message": _msg("numeric_id_collision") % proto.numeric_id
		}

	catalog._canonical_registry[proto.canonical_id] = proto
	catalog._numeric_to_canonical[proto.numeric_id] = proto.canonical_id
	catalog.occupy_numeric_id(proto.numeric_id)
	if not proto.loc_name_key.is_empty():
		catalog._loc_key_to_canonical[proto.loc_name_key] = proto.canonical_id
	if not proto.english_name.is_empty():
		catalog._english_name_to_canonical[proto.english_name] = proto.canonical_id

	var seen_aliases: Array = []
	for alias in proto.search_aliases:
		var key = str(alias).to_lower().strip_edges()
		if key.is_empty() or seen_aliases.has(key):
			continue
		seen_aliases.append(key)
		if not catalog._alias_inverted_index.has(key):
			catalog._alias_inverted_index[key] = []
		catalog._alias_inverted_index[key].append(proto.canonical_id)

	return {
		"success": true,
		"canonical_id": proto.canonical_id,
		"numeric_id": proto.numeric_id
	}

# ==============================================================================
# 二、注销回收 / 解析 / 检索
# ==============================================================================

## 注销物品原型（配置删除后的回收入口）：
## 同步清理倒排索引、英文名索引、数字映射、名称键索引与主注册表，并将数字 ID 释放回空闲池。
static func unregister_prototype(catalog: ItemRegistryCatalog, canonical_id: String) -> Dictionary:
	var proto = catalog._canonical_registry.get(canonical_id)
	if proto == null:
		return {
			"success": false,
			"error_code": "ERR_NOT_FOUND",
			"message": _msg("not_found") % canonical_id
		}

	for alias in proto.search_aliases:
		var key = str(alias).to_lower().strip_edges()
		if catalog._alias_inverted_index.has(key):
			var ids: Array = catalog._alias_inverted_index[key]
			ids.erase(canonical_id)
			if ids.is_empty():
				catalog._alias_inverted_index.erase(key)

	catalog._numeric_to_canonical.erase(proto.numeric_id)
	catalog.release_numeric_id(proto.numeric_id)
	if not proto.loc_name_key.is_empty():
		catalog._loc_key_to_canonical.erase(proto.loc_name_key)
	if not proto.english_name.is_empty():
		catalog._english_name_to_canonical.erase(proto.english_name)
	catalog._canonical_registry.erase(canonical_id)

	return {
		"success": true,
		"canonical_id": canonical_id,
		"numeric_id": proto.numeric_id
	}

## 严格按统一英文名解析（GM /give 唯一合法入口）：
## 仅接受底层规范化英文名（大小写不敏感）；中文别名、数字 ID、canonical_id 一律拒绝。
static func resolve_by_english_name(catalog: ItemRegistryCatalog, name: String) -> Dictionary:
	var canonical_id := catalog.get_canonical_id_by_english_name(name)
	if canonical_id.is_empty():
		return { "success": false, "canonical_id": "" }
	return { "success": true, "canonical_id": canonical_id }

## 由原型构建物品实例载荷（服务器批量发放 / GM 发放共用）：
## template_id 落 canonical_id，质量/体积取原型值（原型为单一事实源，载荷不再携带物理属性）；
## 显示名由调用方传入（呈现层配置，i18n 由前端按 loc_name_key 适配）。
static func build_instance_payload(proto: ItemRegistryCatalog.ItemPrototypeTemplate, display_name: String) -> Dictionary:
	return {
		"template_id": proto.canonical_id,
		"name": display_name,
		"mass_kg": proto.default_mass_kg,
		"volume_slots": proto.default_volume_slots
	}

## 检索（前端命名空间搜索 UI 用）：canonical_id 直击 → 统一英文名 → 多语言别名倒排命中
static func resolve_search_term(catalog: ItemRegistryCatalog, search_term: String) -> Array:
	var clean_term = search_term.to_lower().strip_edges()
	var direct_match = catalog.get_prototype(search_term.to_upper())
	if direct_match != null:
		return [direct_match.canonical_id]
	var by_english := catalog.get_canonical_id_by_english_name(clean_term)
	if not by_english.is_empty():
		return [by_english]
	return catalog.search_by_alias(clean_term)

# ==============================================================================
# 三、配置读取
# ==============================================================================

## 统一英文名格式断言：仅允许小写字母/数字/下划线（底层规范化标准）
static func _is_valid_english_name(name: String) -> bool:
	for i in range(name.length()):
		var c := name[i]
		if not (c >= "a" and c <= "z") and not (c >= "0" and c <= "9") and c != "_":
			return false
	return true

## 错误文案查表（item_namespace_registry 域，未登记回传 key）
static func _msg(key: String) -> String:
	return GameConfig.msg("item_namespace_registry", key)
