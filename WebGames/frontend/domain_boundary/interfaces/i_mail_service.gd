# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 邮件服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_mail_service.gd
# 职责: 规范邮箱容量、已读标记、附件领取与批量删除接口
# ==============================================================================
class_name IMailService
extends RefCounted

## 邮箱容量上限（配置驱动）
func get_max_capacity() -> int:
	EventBusCore.get_instance().emit_log("error", "IMailService.get_max_capacity: pure virtual method must be implemented by subclass")
	return 0

## 标记指定邮件已读 → 新邮件数组
func mark_read(mails: Array, mail_id: String) -> Array:
	EventBusCore.get_instance().emit_log("error", "IMailService.mark_read: pure virtual method must be implemented by subclass")
	return mails

## 按 mail_id 集合批量删除 → 新邮件数组
func delete_by_ids(mails: Array, ids: Array) -> Array:
	EventBusCore.get_instance().emit_log("error", "IMailService.delete_by_ids: pure virtual method must be implemented by subclass")
	return mails

## 一键领取全部未领取附件 → {success, mails, claimed_count}
func claim_all(mails: Array) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IMailService.claim_all: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 领取单封邮件附件 → {success, mails, mail_id}
func claim_one(mails: Array, mail_id: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IMailService.claim_one: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}
