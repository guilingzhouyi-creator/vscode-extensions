# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/auth_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 离线游客速通创建、加盐哈希密码鉴权与会话 Token 签发。 盐/默认值/错误码/会话 TTL 由 config/domains/account.json 与 config/infrastructure/admin.json（session.*）驱动，代码零硬编码。
# 设计依据: 业务域第一性原理 / 账号与槽位生命周期契约
# ==============================================================================

class_name AuthService extends RefCounted

const AccountRegistrationDTO = preload("res://backend/domains/account/dto/account_registration_dto.gd")
const HudEventContract = preload("res://backend/domains/world_state/hud_event_contract.gd")

const DOMAIN_ACCOUNT_CONFIG: String = "domains.account"

# ==============================================================================
# 一、会话状态与鉴权状态枚举
# ==============================================================================

static var _sessions: Dictionary = {}

## 鉴权状态机：未认证 / 本地认证 / 云认证 / 会话过期
enum AuthState {
	UNAUTHENTICATED,
	AUTHENTICATED_LOCAL,
	AUTHENTICATED_CLOUD,
	SESSION_EXPIRED
}

## 口令加盐读取（config/domains/account.json auth/salt；空盐历史档经 login-time 重铸迁移链自动升级）
static func _salt() -> String:
	return GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/salt", "")

# ==============================================================================
# 二、口令哈希与游客账号创建
# ==============================================================================

## 加盐 SHA-256 口令哈希（盐来自 domains.account auth/salt 配置）
static func hash_password(password_plain: String) -> String:
	return (password_plain + _salt()).sha256_text()

## 游客速通账号创建：唯一 ID + 随机名 + 游客免密标记 + 设备指纹绑定
static func create_guest_account(device_fingerprint: String = "", rng: DeterministicRNG = null) -> AccountProfileAggregate:
	var guest_rng := DeterministicRNG.resolve(rng)
	var acc := AccountProfileAggregate.new()
	var prefix := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/guest_prefix", "ACC_GUEST_")
	acc.account_id = UniqueIdGenerator.next_id(prefix)
	var name_prefix := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/guest_name_prefix", "ROGUE_")
	# 局部变量更名为 name_range，避免遮蔽注入的 rng 参数
	var name_range: Array = GameConfig.get_array(DOMAIN_ACCOUNT_CONFIG, "auth/guest_name_range", [1000, 9999])
	var lo := int(name_range[0]) if name_range.size() > 0 else 1000
	var hi := int(name_range[1]) if name_range.size() > 1 else 9999
	acc.username = name_prefix + str(guest_rng.randi_range(lo, hi))
	var guest_pass := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/guest_password", "GUEST_NO_PASS")
	acc.password_hash_sha256 = hash_password(guest_pass)
	var default_fp := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/default_fingerprint", "DEV_LOCAL_FP")
	acc.local_device_fingerprint = device_fingerprint if device_fingerprint != "" else default_fp
	acc.is_guest_mode = true
	acc.created_timestamp_utc = int(Time.get_unix_time_from_system())
	acc.last_login_timestamp_utc = acc.created_timestamp_utc
	return acc

