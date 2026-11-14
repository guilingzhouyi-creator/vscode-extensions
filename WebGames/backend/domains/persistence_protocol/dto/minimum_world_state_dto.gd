# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/dto/minimum_world_state_dto.gd
# 架构定位: Value Object DTO / Minimum Viable World State Model
# 依赖与触发: 上游: PrimaryStorageEngine, WorldGateway | 下游: SessionFlowContext
# 职责说明: 最小可运行世界状态传输对象：承载账号身份、角色基础、生命体征与进度摘要，
#           用于在极短毫秒预算内恢复基础世界状态，达成首个可交互时间（TTFI）极速就绪。
# 退出语义与设计依据: 双域储存架构主要数据域规范
# ==============================================================================

## MinimumWorldStateDTO：Value Object DTO / Minimum Viable World State Model
class_name MinimumWorldStateDTO extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

const DEFAULT_MAX_HP: float = 100.0
const MODE_SINGLE_PLAYER: String = "SINGLE_PLAYER"

var account_id: String = ""
var slot_id: String = ""
var character_name: String = ""
var world_mode: String = MODE_SINGLE_PLAYER
var level: int = 1
var current_hp: float = DEFAULT_MAX_HP
var max_hp: float = DEFAULT_MAX_HP
var play_time_seconds: int = 0
var prologue_completed: bool = false
var currency_summary: Dictionary = {
	"gold": 0,
	"crystals": 0
}
var metadata: Dictionary = {}

## 初始化最小可运行世界状态传输对象。
func _init(
	initial_account_id: String = "",
	initial_slot_id: String = "",
	initial_character_name: String = "",
	initial_world_mode: String = MODE_SINGLE_PLAYER
) -> void:
	account_id = initial_account_id
	slot_id = initial_slot_id
	character_name = initial_character_name
	world_mode = initial_world_mode
	level = 1
	current_hp = DEFAULT_MAX_HP
	max_hp = DEFAULT_MAX_HP
	play_time_seconds = 0
	prologue_completed = false
	currency_summary = {
		"gold": 0,
		"crystals": 0
	}
	metadata = {}

## 对象池复用重置
func reset_state() -> void:
	super.reset_state()
	account_id = ""
	slot_id = ""
	character_name = ""
	world_mode = MODE_SINGLE_PLAYER
	level = 1
	current_hp = DEFAULT_MAX_HP
	max_hp = DEFAULT_MAX_HP
	play_time_seconds = 0
	prologue_completed = false
	currency_summary.clear()
	currency_summary["gold"] = 0
	currency_summary["crystals"] = 0
	metadata.clear()

## 序列化为字典
func to_dict() -> Dictionary:
	return {
		"account_id": account_id,
		"slot_id": slot_id,
		"character_name": character_name,
		"world_mode": world_mode,
		"level": level,
		"current_hp": current_hp,
		"max_hp": max_hp,
		"play_time_seconds": play_time_seconds,
		"prologue_completed": prologue_completed,
		"currency_summary": currency_summary.duplicate(),
		"metadata": metadata.duplicate()
	}

## 反序列化为 DTO 实例
static func from_dict(data: Dictionary) -> RefCounted:
	var state_instance: RefCounted = new(
		String(data.get("account_id", "")),
		String(data.get("slot_id", "")),
		String(data.get("character_name", "")),
		String(data.get("world_mode", MODE_SINGLE_PLAYER))
	)
	var typed_instance := state_instance as MinimumWorldStateDTO
	if typed_instance != null:
		typed_instance.level = int(data.get("level", 1))
		typed_instance.current_hp = float(data.get("current_hp", DEFAULT_MAX_HP))
		typed_instance.max_hp = float(data.get("max_hp", DEFAULT_MAX_HP))
		typed_instance.play_time_seconds = int(data.get("play_time_seconds", 0))
		typed_instance.prologue_completed = bool(data.get("prologue_completed", false))
		var currency_data: Variant = data.get("currency_summary", {})
		if currency_data is Dictionary:
			typed_instance.currency_summary = currency_data.duplicate()
		var meta_data: Variant = data.get("metadata", {})
		if meta_data is Dictionary:
			typed_instance.metadata = meta_data.duplicate()
	return state_instance
