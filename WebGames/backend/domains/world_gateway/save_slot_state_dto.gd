# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/save_slot_state_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 维持 Account -> SaveSlot -> World -> Character 实体层级绑定状态与开档标记
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## SaveSlotStateDTO：Value Object DTO / Data Transport Model
class_name SaveSlotStateDTO
extends RefCounted

var slot_id: String = ""
var account_id: String = ""
var bound_world_id: String = ""
var bound_character_id: String = ""
var is_occupied: bool = false
var is_first_creation: bool = true
var created_timestamp_utc: int = 0
var last_played_timestamp_utc: int = 0

## 序列化档位状态为字典
func to_dto() -> Dictionary:
	return {
		"slot_id": slot_id,
		"account_id": account_id,
		"bound_world_id": bound_world_id,
		"bound_character_id": bound_character_id,
		"is_occupied": is_occupied,
		"is_first_creation": is_first_creation,
		"created_timestamp_utc": created_timestamp_utc,
		"last_played_timestamp_utc": last_played_timestamp_utc
	}

## 从字典重建档位状态（空字典回退默认开档态）
static func from_dto(data: Dictionary) -> SaveSlotStateDTO:
	var slot_state := SaveSlotStateDTO.new()
	if data.is_empty():
		return slot_state
	slot_state.slot_id = str(data.get("slot_id", ""))
	slot_state.account_id = str(data.get("account_id", ""))
	slot_state.bound_world_id = str(data.get("bound_world_id", ""))
	slot_state.bound_character_id = str(data.get("bound_character_id", ""))
	slot_state.is_occupied = bool(data.get("is_occupied", false))
	slot_state.is_first_creation = bool(data.get("is_first_creation", true))
	slot_state.created_timestamp_utc = int(data.get("created_timestamp_utc", 0))
	slot_state.last_played_timestamp_utc = int(data.get("last_played_timestamp_utc", 0))
	return slot_state
