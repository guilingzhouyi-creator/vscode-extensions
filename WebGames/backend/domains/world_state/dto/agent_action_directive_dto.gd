# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/agent_action_directive_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: HomeActionSpaceSolver | 下游: AgentHudTelemetryPacketDTO | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 动态行动空间离散指令描述传输对象，面向 LLM 声明操作语义、代价载荷、前置依赖与当前可执行性。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双通道适配引擎设计规范 (Inv-ACTION-SPACE-PRUNING-6)
# ==============================================================================

## AgentActionDirectiveDTO：Value Object DTO / Data Transport Model
class_name AgentActionDirectiveDTO
extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

var directive_id: String = ""       # 操作唯一标识符 (如 "ALLOCATE_POTENTIAL_STAT")
var domain: String = "ASSET"         # 领域分类 ("ASSET", "RETENTION", "ACTION", "INTERACTION", "META")
var description: String = ""        # 纯技术事实说明，面向 LLM
var cost_payload: Dictionary = {}   # 代价载荷 (如 {"potential_points": 1})
var preconditions: Dictionary = {}  # 前置条件依赖 (如 {"unallocated_points_min": 1})
var allowed_parameters: Dictionary = {} # 合法参数值域 (如 {"stat_target": ["STR", "AGI"]})
var is_executable: bool = true      # 当前步是否允许执行 (由前置条件或人类抢占租约裁决)
var blocked_reason: String = ""     # 阻断原因码 (如 "ERR_NO_POTENTIAL_POINTS", "ERR_PREEMPTED_BY_HUMAN")

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	super.reset_state()
	directive_id = ""
	domain = "ASSET"
	description = ""
	cost_payload = _reset_dict(cost_payload)
	preconditions = _reset_dict(preconditions)
	allowed_parameters = _reset_dict(allowed_parameters)
	is_executable = true
	blocked_reason = ""

static func _reset_dict(target_dict: Dictionary) -> Dictionary:
	if target_dict.is_read_only():
		return {}
	target_dict.clear()
	return target_dict

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	var payload: Dictionary = {
		"directive_id": directive_id,
		"domain": domain,
		"is_executable": is_executable
	}
	if not description.is_empty():
		payload["description"] = description
	if not cost_payload.is_empty():
		payload["cost_payload"] = cost_payload.duplicate(true)
	if not preconditions.is_empty():
		payload["preconditions"] = preconditions.duplicate(true)
	if not allowed_parameters.is_empty():
		payload["allowed_parameters"] = allowed_parameters.duplicate(true)
	if not blocked_reason.is_empty():
		payload["blocked_reason"] = blocked_reason
	return payload

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> AgentActionDirectiveDTO:
	var directive := AgentActionDirectiveDTO.new()
	directive.directive_id = str(data.get("directive_id", ""))
	directive.domain = str(data.get("domain", "ASSET"))
	directive.description = str(data.get("description", ""))
	directive.cost_payload = data.get("cost_payload", {}).duplicate(true)
	directive.preconditions = data.get("preconditions", {}).duplicate(true)
	directive.allowed_parameters = data.get("allowed_parameters", {}).duplicate(true)
	directive.is_executable = bool(data.get("is_executable", true))
	directive.blocked_reason = str(data.get("blocked_reason", ""))
	return directive
