# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Resource Governance)
# 文件路径: res://backend/infrastructure/resource_governance/cache_policy_spec.gd
# 架构定位: Memory Governor / Bounded Cache
# 跨域依赖: 上游: GameBootstrap, ViewRouter, 资源消费方 | 下游: BoundedResourceCache, CachePolicySpec | 配置: config/infrastructure/resource.json | 信号: 缓存淘汰 / 内存预警事件
# 职责说明: 缓存淘汰策略与配额参数规格实体：声明最大驻留条目数、空闲生存时间（TTL）、弱引用保持模式与紧急驱逐水位。
# 设计依据: Phase 56 有界资源与内存生命周期治理标准
# ==============================================================================

class_name CachePolicySpec extends RefCounted

# ==============================================================================
# 一、淘汰策略枚举
# ==============================================================================

## 缓存淘汰策略枚举
enum EvictionPolicy {
	LRU = 0,    # 最近最少使用淘汰
	FIFO = 1,   # 先进先出淘汰
	TTL = 2,    # 基于生存时间过期淘汰
	MANUAL = 3  # 仅手动显式清理
}

# ==============================================================================
# 二、六要素属性字段
# ==============================================================================

## 六要素属性字段
var cache_name: String = ""
var max_capacity: int = 100
var eviction_policy: EvictionPolicy = EvictionPolicy.LRU
var ttl_seconds: float = 300.0
var allow_hot_reload_clear: bool = true
var ownership_domain: String = "global"

## 构造：六要素全量注入（容量下限 1、TTL 下限 0.01 防误配）
func _init(
	p_name: String = "default_cache",
	p_cap: int = 100,
	p_policy: EvictionPolicy = EvictionPolicy.LRU,
	p_ttl: float = 300.0,
	p_hot_reload: bool = true,
	p_domain: String = "global"
) -> void:
	cache_name = p_name
	max_capacity = maxi(1, p_cap)
	eviction_policy = p_policy
	ttl_seconds = maxf(0.01, p_ttl)
	allow_hot_reload_clear = p_hot_reload
	ownership_domain = p_domain

## 序列化为字典（配置持久化/热重载用）
func to_dict() -> Dictionary:
	return {
		"cache_name": cache_name,
		"max_capacity": max_capacity,
		"eviction_policy": eviction_policy,
		"ttl_seconds": ttl_seconds,
		"allow_hot_reload_clear": allow_hot_reload_clear,
		"ownership_domain": ownership_domain
	}

## 从字典反序列化还原（字段缺省回退默认）
static func from_dict(p_data: Dictionary) -> RefCounted:
	var spec := CachePolicySpec.new(
		str(p_data.get("cache_name", "default_cache")),
		int(p_data.get("max_capacity", 100)),
		int(p_data.get("eviction_policy", EvictionPolicy.LRU)) as EvictionPolicy,
		float(p_data.get("ttl_seconds", 300.0)),
		bool(p_data.get("allow_hot_reload_clear", true)),
		str(p_data.get("ownership_domain", "global"))
	)
	return spec
