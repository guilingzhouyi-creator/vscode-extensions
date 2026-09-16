# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/save_slot_state_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 维持 Account -> SaveSlot -> World -> Character 实体层级绑定状态与开档标记
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

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
static func from_dto(d: Dictionary) -> SaveSlotStateDTO:
	var dto := SaveSlotStateDTO.new()
	if d.is_empty():
		return dto
	dto.slot_id = str(d.get("slot_id", ""))
	dto.account_id = str(d.get("account_id", ""))
	dto.bound_world_id = str(d.get("bound_world_id", ""))
	dto.bound_character_id = str(d.get("bound_character_id", ""))
	dto.is_occupied = bool(d.get("is_occupied", false))
	dto.is_first_creation = bool(d.get("is_first_creation", true))
	dto.created_timestamp_utc = int(d.get("created_timestamp_utc", 0))
	dto.last_played_timestamp_utc = int(d.get("last_played_timestamp_utc", 0))
	return dto
