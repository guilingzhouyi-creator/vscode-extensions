# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Resource Governance)
# 文件路径: res://backend/infrastructure/resource_governance/scoped_event_subscriber.gd
# 架构定位: Memory Governor / Bounded Cache
# 跨域依赖: 上游: GameBootstrap, ViewRouter, 资源消费方 | 下游: BoundedResourceCache, CachePolicySpec | 配置: config/infrastructure/resource.json | 信号: 缓存淘汰 / 内存预警事件
# 职责说明: 作用域事件订阅门面：为短生命周期对象（UI 视图、瞬态战斗实体）提供集中订阅托管，在实体退出场景树时一键清空全部监听信号。
# 设计依据: Phase 56 有界资源与内存生命周期治理标准
# ==============================================================================

class_name ScopedEventSubscriber extends RefCounted

const EventSubscriptionToken = preload("res://backend/infrastructure/resource_governance/event_subscription_token.gd")

var _tokens: Array[EventSubscriptionToken] = []
var _is_disposed: bool = false

## 订阅指定信号，并纳管生成的注销令牌
func subscribe(p_sig: Signal, p_callable: Callable) -> bool:
	if _is_disposed or p_sig.is_null() or p_callable.is_null():
		return false
	if p_sig.is_connected(p_callable):
		return false # 防重复绑定
	
	var err: Error = p_sig.connect(p_callable)
	if err != OK:
		return false
	
	var token := EventSubscriptionToken.new(p_sig, p_callable)
	_tokens.append(token)
	return true

## 解绑指定信号
func unsubscribe_from(p_sig: Signal, p_callable: Callable) -> bool:
	for i in range(_tokens.size() - 1, -1, -1):
		var tok: EventSubscriptionToken = _tokens[i]
		if tok.source_signal == p_sig and tok.callable_target == p_callable:
			tok.unsubscribe()
			_tokens.remove_at(i)
			return true
	return false

## 释放全部托管订阅（宿主销毁或重置时调用）
func clear() -> int:
	var cleared_count: int = 0
	for tok in _tokens:
		if tok.unsubscribe():
			cleared_count += 1
	_tokens.clear()
	return cleared_count

## 获取当前存活订阅数
func get_active_subscription_count() -> int:
	var count: int = 0
	for tok in _tokens:
		if tok.is_active:
			count += 1
	return count

## 彻底销毁代理
func dispose() -> void:
	clear()
	_is_disposed = true
