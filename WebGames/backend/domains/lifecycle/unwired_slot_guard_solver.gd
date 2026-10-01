# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/unwired_slot_guard_solver.gd
# 架构定位: Stateless Domain Solver
# 跨域依赖: 纯算法无状态求解器，零跨域依赖
# 职责说明: 校验插槽数据有效性并拦截未接线占位，杜绝默认值静默伪造绑定
# 设计依据: 业务域第一性原理 / 零静默默认值绑定契约
# ==============================================================================

class_name UnwiredSlotGuardSolver
extends RefCounted

const SENTINEL_CONFIG_TABLE: String = "infrastructure.lifecycle"
const SENTINEL_CONFIG_PATH: String = "shutdown_hooks/unwired_slot_sentinel"

static func _get_unbound_sentinel() -> String:
	return GameConfig.get_string(SENTINEL_CONFIG_TABLE, SENTINEL_CONFIG_PATH, "")

static func validate_slots(payload: Dictionary, required_slots: Array[String]) -> Dictionary:
	var sentinel: String = _get_unbound_sentinel()
	if sentinel.is_empty():
		return {"valid": false, "error_code": "INVALID_UNBOUND_SENTINEL_CONFIG", "unwired_slot": "UNBOUND_SENTINEL"}
	for slot in required_slots:
		var val: Variant = payload.get(slot, null)
		if val == null or (val is String and (val.is_empty() or val == sentinel)):
			return {
				"valid": false,
				"error_code": "UNBOUND_" + slot.to_upper(),
				"unwired_slot": slot
			}
	return {"valid": true, "error_code": "", "unwired_slot": ""}

static func detect_unwired_slots(payload: Dictionary, candidate_slots: Array[String]) -> Array[String]:
	var unwired: Array[String] = []
	var sentinel: String = _get_unbound_sentinel()
	if sentinel.is_empty():
		return candidate_slots.duplicate()
	for slot in candidate_slots:
		var val: Variant = payload.get(slot, null)
		if val == null:
			unwired.append(slot)
		elif val is String and (String(val).is_empty() or String(val) == sentinel):
			unwired.append(slot)
	return unwired
