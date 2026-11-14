# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/agent_async_dispatcher.gd
# 架构定位: Domain Service / Async Dispatcher & Backpressure Queue
# 依赖与触发: 上游: AgentHudSliceBridge | 下游: WorkerThreadPool, CompanionObserverBus | 配置: config/domains/world_state/core.json
# 职责说明: 面向 Agent 遥测流的异步背压派发器。
#           管理有界派发队列，实施 DROP_OLDEST / DROP_NEWEST 弹性削峰填谷，提供 WorkerThreadPool 异步派发与无头确定性测试双通道调度。
# 退出语义与设计依据: 异步流控与背压防雪崩规范 (Inv-ASYNC-BACKPRESSURE-SAFETY-4, Inv-DETERMINISTIC-TEST-MODE-5)
# ==============================================================================

## AgentAsyncDispatcher：Domain Service / Async Dispatcher & Backpressure Queue
class_name AgentAsyncDispatcher
extends RefCounted

const AgentHudTelemetryPacketDTO = preload("res://backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd")

enum Strategy {
	DROP_OLDEST = 0,
	DROP_NEWEST = 1,
	WARN_BLOCK = 2
}

var _capacity: int = 128
var _strategy: int = Strategy.DROP_OLDEST
var _is_deterministic_mode: bool = true
var _ring: Array[AgentHudTelemetryPacketDTO] = []
var _queue_head: int = 0
var _queue_tail: int = 0
var _queue_count: int = 0
var _sinks: Dictionary = {} # sink_id -> Callable
var _sink_callables: Array[Callable] = []

var _total_dispatched: int = 0
var _total_dropped: int = 0
var _mutex: Mutex = null
var _task_id: int = -1
var _is_worker_running: bool = false

func _init(capacity: int = 128, strategy: int = Strategy.DROP_OLDEST) -> void:
	_capacity = maxi(1, capacity)
	_strategy = strategy
	_is_deterministic_mode = true
	_ring.clear()
	_ring.resize(_capacity)
	_queue_head = 0
	_queue_tail = 0
	_queue_count = 0
	_sinks.clear()
	_sink_callables.clear()
	_total_dispatched = 0
	_total_dropped = 0
	_mutex = Mutex.new()
	_task_id = -1
	_is_worker_running = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		if _task_id != -1 and not WorkerThreadPool.is_task_completed(_task_id):
			WorkerThreadPool.wait_for_task_completion(_task_id)
			_task_id = -1

func _rebuild_sink_callables_unlocked() -> void:
	_sink_callables.clear()
	for sink_callable in _sinks.values():
		_sink_callables.append(sink_callable as Callable)

## 注册遥测消费下沉端点 (Callable 接收 packet: AgentHudTelemetryPacketDTO)
func register_sink(sink_id: String, consumer: Callable) -> void:
	if sink_id.is_empty() or not consumer.is_valid():
		return
	_mutex.lock()
	_sinks[sink_id] = consumer
	_rebuild_sink_callables_unlocked()
	_mutex.unlock()

## 注销指定下沉端点
func unregister_sink(sink_id: String) -> void:
	_mutex.lock()
	_sinks.erase(sink_id)
	_rebuild_sink_callables_unlocked()
	_mutex.unlock()

## 设置确定性同步模式（测试时强制单线程同步）
func set_deterministic_mode(is_enabled: bool) -> void:
	_is_deterministic_mode = is_enabled

## 是否处于确定性模式
func is_deterministic_mode() -> bool:
	return _is_deterministic_mode

## 派发遥测包（主线程耗时 <= 50 微秒，受背压策略流控）
func dispatch_telemetry(packet: AgentHudTelemetryPacketDTO) -> bool:
	if packet == null:
		return false

	if _is_deterministic_mode:
		_notify_all_sinks(packet)
		_total_dispatched += 1
		return true

	# 非确定性后台队列调度（O(1) 定容环形队列）
	_mutex.lock()
	if _queue_count >= _capacity:
		match _strategy:
			Strategy.DROP_OLDEST:
				_ring[_queue_head] = packet
				_queue_head = (_queue_head + 1) % _capacity
				_queue_tail = _queue_head
				_total_dropped += 1
			Strategy.DROP_NEWEST, Strategy.WARN_BLOCK:
				_total_dropped += 1
				_mutex.unlock()
				return false
	else:
		_ring[_queue_tail] = packet
		_queue_tail = (_queue_tail + 1) % _capacity
		_queue_count += 1

	_total_dispatched += 1
	var has_sinks: bool = not _sink_callables.is_empty()
	_mutex.unlock()

	# 仅在注册了有效消费端点时调度后台消费任务
	if has_sinks:
		_schedule_async_worker()
	return true

