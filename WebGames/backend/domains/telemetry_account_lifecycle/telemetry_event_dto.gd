# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/telemetry_account_lifecycle/telemetry_event_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/telemetry_account_lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 封装遥测埋点事件 UUID、生命周期阶段、会话时长与自定义多维属性
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name TelemetryEventDTO
extends RefCounted

var event_id: String = ""                        # 事件唯一 UUID
var event_name: String = ""                      # 如 "ACCOUNT_LOGIN_SUCCESS"
var account_id: String = ""                      # 关联账户 ID
var character_id: String = ""                    # 关联角色 ID
var timestamp_utc: int = 0                       # 事件发生时间戳 (UTC)
var session_duration_seconds: float = 0.0        # 本次会话已持续时长
var payload_attributes: Dictionary = {}          # 自定义多维指标 (客户端版本、设备类型等)

## 遥测事件 DTO 构造（ID/名称/账户/时间/时长/多维属性）
func _init(
	p_id: String = "",
	p_name: String = "",
	p_account: String = "",
	p_time: int = 0,
	p_duration: float = 0.0,
	p_payload: Dictionary = {}
) -> void:
	event_id = p_id
	event_name = p_name
	account_id = p_account
	timestamp_utc = p_time
	session_duration_seconds = p_duration
	payload_attributes = p_payload
