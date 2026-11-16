# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第14卷: 通知与公告系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_14_notification_bulletin.gd
# ==============================================================================
class_name TestFE14NotificationBulletin
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 14: 通知与公告系统（Toast/Modal/红点树/告示板）"

	results.append(_test_toast_stack_push())
	results.append(_test_modal_dialog_open_close())
	results.append(_test_red_dot_badge_sync())
	results.append(_test_mounted_real_notification_bulletin())

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

static func _test_toast_stack_push() -> Dictionary:
	var view = NotificationBulletinView.new()
	var res = view.push_toast("获得了 100 金币", 2.5)

	var passed = res.success and (view.toast_queue.size() == 1) and is_equal_approx(view.toast_queue[0].duration, 2.5)
	view.free()
	return {
		"test": "TC-FE14-01: 浮动气泡Toast堆叠调度与时长设置",
		"passed": passed
	}

static func _test_modal_dialog_open_close() -> Dictionary:
	var view = NotificationBulletinView.new()
	view.show_modal_dialog("二次确认", "是否消耗500金币购买？", "CONFIRM_BUY")
	var is_open = not view.active_modal_dialog.is_empty()
	view.close_modal_dialog()
	var is_closed = view.active_modal_dialog.is_empty()

	var passed = is_open and is_closed
	view.free()
	return {
		"test": "TC-FE14-02: 模态二次确认弹窗弹出与关闭生命周期",
		"passed": passed
	}

static func _test_red_dot_badge_sync() -> Dictionary:
	var view = NotificationBulletinView.new()
	view.set_red_dot_badge("menu.mail", 5)
	var passed = (view.red_dot_badges.get("menu.mail", 0) == 5)
	view.free()
	return {
		"test": "TC-FE14-03: 有向红点树节点聚合计数向UI角标映射",
		"passed": passed
	}

static func _test_mounted_real_notification_bulletin() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/notification_bulletin/notification_bulletin_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: NotificationBulletinView = mount_handle.get("view", null) as NotificationBulletinView
	if mounted_view != null:
		var toast_outcome := mounted_view.push_toast("真实场景消息验证", 1.5)
		mounted_view._on_tab_changed(1)
		mounted_view._on_tab_changed(2)
		mounted_view.set_red_dot_badge("menu.quest", 2)
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and bool(toast_outcome.get("success", false))
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE14-04: 真场景挂载 notification_bulletin_view.tscn（real 模式公告/红点与零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}
