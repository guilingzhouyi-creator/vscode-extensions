# ==============================================================================
# 模块归属: 业务领域层 (Domains · 任务因果业务域)
# 文件路径: res://backend/domains/quest_causality/dto/quest_reward_context_dto.gd
# 架构定位: 值对象数据传输模型
# 依赖与触发: 上游: QuestCausalityService | 下游: InventoryDomain, WalletDomain | 配置: config/domains/quest_causality.json
# 职责说明: 任务完成奖励发放上下文，包含经验、货币、物品掉落及状态追踪。
# 退出语义与设计依据: 退出语义: 纯数据结构传输 | 设计依据: 任务因果奖励数据传输模型规约
# ==============================================================================

## QuestRewardContextDto：任务因果奖励发放上下文数据模型
class_name QuestRewardContextDto
extends RefCounted

var quest_id: String = ""
var recipient_id: String = ""
var experience_reward: int = 0
var currency_rewards: Dictionary = {}
var item_rewards: Array[String] = []
var granted_timestamp_utc: int = 0

## 重置内部奖励上下文状态，供对象池无堆分配复用
func reset_state() -> void:
	quest_id = ""
	recipient_id = ""
	experience_reward = 0
	currency_rewards.clear()
	item_rewards.clear()
	granted_timestamp_utc = 0

## 序列化当前奖励发放上下文为字典结构
func to_dto() -> Dictionary:
	return {
		"quest_id": quest_id,
		"recipient_id": recipient_id,
		"experience_reward": experience_reward,
		"currency_rewards": currency_rewards.duplicate(true),
		"item_rewards": item_rewards.duplicate(),
		"granted_timestamp_utc": granted_timestamp_utc
	}

## 从字典数据反序列化还原奖励发放上下文传输对象
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

