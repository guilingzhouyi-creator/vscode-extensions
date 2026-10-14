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

func _init(capacity: int = 128, strategy: int = Strategy.DROP_OLDEST) -> void:
	_capacity = maxi(1, capacity)
	_strategy = strategy
	_deterministic_mode = true
	_queue.clear()
	_sinks.clear()
	_total_dispatched = 0
	_total_dropped = 0

## 注册遥测消费下沉端点 (Callable 接收 packet: AgentHudTelemetryPacketDTO)
func register_sink(sink_id: String, consumer: Callable) -> void:
	if sink_id.is_empty() or not consumer.is_valid():
		return
	_sinks[sink_id] = consumer

## 注销指定下沉端点
func unregister_sink(sink_id: String) -> void:
	_sinks.erase(sink_id)

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
	if _queue.size() >= _capacity:
		match _strategy:
			Strategy.DROP_OLDEST:
				_queue.pop_front()
				_total_dropped += 1
			Strategy.DROP_NEWEST:
				_total_dropped += 1
				return false
			Strategy.WARN_BLOCK:
				_total_dropped += 1
				return false

	_queue.append(packet)
	_total_dispatched += 1

	# 利用 WorkerThreadPool 后台任务消费
	var task_callable := Callable(self, "_process_worker_queue")
	WorkerThreadPool.add_task(task_callable, false, "AgentTelemetryDispatch")
	return true

func _process_worker_queue() -> void:
	while not _queue.is_empty():
		var pkt: AgentHudTelemetryPacketDTO = _queue.pop_front()
		if pkt != null:
			_notify_all_sinks(pkt)

func _notify_all_sinks(packet: AgentHudTelemetryPacketDTO) -> void:
	for sink_cb in _sinks.values():
		if (sink_cb as Callable).is_valid():
			(sink_cb as Callable).call(packet)

## 获取当前排队深度
func get_queue_depth() -> int:
	return _queue.size()

## 获取累计派发数
func get_total_dispatched() -> int:
	return _total_dispatched

## 获取累计丢弃数
func get_total_dropped() -> int:
	return _total_dropped

## 获取队列容量
func get_capacity() -> int:
	return _capacity

## 清空队列与状态
func clear() -> void:
	_queue.clear()
	_total_dispatched = 0
	_total_dropped = 0

