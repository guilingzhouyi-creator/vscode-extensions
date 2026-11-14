# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/event_pool.gd
# 架构定位: Event Broker / Decoupling Foundation
# 依赖与触发: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 事件包高频复用对象池，严格遵循 ADV-POOL-001 规范。 提供 borrow/recycle/get_free_count/get_borrowed_count 核心 API， 通过 is_borrowed 状态位防止双重归还，保障借还守恒与零热路径堆分配。
# 退出语义与设计依据: 事件总线解耦规范 / 前后端通信隔离契约
# ==============================================================================

## EventPool：Event Broker / Decoupling Foundation
class_name EventPool
extends RefCounted

var _free: Array[EventPacket] = []
var _capacity: int = 4096
var _borrowed: int = 0
var _peak_borrowed: int = 0
var _is_reporting: bool = false
var _overflow_warned: bool = false

func _init(capacity: int = 4096) -> void:
	_capacity = maxi(1, capacity)

## 借出事件包：优先复用空闲包，池空且达容量上限时按边沿告警并分配池外包
func borrow() -> EventPacket:
	var packet: EventPacket = _free.pop_back() if not _free.is_empty() else null
	if packet == null:
		if _borrowed >= _capacity and not _overflow_warned and not _is_reporting:
			# 通过边沿状态位与重入守卫避免池溢出告警经 ErrorReporter 递归写回造成日志风暴
			_is_reporting = true
			_overflow_warned = true
			_push_pool_overflow_hint()
			_is_reporting = false
		packet = EventPacket.new()
	packet.is_borrowed = true
	_borrowed += 1
	if _borrowed > _peak_borrowed:
		_peak_borrowed = _borrowed
	return packet

## 归还事件包：防双重归还（is_borrowed 守卫），复位后入池
func recycle(packet: EventPacket) -> bool:
	if packet == null or not packet.is_borrowed:
		return false
	packet.reset_state() # reset_state 已重置 is_borrowed = false，避免重复赋值
	_borrowed = maxi(0, _borrowed - 1)
	if _overflow_warned and _borrowed < _capacity:
		_overflow_warned = false
	if _free.size() < _capacity:
		_free.append(packet)
	return true

## 获取对象池剩余空闲数量
func get_free_count() -> int:
	return maxi(0, _free.size())

## 获取当前借出使用的实例数量
func get_borrowed_count() -> int:
	return maxi(0, _borrowed)

## 获取自启动或重置以来的最大借出峰值高水位
func get_peak_borrowed_count() -> int:
	return maxi(0, _peak_borrowed)

## 获取当前对象池容量上限
func get_capacity() -> int:
	return _capacity

## 重置水位指标
func reset_metrics() -> void:
	_peak_borrowed = _borrowed

## 清空对象池缓存与计数（供单元测试与隔离重置）
func clear() -> void:
	_free.clear()
	_borrowed = 0
	_peak_borrowed = 0
	_is_reporting = false
	_overflow_warned = false

func _push_pool_overflow_hint() -> void:
	# 池满新建属池外分配，经 ErrorReporter 统一通道遥测告警
	ErrorReporter.emit("event_bus2_pool_overflow", {})
