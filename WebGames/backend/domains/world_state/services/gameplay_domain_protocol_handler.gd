# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/gameplay_domain_protocol_handler.gd
# 架构定位: Domain Protocol Action Handler / Core Gameplay Domains
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: WorldSessionRuntimeService, WorldBossAggregate, GachaProbabilitySolver, EquipmentEnhancementSolver, MapAndEcologySolver
# 职责说明: 承接 combat/economy/gacha/quest/crafting/grimoire/monster_ecology/world_navigation 统一协议动作并同步运行时会话状态。
# 退出语义与设计依据: 统一协议全域路由与权威会话状态同步契约 (Inv-FE-BE-CONTRACT-1)
# ==============================================================================

## GameplayDomainProtocolHandler：核心玩法域统一协议分发处理器
class_name GameplayDomainProtocolHandler
extends RefCounted

static var _boss_encounters: Dictionary = {}
static var _quest_records: Dictionary = {}
static var _authored_books: Array = []
static var _combat_config_version: int = -1
static var _cached_default_hp: float = 1000.0
static var _cached_default_ap_cost: float = 2.0
static var _cached_base_skill_damage: float = 250.0
static var _cached_sell_back_ratio: float = 0.70
static var _cached_gacha_pull_cost: int = 160

static func _sync_gameplay_config_cache() -> void:
	var current_version := GameConfig.config_reload_version()
	if _combat_config_version == current_version:
		return
	_cached_default_hp = GameConfig.get_float("domains.combat", "player_defaults/hp_max", 1000.0)
	_cached_default_ap_cost = float(abs(GameConfig.get_int("domains.combat", "card_defaults/ap_cost", -2)))
	_cached_base_skill_damage = GameConfig.get_float("domains.combat", "damage_defaults/base_skill_damage", 250.0)
	_cached_sell_back_ratio = clampf(GameConfig.get_float("domains.economy", "shop/sell_back_ratio", 0.70), 0.05, 1.0)
	_cached_gacha_pull_cost = maxi(1, GameConfig.get_int("domains.gacha", "banner_defaults/cost_per_pull_gold", 160))
	_combat_config_version = current_version