func _schedule_async_worker() -> void:
	_mutex.lock()
	if _is_worker_running:
		_mutex.unlock()
		return
	if _task_id != -1 and not WorkerThreadPool.is_task_completed(_task_id):
		_mutex.unlock()
		return
	_is_worker_running = true
	_task_id = WorkerThreadPool.add_task(Callable(self, "_process_worker_queue"), false, "AgentTelemetryDispatch")
	_mutex.unlock()

func _process_worker_queue() -> void:
	while true:
		var packet: AgentHudTelemetryPacketDTO = null
		_mutex.lock()
		if _queue_count > 0:
			packet = _ring[_queue_head]
			_ring[_queue_head] = null
			_queue_head = (_queue_head + 1) % _capacity
			_queue_count -= 1
		else:
			_is_worker_running = false
			_mutex.unlock()
			break
		_mutex.unlock()

		if packet != null:
			_notify_all_sinks(packet)

func _notify_all_sinks(packet: AgentHudTelemetryPacketDTO) -> void:
	_mutex.lock()
	var sink_callables: Array[Callable] = _sink_callables.duplicate()
	_mutex.unlock()
	for sink_callable in sink_callables:
		if sink_callable.is_valid():
			sink_callable.call(packet)

## 同步排空当前队列到所有下沉端点
func pump() -> int:
	var pending: Array[AgentHudTelemetryPacketDTO] = []
	_mutex.lock()
	if _queue_count > 0:
		pending.resize(_queue_count)
		for offset_index in range(_queue_count):
			var slot_index: int = (_queue_head + offset_index) % _capacity
			pending[offset_index] = _ring[slot_index]
			_ring[slot_index] = null
		_queue_head = 0
		_queue_tail = 0
		_queue_count = 0
	_mutex.unlock()

	for packet in pending:
		if packet != null:
			_notify_all_sinks(packet)
	return pending.size()

## 同步等待后台任务完成并冲刷剩余队列
func flush() -> void:
	var pending_task_id: int = -1
	_mutex.lock()
	if _task_id != -1:
		pending_task_id = _task_id
		_task_id = -1
	_mutex.unlock()
	if pending_task_id != -1 and not WorkerThreadPool.is_task_completed(pending_task_id):
		WorkerThreadPool.wait_for_task_completion(pending_task_id)
	pump()

## 获取当前排队深度
func get_queue_depth() -> int:
	_mutex.lock()
	var depth := _queue_count
	_mutex.unlock()
	return depth

## 获取累计派发数
func get_total_dispatched() -> int:
	_mutex.lock()
	var dispatched := _total_dispatched
	_mutex.unlock()
	return dispatched

## 获取累计丢弃数
func get_total_dropped() -> int:
	_mutex.lock()
	var dropped := _total_dropped
	_mutex.unlock()
	return dropped

## 获取队列容量
func get_capacity() -> int:
	return _capacity

## 清空队列与状态，同步收拢运行中任务
func clear() -> void:
	var pending_task_id: int = -1
	_mutex.lock()
	if _task_id != -1:
		pending_task_id = _task_id
		_task_id = -1
	for slot_index in range(_ring.size()):
		_ring[slot_index] = null
	_queue_head = 0
	_queue_tail = 0
	_queue_count = 0
	_total_dispatched = 0
	_total_dropped = 0
	_is_worker_running = false
	_mutex.unlock()
	if pending_task_id != -1 and not WorkerThreadPool.is_task_completed(pending_task_id):
		WorkerThreadPool.wait_for_task_completion(pending_task_id)
