# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/mail_system/mail_item_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: inventory | 配置: config/domains/mail_system.json | 信号: EventBus 领域广播
# 职责说明: 邮件领域实体定义，包含未读/已读/已领/过期生命周期与附件载荷 DTO
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name MailItemAggregate
extends RefCounted

enum MailStatus {
	UNREAD,             # 未读状态
	READ_UNCLAIMED,     # 已读但附件未领取
	READ_CLAIMED,       # 已读且附件已提取
	EXPIRED             # 已过期
}

var mail_id: String = ""                         # 邮件全局唯一 ID (UUID)
var sender_name: String = "GM_SYSTEM"            # 发件人 (如 "卡拉尔神殿议会" / "GM_SYSTEM")
var recipient_account_id: String = ""            # 收件人账户 ID
var title: String = ""                           # 邮件标题
var text_content: String = ""                    # 邮件正文

var status: MailStatus = MailStatus.UNREAD
var sent_timestamp_utc: int = 0                  # 发送时间戳
var expire_timestamp_utc: int = 0                # 过期销毁时间戳 (0 为永久)
var is_pinned: bool = false                      # 是否重要置顶锁定 (GC 不自动清理)

# 附件载荷包 (Attachment Payload DTO)
var has_attachment: bool = false
var attachment_crystals: int = 0
var attachment_gold: int = 0
var attachment_silver: int = 0
var attachment_copper: int = 0
var attachment_items: Array = []                 # [{"template_id": "WEAPON_LEGENDARY", "count": 1, "mass_kg": 2.5}]

## 邮件聚合构造（ID/收件人/标题/正文/发件人）
func _init(
	p_id: String = "",
	p_recipient: String = "",
	p_title: String = "",
	p_content: String = "",
	p_sender: String = "GM_SYSTEM"
) -> void:
	mail_id = p_id
	recipient_account_id = p_recipient
	title = p_title
	text_content = p_content
	sender_name = p_sender

## 标记已读：按有无附件分派 READ_UNCLAIMED / READ_CLAIMED
func mark_read() -> void:
	if status == MailStatus.UNREAD:
		status = MailStatus.READ_UNCLAIMED if has_attachment else MailStatus.READ_CLAIMED

## 未领取附件判定（有附件且未领未过期）
func has_unclaimed_attachment() -> bool:
	return has_attachment and status != MailStatus.READ_CLAIMED and status != MailStatus.EXPIRED
