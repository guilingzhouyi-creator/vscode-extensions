# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/gacha_wish/gacha_execution_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy, inventory | 配置: config/domains/gacha.json | 信号: EventBus 领域广播
# 职责说明: 货币扣款结算、十连祈愿批处理与掉落物品实例化入包； 掉落物品走物品注册表三元组（掉落表 item_ids 为已登记 canonical_id， 原型属性为单一事实源，未登记/容量不足严格计入失败，不造临时物件）。 汇率与文案由 config/domains/currency.json、config/domains/gacha.json、 config/narratives/gacha.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name GachaExecutionService extends RefCounted

static var _completed_transactions: Dictionary = {}

## rng 为空时回退共享实例；传入实例即可整批十连完全复现
static func execute_multi_pull(
	banner: GachaBannerAggregate,
	wallet: CharacterWalletEntity,
	inventory: WearableInventoryAggregate,
	pull_count: int = 10,
	catalog: ItemRegistryCatalog = null,
	rng: DeterministicRNG = null,
	library: AccountItemLibraryAggregate = null,
	tx_id: String = ""
) -> Dictionary:
	if banner == null or wallet == null or inventory == null or catalog == null:
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	var max_pulls := maxi(1, GameConfig.get_int("domains.gacha", "transaction/max_pull_count", 10))
	if pull_count <= 0 or pull_count > max_pulls:
		return {"success": false, "error_code": "INVALID_PULL_COUNT"}
	var operation_id := tx_id if not tx_id.is_empty() else "GACHA_%s_%s" % [banner.banner_id, str(Time.get_ticks_usec())]
	if _completed_transactions.has(operation_id):
		return _completed_transactions[operation_id]
	var pull_rng := DeterministicRNG.resolve(rng)
	var total_gold_cost = banner.cost_per_pull_gold * pull_count
	var total_copper_value = wallet.get_total_copper_value()
	var gold_rate := GameConfig.get_int("domains.currency", "rates/gold", 10000)
	var needed_copper = total_gold_cost * gold_rate

	if total_copper_value < needed_copper:
		var msg := GameConfig.get_string("narratives.gacha", "insufficient_funds", "Insufficient funds for %d pulls.")
		return { "success": false, "reason": msg % pull_count }

	var wallet_snapshot := wallet.to_dictionary()
	var inventory_snapshot := inventory.snapshot()
	var banner_snapshot := banner.snapshot_progress() # 保底进度随事务整面回滚（M1：失败退款不得保留已推进的保底）
	if not CurrencySinksAndFaucetsFSM.apply_rigid_sink_transaction(wallet, needed_copper, "GACHA_WISH"):
		return {"success": false, "error_code": "INSUFFICIENT_FUNDS"}

	var drop_results: Array = []
	var highest_rarity := GameConfig.get_int("domains.gacha", "transaction/min_rarity", 1)
	var granted_count := 0
	var grant_failed_count := 0

	for i in range(pull_count):
		var res = GachaProbabilitySolver.roll_single_draw(banner, pull_rng)
		drop_results.append(res)
		if res.rarity > highest_rarity:
			highest_rarity = res.rarity

		# 注册表三元组发放：掉落 id 为 canonical_id，原型属性单一事实源；
		# 未登记掉落或背包容量不足严格计入失败（不造临时物件）
		var proto = catalog.get_prototype(str(res.item_id))
		if proto == null:
			grant_failed_count += 1
			continue
		var item := ItemInstanceFactory.build_instance(proto, proto.english_name, "GAC_", proto.english_name + "_")
		if inventory.add_item(item):
			granted_count += 1
			if library != null:
				ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_GRANTED, str(res.item_id), 1, catalog, null, {
					"uid": item.item_uid,
					"transaction_id": tx_id,
					"rule_id": "rule_gacha_pull"
				})
		else:
			grant_failed_count += 1
	if grant_failed_count > 0:
		banner.restore_progress(banner_snapshot) # M1：保底三字段随失败整面回滚，封堵零成本刷保底
		inventory.restore(inventory_snapshot)
		wallet.from_dictionary(wallet_snapshot)
		return {"success": false, "error_code": "REWARD_COMMIT_FAILED", "grant_failed_count": grant_failed_count, "transaction_id": operation_id}

	EventBusCore.get_instance().emit_narrative_by_key(
		"gacha/multi_pull_result", "gacha", [banner.banner_title, pull_count, highest_rarity], { "drops": drop_results }
	)

	# P2-2 补发（Phase 43）：纯结构化通道——narratives.gacha 无 pull_resolved 文案键，
	# EventBus 解析不出文案即只广播 domain_event，不与 multi_pull_result 叙事重复落战报
	EventBusCore.get_instance().emit_domain_event("gacha_wish.pull_resolved", {
		"args": [operation_id, pull_count],
		"summary": {
			"transaction_id": operation_id,
			"pull_count": pull_count,
			"highest_rarity": highest_rarity,
			"granted_count": granted_count
		},
		"category_key": "gacha"
	})

	var result := {
		"success": true,
		"drops": drop_results,
		"highest_rarity": highest_rarity,
		"granted_count": granted_count,
		"grant_failed_count": grant_failed_count,
		"transaction_id": operation_id
	}
	_completed_transactions[operation_id] = result.duplicate(true)
	# S3-03 有界保留：超容量按插入序裁剪最旧记录（内存有界，防无限增长；P4 单次快照裁剪）
	FifoBudget.trim_oldest(_completed_transactions, GameConfig.get_int("infrastructure.admin", "idempotency/max_records", 1000))
	return result
