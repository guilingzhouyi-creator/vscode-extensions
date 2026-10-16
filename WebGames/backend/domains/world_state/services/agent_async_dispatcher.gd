# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/agent_async_dispatcher.gd
# 架构定位: Domain Service / Async Dispatcher & Backpressure Queue
# 依赖与触发: 上游: AgentHudSliceBridge | 下游: WorkerThreadPool, CompanionObserverBus | 配置: config/domains/world_state/core.json
# 职责说明: 面向 Agent 遥测流的异步背压派发器。
#           管理有界派发队列，实施 DROP_OLDEST / DROP_NEWEST 弹性削峰填谷，提供 WorkerThreadPool 异步派发与无头确定性测试双轨调度。
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
var _deterministic_mode: bool = true
var _queue: Array[AgentHudTelemetryPacketDTO] = []
var _sinks: Dictionary = {} # sink_id -> Callable

var _total_dispatched: int = 0
var _total_dropped: int = 0
var _mutex: Mutex = null
var _task_id: int = -1
var _worker_running: bool = false

func _init(capacity: int = 128, strategy: int = Strategy.DROP_OLDEST) -> void:
	_capacity = maxi(1, capacity)
	_strategy = strategy
	_deterministic_mode = true
	_queue.clear()
	_sinks.clear()
	_total_dispatched = 0
	_total_dropped = 0
	_mutex = Mutex.new()
	_task_id = -1
	_worker_running = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		if _task_id != -1 and not WorkerThreadPool.is_task_completed(_task_id):
			WorkerThreadPool.wait_for_task_completion(_task_id)
			_task_id = -1

## 注册遥测消费下沉端点 (Callable 接收 packet: AgentHudTelemetryPacketDTO)
func register_sink(sink_id: String, consumer: Callable) -> void:
	if sink_id.is_empty() or not consumer.is_valid():
		return
	_mutex.lock()
	_sinks[sink_id] = consumer
	_mutex.unlock()

## 注销指定下沉端点
func unregister_sink(sink_id: String) -> void:
	_mutex.lock()
	_sinks.erase(sink_id)
	_mutex.unlock()

## 设置确定性同步模式（测试时强制单线程同步）
func set_deterministic_mode(enabled: bool) -> void:
	_deterministic_mode = enabled

## 是否处于确定性模式
func is_deterministic_mode() -> bool:
	return _deterministic_mode

## 派发遥测包（主线程耗时 <= 50 微秒，受背压策略流控）
func dispatch_telemetry(packet: AgentHudTelemetryPacketDTO) -> bool:
	if packet == null:
		return false

	if _deterministic_mode:
		_notify_all_sinks(packet)
		_total_dispatched += 1
		return true

	# 非确定性后台队列调度
	_mutex.lock()
	if _queue.size() >= _capacity:
		match _strategy:
			Strategy.DROP_OLDEST:
				_queue.pop_front()
				_total_dropped += 1
			Strategy.DROP_NEWEST:
				_total_dropped += 1
				_mutex.unlock()
				return false
			Strategy.WARN_BLOCK:
				_total_dropped += 1
				_mutex.unlock()
				return false

	_queue.append(packet)
	_total_dispatched += 1
	var has_sinks: bool = not _sinks.is_empty()
	_mutex.unlock()

	# 仅在注册了有效消费端点时调度后台消费任务
	if has_sinks:
		_schedule_async_worker()
	return true

func _schedule_async_worker() -> void:
	_mutex.lock()
	if _worker_running:
		_mutex.unlock()
		return
	if _task_id != -1 and not WorkerThreadPool.is_task_completed(_task_id):
		_mutex.unlock()
		return
	_worker_running = true
	_task_id = WorkerThreadPool.add_task(Callable(self, "_process_worker_queue"), false, "AgentTelemetryDispatch")
	_mutex.unlock()

func _process_worker_queue() -> void:
	while true:
		var pkt: AgentHudTelemetryPacketDTO = null
		_mutex.lock()
		if not _queue.is_empty():
			pkt = _queue.pop_front()
		else:
			_worker_running = false
			_mutex.unlock()
			break
		_mutex.unlock()

		if pkt != null:
			_notify_all_sinks(pkt)

func _notify_all_sinks(packet: AgentHudTelemetryPacketDTO) -> void:
	_mutex.lock()
	var sink_callables := _sinks.values()
	_mutex.unlock()
	for sink_cb in sink_callables:
		if (sink_cb as Callable).is_valid():
			(sink_cb as Callable).call(packet)

## 同步排空当前队列到所有下沉端点
func pump() -> int:
	var pending: Array[AgentHudTelemetryPacketDTO] = []
	_mutex.lock()
	pending = _queue.duplicate()
	_queue.clear()
	_mutex.unlock()

	for pkt in pending:
		if pkt != null:
			_notify_all_sinks(pkt)
	return pending.size()

## 同步等待后台任务完成并冲刷剩余队列
func flush() -> void:
	var tid: int = -1
	_mutex.lock()
	if _task_id != -1:
		tid = _task_id
		_task_id = -1
	_mutex.unlock()
	if tid != -1 and not WorkerThreadPool.is_task_completed(tid):
		WorkerThreadPool.wait_for_task_completion(tid)
	pump()

## 获取当前排队深度
func get_queue_depth() -> int:
	_mutex.lock()
	var depth := _queue.size()
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
	var tid: int = -1
	_mutex.lock()
	if _task_id != -1:
		tid = _task_id
		_task_id = -1
	_queue.clear()
	_total_dispatched = 0
	_total_dropped = 0
	_worker_running = false
	_mutex.unlock()
	if tid != -1 and not WorkerThreadPool.is_task_completed(tid):
		WorkerThreadPool.wait_for_task_completion(tid)
