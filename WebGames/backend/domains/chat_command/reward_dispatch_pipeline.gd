# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/chat_command/reward_dispatch_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/chat_command.json | 信号: EventBus 领域广播
# 职责说明: CDKey 兑换码格式校验、防重放核销与全服/个人邮件道具发放 兑换表由 config/domains/chat_command.json 的 cdkeys 驱动，文案由 config/narratives/chat_command.json 驱动，礼包兜底名取自本域表。 发放走物品注册表三元组（item_id 必填为已登记 canonical_id，原型属性为 单一事实源，无效配置严格拒绝，无兼容临时物件路径）。 契约: 表内键值与下方各取值器的兜底默认值逐字一致——改表即改行为， TC-CMD-03（KALAR666 -> gold 500）守此契约，改表后该断言立即变红。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name RewardDispatchPipeline extends RefCounted

static var redeemed_keys: Dictionary = {}

static func _valid_cdkeys() -> Dictionary:
	return GameConfig.get_dict("domains.chat_command", "cdkeys", {})

## 兑换核销：货币入账 + 注册表物品发放；item_id 按 canonical_id 解析，
## 缺失/未登记/背包满一律严格拒绝且不消耗兑换码。
static func redeem_cdkey(
	cdkey: String,
	account_id: String,
	wallet: CharacterWalletEntity,
	inventory: WearableInventoryAggregate,
	catalog: ItemRegistryCatalog,
	library: AccountItemLibraryAggregate = null
) -> Dictionary:
	var clean_key = cdkey.strip_edges().to_upper()
	var valid := _valid_cdkeys()
	if not valid.has(clean_key):
		var msg := GameConfig.get_string("narratives.chat_command", "cdkey_invalid", "Invalid or expired CDKey: %s") % clean_key
		return { "success": false, "reason": msg }

	var user_redeemed = redeemed_keys.get(account_id, [])
	if clean_key in user_redeemed:
		var msg2 := GameConfig.get_string("narratives.chat_command", "cdkey_redeemed", "CDKey already redeemed by this account.")
		return { "success": false, "reason": msg2 }

	var reward: Dictionary = valid[clean_key] as Dictionary
	# 注册表三元组发放：item_id 必填且须为已登记 canonical_id
	var item_id := str(reward.get("item_id", ""))
	if item_id.is_empty():
		var msg3 := GameConfig.get_string("narratives.chat_command", "cdkey_item_id_missing", "Reward item_id missing for CDKey: %s") % clean_key
		return { "success": false, "reason": msg3 }
	var proto = catalog.get_prototype(item_id)
	if proto == null:
		var msg4 := GameConfig.get_string("narratives.chat_command", "cdkey_item_not_found", "Reward item not registered: %s") % item_id
		return { "success": false, "reason": msg4 }

	var fallback := GameConfig.get_string("domains.chat_command", "item_defaults/custom_name", "神秘礼包")
	var display_name := str(reward.get("item_name", fallback))
	var item := ItemInstanceFactory.build_instance(proto, display_name, "CDK_", GameConfig.get_string("domains.chat_command", "reward/item_id_prefix", "CDKEY_REWARD_"))
	# 原子性：先落物品，成功后才入账货币并核销兑换码——任一步失败整体回滚（货币未动、码未消耗），
	# 杜绝「背包满 → 反复重试刷取金币」漏洞
	if not inventory.add_item(item):
		var msg5 := GameConfig.get_string("narratives.chat_command", "cdkey_inventory_full", "Inventory full, reward not granted: %s") % clean_key
		return { "success": false, "reason": msg5 }

	if library != null:
		ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_GRANTED, item_id, 1, catalog, null, {
			"transaction_id": clean_key,
			"rule_id": "rule_cdkey_redeem",
			"currency_delta": {
				"gold": int(reward.get("gold", 0)),
				"mana_monocrystals": int(reward.get("crystals", 0))
			}
		})

	wallet.apply_delta({
		"gold": int(reward.get("gold", 0)),
		"mana_monocrystals": int(reward.get("crystals", 0))
	})

	user_redeemed.append(clean_key)
	redeemed_keys[account_id] = user_redeemed
	# P6：无界补上限——账号维度最旧先出裁剪（单账号内列表受 cdkeys 表键集约束，天然有界）
	FifoBudget.trim_oldest(redeemed_keys, GameConfig.get_int("domains.chat_command", "redeemed/max_entries", 2000))

	EventBusCore.get_instance().emit_narrative_by_key(
		"account/cdkey_success", "economy", [clean_key, reward.get("gold", 0), reward.get("crystals", 0), display_name]
	)

	return { "success": true, "reward": reward, "item_id": item_id }
