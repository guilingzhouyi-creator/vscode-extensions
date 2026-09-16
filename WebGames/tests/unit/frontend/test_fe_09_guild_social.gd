# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第9卷: 社交与公会系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_09_guild_social.gd
# ==============================================================================
class_name TestFE09GuildSocial
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 09: 社交与公会系统（公会管理/RBAC职位/科技）"

	results.append(_test_guild_snapshot_loading())
	results.append(_test_rbac_management_permissions())
	results.append(_test_guild_tech_tree_rendering())

	var passed_cnt = 0
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

static func _test_guild_snapshot_loading() -> Dictionary:
	var view = GuildSocialView.new()
	view.set_guild_snapshot("圣光骑士团", 3, 50000, [
		{ "account_id": "ACC_LEADER", "role": "LEADER", "contribution": 12000 }
	], [])

	var passed = (view.guild_name == "圣光骑士团") and (view.vault_gold == 50000) and (view.member_roster.size() == 1)
	view.free()
	return {
		"test": "TC-FE09-01: 公会基本信息与金库余额快照装载",
		"passed": passed
	}

static func _test_rbac_management_permissions() -> Dictionary:
	var view = GuildSocialView.new()
	var ok_leader = view.can_manage_members("LEADER")
	var ok_officer = view.can_manage_members("OFFICER")
	var no_member = view.can_manage_members("MEMBER")

	var passed = ok_leader and ok_officer and (not no_member)
	view.free()
	return {
		"test": "TC-FE09-02: 职位RBAC权限矩阵管理按钮显示权限鉴别",
		"passed": passed
	}

static func _test_guild_tech_tree_rendering() -> Dictionary:
	var view = GuildSocialView.new()
	view.set_guild_snapshot("商会联盟", 2, 10000, [], [
		{ "tech_id": "TECH_EXP_BOOST", "level": 2, "max_level": 5 },
		{ "tech_id": "TECH_VAULT_EXPAND", "level": 1, "max_level": 3 }
	])

	var passed = (view.tech_nodes.size() == 2) and (view.tech_nodes[0].level == 2)
	view.free()
	return {
		"test": "TC-FE09-03: 驻地科技树等级与被动光环数据装载",
		"passed": passed
	}
