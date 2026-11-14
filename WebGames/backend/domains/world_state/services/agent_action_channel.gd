# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/agent_action_channel.gd
# 架构定位: Domain Service / Dedicated Action Ingestion Channel
# 依赖与触发: 上游: LLM / 决策客户端 | 下游: AuthoritativeHudSyncService, AgentActionExecutionSolver | 配置: config/domains/world_state/core.json
# 职责说明: 面向 Agent 的专属逻辑动作通道服务。
#           执行人类租约探针守卫、零硬件冲突动作派发、前置条件判定与状态突变后标准遥测包广播。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双通道适配引擎设计规范 (Inv-ACTION-CHANNEL-ZERO-CONFLICT-5, Inv-HUMAN-LEASE-TIME-WINDOW-6)
# ==============================================================================

## AgentActionChannel：Domain Service / Dedicated Action Ingestion Channel
class_name AgentActionChannel
extends RefCounted

const AgentTelemetryPoolRegistry = preload("res://backend/domains/world_state/services/agent_telemetry_pool_registry.gd")

## 接收 AgentActionPacketDTO 并完成动作派发，零硬件冲突直投后端用例
static func dispatch_action(action_packet: AgentActionPacketDTO, context: Dictionary = {}) -> Dictionary:
	if action_packet == null:
		return {
			"success": false,
			"error_code": "ERR_NULL_ACTION_PACKET",
			"next_packet": null
		}

	# 1. 探针检查人类操作抢占租约锁 (Inv-HUMAN-LEASE-TIME-WINDOW-6)
	var is_human_active: bool = AuthoritativeHudSyncService.is_human_interacting()

	var snapshot: AuthoritativeHudSnapshotDTO = AuthoritativeHudSyncService.get_authoritative_snapshot(context)
	var execution_result: Dictionary = AgentActionExecutionSolver.validate_and_execute(action_packet, snapshot, is_human_active)

	if not bool(execution_result.get("success", false)):
		return {
			"success": false,
			"error_code": str(execution_result.get("error_code", "EXECUTION_REJECTED")),
			"next_packet": null
		}

	# 2. 动作执行成功后，派生最新遥测数据包并向伴侣总线广播，出口序列化后回收对象树
	var cause: String = str(execution_result.get("cause", "AGENT_ACTION"))
	var next_packet: AgentHudTelemetryPacketDTO = AgentHudSliceSolver.assemble_telemetry_packet(
		snapshot,
		null,
		action_packet.sequence_index + 1,
		cause,
		false,
		"AGENT_ACTION_CHANNEL"
	)

	AuthoritativeHudSyncService.publish_agent_telemetry_packet(next_packet)
	var serialized_packet: Dictionary = next_packet.to_dto()
	AgentTelemetryPoolRegistry.recycle_packet_tree(next_packet)

	return {
		"success": true,
		"error_code": "",
		"cause": cause,
		"next_packet": serialized_packet
	}
