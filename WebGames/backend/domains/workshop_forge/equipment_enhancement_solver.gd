# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/workshop_forge/equipment_enhancement_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy | 配置: config/domains/workshop.json | 信号: EventBus 领域广播
# 职责说明: +1 ~ +15 装备强化概率衰减、保护符防降级与属性阶梯倍率提升 概率表/成本公式/倍率由 config/domains/workshop.json 驱动，文案由 narratives/workshop.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name EquipmentEnhancementSolver extends RefCounted

static var _completed_transactions: Dictionary = {}

## S3-03 有界保留：超容量按插入序裁剪最旧记录（内存有界，防无限增长）
static func _prune_completed() -> void:
	# P4：单次 keys 快照裁剪最旧溢出项（消除 while keys()[0] 每轮重建的 O(k×N)）
	FifoBudget.trim_oldest(_completed_transactions, GameConfig.get_int("infrastructure.admin", "idempotency/max_records", 1000))

## 强化上限等级（enhancement/max_level 配置，默认 15）
static func _max_level() -> int:
	return GameConfig.get_int("domains.workshop", "enhancement/max_level", 15)

## 成功率表（enhancement/success_rates 配置，按目标等级索引）
static func _success_rates() -> Dictionary:
	return GameConfig.get_dict("domains.workshop", "enhancement/success_rates", {})

## 未登记等级回退成功率（enhancement/fallback_rate 配置，默认 0.05）
static func _fallback_rate() -> float:
	return GameConfig.get_float("domains.workshop", "enhancement/fallback_rate", 0.05)

## 强化成本：金币指数公式 + 晶石门槛（7 级起收晶石）
static func calculate_enhance_cost(current_level: int) -> Dictionary:
	var gold_base := GameConfig.get_int("domains.workshop", "enhancement/cost_formula/gold_base", 50)
	var gold_exp := GameConfig.get_float("domains.workshop", "enhancement/cost_formula/gold_exp", 2.0)
	var gold = int(gold_base * pow(float(current_level + 1), gold_exp))
	var threshold := GameConfig.get_int("domains.workshop", "enhancement/cost_formula/crystal_threshold_level", 7)
	var crystal_cost_above := GameConfig.get_int("domains.workshop", "enhancement/cost_formula/crystal_cost_above_threshold", 1)
	var crystals = crystal_cost_above if current_level >= threshold else 0
	return { "gold_cost": gold, "crystal_cost": crystals }

## rng 为空时回退共享实例；传入实例即可复现强化成败序列
static func attempt_enhancement(
	item: ItemEntity,
	wallet: CharacterWalletEntity,
	use_protection_scroll: bool = false,
	rng: DeterministicRNG = null,
	transaction_id: String = ""
) -> Dictionary:
	if item == null or wallet == null:
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	var tx_id := transaction_id if not transaction_id.is_empty() else "ENHANCE_%s_%s" % [item.item_uid, str(Time.get_ticks_usec())]
	if _completed_transactions.has(tx_id):
		return _completed_transactions[tx_id]
	var enhance_rng := DeterministicRNG.resolve(rng)
	var cur_lvl = int(item.combat_metrics.get("enhance_level", 0))
	var max_lvl := _max_level()
	if cur_lvl >= max_lvl:
		var msg_max := GameConfig.get_string("narratives.workshop", "enhance_max_level", "Item reached max enhance level (+%d)" % max_lvl)
		return { "success": false, "reason": msg_max }

	var target_lvl = cur_lvl + 1
	var cost = calculate_enhance_cost(cur_lvl)
	var gold_rate := GameConfig.get_int("domains.currency", "rates/gold", 10000)
	var needed_copper = cost.gold_cost * gold_rate

	if wallet.get_total_copper_value() < needed_copper or wallet.mana_monocrystals < cost.crystal_cost:
		var msg_res := GameConfig.get_string("narratives.workshop", "insufficient_resources", "Insufficient resources for enhancement.")
		return { "success": false, "reason": msg_res }

	var wallet_snapshot := wallet.to_dictionary()
	if not CurrencySinksAndFaucetsFSM.apply_rigid_sink_transaction(wallet, needed_copper, "FORGE_ENHANCE"):
		return {"success": false, "error_code": "INSUFFICIENT_RESOURCES"}
	var crystal_result := wallet.apply_transaction({"mana_monocrystals": -cost.crystal_cost}, true)
	if not crystal_result.get("success", false):
		wallet.from_dictionary(wallet_snapshot)
		return {"success": false, "error_code": crystal_result.get("error_code", "TRANSACTION_FAILED")}

	var rates := _success_rates()
	var rate = float(rates.get(str(target_lvl), _fallback_rate()))
	var roll := enhance_rng.randf()

	if roll < rate:
		item.combat_metrics["enhance_level"] = target_lvl
		var edge_mult := GameConfig.get_float("domains.workshop", "enhancement/stat_multipliers/edge_sharpness", 1.10)
		var armor_mult := GameConfig.get_float("domains.workshop", "enhancement/stat_multipliers/effective_armor", 1.10)
		var price_mult := GameConfig.get_float("domains.workshop", "enhancement/stat_multipliers/market_price", 1.30)
		item.combat_metrics["edge_sharpness"] = float(item.combat_metrics.get("edge_sharpness", 1.0)) * edge_mult
		item.combat_metrics["effective_armor"] = float(item.combat_metrics.get("effective_armor", 0.0)) * armor_mult
		item.market_base_price = int(float(item.market_base_price) * price_mult)

		EventBusCore.get_instance().emit_narrative_by_key(
			"workshop/enhance_success", "economy", [item.custom_name, target_lvl]
		)
		var result := { "success": true, "result": "ENHANCED", "new_level": target_lvl, "transaction_id": tx_id }
		_completed_transactions[tx_id] = result.duplicate(true)
		_prune_completed()
		return result
	else:
		var new_lvl = cur_lvl
		var degrade_threshold := GameConfig.get_int("domains.workshop", "enhancement/penalty/degrade_threshold", 10)
		var min_lvl := GameConfig.get_int("domains.workshop", "enhancement/penalty/min_level", 0)
		if cur_lvl >= degrade_threshold and not use_protection_scroll:
			new_lvl = max(min_lvl, cur_lvl - 1)
			item.combat_metrics["enhance_level"] = new_lvl

		EventBusCore.get_instance().emit_narrative_by_key(
			"workshop/enhance_fail", "economy", [item.custom_name, new_lvl]
		)
		var result := { "success": true, "result": "FAILED", "new_level": new_lvl, "transaction_id": tx_id }
		_completed_transactions[tx_id] = result.duplicate(true)
		_prune_completed()
		return result
