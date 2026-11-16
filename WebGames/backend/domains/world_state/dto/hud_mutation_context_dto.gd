# ==============================================================================
# 模块归属: 业务领域层 (Domains · 世界状态业务域)
# 文件路径: res://backend/domains/world_state/dto/hud_mutation_context_dto.gd
# 架构定位: 值对象数据传输模型
# 依赖与触发: 上游: WorldStateDomain | 下游: FrontendHudBridge | 配置: config/domains/world_state.json
# 职责说明: HUD 状态突变上下文数据载荷，解耦前端视图与后端业务计算。
# 退出语义与设计依据: 退出语义: 纯数据结构传输 | 设计依据: HUD状态突变数据传输模型规约
# ==============================================================================

## HudMutationContextDto：界面状态突变上下文数据模型
class_name HudMutationContextDto
extends PoolableDtoBase

var target_hud_element: String = ""
var mutation_type: String = ""
var payload: Dictionary = {}
var timestamp_utc: int = 0

## 重置内部界面突变上下文状态，供对象池无堆分配复用
func reset_state() -> void:
	super.reset_state()
	target_hud_element = ""
	mutation_type = ""
	payload.clear()
	timestamp_utc = 0

## 序列化当前界面状态突变上下文为字典结构
func to_dto() -> Dictionary:
	return {
		"target_hud_element": target_hud_element,
		"mutation_type": mutation_type,
		"payload": payload.duplicate(true),
		"timestamp_utc": timestamp_utc
	}

## 从字典数据反序列化还原界面状态突变上下文传输对象
static func from_dto(serialized_payload: Dictionary) -> HudMutationContextDto:
	var mutation_context := HudMutationContextDto.new()
	mutation_context.target_hud_element = String(serialized_payload.get("target_hud_element", ""))
	mutation_context.mutation_type = String(serialized_payload.get("mutation_type", ""))
	var raw_payload: Variant = serialized_payload.get("payload", {})
	if raw_payload is Dictionary:
		mutation_context.payload = raw_payload.duplicate(true)
	mutation_context.timestamp_utc = int(serialized_payload.get("timestamp_utc", 0))
	return mutation_context
