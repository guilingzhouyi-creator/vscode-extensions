# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/cdkey_voucher/cdkey_redemption_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/cdkey_voucher.json | 信号: EventBus 领域广播
# 职责说明: 兑换码检定、复合门槛规则引擎、防枚举、频控/时效/全服上限与邮件发放； 全部运营 CDKey 兑换必须经此域，禁止绕过（chat_command 路径仅为开发/测试通道）。 频控防爆破、时效门槛检定、原子核销记录与防并发重放  配置驱动: 频控阈值与锁定时长 -> config/domains/cdkey_voucher.json 的 rate_limit.* 全部错误/成功文案   -> config/narratives/cdkey_voucher.json 代码零硬编码，改文案与调阈值无需重新编译。
# 退出语义与设计依据: 业务域第一性原理 / 经济交易兑换码架构规范
# ==============================================================================

## CDKeyRedemptionSolver：Headless Discrete Solver / Numerical Calculator
class_name CDKeyRedemptionSolver
extends RefCounted

const MSG_INVALID_CODE: String = "invalid_code"

# 频控与核销状态记录结构 (在生产环境中由全局持久化状态维护)
# account_failed_attempts: account_id -> { "count": int, "lock_until_utc": int }
# account_history: account_id -> Array[String] (voucher_code list)
# global_redeemed_tokens: voucher_code -> bool (for UNIQUE_ONE_TIME)

## 兑换主流程：频控/存在性/激活时效/复合门槛/等级/全服上限/重复领取逐级检定 → 原子核销 + 奖励载荷
static func resolve_redemption(
	account_id: String,
	character_level: int,
	raw_input_code: String,
	current_time_utc: int,
	voucher_registry: Dictionary, # voucher_code -> CDKeyVoucherAggregate
	rate_limit_state: Dictionary, # account_id -> Dictionary
	account_redemption_history: Dictionary, # account_id -> Array[String]
	global_unique_redeemed: Dictionary, # voucher_code -> bool
	eligibility_metrics: Dictionary = {}, # 复合门槛判定指标，由调用方注入
	eligibility_rules_override: Dictionary = {} # 测试/装配层注入规则；空则读配置（示例配置自动跳过）
) -> Dictionary:
	var code: String = raw_input_code.strip_edges().to_upper()

	# 1. 检查频控锁定
	var account_rate_limit_state: Dictionary = rate_limit_state.get(account_id, {"count": 0, "lock_until_utc": 0})
	if account_rate_limit_state.get("lock_until_utc", 0) > current_time_utc:
		return {
			"success": false,
			"error_code": "RATE_LIMITED",
			"error_message": _msg(MSG_INVALID_CODE),
			"precise_reason": "RATE_LIMITED",
			"payload": {}
		}

	# 2. 查询兑换码是否存在
	if not voucher_registry.has(code):
		_record_failure(account_id, current_time_utc, rate_limit_state)
		return {
			"success": false,
			"error_code": "INVALID_CODE",
			"error_message": _msg(MSG_INVALID_CODE),
			"precise_reason": "INVALID_CODE",
			"payload": {}
		}

	var voucher: CDKeyVoucherAggregate = voucher_registry[code]

	# 3. 校验激活状态与时间窗口
	if not voucher.is_active:
		return {
			"success": false,
			"error_code": "VOUCHER_REVOKED",
			"error_message": _msg(MSG_INVALID_CODE),
			"precise_reason": "VOUCHER_REVOKED",
			"payload": {}
		}

	if current_time_utc < voucher.valid_from_utc or current_time_utc > voucher.valid_to_utc:
		return {
			"success": false,
			"error_code": "EXPIRED",
			"error_message": _msg(MSG_INVALID_CODE),
			"precise_reason": "EXPIRED",
			"payload": {}
		}

	# 4. 复合门槛评估：规则引擎只解释配置；
	#    作用域合并（兑换码级覆盖全局同 rule_id）；未达标 = 可重试判定（不消耗/不作废/可重新兑换），零核销写入
	var rules: Dictionary = eligibility_rules_override \
		if not eligibility_rules_override.is_empty() \
		else CDKeyEligibilityRuleEngine.merge_rules(CDKeyEligibilityRuleEngine.load_rules(), voucher.eligibility_rules)
	if not rules.is_empty():
		var eligibility_result := CDKeyEligibilityRuleEngine.evaluate(eligibility_metrics, rules)
		if not eligibility_result.get("allowed", false):
			return {
				"success": false,
				"error_code": "ELIGIBILITY_NOT_MET",
				"error_message": _msg(MSG_INVALID_CODE),
				"precise_reason": "ELIGIBILITY_NOT_MET:%s:%s" % [eligibility_result.get("failed_rule_id", ""), eligibility_result.get("failed_metric", "")],
				"payload": {}
			}

	# 5. 校验等级门槛
	if character_level < voucher.required_character_level:
		return {
			"success": false,
			"error_code": "LEVEL_TOO_LOW",
			"error_message": _msg(MSG_INVALID_CODE),
			"precise_reason": "LEVEL_TOO_LOW",
			"payload": {}
		}

	# 6. 校验全服总次数上限
	if voucher.max_global_redemptions > 0 and voucher.current_global_redemptions >= voucher.max_global_redemptions:
		return {
			"success": false,
			"error_code": "GLOBAL_LIMIT_REACHED",
			"error_message": _msg(MSG_INVALID_CODE),
			"precise_reason": "GLOBAL_LIMIT_REACHED",
			"payload": {}
		}

	# 7. 依据类型检定重复领取
	if voucher.voucher_type == CDKeyVoucherAggregate.VoucherType.UNIVERSAL_PER_ACCOUNT:
		var history: Array = account_redemption_history.get(account_id, [])
		if code in history:
			return {
				"success": false,
				"error_code": "ALREADY_REDEEMED",
				"error_message": _msg(MSG_INVALID_CODE),
				"precise_reason": "ALREADY_REDEEMED",
				"payload": {}
			}
	elif voucher.voucher_type == CDKeyVoucherAggregate.VoucherType.UNIQUE_ONE_TIME:
		if global_unique_redeemed.get(code, false):
			return {
				"success": false,
				"error_code": "ALREADY_USED_GLOBALLY",
				"error_message": _msg(MSG_INVALID_CODE),
				"precise_reason": "ALREADY_USED_GLOBALLY",
				"payload": {}
			}

	# 8. 执行原子核销
	voucher.current_global_redemptions += 1
	if voucher.voucher_type == CDKeyVoucherAggregate.VoucherType.UNIQUE_ONE_TIME:
		global_unique_redeemed[code] = true

	if not account_redemption_history.has(account_id):
		account_redemption_history[account_id] = []
	account_redemption_history[account_id].append(code)

	# 重置失败频控计数
	rate_limit_state[account_id] = {"count": 0, "lock_until_utc": 0}

	return {
		"success": true,
		"error_code": "OK",
		"error_message": _msg("redeem_success"),
		"payload": voucher.reward_payload.duplicate(true),
		"voucher_title": voucher.localized_title
	}

