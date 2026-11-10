# ==============================================================================
# 模块归属: 业务领域层 (Domains · 账号与凭据集群 (Account Domain))
# 文件路径: res://backend/domains/account/services/account_home_view_model_builder.gd
# 架构定位: Domain View Model Builder
# 依赖与触发: 上游: AuthService, UnifiedProtocolDispatcher | 下游: AccountRepository, GameConfig
# 配置与信号: 配置 config/domains/account/core.json
# 职责说明: 构造账号首页脱敏数据视图模型，汇总本地已知账号摘要与当前活跃登录态，隔离凭据明文。
# 退出语义与设计依据: 卡拉尔领域第一性原理 (Inv-SESSION-VAULT-3)
# ==============================================================================

## AccountHomeViewModelBuilder：账号首页视图模型构建器
class_name AccountHomeViewModelBuilder
extends RefCounted

const DOMAIN_ACCOUNT_CONFIG = "domains.account"

## 构建账号首页脱敏数据视图模型（禁止返回口令哈希与明文令牌）
static func build_account_home_view_model(session_token: String = "", locale: String = "") -> Dictionary:
	var repo := AccountRepository.get_instance()
	if not repo.is_loaded():
		repo.load_all()
	var max_recent := maxi(1, GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/home_view/max_recent_accounts", 10))
	var eff_locale := locale if not locale.is_empty() else GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/home_view/default_locale", "zh-CN")
	var known_accounts: Array[Dictionary] = []
	var all_acc := repo.get_all_accounts()
	for acc_id in all_acc.keys():
		if known_accounts.size() >= max_recent:
			break
		var acc: AccountProfileAggregate = all_acc[acc_id]
		if acc == null:
			continue
		known_accounts.append({
			"account_id": acc.account_id,
			"username": acc.username,
			"is_guest_mode": acc.is_guest_mode,
			"last_login_timestamp_utc": acc.last_login_timestamp_utc,
			"world_state_ref": acc.world_state_ref,
			"slot_count": acc.save_slot_summaries.size()
		})
	var session_active := false
	var current_summary: Dictionary = {}
	if not session_token.is_empty():
		var token_validation := AuthService.validate_token(session_token)
		if bool(token_validation.get("success", false)):
			session_active = true
			var active_id := String(token_validation.get("account_id", ""))
			var active_acc := repo.find_by_id(active_id)
			var meta := AuthService.get_session_masked_metadata(session_token)
			current_summary = {
				"account_id": active_id,
				"username": active_acc.username if active_acc != null else String(meta.get("username", "")),
				"token_prefix": String(meta.get("token_prefix", "")),
				"has_masked_token": bool(meta.get("has_masked_token", false)),
				"slot_count": active_acc.save_slot_summaries.size() if active_acc != null else 0
			}
	return {
		"session_active": session_active,
		"current_account_summary": current_summary,
		"known_accounts": known_accounts,
		"known_account_count": known_accounts.size(),
		"gateway_ready": session_active,
		"locale": eff_locale
	}
