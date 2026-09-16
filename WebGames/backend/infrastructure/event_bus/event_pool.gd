# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/event_pool.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 事件包高频复用对象池，严格遵循 ADV-POOL-001 规范。 提供 borrow/recycle/get_free_count/get_borrowed_count 核心 API， 通过 is_borrowed 状态位防止双重归还，保障借还守恒与零热路径堆分配。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name EventPool
extends RefCounted

var _free: Array[EventPacket] = []
var _capacity: int = 512
var _borrowed: int = 0
var _is_reporting: bool = false

func _init(capacity: int = 512) -> void:
	_capacity = maxi(1, capacity)

## 借出事件包：优先复用空闲包，池空且达容量上限时告警并分配池外包
func borrow() -> EventPacket:
	var pkt: EventPacket = _free.pop_back() if not _free.is_empty() else null
	if pkt == null:
		if _borrowed >= _capacity and not _is_reporting:
			_is_reporting = true
			_push_pool_overflow_hint()
			_is_reporting = false
		pkt = EventPacket.new()
	pkt.is_borrowed = true
	_borrowed += 1
	return pkt

## 归还事件包：防双重归还（is_borrowed 守卫），复位后入池
func recycle(packet: EventPacket) -> bool:
	if packet == null or not packet.is_borrowed:
		return false
	packet.reset_state() # 复位已含 is_borrowed=false（M4：不再重复赋值）
	_borrowed = maxi(0, _borrowed - 1)
	if _free.size() < _capacity:
		_free.append(packet)
	return true

func get_free_count() -> int:
	return _free.size()

func get_borrowed_count() -> int:
	return _borrowed

func _push_pool_overflow_hint() -> void:
	# 池满新建属池外分配，经 ErrorReporter 统一通道遥测告警
	ErrorReporter.emit("event_bus2_pool_overflow", {})
