# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/ping_pong_ring_buffer.gd
# 架构定位: Event Broker / Decoupling Foundation
# 依赖与触发: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 事件总线专用双缓冲环形队列：隔离事件发布线程与分发消费循环，保证事件批量派发期间新发布的事件写入后台缓冲零冲突。
# 退出语义与设计依据: 事件总线解耦规范 / 前后端通信隔离契约
# ==============================================================================

## PingPongRingBuffer：Event Broker / Decoupling Foundation
class_name PingPongRingBuffer
extends RefCounted

var _primary_buffer: Array[EventPacket] = []
var _secondary_buffer: Array[EventPacket] = []
var _is_writing_to_primary: bool = true
var _capacity: int = 4096

func _init(capacity: int = 4096) -> void:
	_capacity = maxi(1, capacity)

## 入队当前写入缓冲（满则返回 false，由上层按 drop_on_overflow 策略处理）
func enqueue(packet: EventPacket) -> bool:
	if packet == null:
		return false
	if _is_writing_to_primary:
		if _primary_buffer.size() >= _capacity:
			return false
		_primary_buffer.append(packet)
	else:
		if _secondary_buffer.size() >= _capacity:
			return false
		_secondary_buffer.append(packet)
	return true

## 帧末批量清算：交换读写缓冲 → 逐包回调 → 清空（零拷贝，无 duplicate）
func flush_frame(callback: Callable) -> int:
	# 在触发回调前先翻转写入端，确保回调内部新入队的事件写入另一缓冲而不污染本帧遍历
	var read_array: Array[EventPacket] = _primary_buffer if _is_writing_to_primary else _secondary_buffer
	_is_writing_to_primary = not _is_writing_to_primary
	var count: int = read_array.size()
	for packet in read_array:
		if callback.is_valid():
			callback.call(packet)
	read_array.clear()
	return count

## 获取当前缓冲区内存储的有效元素数量
func size() -> int:
	return _primary_buffer.size() + _secondary_buffer.size()

## 获取当前环形缓冲区的物理最大容量
func capacity() -> int:
	return _capacity

## 获取当前正在写入的活跃缓冲区积压数量
func get_active_buffer_size() -> int:
	return _primary_buffer.size() if _is_writing_to_primary else _secondary_buffer.size()

## 清空双缓冲区（供测试隔离与重置）
func clear() -> void:
	_primary_buffer.clear()
	_secondary_buffer.clear()
	_is_writing_to_primary = true
