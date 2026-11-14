# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/event_bus_core.gd
# 架构定位: Event Broker / Decoupling Foundation
# 依赖与触发: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 全域解耦事件中枢核心单例：提供强类型事件订阅、通道路由、同步即时派发与异步队列缓冲支持；包含强弱引用生命周期管理，彻底防范观察者内存泄漏与悬挂指针双重广播。
# 退出语义与设计依据: 事件总线解耦规范 / 前后端通信隔离契约
# ==============================================================================

## EventBusCore：Event Broker / Decoupling Foundation
class_name EventBusCore
extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const SystemBaseMessages = preload("res://backend/infrastructure/logging/system_base_messages.gd")
const StatisticsMathLib = preload("res://backend/infrastructure/pure/statistics_math_lib.gd")

static var _instance: EventBusCore = null

var _channel_routes: Dictionary = {} # channel_id(int) -> Array[EventBusSubscriptionToken]（掩码过滤按 token 内联判定）
var _legacy_channel_to_id: Dictionary = {} # "channel_string" -> channel_id(int)
var _id_to_legacy_channel: Dictionary = {} # channel_id(int) -> "channel_string"
var _channel_cache_version: int = -1
var _spatial_grid: HeadlessSpatialHashGrid3D = null
var _ring_buffer: PingPongRingBuffer = null
var _pool: EventPool = null
var _sequence_counter: int = 0
var _dispatch_depth: int = 0
var _max_depth: int = 16
var _target_scratch: Array = [] # 按递归深度索引的目标暂存池（复用免热路径堆分配）
var _seen_scratch: Array = [] # 按递归深度索引的通配去重池（O(n) 去重，替代线性 has 扫描）
var _dead_tokens_scratch: Array = [] # 失效订阅令牌回收暂存池（复用免热路径堆分配）

# ---- 遥测指标 (Metrics & Profiling) ----
var _enable_profiling: bool = true
var _high_freq_threshold: int = 10000
var _dispatched_count: int = 0
var _enqueued_count: int = 0
var _dropped_count: int = 0
var _peak_dispatch_depth: int = 0
var _current_window_ops: int = 0
var _is_warning_high_freq: bool = false

# ---- 叙事表缓存（自旧总线迁正：域 id → 文案表名，按配置重载版本失效） ----
static var _record_sequence_number: int = 0
static var _narrative_table_cache: Dictionary = {}
static var _narrative_cache_version: int = -1

func _init() -> void:
	_spatial_grid = HeadlessSpatialHashGrid3D.new(16.0)
	_ring_buffer = PingPongRingBuffer.new(4096)
	_pool = EventPool.new(4096)
	_max_depth = 16
	_enable_profiling = true
	_high_freq_threshold = 10000
	_ensure_channel_registry_loaded()

## 应用级单例（生产模式与 GameBootstrap 统一入口；单元测试建议 EventBusCore.new() 独立实例）
static func get_instance() -> EventBusCore:
	if _instance == null:
		_instance = EventBusCore.new()
	return _instance

## 确保频道配置与整型信道映射表加载对齐
func _ensure_channel_registry_loaded() -> void:
	var current_version: int = GameConfig.config_reload_version()
	if _channel_cache_version == current_version and not _legacy_channel_to_id.is_empty():
		return
	_legacy_channel_to_id.clear()
	_id_to_legacy_channel.clear()
	# 预装高频基础信道别名
	_legacy_channel_to_id["world_state.hud_snapshot_published"] = EventChannelDefinition.HUD_STATUS_SNAPSHOT
	_legacy_channel_to_id["world_state.snapshot_published"] = EventChannelDefinition.HUD_STATUS_SNAPSHOT
	_legacy_channel_to_id["world_state.stat_mutated"] = EventChannelDefinition.HUD_STAT_MUTATED
	_legacy_channel_to_id["world_state.wallet_mutated"] = EventChannelDefinition.HUD_WALLET_MUTATED
	_legacy_channel_to_id["currency.wallet.mutated"] = EventChannelDefinition.HUD_WALLET_MUTATED
	_legacy_channel_to_id["account.registered"] = EventChannelDefinition.AUTH_REGISTERED
	_legacy_channel_to_id["account.login_succeeded"] = EventChannelDefinition.AUTH_LOGIN_SUCCEEDED

	var channel_registry: Array = GameConfig.get_array("infrastructure.event_bus_config", "channel_registry", [])
	for item in channel_registry:
		if not (item is Dictionary):
			continue
		var entry: Dictionary = item as Dictionary
		var channel_id: int = int(entry.get("id", 0))
		var channel_name: String = str(entry.get("name", ""))
		var legacy: String = str(entry.get("legacy", ""))
		if channel_id <= 0:
			continue
		if not channel_name.is_empty():
			_legacy_channel_to_id[channel_name] = channel_id
			_legacy_channel_to_id[channel_name.to_lower()] = channel_id
		if not legacy.is_empty():
			_legacy_channel_to_id[legacy] = channel_id
			_legacy_channel_to_id[legacy.to_lower()] = channel_id
		_id_to_legacy_channel[channel_id] = legacy if not legacy.is_empty() else channel_name
	_channel_cache_version = current_version

