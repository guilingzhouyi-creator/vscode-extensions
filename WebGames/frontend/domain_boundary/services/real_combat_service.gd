# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_combat_service.gd
# 架构定位: Domain Boundary Adapter / Combat Encounter Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: WorldBossAggregate, ConfigurablePhaseTransitionFSM, GameConfig
# 职责说明: 实现 ICombatService 接口，基于世界首领聚合实体与配置参数驱动实时战况快照与技能结算。
# 退出语义与设计依据: 表现层零战斗数值计算与领域边界解耦契约
# ==============================================================================

## RealCombatService：直连世界首领状态机与战斗配置的真实战斗服务实现
class_name RealCombatService
extends "res://frontend/domain_boundary/interfaces/i_combat_service.gd"

const WorldBossAggregate = preload("res://backend/domains/world_boss/world_boss_aggregate.gd")
const ConfigurablePhaseTransitionFSM = preload("res://backend/domains/world_boss/configurable_phase_transition_fsm.gd")

var _encounter_bosses: Dictionary = {}

func _resolve_or_create_boss(battle_id: String) -> WorldBossAggregate:
	var encounter_key: String = battle_id.strip_edges() if not battle_id.strip_edges().is_empty() else GameConfig.get_string("domains.world_boss", "entity_defaults/boss_uid", "BOSS_ENCOUNTER_01")
	if _encounter_bosses.has(encounter_key):
		return _encounter_bosses[encounter_key] as WorldBossAggregate
	var boss_entity := WorldBossAggregate.new()
	boss_entity.boss_uid = encounter_key
	boss_entity.total_phases = maxi(1, GameConfig.get_int("domains.world_boss", "entity_defaults/total_phases", 3))
	boss_entity.current_phase_index = maxi(1, GameConfig.get_int("domains.world_boss", "entity_defaults/current_phase_index", 1))
	boss_entity.phase_max_hp = maxf(1.0, GameConfig.get_float("domains.world_boss", "entity_defaults/phase_max_hp", 10000.0))
	boss_entity.phase_current_hp = maxf(0.0, GameConfig.get_float("domains.world_boss", "entity_defaults/phase_current_hp", boss_entity.phase_max_hp))
	boss_entity.mechanism_shield_hp = maxf(0.0, GameConfig.get_float("domains.world_boss", "entity_defaults/mechanism_shield_hp", 0.0))
	_encounter_bosses[encounter_key] = boss_entity
	return boss_entity

## 获取当前战斗快照（首领多阶段血量、护盾与玩家基础状态）
func get_combat_snapshot_async(battle_id: String, result_callback: Callable) -> void:
	var active_boss := _resolve_or_create_boss(battle_id)
	var player_base_hp: float = GameConfig.get_float("domains.combat", "player_defaults/hp_max", 1000.0)
	if not result_callback.is_valid():
		return
	result_callback.call({
		"success": true,
		"battle_id": active_boss.boss_uid,
		"boss_uid": active_boss.boss_uid,
		"current_phase": active_boss.current_phase_index,
		"total_phases": active_boss.total_phases,
		"boss_hp": active_boss.phase_current_hp,
		"boss_max_hp": active_boss.phase_max_hp,
		"shield_hp": active_boss.mechanism_shield_hp,
		"defeated": active_boss.is_defeated,
		"player_hp": player_base_hp,
		"player_max_hp": player_base_hp,
	})

## 执行技能打击结算并经首领转相状态机推进战况
func cast_skill_async(skill_id: String, target_id: String, result_callback: Callable) -> void:
	var active_boss := _resolve_or_create_boss(target_id)
	var base_skill_damage: float = GameConfig.get_float("domains.combat", "damage_defaults/base_skill_damage", 250.0)
	var damage_outcome: Dictionary = ConfigurablePhaseTransitionFSM.apply_boss_damage(active_boss, "PLAYER", base_skill_damage)
	if not result_callback.is_valid():
		return
	result_callback.call({
		"success": not active_boss.is_defeated or float(damage_outcome.get("actual_damage", 0.0)) > 0.0,
		"skill_id": skill_id,
		"target_id": active_boss.boss_uid,
		"actual_damage": float(damage_outcome.get("actual_damage", 0.0)),
		"phase_current_hp": float(damage_outcome.get("phase_current_hp", active_boss.phase_current_hp)),
		"current_phase": int(damage_outcome.get("current_phase", active_boss.current_phase_index)),
		"phase_transition": bool(damage_outcome.get("phase_transition", false)),
		"defeated": bool(damage_outcome.get("defeated", active_boss.is_defeated)),
		"error_code": str(damage_outcome.get("error_code", "")),
	})