## 标准用户账号注册（配置驱动校验 + 加盐哈希 + EventBus 广播）
static func register_account(request: AccountRegistrationDTO.Request, account_store: Dictionary = {}) -> AccountRegistrationDTO.Response:
	var resp := AccountRegistrationDTO.Response.new()
	if request == null or request.username.is_empty() or request.password_plain.is_empty():
		resp.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/invalid_credentials", "ERR_INVALID_CREDENTIALS")
		return resp

	var min_len := GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/rules/min_username_length", 3)
	var max_len := GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/rules/max_username_length", 24)
	if request.username.length() < min_len or request.username.length() > max_len:
		resp.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/invalid_username_length", "ERR_INVALID_USERNAME_LENGTH")
		return resp

	for acc_id in account_store.keys():
		var existing: AccountProfileAggregate = account_store[acc_id]
		if existing != null and existing.username.to_lower() == request.username.to_lower():
			resp.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/account_already_exists", "ERR_ACCOUNT_ALREADY_EXISTS")
			return resp

	var acc := AccountProfileAggregate.new()
	acc.account_id = UniqueIdGenerator.next_id(GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/account_id_prefix", "ACC_USR_"))
	acc.username = request.username
	acc.password_hash_sha256 = hash_password(request.password_plain)
	acc.local_device_fingerprint = request.device_fingerprint
	acc.is_guest_mode = false
	acc.created_timestamp_utc = int(Time.get_unix_time_from_system())
	acc.last_login_timestamp_utc = 0
	acc.entitlements = request.initial_entitlements.duplicate()
	account_store[acc.account_id] = acc

	resp.success = true
	resp.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/ok", "OK")
	resp.account_id = acc.account_id
	resp.username = acc.username
	resp.created_timestamp_utc = acc.created_timestamp_utc

	# 统一 EventBus 广播（叙事渲染契约：args + category_key）
	EventBusCore.get_instance().emit_domain_event(HudEventContract.channel_auth_registered(), {
		"account_id": acc.account_id,
		"username": acc.username,
		"timestamp_utc": acc.created_timestamp_utc,
		"category_key": "auth",
		"args": [acc.username]
	})
	return resp

## 会话有界化——先擦除已过期项，再按 issued_at 最旧优先裁剪至上限。
## 上限读 infrastructure.admin session/max_entries（默认 1000），长会话内存受控。
static func _prune_sessions(now_utc: int = -1) -> void:
	if _sessions.is_empty():
		return
	var now := now_utc if now_utc >= 0 else int(Time.get_unix_time_from_system())
	var max_entries := maxi(1, GameConfig.get_int("infrastructure.admin", "session/max_entries", 1000))
	var expired_keys: Array = []
	for key in _sessions:
		if now > int(_sessions[key].get("expires_at", 0)):
			expired_keys.append(key)
	for key in expired_keys:
		_sessions.erase(key)
	# 最旧优先裁剪（issued_at 升序，移除超出上限的最旧条目）
	if _sessions.size() > max_entries:
		var sorted_keys: Array = _sessions.keys()
		sorted_keys.sort_custom(func(a, b) -> bool:
			return int(_sessions[a].get("issued_at", 0)) < int(_sessions[b].get("issued_at", 0)))
		var excess := sorted_keys.size() - max_entries
		for i in range(excess):
			_sessions.erase(sorted_keys[i])

## 本地鉴权与会话签发：设备指纹隔离 + 密码/游客双通道校验 + TTL 会话入表（有界收敛）
static func authenticate_local(username: String, pass_plain: String, account: AccountProfileAggregate, device_fingerprint: String = "") -> Dictionary:
	if account == null:
		var code_nf := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/account_not_found", "ERR_ACCOUNT_NOT_FOUND")
		return {"success": false, "code": code_nf, "token": ""}
	# 设备指纹单机隔离（可空跳过，已绑定则强校验）
	if not device_fingerprint.is_empty() and not account.local_device_fingerprint.is_empty() and device_fingerprint != account.local_device_fingerprint:
		var code_fp := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/device_mismatch", "ERR_DEVICE_MISMATCH")
		return {"success": false, "code": code_fp, "token": ""}
	# 口令双态校验（盐重铸链）：salt_version==0 空盐历史档先按空盐比对，通过即重哈希落盘并升级 salt_version=1（login-time 重铸，不强制重置口令）
	var input_hash := hash_password(pass_plain)
	var legacy_hash := pass_plain.sha256_text()
	var matched := account.username == username and (account.is_guest_mode or account.password_hash_sha256 == input_hash)
	var needs_rehash := false
	if not matched and not account.is_guest_mode and account.salt_version == 0 and account.password_hash_sha256 == legacy_hash:
		matched = true
		needs_rehash = true
	if matched:
		if needs_rehash:
			account.password_hash_sha256 = hash_password(pass_plain)
			account.salt_version = 1
		account.last_login_timestamp_utc = int(Time.get_unix_time_from_system())
		if not device_fingerprint.is_empty():
			account.local_device_fingerprint = device_fingerprint
		var token_prefix := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/token_prefix", "TOKEN_")
		var token := (token_prefix + account.account_id + "_" + str(Time.get_ticks_usec())).sha256_text()
		var issued_at := account.last_login_timestamp_utc
		var ttl := maxi(1, GameConfig.get_int("infrastructure.admin", "session/ttl_seconds", GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/session/ttl_seconds", 86400)))
		_sessions[token.sha256_text()] = {
			"account_id": account.account_id,
			"username": account.username,
			"issued_at": issued_at,
			"expires_at": issued_at + ttl,
			"device_fingerprint": device_fingerprint,
			"revoked": false
		}
		var code_ok := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/ok", "OK")
		_prune_sessions(issued_at) # 签发后收敛会话容器（过期优先清理）

		# 统一 EventBus 广播鉴权登录成功（token_prefix 脱敏 Inv-HDS-4）
		EventBusCore.get_instance().emit_domain_event(HudEventContract.channel_auth_login_succeeded(), {
			"account_id": account.account_id,
			"username": account.username,
			"token_prefix": token.substr(0, mini(8, token.length())),
			"issued_at": issued_at,
			"expires_at": issued_at + ttl,
			"category_key": "auth",
			"args": [account.username]
		})

		return {"success": true, "code": code_ok, "token": token, "account_id": account.account_id, "username": account.username, "issued_at": issued_at, "expires_at": issued_at + ttl, "rehashed": needs_rehash}
	var code_inv := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/invalid_credentials", "ERR_INVALID_CREDENTIALS")
	return {"success": false, "code": code_inv, "token": ""}

# ==============================================================================
# 三、会话校验 / 撤销 / 设备绑定
# ==============================================================================

## Token 时效校验（单机离线会话，TTL 配置驱动，下限 0 即永不过期）
static func is_token_valid(issued_at_utc: int, now_utc: int = -1) -> bool:
	var now: int = now_utc if now_utc >= 0 else int(Time.get_unix_time_from_system())
	var ttl: int = maxi(1, GameConfig.get_int("infrastructure.admin", "session/ttl_seconds", GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/token_ttl_seconds", 86400)))
	var skew := maxi(0, GameConfig.get_int("infrastructure.admin", "security/allow_future_clock_skew_seconds", GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/session/allow_future_clock_skew_seconds", 0)))
	return issued_at_utc <= now + skew and now <= issued_at_utc + ttl

## 会话 Token 全错误族校验：未知/撤销/未来/过期/账号不匹配/设备绑定不匹配
static func validate_token(token: String, account_id: String = "", device_fingerprint: String = "", now_utc: int = -1) -> Dictionary:
	if token.is_empty():
		return {"success": false, "error_code": "TOKEN_UNKNOWN"}
	var session: Dictionary = _sessions.get(token.sha256_text(), {})
	if session.is_empty():
		return {"success": false, "error_code": "TOKEN_UNKNOWN"}
	if bool(session.get("revoked", false)):
		return {"success": false, "error_code": "TOKEN_REVOKED"}
	var now := now_utc if now_utc >= 0 else int(Time.get_unix_time_from_system())
	_prune_sessions(now) # 会话查询路径同样触发收敛（过期优先清理）
	if now < int(session.get("issued_at", 0)):
		return {"success": false, "error_code": "TOKEN_FUTURE"}
	if now > int(session.get("expires_at", 0)):
		session["revoked"] = true
		_sessions[token.sha256_text()] = session
		return {"success": false, "error_code": "TOKEN_EXPIRED"}
	if not account_id.is_empty() and account_id != str(session.get("account_id", "")):
		return {"success": false, "error_code": "TOKEN_ACCOUNT_MISMATCH"}
	var bind_device := GameConfig.get_bool("infrastructure.admin", "session/bind_device", GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "auth/session/bind_device", true))
	if bind_device and not device_fingerprint.is_empty() and device_fingerprint != str(session.get("device_fingerprint", "")):
		return {"success": false, "error_code": "DEVICE_MISMATCH"}
	return {"success": true, "account_id": session.get("account_id", ""), "issued_at": session.get("issued_at", 0), "expires_at": session.get("expires_at", 0), "state": "ACTIVE"}

## 撤销会话（幂等；已撤销/不存在的 token 返回 false）
static func revoke_token(token: String) -> bool:
	var key := token.sha256_text()
	if not _sessions.has(key):
		return false
	var session: Dictionary = _sessions[key]
	session["revoked"] = true
	_sessions[key] = session
	var user_ident: String = String(session.get("username", session.get("account_id", "")))
	EventBusCore.get_instance().emit_domain_event(HudEventContract.channel_auth_session_revoked(), {
		"account_id": session.get("account_id", ""),
		"username": session.get("username", ""),
		"category_key": "auth",
		"args": [user_ident]
	})
	return true

## 清空全部会话（登出/重置场景）
static func clear_sessions() -> void:
	_sessions.clear()

## 绑定设备指纹（单机隔离强校验，后续鉴权强校验匹配）
static func bind_device_fingerprint(account: AccountProfileAggregate, fingerprint: String) -> Dictionary:
	if account == null or fingerprint.is_empty():
		return {"success": false, "error_code": "INVALID_FINGERPRINT"}
	account.local_device_fingerprint = fingerprint
	return {"success": true, "fingerprint": fingerprint}
