# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/contract_registry_cache.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 提供 LRU 128 有界缓存与副本返回（Inv-CP-5），管理配置热重载与版本兼容性检查
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ContractRegistryCache
extends RefCounted

const EntryClass = preload("res://backend/domains/contract_registry/contract_registry_entry.gd")
const IndexClass = preload("res://backend/domains/contract_registry/contract_registry_index.gd")

const LRU_MAX_ENTRIES: int = 128

static var _lru_map: Dictionary = {}
static var _access_order: Array[String] = []
static var _loaded_version: int = 1
static var _last_load_at: String = ""


## 获取缓存条目副本（Inv-CP-5 容器返回副本而非内部引用）
static func get_cached(domain: String, view: String, kind: int) -> Resource:
	var key := "%s:%s:%d" % [domain, view, kind]

	if _lru_map.has(key):
		# 更新访问顺序
		_access_order.erase(key)
		_access_order.append(key)
		var cached_entry = _lru_map[key]
		return cached_entry.duplicate(true)

	# 未命中：从索引加载
	var entries: Array = IndexClass.find_by_domain_view(domain, view)
	var found = null
	for e in entries:
		if int(e.endpoint_kind) == kind:
			found = e
			break

	if found != null:
		# 插入 LRU
		if _access_order.size() >= LRU_MAX_ENTRIES:
			var oldest_key: String = String(_access_order.pop_front())
			_lru_map.erase(oldest_key)
		_lru_map[key] = found
		_access_order.append(key)
		return found.duplicate(true)

	return null


## 清除全量缓存
static func invalidate_cache() -> void:
	_lru_map.clear()
	_access_order.clear()


## 清除指定域缓存
static func invalidate_domain(domain: String) -> void:
	var prefix := domain + ":"
	var keys_to_remove: Array[String] = []
	for k in _lru_map.keys():
		if String(k).begins_with(prefix):
			keys_to_remove.append(String(k))

	for k in keys_to_remove:
		_lru_map.erase(k)
		_access_order.erase(k)


## 配置热重载
static func reload_from_config() -> void:
	IndexClass.reload_from_config()
	invalidate_cache()
	_last_load_at = Time.get_datetime_string_from_system()

	# 经 EventBus 唯一入口广播热重载事件
	if EventBusCore.get_instance() != null:
		EventBusCore.get_instance().emit_domain_event("contract_registry.reloaded", {
			"timestamp": _last_load_at,
			"version": IndexClass.get_schema_version()
		})


## 版本兼容性检查
static func check_compatibility(prev_version: int, new_version: int) -> Dictionary:
	var breaking_changes: Array[Dictionary] = []
	if new_version > prev_version:
		var all_entries: Array = IndexClass.find_all()
		for e in all_entries:
			if e.contract_version == new_version and not e.breaking_change_note.is_empty():
				breaking_changes.append({
					"contract_id": e.contract_id,
					"note": e.breaking_change_note
				})

	return {
		"compatible": breaking_changes.is_empty(),
		"breaking_changes": breaking_changes
	}
