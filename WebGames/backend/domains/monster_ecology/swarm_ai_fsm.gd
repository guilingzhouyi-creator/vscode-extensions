# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/monster_ecology/swarm_ai_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/monster.json | 信号: EventBus 领域广播
# 职责说明: 兽潮共鸣天灾调度、怪物基于正负 AP 势能博弈的发卡池 AI。 AI 阈值/verb 字面量/共鸣增量与叙事文案由 config/domains/monster.json、 config/narratives/monster.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name SwarmResonanceAndAIFSM extends RefCounted

## 怪物 AI 发卡决策：按 AP 势能区间（防御/调整/暴怒重击/斩击）选择动词
static func evaluate_monster_ai_action(monster: MonsterAggregateEntity, current_ap: int) -> String:
	# AP < 0 时倾向于防御/调整姿态 (BLOCK/PARRY)，AP >= 0 时发动大威力攻击 (SLASH/CRUSH)
	var guard_low_ap := GameConfig.get_int("domains.monster", "ai/guard_low_ap", -2)
	var guard_high_ap := GameConfig.get_int("domains.monster", "ai/guard_high_ap", 0)
	var rage_crush_threshold := GameConfig.get_float("domains.monster", "ai/rage_crush_threshold", 50.0)
	if current_ap < guard_low_ap:
		return GameConfig.get_string("domains.monster", "ai/verbs/BLOCK", "BLOCK")
	elif current_ap < guard_high_ap:
		return GameConfig.get_string("domains.monster", "ai/verbs/PARRY", "PARRY")
	elif monster.rage_level > rage_crush_threshold:
		return GameConfig.get_string("domains.monster", "ai/verbs/CRUSH", "CRUSH")
	else:
		return GameConfig.get_string("domains.monster", "ai/verbs/SLASH", "SLASH")

## 兽潮共鸣调度：全体怪物狂暴值递增（上限钳制）并广播共鸣叙事
static func trigger_swarm_resonance(swarm_entities: Array, lead_signal: String) -> void:
	var rage_increment := GameConfig.get_float("domains.monster", "swarm/rage_increment", 30.0)
	var rage_max := GameConfig.get_float("domains.monster", "swarm/rage_max", 100.0)
	for monster in swarm_entities:
		if monster is MonsterAggregateEntity:
			monster.rage_level = min(rage_max, monster.rage_level + rage_increment)

	EventBusCore.get_instance().emit_narrative_by_key(
		"monster/swarm_resonance", "eco_swarm", [swarm_entities.size()]
	)
