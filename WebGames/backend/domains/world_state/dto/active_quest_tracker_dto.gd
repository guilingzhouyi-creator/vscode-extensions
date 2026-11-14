# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/active_quest_tracker_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 追踪中任务轻量摘要传输对象，承载主线、支线、日常任务的简报信息。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ActiveQuestTrackerDTO：Value Object DTO / Data Transport Model
class_name ActiveQuestTrackerDTO
extends RefCounted

var main_quest: Dictionary = {}
var side_quest: Dictionary = {}
var daily_quest: Dictionary = {}
var tracked_quest_id: String = ""
var is_completable: bool = false

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"main_quest": main_quest.duplicate(),
		"side_quest": side_quest.duplicate(),
		"daily_quest": daily_quest.duplicate(),
		"tracked_quest_id": tracked_quest_id,
		"is_completable": is_completable
	}

## 从输入字典反序列化还原传输对象
static func from_dto(serialized_payload: Dictionary) -> ActiveQuestTrackerDTO:
	var tracker := ActiveQuestTrackerDTO.new()
	var raw_main_quest: Variant = serialized_payload.get("main_quest", {})
	if raw_main_quest is Dictionary:
		tracker.main_quest = raw_main_quest.duplicate()
	var raw_side_quest: Variant = serialized_payload.get("side_quest", {})
	if raw_side_quest is Dictionary:
		tracker.side_quest = raw_side_quest.duplicate()
	var raw_daily_quest: Variant = serialized_payload.get("daily_quest", {})
	if raw_daily_quest is Dictionary:
		tracker.daily_quest = raw_daily_quest.duplicate()
	tracker.tracked_quest_id = str(serialized_payload.get("tracked_quest_id", ""))
	tracker.is_completable = bool(serialized_payload.get("is_completable", false))
	return tracker
