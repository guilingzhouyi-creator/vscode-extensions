# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/server_event_packet.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: PersistenceAndReconciliationSolver, ServerAuthoritativeBroadcaster | 下游: GameConfig
# 职责说明: 服务端事件数据包实体，承载帧刻度、确认序号与权威状态载荷。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
## ServerEventPacket：服务端事件数据包实体，承载帧刻度、确认序号与权威状态载荷。
class_name ServerEventPacket
extends RefCounted

var server_frame_tick: int = 0
var acknowledged_sequence_number: int = 0
var event_type: String = GameConfig.get_string(
	"infrastructure.persistence",
	"event_defaults/event_type",
	"STATE_UPDATE"
)
var authoritative_state: Dictionary = {}