## 将信道名称、别名或整型常量解析为标准整型信道常量
func resolve_channel_id(channel_spec: Variant) -> int:
	if channel_spec is int:
		return int(channel_spec)
	if channel_spec is String:
		var channel_name: String = channel_spec as String
		_ensure_channel_registry_loaded()
		if _legacy_channel_to_id.has(channel_name):
			return int(_legacy_channel_to_id[channel_name])
		var channel_name_lower: String = channel_name.to_lower()
		if _legacy_channel_to_id.has(channel_name_lower):
			return int(_legacy_channel_to_id[channel_name_lower])
		return EventChannelDefinition.DOMAIN_EVENT_GENERIC
	return EventChannelDefinition.DOMAIN_EVENT_GENERIC

## 从 event_bus_config.json 驱动装配参数（单元尺寸/缓冲容量/池容量/熔断深度/遥测钩子）
func initialize_from_config() -> void:
	var cell_size: float = GameConfig.get_float("infrastructure.event_bus_config", "spatial_routing/cell_size_meters", 16.0)
	var max_dispatch_radius: float = GameConfig.get_float("infrastructure.event_bus_config", "spatial_routing/max_dispatch_radius_meters", 256.0)
	_spatial_grid = HeadlessSpatialHashGrid3D.new(maxf(1.0, cell_size), maxf(1.0, max_dispatch_radius))
	var ring_capacity: int = GameConfig.get_int("infrastructure.event_bus_config", "frame_batching/ring_buffer_capacity", 4096)
	_ring_buffer = PingPongRingBuffer.new(maxi(1, ring_capacity))
	var pool_capacity: int = GameConfig.get_int("infrastructure.event_bus_config", "pool/capacity", 4096)
	_pool = EventPool.new(maxi(1, pool_capacity))
	_max_depth = maxi(1, GameConfig.get_int("infrastructure.event_bus_config", "circuit_breaker/max_dispatch_depth", 16))
	_enable_profiling = GameConfig.get_bool("infrastructure.event_bus_config", "metrics/enable_profiling_hooks", true)
	_high_freq_threshold = maxi(100, GameConfig.get_int("infrastructure.event_bus_config", "metrics/high_frequency_warning_threshold_ops", 10000))
	_ensure_channel_registry_loaded()

## 测试隔离：清空路由与状态
func clear_for_tests() -> void:
	_channel_routes.clear()
	_legacy_channel_to_id.clear()
	_id_to_legacy_channel.clear()
	_channel_cache_version = -1
	if _spatial_grid != null:
		_spatial_grid.clear()
	else:
		_spatial_grid = HeadlessSpatialHashGrid3D.new(16.0)
	if _ring_buffer != null:
		_ring_buffer.clear()
	else:
		_ring_buffer = PingPongRingBuffer.new(4096)
	if _pool != null:
		_pool.clear()
	else:
		_pool = EventPool.new(4096)
	_sequence_counter = 0
	_dispatch_depth = 0
	_dead_tokens_scratch.clear()
	reset_metrics()
	_ensure_channel_registry_loaded()

