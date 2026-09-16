# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/mail_system/mail_delivery_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: inventory | 配置: config/domains/mail_system.json | 信号: EventBus 领域广播
# 职责说明: 一键提取邮件附件、随身背包满仓安全保护（未提取附件安全留存）； 附件物品发放走物品注册表三元组（template_id 必填为已登记 canonical_id， 未登记附件不可提取，安全留存于邮件等待修复后重试）。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name MailDeliveryPipeline
extends RefCounted

static var _claimed_results: Dictionary = {}

## M3（Phase 52）幂等缓存键：复合键 = 收件人账户 + mail_id（维度升级）。
## 旧键仅 mail.mail_id——CDK 邮件默认 id 曾为秒级时间戳，跨账户同秒错配会命中他人领取结果。
static func _claim_cache_key(mail: MailItemAggregate) -> String:
	return "%s::%s" % [mail.recipient_account_id, mail.mail_id]

static func claim_single_mail(
	mail: MailItemAggregate,
	wallet: CharacterWalletEntity,
	inventory: WearableInventoryAggregate,
	catalog: ItemRegistryCatalog,
	library: AccountItemLibraryAggregate = null
) -> Dictionary:
	if mail == null or wallet == null or inventory == null or catalog == null or mail.mail_id.is_empty():
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	if _claimed_results.has(_claim_cache_key(mail)):
		return _claimed_results[_claim_cache_key(mail)]
	if not mail.has_unclaimed_attachment():
		return {
			"success": false,
			"error_code": "NO_UNCLAIMED_ATTACHMENT",
			"error_message": _msg("no_attachment"),
			"claimed_gold": 0,
			"claimed_crystals": 0,
			"claimed_items_count": 0
		}

	var claimed_gold = mail.attachment_gold
	var claimed_crystals = mail.attachment_crystals
	var claimed_silver = mail.attachment_silver
	var claimed_copper = mail.attachment_copper

	var remaining_items: Array[Dictionary] = []
	var claimed_items_count: int = 0

	var inventory_snapshot := inventory.snapshot()
	var mail_items_snapshot := mail.attachment_items.duplicate(true)
	for item_dict in mail.attachment_items:
		# 注册表三元组发放：template_id 必填且须为已登记 canonical_id，
		# 未登记附件不可提取（数据错误安全留存，等待修复后重试）
		var item_id := str(item_dict.get("template_id", ""))
		var item_count := int(item_dict.get("count", 1))
		if item_count <= 0 or item_count > GameConfig.get_int("domains.inventory", "transaction/max_item_quantity", 1000):
			inventory.restore(inventory_snapshot)
			mail.attachment_items = mail_items_snapshot
			return {"success": false, "error_code": "INVALID_ATTACHMENT_COUNT"}
		var proto = catalog.get_prototype(item_id)
		if proto == null:
			remaining_items.append(item_dict)
			continue
		var display_name := str(item_dict.get("name", _msg("attachment_item")))
		var delivered := 0
		for i in range(item_count):
			var item := ItemInstanceFactory.build_instance(proto, display_name, "MAIL_")
			if not inventory.add_item(item):
				break
			delivered += 1
			claimed_items_count += 1
			if library != null:
				ItemStatisticsSolver.record_item_event(library, ItemStatisticsSolver.EVENT_ITEM_GRANTED, item_id, 1, catalog, null, {
					"uid": item.item_uid,
					"transaction_id": mail.mail_id,
					"rule_id": "rule_mail_claim"
				})
		if delivered < item_count:
			var remaining: Dictionary = item_dict.duplicate(true)
			remaining["count"] = item_count - delivered
			remaining_items.append(remaining)
	var wallet_result := wallet.apply_delta({
		"gold": claimed_gold,
		"mana_monocrystals": claimed_crystals,
		"silver": claimed_silver,
		"copper": claimed_copper
	})
	if not wallet_result.get("success", false):
		inventory.restore(inventory_snapshot)
		mail.attachment_items = mail_items_snapshot
		return {"success": false, "error_code": wallet_result.get("error_code", "CLAIM_NOT_ATOMIC")}
	mail.attachment_gold = 0
	mail.attachment_crystals = 0
	mail.attachment_silver = 0
	mail.attachment_copper = 0

	mail.attachment_items = remaining_items

	# 如果所有物品与货币都已领完
	if mail.attachment_items.is_empty() and mail.attachment_gold == 0 and mail.attachment_crystals == 0 and mail.attachment_silver == 0 and mail.attachment_copper == 0:
		mail.status = MailItemAggregate.MailStatus.READ_CLAIMED
	else:
		mail.status = MailItemAggregate.MailStatus.READ_UNCLAIMED

	var result := {
		"success": true,
		"error_code": "OK",
		"claimed_gold": claimed_gold,
		"claimed_crystals": claimed_crystals,
		"claimed_items_count": claimed_items_count,
		"remaining_items_count": remaining_items.size()
	}
	if mail.status == MailItemAggregate.MailStatus.READ_CLAIMED:
		_claimed_results[_claim_cache_key(mail)] = result.duplicate(true)
		# S3-03 有界保留：超容量按插入序裁剪最旧记录（内存有界，防无限增长；P4 单次快照裁剪）
		FifoBudget.trim_oldest(_claimed_results, GameConfig.get_int("infrastructure.admin", "idempotency/max_records", 1000))
	return result

static func claim_all_mails(
	mailbox: MailboxManager,
	wallet: CharacterWalletEntity,
	inventory: WearableInventoryAggregate,
	catalog: ItemRegistryCatalog,
	library: AccountItemLibraryAggregate = null
) -> Dictionary:
	var total_gold := 0
	var total_crystals := 0
	var total_items := 0
	var mails_processed := 0

	for mail in mailbox.stored_mails:
		if mail.has_unclaimed_attachment():
			var res = claim_single_mail(mail, wallet, inventory, catalog, library)
			if res.success:
				total_gold += res.claimed_gold
				total_crystals += res.claimed_crystals
				total_items += res.claimed_items_count
				mails_processed += 1

	return {
		"success": true,
		"mails_processed": mails_processed,
		"total_gold": total_gold,
		"total_crystals": total_crystals,
		"total_items": total_items
	}

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("mail_system", key)
