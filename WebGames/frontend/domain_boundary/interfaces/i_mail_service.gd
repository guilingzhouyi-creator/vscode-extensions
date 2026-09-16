# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 邮件服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_mail_service.gd
# 职责: 规范邮箱容量、已读标记、附件领取与批量删除接口
# ==============================================================================
class_name IMailService
extends RefCounted

## 邮箱容量上限（配置驱动）
func get_max_capacity() -> int:
	printerr("IMailService.get_max_capacity: 纯虚函数必须由子类实现")
	return 0

## 标记指定邮件已读 → 新邮件数组
func mark_read(mails: Array, mail_id: String) -> Array:
	printerr("IMailService.mark_read: 纯虚函数必须由子类实现")
	return mails

## 按 mail_id 集合批量删除 → 新邮件数组
func delete_by_ids(mails: Array, ids: Array) -> Array:
	printerr("IMailService.delete_by_ids: 纯虚函数必须由子类实现")
	return mails

## 一键领取全部未领取附件 → {success, mails, claimed_count}
func claim_all(mails: Array) -> Dictionary:
	printerr("IMailService.claim_all: 纯虚函数必须由子类实现")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 领取单封邮件附件 → {success, mails, mail_id}
func claim_one(mails: Array, mail_id: String) -> Dictionary:
	printerr("IMailService.claim_one: 纯虚函数必须由子类实现")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}
