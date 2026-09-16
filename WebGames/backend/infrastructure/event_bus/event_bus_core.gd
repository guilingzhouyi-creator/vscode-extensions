# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/event_bus_core.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 全域解耦事件中枢核心单例：提供强类型事件订阅、通道路由、同步即时派发与异步队列缓冲支持；包含强弱引用生命周期管理，彻底防范观察者内存泄漏与悬挂指针双重广播。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name EventBusCore
extends RefCounted

static var _instance: EventBusCore = null

var _channel_routes: Dictionary = {}   # channel_id(int) -> Array[EventBusSubscriptionToken]（掩码过滤按 token 内联判定）
var _spatial_grid: HeadlessSpatialHashGrid3D = null
var _ring_buffer: PingPongRingBuffer = null
var _pool: EventPool = null
var _seq_counter: int = 0
var _dispatch_depth: int = 0
var _max_depth: int = 16
var _target_scratch: Array = []    # 按递归深度索引的目标暂存池（复用免热路径堆分配）
var _seen_scratch: Array = []      # 按递归深度索引的通配去重池（O(n) 去重，替代线性 has 扫描）

# ---- 叙事表缓存（自旧总线迁正：域 id → 文案表名，按配置重载版本失效） ----
static var _record_seq: int = 0
static var _narrative_table_cache: Dictionary = {}
static var _narrative_cache_version: int = -1

func _init() -> void:
	_spatial_grid = HeadlessSpatialHashGrid3D.new(16.0)
	_ring_buffer = PingPongRingBuffer.new(4096)
	_pool = EventPool.new(512)
	_max_depth = 16

## 应用级单例（生产模式与 GameBootstrap 统一入口；单元测试建议 EventBusCore.new() 独立实例）
static func get_instance() -> EventBusCore:
	if _instance == null:
		_instance = EventBusCore.new()
	return _instance

## 从 event_bus_config.json 驱动装配参数（单元尺寸/缓冲容量/池容量/熔断深度）
func initialize_from_config() -> void:
	var cell: float = GameConfig.get_float("infrastructure.event_bus_config", "spatial_routing/cell_size_meters", 16.0)
	var max_r: float = GameConfig.get_float("infrastructure.event_bus_config", "spatial_routing/max_dispatch_radius_meters", 256.0)
	_spatial_grid = HeadlessSpatialHashGrid3D.new(maxf(1.0, cell), maxf(1.0, max_r))
	var ring_cap: int = GameConfig.get_int("infrastructure.event_bus_config", "frame_batching/ring_buffer_capacity", 4096)
	_ring_buffer = PingPongRingBuffer.new(maxi(1, ring_cap))
	var pool_cap: int = GameConfig.get_int("infrastructure.event_bus_config", "pool/capacity", 512)
	_pool = EventPool.new(maxi(1, pool_cap))
	_max_depth = maxi(1, GameConfig.get_int("infrastructure.event_bus_config", "circuit_breaker/max_dispatch_depth", 16))

## 测试隔离：清空路由与状态
func clear_for_tests() -> void:
	_channel_routes.clear()
	_spatial_grid = HeadlessSpatialHashGrid3D.new(16.0)
	_ring_buffer = PingPongRingBuffer.new(4096)
	_pool = EventPool.new(512)
	_seq_counter = 0
	_dispatch_depth = 0

## 对象池借还统一门面 API
func borrow_packet(channel_id: int, category_mask: int, payload: Variant = null) -> EventPacket:
	var packet: EventPacket = _pool.borrow()
	packet.channel_id = channel_id
	packet.category_mask = category_mask
	packet.payload_data = payload
	return packet

func recycle_packet(packet: EventPacket) -> void:
	_pool.recycle(packet)

# ==============================================================================
# 订阅接口
# ==============================================================================

## 订阅门面：channel_id=0 表示通配频道；category_mask=0 表示通配全部类别
## （packet.category_mask=0 时仅匹配 mask=0 订阅者——语义契约见 ADV-EVT-001/002）
func subscribe(channel_id: int, category_mask: int, callback: Callable) -> EventBusSubscriptionToken:
	var token: EventBusSubscriptionToken = EventBusSubscriptionToken.new(self, channel_id, category_mask, callback, false)
	if not _channel_routes.has(channel_id):
		_channel_routes[channel_id] = []
	_channel_routes[channel_id].append(token)
	return token

