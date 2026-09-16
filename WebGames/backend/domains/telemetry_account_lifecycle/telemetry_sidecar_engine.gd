# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/telemetry_account_lifecycle/telemetry_sidecar_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/telemetry_account_lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 异步无感记录埋点事件、环形缓冲区 (Ring Buffer) 溢出保护与批量刷盘提取
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name TelemetrySidecarEngine
extends RefCounted

var _event_ring_buffer: Array = []
var max_buffer_capacity: int = GameConfig.get_int("domains.telemetry_account_lifecycle", "buffer/max_capacity", 1000)

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

	_event_ring_buffer.append(evt)
	if _event_ring_buffer.size() > max_buffer_capacity:
		_event_ring_buffer.pop_front() # 环形缓冲区溢出自动丢弃最旧项

	return evt

## 批量提取：整批复制后清空缓冲（刷盘供上游消费）
func flush_events_batch() -> Array:
	var batch = _event_ring_buffer.duplicate()
	_event_ring_buffer.clear()
	return batch

## 当前缓冲内事件数
func get_buffer_count() -> int:
	return _event_ring_buffer.size()

# ==============================================================================
# 配置读取
# ==============================================================================

static func _salt_modulus() -> int:
	# L1（Phase 55）：取模除数下限守卫（Inv-VD-1）——配置 0 时 % 除零崩溃
	#（对照 deterministic_replay_engine.gd:32 maxi(1,…) 惯例）
	return maxi(1, GameConfig.get_int("domains.telemetry_account_lifecycle", "event_id/salt_modulus", 10000))
