# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/persistence_and_reconciliation_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 权威帧与未确认客户端输入队列预测调和算法 (Reconciliation)。 默认状态/默认动作由 config/persistence.json 的 reconciliation 段驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## PersistenceAndReconciliationSolver：Headless Discrete Solver / Numerical Calculator
class_name PersistenceAndReconciliationSolver extends RefCounted

## 帧同步预测调和求解器 (Client Prediction Reconciliation)
static func reconcile_client_state(
	authoritative_server_packet: ServerEventPacket,
	pending_input_queue: Array
) -> Dictionary:
	var base_health_points: float = authoritative_server_packet.authoritative_state.get("hp", GameConfig.get_float("infrastructure.persistence", "reconciliation/default_hp", 100.0))
	var base_action_points: int = authoritative_server_packet.authoritative_state.get("ap", GameConfig.get_int("infrastructure.persistence", "reconciliation/default_ap", 0))
	var acknowledged_sequence: Variant = authoritative_server_packet.acknowledged_sequence_number

	# 剔除已确认指令，保留未确认指令
	var unacknowledged_commands: Array = []
	for command in pending_input_queue:
		if command.sequence_number > acknowledged_sequence:
			unacknowledged_commands.append(command)

	# 重放未确认指令
	var predicted_health_points := base_health_points
	var predicted_action_points := base_action_points
	var default_verb := GameConfig.get_string("infrastructure.persistence", "reconciliation/default_verb", "SLASH")
	var fallback_action_points := GameConfig.get_int("infrastructure.persistence", "reconciliation/base_ap_fallback", -2)
	for command in unacknowledged_commands:
		var verb: Variant = command.payload.get("verb", default_verb)
		var verb_definition: Variant = PhysicalVerbRegistry.get_verb(verb)
		predicted_action_points += int(verb_definition.get("base_ap", fallback_action_points))

	return {
		"reconciled_hp": predicted_health_points,
		"reconciled_ap": predicted_action_points,
		"remaining_unacked_count": unacknowledged_commands.size(),
		"replayed_commands": unacknowledged_commands
	}
