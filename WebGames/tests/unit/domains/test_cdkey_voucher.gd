# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 24 礼包兑换码系统单元测试
# 文件路径: res://tests/unit/domains/test_cdkey_voucher.gd
# ==============================================================================
class_name TestCDKeyVoucherDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 24: 全域礼包兑换码与凭证核销系统"

	results.append(_test_universal_and_unique_redemption())
	results.append(_test_rate_limit_and_lockout())
	results.append(_test_reward_dispatch_via_mail_equivalent())
	# Phase 52 M3/M4 新增：投递 mail_id 唯一化 + 悬挂补偿通道
	results.append(_test_mail_id_unique_burst())
	results.append(_test_compensation_releases_stale_pending())
	# Phase 64 P2 修复回归：容量兜底绝不逐出在锁条目
	results.append(_test_capacity_fallback_preserves_active_lockouts())

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

static func _test_universal_and_unique_redemption() -> Dictionary:
	var registry: Dictionary = {}
	var rate_limit: Dictionary = {}
	var history: Dictionary = {}
	var unique_redeemed: Dictionary = {}

	# 注册通用码与唯一码
	var v_universal := CDKeyVoucherAggregate.new("KALAR_2026", CDKeyVoucherAggregate.VoucherType.UNIVERSAL_PER_ACCOUNT, "新年全服礼包")
	v_universal.reward_payload["gold_coins"] = 100
	registry["KALAR_2026"] = v_universal

	var v_unique := CDKeyVoucherAggregate.new("TOKEN_VIP_XYZ", CDKeyVoucherAggregate.VoucherType.UNIQUE_ONE_TIME, "独家媒体码")
	v_unique.reward_payload["mana_monocrystals"] = 10
	registry["TOKEN_VIP_XYZ"] = v_unique

	# 账户 A 领取通用码 -> 成功
	var res1 = CDKeyRedemptionSolver.resolve_redemption("ACC_001", 1, "kalar_2026", 1000, registry, rate_limit, history, unique_redeemed)
	# 账户 A 再次领取通用码 -> 拦截 (ALREADY_REDEEMED)
	var res2 = CDKeyRedemptionSolver.resolve_redemption("ACC_001", 1, "KALAR_2026", 1001, registry, rate_limit, history, unique_redeemed)

	# 账户 A 领取唯一码 -> 成功
	var res3 = CDKeyRedemptionSolver.resolve_redemption("ACC_001", 1, "TOKEN_VIP_XYZ", 1002, registry, rate_limit, history, unique_redeemed)
	# 账户 B 尝试领取同个唯一码 -> 拦截 (ALREADY_USED_GLOBALLY)
	var res4 = CDKeyRedemptionSolver.resolve_redemption("ACC_002", 1, "TOKEN_VIP_XYZ", 1003, registry, rate_limit, history, unique_redeemed)

	var passed = res1.success and (not res2.success) and (res2.error_code == "ALREADY_REDEEMED") and res3.success and (not res4.success) and (res4.error_code == "ALREADY_USED_GLOBALLY")
	return {
		"test": "TC-CDKEY-01: 通用码防重复核销与唯一码全服作废机制",
		"passed": passed
	}

static func _test_rate_limit_and_lockout() -> Dictionary:
	var registry: Dictionary = {}
	var rate_limit: Dictionary = {}
	var history: Dictionary = {}
	var unique_redeemed: Dictionary = {}

	# 连续输错 5 次
	for i in range(5):
		CDKeyRedemptionSolver.resolve_redemption("ACC_HACKER", 1, "WRONG_CODE_%d" % i, 1000, registry, rate_limit, history, unique_redeemed)

	# 第 6 次请求必须被频控拦截锁定 60 秒
	var res_locked = CDKeyRedemptionSolver.resolve_redemption("ACC_HACKER", 1, "ANY_CODE", 1010, registry, rate_limit, history, unique_redeemed)
	var passed = (not res_locked.success) and (res_locked.error_code == "RATE_LIMITED")

	return {
		"test": "TC-CDKEY-02: 连续输错 5 次触发 60 秒频控锁定",
		"passed": passed
	}

