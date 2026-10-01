# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/quest_causality/quest_reward_dispatch.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: inventory | 配置: config/domains/quest.json | 信号: EventBus 领域广播
# 职责说明: 任务物品奖励统一事实源（quest.json:reward_items 引用 canonical_id）， 发放经注册库校验 + ItemInstanceFactory 权威 UID（前缀 QST_）， 背包满原子中断、未登记拒绝入账、统计 uid 旁路。
# 设计依据: 业务域第一性原理 / 任务物品奖励发放与幂等事务规范
# ==============================================================================

class_name QuestRewardDispatch extends RefCounted

static var _completed_transactions: Dictionary = {}

static func _grant_entry_instances(
	proto: Variant,
	canonical_id: String,
	count: int,
	tx_id: String,
	catalog: ItemRegistryCatalog,
	inventory: WearableInventoryAggregate,
	library: AccountItemLibraryAggregate
) -> int:
	for i in range(count):
		var item: ItemEntity = ItemInstanceFactory.build_instance(proto, proto.english_name, "QST_")
		if not inventory.add_item(item):
			return -1
		if library != null:
			ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_GRANTED, canonical_id, 1, catalog, null, {
				"uid": item.item_uid,
				"transaction_id": tx_id
			})
	return count

static func _process_single_reward_entry(
	entry: Dictionary,
	tx_id: String,
	max_qty: int,
	catalog: ItemRegistryCatalog,
	inventory: WearableInventoryAggregate,
	library: AccountItemLibraryAggregate
) -> Dictionary:
	var canonical_id: String = str(entry.get("canonical_id", ""))
	if canonical_id.is_empty():
		return {"success": false, "error_code": "EMPTY_ITEM_KEY", "granted": 0, "transaction_id": tx_id, "rolled_back": true}
	var proto: Variant = catalog.get_prototype(canonical_id)
	if proto == null:
		return {"success": false, "error_code": "ITEM_NOT_REGISTERED", "canonical_id": canonical_id, "granted": 0, "transaction_id": tx_id, "rolled_back": true}
	var count: int = int(entry.get("count", 1))
	if count < 0 or count > max_qty:
		return {"success": false, "error_code": "INVALID_REWARD_COUNT", "transaction_id": tx_id}
	var added: int = _grant_entry_instances(proto, canonical_id, count, tx_id, catalog, inventory, library)
	if added < 0:
		return {"success": false, "error_code": "INVENTORY_FULL", "granted": 0, "canonical_id": canonical_id, "transaction_id": tx_id, "rolled_back": true}
	return {"success": true, "granted": added}

## 物品奖励发放闭环：entry 须含已登记 canonical_id；中段背包满整体失败（已发数可追溯）
static func dispatch_item_rewards(reward_items: Array, catalog: ItemRegistryCatalog, inventory: WearableInventoryAggregate, library: AccountItemLibraryAggregate = null, transaction_id: String = "") -> Dictionary:
	if catalog == null or inventory == null:
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	var tx_id: String = transaction_id if not transaction_id.is_empty() else "QST_REWARD_%s" % str(Time.get_ticks_usec())
	if _completed_transactions.has(tx_id):
		return _completed_transactions[tx_id]

	var inventory_snapshot: Dictionary = inventory.snapshot()
	var max_qty: int = GameConfig.get_int("domains.inventory", "transaction/max_item_quantity", 1000)
	var granted: int = 0

	for entry in reward_items:
		if not (entry is Dictionary):
			continue
		var step_res: Dictionary = _process_single_reward_entry(entry, tx_id, max_qty, catalog, inventory, library)
		if not bool(step_res.get("success", false)):
			inventory.restore(inventory_snapshot)
			return step_res
		granted += int(step_res.get("granted", 0))

	EventBusCore.get_instance().emit_domain_event("quest.reward_dispatched", {"args": [granted], "summary": {"granted": granted}})
	var result: Dictionary = {"success": true, "granted": granted, "transaction_id": tx_id}
	_completed_transactions[tx_id] = result.duplicate(true)
	# 有界保留：超容量按插入序裁剪最旧记录（内存有界，防无限增长）
	FifoBudget.trim_oldest(_completed_transactions, GameConfig.get_int("infrastructure.admin", "idempotency/max_records", 1000))
	return result
