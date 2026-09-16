# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第2卷: 主界面 HUD 白模测试
# 文件路径: res://tests/unit/frontend/test_fe_02_main_hud.gd
# ==============================================================================
class_name TestFE02MainHUD
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 02: 主界面 HUD（顶栏状态/小地图/操作栏/聊天/战报）"

	results.append(_test_top_status_bar_snapshot())
	results.append(_test_action_bar_trigger_and_cd())
	results.append(_test_chat_channel_and_terminal_buffer())
	results.append(_test_chat_input_completion())

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

static func _test_top_status_bar_snapshot() -> Dictionary:
	var hud = MainHUDView.new()
	hud.update_status_snapshot(85.0, 100.0, 30.0, 50.0, 8.5, 10.0, 250, 15)

	var passed = is_equal_approx(hud.stat_hp_current, 85.0) and \
				 is_equal_approx(hud.stat_mp_current, 30.0) and \
				 (hud.wallet_gold == 250) and (hud.wallet_mana_crystals == 15)
	hud.free()
	return {
		"test": "TC-FE02-01: 顶栏生理指标与货币快照数值装载与计算",
		"passed": passed
	}

static func _test_action_bar_trigger_and_cd() -> Dictionary:
	var hud = MainHUDView.new()
	var r_ready = hud.trigger_action_slot(1)
	var r_cd = hud.trigger_action_slot(2)
	var r_empty = hud.trigger_action_slot(5)

	var passed = r_ready.success and (not r_cd.success) and (r_cd.reason == "COOLDOWN_ACTIVE") and \
				 (not r_empty.success) and (r_empty.reason == "EMPTY_SLOT")
	hud.free()
	return {
		"test": "TC-FE02-02: 快捷操作栏冷却限制与槽位按键触发拦截",
		"passed": passed
	}

static func _test_chat_channel_and_terminal_buffer() -> Dictionary:
	var hud = MainHUDView.new()
	hud.switch_chat_channel(MainHUDView.ChatChannel.COMBAT)
	hud.append_terminal_log("COMBAT", "造成 128 点暴击伤害")
	hud.append_terminal_log("SYSTEM", "获得 50 经验值")

	var passed = (hud.current_channel == MainHUDView.ChatChannel.COMBAT) and \
				 (hud.message_terminal_buffer.size() == 2)
	hud.free()
	return {
		"test": "TC-FE02-03: 聊天频道切换与战报终端消息流滚动缓冲",
		"passed": passed
	}

static func _test_chat_input_completion() -> Dictionary:
	var hud := MainHUDView.new()
	# 滚动区与输入框严格区分：滚动区保留历史消息，补全只作用于输入框
	hud.append_terminal_log("SYSTEM", "历史消息")
	hud.set_chat_input("/give mithril_longsword")

	# 第一次 Tab：单击（面板未打开，无副作用）
	var r1 = hud.feed_chat_key_press("Key_Tab", 1000)
	# 窗口期内第二次 Tab：双击 -> 打开补全面板（最近 20 条，无最近回退默认目录）
	var r2 = hud.feed_chat_key_press("Key_Tab", 1150)
	var panel_ok = r1.is_single_tap and r2.is_double_tap and hud.completion_visible \
		and hud.completion_total_pages >= 1 and hud.completion_entries.size() >= 1

	# 补全面板不污染滚动区消息流
	var scroll_ok = hud.message_terminal_buffer.size() == 1 and hud.chat_input_text == "/give mithril_longsword"

	# 面板可见时再次 Tab：最近适配补全写入输入框命令词
	var r3 = hud.feed_chat_key_press("Key_Tab", 2000)
	var apply_ok = r3.success and hud.chat_input_text == "/give"

	# 输入框失焦：收起补全面板并重置连按状态
	hud.blur_chat_input()
	var blur_ok = (not hud.completion_visible) and (not hud.chat_input_focused)

	var passed = panel_ok and scroll_ok and apply_ok and blur_ok
	hud.free()
	return {
		"test": "TC-FE02-04: 聊天输入框与滚动区隔离 + Tab 双击补全/单击最近适配",
		"passed": passed
	}
