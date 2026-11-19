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
	var updated_mails: Array = mails.duplicate(true)
	for mail_entry in updated_mails:
		if str(mail_entry.get("mail_id", "")) == mail_id:
			mail_entry["is_read"] = true
			break
	return updated_mails

## 按给定邮件 ID 列表过滤删除邮件并返回保留列表
func delete_by_ids(mails: Array, mail_ids: Array) -> Array:
	var remaining_mails: Array = []
	for mail_entry in mails:
		if not mail_ids.has(str(mail_entry.get("mail_id", ""))):
			remaining_mails.append(mail_entry)
	return remaining_mails

## 一键领取所有未领附件邮件并返回更新后的列表与领取计数
func claim_all(mails: Array) -> Dictionary:
	var updated_mails: Array = mails.duplicate(true)
	var claimed_count := 0
	for mail_entry in updated_mails:
		if bool(mail_entry.get("has_attachment", false)) and not bool(mail_entry.get("is_claimed", false)):
			mail_entry["is_claimed"] = true
			claimed_count += 1
	return {"success": true, "mails": updated_mails, "claimed_count": claimed_count}

## 领取单封指定邮件的附件并返回操作结果
func claim_one(mails: Array, mail_id: String) -> Dictionary:
	var updated_mails: Array = mails.duplicate(true)
	for mail_entry in updated_mails:
		if str(mail_entry.get("mail_id", "")) == mail_id:
			mail_entry["is_claimed"] = true
			return {"success": true, "mails": updated_mails, "mail_id": mail_id}
	return {"success": false, "error_code": "MAIL_NOT_FOUND", "mails": updated_mails}

## 模拟分发发信或存草稿协议动作
func dispatch_mail_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
