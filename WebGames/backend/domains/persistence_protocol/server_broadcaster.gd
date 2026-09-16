# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/server_broadcaster.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 权威状态帧封包、时序编号推进与消息总线广播。 广播文案由 config/narratives/persistence.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ServerAuthoritativeBroadcaster extends RefCounted

## 权威状态帧广播：封包 + 时序推进 + 消息总线广播
static func broadcast_authoritative_frame(
	server_tick: int,
	ack_seq: int,
	world_state: Dictionary
) -> KalarSaveSchema.ServerEventPacket:
	var packet := KalarSaveSchema.ServerEventPacket.new()
	packet.server_frame_tick = server_tick
	packet.acknowledged_sequence_number = ack_seq
	packet.authoritative_state = world_state

	EventBusCore.get_instance().emit_narrative_by_key(
		"persistence/frame_broadcast", "network", [server_tick, ack_seq]
	)
	return packet
