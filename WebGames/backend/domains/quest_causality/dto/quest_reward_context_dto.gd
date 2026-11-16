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
extends PoolableDtoBase

var quest_id: String = ""
var recipient_id: String = ""
var experience_reward: int = 0
var currency_rewards: Dictionary = {}
var item_rewards: Array[String] = []
var granted_timestamp_utc: int = 0

## 重置内部奖励上下文状态，供对象池无堆分配复用
func reset_state() -> void:
	super.reset_state()
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
static func from_dto(dto_payload: Dictionary) -> QuestRewardContextDto:
	var context_dto := QuestRewardContextDto.new()
	context_dto.quest_id = String(dto_payload.get("quest_id", ""))
	context_dto.recipient_id = String(dto_payload.get("recipient_id", ""))
	context_dto.experience_reward = int(dto_payload.get("experience_reward", 0))
	var raw_currencies: Variant = dto_payload.get("currency_rewards", {})
	if raw_currencies is Dictionary:
		context_dto.currency_rewards = raw_currencies.duplicate(true)
	var raw_items: Variant = dto_payload.get("item_rewards", [])
	if raw_items is Array:
		for reward_item_id in raw_items:
			context_dto.item_rewards.append(String(reward_item_id))
	context_dto.granted_timestamp_utc = int(dto_payload.get("granted_timestamp_utc", 0))
	return context_dto