## Phase 64 P2 修复回归（红证：修复前容量兜底逐出 keys()[0]，灌满表后
## 可静默解除在锁账户的防爆破锁，受害者可被立即继续爆破）：
## 表满且剩余条目全部在锁时，_record_failure 必须放弃记录新失败（fail-closed），
## 绝不逐出锁定条目；存在过期条目时 purge 腾位后新失败可正常落账。
static func _test_capacity_fallback_preserves_active_lockouts() -> Dictionary:
	var now := 100000
	var rate_limit: Dictionary = {}
	# 灌满 5000 槽：全部处于锁定窗口内（lock_until_utc > now）
	for i in range(5000):
		rate_limit["ACC_LOCKED_%05d" % i] = { "count": 5, "lock_until_utc": now + 3600 }

	# 新账户触发容量兜底：purge 无过期条目可清，剩余全在锁 → 必须放弃记录、不逐出
	CDKeyRedemptionSolver._record_failure("ACC_NEW", now, rate_limit)

	var size_ok: bool = rate_limit.size() == 5000
	var not_recorded: bool = not rate_limit.has("ACC_NEW")
	# 抽查最旧条目仍存在且锁未解除（修复前 keys()[0] 即被逐出）
	var victim_ok: bool = rate_limit.has("ACC_LOCKED_00000") \
		and rate_limit["ACC_LOCKED_00000"].get("lock_until_utc", 0) == now + 3600

	# 对照组：存在已过期条目时，purge 腾位后新失败可正常落账（不误伤正常路径）
	var rate_limit2: Dictionary = {}
	for i in range(4999):
		rate_limit2["ACC_OLD_%05d" % i] = { "count": 1, "lock_until_utc": now - 1 }
	rate_limit2["ACC_KEEP"] = { "count": 5, "lock_until_utc": now + 3600 }
	CDKeyRedemptionSolver._record_failure("ACC_RECORDED", now, rate_limit2)
	var recorded_ok: bool = rate_limit2.size() == 2 and rate_limit2.has("ACC_RECORDED") \
		and rate_limit2.has("ACC_KEEP")

	var passed: bool = size_ok and not_recorded and victim_ok and recorded_ok
	return {
		"test": "TC-CDKEY-03: 频控容量兜底绝不逐出在锁条目（P2 防爆破锁回归）",
		"passed": passed
	}

