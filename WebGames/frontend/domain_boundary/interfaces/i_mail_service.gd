# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_mail_service.gd
# 架构定位: Domain Boundary Interface / Mail Service Contract
# 依赖与触发: 上游: 邮箱界面, ServiceContainer | 下游: MockMailService
# 职责说明: 规范邮箱容量查询、已读标记、附件批量领取与邮件删除边界接口。
# 退出语义与设计依据: 表现层零邮箱存储状态修改与领域边界解耦契约
# ==============================================================================

## IMailService：玩家邮箱容量与附件领取消化服务抽象接口
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
