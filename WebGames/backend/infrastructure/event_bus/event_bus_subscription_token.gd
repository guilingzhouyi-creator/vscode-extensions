# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/event_bus_subscription_token.gd
# 架构定位: Event Broker / Decoupling Foundation
# 依赖与触发: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 订阅生命周期托管令牌。支持幂等解绑 (unbind)， 与旧版信号式令牌区分，防止全局类名命名冲突。
# 退出语义与设计依据: 事件总线解耦规范 / 前后端通信隔离契约
# ==============================================================================

## EventBusSubscriptionToken：Event Broker / Decoupling Foundation
class_name EventBusSubscriptionToken
extends RefCounted

var _bus_ref: WeakRef = null
var channel_id: int = 0
var category_mask: int = 0
var callback: Callable = Callable()
var is_spatial: bool = false
var token_id: int = 0
var is_active: bool = false

var bus: Variant:
	get:
		return _bus_ref.get_ref() if _bus_ref != null else null
	set(value):
		if value == null:
			_bus_ref = null
		else:
			_bus_ref = weakref(value)

func _init(
	event_bus: EventBusCore,
	initial_channel_id: int,
	initial_category_mask: int,
	initial_callback: Callable,
	spatial_listener: bool,
	initial_token_id: int = 0
) -> void:
	if event_bus != null:
		# 使用 WeakRef 持有总线，避免令牌被外部保留时阻止 EventBusCore 释放
		_bus_ref = weakref(event_bus)
	channel_id = initial_channel_id
	category_mask = initial_category_mask
	callback = initial_callback
	is_spatial = spatial_listener
	token_id = initial_token_id
	is_active = true

## 幂等注销（首次调用注销成功返回 true，重复调用返回 false）
func unbind() -> bool:
	if not is_active:
		return false
	is_active = false
	if _bus_ref != null:
		var active_bus: Variant = _bus_ref.get_ref()
		if active_bus != null and active_bus.has_method("_unregister_token"):
			active_bus._unregister_token(self)
	return true