## 补偿回滚（RELEASED）——投递补偿判定达上限后释放已核销资源：
## 递减全服计数（下界 0）、清除 UNIQUE_ONE_TIME 占用、移除账户历史末次记录。
## 仅由补偿通道在确认「该笔兑换不会再投递」后调用；幂等（重复调用安全）。
static func rollback_redemption(
	account_id: String,
	code: String,
	voucher_registry: Dictionary,
	global_unique_redeemed: Dictionary,
	account_redemption_history: Dictionary
) -> Dictionary:
	if voucher_registry.has(code):
		var voucher: CDKeyVoucherAggregate = voucher_registry[code]
		voucher.current_global_redemptions = maxi(0, voucher.current_global_redemptions - 1)
		if voucher.voucher_type == CDKeyVoucherAggregate.VoucherType.UNIQUE_ONE_TIME:
			global_unique_redeemed[code] = false
	var history: Array = account_redemption_history.get(account_id, [])
	var matched_index := -1
	for history_index in range(history.size() - 1, -1, -1):
		if String(history[history_index]) == code:
			matched_index = history_index
			break
	if matched_index >= 0:
		history.remove_at(matched_index)
	return {"success": true, "error_code": "CODE_RELEASED_AFTER_FAILURE", "voucher_code": code}

const MAX_RATE_LIMIT_ENTRIES: int = 5000

## 周期性清理或容量上限保护：剔除所有 lock_until_utc 已过期的条目
static func purge_expired_rate_limits(rate_limit_state: Dictionary, current_time_utc: int) -> int:
	var expired_keys: Array = []
	for account_key in rate_limit_state:
		var limit_entry: Variant = rate_limit_state[account_key]
		if limit_entry is Dictionary and limit_entry.get("lock_until_utc", 0) <= current_time_utc:
			expired_keys.append(account_key)
	for account_key in expired_keys:
		rate_limit_state.erase(account_key)
	return expired_keys.size()

## 失败计数：达到上限置锁定窗口并清零计数（防爆破），带 5000 槽位容量上限保护
static func _record_failure(account_id: String, current_time_utc: int, rate_limit_state: Dictionary) -> void:
	if rate_limit_state.size() >= MAX_RATE_LIMIT_ENTRIES and not rate_limit_state.has(account_id):
		purge_expired_rate_limits(rate_limit_state, current_time_utc)
		if rate_limit_state.size() >= MAX_RATE_LIMIT_ENTRIES:
			# 容量上限保护：清理过期条目后仍满，说明剩余条目全部处于锁定窗口内（lock_until_utc > now）。
			# 逐出任一在锁条目都会静默解除防爆破锁（攻击者灌满表即可轮换逐出受害者锁），
			# 故放弃记录本次新失败（fail-closed），绝不主动解除既有锁定。
			return
	var limit_entry: Dictionary = rate_limit_state.get(account_id, {"count": 0, "lock_until_utc": 0})
	var failure_count: int = int(limit_entry.get("count", 0)) + 1
	var lock_until := 0
	if failure_count >= _max_failed_attempts():
		lock_until = current_time_utc + _lockout_duration_seconds()
		failure_count = 0
	rate_limit_state[account_id] = {"count": failure_count, "lock_until_utc": lock_until}

# ==============================================================================
# 配置读取
# ==============================================================================

static func _max_failed_attempts() -> int:
	return GameConfig.get_int("domains.cdkey_voucher", "rate_limit/max_failed_attempts", 5)

## 锁定窗口秒数（rate_limit/lockout_duration_seconds 配置，默认 60）
static func _lockout_duration_seconds() -> int:
	return GameConfig.get_int("domains.cdkey_voucher", "rate_limit/lockout_duration_seconds", 60)

## 文案查表（narratives cdkey_voucher 域，未登记回传 key）
static func _msg(key: String) -> String:
	return GameConfig.msg("cdkey_voucher", key)
