# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/solvers/home_action_space_solver.gd
# 架构定位: Domain Solver / Dynamic Action Space Arbiter
# 依赖与触发: 上游: AuthoritativeHudSnapshotDTO | 下游: AgentActionDirectiveDTO, AgentTelemetryPoolRegistry | 配置: config/domains/world_state/core.json
# 职责说明: 面向 Agent 的主页 HUD 动态行动空间裁决器。
#           执行潜能/AP/任务/模式前置条件动态判定与人类前台操作抢占置灰剪枝，支持原位注入与对象池借还复用。
# 退出语义与设计依据: 动态行动空间与深度对象池规范 (Inv-DETERMINISTIC-PRUNING-5, Inv-HUMAN-PREEMPTION-SOLVER-7, Inv-INPLACE-INJECTION-1)
# ==============================================================================

## HomeActionSpaceSolver：Domain Solver / Dynamic Action Space Arbiter
class_name HomeActionSpaceSolver
extends RefCounted

const AgentTelemetryPoolRegistry = preload("res://backend/domains/world_state/services/agent_telemetry_pool_registry.gd")
const AgentActionDirectiveDTO = preload("res://backend/domains/world_state/dto/agent_action_directive_dto.gd")

const STATIC_DIR_SPECS: Array[Dictionary] = [
	{
		"id": "ALLOCATE_POTENTIAL_STAT",
		"domain": "ASSET",
		"desc": "分配潜能点",
		"cost": {"potential_points": 1},
		"pre": {"unallocated_points_min": 1},
		"params": {"stat_target": ["STR", "AGI", "INT", "STA"]}
	},
	{
		"id": "REST_AND_ADVANCE_TIME",
		"domain": "RETENTION",
		"desc": "休息推时",
		"cost": {"ap": 2.0},
		"pre": {"ap_min": 2.0},
		"params": {}
	},
	{
		"id": "CLAIM_QUEST_OBJECTIVE",
		"domain": "ACTION",
		"desc": "领任务报酬",
		"cost": {},
		"pre": {"quest_completable": true},
		"params": {}
	},
	{
		"id": "INSPECT_INVENTORY_SLOT",
		"domain": "ASSET",
		"desc": "查验背包",
		"cost": {},
		"pre": {},
		"params": {}
	},
	{
		"id": "TOGGLE_MODE_ADAPTATION",
		"domain": "META",
		"desc": "切换模式",
		"cost": {},
		"pre": {},
		"params": {}
	},
	{
		"id": "MARK_MAIL_READ",
		"domain": "RETENTION",
		"desc": "查阅信件",
		"cost": {},
		"pre": {"unread_mail_min": 1},
		"params": {}
	}
]

## 原位填充动态行动空间（借还守恒，零堆分配）
static func resolve_action_space_into(
	snapshot: AuthoritativeHudSnapshotDTO,
	out_actions: Array[AgentActionDirectiveDTO],
	human_interacting: bool = false
) -> void:
	if snapshot == null:
		out_actions.clear()
		return

	# 保证槽位数正好与静态指令数对齐
	while out_actions.size() < STATIC_DIR_SPECS.size():
		out_actions.append(AgentTelemetryPoolRegistry.borrow_directive())
	while out_actions.size() > STATIC_DIR_SPECS.size():
		var extra: AgentActionDirectiveDTO = out_actions.pop_back()
		AgentTelemetryPoolRegistry.recycle_directive(extra)

	# 1. 潜能加点判定
	var can_alloc: bool = snapshot.unallocated_potential_points > 0
	_populate_directive(out_actions[0], STATIC_DIR_SPECS[0], can_alloc, "" if can_alloc else "ERR_NO_POTENTIAL_POINTS", human_interacting)

	# 2. 宿屋休息判定
	var has_ap: bool = snapshot.ap_current >= 2.0
	_populate_directive(out_actions[1], STATIC_DIR_SPECS[1], has_ap, "" if has_ap else "ERR_INSUFFICIENT_AP", human_interacting)

	# 3. 交付任务判定
	var can_claim: bool = snapshot.quest_tracker != null and snapshot.quest_tracker.is_completable
	_populate_directive(out_actions[2], STATIC_DIR_SPECS[2], can_claim, "" if can_claim else "ERR_QUEST_NOT_READY", human_interacting)
	if can_claim:
		out_actions[2].allowed_parameters = {"quest_id": [snapshot.quest_tracker.tracked_quest_id]}
	else:
		out_actions[2].allowed_parameters = {"quest_id": []}

	# 4. 查验背包槽位判定
	_populate_directive(out_actions[3], STATIC_DIR_SPECS[3], true, "", human_interacting)

	# 5. 模式自适应判定
	_populate_directive(out_actions[4], STATIC_DIR_SPECS[4], true, "", human_interacting)

	# 6. 读取未读邮件判定
	var has_mail: bool = snapshot.unread_mail_count > 0
	_populate_directive(out_actions[5], STATIC_DIR_SPECS[5], has_mail, "" if has_mail else "ERR_NO_UNREAD_MAIL", human_interacting)

## 动态裁决当前权威快照下对 Agent 暴露的合法行动空间清单（兼容旧接口）
static func resolve_action_space(
	snapshot: AuthoritativeHudSnapshotDTO,
	human_interacting: bool = false
) -> Array[AgentActionDirectiveDTO]:
	var actions: Array[AgentActionDirectiveDTO] = []
	if snapshot == null:
		return actions
	resolve_action_space_into(snapshot, actions, human_interacting)
	return actions

static func _populate_directive(
	target: AgentActionDirectiveDTO,
	spec: Dictionary,
	executable: bool,
	blocked_reason: String,
	human_interacting: bool
) -> void:
	target.directive_id = str(spec.get("id", ""))
	target.domain = str(spec.get("domain", ""))
	target.description = str(spec.get("desc", ""))
	target.cost_payload = spec.get("cost", {})
	target.preconditions = spec.get("pre", {})
	target.allowed_parameters = spec.get("params", {})

	if human_interacting:
		target.is_executable = false
		target.blocked_reason = "ERR_PREEMPTED_BY_HUMAN"
	else:
		target.is_executable = executable
		target.blocked_reason = blocked_reason
