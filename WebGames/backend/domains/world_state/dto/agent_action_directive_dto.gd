# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/agent_action_directive_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: HomeActionSpaceSolver | 下游: AgentHudTelemetryPacketDTO | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 动态行动空间离散指令描述传输对象，面向 LLM 声明操作语义、代价载荷、前置依赖与当前可执行性。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎施工细则 (Inv-ACTION-SPACE-PRUNING-6)
# ==============================================================================

## AgentActionDirectiveDTO：Value Object DTO / Data Transport Model
class_name AgentActionDirectiveDTO
extends RefCounted

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
	directive_id = ""
	domain = "ASSET"
	description = ""
	cost_payload.clear()
	preconditions.clear()
	allowed_parameters.clear()
	is_executable = true
	blocked_reason = ""

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"directive_id": directive_id,
		"domain": domain,
		"description": description,
		"cost_payload": cost_payload.duplicate(true),
		"preconditions": preconditions.duplicate(true),
		"allowed_parameters": allowed_parameters.duplicate(true),
		"is_executable": is_executable,
		"blocked_reason": blocked_reason
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> AgentActionDirectiveDTO:
	var dto := AgentActionDirectiveDTO.new()
	dto.directive_id = str(data.get("directive_id", ""))
	dto.domain = str(data.get("domain", "ASSET"))
	dto.description = str(data.get("description", ""))
	dto.cost_payload = data.get("cost_payload", {}).duplicate(true)
	dto.preconditions = data.get("preconditions", {}).duplicate(true)
	dto.allowed_parameters = data.get("allowed_parameters", {}).duplicate(true)
	dto.is_executable = bool(data.get("is_executable", true))
	dto.blocked_reason = str(data.get("blocked_reason", ""))
	return dto
