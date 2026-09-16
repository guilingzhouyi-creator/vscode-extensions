# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/mail_system/mailbox_manager.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: inventory | 配置: config/domains/mail_system.json | 信号: EventBus 领域广播
# 职责说明: 维护信箱 100 封容量上限、已读无附件旧邮件自动 GC 清理、过期邮件失效
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name MailboxManager
extends RefCounted

const MAX_MAILBOX_CAPACITY: int = 100  # 运行时上限以配置为准，见 _max_capacity()

var stored_mails: Array[MailItemAggregate] = []

## 收信：空/重复 ID 拦截 → 满仓先 GC 清理 → 仍满拒绝 → 队首插入
func receive_mail(new_mail: MailItemAggregate) -> bool:
	if new_mail == null or new_mail.mail_id.is_empty() or get_mail_by_id(new_mail.mail_id) != null:
		return false
	var capacity := _max_capacity()
	if stored_mails.size() >= capacity:
		_purge_old_read_mails()

	if stored_mails.size() >= capacity:
		# 若清理后仍满仓，拒绝接收并告警
		return false

	stored_mails.push_front(new_mail)
	return true

## 信箱容量上限（mailbox/max_capacity 配置，下限 1）
func _max_capacity() -> int:
	return maxi(1, GameConfig.get_int("domains.mail_system", "mailbox/max_capacity", MAX_MAILBOX_CAPACITY))

## 按邮件 ID 检索（未命中返回 null）
func get_mail_by_id(p_mail_id: String) -> MailItemAggregate:
	for m in stored_mails:
		if m.mail_id == p_mail_id:
			return m
	return null

## 未读邮件计数
func get_unread_count() -> int:
	var cnt := 0
	for m in stored_mails:
		if m.status == MailItemAggregate.MailStatus.UNREAD:
			cnt += 1
	return cnt

## 过期失效：按过期时间戳批量置 EXPIRED（返回失效数）
func update_expiry(current_time_utc: int) -> int:
	var expired_count := 0
	for m in stored_mails:
		if m.expire_timestamp_utc > 0 and current_time_utc >= m.expire_timestamp_utc:
			if m.status != MailItemAggregate.MailStatus.EXPIRED:
				m.status = MailItemAggregate.MailStatus.EXPIRED
				expired_count += 1
	return expired_count

## GC 清理：从后向前回收已读已提取/已读无附件且非置顶邮件至容量达标
func _purge_old_read_mails() -> void:
	# 从后向前扫描已读且已提取附件（或已读且无附件）、且非置顶锁定的邮件
	var i = stored_mails.size() - 1
	while i >= 0 and stored_mails.size() >= _max_capacity():
		var m = stored_mails[i]
		if (not m.is_pinned) and (m.status == MailItemAggregate.MailStatus.READ_CLAIMED or (m.status == MailItemAggregate.MailStatus.READ_UNCLAIMED and not m.has_attachment)):
			stored_mails.remove_at(i)
		i -= 1
