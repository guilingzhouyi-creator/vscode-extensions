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
	prev_slice: AgentHudContextSliceDTO,
	next_slice: AgentHudContextSliceDTO,
	out_deltas: Array[HudCausalDeltaDTO],
	cause: String = "",
	initiator: String = "SYSTEM_TICK_SIMULATION",
	reason: String = ""
) -> void:
	var write_idx: int = 0
	if prev_slice == null or next_slice == null:
		_trim_and_recycle(out_deltas, 0)
		return

	# 1. 生理体能差分 (HP & AP)
	if not is_equal_approx(prev_slice.hp_current, next_slice.hp_current):
		_populate_delta(out_deltas, write_idx, "PHYSIOLOGY", "hp_current", prev_slice.hp_current, next_slice.hp_current, cause, initiator, reason)
		write_idx += 1

	if not is_equal_approx(prev_slice.ap_current, next_slice.ap_current):
		_populate_delta(out_deltas, write_idx, "PHYSIOLOGY", "ap_current", prev_slice.ap_current, next_slice.ap_current, cause, initiator, reason)
		write_idx += 1

	# 2. 资产与潜能成长差分
	if prev_slice.wallet_gold != next_slice.wallet_gold:
		_populate_delta(out_deltas, write_idx, "WALLET", "wallet_gold", prev_slice.wallet_gold, next_slice.wallet_gold, cause, initiator, reason)
		write_idx += 1

	if prev_slice.unallocated_potential_points != next_slice.unallocated_potential_points:
		_populate_delta(out_deltas, write_idx, "ASSET", "unallocated_points", prev_slice.unallocated_potential_points, next_slice.unallocated_potential_points, cause, initiator, reason)
		write_idx += 1

	# 3. 历法时钟时相差分
	if prev_slice.day_phase_key != next_slice.day_phase_key:
		_populate_delta(out_deltas, write_idx, "CALENDAR", "day_phase_key", prev_slice.day_phase_key, next_slice.day_phase_key, cause, initiator, reason)
		write_idx += 1

	_trim_and_recycle(out_deltas, write_idx)

## 计算前后观测切片的结构化因果差分（兼容旧接口）
static func compute_deltas(
	prev_slice: AgentHudContextSliceDTO,
	next_slice: AgentHudContextSliceDTO,
	cause: String = "",
	initiator: String = "SYSTEM_TICK_SIMULATION",
	reason: String = ""
) -> Array[HudCausalDeltaDTO]:
	var deltas: Array[HudCausalDeltaDTO] = []
	if prev_slice == null or next_slice == null:
		return deltas
	compute_deltas_into(prev_slice, next_slice, deltas, cause, initiator, reason)
	return deltas

static func _populate_delta(
	deltas: Array[HudCausalDeltaDTO],
	index: int,
	cat: String,
	field: String,
	prev_v: Variant,
	curr_v: Variant,
	cause: String,
	initiator: String,
	reason: String
) -> void:
	while deltas.size() <= index:
		deltas.append(AgentTelemetryPoolRegistry.borrow_delta())
	var d := deltas[index]
	d.reset_state()
	d.delta_category = cat
	d.target_field = field
	d.previous_value = prev_v
	d.current_value = curr_v

	if (prev_v is float or prev_v is int) and (curr_v is float or curr_v is int):
		d.delta_amount = float(curr_v) - float(prev_v)
	else:
		d.delta_amount = 0.0

	d.cause_identifier = cause
	d.initiator = initiator
	d.reason = reason

static func _trim_and_recycle(deltas: Array[HudCausalDeltaDTO], target_size: int) -> void:
	while deltas.size() > target_size:
		var extra: HudCausalDeltaDTO = deltas.pop_back()
		AgentTelemetryPoolRegistry.recycle_delta(extra)
