# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 27 组织公会系统单元测试
# 文件路径: res://tests/unit/domains/test_organization_guild.gd
# ==============================================================================
class_name TestOrganizationGuildDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 27: 原生与自创组织公会自治管理系统"

	results.append(_test_rbac_governance_and_treasury())
	results.append(_test_diplomatic_relations_matrix())
	results.append(_test_tech_upgrade_and_buff_calculation())
	# Phase 55 L3 新增：金库取款符号守卫
	results.append(_test_negative_withdraw_rejected())

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

static func _test_rbac_governance_and_treasury() -> Dictionary:
	var guild := OrganizationAggregate.new("ORG_CRUSADE_01", "晨曦圣十字军团", OrganizationAggregate.OrganizationType.PLAYER_CREATED_CUSTOM)
	guild.add_member("ACC_MASTER", "团长亚瑟", OrganizationAggregate.GuildRole.GUILD_MASTER)
	guild.add_member("ACC_NOVICE", "见习见习生", OrganizationAggregate.GuildRole.NOVICE)
	guild.treasury_gold_coins = 2000
	guild.treasury_mana_crystals = 50

	# 见习生尝试提取金库 -> 拦截 (PERMISSION_DENIED)
	var res1 = OrganizationGovernanceSolver.withdraw_from_treasury(guild, "ACC_NOVICE", 100, 0)
	# 会长提取金库 -> 成功
	var res2 = OrganizationGovernanceSolver.withdraw_from_treasury(guild, "ACC_MASTER", 500, 10)

	var passed = (not res1.success) and (res1.error_code == "PERMISSION_DENIED") and res2.success and (guild.treasury_gold_coins == 1500) and (guild.treasury_mana_crystals == 40)
	return {
		"test": "TC-ORG-01: 组织职位 RBAC 鉴权与公共金库出纳审计",
		"passed": passed
	}

static func _test_diplomatic_relations_matrix() -> Dictionary:
	var guild := OrganizationAggregate.new("ORG_A", "秘术兄弟会")
	guild.add_member("ACC_MASTER", "大法师", OrganizationAggregate.GuildRole.GUILD_MASTER)
	guild.add_member("ACC_OFFICER", "执事", OrganizationAggregate.GuildRole.OFFICER)

	# 长老尝试宣战 -> 拦截
	var res1 = OrganizationGovernanceSolver.set_diplomatic_stance(guild, "ACC_OFFICER", "ORG_B", OrganizationAggregate.DiplomaticStance.AT_WAR)
	# 会长宣战 -> 成功
	var res2 = OrganizationGovernanceSolver.set_diplomatic_stance(guild, "ACC_MASTER", "ORG_B", OrganizationAggregate.DiplomaticStance.AT_WAR)

	var passed = (not res1.success) and res2.success and (guild.diplomatic_relations["ORG_B"] == OrganizationAggregate.DiplomaticStance.AT_WAR)
	return {
		"test": "TC-ORG-02: 公会最高外交宣战权限与矩阵迁移",
		"passed": passed
	}

static func _test_tech_upgrade_and_buff_calculation() -> Dictionary:
	var guild := OrganizationAggregate.new("ORG_C", "铁血工匠盟")
	guild.add_member("ACC_MASTER", "大工匠", OrganizationAggregate.GuildRole.GUILD_MASTER)
	guild.treasury_gold_coins = 5000
	guild.treasury_mana_crystals = 100

	var res_up = OrganizationTechFSM.upgrade_facility(guild, "ACC_MASTER", "BLACKSMITH_FORGE")
	var buffs = OrganizationTechFSM.calculate_guild_buff_modifiers(guild)

	var passed = res_up.success and (res_up.new_level == 2) and (guild.treasury_gold_coins == 4500) and (is_equal_approx(buffs["equipment_durability_loss_reduction"], 0.08))
	return {
		"test": "TC-ORG-03: 驻地科技设施升级与全员光环增益结算",
		"passed": passed
	}

## L3（Phase 55）：金库取款符号守卫——负金额不得经「-=」凭空入账（红证：修复前恒通过余额比较）
static func _test_negative_withdraw_rejected() -> Dictionary:
	var guild := OrganizationAggregate.new("ORG_SIGN", "符号守卫团", OrganizationAggregate.OrganizationType.PLAYER_CREATED_CUSTOM)
	guild.add_member("ACC_MASTER", "团长", OrganizationAggregate.GuildRole.GUILD_MASTER)
	guild.treasury_gold_coins = 1000
	guild.treasury_mana_crystals = 50

	var res_neg = OrganizationGovernanceSolver.withdraw_from_treasury(guild, "ACC_MASTER", -100, 0)
	var res_neg_crystal = OrganizationGovernanceSolver.withdraw_from_treasury(guild, "ACC_MASTER", 0, -5)
	var passed = (not res_neg.success) and res_neg.error_code == "INVALID_AMOUNT" \
		and (not res_neg_crystal.success) and res_neg_crystal.error_code == "INVALID_AMOUNT" \
		and guild.treasury_gold_coins == 1000 and guild.treasury_mana_crystals == 50
	return {
		"test": "TC-ORG-04: 金库取款符号守卫（L3：负金额 INVALID_AMOUNT、金库分毫不动）",
		"passed": passed
	}
