# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第8卷: 邮件系统白模测试
# 文件路径: res://tests/unit/frontend/test_fe_08_mail_system.gd
# ==============================================================================
class_name TestFE08MailSystem
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "FE Vol 08: 邮件系统（信箱列表/三类分类/附件提取）"

	results.append(_test_mailbox_list_and_capacity())
	results.append(_test_mail_read_and_select())
	results.append(_test_claim_all_attachments_preview())

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