## 分发核心玩法领域客户端协议动作并返回统一响应包
static func dispatch(request: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
	var payload_map: Dictionary = request.payload if request.payload is Dictionary else {}
	match request.domain:
		"combat":
			return _handle_combat(request.request_id, request.action_type, payload_map)
		"economy":
			return _handle_economy(request.request_id, request.action_type, payload_map)
		"gacha":
			return _handle_gacha(request.request_id, request.action_type, payload_map)
		"quest":
			return _handle_quest(request.request_id, request.action_type, payload_map)
		"crafting":
			return _handle_crafting(request.request_id, request.action_type, payload_map)
		"grimoire":
			return _handle_grimoire(request.request_id, request.action_type, payload_map)
		"monster_ecology":
			return _handle_ecology(request.request_id, request.action_type, payload_map)
		"world_navigation":
			return _handle_navigation(request.request_id, request.action_type, payload_map)
	return UnifiedProtocolFactory.create_unhandled_action_response(request.request_id, request.action_type)

static func _resolve_boss(battle_identifier: String) -> WorldBossAggregate:
	var clean_key := battle_identifier.strip_edges()
	if clean_key.is_empty():
		clean_key = GameConfig.get_string("domains.world_boss", "entity_defaults/boss_uid", "BOSS_ENCOUNTER_01")
	if _boss_encounters.has(clean_key):
		return _boss_encounters[clean_key] as WorldBossAggregate
	var boss_entity := WorldBossAggregate.new()
	boss_entity.boss_uid = clean_key
	boss_entity.total_phases = maxi(1, GameConfig.get_int("domains.world_boss", "entity_defaults/total_phases", 3))
	boss_entity.current_phase_index = maxi(1, GameConfig.get_int("domains.world_boss", "entity_defaults/current_phase_index", 1))
	boss_entity.phase_max_hp = maxf(1.0, GameConfig.get_float("domains.world_boss", "entity_defaults/phase_max_hp", 10000.0))
	boss_entity.phase_current_hp = maxf(0.0, GameConfig.get_float("domains.world_boss", "entity_defaults/phase_current_hp", boss_entity.phase_max_hp))
	boss_entity.mechanism_shield_hp = maxf(0.0, GameConfig.get_float("domains.world_boss", "entity_defaults/mechanism_shield_hp", 0.0))
	_boss_encounters[clean_key] = boss_entity
	return boss_entity

static func _handle_combat(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	_sync_gameplay_config_cache()
	var boss_entity := _resolve_boss(str(payload_map.get("target_id", "")))
	var has_active_world := WorldSessionRuntimeService.has_active_world()
	if action_type == "GET_COMBAT_SNAPSHOT":
		var default_health := _cached_default_hp
		return UnifiedProtocolFactory.create_response(request_id, true, {
			"battle_id": boss_entity.boss_uid,
			"boss_uid": boss_entity.boss_uid,
			"current_phase": boss_entity.current_phase_index,
			"total_phases": boss_entity.total_phases,
			"boss_hp": boss_entity.phase_current_hp,
			"boss_max_hp": boss_entity.phase_max_hp,
			"shield_hp": boss_entity.mechanism_shield_hp,
			"defeated": boss_entity.is_defeated,
			"player_hp": WorldSessionRuntimeService.get_hp_current() if has_active_world else default_health,
			"player_max_hp": WorldSessionRuntimeService.get_hp_max() if has_active_world else default_health,
			"player_mp": WorldSessionRuntimeService.get_mp_current() if has_active_world else 50.0,
			"player_ap": WorldSessionRuntimeService.get_ap_current() if has_active_world else 10.0,
		}, "", "Combat snapshot resolved")
	if action_type == "CAST_SKILL":
		var skill_identifier := str(payload_map.get("skill_id", "")).strip_edges()
		var default_ap_cost := _cached_default_ap_cost
		var action_point_cost := maxf(0.0, float(payload_map.get("ap_cost", default_ap_cost)))
		var base_damage := float(payload_map.get("base_damage", _cached_base_skill_damage))
		var mana_point_cost := maxf(0.0, float(payload_map.get("mp_cost", maxf(5.0, default_ap_cost * 2.5))))
		var damage_multiplier := clampf(float(payload_map.get("skill_multiplier", 1.0)), 0.1, 10.0)
		if has_active_world:
			WorldSessionRuntimeService.apply_mutation_and_sync({"ap_delta": - action_point_cost, "mp_delta": - mana_point_cost, "cause": skill_identifier}, -1, false)
		var damage_outcome := ConfigurablePhaseTransitionFSM.apply_boss_damage(boss_entity, "PLAYER", base_damage * damage_multiplier)
		return UnifiedProtocolFactory.create_response(request_id, true, {
			"skill_id": skill_identifier,
			"target_id": boss_entity.boss_uid,
			"actual_damage": float(damage_outcome.get("actual_damage", 0.0)),
			"phase_current_hp": float(damage_outcome.get("phase_current_hp", boss_entity.phase_current_hp)),
			"boss_hp": boss_entity.phase_current_hp,
			"current_phase": boss_entity.current_phase_index,
			"defeated": boss_entity.is_defeated,
		}, "", "Skill cast executed")
	return UnifiedProtocolFactory.create_unhandled_action_response(request_id, action_type)

static func _handle_economy(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	_sync_gameplay_config_cache()
	var has_active_world := WorldSessionRuntimeService.has_active_world()
	var current_gold := WorldSessionRuntimeService.get_wallet_gold() if has_active_world else int(payload_map.get("wallet_gold", 0))
	if action_type == "SHOP_BUY" or action_type == "AUCTION_BUYOUT" or action_type == "AUCTION_BID":
		var unit_price := maxi(0, int(payload_map.get("unit_price", 0)))
		var purchase_count := maxi(1, int(payload_map.get("quantity", 1)))
		var total_cost := unit_price * purchase_count
		if has_active_world and current_gold < total_cost:
			return UnifiedProtocolFactory.create_response(request_id, false, {"wallet_gold": current_gold}, "ERR_INSUFFICIENT_GOLD", "Insufficient gold for purchase")
		var updated_gold := current_gold - total_cost
		if has_active_world:
			var snapshot_after := WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": - total_cost, "reason": action_type}, -1, false)
			updated_gold = snapshot_after.wallet_gold
		return UnifiedProtocolFactory.create_response(request_id, true, {"wallet_gold": updated_gold, "delta_gold": - total_cost}, "", "Economy debit completed")
	if action_type == "SHOP_SELL":
		var unit_price := maxi(0, int(payload_map.get("unit_price", 0)))
		var sell_count := maxi(1, int(payload_map.get("quantity", 1)))
		var payout_gold := int(round(float(unit_price * sell_count) * _cached_sell_back_ratio))
		var updated_gold := current_gold + payout_gold
		if has_active_world:
			var snapshot_after := WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": payout_gold, "reason": "SHOP_SELL"}, -1, false)
			updated_gold = snapshot_after.wallet_gold
		return UnifiedProtocolFactory.create_response(request_id, true, {"wallet_gold": updated_gold, "delta_gold": payout_gold}, "", "Shop sell settled")
	if action_type == "EXCHANGE_CURRENCY":
		var delta_gold := int(payload_map.get("delta_gold", 0))
		var delta_crystals := int(payload_map.get("delta_crystals", 0))
		if has_active_world:
			var snapshot_after := WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": delta_gold, "wallet_mana_monocrystals_delta": delta_crystals, "reason": "EXCHANGE_CURRENCY"}, -1, false)
			return UnifiedProtocolFactory.create_response(request_id, true, {"wallet_gold": snapshot_after.wallet_gold, "wallet_mana_monocrystals": snapshot_after.wallet_mana_monocrystals}, "", "Currency exchange settled")
		return UnifiedProtocolFactory.create_response(request_id, true, {"wallet_gold": maxi(0, current_gold + delta_gold)}, "", "Currency exchange settled")
	return UnifiedProtocolFactory.create_unhandled_action_response(request_id, action_type)

static func _handle_gacha(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	_sync_gameplay_config_cache()
	if action_type == "PULL_GACHA":
		var pull_count := maxi(1, int(payload_map.get("pull_count", 1)))
		var total_cost := _cached_gacha_pull_cost * pull_count
		var has_active_world := WorldSessionRuntimeService.has_active_world()
		var current_gold := WorldSessionRuntimeService.get_wallet_gold() if has_active_world else total_cost
		if has_active_world and current_gold < total_cost:
			return UnifiedProtocolFactory.create_response(request_id, false, {"wallet_gold": current_gold}, "ERR_INSUFFICIENT_CURRENCY", "Insufficient currency for wish")
		if has_active_world:
			WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": - total_cost, "reason": "PULL_GACHA"}, -1, false)
		return UnifiedProtocolFactory.create_response(request_id, true, {"pull_count": pull_count, "spent": total_cost, "rate_5star": GachaProbabilitySolver.calculate_current_5star_rate(pull_count)}, "", "Gacha pull settled")
	return UnifiedProtocolFactory.create_unhandled_action_response(request_id, action_type)

static func _handle_quest(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	var quest_identifier := str(payload_map.get("quest_id", "")).strip_edges()
	if action_type == "ACCEPT_BOUNTY" or action_type == "TRANSITION_QUEST":
		var target_status := str(payload_map.get("next_status", "ACTIVE"))
		if not quest_identifier.is_empty():
			_quest_records[quest_identifier] = target_status
		return UnifiedProtocolFactory.create_response(request_id, true, {"quest_id": quest_identifier, "status": target_status}, "", "Quest state updated")
	if action_type == "GET_QUESTS":
		return UnifiedProtocolFactory.create_response(request_id, true, {"quest_states": _quest_records.duplicate()}, "", "Quest states queried")
	return UnifiedProtocolFactory.create_unhandled_action_response(request_id, action_type)

static func _handle_crafting(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	if action_type == "CRAFT_RECIPE" or action_type == "ENHANCE_EQUIPMENT":
		var target_level := maxi(0, int(payload_map.get("target_level", 1)))
		var enhance_cost := EquipmentEnhancementSolver.calculate_enhance_cost(maxi(0, target_level - 1))
		var gold_cost := int(enhance_cost.get("gold_cost", 0))
		if WorldSessionRuntimeService.has_active_world() and gold_cost > 0:
			WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": - gold_cost, "reason": action_type}, -1, false)
		return UnifiedProtocolFactory.create_response(request_id, true, {"action": action_type, "gold_cost": gold_cost, "crystal_cost": int(enhance_cost.get("crystal_cost", 0))}, "", "Workshop operation executed")
	if action_type == "DISMANTLE_ITEM":
		var refund_gold := maxi(10, int(payload_map.get("refund_gold", 25)))
		if WorldSessionRuntimeService.has_active_world():
			WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": refund_gold, "reason": "DISMANTLE_ITEM"}, -1, false)
		return UnifiedProtocolFactory.create_response(request_id, true, {"refund_gold": refund_gold}, "", "Dismantle completed")
	return UnifiedProtocolFactory.create_unhandled_action_response(request_id, action_type)

static func _handle_grimoire(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	if action_type == "PUBLISH_GRIMOIRE" or action_type == "LEARN_GRIMOIRE" or action_type == "COMPILE_AST":
		var book_identifier := str(payload_map.get("book_id", "GRIM_CUSTOM"))
		_authored_books.append({"book_id": book_identifier, "action": action_type})
		return UnifiedProtocolFactory.create_response(request_id, true, {"book_id": book_identifier, "authored_count": _authored_books.size()}, "", "Grimoire operation completed")
	if action_type == "CLAIM_ROYALTIES":
		var claim_amount := maxi(0, int(payload_map.get("amount", 0)))
		if WorldSessionRuntimeService.has_active_world() and claim_amount > 0:
			WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": claim_amount, "reason": "CLAIM_ROYALTIES"}, -1, false)
		return UnifiedProtocolFactory.create_response(request_id, true, {"claimed_gold": claim_amount}, "", "Grimoire royalties claimed")
	return UnifiedProtocolFactory.create_unhandled_action_response(request_id, action_type)

static func _handle_ecology(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	var risk_score := MapAndEcologySolver.evaluate_beast_swarm_risk(float(payload_map.get("mana_density", 1.2)), float(payload_map.get("public_order", 80.0)))
	return UnifiedProtocolFactory.create_response(request_id, true, {"action": action_type, "swarm_risk": risk_score}, "", "Ecology directive processed")

static func _handle_navigation(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	if action_type == "ADVANCE_MARCH":
		var hours := maxi(1, int(payload_map.get("hours", 1)))
		if WorldSessionRuntimeService.has_active_world():
			WorldSessionRuntimeService.apply_mutation_and_sync({"clock_hours_delta": hours}, -1, false)
	return UnifiedProtocolFactory.create_response(request_id, true, {"action": action_type}, "", "World navigation directive processed")
