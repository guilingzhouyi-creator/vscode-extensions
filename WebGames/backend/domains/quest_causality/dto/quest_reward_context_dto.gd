# ==============================================================================
# 模块归属: 业务领域层 (Domains · 任务因果业务域)
# 文件路径: res://backend/domains/quest_causality/dto/quest_reward_context_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: QuestCausalityService | 下游: InventoryDomain, WalletDomain | 配置: config/domains/quest_causality.json
# 职责说明: 任务完成奖励发放上下文，包含经验、货币、物品掉落及状态追踪。
# ==============================================================================

class_name QuestRewardContextDto
extends RefCounted

var quest_id: String = ""
var recipient_id: String = ""
var experience_reward: int = 0
var currency_rewards: Dictionary = {}
var item_rewards: Array[String] = []
var granted_timestamp_utc: int = 0

func reset_state() -> void:
	quest_id = ""
	recipient_id = ""
	experience_reward = 0
	currency_rewards.clear()
	item_rewards.clear()
	granted_timestamp_utc = 0

func to_dto() -> Dictionary:
	return {
		"quest_id": quest_id,
		"recipient_id": recipient_id,
		"experience_reward": experience_reward,
		"currency_rewards": currency_rewards.duplicate(true),
		"item_rewards": item_rewards.duplicate(),
		"granted_timestamp_utc": granted_timestamp_utc
	}

static func from_dto(data: Dictionary) -> QuestRewardContextDto:
	var dto := QuestRewardContextDto.new()
	dto.quest_id = String(data.get("quest_id", ""))
	dto.recipient_id = String(data.get("recipient_id", ""))
	dto.experience_reward = int(data.get("experience_reward", 0))
	var raw_curr = data.get("currency_rewards", {})
	if raw_curr is Dictionary:
		dto.currency_rewards = raw_curr.duplicate(true)
	var raw_items = data.get("item_rewards", [])
	if raw_items is Array:
		for item in raw_items:
			dto.item_rewards.append(String(item))
	dto.granted_timestamp_utc = int(data.get("granted_timestamp_utc", 0))
	return dto

