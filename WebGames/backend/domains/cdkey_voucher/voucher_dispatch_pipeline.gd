# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/cdkey_voucher/voucher_dispatch_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/cdkey_voucher.json | 信号: EventBus 领域广播
# 职责说明: 执行兑换结算，将货币与道具统一打包为邮件附件经邮件系统发放（Phase 35 唯一规范路径）； 道具发放走物品注册表三元组（template_id 必填为已登记 canonical_id， 未登记模板严格计入失败，不造临时物件）。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name VoucherDispatchPipeline
extends RefCounted

# ==============================================================================
# 邮件发放（Phase 35 S2 唯一规范路径）
# ==============================================================================

## 兑换成功后经邮件系统统一发放奖励：构造 MailItemAggregate 附件载荷并投递到
## 收件人邮箱，玩家经邮件领取资产——兑换系统不直接修改钱包/背包。
## payload 键：mana_monocrystals/gold_coins/silver_coins/copper_coins/item_templates。
## mailbox 为收件人 MailboxManager 实例（receive_mail 为既有投递 API，零修改 mail 域）。
static func dispatch_rewards_via_mail(
	payload: Dictionary,
	mailbox: MailboxManager,
	recipient_account_id: String,
	mail_id: String = ""
) -> Dictionary:
	var crystals := int(payload.get("mana_monocrystals", 0))
	var gold := int(payload.get("gold_coins", 0))
	var silver := int(payload.get("silver_coins", 0))
	var copper := int(payload.get("copper_coins", 0))
	var item_templates: Array = payload.get("item_templates", [])

	if mailbox == null or recipient_account_id.is_empty():
		return { "success": false, "error_code": "MAIL_DISPATCH_INVALID", "mail_id": mail_id }

	var mail := MailItemAggregate.new(
		# M3（Phase 52）：默认 mail_id 走唯一 ID 生成器（同毫秒防碰撞序号），
		# 替代秒级时间戳裸拼——杜绝同秒跨账户/同账户同秒投递 id 碰撞
		mail_id if not mail_id.is_empty() else UniqueIdGenerator.next_id("CDK"),
		recipient_account_id,
		_mail_title(),
		_mail_body()
	)
	mail.has_attachment = (crystals > 0 or gold > 0 or silver > 0 or copper > 0 or not item_templates.is_empty())
	mail.attachment_crystals = crystals
	mail.attachment_gold = gold
	mail.attachment_silver = silver
	mail.attachment_copper = copper
	mail.attachment_items = item_templates.duplicate(true)
	mail.sent_timestamp_utc = Time.get_unix_time_from_system()

	var delivered: bool = mailbox.receive_mail(mail)
	return {
		"success": delivered,
		"error_code": "" if delivered else "MAIL_DELIVERY_FAILED",
		"mail_id": mail.mail_id,
		"has_attachment": mail.has_attachment
	}

# ==============================================================================
# 配置读取（兜底显示名由 config/narratives/cdkey_voucher.json 驱动）
# ==============================================================================

static func _default_item_name() -> String:
	return GameConfig.get_string("narratives.cdkey_voucher", "item_dispatch_fallback_name", "物品")

static func _mail_title() -> String:
	return GameConfig.get_string("narratives.cdkey_voucher", "mail_title", "兑换码礼包")

static func _mail_body() -> String:
	return GameConfig.get_string("narratives.cdkey_voucher", "mail_body", "您的兑换码礼包已送达，请查收附件奖励。")
