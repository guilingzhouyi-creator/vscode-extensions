# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Resource Governance)
# 文件路径: res://backend/infrastructure/resource_governance/event_subscription_token.gd
# 架构定位: Memory Governor / Bounded Cache
# 跨域依赖: 上游: GameBootstrap, ViewRouter, 资源消费方 | 下游: BoundedResourceCache, CachePolicySpec | 配置: config/infrastructure/resource.json | 信号: 缓存淘汰 / 内存预警事件
# 职责说明: 资源域事件订阅治理令牌：绑定订阅者上下文与资源生命周期，确保在宿主销毁时自动反注册，消除跨域弱引用悬挂。
# 设计依据: Phase 56 有界资源与内存生命周期治理标准
# ==============================================================================

class_name EventSubscriptionToken extends RefCounted

var source_signal: Signal
var callable_target: Callable
var is_active: bool = false

func _init(p_sig: Signal = Signal(), p_fn: Callable = Callable()) -> void:
	source_signal = p_sig
	callable_target = p_fn
	is_active = (not p_sig.is_null()) and (not p_fn.is_null())

## 安全注销订阅，保证幂等性与零崩溃
func unsubscribe() -> bool:
	if not is_active:
		return false
	if (not source_signal.is_null()) and (not callable_target.is_null()):
		if source_signal.is_connected(callable_target):
			source_signal.disconnect(callable_target)
	is_active = false
	return true
