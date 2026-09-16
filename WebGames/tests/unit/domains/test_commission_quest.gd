# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 28 冒险委托系统单元测试
# 文件路径: res://tests/unit/domains/test_commission_quest.gd
# ==============================================================================
class_name TestCommissionQuestDomain
extends RefCounted

static func _test_idempotent_accept() -> Dictionary:
	# Phase 40 GAP-03（TC-GAP-S3-01 / TC-FINAL-COMM-01）：同 tx 重复提交只扣一次保证金
	var comm := CommissionAggregate.new("COMM_IDEM_A", "幂等接取委托", CommissionAggregate.CommissionTier.WOOD, 200)
	comm.security_deposit_required = 50
	var wallet := CharacterWalletEntity.new()
	wallet.gold = 100
	var r1 = CommissionFSM.accept_commission(comm, "ACC_MASTER", CommissionAggregate.CommissionTier.GOLD, wallet, 1000, 86400, "TX_ACCEPT_01")
	var r2 = CommissionFSM.accept_commission(comm, "ACC_MASTER", CommissionAggregate.CommissionTier.GOLD, wallet, 1000, 86400, "TX_ACCEPT_01")
	var passed = r1.success and r2.success and wallet.gold == 50 \
		and comm.status == CommissionAggregate.CommissionStatus.ACCEPTED_IN_PROGRESS
	return {"test": "TC-GAP-S3-01/TC-FINAL-COMM-01: 接取重复提交同 tx 保证金只扣一次", "passed": passed}

static func _test_idempotent_settle() -> Dictionary:
	# Phase 40 GAP-03（TC-GAP-S3-02 / TC-FINAL-COMM-02）：同 tx 重复结算奖励只发一次
	var guild := OrganizationAggregate.new("ORG_GUILD", "冒险者公会总部")
	var comm := CommissionAggregate.new("COMM_IDEM_S", "幂等结算委托", CommissionAggregate.CommissionTier.WOOD, 200)
	comm.reward_mana_crystals = 10
	comm.org_tax_rate = 0.10 # 与 TC-COMM-02 同口径：10% 公会抽成
	comm.security_deposit_required = 20
	comm.status = CommissionAggregate.CommissionStatus.ACCEPTED_IN_PROGRESS
	var wallet := CharacterWalletEntity.new()
	var r1 = CommissionFSM.settle_successful_commission(comm, wallet, guild, "TX_SETTLE_01")
	var r2 = CommissionFSM.settle_successful_commission(comm, wallet, guild, "TX_SETTLE_01")
	var passed = r1.success and r2.success and wallet.gold == 200 and wallet.mana_monocrystals == 9 \
		and guild.treasury_gold_coins == 20 and guild.treasury_mana_crystals == 1 \
		and comm.status == CommissionAggregate.CommissionStatus.SETTLED_SUCCESS
	return {"test": "TC-GAP-S3-02/TC-FINAL-COMM-02: 结算重复提交同 tx 奖励/税费只入账一次", "passed": passed}

static func _test_idempotent_breach() -> Dictionary:
	# Phase 40 GAP-03（TC-GAP-S3-03 / TC-FINAL-COMM-03）：同 tx 重复违约没收只一次
	var guild := OrganizationAggregate.new("ORG_GUILD", "冒险者公会总部")
	var comm := CommissionAggregate.new("COMM_IDEM_B", "幂等违约委托", CommissionAggregate.CommissionTier.WOOD, 100)
	comm.security_deposit_required = 30
	comm.status = CommissionAggregate.CommissionStatus.ACCEPTED_IN_PROGRESS
	var r1 = CommissionFSM.handle_commission_breach(comm, guild, "TX_BREACH_01")
	var r2 = CommissionFSM.handle_commission_breach(comm, guild, "TX_BREACH_01")
	var passed = r1.success and r2.success and guild.treasury_gold_coins == 30 \
		and comm.status == CommissionAggregate.CommissionStatus.FAILED_DEFAULTED
	return {"test": "TC-GAP-S3-03/TC-FINAL-COMM-03: 违约重复提交同 tx 保证金只没收一次", "passed": passed}

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 28: 组织委托悬赏与佣金结算系统"

	results.append(_test_tier_qualification_and_acceptance())
	results.append(_test_commission_payout_and_guild_tax())
	results.append(_test_breach_and_deposit_forfeiture())
	results.append(_test_idempotent_accept())
	results.append(_test_idempotent_settle())
	results.append(_test_idempotent_breach())

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

