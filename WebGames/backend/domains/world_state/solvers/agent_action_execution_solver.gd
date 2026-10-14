# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/solvers/agent_action_execution_solver.gd
# 架构定位: Domain Solver / Action Dispatch & Execution Oracle
# 依赖与触发: 上游: AgentActionPacketDTO | 下游: AuthoritativeHudSnapshotDTO, HomeActionSpaceSolver | 配置: config/domains/world_state/core.json
# 职责说明: 面向 Agent 的动作校验与前置派发求解器。
#           执行指令白名单校验、前置条件动态判定、人类操作抢占阻断与无头领域服务直投。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎施工细则 (Inv-ACTION-ORACLE-6, Inv-HUMAN-PREEMPTION-SOLVER-7)
# ==============================================================================

## AgentActionExecutionSolver：Domain Solver / Action Dispatch & Execution Oracle
class_name AgentActionExecutionSolver
extends RefCounted

## 校验并执行来自专属动作通道的 AgentActionPacketDTO
static func validate_and_execute(
	action_pkt: AgentActionPacketDTO,
	snapshot: AuthoritativeHudSnapshotDTO,
	is_human_lease_active: bool = false
) -> Dictionary:
	if action_pkt == null:
		return {
			"success": false,
			"error_code": "ERR_NULL_ACTION_PACKET",
			"cause": ""
		}

	var d_id: String = _extract_directive_id(action_pkt)
	if d_id.is_empty():
		return {
			"success": false,
			"error_code": "ERR_EMPTY_DIRECTIVE",
			"cause": ""
		}

	# 0. 人类操作最高权威防御守卫 (Inv-HUMAN-PREEMPTION-SOLVER-7)
	if is_human_lease_active:
		return {
			"success": false,
			"error_code": "ERR_PREEMPTED_BY_HUMAN",
			"cause": ""
		}

	# 1. 获取当前合法的动态行动空间
	var action_space := HomeActionSpaceSolver.resolve_action_space(snapshot, is_human_lease_active)
	var target_directive: AgentActionDirectiveDTO = null
	for d in action_space:
		if d.directive_id == d_id:
			target_directive = d
			break

	# 2. 检查指令是否在合法值域内 (Inv-ACTION-ORACLE-6)
	if target_directive == null:
		return {
			"success": false,
			"error_code": "ERR_UNKNOWN_OR_UNEXPOSED_DIRECTIVE",
			"cause": ""
		}

	# 3. 检查指令前置条件是否满足
	if not target_directive.is_executable:
		var blocked: String = target_directive.blocked_reason
		return {
			"success": false,
			"error_code": blocked if not blocked.is_empty() else "ERR_DIRECTIVE_BLOCKED",
			"cause": ""
		}

	# 4. 路由派发至对应领域用例 (纯无头逻辑调用，零UI依赖)
	return _dispatch_domain_execution(d_id, action_pkt, snapshot)

static func _extract_directive_id(pkt: AgentActionPacketDTO) -> String:
	if not pkt.directive_id.is_empty():
		return pkt.directive_id
	if not pkt.action_id.is_empty():
		return pkt.action_id
	return ""

static func _extract_params(pkt: AgentActionPacketDTO) -> Dictionary:
	if not pkt.params.is_empty():
		return pkt.params
	if not pkt.parameters.is_empty():
		return pkt.parameters
	return {}

static func _dispatch_domain_execution(
	directive_id: String,
	action_pkt: AgentActionPacketDTO,
	snapshot: AuthoritativeHudSnapshotDTO
) -> Dictionary:
	var params := _extract_params(action_pkt)

	match directive_id:
		"ALLOCATE_POTENTIAL_STAT", "ALLOCATE_POTENTIAL":
			var stat: String = str(params.get("stat_target", params.get("attribute", "STR")))
			var pts: int = int(params.get("points", params.get("amount", 1)))
			if stat.is_empty() or pts <= 0 or snapshot.unallocated_potential_points < pts:
				return {
					"success": false,
					"error_code": "ERR_INVALID_STAT_PARAMS",
					"cause": ""
				}
			snapshot.unallocated_potential_points -= pts
			var curr_val: float = float(snapshot.attribute_values.get(stat, 10.0))
			snapshot.attribute_values[stat] = curr_val + float(pts)
			return {
				"success": true,
				"error_code": "",
				"cause": "AGENT_POTENTIAL_ALLOCATION"
			}

		"REST_AND_ADVANCE_TIME", "REST_INN":
			snapshot.ap_current = snapshot.ap_max
			snapshot.hp_current = snapshot.hp_max
			if snapshot.calendar_env != null:
				snapshot.calendar_env.day_phase_key = "NOON" if snapshot.calendar_env.day_phase_key == "DAWN" else "DUSK"
			return {
				"success": true,
				"error_code": "",
				"cause": "AGENT_REST_ACTION"
			}

		"CLAIM_QUEST_OBJECTIVE":
			if snapshot.quest_tracker != null:
				snapshot.quest_tracker.is_completable = false
				snapshot.wallet_gold += 100
			return {
				"success": true,
				"error_code": "",
				"cause": "AGENT_CLAIM_QUEST"
			}

		"INSPECT_INVENTORY_SLOT":
			return {
				"success": true,
				"error_code": "",
				"cause": "AGENT_INSPECT_INVENTORY"
			}

		"TOGGLE_MODE_ADAPTATION":
			return {
				"success": true,
				"error_code": "",
				"cause": "AGENT_TOGGLE_MODE"
			}

		"MARK_MAIL_READ":
			snapshot.unread_mail_count = maxi(0, snapshot.unread_mail_count - 1)
			return {
				"success": true,
				"error_code": "",
				"cause": "AGENT_READ_MAIL"
			}

		"DISMISS_UI_NOTICE", "DISMISS_NOTICE":
			var notice_id: String = str(params.get("notice_id", "default_notice"))
			return {
				"success": true,
				"error_code": "",
				"cause": "AGENT_DISMISS_UI_NOTICE:%s" % notice_id
			}

		_:
			return {
				"success": false,
				"error_code": "ERR_UNHANDLED_DIRECTIVE",
				"cause": ""
			}

