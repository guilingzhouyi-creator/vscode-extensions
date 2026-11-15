# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_mail_service.gd
# 架构定位: Domain Boundary Adapter / Real Mail Service Bridge
# 依赖与触发: 上游: MailSystemView, ServiceContainer, ServiceLocator | 下游: GameConfig
# 职责说明: 实现 IMailService 接口，遵循邮箱容量配置及不可变集合变换规则处理读信、删信与领奖。
# 退出语义与设计依据: 表现层零邮箱存储规则改写与配置唯一真源契约
# ==============================================================================

## RealMailService：依据邮箱配置执行已读标记、附件签收与批量清理的真实邮件服务
class_name RealMailService
extends "res://frontend/domain_boundary/interfaces/i_mail_service.gd"

func _clone_and_process_mail(raw_entry: Variant, mode: String, filter_set: Dictionary) -> Dictionary:
	if not (raw_entry is Dictionary):
		return {"skip": true, "changed": false, "entry": {}}
	var entry_copy: Dictionary = raw_entry.duplicate(true)
	var entry_id: String = str(entry_copy.get("mail_id", ""))
	if mode == "delete":
		var should_remove: bool = filter_set.has(entry_id)
		return {"skip": should_remove, "changed": should_remove, "entry": entry_copy}
	if mode == "read":
		var marked_now: bool = filter_set.has(entry_id)
		if marked_now:
			entry_copy["is_read"] = true
		return {"skip": false, "changed": marked_now, "entry": entry_copy}
	if mode == "claim":
		var should_claim: bool = filter_set.is_empty() or filter_set.has(entry_id)
		var attachments: Array = entry_copy.get("attachments", []) as Array
		var has_attach: bool = bool(entry_copy.get("has_attachment", false)) or not attachments.is_empty()
		var already_claimed: bool = bool(entry_copy.get("is_claimed", entry_copy.get("claimed", false)))
		if should_claim and has_attach and not already_claimed:
			entry_copy["claimed"] = true
			entry_copy["is_claimed"] = true
			entry_copy["is_read"] = true
			return {"skip": false, "changed": true, "entry": entry_copy}
	return {"skip": false, "changed": false, "entry": entry_copy}

func _transform_mails(mails: Array, mode: String, filter_set: Dictionary) -> Dictionary:
	var next_mails: Array = []
	var changed_count: int = 0
	for raw_entry in mails:
		var step_outcome: Dictionary = _clone_and_process_mail(raw_entry, mode, filter_set)
		if bool(step_outcome.get("changed", false)):
			changed_count += 1
		if not bool(step_outcome.get("skip", false)):
			next_mails.append(step_outcome.get("entry", {}))
	return {"mails": next_mails, "changed_count": changed_count}

## 读取配置的邮箱容量上限
func get_max_capacity() -> int:
	return maxi(1, GameConfig.get_int("domains.mail_system", "mailbox/max_capacity", 100))

## 将目标邮件标记为已读并返回新邮件列表
func mark_read(mails: Array, mail_id: String) -> Array:
	var outcome: Dictionary = _transform_mails(mails, "read", {mail_id: true})
	return outcome.get("mails", []) as Array

## 批量移除指定 mail_id 集合对应的邮件
func delete_by_ids(mails: Array, mail_ids: Array) -> Array:
	var remove_lookup: Dictionary = {}
	for target_id in mail_ids:
		remove_lookup[str(target_id)] = true
	var outcome: Dictionary = _transform_mails(mails, "delete", remove_lookup)
	return outcome.get("mails", []) as Array

## 一键签收全部未领取邮件附件并同步置为已读
func claim_all(mails: Array) -> Dictionary:
	var outcome: Dictionary = _transform_mails(mails, "claim", {})
	return {
		"success": true,
		"mails": outcome.get("mails", []) as Array,
		"claimed_count": int(outcome.get("changed_count", 0)),
	}

## 签收单封指定邮件附件并同步置为已读
func claim_one(mails: Array, mail_id: String) -> Dictionary:
	var outcome: Dictionary = _transform_mails(mails, "claim", {mail_id: true})
	return {
		"success": int(outcome.get("changed_count", 0)) > 0,
		"mails": outcome.get("mails", []) as Array,
		"mail_id": mail_id,
		"claimed_count": int(outcome.get("changed_count", 0)),
	}
