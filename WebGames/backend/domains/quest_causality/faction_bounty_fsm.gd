# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/quest_causality/faction_bounty_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: inventory | 配置: config/domains/quest.json | 信号: EventBus 领域广播
# 职责说明: 任务结算阵营声望奖惩、恶名通缉诛杀令跃迁。 通缉阈值与叙事文案由 config/quest.json、config/narratives/quest.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name FactionBountyAndCausalityFSM extends RefCounted

## 任务结算：阵营声望奖惩叠加 → 恶名通缉阈值判定并广播（诛杀令跃迁）
static func apply_quest_settlement(
	character_id: String,
	quest: QuestObjectiveNode.QuestCausalityAggregate,
	reputation_dict: Dictionary
) -> Dictionary:
	var bounty_threshold := GameConfig.get_int("domains.quest", "bounty/trigger_threshold", -50)
	var bounty_triggered := false
	for faction in quest.faction_reputation_rewards:
		var delta = int(quest.faction_reputation_rewards[faction])
		var current = reputation_dict.get(faction, 0) + delta
		reputation_dict[faction] = current

		# 恶名通缉判定: 阵营声望跌破阈值
		if current <= bounty_threshold:
			bounty_triggered = true
			EventBusCore.get_instance().emit_narrative_by_key(
				"quest/bounty_triggered", "bounty", [character_id, faction, current]
			)

	EventBusCore.get_instance().emit_narrative_by_key(
		"quest/quest_settled", "quest", [quest.quest_title, character_id, quest.gold_reward]
	)

	return { "reputations": reputation_dict, "bounty_triggered": bounty_triggered }
