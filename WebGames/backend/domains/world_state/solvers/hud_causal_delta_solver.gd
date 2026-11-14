# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/solvers/hud_causal_delta_solver.gd
# 架构定位: Domain Solver / Causal Delta Comparator
# 依赖与触发: 上游: AgentHudContextSliceDTO | 下游: HudCausalDeltaDTO, AgentTelemetryPoolRegistry | 配置: config/domains/world_state/core.json
# 职责说明: 主页 HUD 上下文因果差分计算器。
#           执行前后切片的生理、资产与环境历法差分提取，支持原位注入与对象池借还复用。
# 退出语义与设计依据: 因果差分与深度对象池守恒规范 (Inv-DELTA-INITIATOR-PROPAGATION-8, Inv-INPLACE-INJECTION-1)
# ==============================================================================

## HudCausalDeltaSolver：Domain Solver / Causal Delta Comparator
class_name HudCausalDeltaSolver
extends RefCounted

const AgentTelemetryPoolRegistry = preload("res://backend/domains/world_state/services/agent_telemetry_pool_registry.gd")
const HudCausalDeltaDTO = preload("res://backend/domains/world_state/dto/hud_causal_delta_dto.gd")
const AgentHudContextSliceDTO = preload("res://backend/domains/world_state/dto/agent_hud_context_slice_dto.gd")

## 原位注入因果差分数组（借还守恒，零堆分配）
static func compute_deltas_into(
	previous_slice: AgentHudContextSliceDTO,
	next_slice: AgentHudContextSliceDTO,
	target_deltas: Array[HudCausalDeltaDTO],
	cause: String = "",
	initiator: String = "SYSTEM_TICK_SIMULATION",
	reason: String = ""
) -> void:
	var write_index: int = 0
	if previous_slice == null or next_slice == null:
		_trim_and_recycle(target_deltas, 0)
		return

	# 1. 生理体能差分 (HP & AP)
	if not is_equal_approx(previous_slice.hp_current, next_slice.hp_current):
		_populate_delta(target_deltas, write_index, "PHYSIOLOGY", "hp_current", previous_slice.hp_current, next_slice.hp_current, cause, initiator, reason)
		write_index += 1

	if not is_equal_approx(previous_slice.ap_current, next_slice.ap_current):
		_populate_delta(target_deltas, write_index, "PHYSIOLOGY", "ap_current", previous_slice.ap_current, next_slice.ap_current, cause, initiator, reason)
		write_index += 1

	# 2. 资产与潜能成长差分
	if previous_slice.wallet_gold != next_slice.wallet_gold:
		_populate_delta(target_deltas, write_index, "WALLET", "wallet_gold", previous_slice.wallet_gold, next_slice.wallet_gold, cause, initiator, reason)
		write_index += 1

	if previous_slice.unallocated_potential_points != next_slice.unallocated_potential_points:
		_populate_delta(target_deltas, write_index, "ASSET", "unallocated_points", previous_slice.unallocated_potential_points, next_slice.unallocated_potential_points, cause, initiator, reason)
		write_index += 1

	# 3. 历法时钟时相差分
	if previous_slice.day_phase_key != next_slice.day_phase_key:
		_populate_delta(target_deltas, write_index, "CALENDAR", "day_phase_key", previous_slice.day_phase_key, next_slice.day_phase_key, cause, initiator, reason)
		write_index += 1

	_trim_and_recycle(target_deltas, write_index)

## 计算前后观测切片的结构化因果差分（兼容旧接口）
static func compute_deltas(
	previous_slice: AgentHudContextSliceDTO,
	next_slice: AgentHudContextSliceDTO,
	cause: String = "",
	initiator: String = "SYSTEM_TICK_SIMULATION",
	reason: String = ""
) -> Array[HudCausalDeltaDTO]:
	var deltas: Array[HudCausalDeltaDTO] = []
	if previous_slice == null or next_slice == null:
		return deltas
	compute_deltas_into(previous_slice, next_slice, deltas, cause, initiator, reason)
	return deltas

static func _populate_delta(
	deltas: Array[HudCausalDeltaDTO],
	index: int,
	delta_category: String,
	target_field: String,
	previous_value: Variant,
	current_value: Variant,
	cause: String,
	initiator: String,
	reason: String
) -> void:
	while deltas.size() <= index:
		deltas.append(AgentTelemetryPoolRegistry.borrow_delta())
	var delta := deltas[index]
	delta.reset_state()
	delta.delta_category = delta_category
	delta.target_field = target_field
	delta.previous_value = previous_value
	delta.current_value = current_value

	if (previous_value is float or previous_value is int) and (current_value is float or current_value is int):
		delta.delta_amount = float(current_value) - float(previous_value)
	else:
		delta.delta_amount = 0.0

	delta.cause_identifier = cause
	delta.initiator = initiator
	delta.reason = reason

static func _trim_and_recycle(deltas: Array[HudCausalDeltaDTO], target_size: int) -> void:
	while deltas.size() > target_size:
		var extra: HudCausalDeltaDTO = deltas.pop_back()
		AgentTelemetryPoolRegistry.recycle_delta(extra)
