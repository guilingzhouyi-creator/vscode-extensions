# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/opening_event_stream_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 首次角色创建成功后向后端 EventBus 发布的结构化开局事件包： 账号/档位/世界/角色/首次标记/起始地点/开局主线引导 + 开局文案上下文。 前端仅订阅事件驱动开局剧情，禁止反向写入剧情执行标志。 关联细则: Phase 48 阶段1 §1.3（开局事件流数据契约）
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name OpeningEventStreamDTO
extends RefCounted

# ==============================================================================
# 一、字段（开局事件流数据契约）
# ==============================================================================

var event_id: String = ""               # 事件唯一 ID（EVT_OPENING_ 前缀）
var account_id: String = ""             # 归属账号 ID
var slot_id: String = ""                # 绑定档位 ID
var world_id: String = ""               # 目标世界 ID
var character_id: String = ""           # 新角色唯一 ID
var character_name: String = ""         # 角色展示名
var is_first_time_creation: bool = true # 首次创建标记（决定开场动画/引导分支）
var starting_location_id: String = ""   # 起始地点 ID
var opening_quest_line_id: String = ""  # 开局主线引导 ID
var timestamp_utc: int = 0              # 事件时间戳（Unix UTC 秒）
var narrative_context: Dictionary = {}  # 开局文案上下文（欢迎语等）

# ==============================================================================
# 二、序列化与反序列化
# ==============================================================================

## 序列化开局事件流为字典（narrative_context 深拷贝防外部突变）
func to_dto() -> Dictionary:
	return {
		"event_id": event_id,
		"account_id": account_id,
		"slot_id": slot_id,
		"world_id": world_id,
		"character_id": character_id,
		"character_name": character_name,
		"is_first_time_creation": is_first_time_creation,
		"starting_location_id": starting_location_id,
		"opening_quest_line_id": opening_quest_line_id,
		"timestamp_utc": timestamp_utc,
		"narrative_context": narrative_context.duplicate(true)
	}

## 从字典反序列化开局事件流（缺省字段安全回退默认值，空字典返回空包）。
## 契约：is_first_time_creation 缺省按 true 兜底（首次创建语义安全默认）。
static func from_dto(d: Dictionary) -> OpeningEventStreamDTO:
	var dto := OpeningEventStreamDTO.new()
	if d.is_empty():
		return dto
	dto.event_id = str(d.get("event_id", ""))
	dto.account_id = str(d.get("account_id", ""))
	dto.slot_id = str(d.get("slot_id", ""))
	dto.world_id = str(d.get("world_id", ""))
	dto.character_id = str(d.get("character_id", ""))
	dto.character_name = str(d.get("character_name", ""))
	dto.is_first_time_creation = bool(d.get("is_first_time_creation", true))
	dto.starting_location_id = str(d.get("starting_location_id", ""))
	dto.opening_quest_line_id = str(d.get("opening_quest_line_id", ""))
	dto.timestamp_utc = int(d.get("timestamp_utc", 0))
	dto.narrative_context = (d.get("narrative_context", {}) as Dictionary).duplicate(true)
	return dto
