# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_hand_generator.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 严格分离手牌数量随机与牌型抽取，支持首次遇敌与后续回合规则分流，支持合法 0 手牌
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## CombatHandGenerator：Domain Logic Component
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
	for modifier in modifiers:
		var modifier_id: String = modifier.get("modifier_id", "")
		var modifier_delta: int = int(modifier.get("hand_count_delta", 0))
		var is_absolute_zero: bool = bool(modifier.get("force_zero_hand", false))
		if is_absolute_zero:
			applied_ids.append(modifier_id)
			return {"final_count": 0, "modifier_delta": -base_count, "applied": applied_ids}
		delta += modifier_delta
		applied_ids.append(modifier_id)

	var final_count := maxi(0, base_count + delta)
	return {"final_count": final_count, "modifier_delta": delta, "applied": applied_ids}

## 阶段 C：根据最终数量执行卡池实体实例化 (牌型随机)
static func draw_cards_for_turn(
	draw_specification: CombatHandDrawDTO.HandDrawSpecDTO,
	rng: DeterministicRNG
) -> CombatHandDrawDTO.HandDrawResultDTO:
	var draw_result: CombatHandDrawDTO.HandDrawResultDTO = CombatHandDrawDTOClass.HandDrawResultDTO.new()
	draw_result.base_random_count = evaluate_base_hand_count(draw_specification.is_first_encounter, rng)

	var modifier_result := apply_special_modifiers(draw_result.base_random_count, draw_specification.special_modifiers)
	draw_result.final_draw_count = modifier_result.final_count
	draw_result.modifier_delta = modifier_result.modifier_delta
	draw_result.applied_modifiers = modifier_result.applied
	draw_result.is_zero_hand_state = (draw_result.final_draw_count == 0)

	# 牌型随机抽取与实例创建
	var drawn_cards: Array = []
	for card_index in range(draw_result.final_draw_count):
		var card := _instantiate_card_from_pool(rng)
		card.card_id = "CARD_GEN_%d_%d" % [draw_specification.current_round, card_index + 1]
		drawn_cards.append(card)
	draw_result.actual_cards = drawn_cards
	return draw_result

## 离散概率分布采样求解器
static func _sample_discrete_distribution(weights: Dictionary, rng: DeterministicRNG, default_count: int) -> int:
	if weights.is_empty():
		return default_count
	var roll := (rng.randf() if rng else 0.5)
	var cumulative_weight := 0.0
	for count_key in weights.keys():
		cumulative_weight += float(weights[count_key])
		if roll <= cumulative_weight:
			return int(count_key)
	return default_count

## 动态卡池实体实例化（优先消费 MOD/配置中的 skill_cards，缺失时按 domains.combat#verbs 动态抽取）
static func _instantiate_card_from_pool(rng: DeterministicRNG) -> PhysicalVerbRegistry.CombatActionCardEntity:
	var card := PhysicalVerbRegistryClass.CombatActionCardEntity.new()
	var skill_cards: Array = GameConfig.get_array("domains.combat.mechanics", "skill_cards", [])
	if not skill_cards.is_empty():
		var card_pick: int = rng.randi_range(0, skill_cards.size() - 1) if rng else 0
		var raw_card: Variant = skill_cards[card_pick]
		if raw_card is Dictionary:
			var card_spec := raw_card as Dictionary
			var verb_code := String(card_spec.get("verb", card_spec.get("verb_type", "SLASH"))).strip_edges().to_upper()
			if verb_code.is_empty():
				verb_code = "SLASH"
			card.verb_type = verb_code
			var display_name := String(card_spec.get("name", card_spec.get("card_name", card_spec.get("card_id", "")))).strip_edges()
			card.card_name = display_name if not display_name.is_empty() else "招式牌·%s" % card.verb_type
			var fallback_ap: int = GameConfig.get_int("domains.combat", "verbs/%s/base_ap" % card.verb_type, -2)
			var fallback_potency: float = GameConfig.get_float("domains.combat", "card_defaults/base_potency", 20.0)
			card.ap_cost = int(card_spec.get("ap_cost", fallback_ap))
			card.base_potency = float(card_spec.get("base_potency", card_spec.get("potency", fallback_potency)))
			return card

	var verbs_table: Dictionary = GameConfig.get_dict("domains.combat", "verbs", {})
	var verbs: Array = []
	for verb_key_variant in verbs_table.keys():
		var verb_key := String(verb_key_variant)
		if verb_key != "_fallback" and not verb_key.is_empty():
			verbs.append(verb_key)
	if verbs.is_empty():
		verbs = ["STAB", "SLASH", "UPPER", "PARRY", "BLOCK"]
	var pick := rng.randi_range(0, verbs.size() - 1) if rng else 0
	card.verb_type = String(verbs[pick])
	card.card_name = "招式牌·%s" % card.verb_type
	card.ap_cost = GameConfig.get_int("domains.combat", "verbs/%s/base_ap" % card.verb_type, -2)
	card.base_potency = GameConfig.get_float("domains.combat", "card_defaults/base_potency", 20.0)
	return card