## 对象池借还统一门面 API
func borrow_packet(channel_id: int, category_mask: int, payload: Variant = null) -> EventPacket:
	var packet: EventPacket = _pool.borrow()
	packet.channel_id = channel_id
	packet.category_mask = category_mask
	packet.payload_data = payload
	return packet

## 回收事件包至对象池，杜绝堆碎片产生
func recycle_packet(packet: EventPacket) -> void:
	if packet == null:
		return
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

## 便捷全通订阅接口 (治理信令监听)
func on(channel_id: int, callback: Callable) -> EventBusSubscriptionToken:
	return subscribe(channel_id, EventCategoryMask.MASK_ALL, callback)


## 空间兴趣区订阅：AoI 内监听者会收到该范围内全部空间事件（不按 channel/mask 过滤，
## 业务回调内按需自行过滤——契约见 Inv-EB2-2 精确裁剪语义）
func on_spatial(pos: Vector3, radius: float, callback: Callable) -> EventBusSubscriptionToken:
	_sequence_counter += 1
	var token_id: int = _sequence_counter
	_spatial_grid.register_listener(token_id, pos, radius, callback)
	return EventBusSubscriptionToken.new(self, 0, 0, callback, true, token_id)

## 订阅二维空间局部范围事件通知
func on_spatial_2d(pos_2d: Vector2, radius: float, callback: Callable, is_isometric_xz: bool = false) -> EventBusSubscriptionToken:
	_sequence_counter += 1
	var token_id: int = _sequence_counter
	_spatial_grid.register_listener_2d(token_id, pos_2d, radius, callback, is_isometric_xz)
	return EventBusSubscriptionToken.new(self, 0, 0, callback, true, token_id)

func _unregister_token(token: EventBusSubscriptionToken) -> void:
	if token.is_spatial:
		_spatial_grid.unregister_listener(token.token_id)
	else:
		if _channel_routes.has(token.channel_id):
			var route_tokens: Array = _channel_routes[token.channel_id]
			route_tokens.erase(token)
			if route_tokens.is_empty():
				_channel_routes.erase(token.channel_id)

# ==============================================================================
# 原语 ①：dispatch_now（即时同步因果 + 递归熔断）
# ==============================================================================

## 深度索引化临时工作区准备（复用不重建，零热路径堆分配）
func _prepare_dispatch_scratch(depth: int) -> void:
	if depth >= _target_scratch.size():
		_target_scratch.resize(depth + 1)
		_target_scratch[depth] = []
	if depth >= _seen_scratch.size():
		_seen_scratch.resize(depth + 1)
		_seen_scratch[depth] = {}

## 收集指定频道的有效订阅者到 targets 快照列表
func _collect_channel_subscribers(channel_id: int, packet: EventPacket, seen: Dictionary, targets: Array) -> void:
	if not _channel_routes.has(channel_id):
		return
	var subs: Array = _channel_routes[channel_id]
	for item in subs:
		var token: EventBusSubscriptionToken = item as EventBusSubscriptionToken
		if token == null or not token.is_active:
			continue
		var mask_match: bool = ((token.category_mask & packet.category_mask) != 0) or token.category_mask == 0
		if mask_match and not seen.has(token):
			seen[token] = true
			targets.append(token)

