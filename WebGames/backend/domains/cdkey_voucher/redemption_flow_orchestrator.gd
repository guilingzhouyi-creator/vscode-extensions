# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/cdkey_voucher/redemption_flow_orchestrator.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/cdkey_voucher.json | 信号: EventBus 领域广播
# 职责说明: 统一兑换生命周期编排：事务键去重 -> 资格判定/原子核销 -> 成功记录 -> 邮件投递 -> DISPATCH_PENDING 恢复重发。流程一致性契约（Phase 37 S2）： - 门槛未达标/判定失败：可重试失败态，零核销写入（对齐 Phase 35） - 核销成功即写记录（transaction_id 唯一）；投递失败标记 DISPATCH_PENDING， 恢复后按记录重发，不重复核销 - 审计：判定原因/状态跃迁/投递操作结构化留痕（供日志/审计，不暴露客户端）
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name RedemptionFlowOrchestrator
extends RefCounted

## 流程记录（内存态；生产环境由外部持久化接入——记录按 transaction_id 唯一）
static var _records: Dictionary = {}

static func reset_records() -> void:
	_records.clear()

## 统一兑换入口：
## request 键：transaction_id / account_id / character_level / voucher_code /
##            current_time_utc / voucher_registry / rate_limit_state /
##            account_history / unique_redeemed / eligibility_metrics /
##            mailbox / eligibility_rules_override
static func process_redemption(request: Dictionary) -> Dictionary:
	var tx_id := String(request.get("transaction_id", ""))
	if tx_id.is_empty():
		return { "success": false, "code": "TRANSACTION_ID_REQUIRED", "precise_reason": "TRANSACTION_ID_REQUIRED" }
	if _records.has(tx_id):
		return { "success": false, "code": "DUPLICATE_TRANSACTION", "precise_reason": "DUPLICATE_TRANSACTION:%s" % tx_id }

	# 1. 资格判定 + 原子核销（内部精确原因由 solver 保留）
	var res := CDKeyRedemptionSolver.resolve_redemption(
		String(request.get("account_id", "")),
		int(request.get("character_level", 1)),
		String(request.get("voucher_code", "")),
		int(request.get("current_time_utc", 0)),
		request.get("voucher_registry", {}),
		request.get("rate_limit_state", {}),
		request.get("account_history", {}),
		request.get("unique_redeemed", {}),
		request.get("eligibility_metrics", {}),
		request.get("eligibility_rules_override", {})
	)
	if not res.get("success", false):
		return res  # 判定失败透传（未达标/无效等——均未核销）

	# 2. 成功记录（transaction_id 唯一）
	_records[tx_id] = {
		"status": "RECORDED",
		"account_id": String(request.get("account_id", "")),
		"voucher_code": String(request.get("voucher_code", "")),
		"payload": res.get("payload", {}),
		"precise_reason": "OK"
	}

	# 3. 邮件投递（唯一发放路径）
	var dispatched := VoucherDispatchPipeline.dispatch_rewards_via_mail(
		res.get("payload", {}),
		request.get("mailbox"),
		String(request.get("account_id", ""))
	)
	if not dispatched.get("success", false):
		_records[tx_id]["status"] = "DISPATCH_PENDING"
		_records[tx_id]["pending_since_utc"] = int(request.get("current_time_utc", 0))
		_records[tx_id]["retry_count"] = 0
		return {
			"success": false,
			"code": "DISPATCH_PENDING",
			"precise_reason": "DISPATCH_PENDING:%s" % tx_id,
			"retryable": true
		}

	_records[tx_id]["status"] = "DISPATCHED"
	_records[tx_id]["mail_id"] = dispatched.get("mail_id", "")
	prune_records()
	return {
		"success": true,
		"code": "OK",
		"precise_reason": "OK",
		"mail_id": dispatched.get("mail_id", ""),
		"record_status": "DISPATCHED"
	}

