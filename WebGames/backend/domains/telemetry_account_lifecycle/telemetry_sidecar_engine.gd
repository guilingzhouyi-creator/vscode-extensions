# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/telemetry_account_lifecycle/telemetry_sidecar_engine.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/telemetry_account_lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 异步无感记录埋点事件、环形缓冲区 (Ring Buffer) 溢出保护与批量刷盘提取
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## TelemetrySidecarEngine：Domain Logic Component
class_name TelemetrySidecarEngine
extends RefCounted

var _event_ring_buffer: Array = []
var _ring_head: int = 0
var _ring_count: int = 0
var max_buffer_capacity: int = GameConfig.get_int("domains.telemetry_account_lifecycle", "buffer/max_capacity", 1000)

static var _salt_mod_cached: int = 10000
static var _salt_cfg_ver: int = -1

## 记录埋点事件：确定性事件 ID（账号+UTC+盐模）+ 环形缓冲入队（溢出丢最旧）
func record_event(
	event_name: String,
	account_id: String,
	payload: Dictionary = {},
	current_utc: int = 0,
	session_duration: float = 0.0
) -> TelemetryEventDTO:
	var salt := int(abs(("%s:%d:%s" % [account_id, current_utc, event_name]).hash())) % _salt_modulus()
	var evt_id := "%s_%d_%d" % [account_id, current_utc, salt]
	var evt := TelemetryEventDTO.new(evt_id, event_name, account_id, current_utc, session_duration, payload)

	var cap: int = maxi(0, max_buffer_capacity)
	if cap == 0:
		_event_ring_buffer.clear()
		_ring_head = 0
		_ring_count = 0
		return evt
	if _event_ring_buffer.size() > cap:
		var trimmed: Array = flush_events_batch()
		var keep_start: int = maxi(0, trimmed.size() - cap)
		for idx in range(keep_start, trimmed.size()):
			_event_ring_buffer.append(trimmed[idx])
		_ring_head = 0
		_ring_count = _event_ring_buffer.size()
	if _ring_count < cap:
		if _event_ring_buffer.size() < cap and _ring_head == 0:
			_event_ring_buffer.append(evt)
		else:
			if _event_ring_buffer.size() < cap:
				_event_ring_buffer.resize(cap)
			_event_ring_buffer[(_ring_head + _ring_count) % cap] = evt
		_ring_count += 1
	else:
		_event_ring_buffer[_ring_head] = evt
		_ring_head = (_ring_head + 1) % cap

	return evt

## 批量提取：整批复制后清空缓冲（刷盘供上游消费）
func flush_events_batch() -> Array:
	var batch: Array = []
	var buf_size: int = _event_ring_buffer.size()
	if _ring_count > 0 and buf_size > 0:
		batch.resize(_ring_count)
		for i in range(_ring_count):
			batch[i] = _event_ring_buffer[(_ring_head + i) % buf_size]
	_event_ring_buffer.clear()
	_ring_head = 0
	_ring_count = 0
	return batch

## 当前缓冲内事件数
func get_buffer_count() -> int:
	return _ring_count

# ==============================================================================
# 配置读取
# ==============================================================================

static func _salt_modulus() -> int:
	var ver: int = GameConfig.config_reload_version()
	if _salt_cfg_ver != ver:
		# L1（）：取模除数下限守卫（Inv-VD-1）——配置 0 时 % 除零崩溃
		_salt_mod_cached = maxi(1, GameConfig.get_int("domains.telemetry_account_lifecycle", "event_id/salt_modulus", 10000))
		_salt_cfg_ver = ver
	return _salt_mod_cached
