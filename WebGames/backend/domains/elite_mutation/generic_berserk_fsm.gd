# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/elite_mutation/generic_berserk_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/elite.json | 信号: EventBus 领域广播
# 职责说明: 基于血线阈值与战斗超时的通用狂暴触发判定、免疫控制与爆发伤害加成 （L2 系数乘性修正）；阈值与倍率由 config/domains/elite.json 的 berserk_fsm 段驱动，叙事文案由 config/narratives/elite.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name GenericBerserkFSM extends RefCounted

# ==============================================================================
# 一、狂暴触发判定（血线阈值 / 战斗超时双条件）
# ==============================================================================

## 狂暴触发判定：血线阈值或战斗超时 → L2 系数乘性修正 + 狂暴等级 + 叙事广播
## 契约：已狂暴时直接返回 true（幂等，不重复叠加）；max_hp 下限钳制 1.0 防除零；
##       HP 占比 ≤ berserk_health_threshold 或 combat_duration_ticks 超阈即触发。
static func check_and_trigger_berserk(
	monster: EliteMonsterAggregate,
	current_hp: float,
	max_hp: float,
	combat_duration_ticks: int = 0
) -> bool:
	if monster.is_berserk:
		return true

	var hp_ratio = current_hp / max(1.0, max_hp)
	var ticks_threshold := GameConfig.get_int("domains.elite", "berserk_fsm/duration_ticks_threshold", 500)
	var time_exceeded = (combat_duration_ticks >= ticks_threshold)

	if hp_ratio <= monster.berserk_health_threshold or time_exceeded:
		monster.is_berserk = true
		var str_mult := GameConfig.get_float("domains.elite", "berserk_fsm/str_multiplier", 1.50)
		# 狂暴 = L2 系数修正（乘性）：等级不变，底层实际值联动
		monster.physiology.base_coefficients["STR"] = float(monster.physiology.base_coefficients.get("STR", 1.0)) * str_mult
		monster.rage_level = GameConfig.get_float("domains.elite", "berserk_fsm/rage_level", 100.0)

		var pct := int((str_mult - 1.0) * 100)
		EventBusCore.get_instance().emit_narrative_by_key(
			"elite/berserk_trigger", "eco_swarm", [monster.species_name, pct]
		)
		return true

	return false
