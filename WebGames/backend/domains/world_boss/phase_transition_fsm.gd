# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/world_boss/phase_transition_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/world_boss.json | 信号: EventBus 领域广播
# 职责说明: 判定首领血量归零切阶段、触发全屏转相清场机制与狂暴激怒 倍率与文案由 config/domains/world_boss.json、narratives/world_boss.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name ConfigurablePhaseTransitionFSM extends RefCounted

## 首领受击结算：击败锁存 → 护盾吸收/无敌归零 → 血量扣减 → 血尽切阶段（L2 乘性强化+机制护盾+转相清场）或终态锁存+动态加点联动
static func apply_boss_damage(
	boss: WorldBossAggregate,
	attacker_id: String,
	damage: float
) -> Dictionary:
	# L9-b（Phase 53）：击败终态锁存——已击败首领不再受理伤害/结算（一次性语义 Inv-ON-1）
	if boss.is_defeated:
		return {
			"actual_damage": 0.0,
			"phase_current_hp": boss.phase_current_hp,
			"current_phase": boss.current_phase_index,
			"phase_transition": false,
			"defeated": true,
			"error_code": "BOSS_ALREADY_DEFEATED"
		}
	var ledger = boss.battle_contribution_ledger.get(attacker_id, { "damage": 0.0, "tanking": 0.0, "heal": 0.0 })
	ledger["damage"] += damage
	boss.battle_contribution_ledger[attacker_id] = ledger

	var actual_damage = damage
	if boss.mechanism_shield_hp > 0.0:
		var shield_absorb = min(boss.mechanism_shield_hp, actual_damage)
		boss.mechanism_shield_hp = maxf(0.0, boss.mechanism_shield_hp - shield_absorb)
		actual_damage -= shield_absorb

	if boss.is_invulnerable:
		actual_damage = 0.0

	boss.phase_current_hp = max(0.0, boss.phase_current_hp - actual_damage)

	var phase_transition_triggered := false
	var is_boss_defeated := false

	if boss.phase_current_hp <= 0.0:
		if boss.current_phase_index < boss.total_phases:
			boss.current_phase_index += 1
			boss.phase_current_hp = boss.phase_max_hp
			phase_transition_triggered = true

			var str_mult := GameConfig.get_float("domains.world_boss", "phase_transition/str_multiplier", 1.25)
			# 转相乘性强化 = L2 系数修正（乘性）：等级不变，底层实际值联动
			boss.physiology.base_coefficients["STR"] = float(boss.physiology.base_coefficients.get("STR", 1.0)) * str_mult
			boss.mechanism_shield_hp = GameConfig.get_float("domains.world_boss", "phase_transition/shield_hp", 1000.0)
			boss.is_channeling_wipe_spell = true

			EventBusCore.get_instance().emit_narrative_by_key(
				"world_boss/phase_transition", "eco_swarm", [boss.boss_title, boss.current_phase_index]
			)
			# P2-3 补发（Phase 43）：纯结构化通道——narratives 无 world_boss.phase_transition
			# 文案键（既有斜杠叙事键保留），EventBus 解析不出即只广播 domain_event
			EventBusCore.get_instance().emit_domain_event("world_boss.phase_transition", {
				"args": [boss.boss_title, boss.current_phase_index],
				"summary": {
					"phase": boss.current_phase_index,
					"total_phases": boss.total_phases,
					"shield_hp": boss.mechanism_shield_hp
				},
				"category_key": "eco_swarm"
			})
		else:
			# 终态锁存：先置位、后结算（击败叙事与动态加点渠道仅发生一次）
			boss.is_defeated = true
			is_boss_defeated = true
			EventBusCore.get_instance().emit_narrative_by_key(
				"world_boss/boss_defeated", "sovereignty", [boss.boss_title]
			)
			# 随机动态加点联动：首领被讨伐触发系统直加/直减（配置表 dynamic_adjust.channels
			# 驱动，永久性且洗点不逆转；怪物大系统击杀事件按同一契约调用本入口）
			DynamicAttributeAdjuster.consume_event_channel(boss.physiology, "world_boss.boss_defeated")

	return {
		"actual_damage": actual_damage,
		"phase_current_hp": boss.phase_current_hp,
		"current_phase": boss.current_phase_index,
		"phase_transition": phase_transition_triggered,
		"defeated": is_boss_defeated
	}
