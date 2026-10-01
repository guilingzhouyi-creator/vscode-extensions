# ==============================================================================
# 模块归属: 业务领域层 (Domains · 世界状态业务域)
# 文件路径: res://backend/domains/world_state/dto/hud_mutation_context_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: WorldStateDomain | 下游: FrontendHudBridge | 配置: config/domains/world_state.json
# 职责说明: HUD 状态突变上下文数据载荷，解耦前端视图与后端业务计算。
# ==============================================================================

class_name HudMutationContextDto
extends RefCounted

var target_hud_element: String = ""
var mutation_type: String = ""
var payload: Dictionary = {}
var timestamp_utc: int = 0

func reset_state() -> void:
	target_hud_element = ""
	mutation_type = ""
	payload.clear()
	timestamp_utc = 0

func to_dto() -> Dictionary:
	return {
		"target_hud_element": target_hud_element,
		"mutation_type": mutation_type,
		"payload": payload.duplicate(true),
		"timestamp_utc": timestamp_utc
	}

static func from_dto(data: Dictionary) -> HudMutationContextDto:
	var dto := HudMutationContextDto.new()
	dto.target_hud_element = String(data.get("target_hud_element", ""))
	dto.mutation_type = String(data.get("mutation_type", ""))
	var raw_payload = data.get("payload", {})
	if raw_payload is Dictionary:
		dto.payload = raw_payload.duplicate(true)
	dto.timestamp_utc = int(data.get("timestamp_utc", 0))
	return dto
