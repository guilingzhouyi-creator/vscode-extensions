# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/ping_pong_ring_buffer.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 事件总线专用双缓冲环形队列：隔离事件发布线程与分发消费循环，保证事件批量派发期间新发布的事件写入后台缓冲零冲突。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name PingPongRingBuffer
extends RefCounted

var _buffer_a: Array[EventPacket] = []
var _buffer_b: Array[EventPacket] = []
var _write_to_a: bool = true
var _capacity: int = 4096

func _init(capacity: int = 4096) -> void:
	_capacity = maxi(1, capacity)

## 入队当前写入缓冲（满则返回 false，由上层按 drop_on_overflow 策略处理）
func enqueue(packet: EventPacket) -> bool:
	if packet == null:
		return false
	if _write_to_a:
		if _buffer_a.size() >= _capacity:
			return false
		_buffer_a.append(packet)
	else:
		if _buffer_b.size() >= _capacity:
			return false
		_buffer_b.append(packet)
	return true

## 帧末批量清算：交换读写缓冲 → 逐包回调 → 清空（零拷贝，无 duplicate）
func flush_frame(callback: Callable) -> int:
	var read_array: Array[EventPacket] = _buffer_a if _write_to_a else _buffer_b
	_write_to_a = not _write_to_a
	var count: int = read_array.size()
	for packet in read_array:
		if callback.is_valid():
			callback.call(packet)
	read_array.clear()
	return count

func size() -> int:
	return _buffer_a.size() + _buffer_b.size()

func capacity() -> int:
	return _capacity
