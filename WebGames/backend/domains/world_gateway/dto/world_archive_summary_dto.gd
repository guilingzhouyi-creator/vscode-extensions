# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/dto/world_archive_summary_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: WorldArchiveRepository, WorldGateway | 下游: 无 | 配置: config/domains/world_gateway/core.json | 信号: 无
# 职责说明: 承载单机与联机世界档案的轻量级摘要元数据，支持网关目录检索与选界展示。
# 退出语义与设计依据: 业务域第一性原理 / 架构解耦契约与世界状态隔离规范
# ==============================================================================

## WorldArchiveSummaryDTO：Value Object DTO / Data Transport Model
class_name WorldArchiveSummaryDTO
extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

var world_id: String = ""
var world_name: String = ""
var mode: int = 1
var seed_value: int = 0
var current_tick: int = 0
var current_day: int = 1
var character_count: int = 0
var created_timestamp_utc: int = 0
var last_played_timestamp_utc: int = 0
var is_active: bool = true

## 构造世界档案摘要 DTO
func _init(
	initial_world_id: String = "",
	initial_world_name: String = "",
	initial_mode: int = 1,
	initial_seed_value: int = 0,
	initial_current_tick: int = 0,
	initial_current_day: int = 1,
	initial_character_count: int = 0,
	initial_created_timestamp_utc: int = 0,
	initial_last_played_timestamp_utc: int = 0,
	initial_is_active: bool = true
) -> void:
	world_id = initial_world_id
	world_name = initial_world_name
	mode = initial_mode
	seed_value = initial_seed_value
	current_tick = initial_current_tick
	current_day = initial_current_day
	character_count = initial_character_count
	created_timestamp_utc = initial_created_timestamp_utc
	last_played_timestamp_utc = initial_last_played_timestamp_utc
	is_active = initial_is_active

## 对象状态复位（支持对象池复用，ADV-PRF-002）
func reset_state() -> void:
	super.reset_state()
	world_id = ""
	world_name = ""
	mode = 1
	seed_value = 0
	current_tick = 0
	current_day = 1
	character_count = 0
	created_timestamp_utc = 0
	last_played_timestamp_utc = 0
	is_active = true

## 序列化为字典传输对象
func to_dto() -> Dictionary:
	return {
		"world_id": world_id,
		"world_name": world_name,
		"mode": mode,
		"seed_value": seed_value,
		"current_tick": current_tick,
		"current_day": current_day,
		"character_count": character_count,
		"created_timestamp_utc": created_timestamp_utc,
		"last_played_timestamp_utc": last_played_timestamp_utc,
		"is_active": is_active
	}

## 从字典还原构建 DTO 实例
static func from_dto(serialized_payload: Dictionary) -> WorldArchiveSummaryDTO:
	if serialized_payload.is_empty():
		return WorldArchiveSummaryDTO.new()
	var summary := WorldArchiveSummaryDTO.new()
	summary.world_id = String(serialized_payload.get("world_id", ""))
	summary.world_name = String(serialized_payload.get("world_name", ""))
	summary.mode = int(serialized_payload.get("mode", 1))
	summary.seed_value = int(serialized_payload.get("seed_value", 0))
	summary.current_tick = int(serialized_payload.get("current_tick", 0))
	summary.current_day = int(serialized_payload.get("current_day", 1))
	summary.character_count = int(serialized_payload.get("character_count", 0))
	summary.created_timestamp_utc = int(serialized_payload.get("created_timestamp_utc", 0))
	summary.last_played_timestamp_utc = int(serialized_payload.get("last_played_timestamp_utc", 0))
	summary.is_active = bool(serialized_payload.get("is_active", true))
	return summary
