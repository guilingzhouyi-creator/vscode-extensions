# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/reconciliation_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 权威帧与未确认客户端输入队列预测调和算法 (Reconciliation)。 默认状态/默认动作由 config/persistence.json 的 reconciliation 段驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name PersistenceAndReconciliationSolver extends RefCounted

## 帧同步预测调和求解器 (Client Prediction Reconciliation)
static func reconcile_client_state(
	authoritative_server_packet: KalarSaveSchema.ServerEventPacket,
	pending_input_queue: Array
) -> Dictionary:
	var base_hp: float = authoritative_server_packet.authoritative_state.get("hp", GameConfig.get_float("infrastructure.persistence", "reconciliation/default_hp", 100.0))
	var base_ap: int = authoritative_server_packet.authoritative_state.get("ap", GameConfig.get_int("infrastructure.persistence", "reconciliation/default_ap", 0))
	var ack_seq = authoritative_server_packet.acknowledged_sequence_number

	# 剔除已确认指令，保留未确认指令
	var remaining_unacked: Array = []
	for cmd in pending_input_queue:
		if cmd.sequence_number > ack_seq:
			remaining_unacked.append(cmd)

	# 重放未确认指令
	var predicted_hp = base_hp
	var predicted_ap = base_ap
	var default_verb := GameConfig.get_string("infrastructure.persistence", "reconciliation/default_verb", "SLASH")
	var base_ap_fallback := GameConfig.get_int("infrastructure.persistence", "reconciliation/base_ap_fallback", -2)
	for cmd in remaining_unacked:
		var verb = cmd.payload.get("verb", default_verb)
		var verb_info = PhysicalVerbRegistry.get_verb(verb)
		predicted_ap += int(verb_info.get("base_ap", base_ap_fallback))

	return {
		"reconciled_hp": predicted_hp,
		"reconciled_ap": predicted_ap,
		"remaining_unacked_count": remaining_unacked.size(),
		"replayed_commands": remaining_unacked
	}
