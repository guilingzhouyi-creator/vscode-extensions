# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/magic_settlement_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 单次攻击伤害解析的纯适配层——统一收口物理/魔法行动卡伤害到既有真实 管线入口（物理侵彻/魔素相变能损），供几重化等多击事务逐击调用。 Phase 42 收编声明：**不再自算 base_power × rank_weight 虚拟伤害**。本结算器为 纯适配层——物理/魔法伤害全部经既有真实管线入口： - 物理：PhysicsAndThermodynamicsSolver.calculate_penetration_damage（动量侵彻公式） - 魔法：PhysicsAndThermodynamicsSolver.calculate_mana_phase_transition_loss（相变能损） → 有效魔素输出 × (1 - 元素抗性)，能量密度伤害公式的引擎落地部分 魔法效果（几重化/封印/升格/延时）作为效果层由调用方按 combat_card.effects 分发， 本适配层只负责单次攻击的伤害解析（确定性：随机经 DeterministicRNG 注入）。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicSettlementSolver
extends RefCounted

const FORM_PRIMORDIAL: int = PhysicalVerbRegistry.MagicForm.PRIMORDIAL

## 单次攻击伤害解析（纯适配，经真实管线）：
##   card : 权威行动卡 CombatActionCardEntity（verb_type/base_potency/magic_form 驱动）
##   rank : 当前位阶（1~11，独立维度；作为上下文供未来技能路径权重扩展）
##   ctx  : { weapon_mass_kg, weapon_velocity, edge_sharpness, effective_armor,
##            is_magic, raw_mana, sentence_count, projection_distance_m, resist_elem }
## 返回 { success, damage, via_pipeline, rank, verb_type }
static func resolve_attack(
	card: PhysicalVerbRegistry.CombatActionCardEntity,
	rank: int,
	ctx: Dictionary = {}
) -> Dictionary:
	if card == null:
		return {"success": false, "error_code": "CARD_NOT_DEFINED"}
	var is_magic := bool(ctx.get("is_magic", false)) or not card.magic_ref.is_empty()
	if is_magic:
		return _resolve_magic(card, rank, ctx)
	return _resolve_physical(card, rank, ctx)

## 物理伤害：直接委托既有动量侵彻管线（零旁路公式）
static func _resolve_physical(
	card: PhysicalVerbRegistry.CombatActionCardEntity,
	rank: int,
	ctx: Dictionary
) -> Dictionary:
	var mass := float(ctx.get("weapon_mass_kg", 2.5))
	var velocity := float(ctx.get("weapon_velocity", 6.0))
	var edge := float(ctx.get("edge_sharpness", 1.2))
	var armor := float(ctx.get("effective_armor", 5.0))
	var damage := PhysicsAndThermodynamicsSolver.calculate_penetration_damage(
		mass, velocity, card.verb_type, edge, armor
	)
	return {
		"success": true,
		"damage": damage,
		"via_pipeline": "calculate_penetration_damage",
		"rank": clampi(int(rank), 1, 11),
		"verb_type": card.verb_type,
	}

## 魔法伤害：魔素相变能损（真实管线）→ 有效魔素输出 × (1 - 元素抗性)
static func _resolve_magic(
	card: PhysicalVerbRegistry.CombatActionCardEntity,
	rank: int,
	ctx: Dictionary
) -> Dictionary:
	var raw_mana := float(ctx.get("raw_mana", card.base_potency))
	var is_primordial := int(card.magic_form) == FORM_PRIMORDIAL
	var sentence_count := int(ctx.get("sentence_count", 0))
	var distance_m := float(ctx.get("projection_distance_m", 0.0))
	var phase := PhysicsAndThermodynamicsSolver.calculate_mana_phase_transition_loss(
		raw_mana, is_primordial, sentence_count, distance_m
	)
	var resist := clampf(float(ctx.get("resist_elem", 0.0)), 0.0, 1.0)
	var damage := float(phase.get("effective_output", 0.0)) * (1.0 - resist)
	return {
		"success": true,
		"damage": damage,
		"via_pipeline": "calculate_mana_phase_transition_loss",
		"effective_output": float(phase.get("effective_output", 0.0)),
		"total_loss_ratio": float(phase.get("total_loss_ratio", 0.0)),
		"rank": clampi(int(rank), 1, 11),
		"magic_form": int(card.magic_form),
	}
