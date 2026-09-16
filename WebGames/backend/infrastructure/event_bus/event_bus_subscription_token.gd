# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/event_bus_subscription_token.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 订阅生命周期托管令牌。支持幂等解绑 (unbind)， 与旧版信号式令牌区分，防止全局类名命名冲突。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name EventBusSubscriptionToken
extends RefCounted

var bus: EventBusCore = null
var channel_id: int = 0
var category_mask: int = 0
var callback: Callable = Callable()
var is_spatial: bool = false
var token_id: int = 0
var is_active: bool = false

func _init(
	p_bus: EventBusCore,
	p_channel: int,
	p_mask: int,
	p_cb: Callable,
	p_spatial: bool,
	p_tid: int = 0
) -> void:
	bus = p_bus
	channel_id = p_channel
	category_mask = p_mask
	callback = p_cb
	is_spatial = p_spatial
	token_id = p_tid
	is_active = true

## 幂等注销（首次调用注销成功返回 true，重复调用返回 false）
func unbind() -> bool:
	if not is_active or bus == null:
		return false
	bus._unregister_token(self)
	is_active = false
	return true
