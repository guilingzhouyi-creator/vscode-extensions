# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/hud_causal_delta_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: HudCausalDeltaSolver | 下游: AgentHudTelemetryPacketDTO | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 单步状态演化因果差分传输对象，携带突变类别、目标字段、旧值、新值、增量值与因果发起者溯源标签。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双通道适配引擎设计规范 (Inv-CAUSAL-INITIATOR-PROVENANCE-11)
# ==============================================================================

## HudCausalDeltaDTO：Value Object DTO / Data Transport Model
class_name HudCausalDeltaDTO
extends PoolableDtoBase

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
	super.reset_state()
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
static func from_dto(serialized_payload: Dictionary) -> HudCausalDeltaDTO:
	var delta := HudCausalDeltaDTO.new()
	delta.delta_category = str(serialized_payload.get("delta_category", ""))
	delta.target_field = str(serialized_payload.get("target_field", ""))
	delta.previous_value = serialized_payload.get("previous_value", null)
	delta.current_value = serialized_payload.get("current_value", null)
	delta.delta_amount = float(serialized_payload.get("delta_amount", 0.0))
	delta.cause_identifier = str(serialized_payload.get("cause_identifier", ""))
	delta.initiator = str(serialized_payload.get("initiator", "SYSTEM_TICK_SIMULATION"))
	delta.reason = str(serialized_payload.get("reason", ""))
	return delta
