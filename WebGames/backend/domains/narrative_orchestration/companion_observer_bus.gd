# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/companion_observer_bus.gd
# 架构定位: Domain Event Bus / Observer Infrastructure
# 跨域依赖: 上游: AgentPlaythroughSession | 下游: CompanionBlackboxRecorder, ModWorkbenchView | 配置: 无 | 信号: 无
# 职责说明: 非侵入式伴侣观察事件总线；单例模式维护定长环形回溯队列（MAX_CAPACITY = 32）与观察者回调清单，实现推演步进、回滚、完结事件的非阻塞只读分发与尾部事件溯源。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name CompanionObserverBus
extends RefCounted

const MAX_CAPACITY: int = 32

static var _instance: CompanionObserverBus = null

var _ring_buffer: Array[Dictionary] = []
var _observers: Array[Callable] = []

# ==============================================================================
# 一、单例生命周期管理
# ==============================================================================

## 获取全局伴侣观察总线单例
static func get_instance() -> CompanionObserverBus:
	if _instance == null:
		_instance = CompanionObserverBus.new()
	return _instance

## 测试隔离专用：重置单例状态与观察者清单
static func reset_for_tests() -> void:
	if _instance != null:
		_instance.clear_history()
		_instance._observers.clear()
	_instance = null

# ==============================================================================
# 二、观察者注册与注销
# ==============================================================================

## 注册非侵入式观察回调 (Callable 接收 event_type: String, payload: Dictionary)
func register_observer(cb: Callable) -> void:
	if not cb.is_valid():
		return
	if not _observers.has(cb):
		_observers.append(cb)

## 注销指定观察回调
func unregister_observer(cb: Callable) -> void:
	_observers.erase(cb)

# ==============================================================================
# 三、非侵入式只读事件广播与历史追溯
# ==============================================================================

## 广播推演事件：入环形队列并向所有观察者分发只读副本
func broadcast_event(event_type: String, payload: Dictionary) -> void:
	var entry: Dictionary = {
		"event_type": event_type,
		"payload": payload.duplicate(true),
		"timestamp": int(Time.get_unix_time_from_system())
	}

	if _ring_buffer.size() >= MAX_CAPACITY:
		_ring_buffer.pop_front()
	_ring_buffer.append(entry)

	for obs in _observers:
		if obs.is_valid():
			obs.call(event_type, payload.duplicate(true))

## 获取最近事件尾部切片（默认截取最近 8 条）
func get_recent_events(limit: int = 8) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var total: int = _ring_buffer.size()
	var effective_limit: int = mini(limit, total)
	var start_idx: int = total - effective_limit
	for i in range(start_idx, total):
		out.append((_ring_buffer[i] as Dictionary).duplicate(true))
	return out

## 清空环形队列历史记录
func clear_history() -> void:
	_ring_buffer.clear()
