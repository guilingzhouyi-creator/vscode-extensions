# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/hud_causal_delta_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: HudCausalDeltaSolver | 下游: AgentHudTelemetryPacketDTO | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 单步状态演化因果差分传输对象，携带突变类别、目标字段、旧值、新值、增量值与因果发起者溯源标签。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎施工细则 (Inv-CAUSAL-INITIATOR-PROVENANCE-11)
# ==============================================================================

## HudCausalDeltaDTO：Value Object DTO / Data Transport Model
class_name HudCausalDeltaDTO
extends RefCounted

var delta_category: String = ""   # "PHYSIOLOGY", "WALLET", "ASSET", "CALENDAR", "QUEST"
var target_field: String = ""     # "hp_current", "wallet_gold", "day_phase_key"
var previous_value: Variant = null
var current_value: Variant = null
var delta_amount: float = 0.0
var cause_identifier: String = "" # 诱因标识符 (如 "ACTION_REST_INN")
var initiator: String = "SYSTEM_TICK_SIMULATION" # 突变发起者: "HUMAN_UI_INTERACTION" | "AGENT_ACTION_CHANNEL" | "SYSTEM_TICK_SIMULATION"
var reason: String = ""           # 面向 Agent 解释因果的纯客观事实说明

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	delta_category = ""
	target_field = ""
	previous_value = null
	current_value = null
	delta_amount = 0.0
	cause_identifier = ""
	initiator = "SYSTEM_TICK_SIMULATION"
	reason = ""

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"delta_category": delta_category,
		"target_field": target_field,
		"previous_value": previous_value,
		"current_value": current_value,
		"delta_amount": delta_amount,
		"cause_identifier": cause_identifier,
		"initiator": initiator,
		"reason": reason
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> HudCausalDeltaDTO:
	var dto := HudCausalDeltaDTO.new()
	dto.delta_category = str(data.get("delta_category", ""))
	dto.target_field = str(data.get("target_field", ""))
	dto.previous_value = data.get("previous_value", null)
	dto.current_value = data.get("current_value", null)
	dto.delta_amount = float(data.get("delta_amount", 0.0))
	dto.cause_identifier = str(data.get("cause_identifier", ""))
	dto.initiator = str(data.get("initiator", "SYSTEM_TICK_SIMULATION"))
	dto.reason = str(data.get("reason", ""))
	return dto

