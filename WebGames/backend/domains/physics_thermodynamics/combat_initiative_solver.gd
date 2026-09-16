# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_initiative_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 依据双方角色综合属性（敏捷/感知/等级加权 + 装备修正 + 状态增益 + 确定性抖动） 计算先手权与初始 AP 势能差值，并提供三级平局决胜（Tie-breaker）算法。 配置由 config/domains/combat.json initiative_model 驱动，代码零硬编码。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CombatInitiativeSolver
extends RefCounted

class ParticipantInitiativeSpec extends RefCounted:
	var participant_id: String = ""
	var name: String = ""
	var is_player: bool = true
	var base_agility: float = 10.0
	var base_perception: float = 10.0
	var level: int = 1
	var equip_speed_modifier: float = 0.0       # 装备重量/轻灵词缀加成
	var temporary_buff_modifier: float = 0.0     # 状态栏速度/先手修正
	var calculated_score: float = 0.0
	var initial_ap_bonus: int = 0
	var is_first_mover: bool = false

	## 序列化参与者先手规格为字典
	func to_dto() -> Dictionary:
		return {
			"participant_id": participant_id,
			"name": name,
			"is_player": is_player,
			"base_agility": base_agility,
			"base_perception": base_perception,
			"level": level,
			"equip_speed_modifier": equip_speed_modifier,
			"temporary_buff_modifier": temporary_buff_modifier,
			"calculated_score": calculated_score,
			"initial_ap_bonus": initial_ap_bonus,
			"is_first_mover": is_first_mover,
		}

	## 从字典重建参与者规格（缺省回退默认值）
	static func from_dto(data: Dictionary) -> ParticipantInitiativeSpec:
		var spec := ParticipantInitiativeSpec.new()
		spec.participant_id = str(data.get("participant_id", ""))
		spec.name = str(data.get("name", ""))
		spec.is_player = bool(data.get("is_player", true))
		spec.base_agility = float(data.get("base_agility", 10.0))
		spec.base_perception = float(data.get("base_perception", 10.0))
		spec.level = int(data.get("level", 1))
		spec.equip_speed_modifier = float(data.get("equip_speed_modifier", 0.0))
		spec.temporary_buff_modifier = float(data.get("temporary_buff_modifier", 0.0))
		spec.calculated_score = float(data.get("calculated_score", 0.0))
		spec.initial_ap_bonus = int(data.get("initial_ap_bonus", 0))
		spec.is_first_mover = bool(data.get("is_first_mover", false))
		return spec

class BattleInitiativeResultDTO extends RefCounted:
	var first_mover_id: String = ""
	var tie_broken_by: String = "NONE"          # "SCORE" / "AGI_FALLBACK" / "RNG_TIEBREAKER"
	var player_spec: ParticipantInitiativeSpec = null
	var enemy_spec: ParticipantInitiativeSpec = null
	var initial_ap_diff: int = 0
	var seed_used: int = 0
	var start_utc: int = 0

	## 序列化先手判定结果为字典（规格嵌套 DTO）
	func to_dto() -> Dictionary:
		return {
			"first_mover_id": first_mover_id,
			"tie_broken_by": tie_broken_by,
			"player": player_spec.to_dto() if player_spec else {},
			"enemy": enemy_spec.to_dto() if enemy_spec else {},
			"initial_ap_diff": initial_ap_diff,
			"seed_used": seed_used,
			"start_utc": start_utc,
		}

## 先手综合判定：属性加权 + 装备/状态修正 + 确定性抖动，三级平局决胜（SCORE/AGI/RNG）
static func evaluate_initiative(
	player: ParticipantInitiativeSpec,
	enemy: ParticipantInitiativeSpec,
	rng: DeterministicRNG
) -> BattleInitiativeResultDTO:
	var result := BattleInitiativeResultDTO.new()
	result.player_spec = player
	result.enemy_spec = enemy
	result.seed_used = rng.get_state() if rng else 0
	result.start_utc = int(Time.get_unix_time_from_system())

	var w_agi := GameConfig.get_float("domains.combat", "initiative_model/weight_agility", 1.0)
	var w_per := GameConfig.get_float("domains.combat", "initiative_model/weight_perception", 0.8)
	var w_lvl := GameConfig.get_float("domains.combat", "initiative_model/weight_level", 0.5)
	var jitter_min := GameConfig.get_int("domains.combat", "initiative_model/jitter_min", -2)
	var jitter_max := GameConfig.get_int("domains.combat", "initiative_model/jitter_max", 2)
	var ap_lead_bonus := GameConfig.get_int("domains.combat", "initiative_model/lead_ap_bonus", 2)

	var p_base := player.base_agility * w_agi + player.base_perception * w_per + float(player.level) * w_lvl
	var e_base := enemy.base_agility * w_agi + enemy.base_perception * w_per + float(enemy.level) * w_lvl

	var p_mod := 1.0 + player.equip_speed_modifier + player.temporary_buff_modifier
	var e_mod := 1.0 + enemy.equip_speed_modifier + enemy.temporary_buff_modifier

	var p_jitter := float(rng.randi_range(jitter_min, jitter_max)) if rng else 0.0
	var e_jitter := float(rng.randi_range(jitter_min, jitter_max)) if rng else 0.0

	player.calculated_score = (p_base * p_mod) + p_jitter
	enemy.calculated_score = (e_base * e_mod) + e_jitter

	# 胜负与平局决胜判定 (Tie-Breaker)
	if abs(player.calculated_score - enemy.calculated_score) > 0.001:
		if player.calculated_score > enemy.calculated_score:
			result.first_mover_id = player.participant_id
			result.tie_broken_by = "SCORE"
			player.is_first_mover = true
			player.initial_ap_bonus = ap_lead_bonus
			result.initial_ap_diff = ap_lead_bonus
		else:
			result.first_mover_id = enemy.participant_id
			result.tie_broken_by = "SCORE"
			enemy.is_first_mover = true
			enemy.initial_ap_bonus = ap_lead_bonus
			result.initial_ap_diff = -ap_lead_bonus
	else:
		# 二级决胜：纯敏捷比对
		if abs(player.base_agility - enemy.base_agility) > 0.001:
			if player.base_agility > enemy.base_agility:
				result.first_mover_id = player.participant_id
				result.tie_broken_by = "AGI_FALLBACK"
				player.is_first_mover = true
				player.initial_ap_bonus = 1
				result.initial_ap_diff = 1
			else:
				result.first_mover_id = enemy.participant_id
				result.tie_broken_by = "AGI_FALLBACK"
				enemy.is_first_mover = true
				enemy.initial_ap_bonus = 1
				result.initial_ap_diff = -1
		else:
			# 三级决胜：50/50 确定性随机硬币
			var coin := rng.randi_range(0, 1) if rng else 0
			if coin == 0:
				result.first_mover_id = player.participant_id
				result.tie_broken_by = "RNG_TIEBREAKER"
				player.is_first_mover = true
				player.initial_ap_bonus = 1
				result.initial_ap_diff = 1
			else:
				result.first_mover_id = enemy.participant_id
				result.tie_broken_by = "RNG_TIEBREAKER"
				enemy.is_first_mover = true
				enemy.initial_ap_bonus = 1
				result.initial_ap_diff = -1

	return result
