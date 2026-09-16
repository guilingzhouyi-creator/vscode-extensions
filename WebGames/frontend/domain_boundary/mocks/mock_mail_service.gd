# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟邮件服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_mail_service.gd
# 职责: 邮箱容量、已读/领取状态跃迁与批量删除（视图只做列表渲染）
# ==============================================================================
class_name MockMailService
extends IMailService

const RULES_SECTION := "frontend.views"
const RULES_KEY := "fe08_mail_system"

func get_max_capacity() -> int:
	return GameConfig.get_int(RULES_SECTION, RULES_KEY + "/max_mailbox_capacity", 100)

func mark_read(mails: Array, mail_id: String) -> Array:
	var updated: Array = mails.duplicate(true)
	for mail in updated:
		if str(mail.get("mail_id", "")) == mail_id:
			mail["is_read"] = true
			break
	return updated

func delete_by_ids(mails: Array, ids: Array) -> Array:
	var kept: Array = []
	for mail in mails:
		if not ids.has(str(mail.get("mail_id", ""))):
			kept.append(mail)
	return kept

func claim_all(mails: Array) -> Dictionary:
	var updated: Array = mails.duplicate(true)
	var claimed := 0
	for mail in updated:
		if bool(mail.get("has_attachment", false)) and not bool(mail.get("is_claimed", false)):
			mail["is_claimed"] = true
			claimed += 1
	return {"success": true, "mails": updated, "claimed_count": claimed}

func claim_one(mails: Array, mail_id: String) -> Dictionary:
	var updated: Array = mails.duplicate(true)
	for mail in updated:
		if str(mail.get("mail_id", "")) == mail_id:
			mail["is_claimed"] = true
			return {"success": true, "mails": updated, "mail_id": mail_id}
	return {"success": false, "error_code": "MAIL_NOT_FOUND", "mails": updated}
