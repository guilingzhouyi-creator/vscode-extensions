# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/companion_observer_bus.gd
# 架构定位: Domain Event Bus / Observer Infrastructure
# 依赖与触发: 上游: AgentPlaythroughSession, AuthoritativeHudSyncService | 下游: CompanionBlackboxRecorder, ModWorkbenchView | 配置: 无 | 信号: 无
# 职责说明: 非侵入式伴侣观察事件总线；维护真定长环形回溯队列（MAX_CAPACITY = 32）与观察者清单，
#           实现推演步进、回滚、完结事件的 O(1) 取模滚动覆盖、非阻塞只读分发与尾部事件保序溯源，彻底消除 pop_front() 移位。
# 退出语义与设计依据: 伴侣观察总线平滑迁移与定长环形缓冲规范 (Inv-RING-BUFFER-BOUNDED-2, Inv-SEAMLESS-COMPATIBILITY-1)
# ==============================================================================

## CompanionObserverBus：Domain Event Bus / Observer Infrastructure
class_name CompanionObserverBus
extends RefCounted

const MAX_CAPACITY: int = 32

static var _instance: CompanionObserverBus = null

var _slots: Array[Dictionary] = []
var _head: int = 0
var _count: int = 0
var _observers: Array[Callable] = []

## 兼容性属性：向后兼容旧测试与观察者直接读取 _ring_buffer
var _ring_buffer: Array:
	get:
		return get_recent_events(MAX_CAPACITY)

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

func _init() -> void:
	_slots.resize(MAX_CAPACITY)
	_head = 0
	_count = 0
	_observers.clear()

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
	if _observers.has(cb):
		_observers.erase(cb)

# ==============================================================================
# 三、非侵入式只读事件广播与历史追溯 (O(1) 滚动覆盖)
# ==============================================================================

## 广播推演事件：O(1) 取模入定长环形队列并向所有观察者分发只读副本
func broadcast_event(event_type: String, payload: Dictionary) -> void:
	var entry: Dictionary = {
		"event_type": event_type,
		"payload": payload.duplicate(true),
		"timestamp": int(Time.get_unix_time_from_system())
	}

	_slots[_head] = entry
	_head = (_head + 1) % MAX_CAPACITY
	_count = mini(MAX_CAPACITY, _count + 1)

	if not _observers.is_empty():
		var read_only_payload: Dictionary = payload.duplicate(true)
		for obs in _observers:
			if obs.is_valid():
				obs.call(event_type, read_only_payload)

## 获取最近事件尾部切片（默认截取最近 8 条，严格按时间序保序排列）
func get_recent_events(limit: int = 8) -> Array[Dictionary]:
	var effective_limit: int = mini(limit, _count)
	if effective_limit <= 0:
		return []

	var out: Array[Dictionary] = []
	out.resize(effective_limit)
	var start_idx: int = (_head - effective_limit + MAX_CAPACITY) % MAX_CAPACITY
	for i in range(effective_limit):
		var slot_idx: int = (start_idx + i) % MAX_CAPACITY
		out[i] = _slots[slot_idx]
	return out

## 清空环形队列历史记录
func clear_history() -> void:
	for i in range(MAX_CAPACITY):
		_slots[i] = {}
	_head = 0
	_count = 0
