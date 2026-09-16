# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 25 邮件系统单元测试
# 文件路径: res://tests/unit/domains/test_mail_system.gd
# ==============================================================================
class_name TestMailSystemDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 25: 全域邮件信箱与附件仓储系统"

	results.append(_test_mailbox_capacity_and_gc())
	results.append(_test_attachment_claiming_and_overflow_protection())
	results.append(_test_mail_expiry_update())
	# Phase 52 M3 新增：幂等缓存键账户维度
	results.append(_test_claim_cache_owner_dimension())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_mailbox_capacity_and_gc() -> Dictionary:
	var mailbox := MailboxManager.new()

	# 塞入 100 封邮件
	for i in range(100):
		var m := MailItemAggregate.new("MAIL_%d" % i, "ACC_01", "标题 %d" % i, "内容")
		m.status = MailItemAggregate.MailStatus.READ_CLAIMED # 已读已领
		mailbox.receive_mail(m)

	# 塞入第 101 封新邮件，触发旧已读自动 GC
	var m_new := MailItemAggregate.new("MAIL_NEW", "ACC_01", "新版本公告", "内容")
	var ok = mailbox.receive_mail(m_new)

	var passed = ok and (mailbox.stored_mails.size() == 100) and (mailbox.stored_mails[0].mail_id == "MAIL_NEW")
	return {
		"test": "TC-MAIL-01: 信箱 100 封容量上限与旧已读邮件自动 GC",
		"passed": passed
	}

static func _test_attachment_claiming_and_overflow_protection() -> Dictionary:
	var wallet := CharacterWalletEntity.new()
	var chest := ItemEntity.new()
	chest.category = "ARMOR_EQUIPMENT"
	chest.volume_slots = 1 # 背包容量仅有 1 格
	var inv := WearableInventoryAggregate.new()
	inv.equip_item("CHEST", chest)
	var catalog := ItemLoaderPipeline.build_catalog_from_config()

	var mail := MailItemAggregate.new("MAIL_REWARD", "ACC_01", "首领讨伐战功", "附件奉上")
	mail.has_attachment = true
	mail.attachment_gold = 200
	mail.attachment_crystals = 5
	mail.attachment_items = [
		{ "template_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "name": "魔力药剂" },   # 原型体积 1 → 可入包
		{ "template_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "name": "秘银剑" }, # 原型体积 2 → 容量不足留存
		{ "template_id": "ITEM_GHOST", "name": "未登记附件" }                              # 未登记 → 安全留存不可提取
	]

	var res = MailDeliveryPipeline.claim_single_mail(mail, wallet, inv, catalog)
	# 未登记附件（ITEM_GHOST）安全留存显式断言：仍留邮件内可修复后重试（R-04 后领取端唯一校验点）
	var ghost_retained := false
	for item_dict in mail.attachment_items:
		if str(item_dict.get("template_id", "")) == "ITEM_GHOST":
			ghost_retained = true
	var passed = res.success and (wallet.gold == 200) and (wallet.mana_monocrystals == 5) \
		and (res.claimed_items_count == 1) and (res.remaining_items_count == 2) \
		and (mail.status == MailItemAggregate.MailStatus.READ_UNCLAIMED) \
		and (inv.storage_items[0].template_id == "KALAR:CONSUM:ALCHEMY:POTION_MANA") \
		and ghost_retained
	return {
		"test": "TC-MAIL-02: 附件一键提取与背包满仓/未登记附件安全留存保护",
		"passed": passed
	}

static func _test_mail_expiry_update() -> Dictionary:
	var mailbox := MailboxManager.new()
	var mail_expired := MailItemAggregate.new("MAIL_EXP", "ACC_01", "限时活动", "内容")
	mail_expired.expire_timestamp_utc = 1000
	mailbox.receive_mail(mail_expired)

	var mail_valid := MailItemAggregate.new("MAIL_VAL", "ACC_01", "永久信件", "内容")
	mail_valid.expire_timestamp_utc = 5000
	mailbox.receive_mail(mail_valid)

	var exp_cnt = mailbox.update_expiry(2000)
	var passed = (exp_cnt == 1) and (mail_expired.status == MailItemAggregate.MailStatus.EXPIRED) and (mail_valid.status == MailItemAggregate.MailStatus.UNREAD)
	return {
		"test": "TC-MAIL-03: 邮件时效到期自动标记失效",
		"passed": passed
	}

## M3（Phase 52）：幂等缓存键必须含账户维度——
## 跨账户同 mail_id（CDK 秒级时间戳碰撞场景）不得命中他人领取结果（红证：修复前 B 领到 A 的缓存）
static func _test_claim_cache_owner_dimension() -> Dictionary:
	var catalog := ItemLoaderPipeline.build_catalog_from_config()

	# 账户 A 与账户 B 同 mail_id（模拟旧秒级 CDK id 碰撞），附件金额不同
	var mail_a := MailItemAggregate.new("CDK_SAME_SECOND", "ACC_A", "礼包A", "内容")
	mail_a.has_attachment = true
	mail_a.attachment_gold = 200
	var mail_b := MailItemAggregate.new("CDK_SAME_SECOND", "ACC_B", "礼包B", "内容")
	mail_b.has_attachment = true
	mail_b.attachment_gold = 300

	var wallet_a := CharacterWalletEntity.new()
	var wallet_b := CharacterWalletEntity.new()
	var inv_a := WearableInventoryAggregate.new()
	var inv_b := WearableInventoryAggregate.new()

	var res_a1 = MailDeliveryPipeline.claim_single_mail(mail_a, wallet_a, inv_a, catalog)
	var res_b1 = MailDeliveryPipeline.claim_single_mail(mail_b, wallet_b, inv_b, catalog)
	# B 二次领取命中自己的缓存（幂等），返回结果与首次一致
	var res_b2 = MailDeliveryPipeline.claim_single_mail(mail_b, wallet_b, inv_b, catalog)

	var passed = res_a1.success and res_b1.success \
		and res_a1.claimed_gold == 200 and res_b1.claimed_gold == 300 \
		and wallet_a.gold == 200 and wallet_b.gold == 300 \
		and res_b2.success and res_b2.claimed_gold == 300 and wallet_b.gold == 300
	return {
		"test": "TC-MAIL-04: 幂等缓存键含账户维度（M3 跨账户同 mail_id 不错配）",
		"passed": passed
	}
