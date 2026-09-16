# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_hand_generator.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 严格分离手牌数量随机与牌型抽取，支持首次遇敌与后续回合规则分流，支持合法 0 手牌
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CombatHandGenerator
extends RefCounted

const CombatHandDrawDTOClass = preload("res://backend/domains/physics_thermodynamics/combat_hand_draw_dto.gd")
const PhysicalVerbRegistryClass = preload("res://backend/domains/physics_thermodynamics/physical_verb_registry.gd")

## 阶段 A：计算基础发牌数量 (严格区分首次遇敌与后续回合)
static func evaluate_base_hand_count(
	is_first_encounter: bool,
	rng: DeterministicRNG
) -> int:
	if is_first_encounter:
		var first_min := GameConfig.get_int("domains.combat", "round_hand/first_encounter_min", 3)
		var first_max := GameConfig.get_int("domains.combat", "round_hand/first_encounter_max", 4)
		return rng.randi_range(first_min, first_max) if rng else first_min

	# 后续普通回合：数量随机抽取 (理论下限 >= 1)
	var count_weights: Dictionary = GameConfig.get_dict("domains.combat", "round_hand/hand_count_distribution", {
		"1": 0.25,
		"2": 0.50,
		"3": 0.20,
		"4": 0.05
	})
	return _sample_discrete_distribution(count_weights, rng, 1)

## 阶段 B：应用特殊效果流水线修正数量 (合法产生 0 手牌)
static func apply_special_modifiers(
	base_count: int,
	modifiers: Array[Dictionary]
) -> Dictionary:
	var delta := 0
	var applied_ids: Array[String] = []
	for mod in modifiers:
		var m_id: String = mod.get("modifier_id", "")
		var m_delta: int = int(mod.get("hand_count_delta", 0))
		var is_absolute_zero: bool = bool(mod.get("force_zero_hand", false))
		if is_absolute_zero:
			applied_ids.append(m_id)
			return {"final_count": 0, "modifier_delta": -base_count, "applied": applied_ids}
		delta += m_delta
		applied_ids.append(m_id)

	var final_count := maxi(0, base_count + delta)
	return {"final_count": final_count, "modifier_delta": delta, "applied": applied_ids}

## 阶段 C：根据最终数量执行卡池实体实例化 (牌型随机)
static func draw_cards_for_turn(
	spec: CombatHandDrawDTO.HandDrawSpecDTO,
	rng: DeterministicRNG
) -> CombatHandDrawDTO.HandDrawResultDTO:
	var res: CombatHandDrawDTO.HandDrawResultDTO = CombatHandDrawDTOClass.HandDrawResultDTO.new()
	res.base_random_count = evaluate_base_hand_count(spec.is_first_encounter, rng)

	var mod_res := apply_special_modifiers(res.base_random_count, spec.special_modifiers)
	res.final_draw_count = mod_res.final_count
	res.modifier_delta = mod_res.modifier_delta
	res.applied_modifiers = mod_res.applied
	res.is_zero_hand_state = (res.final_draw_count == 0)

	# 牌型随机抽取与实例创建
	var drawn_cards: Array = []
	for i in range(res.final_draw_count):
		var card := _instantiate_card_from_pool(rng)
		card.card_id = "CARD_GEN_%d_%d" % [spec.current_round, i + 1]
		drawn_cards.append(card)
	res.actual_cards = drawn_cards
	return res

## 离散概率分布采样求解器
static func _sample_discrete_distribution(weights: Dictionary, rng: DeterministicRNG, default_val: int) -> int:
	if weights.is_empty():
		return default_val
	var roll := (rng.randf() if rng else 0.5)
	var accum := 0.0
	for k in weights.keys():
		accum += float(weights[k])
		if roll <= accum:
			return int(k)
	return default_val

## 动态卡池实体实例化
static func _instantiate_card_from_pool(rng: DeterministicRNG) -> PhysicalVerbRegistry.CombatActionCardEntity:
	var card := PhysicalVerbRegistryClass.CombatActionCardEntity.new()
	var verbs: Array = ["STAB", "SLASH", "UPPER", "PARRY", "BLOCK"]
	var pick := rng.randi_range(0, verbs.size() - 1) if rng else 0
	card.verb_type = verbs[pick]
	card.card_name = "招式牌·%s" % card.verb_type
	card.ap_cost = GameConfig.get_int("domains.combat", "verbs/%s/base_ap" % card.verb_type, -2)
	card.base_potency = GameConfig.get_float("domains.combat", "card_defaults/base_potency", 20.0)
	return card