## 即时同步分发因果事件，执行递归熔断与死循环拦截
func dispatch_now(packet: EventPacket) -> void:
	if packet == null:
		return
	if _dispatch_depth >= _max_depth:
		ErrorReporter.emit("event_bus2_reentrancy_guard", {"channel_id": packet.channel_id, "max_depth": _max_depth})
		return
	var depth: int = _dispatch_depth
	_dispatch_depth += 1
	if _dispatch_depth > _peak_dispatch_depth:
		_peak_dispatch_depth = _dispatch_depth
	_dispatched_count += 1
	_current_window_ops += 1
	if _enable_profiling and _current_window_ops >= _high_freq_threshold and not _is_warning_high_freq:
		_is_warning_high_freq = true
		ErrorReporter.emit("event_bus2_high_frequency_warning", {"ops": _current_window_ops, "threshold": _high_freq_threshold})

	_prepare_dispatch_scratch(depth)
	var targets: Array = _target_scratch[depth]
	var seen: Dictionary = _seen_scratch[depth]
	targets.clear()
	seen.clear()
	_sequence_counter += 1
	packet.event_id = _sequence_counter

	_collect_channel_subscribers(packet.channel_id, packet, seen, targets)
	if packet.channel_id != 0:
		_collect_channel_subscribers(0, packet, seen, targets)
	if packet.channel_id != EventChannelDefinition.DOMAIN_EVENT_GENERIC:
		if (packet.category_mask & EventCategoryMask.NARRATIVE_TEXT) != 0 or not packet.narrative_key.is_empty():
			_collect_channel_subscribers(EventChannelDefinition.DOMAIN_EVENT_GENERIC, packet, seen, targets)

	# 派发快照已在独立 targets 中，回调内增删订阅不影响本轮遍历（Inv-EB2-7）
	_dead_tokens_scratch.clear()
	for token in targets:
		if not token.is_active:
			continue
		if token.callback.is_valid():
			token.callback.call(packet)
		else:
			_dead_tokens_scratch.append(token)

	for dead_token in _dead_tokens_scratch:
		dead_token.is_active = false
		_unregister_token(dead_token)
	_dead_tokens_scratch.clear()

	targets.clear()
	seen.clear()
	_dispatch_depth = depth # 自愈式恢复：无论回调如何扰动计数，退出时锚定进入前快照

# ==============================================================================
# 原语 ②：enqueue_frame + flush_frame_events（帧级双缓冲合批）
# ==============================================================================

## 将事件包入帧缓冲队列（CORE_STATE 类别禁止延后入队，溢出时由总线统一回收）
func enqueue_frame(packet: EventPacket) -> bool:
	if packet == null:
		return false
	if (packet.category_mask & EventCategoryMask.CORE_STATE) != 0:
		ErrorReporter.emit("event_bus2_core_state_in_frame_queue", {"channel_id": packet.channel_id})
		return false
	_sequence_counter += 1
	packet.event_id = _sequence_counter
	_enqueued_count += 1
	var enqueued: bool = _ring_buffer.enqueue(packet)
	if not enqueued:
		_dropped_count += 1
		# 溢出安全回退：入队失败的包由总线统一回收（否则调用方遗漏 recycle 时包永久滞留池外）
		ErrorReporter.emit("event_bus2_frame_queue_overflow", {"channel_id": packet.channel_id, "dropped_total": _dropped_count})
		recycle_packet(packet)
	return enqueued

## 刷新并分发当前帧所有缓冲队列事件包
func flush_frame_events() -> int:
	return _ring_buffer.flush_frame(func(packet: EventPacket) -> void:
		dispatch_now(packet)
		recycle_packet(packet)
	)

# ==============================================================================
# 原语 ③：dispatch_spatial / dispatch_spatial_2d（空间AoI定向裁剪）
# ==============================================================================

## 按三维空间坐标与影响半径向 AoI 内侦听器定向派发事件
func dispatch_spatial(packet: EventPacket, origin: Vector3, radius: float) -> int:
	if packet == null:
		return 0
	_sequence_counter += 1
	packet.event_id = _sequence_counter
	packet.set_spatial_header(origin, radius)
	return _spatial_grid.dispatch_packet(packet)

## 按二维平面圆形范围向局部侦听器广播事件
func dispatch_spatial_2d(packet: EventPacket, origin_2d: Vector2, radius: float, is_isometric_xz: bool = false) -> int:
	if packet == null:
		return 0
	_sequence_counter += 1
	packet.event_id = _sequence_counter
	packet.set_spatial_header_2d(origin_2d, radius, is_isometric_xz)
	return _spatial_grid.dispatch_packet(packet)

# ==============================================================================
# 配置 Getters（供测试断言与遥测监控）
# ==============================================================================

## 获取空间网格单元大小（facade: 供测试断言与遥测监控）
func get_spatial_cell_size() -> float:
	return _spatial_grid.get_cell_size()

## 获取帧缓冲容量（facade: 供测试断言与遥测监控）
func get_frame_buffer_capacity() -> int:
	return _ring_buffer.capacity()

## 获取事件总线允许的最大递归嵌套分发深度
func get_max_dispatch_depth() -> int:
	return _max_depth