## 便捷全通订阅接口 (Phase 74 治理信令监听)
func on(channel_id: int, callback: Callable) -> EventBusSubscriptionToken:
	return subscribe(channel_id, EventCategoryMask.MASK_ALL, callback)


## 空间兴趣区订阅：AoI 内监听者会收到该范围内全部空间事件（不按 channel/mask 过滤，
## 业务回调内按需自行过滤——契约见 Inv-EB2-2 精确裁剪语义）
func on_spatial(pos: Vector3, radius: float, callback: Callable) -> EventBusSubscriptionToken:
	_seq_counter += 1
	var token_id: int = _seq_counter
	_spatial_grid.register_listener(token_id, pos, radius, callback)
	return EventBusSubscriptionToken.new(self, 0, 0, callback, true, token_id)

func on_spatial_2d(pos_2d: Vector2, radius: float, callback: Callable, is_isometric_xz: bool = false) -> EventBusSubscriptionToken:
	_seq_counter += 1
	var token_id: int = _seq_counter
	_spatial_grid.register_listener_2d(token_id, pos_2d, radius, callback, is_isometric_xz)
	return EventBusSubscriptionToken.new(self, 0, 0, callback, true, token_id)

func _unregister_token(token: EventBusSubscriptionToken) -> void:
	if token.is_spatial:
		_spatial_grid.unregister_listener(token.token_id)
	else:
		if _channel_routes.has(token.channel_id):
			var arr: Array = _channel_routes[token.channel_id]
			arr.erase(token)
			if arr.is_empty():
				_channel_routes.erase(token.channel_id)

# ==============================================================================
# 原语 ①：dispatch_now（即时同步因果 + 递归熔断）
# ==============================================================================

func dispatch_now(packet: EventPacket) -> void:
	if packet == null:
		return
	if _dispatch_depth >= _max_depth:
		ErrorReporter.emit("event_bus2_reentrancy_guard", {"channel_id": packet.channel_id, "max_depth": _max_depth})
		return
	# 深度索引化暂存（复用不重建，零热路径堆分配）；越界即自愈重建（异常回调泄漏深度后仍能恢复服务）
	var depth: int = _dispatch_depth
	_dispatch_depth += 1
	if depth >= _target_scratch.size():
		_target_scratch.resize(depth + 1)
		_target_scratch[depth] = []
	if depth >= _seen_scratch.size():
		_seen_scratch.resize(depth + 1)
		_seen_scratch[depth] = {}
	var targets: Array = _target_scratch[depth]
	var seen: Dictionary = _seen_scratch[depth]
	targets.clear()
	seen.clear()
	_seq_counter += 1
	packet.event_id = _seq_counter

	if _channel_routes.has(packet.channel_id):
		# 遍历前直接快照到 targets（Inv-EB2-7 回调内 unbind 不跳项；不 duplicate 原数组）
		var subs: Array = _channel_routes[packet.channel_id]
		for item in subs:
			var tok: EventBusSubscriptionToken = item as EventBusSubscriptionToken
			if tok != null and tok.is_active and ((tok.category_mask & packet.category_mask) != 0 or tok.category_mask == 0):
				if not seen.has(tok):
					seen[tok] = true
					targets.append(tok)
	if packet.channel_id != 0 and _channel_routes.has(0):
		var subs_zero: Array = _channel_routes[0]
		for item in subs_zero:
			var tok: EventBusSubscriptionToken = item as EventBusSubscriptionToken
			if tok != null and tok.is_active and ((tok.category_mask & packet.category_mask) != 0 or tok.category_mask == 0):
				if not seen.has(tok):
					seen[tok] = true
					targets.append(tok)

	# 派发快照已在独立 targets 中，回调内增删订阅不影响本轮遍历（Inv-EB2-7）
	for tok in targets:
		if tok.is_active and tok.callback.is_valid():
			tok.callback.call(packet)

	targets.clear()
	seen.clear()
	_dispatch_depth = depth  # 自愈式恢复：无论回调如何扰动计数，退出时锚定进入前快照

# ==============================================================================
# 原语 ②：enqueue_frame + flush_frame_events（帧级双缓冲合批）
# ==============================================================================