## 投递失败恢复重发：按记录重发邮件，不重复核销（事务键去重保证单次核销）
static func retry_dispatch(tx_id: String, mailbox: MailboxManager) -> Dictionary:
	if not _records.has(tx_id):
		return { "success": false, "code": "RECORD_NOT_FOUND", "precise_reason": "RECORD_NOT_FOUND:%s" % tx_id }
	var record: Dictionary = _records[tx_id]
	if record.get("status", "") != "DISPATCH_PENDING":
		return { "success": false, "code": "NOT_PENDING", "precise_reason": "NOT_PENDING:%s" % tx_id }

	var dispatched := VoucherDispatchPipeline.dispatch_rewards_via_mail(
		record.get("payload", {}),
		mailbox,
		String(record.get("account_id", ""))
	)
	if not dispatched.get("success", false):
		return { "success": false, "code": "DISPATCH_PENDING", "precise_reason": "RETRY_FAILED:%s" % tx_id, "retryable": true }

	record["status"] = "DISPATCHED"
	record["mail_id"] = dispatched.get("mail_id", "")
	prune_records()
	return { "success": true, "code": "OK", "mail_id": dispatched.get("mail_id", ""), "record_status": "DISPATCHED" }

## M4（Phase 52）悬挂补偿通道：DISPATCH_PENDING 驻留超 TTL 自动重试；
## 重试达上限仍失败即回滚核销（码 RELEASED、记录清除）——补偿性两阶段闭环，
## 杜绝「码已烧、奖励永失」的永久悬挂（含 M3 修复后 mail_id 唯一化对重试的解锁）。
## 阈值配置：domains.cdkey_voucher → redemption/compensation/{enabled,ttl_seconds,max_retry}。
static func compensate_stale_pending(
	current_time_utc: int,
	mailbox: MailboxManager,
	voucher_registry: Dictionary = {},
	global_unique_redeemed: Dictionary = {},
	account_redemption_history: Dictionary = {}
) -> Dictionary:
	if not GameConfig.get_bool("domains.cdkey_voucher", "redemption/compensation/enabled", true):
		return { "success": true, "scanned": 0, "retried": 0, "released": 0, "skipped": 0 }
	var ttl_seconds := maxi(0, GameConfig.get_int("domains.cdkey_voucher", "redemption/compensation/ttl_seconds", 180))
	var max_retry := maxi(0, GameConfig.get_int("domains.cdkey_voucher", "redemption/compensation/max_retry", 3))
	var scanned := 0
	var retried := 0
	var released := 0
	var skipped := 0
	for tx_id in _records.keys():
		var record: Dictionary = _records[tx_id]
		if String(record.get("status", "")) != "DISPATCH_PENDING":
			continue
		scanned += 1
		var pending_since := int(record.get("pending_since_utc", 0))
		var retries := int(record.get("retry_count", 0))
		if retries >= max_retry:
			# 重试上限已达：回滚核销 → RELEASED（码可重新领取；仅当注册表可用时执行）
			var code := String(record.get("voucher_code", ""))
			if not code.is_empty() and voucher_registry.has(code):
				CDKeyRedemptionSolver.rollback_redemption(
					String(record.get("account_id", "")),
					code,
					voucher_registry,
					global_unique_redeemed,
					account_redemption_history
				)
			_records.erase(tx_id)
			released += 1
			continue
		if current_time_utc - pending_since < ttl_seconds:
			skipped += 1
			continue
		# 到期重试：投递（mail_id 由派发管线唯一生成——M3 修复后重试不再撞信箱同 id）
		var r := retry_dispatch(tx_id, mailbox)
		if not r.get("success", false):
			record["retry_count"] = retries + 1
			record["pending_since_utc"] = current_time_utc # 冷却：下轮按新 TTL 再判
		retried += 1
	return { "success": true, "scanned": scanned, "retried": retried, "released": released, "skipped": skipped }

## 保留窗口压缩（评审优化 #1）：按配置上限清理最旧已完成记录；
## DISPATCH_PENDING 记录保留（待恢复重发——不被压缩清除）。
## max_count 缺省 -1 = 读配置 domains.cdkey_voucher → records.retention_count（默认 1000）。
static func prune_records(max_count: int = -1) -> void:
	if max_count < 0:
		max_count = GameConfig.get_int("domains.cdkey_voucher", "records/retention_count", 1000)
	if max_count <= 0:
		return
	var keys := _records.keys()
	var idx := 0
	while _records.size() > max_count and idx < keys.size():
		var k: String = keys[idx]
		if String(_records[k].get("status", "")) != "DISPATCH_PENDING":
			_records.erase(k)
		idx += 1

## 审计查询：按 transaction_id 回溯流程状态与内部原因（仅供服务端日志/审计/测试）
static func get_record(tx_id: String) -> Dictionary:
	return _records.get(tx_id, {})
