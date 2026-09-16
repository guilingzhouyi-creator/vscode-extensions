# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 41 登录告示板与维护系统单元测试
# 文件路径: res://tests/unit/domains/test_bulletin_board_maintenance.gd
# ==============================================================================
class_name TestBulletinBoardMaintenanceDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 41: 登录告示板与服务器维护闸门系统"

	results.append(_test_maintenance_gatekeeper_blocking())
	results.append(_test_gm_account_maintenance_bypass())
	results.append(_test_announcement_cards_priority_sorting())

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

static func _test_maintenance_gatekeeper_blocking() -> Dictionary:
	var board := BulletinBoardAggregate.new()
	BulletinPushPipeline.set_maintenance(board, true, 1800, 1000, "2.0 大版本更新维护中")

	# 普通玩家在 1000 时间尝试登录 -> 拦截 (ERR_SERVER_MAINTENANCE)
	var res = BulletinBoardSolver.check_login_permission(board, false, 1000)
	var passed = (not res.allow_login) and (res.error_code == "ERR_SERVER_MAINTENANCE") and (res.remain_seconds == 1800)

	return {
		"test": "TC-BULLETIN-01: 服务器维护模式下普通玩家登录强阻断与倒计时",
		"passed": passed
	}

static func _test_gm_account_maintenance_bypass() -> Dictionary:
	var board := BulletinBoardAggregate.new()
	BulletinPushPipeline.set_maintenance(board, true, 3600, 1000)

	# GM 账户尝试登录 -> 允许放行
	var res = BulletinBoardSolver.check_login_permission(board, true, 1000)
	var passed = res.allow_login

	return {
		"test": "TC-BULLETIN-02: 管理员 GM 账号维护白名单特权放行验证",
		"passed": passed
	}

static func _test_announcement_cards_priority_sorting() -> Dictionary:
	var board := BulletinBoardAggregate.new()
	var card_low := BulletinBoardAggregate.BulletinCardDTO.new("C_LOW", 50, "常规活动", "内容")
	var card_high := BulletinBoardAggregate.BulletinCardDTO.new("C_HIGH", 900, "紧急热补丁", "内容")
	var card_mid := BulletinBoardAggregate.BulletinCardDTO.new("C_MID", 200, "开服福利", "内容")

	board.add_card(card_low)
	board.add_card(card_high)
	board.add_card(card_mid)

	var passed = (board.announcement_cards.size() == 3) and \
				 (board.announcement_cards[0].card_id == "C_HIGH") and \
				 (board.announcement_cards[1].card_id == "C_MID") and \
				 (board.announcement_cards[2].card_id == "C_LOW")

	return {
		"test": "TC-BULLETIN-03: 公告卡片集合动态优先级权重降序排序",
		"passed": passed
	}