func enqueue_frame(packet: EventPacket) -> bool:
	if packet == null:
		return false
	if (packet.category_mask & EventCategoryMask.CORE_STATE) != 0:
		ErrorReporter.emit("event_bus2_core_state_in_frame_queue", {"channel_id": packet.channel_id})
		return false
	_seq_counter += 1
	packet.event_id = _seq_counter
	var ok: bool = _ring_buffer.enqueue(packet)
	if not ok:
		# 溢出兜底：入队失败的包由总线统一回收（否则调用方遗漏 recycle 时包永久滞留池外）
		ErrorReporter.emit("event_bus2_frame_queue_overflow", {"channel_id": packet.channel_id})
		recycle_packet(packet)
	return ok

func flush_frame_events() -> int:
	return _ring_buffer.flush_frame(func(packet: EventPacket) -> void:
		dispatch_now(packet)
		recycle_packet(packet)
	)

# ==============================================================================
# 原语 ③：dispatch_spatial / dispatch_spatial_2d（空间AoI定向裁剪）
# ==============================================================================

func dispatch_spatial(packet: EventPacket, origin: Vector3, radius: float) -> int:
	if packet == null:
		return 0
	_seq_counter += 1
	packet.event_id = _seq_counter
	packet.set_spatial_header(origin, radius)
	return _spatial_grid.dispatch_packet(packet)

func dispatch_spatial_2d(packet: EventPacket, origin_2d: Vector2, radius: float, is_isometric_xz: bool = false) -> int:
	if packet == null:
		return 0
	_seq_counter += 1
	packet.event_id = _seq_counter
	packet.set_spatial_header_2d(origin_2d, radius, is_isometric_xz)
	return _spatial_grid.dispatch_packet(packet)

# ==============================================================================
# 配置 Getters（供测试断言与遥测监控）
# ==============================================================================

func get_spatial_cell_size() -> float:
	return _spatial_grid.get_cell_size()

func get_frame_buffer_capacity() -> int:
	return _ring_buffer.capacity()

func get_max_dispatch_depth() -> int:
	return _max_depth

func get_pool() -> EventPool:
	return _pool

# ==============================================================================
# 叙事/领域/日志迁正 API（自旧版 EventBus 同签名迁入，旧类退役后唯一真源）
# ==============================================================================

## 测试专用重置：清零记录序号并清空叙事表缓存（避免跨用例状态残留）
static func reset_sequence_for_test() -> void:
	_record_seq = 0
	_narrative_table_cache.clear()
	_narrative_cache_version = -1

## 将分类配置键解析为分类名（读 event_categories.json；未命中回退大写原值）
static func get_category_name(category_key: String) -> String:
	if category_key.is_empty():
		return category_key
	var entry: Dictionary = GameConfig.get_dict("infrastructure.event_categories", category_key, {})
	if not entry.is_empty():
		return entry.get("name", category_key.to_upper())
	return category_key.to_upper()

## 按模板键渲染叙事文案：键形如 "<领域>/<名称>"，查表 "narratives.<领域>"
static func render_narrative(template_key: String, args: Array = []) -> String:
	var parts := template_key.split("/")
	if parts.is_empty():
		return template_key
	var table_name := "narratives." + parts[0]
	var path := "/".join(parts.slice(1))
	var template := GameConfig.get_string(table_name, path, template_key)
	if args.is_empty():
		return template
	return template % args

## 将领域 id 解析为其文案表名（映射以 domains.json 为准，按重载版本缓存）
static func resolve_narrative_table(domain_id: String) -> String:
	if domain_id.is_empty():
		return ""
	var current_version := GameConfig.config_reload_version()
	if _narrative_cache_version != current_version:
		_narrative_table_cache.clear()
		var all_entries: Array = GameConfig.get_array("infrastructure.domains", "domains", [])
		for entry in all_entries:
			if not entry is Dictionary:
				continue
			var row := entry as Dictionary
			var row_id := String(row.get("id", ""))
			if row_id.is_empty():
				continue
			var table := String(row.get("narrative", ""))
			_narrative_table_cache[row_id] = table if not table.is_empty() else "narratives." + row_id
		_narrative_cache_version = current_version
	if _narrative_table_cache.has(domain_id):
		return String(_narrative_table_cache[domain_id])
	return "narratives." + domain_id

## 解析泛化领域事件的文案（键形 "<domain_id>.<event_name>"，多段事件名完整保留）
static func render_domain_event_text(channel: String, payload: Dictionary = {}) -> String:
	var parts := channel.split(".")
	if parts.size() >= 2:
		var domain := parts[0]
		var full_event_name := String(".").join(parts.slice(1, parts.size()))
		if domain.is_empty() or full_event_name.is_empty():
			return String(payload.get("text", ""))
		var template := GameConfig.get_string(resolve_narrative_table(domain), full_event_name, "")
		if not template.is_empty():
			var args: Array = payload.get("args", [])
			return template if args.is_empty() else (template % args)
	return String(payload.get("text", ""))