static func _test_reward_dispatch_via_mail_equivalent() -> Dictionary:
	var mailbox := MailboxManager.new()
	var payload := {
		"gold_coins": 50,
		"mana_monocrystals": 3,
		"silver_coins": 20,
		"copper_coins": 100,
		"item_templates": [
			{ "template_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "name": "生命药水" }
		]
	}

	var res := VoucherDispatchPipeline.dispatch_rewards_via_mail(payload, mailbox, "ACC_DIRECT_TEST")
	var mail: MailItemAggregate = mailbox.get_mail_by_id(str(res.get("mail_id", "")))

	var mail_ok: bool = mail != null \
		and mail.attachment_gold == 50 \
		and mail.attachment_crystals == 3 \
		and mail.attachment_silver == 20 \
		and mail.attachment_copper == 100 \
		and mail.attachment_items.size() == 1 \
		and str(mail.attachment_items[0].get("template_id", "")) == "KALAR:CONSUM:ALCHEMY:POTION_MANA"

	# 空信箱或空账号拒绝
	var bad_box = VoucherDispatchPipeline.dispatch_rewards_via_mail(payload, null, "ACC_DIRECT_TEST")
	var bad_acc = VoucherDispatchPipeline.dispatch_rewards_via_mail(payload, mailbox, "")
	var reject_ok: bool = (not bad_box.get("success", true)) and (not bad_acc.get("success", true))

	var passed: bool = res.get("success", false) and res.get("has_attachment", false) and mail_ok and reject_ok
	return {
		"test": "TC-CDKEY-03: 礼包奖励经邮件发放等价断言（附件字段与防错卫语句，R-04）",
		"passed": passed
	}

## M3（Phase 52）：默认 mail_id 走唯一 ID 生成器——同秒连发不得碰撞
## （红证：修复前 "CDK_%d" % 秒级时间戳 同秒必同 id，receive_mail 同信箱拒绝）
static func _test_mail_id_unique_burst() -> Dictionary:
	var mailbox := MailboxManager.new()
	var payload := { "gold_coins": 1 }
	var ids: Dictionary = {}
	var all_ok := true
	for i in range(10):
		var r = VoucherDispatchPipeline.dispatch_rewards_via_mail(payload, mailbox, "ACC_BURST")
		if not r.get("success", false):
			all_ok = false
			break
		ids[str(r.get("mail_id", ""))] = true
	var passed = all_ok and ids.size() == 10 and mailbox.stored_mails.size() == 10
	return {
		"test": "TC-CDKEY-04: 默认 mail_id 同秒连发唯一（M3 时间戳碰撞封堵）",
		"passed": passed
	}

## M4（Phase 52）：投递失败进入 DISPATCH_PENDING 后，补偿通道超时重试、
## 重试达上限回滚核销（码 RELEASED 可重新领取）——杜绝「码已烧、奖励永失」悬挂
static func _test_compensation_releases_stale_pending() -> Dictionary:
	RedemptionFlowOrchestrator.reset_records()
	var registry: Dictionary = {}
	var rate_limit: Dictionary = {}
	var history: Dictionary = {}
	var unique_redeemed: Dictionary = {}
	var v := CDKeyVoucherAggregate.new("KALAR_COMP", CDKeyVoucherAggregate.VoucherType.UNIVERSAL_PER_ACCOUNT, "补偿测试码")
	v.reward_payload["gold_coins"] = 50
	registry["KALAR_COMP"] = v

	# 投递环境缺失（mailbox=null）→ 核销已发生但投递失败 → DISPATCH_PENDING
	var req := {
		"transaction_id": "TX_COMP_1",
		"account_id": "ACC_01",
		"character_level": 1,
		"voucher_code": "KALAR_COMP",
		"current_time_utc": 1000,
		"voucher_registry": registry,
		"rate_limit_state": rate_limit,
		"account_history": history,
		"unique_redeemed": unique_redeemed,
		"mailbox": null
	}
	var res = RedemptionFlowOrchestrator.process_redemption(req)
	var pending_ok = (not res.success) and res.code == "DISPATCH_PENDING" \
		and v.current_global_redemptions == 1
	var rec = RedemptionFlowOrchestrator.get_record("TX_COMP_1")
	var rec_ok = rec.get("status", "") == "DISPATCH_PENDING" and int(rec.get("retry_count", -1)) == 0

	# 三轮到期重试（mailbox 恒 null → 每次失败并 +1 重试计数、冷却刷新）
	compensate(2000, registry, unique_redeemed, history) # 0→1
	compensate(2200, registry, unique_redeemed, history) # 1→2
	compensate(2400, registry, unique_redeemed, history) # 2→3
	# 第四轮：重试达上限 → 回滚核销 RELEASED + 记录清除
	var rel = compensate(2600, registry, unique_redeemed, history)
	var release_ok = rel.get("released", 0) == 1 \
		and v.current_global_redemptions == 0 \
		and RedemptionFlowOrchestrator.get_record("TX_COMP_1").is_empty()

	# 码已释放：同一账户可再次成功领取
	var res2 = CDKeyRedemptionSolver.resolve_redemption("ACC_01", 1, "KALAR_COMP", 3000, registry, rate_limit, history, unique_redeemed)
	var passed = pending_ok and rec_ok and release_ok and res2.success
	return {
		"test": "TC-CDKEY-05: 悬挂补偿通道（M4：超时重试达上限回滚核销、码可重新领取）",
		"passed": passed
	}

static func compensate(now: int, registry: Dictionary, unique: Dictionary, account_history: Dictionary) -> Dictionary:
	return RedemptionFlowOrchestrator.compensate_stale_pending(now, null, registry, unique, account_history)
