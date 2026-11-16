# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第8卷: 邮件系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_08_mail_system.gd
# ==============================================================================
class_name TestFE08MailSystem
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 08: 邮件系统（信箱列表/三类分类/附件提取）"

	results.append(_test_mailbox_list_and_capacity())
	results.append(_test_mail_read_and_select())
	results.append(_test_claim_all_attachments_preview())
	results.append(_test_mounted_real_mail_system())

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

static func _test_mailbox_list_and_capacity() -> Dictionary:
	var view = MailSystemView.new()
	view.set_mailbox_snapshot([
		{ "mail_id": "M1", "title": "开服福利", "is_read": false, "has_attachment": true, "is_claimed": false },
		{ "mail_id": "M2", "title": "维护补偿", "is_read": true, "has_attachment": false, "is_claimed": false }
	])

	var passed = (view.stored_mails.size() == 2) and (view.max_mailbox_capacity == 100)
	view.free()
	return {
		"test": "TC-FE08-01: 邮件信箱列表与容量进度装载",
		"passed": passed
	}

static func _test_mail_read_and_select() -> Dictionary:
	var view = MailSystemView.new()
	view.set_mailbox_snapshot([
		{ "mail_id": "M1", "title": "系统通知", "is_read": false }
	])
	var res = view.select_mail("M1")
	var passed = res.success and (view.selected_mail_id == "M1") and view.stored_mails[0].is_read
	view.free()
	return {
		"test": "TC-FE08-02: 邮件选中并自动标记已读状态",
		"passed": passed
	}

static func _test_claim_all_attachments_preview() -> Dictionary:
	var view = MailSystemView.new()
	view.set_mailbox_snapshot([
		{ "mail_id": "M1", "has_attachment": true, "is_claimed": false },
		{ "mail_id": "M2", "has_attachment": true, "is_claimed": false }
	])
	var res = view.claim_all_attachments_preview()
	var passed = res.success and (res.claimed_mails_count == 2)
	view.free()
	return {
		"test": "TC-FE08-03: 一键提取所有未领附件界面状态变更",
		"passed": passed
	}

static func _test_mounted_real_mail_system() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/mail_system/mail_system_view.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var mounted_view: MailSystemView = mount_handle.get("view", null) as MailSystemView
	if mounted_view != null:
		mounted_view.set_mailbox_snapshot([
			{ "mail_id": "M_REAL_01", "title": "系统补发", "is_read": false, "has_attachment": true, "is_claimed": false }
		])
		var read_outcome := mounted_view.select_mail("M_REAL_01")
		mounted_view._tabs.on_save_draft()
		mounted_view._tabs.on_send()
		passed = passed and mounted_view.is_mounted_in_tree() and mounted_view.get_child_count() > 0 and bool(read_outcome.get("success", false))
	FeMountHelper.unmount_scene(mount_handle)
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {
		"test": "TC-FE08-04: 真场景挂载 mail_system_view.tscn（real 模式读写草稿发送与零残留）",
		"passed": passed and (orphan_after <= orphan_before)
	}
