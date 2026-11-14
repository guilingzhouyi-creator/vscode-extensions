# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_mail_service.gd
# 架构定位: Domain Boundary Mock / Simulated Mail Service
# 依赖与触发: 上游: MockServiceContainer, 邮箱界面 | 下游: GameConfig
# 职责说明: 提供模拟邮箱容量查询、已读/附件领取状态跃迁与批量删除，返回新副本不原地篡改入参。
# 退出语义与设计依据: 配置驱动容量上限与不可变状态副本返回契约
# ==============================================================================

## MockMailService：玩家邮箱容量与附件领取模拟服务
class_name MockMailService
extends IMailService

const RULES_SECTION := "frontend.views"
const RULES_KEY := "fe08_mail_system"

## 从 GameConfig 读取邮箱容量上限配置
func get_max_capacity() -> int:
	return GameConfig.get_int(RULES_SECTION, RULES_KEY + "/max_mailbox_capacity", 100)

## 将指定 ID 的邮件标记为已读并返回深拷贝后的邮件列表
func mark_read(mails: Array, mail_id: String) -> Array:
	var updated: Array = mails.duplicate(true)
	for mail in updated:
		if str(mail.get("mail_id", "")) == mail_id:
			mail["is_read"] = true
			break
	return updated

## 按给定邮件 ID 列表过滤删除邮件并返回保留列表
func delete_by_ids(mails: Array, ids: Array) -> Array:
	var kept: Array = []
	for mail in mails:
		if not ids.has(str(mail.get("mail_id", ""))):
			kept.append(mail)
	return kept

## 一键领取所有未领附件邮件并返回更新后的列表与领取计数
func claim_all(mails: Array) -> Dictionary:
	var updated: Array = mails.duplicate(true)
	var claimed := 0
	for mail in updated:
		if bool(mail.get("has_attachment", false)) and not bool(mail.get("is_claimed", false)):
			mail["is_claimed"] = true
			claimed += 1
	return {"success": true, "mails": updated, "claimed_count": claimed}

## 领取单封指定邮件的附件并返回操作结果
func claim_one(mails: Array, mail_id: String) -> Dictionary:
	var updated: Array = mails.duplicate(true)
	for mail in updated:
		if str(mail.get("mail_id", "")) == mail_id:
			mail["is_claimed"] = true
			return {"success": true, "mails": updated, "mail_id": mail_id}
	return {"success": false, "error_code": "MAIL_NOT_FOUND", "mails": updated}
