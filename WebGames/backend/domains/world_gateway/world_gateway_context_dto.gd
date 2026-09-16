# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_gateway_context_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 维持当前登录账号的世界栏会话状态、选定模式、档位、世界与角色关系
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name WorldGatewayContextDTO
extends RefCounted

var account_id: String = ""
var current_phase: int = WorldGatewayModel.GatewayPhase.AUTHENTICATED
var selected_mode: int = WorldGatewayModel.GameMode.UNSELECTED
var selected_slot_id: String = ""
var selected_world_id: String = ""
var active_character_id: String = ""
var is_first_time_creation: bool = false
var active_canary_features: Array = []

## 序列化网关会话上下文为字典（canary 特性数组副本）
func to_dto() -> Dictionary:
	return {
		"account_id": account_id,
		"current_phase": current_phase,
		"selected_mode": selected_mode,
		"selected_slot_id": selected_slot_id,
		"selected_world_id": selected_world_id,
		"active_character_id": active_character_id,
		"is_first_time_creation": is_first_time_creation,
		"active_canary_features": active_canary_features.duplicate()
	}


## 从字典重建网关上下文（缺省回退 AUTHENTICATED/UNSELECTED 初态）
static func from_dto(d: Dictionary) -> WorldGatewayContextDTO:
	var ctx := WorldGatewayContextDTO.new()
	if d.is_empty():
		return ctx
	ctx.account_id = str(d.get("account_id", ""))
	ctx.current_phase = int(d.get("current_phase", WorldGatewayModel.GatewayPhase.AUTHENTICATED))
	ctx.selected_mode = int(d.get("selected_mode", WorldGatewayModel.GameMode.UNSELECTED))
	ctx.selected_slot_id = str(d.get("selected_slot_id", ""))
	ctx.selected_world_id = str(d.get("selected_world_id", ""))
	ctx.active_character_id = str(d.get("active_character_id", ""))
	ctx.is_first_time_creation = bool(d.get("is_first_time_creation", false))
	ctx.active_canary_features = (d.get("active_canary_features", []) as Array).duplicate()
	return ctx
