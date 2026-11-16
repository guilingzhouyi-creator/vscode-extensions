# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Resource Governance)
# 文件路径: res://backend/infrastructure/resource_governance/bounded_resource_cache.gd
# 架构定位: Memory Governor / Bounded Cache
# 依赖与触发: 上游: GameBootstrap, ViewRouter, 资源消费方 | 下游: BoundedResourceCache, CachePolicySpec | 配置: config/infrastructure/resource.json | 信号: 缓存淘汰 / 内存预警事件
# 职责说明: 有界资源缓存容器：基于 LRU 权重算法管理已载入的只读静态配置与纹理/音效资源，强制受控于内存配额上限，防无界内存泄漏。
# 退出语义与设计依据: 有界资源与内存生命周期治理标准
# ==============================================================================

## BoundedResourceCache：Memory Governor / Bounded Cache
class_name BoundedResourceCache extends RefCounted

var _policy_specification: CachePolicySpec
var _store: Dictionary = {}
var _access_order_map: Dictionary = {} # 有序集合（Dictionary 保持插入序）用于 LRU/FIFO 追踪，O(1) 触达/淘汰
var _timestamps: Dictionary = {} # key -> float (秒)

func _init(policy_specification: CachePolicySpec = null) -> void:
	if policy_specification != null:
		_policy_specification = policy_specification
	else:
		_policy_specification = CachePolicySpec.new("default_cache", 100)

## 获取当前缓存策略规范
func get_spec() -> CachePolicySpec:
	return _policy_specification

## 放入条目，超出容量时自动触发淘汰
func put(cache_key: String, cache_value: Variant) -> void:
	if cache_key.is_empty():
		return

	# 若已存在，更新值与访问顺序（LRU 需触达，FIFO 保持插入序不变）
	if _store.has(cache_key):
		_store[cache_key] = cache_value
		_timestamps[cache_key] = Time.get_unix_time_from_system()
		if _policy_specification.eviction_policy == CachePolicySpec.EvictionPolicy.LRU:
			_touch(cache_key)
		return

	# 容量已满，执行驱逐
	while _store.size() >= _policy_specification.max_capacity:
		_evict_one()

	_store[cache_key] = cache_value
	_timestamps[cache_key] = Time.get_unix_time_from_system()
	_access_order_map[cache_key] = true

## 获取条目，支持 TTL 过期淘汰
func get_val(cache_key: String, default_value: Variant = null) -> Variant:
	if not _store.has(cache_key):
		return default_value

	# TTL 过期检查
	if _policy_specification.eviction_policy == CachePolicySpec.EvictionPolicy.TTL:
		var created_time: float = float(_timestamps.get(cache_key, 0.0))
		var current_time: float = Time.get_unix_time_from_system()
		if current_time - created_time > _policy_specification.ttl_seconds:
			_remove_internal(cache_key)
			return default_value

	if _policy_specification.eviction_policy == CachePolicySpec.EvictionPolicy.LRU:
		_touch(cache_key)

	return _store[cache_key]

## 判定条目是否存在且未过期
func has(cache_key: String) -> bool:
	return get_val(cache_key, null) != null

## 手动删除条目
func remove(cache_key: String) -> bool:
	if _store.has(cache_key):
		_remove_internal(cache_key)
		return true
	return false

## 驱逐单个条目（按策略分支，O(1) 均摊）
func _evict_one() -> void:
	if _access_order_map.is_empty():
		return
	# TTL 优先淘汰过期条目，其次按 LRU/FIFO 头部淘汰（直接迭代字典避免 keys() 建临时数组）
	if _policy_specification.eviction_policy == CachePolicySpec.EvictionPolicy.TTL:
		var now := Time.get_unix_time_from_system()
		for entry_key in _access_order_map:
			var expiration_key := String(entry_key)
			var created := float(_timestamps.get(expiration_key, 0.0))
			if now - created > _policy_specification.ttl_seconds:
				_remove_internal(expiration_key)
				return
	# LRU/FIFO/MANUAL 均淘汰有序集合头部（LRU 头部即最久未访，FIFO 头部即最早插入）
	var victim_key: String = ""
	for entry_key in _access_order_map:
		victim_key = String(entry_key)
		break
	if not victim_key.is_empty():
		_remove_internal(victim_key)

func _remove_internal(cache_key: String) -> void:
	_store.erase(cache_key)
	_timestamps.erase(cache_key)
	_access_order_map.erase(cache_key)

func _touch(cache_key: String) -> void:
	# O(1) 均摊：先删后插移到尾部，保持 LRU 尾部为最近
	if _access_order_map.has(cache_key):
		_access_order_map.erase(cache_key)
	_access_order_map[cache_key] = true

## 热更/场景重置清理通道
func clear_on_hot_reload() -> void:
	if _policy_specification.allow_hot_reload_clear:
		clear()

## 清空当前容器或管理器内的所有记录与缓存
func clear() -> int:
	var count := _store.size()
	_store.clear()
	_timestamps.clear()
	_access_order_map.clear()
	return count

## 获取当前缓冲区内存储的有效元素数量
func size() -> int:
	return maxi(0, _store.size())

## 获取缓存中当前所有活跃条目的键名列表
func keys() -> Array[String]:
	var result_keys: Array[String] = []
	for entry_key in _store:
		result_keys.append(str(entry_key))
	return result_keys
