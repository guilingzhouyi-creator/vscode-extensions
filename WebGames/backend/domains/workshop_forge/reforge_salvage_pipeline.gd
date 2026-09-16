# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/workshop_forge/reforge_salvage_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy | 配置: config/domains/workshop.json | 信号: EventBus 领域广播
# 职责说明: 词条洗练随机重掷与装备分解返还强化材料与金币 词条池/返还率由 config/domains/workshop.json 驱动，文案由 narratives/workshop.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name ReforgingAndSalvagePipeline extends RefCounted

## 洗练词缀池（domains.workshop reforge/pool 配置驱动）
static func _pool() -> Array:
	return GameConfig.get_array("domains.workshop", "reforge/pool", [
		{ "bonus_str": [2.0, 8.0] },
		{ "bonus_int": [2.0, 8.0] },
		{ "bonus_agi": [2.0, 8.0] },
		{ "slash_boost": [0.05, 0.20] },
		{ "mana_efficiency": [0.05, 0.15] }
	])

## rng 为空时回退共享实例；传入实例即可复现洗练结果。
## 空词缀池时跳过生成而非崩溃（原实现 randi() % 0 会直接报错）
## P39 清单4 闭环：lock_count > 0 表示锁定前 N 条既有词缀（保护符/魔单晶
## 消耗按配置收取并在同一事务内扣除），其余槽位重掷；余额不足拒绝且不改动物品。
static func reforge_affixes(
	item: ItemEntity,
	lock_count: int = 0,
	rng: DeterministicRNG = null,
	wallet: CharacterWalletEntity = null
) -> Dictionary:
	if item == null:
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	var existing_affixes: Array = item.affix_sockets.get("dynamic_affixes", [])
	if lock_count < 0 or lock_count > existing_affixes.size():
		return {"success": false, "error_code": "INVALID_LOCK_COUNT"}
	var affix_count := GameConfig.get_int("domains.workshop", "reforge/affix_count", 2)
	var roll_slots := affix_count - lock_count
	if roll_slots <= 0:
		# 锁定数覆盖全部词缀槽 → 无任何可重掷槽位，属调用方参数错误，拒绝且不扣费
		return {"success": false, "error_code": "INVALID_LOCK_COUNT"}
	if lock_count > 0:
		# 保护符/守护石消耗闭环：按配置每锁一条收取魔单晶，同一事务内扣除
		if wallet == null:
			return {"success": false, "error_code": "MISSING_CONTEXT"}
		var lock_cost_per := GameConfig.get_int("domains.workshop", "reforge/lock_cost_mana_monocrystals", 1)
		var total_lock_cost := lock_cost_per * lock_count
		if wallet.mana_monocrystals < total_lock_cost:
			return {"success": false, "error_code": "INSUFFICIENT_RESOURCES"}
		var pay := wallet.apply_transaction({"mana_monocrystals": -total_lock_cost}, true)
		if not pay.get("success", false):
			return {"success": false, "error_code": pay.get("error_code", "INSUFFICIENT_RESOURCES")}
	var reforge_rng := DeterministicRNG.resolve(rng)
	var pool: Array = _pool()
	# 锁定前 lock_count 条既有词缀原样保留，未锁定槽位重掷
	var new_affixes: Array = existing_affixes.slice(0, lock_count) if lock_count > 0 else []
	for i in range(roll_slots):
		var picked = reforge_rng.pick(pool)
		if picked == null:
			continue
		var entry: Dictionary = picked as Dictionary
		var crafted := {}
		for k in entry:
			var v = entry[k]
			if v is Array and v.size() == 2:
				crafted[k] = reforge_rng.randf_range(float(v[0]), float(v[1]))
			else:
				crafted[k] = v
		new_affixes.append(crafted)

	item.affix_sockets["dynamic_affixes"] = new_affixes

	EventBusCore.get_instance().emit_narrative_by_key(
		"workshop/reforge_success", "economy", [item.custom_name, new_affixes.size()]
	)
	return { "success": true, "affixes": new_affixes, "locked_count": lock_count }

## 装备分解：锁定态拦截 → 原子移除（失败回滚库存快照）→ 返还材料金币并记物品销毁遥测
static func salvage_equipment(
	item: ItemEntity,
	wallet: CharacterWalletEntity,
	inventory: WearableInventoryAggregate,
	library: AccountItemLibraryAggregate = null
) -> Dictionary:
	if item == null or wallet == null or inventory == null:
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	if item.container_state == "LOCKED":
		return {"success": false, "error_code": "ITEM_LOCKED"}
	var inventory_snapshot := inventory.snapshot()
	if not _remove_owned_item(inventory, item):
		return {"success": false, "error_code": "ITEM_NOT_IN_INVENTORY"}
	if library != null and not item.template_id.is_empty():
		ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_DESTROYED, item.template_id, 1, null, null, {
			"transaction_id": item.item_id
		})

	var refund_rate := clampf(GameConfig.get_float("domains.workshop", "salvage/refund_rate", 0.5), 0.0, 1.0)
	var gold_rate := GameConfig.get_int("domains.currency", "rates/gold", 10000)
	var refund_copper = int(item.market_base_price * gold_rate * refund_rate)
	var enhance_lvl = int(item.combat_metrics.get("enhance_level", 0))
	var divisor := maxf(1.0, GameConfig.get_float("domains.workshop", "salvage/crystal_divisor", 3.0))
	var refunded_crystals = int(floor(float(enhance_lvl) / divisor))
	var wallet_result := wallet.apply_delta({ "copper": refund_copper, "mana_monocrystals": refunded_crystals })
	if not wallet_result.get("success", false):
		inventory.restore(inventory_snapshot)
		return {"success": false, "error_code": "SALVAGE_NOT_ATOMIC"}

	EventBusCore.get_instance().emit_narrative_by_key(
		"workshop/salvage_success", "economy", [item.custom_name, refund_copper, refunded_crystals]
	)
	return { "success": true, "refund_copper": refund_copper, "refund_crystals": refunded_crystals }

## 物品移除：背包优先，装备槽兜底（置 DESTROYED 态）
static func _remove_owned_item(inventory: WearableInventoryAggregate, item: ItemEntity) -> bool:
	if inventory.storage_items.has(item):
		return inventory.remove_item(item)
	for slot in inventory.equipped_slots:
		if inventory.equipped_slots[slot] == item:
			# 走聚合 API 卸装（同步扣减增量负重缓存；状态先落 UNOWNED 再统一覆写 DESTROYED）
			inventory.unequip_item(slot)
			item.container_state = "DESTROYED"
			return true
	return false