## 获取指定事件或对象的专用缓存池
func get_pool() -> EventPool:
	return _pool

# ==============================================================================
# 叙事/领域/日志迁正 API（自旧版 EventBus 同签名迁入，旧类退役后唯一真源）
# ==============================================================================

## 测试专用重置：清零记录序号并清空叙事表缓存（避免跨用例状态残留）
static func reset_sequence_for_test() -> void:
	_record_sequence_number = 0
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
static func render_narrative(template_key: String, args: Variant = []) -> String:
	var parts := template_key.split("/")
	if parts.is_empty():
		return template_key
	var table_name := "narratives." + parts[0]
	var path := "/".join(parts.slice(1))
	var template := GameConfig.get_string(table_name, path, template_key)
	return _format_template_safely(template, args)

## 辅助函数：安全格式化文案模板，优先匹配 {param} 命名占位符并注入参数
static func _format_template_safely(template: String, raw_args: Variant) -> String:
	if template.is_empty():
		return ""
	if raw_args == null:
		return template
	if raw_args is Dictionary:
		return TemplateFormatter.format(template, raw_args as Dictionary)
	if raw_args is Array:
		var args_array := raw_args as Array
		if args_array.is_empty():
			return template
		var param_keys := TemplateFormatter.extract_param_keys(template)
		if not param_keys.is_empty():
			var dict_params: Dictionary = {}
			for arg_index in range(mini(param_keys.size(), args_array.size())):
				dict_params[param_keys[arg_index]] = args_array[arg_index]
			return TemplateFormatter.format(template, dict_params)
		if "%" in template:
			return template % args_array
		return template
	return template

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
			var args: Variant = payload.get("args", [])
			return _format_template_safely(template, args)
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
func emit_narrative_by_key(template_key: String, category_key: String, args: Variant = [], meta: Dictionary = {}) -> void:
	emit_narrative(render_narrative(template_key, args), category_key, meta)

## 广播泛化领域事件：配置驱动信道对齐；结构化 payload 经对应信道派发；
## 能解析出文案时追加叙事派发（与旧总线两步语义一致）
func emit_domain_event(channel: String, payload: Dictionary = {}) -> void:
	var channel_def: int = resolve_channel_id(channel)
	var packet := borrow_packet(channel_def, EventCategoryMask.NARRATIVE_TEXT, payload)
	var packet_payload: Dictionary
	if payload.has("channel") and payload.has("payload"):
		packet_payload = payload
	else:
		packet_payload = {"channel": channel, "payload": payload}
		packet_payload.merge(payload)
	packet.payload_data = packet_payload
	packet.narrative_key = channel
	dispatch_now(packet)
	recycle_packet(packet)
	var text := render_domain_event_text(channel, payload)
	if not text.is_empty():
		emit_narrative(text, String(payload.get("category_key", "system")), payload)

## 广播结构化日志记录：统一入环 + 旁路导出 + 遥测聚合 + 控制台穿透（序号唯一签发，Inv-LG-3）
func emit_log_record(record: LogRecordDTO) -> void:
	if record == null:
		return
	_record_sequence_number += 1
	record.sequence = _record_sequence_number
	if record.timestamp_utc <= 0:
		record.timestamp_utc = int(Time.get_unix_time_from_system())
	if record.channel.is_empty():
		record.channel = LogConstants.CHANNEL_SYSTEM
	if not record.message.is_empty():
		record.message = StatisticsMathLib.scrub_inline_secrets(record.message)

	var structured_record: StructuredLogRecord
	if record is StructuredLogRecord:
		structured_record = record
	else:
		structured_record = StructuredLogRecord.from_dto(record.to_dto())
	if structured_record.trace_id.is_empty():
		var active_trace := LogCollector.get_active_trace_id()
		if not active_trace.is_empty():
			structured_record.trace_id = active_trace
		else:
			structured_record.trace_id = "%s_%s_%d" % [LogConstants.TRACE_PREFIX_DEFAULT, structured_record.channel, _record_sequence_number]

	var has_log_listeners: bool = _channel_routes.has(EventChannelDefinition.LOG_RECORD_POSTED) or _channel_routes.has(0) or _channel_routes.has(EventChannelDefinition.DOMAIN_EVENT_GENERIC)
	var packet := borrow_packet(EventChannelDefinition.LOG_RECORD_POSTED, EventCategoryMask.SYSTEM_TELEMETRY)
	packet.payload_dto = structured_record
	if has_log_listeners:
		packet.payload_data = structured_record.to_dto()
	packet.narrative_key = structured_record.message
	dispatch_now(packet)
	recycle_packet(packet)
	LogFileExporter.consume(structured_record)
	LogRingBuffer.append(structured_record)
	TelemetryAggregate.consume(structured_record)
	_dispatch_console_log(record)