static func _test_tier_qualification_and_acceptance() -> Dictionary:
	var comm := CommissionAggregate.new("COMM_DRAGON_01", "讨伐深红幼龙", CommissionAggregate.CommissionTier.GOLD, 1000)
	comm.security_deposit_required = 50

	var wallet := CharacterWalletEntity.new()
	wallet.gold = 100

	# 铁牌见习生尝试接取金牌任务 -> 拦截 (TIER_TOO_LOW)
	var res1 = CommissionFSM.accept_commission(comm, "ACC_NOVICE", CommissionAggregate.CommissionTier.IRON, wallet, 1000)

	# 金牌大师接取 -> 成功并扣除 50 保证金
	var res2 = CommissionFSM.accept_commission(comm, "ACC_MASTER", CommissionAggregate.CommissionTier.GOLD, wallet, 1000)

	var passed = (not res1.success) and (res1.error_code == "TIER_TOO_LOW") and res2.success and (wallet.gold == 50) and (comm.status == CommissionAggregate.CommissionStatus.ACCEPTED_IN_PROGRESS)
	return {
		"test": "TC-COMM-01: 冒险者阶位资质门槛与保证金质押接取",
		"passed": passed
	}

static func _test_commission_payout_and_guild_tax() -> Dictionary:
	var guild := OrganizationAggregate.new("ORG_GUILD", "冒险者公会总部")
	var comm := CommissionAggregate.new("COMM_HERB", "采集星光草", CommissionAggregate.CommissionTier.WOOD, 200)
	comm.reward_mana_crystals = 10
	comm.org_tax_rate = 0.10 # 10% 抽成
	comm.security_deposit_required = 20
	comm.status = CommissionAggregate.CommissionStatus.ACCEPTED_IN_PROGRESS

	var wallet := CharacterWalletEntity.new()
	wallet.gold = 0
	wallet.mana_monocrystals = 0

	var res = CommissionFSM.settle_successful_commission(comm, wallet, guild)

	# 200 金币 * 90% = 180 + 20 保证金 = 200 金币；10 魔单晶 * 90% = 9
	# 公会金库获得 20 金币 + 1 魔单晶
	var passed = res.success and (wallet.gold == 200) and (wallet.mana_monocrystals == 9) and (guild.treasury_gold_coins == 20) and (guild.treasury_mana_crystals == 1) and (comm.status == CommissionAggregate.CommissionStatus.SETTLED_SUCCESS)
	return {
		"test": "TC-COMM-02: 委托赏金验收结算与公会 10% 税费自动划扣",
		"passed": passed
	}

static func _test_breach_and_deposit_forfeiture() -> Dictionary:
	var guild := OrganizationAggregate.new("ORG_GUILD", "冒险者公会总部")
	var comm := CommissionAggregate.new("COMM_FAIL", "未完成委托", CommissionAggregate.CommissionTier.WOOD, 100)
	comm.security_deposit_required = 30
	comm.status = CommissionAggregate.CommissionStatus.ACCEPTED_IN_PROGRESS

	var res = CommissionFSM.handle_commission_breach(comm, guild)
	var passed = res.success and (guild.treasury_gold_coins == 30) and (comm.status == CommissionAggregate.CommissionStatus.FAILED_DEFAULTED)
	return {
		"test": "TC-COMM-03: 违约失信没收履约保证金并转入公会金库",
		"passed": passed
	}
