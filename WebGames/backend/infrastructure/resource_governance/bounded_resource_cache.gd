# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Resource Governance)
# 文件路径: res://backend/infrastructure/resource_governance/bounded_resource_cache.gd
# 架构定位: Memory Governor / Bounded Cache
# 跨域依赖: 上游: GameBootstrap, ViewRouter, 资源消费方 | 下游: BoundedResourceCache, CachePolicySpec | 配置: config/infrastructure/resource.json | 信号: 缓存淘汰 / 内存预警事件
# 职责说明: 有界资源缓存容器：基于 LRU 权重算法管理已载入的只读静态配置与纹理/音效资源，强制受控于内存配额上限，防无界内存泄漏。
# 设计依据: Phase 56 有界资源与内存生命周期治理标准
# ==============================================================================

class_name BoundedResourceCache extends RefCounted

const CachePolicySpec = preload("res://backend/infrastructure/resource_governance/cache_policy_spec.gd")

var _spec: CachePolicySpec
var _store: Dictionary = {}
var _access_order_dict: Dictionary = {} # 有序集合（Dictionary 保持插入序）用于 LRU/FIFO 追踪，O(1) 触达/淘汰
var _timestamps: Dictionary = {}     # key -> float (秒)

func _init(p_spec: CachePolicySpec = null) -> void:
	if p_spec != null:
		_spec = p_spec
	else:
		_spec = CachePolicySpec.new("default_cache", 100)

## 获取当前缓存策略规范
func get_spec() -> CachePolicySpec:
	return _spec

## 放入条目，超出容量时自动触发淘汰
func put(p_key: String, p_value: Variant) -> void:
	if p_key.is_empty():
		return
	
	# 若已存在，更新值与访问顺序（LRU 需触达，FIFO 保持插入序不变）
	if _store.has(p_key):
		_store[p_key] = p_value
		_timestamps[p_key] = Time.get_unix_time_from_system()
		if _spec.eviction_policy == CachePolicySpec.EvictionPolicy.LRU:
			_touch(p_key)
		return
	
	# 容量已满，执行驱逐
	while _store.size() >= _spec.max_capacity:
		_evict_one()
	
	_store[p_key] = p_value
	_timestamps[p_key] = Time.get_unix_time_from_system()
	_access_order_dict[p_key] = true

## 获取条目，支持 TTL 过期淘汰
func get_val(p_key: String, p_default: Variant = null) -> Variant:
	if not _store.has(p_key):
		return p_default
	
	# TTL 过期检查
	if _spec.eviction_policy == CachePolicySpec.EvictionPolicy.TTL:
		var created_time: float = float(_timestamps.get(p_key, 0.0))
		var current_time: float = Time.get_unix_time_from_system()
		if current_time - created_time > _spec.ttl_seconds:
			_remove_internal(p_key)
			return p_default
	
	if _spec.eviction_policy == CachePolicySpec.EvictionPolicy.LRU:
		_touch(p_key)
	
	return _store[p_key]

## 判定条目是否存在且未过期
func has(p_key: String) -> bool:
	return get_val(p_key, null) != null

## 手动删除条目
func remove(p_key: String) -> bool:
	if _store.has(p_key):
		_remove_internal(p_key)
		return true
	return false

## 驱逐单个条目（按策略分支，O(1) 均摊）
func _evict_one() -> void:
	if _access_order_dict.is_empty():
		return
	# TTL 优先淘汰过期条目，其次按 LRU/FIFO 头部淘汰（直接迭代字典避免 keys() 建临时数组）
	if _spec.eviction_policy == CachePolicySpec.EvictionPolicy.TTL:
		var now := Time.get_unix_time_from_system()
		for k in _access_order_dict:
			var t_key := String(k)
			var created := float(_timestamps.get(t_key, 0.0))
			if now - created > _spec.ttl_seconds:
				_remove_internal(t_key)
				return
	# LRU/FIFO/MANUAL 均淘汰有序集合头部（LRU 头部即最久未访，FIFO 头部即最早插入）
	var victim_key: String = ""
	for k in _access_order_dict:
		victim_key = String(k)
		break
	if not victim_key.is_empty():
		_remove_internal(victim_key)

func _remove_internal(p_key: String) -> void:
	_store.erase(p_key)
	_timestamps.erase(p_key)
	_access_order_dict.erase(p_key)

func _touch(p_key: String) -> void:
	# O(1) 均摊：先删后插移到尾部，保持 LRU 尾部为最近
	if _access_order_dict.has(p_key):
		_access_order_dict.erase(p_key)
	_access_order_dict[p_key] = true

## 热更/场景重置清理通道
func clear_on_hot_reload() -> void:
	if _spec.allow_hot_reload_clear:
		clear()

func clear() -> void:
	_store.clear()
	_timestamps.clear()
	_access_order_dict.clear()

func size() -> int:
	return _store.size()

func keys() -> Array[String]:
	var res: Array[String] = []
	for k in _store:
		res.append(str(k))
	return res