static var _console_config_version: int = -1
static var _console_enabled_cached: bool = true
static var _console_min_rank_cached: int = 2

static func _ensure_console_log_cache() -> void:
	# 按配置重载版本缓存控制台阈值，避免每次发射日志均穿透读取 GameConfig 字典
	var config_version: int = GameConfig.config_reload_version()
	if _console_config_version == config_version:
		return
	var console_config: Dictionary = GameConfig.get_dict(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_CONSOLE, {})
	_console_enabled_cached = bool(console_config.get("enabled", true))
	var min_level: String = str(console_config.get("min_level", LogConstants.LEVEL_LOWER_WARN)).to_lower()
	_console_min_rank_cached = LogConstants.level_rank(min_level)
	_console_config_version = config_version

## 控制台标准输出穿透分发（受 log.json/console 配置驱动，保障构建与排查端可见性）
func _dispatch_console_log(record: LogRecordDTO) -> void:
	if record == null:
		return
	if bool(record.context.get(LogConstants.KEY_MUTE_CONSOLE, false)):
		return
	_ensure_console_log_cache()
	if not _console_enabled_cached:
		return
	if LogConstants.level_rank(record.level) < _console_min_rank_cached:
		return
	var detail := str(record.context.get(LogConstants.KEY_DIAGNOSTIC_DETAIL, "")) if record.context.has(LogConstants.KEY_DIAGNOSTIC_DETAIL) else ""
	var formatted := SystemBaseMessages.format_console_line(record.level, record.channel, record.message, record.error_code, detail)
	if LogConstants.is_critical_level(record.level):
		printerr(formatted)
	else:
		print_rich(formatted)

## 便捷日志入口：按 level_key + 原文直构 StructuredLogRecord，免除中间 DTO 二次深拷贝
func emit_log(level_key: String, message: String, channel: String = LogConstants.CHANNEL_SYSTEM) -> void:
	var record := StructuredLogRecord.new()
	record.level = level_key
	record.message = message
	record.channel = channel
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
## 自动支持整型信道常量与配置驱动的字符串名称
func on_channel(channel_id: Variant, callback: Callable) -> EventBusSubscriptionToken:
	var resolved_id: int = resolve_channel_id(channel_id)
	return subscribe(resolved_id, EventCategoryMask.MASK_ALL, callback)

# ==============================================================================
# 遥测监控与性能度量 API
# ==============================================================================

## 获取当前运行时的性能遥测快照
func get_metrics_snapshot() -> Dictionary:
	return {
		"dispatched_count": _dispatched_count,
		"enqueued_count": _enqueued_count,
		"dropped_count": _dropped_count,
		"peak_dispatch_depth": _peak_dispatch_depth,
		"current_window_ops": _current_window_ops,
		"pool_borrowed": _pool.get_borrowed_count() if _pool != null else 0,
		"pool_free": _pool.get_free_count() if _pool != null else 0,
		"pool_peak": _pool.get_peak_borrowed_count() if _pool != null else 0,
		"ring_buffer_size": _ring_buffer.size() if _ring_buffer != null else 0,
		"spatial_listener_count": _spatial_grid.get_listener_count() if _spatial_grid != null else 0
	}

## 重置吞吐指标（供性能测试与周期清算）
func reset_metrics() -> void:
	_dispatched_count = 0
	_enqueued_count = 0
	_dropped_count = 0
	_peak_dispatch_depth = 0
	_current_window_ops = 0
	_is_warning_high_freq = false
	if _pool != null:
		_pool.reset_metrics()
