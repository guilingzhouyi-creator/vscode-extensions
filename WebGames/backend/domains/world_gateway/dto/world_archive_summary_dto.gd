# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/dto/world_archive_summary_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: WorldArchiveRepository, WorldGateway | 下游: 无 | 配置: config/domains/world_gateway/core.json | 信号: 无
# 职责说明: 承载单机与联机世界档案的轻量级摘要元数据，支持网关目录检索与选界展示。
# 设计依据: 业务域第一性原理 / 架构解耦契约与世界状态隔离规范
# ==============================================================================

class_name WorldArchiveSummaryDTO
extends RefCounted

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

func _init(
	p_world_id: String = "",
	p_world_name: String = "",
	p_mode: int = 1,
	p_seed_value: int = 0,
	p_current_tick: int = 0,
	p_current_day: int = 1,
	p_character_count: int = 0,
	p_created_timestamp_utc: int = 0,
	p_last_played_timestamp_utc: int = 0,
	p_is_active: bool = true
) -> void:
	world_id = p_world_id
	world_name = p_world_name
	mode = p_mode
	seed_value = p_seed_value
	current_tick = p_current_tick
	current_day = p_current_day
	character_count = p_character_count
	created_timestamp_utc = p_created_timestamp_utc
	last_played_timestamp_utc = p_last_played_timestamp_utc
	is_active = p_is_active

## 对象状态复位（支持对象池复用，ADV-PRF-002）
func reset_state() -> void:
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
static func from_dto(d: Dictionary) -> WorldArchiveSummaryDTO:
	if d.is_empty():
		return WorldArchiveSummaryDTO.new()
	var dto := WorldArchiveSummaryDTO.new()
	dto.world_id = String(d.get("world_id", ""))
	dto.world_name = String(d.get("world_name", ""))
	dto.mode = int(d.get("mode", 1))
	dto.seed_value = int(d.get("seed_value", 0))
	dto.current_tick = int(d.get("current_tick", 0))
	dto.current_day = int(d.get("current_day", 1))
	dto.character_count = int(d.get("character_count", 0))
	dto.created_timestamp_utc = int(d.get("created_timestamp_utc", 0))
	dto.last_played_timestamp_utc = int(d.get("last_played_timestamp_utc", 0))
	dto.is_active = bool(d.get("is_active", true))
	return dto