## 广播结构化叙事事件：文案走 NARRATIVE_TEXT 掩码派发（旧总线叙事信号替代）
func emit_narrative(text: String, category_key: String = "combat", meta: Dictionary = {}) -> void:
	var category := get_category_name(category_key)
	var packet := borrow_packet(EventChannelDefinition.NARRATIVE_EVENT_TEXT, EventCategoryMask.NARRATIVE_TEXT, meta)
	packet.payload_data = {"timestamp": Time.get_ticks_msec(), "category": category, "text": text, "meta": meta}
	packet.narrative_key = text
	dispatch_now(packet)
	recycle_packet(packet)

## 一站式推荐入口：按模板键渲染文案并广播
func emit_narrative_by_key(template_key: String, category_key: String, args: Array = [], meta: Dictionary = {}) -> void:
	emit_narrative(render_narrative(template_key, args), category_key, meta)

## 广播泛化领域事件：结构化 payload 经 DOMAIN_EVENT_GENERIC 信道派发；
## 能解析出文案时追加叙事派发（与旧总线两步语义一致）
func emit_domain_event(channel: String, payload: Dictionary = {}) -> void:
	var packet := borrow_packet(EventChannelDefinition.DOMAIN_EVENT_GENERIC, EventCategoryMask.NARRATIVE_TEXT, payload)
	packet.payload_data = {"channel": channel, "payload": payload}
	dispatch_now(packet)
	recycle_packet(packet)
	var text := render_domain_event_text(channel, payload)
	if not text.is_empty():
		emit_narrative(text, String(payload.get("category_key", "system")), payload)

## 广播结构化日志记录：统一入环 + 旁路导出 + 遥测聚合（序号唯一签发，Inv-LG-3）
func emit_log_record(record: LogRecordDTO) -> void:
	if record == null:
		return
	_record_seq += 1
	record.sequence = _record_seq
	var packet := borrow_packet(EventChannelDefinition.LOG_RECORD_POSTED, EventCategoryMask.SYSTEM_TELEMETRY)
	packet.payload_dto = record
	packet.narrative_key = record.message
	dispatch_now(packet)
	recycle_packet(packet)
	LogFileExporter.consume(record)
	var srec: StructuredLogRecord
	if record is StructuredLogRecord:
		srec = record
	else:
		srec = StructuredLogRecord.from_dto(record.to_dto())
	LogRingBuffer.append(srec)
	TelemetryAggregate.consume(srec)

## 便捷日志入口：按 level_key + 原文构造 DTO 并委托 emit_log_record
func emit_log(level_key: String, msg: String) -> void:
	var record := LogRecordDTO.new()
	record.level = level_key
	record.message = msg
	emit_log_record(record)

## 时钟推进广播（旧 world_clock_advanced 信号替代，CORE_STATE 强一致内联）
func emit_world_clock_advanced(clock_type: String, current_tick: int, timestamp_str: String) -> void:
	var packet := borrow_packet(EventChannelDefinition.WORLD_CLOCK_ADVANCED, EventCategoryMask.CORE_STATE)
	packet.payload_data = {"clock_type": clock_type, "current_tick": current_tick, "timestamp": timestamp_str}
	packet.source_entity_id = "world_clock"
	dispatch_now(packet)
	recycle_packet(packet)

## 职业晋升广播（旧 profession_promoted 信号替代）
func emit_profession_promoted(character_id: String, profession_archetype: Dictionary) -> void:
	var packet := borrow_packet(EventChannelDefinition.PROFESSION_PROMOTED, EventCategoryMask.CORE_STATE)
	packet.payload_data = {"character_id": character_id, "profession_archetype": profession_archetype}
	packet.source_entity_id = character_id
	dispatch_now(packet)
	recycle_packet(packet)

## 结构化信道订阅便捷入口：回调收到 EventPacket，载荷按信道语义取
## payload_data（Narrative/Domain/Clock/Profession/Log 各迁正信道的 Dictionary/DTO）
func on_channel(channel_id: int, callback: Callable) -> EventBusSubscriptionToken:
	return subscribe(channel_id, EventCategoryMask.MASK_ALL, callback)
