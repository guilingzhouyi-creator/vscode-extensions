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

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"main_quest": main_quest.duplicate(),
		"side_quest": side_quest.duplicate(),
		"daily_quest": daily_quest.duplicate()
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> ActiveQuestTrackerDTO:
	var dto := ActiveQuestTrackerDTO.new()
	var mq = data.get("main_quest", {})
	if mq is Dictionary:
		dto.main_quest = mq.duplicate()
	var sq = data.get("side_quest", {})
	if sq is Dictionary:
		dto.side_quest = sq.duplicate()
	var dq = data.get("daily_quest", {})
	if dq is Dictionary:
		dto.daily_quest = dq.duplicate()
	return dto
