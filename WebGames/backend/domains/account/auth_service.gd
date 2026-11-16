# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/auth_service.gd
# 架构定位: Domain Service / State Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 离线游客免密快捷创建、加盐哈希密码鉴权与会话 Token 签发。 盐/默认值/错误码/会话 TTL 由 config/domains/account.json 与 config/infrastructure/admin.json（session.*）驱动，代码零硬编码。
# 退出语义与设计依据: 业务域第一性原理 / 账号与槽位生命周期契约
# ==============================================================================

## AuthService：Domain Service / State Orchestrator
class_name AuthService extends RefCounted

const DOMAIN_ACCOUNT_CONFIG: String = "domains.account"
const DEFAULT_GUEST_NAME_RANGE_MIN: int = 1000
const DEFAULT_GUEST_NAME_RANGE_MAX: int = 9999

# ==============================================================================
# 一、会话状态与口令加盐
# ==============================================================================

static var _sessions: Dictionary = {}

## 口令加盐读取（config/domains/account.json auth/salt；空盐历史档经 login-time 重铸迁移链自动升级）
static func _salt() -> String:
	return GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/salt", "")

# ==============================================================================
# 二、口令哈希与游客账号创建
# ==============================================================================

## 加盐 SHA-256 口令哈希（盐来自 domains.account auth/salt 配置）
static func hash_password(password_plain: String) -> String:
	return (password_plain + _salt()).sha256_text()

## 游客免密快捷账号创建：唯一 ID + 随机名 + 游客免密标记 + 设备指纹绑定
static func create_guest_account(device_fingerprint: String = "", rng: DeterministicRNG = null) -> AccountProfile:
	var guest_rng := DeterministicRNG.resolve(rng)
	var account := AccountProfile.new()
	var prefix := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/guest_prefix", "ACC_GUEST_")
	account.account_id = IdGenerator.next_id(prefix)
	var name_prefix := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/guest_name_prefix", "ROGUE_")
	# 局部变量更名为 name_range，避免遮蔽注入的 rng 参数
	var name_range: Array = GameConfig.get_array(DOMAIN_ACCOUNT_CONFIG, "auth/guest_name_range", [DEFAULT_GUEST_NAME_RANGE_MIN, DEFAULT_GUEST_NAME_RANGE_MAX])
	var range_min := int(name_range[0]) if name_range.size() > 0 else DEFAULT_GUEST_NAME_RANGE_MIN
	var range_max := int(name_range[1]) if name_range.size() > 1 else DEFAULT_GUEST_NAME_RANGE_MAX
	account.username = name_prefix + str(guest_rng.randi_range(range_min, range_max))
	var guest_pass := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/guest_password", "GUEST_NO_PASS")
	account.password_hash_sha256 = hash_password(guest_pass)
	var default_fingerprint := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/default_fingerprint", "DEV_LOCAL_FP")
	account.local_device_fingerprint = device_fingerprint if device_fingerprint != "" else default_fingerprint
	account.is_guest_mode = true
	account.created_timestamp_utc = int(Time.get_unix_time_from_system())
	account.last_login_timestamp_utc = account.created_timestamp_utc
	return account

## 标准用户账号注册（配置驱动校验 + 加盐哈希 + EventBus 广播）
static func register_account(request: AccountRegistrationDTO.Request, account_store: Dictionary = {}) -> AccountRegistrationDTO.Response:
	var response := AccountRegistrationDTO.Response.new()
	if request == null or request.username.is_empty() or request.password_plain.is_empty():
		response.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/invalid_credentials", "ERR_INVALID_CREDENTIALS")
		return response

	var min_length := GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/rules/min_username_length", 3)
	var max_length := GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/rules/max_username_length", 24)
	if request.username.length() < min_length or request.username.length() > max_length:
		response.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/invalid_username_length", "ERR_INVALID_USERNAME_LENGTH")
		return response

	var already_exists_error_code := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/account_already_exists", "ERR_ACCOUNT_ALREADY_EXISTS")
	if _find_target_account_for_auth(request.username, account_store) != null:
		response.error_code = already_exists_error_code
		return response

	var account := AccountProfile.new()
	account.account_id = IdGenerator.next_id(GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/account_id_prefix", "ACC_USR_"))
	account.username = request.username
	account.password_hash_sha256 = hash_password(request.password_plain)
	account.local_device_fingerprint = request.device_fingerprint
	account.is_guest_mode = false
	account.created_timestamp_utc = int(Time.get_unix_time_from_system())
	account.last_login_timestamp_utc = 0
	account.entitlements = request.initial_entitlements.duplicate()

	if not account_store.is_empty():
		account_store[account.account_id] = account
	else:
		var repository := AccountRepository.get_instance()
		var save_result := repository.save_account(account)
		if not bool(save_result.get("success", false)):
			response.error_code = String(save_result.get("error", "ERR_STORAGE_SAVE_FAILED"))
			return response
		account_store[account.account_id] = account

	response.success = true
	response.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/ok", "OK")
	response.account_id = account.account_id
	response.username = account.username
	response.created_timestamp_utc = account.created_timestamp_utc

	# 统一 EventBus 广播（叙事渲染契约：args + category_key）
	var post_register_hooks: Array = GameConfig.get_array(DOMAIN_ACCOUNT_CONFIG, "auth/hooks/post_register", [])
	EventBusCore.get_instance().emit_domain_event(HudEventContract.channel_auth_registered(), {
		"account_id": account.account_id,
		"username": account.username,
		"timestamp_utc": account.created_timestamp_utc,
		"configured_hooks": post_register_hooks,
		"category_key": "auth",
		"args": [account.username]
	})
	_dispatch_auth_hooks("post_register", {"account_id": account.account_id, "username": account.username, "hooks": post_register_hooks})
	return response

static var _auth_hooks: Dictionary = {}

## 注册鉴权阶段自定义扩展 Hook（post_register / post_login）
static func register_hook(stage_key: String, callback: Callable) -> void:
	if stage_key.is_empty() or not callback.is_valid():
		return
	if not _auth_hooks.has(stage_key):
		_auth_hooks[stage_key] = []
	var hooks_list: Array = _auth_hooks[stage_key]
	hooks_list.append(callback)

## 注销已注册的鉴权自定义扩展 Hook
static func unregister_hook(stage_key: String, callback: Callable) -> bool:
	if stage_key.is_empty() or not _auth_hooks.has(stage_key):
		return false
	var hooks_list: Array = _auth_hooks[stage_key]
	var hook_index := hooks_list.find(callback)
	if hook_index >= 0:
		hooks_list.remove_at(hook_index)
		if hooks_list.is_empty():
			_auth_hooks.erase(stage_key)
		return true
	return false

## 清空已注册的鉴权自定义扩展 Hook
static func clear_hooks() -> void:
	if not _auth_hooks.is_empty():
		_auth_hooks.clear()

## 测试专用状态重置（清空会话与扩展钩子）
static func reset_for_tests() -> void:
	_sessions.clear()
	clear_hooks()

static func _dispatch_auth_hooks(stage_key: String, payload: Dictionary) -> void:
	var hooks_list: Array = _auth_hooks.get(stage_key, [])
	for hook_callback in hooks_list:
		if hook_callback is Callable and hook_callback.is_valid():
			hook_callback.call(payload)

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
		sorted_keys.sort_custom(func(left_key: Variant, right_key: Variant) -> bool:
			return int(_sessions[left_key].get("issued_at", 0)) < int(_sessions[right_key].get("issued_at", 0)))
		var excess := sorted_keys.size() - max_entries
		for trim_index in range(excess):
			_sessions.erase(sorted_keys[trim_index])

## 本地鉴权与会话签发：设备指纹隔离 + 密码/游客双通道校验 + TTL 会话入表（有界收敛）
static func authenticate_local(username: String, password_plain: String, account: AccountProfile, device_fingerprint: String = "") -> Dictionary:
	if account == null:
		var not_found_code := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/account_not_found", "ERR_ACCOUNT_NOT_FOUND")
		return {"success": false, "code": not_found_code, "token": ""}
	# 设备指纹单机隔离（可空跳过，已绑定则强校验）
	if not device_fingerprint.is_empty() and not account.local_device_fingerprint.is_empty() and device_fingerprint != account.local_device_fingerprint:
		var fingerprint_mismatch_code := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/device_mismatch", "ERR_DEVICE_MISMATCH")
		return {"success": false, "code": fingerprint_mismatch_code, "token": ""}
	# 口令校验：默认按配置盐哈希；若历史账号为无盐版本 (salt_version == 0) 则平滑迁移重铸
	var input_hash := hash_password(password_plain)
	var is_rehashed := false
	if account.username == username and not account.is_guest_mode and account.salt_version == 0:
		if CryptoIntegrityLib.constant_time_equals(account.password_hash_sha256, password_plain.sha256_text()):
			account.password_hash_sha256 = input_hash
			account.salt_version = 1
			is_rehashed = true
			var repository := AccountRepository.get_instance()
			if repository.has_account(account.account_id):
				repository.save_account(account)

	var is_matched := account.username == username and (account.is_guest_mode or CryptoIntegrityLib.constant_time_equals(account.password_hash_sha256, input_hash))
	if is_matched:
		account.last_login_timestamp_utc = int(Time.get_unix_time_from_system())
		if not device_fingerprint.is_empty():
			account.local_device_fingerprint = device_fingerprint
		var login_repository := AccountRepository.get_instance()
		if login_repository != null and login_repository.has_account(account.account_id):
			login_repository.save_account(account)
		var token_prefix := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/token_prefix", "TOKEN_")
		var token := (token_prefix + account.account_id + "_" + str(Time.get_ticks_usec())).sha256_text()
		var issued_at := account.last_login_timestamp_utc
		var session_ttl_seconds := maxi(1, GameConfig.get_int("infrastructure.admin", "session/ttl_seconds", GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/session/ttl_seconds", 86400)))
		var is_mask_enabled := GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "auth/session/mask_in_memory_tokens", true)
		var mask_seed := ClientSecretVault.derive_key_seed(account.account_id)
		var masked_bytes: PackedByteArray = ClientSecretVault.mask_in_memory_token(token, mask_seed) if is_mask_enabled else PackedByteArray()
		var prefix_length := maxi(4, GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/home_view/mask_visible_prefix_len", 8))
		_sessions[token.sha256_text()] = {
			"account_id": account.account_id,
			"username": account.username,
			"issued_at": issued_at,
			"expires_at": issued_at + session_ttl_seconds,
			"device_fingerprint": device_fingerprint,
			"token_masked": masked_bytes,
			"token_prefix": token.substr(0, mini(prefix_length, token.length())),
			"revoked": false
		}
		var success_code := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/ok", "OK")
		_prune_sessions(issued_at) # 签发后收敛会话容器（过期优先清理）
		var should_auto_enter := GameConfig.get_bool("domains.world_gateway", "gateway_policy/auto_enter_gateway_on_login", true)
		var post_login_hooks: Array = GameConfig.get_array(DOMAIN_ACCOUNT_CONFIG, "auth/hooks/post_login", [])

		# 统一 EventBus 广播鉴权登录成功（token_prefix 脱敏 Inv-HDS-4）
		EventBusCore.get_instance().emit_domain_event(HudEventContract.channel_auth_login_succeeded(), {
			"account_id": account.account_id,
			"username": account.username,
			"token_prefix": token.substr(0, mini(8, token.length())),
			"issued_at": issued_at,
			"expires_at": issued_at + session_ttl_seconds,
			"auto_enter_gateway": should_auto_enter,
			"configured_hooks": post_login_hooks,
			"category_key": "auth",
			"args": [account.username]
		})
		_dispatch_auth_hooks("post_login", {"account_id": account.account_id, "username": account.username, "token": token, "auto_enter_gateway": should_auto_enter})

		return {"success": true, "code": success_code, "token": token, "account_id": account.account_id, "username": account.username, "issued_at": issued_at, "expires_at": issued_at + session_ttl_seconds, "rehashed": is_rehashed, "auto_enter_gateway": should_auto_enter}
	var invalid_credentials_code := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/invalid_credentials", "ERR_INVALID_CREDENTIALS")
	return {"success": false, "code": invalid_credentials_code, "token": ""}

static func _find_target_account_for_auth(username: String, account_store: Dictionary) -> AccountProfile:
	if not account_store.is_empty():
		for account_key in account_store.keys():
			var existing: AccountProfile = account_store[account_key]
			if existing != null and existing.username.to_lower() == username.to_lower():
				return existing
		return null
	var repository := AccountRepository.get_instance()
	if not repository.is_loaded():
		repository.load_all()
	return repository.find_by_username(username)

static func _find_account_by_id(account_id: String, account_store: Dictionary) -> AccountProfile:
	if account_id.is_empty():
		return null
	if account_store.has(account_id):
		return account_store[account_id]
	return AccountRepository.get_instance().find_by_id(account_id)

static func _register_composite_target_account(request: AccountCompositeAuthDTO.Request, account_store: Dictionary) -> Dictionary:
	var register_response := register_account(request, account_store)
	if not register_response.success:
		return {"success": false, "error_code": register_response.error_code, "account": null}
	var target_account := _find_account_by_id(register_response.account_id, account_store)
	return {"success": true, "error_code": "", "account": target_account}

## 复合鉴权接口：支持自动注册/纯登录/纯注册三模流转
static func composite_authenticate(request: AccountCompositeAuthDTO.Request, account_store: Dictionary = {}) -> AccountCompositeAuthDTO.Response:
	var response := AccountCompositeAuthDTO.Response.new()
	if request == null or request.username.is_empty() or request.password_plain.is_empty():
		response.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/invalid_credentials", "ERR_INVALID_CREDENTIALS")
		return response

	var target_account := _find_target_account_for_auth(request.username, account_store)

	if target_account == null:
		if request.action_mode == AccountCompositeAuthDTO.MODE_LOGIN_ONLY:
			response.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/account_not_found", "ERR_ACCOUNT_NOT_FOUND")
			return response
		var register_outcome := _register_composite_target_account(request, account_store)
		if not bool(register_outcome.get("success", false)):
			response.error_code = String(register_outcome.get("error_code", "ERR_REGISTRATION_FAILED"))
			return response
		target_account = register_outcome.get("account", null)
		response.is_new_registration = true

	if request.action_mode == AccountCompositeAuthDTO.MODE_REGISTER_ONLY and not response.is_new_registration:
		response.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/account_already_exists", "ERR_ACCOUNT_ALREADY_EXISTS")
		return response

	var auth_result := authenticate_local(target_account.username, request.password_plain, target_account, request.device_fingerprint)
	if not bool(auth_result.get("success", false)):
		response.error_code = String(auth_result.get("code", "ERR_AUTH_FAILED"))
		return response

	response.success = true
	response.error_code = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/ok", "OK")
	response.account_id = target_account.account_id
	response.username = target_account.username
	response.session_token = String(auth_result.get("token", ""))
	response.created_timestamp_utc = target_account.created_timestamp_utc
	response.last_login_timestamp_utc = target_account.last_login_timestamp_utc
	response.world_state_ref = target_account.world_state_ref
	response.save_slot_summaries = target_account.save_slot_summaries.duplicate()
	return response

# ==============================================================================
# 三、会话校验 / 撤销 / 设备绑定
# ==============================================================================

## Token 时效校验（单机离线会话，TTL 配置驱动，下限 0 即永不过期）
static func is_token_valid(issued_at_utc: int, now_utc: int = -1) -> bool:
	var now: int = now_utc if now_utc >= 0 else int(Time.get_unix_time_from_system())
	var session_ttl_seconds: int = maxi(1, GameConfig.get_int("infrastructure.admin", "session/ttl_seconds", GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/token_ttl_seconds", 86400)))
	var skew := maxi(0, GameConfig.get_int("infrastructure.admin", "security/allow_future_clock_skew_seconds", GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "auth/session/allow_future_clock_skew_seconds", 0)))
	return issued_at_utc <= now + skew and now <= issued_at_utc + session_ttl_seconds

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
		_sessions.erase(token.sha256_text())
		return {"success": false, "error_code": "TOKEN_EXPIRED"}
	if not account_id.is_empty() and account_id != str(session.get("account_id", "")):
		return {"success": false, "error_code": "TOKEN_ACCOUNT_MISMATCH"}
	var should_bind_device := GameConfig.get_bool("infrastructure.admin", "session/bind_device", GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "auth/session/bind_device", true))
	if should_bind_device and not device_fingerprint.is_empty() and device_fingerprint != str(session.get("device_fingerprint", "")):
		return {"success": false, "error_code": "DEVICE_MISMATCH"}
	return {"success": true, "account_id": session.get("account_id", ""), "issued_at": session.get("issued_at", 0), "expires_at": session.get("expires_at", 0), "state": "ACTIVE"}

## 撤销会话（幂等；擦除内存掩码令牌字节，已撤销/不存在的 token 返回 false）
static func revoke_token(token: String) -> bool:
	if token.is_empty():
		return false
	var key := token.sha256_text()
	if not _sessions.has(key):
		return false
	var session: Dictionary = _sessions[key]
	if bool(session.get("revoked", false)):
		return false
	session["revoked"] = true
	session["token_masked"] = PackedByteArray()
	_sessions[key] = session
	var user_identifier: String = String(session.get("username", session.get("account_id", "")))
	EventBusCore.get_instance().emit_domain_event(HudEventContract.channel_auth_session_revoked(), {
		"account_id": session.get("account_id", ""),
		"username": session.get("username", ""),
		"category_key": "auth",
		"args": [user_identifier]
	})
	return true

## 检查传入会话令牌是否属于已知被撤销或已过期令牌（未在会话表登记的测试令牌串返回 false）
static func is_token_revoked_or_expired(token: String, now_utc: int = -1) -> bool:
	if token.is_empty() or not _sessions.has(token.sha256_text()):
		return false
	var session: Dictionary = _sessions[token.sha256_text()]
	var now := now_utc if now_utc >= 0 else int(Time.get_unix_time_from_system())
	return bool(session.get("revoked", false)) or now < int(session.get("issued_at", 0)) or now > int(session.get("expires_at", 0))

## 读取脱敏会话元数据（绝不向外部暴露原始密钥或明文凭据）
static func get_session_masked_metadata(token: String) -> Dictionary:
	if token.is_empty() or not _sessions.has(token.sha256_text()):
		return {}
	var session: Dictionary = _sessions[token.sha256_text()]
	var masked: Variant = session.get("token_masked", PackedByteArray())
	var has_masked_token: bool = (masked is PackedByteArray and not (masked as PackedByteArray).is_empty())
	return {
		"account_id": String(session.get("account_id", "")),
		"username": String(session.get("username", "")),
		"token_prefix": String(session.get("token_prefix", "")),
		"issued_at": int(session.get("issued_at", 0)),
		"expires_at": int(session.get("expires_at", 0)),
		"revoked": bool(session.get("revoked", false)),
		"has_masked_token": has_masked_token
	}

## 标准注销会话（校验账号归属并撤销凭据）
static func logout_session(token: String, account_id: String = "") -> Dictionary:
	if token.is_empty():
		return {"success": false, "error_code": GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/unauthorized", "ERR_UNAUTHORIZED"), "account_id": ""}
	var token_validation := validate_token(token, account_id)
	if not bool(token_validation.get("success", false)):
		return {"success": false, "error_code": String(token_validation.get("error_code", GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/session_revoked", "ERR_SESSION_REVOKED"))), "account_id": String(token_validation.get("account_id", ""))}
	var resolved_account := String(token_validation.get("account_id", ""))
	var session_metadata := get_session_masked_metadata(token)
	var is_revoked := revoke_token(token)
	return {
		"success": is_revoked,
		"error_code": GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/ok", "OK") if is_revoked else GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/session_revoked", "ERR_SESSION_REVOKED"),
		"account_id": resolved_account,
		"token_prefix": String(session_metadata.get("token_prefix", ""))
	}

## 注册并按需自动建立受保护登录会话
static func register_and_login(request: AccountRegistrationDTO.Request, should_auto_login: bool = true, account_store: Dictionary = {}) -> Dictionary:
	var register_response := register_account(request, account_store)
	if not register_response.success:
		return {
			"success": false,
			"error_code": register_response.error_code,
			"account_id": "",
			"username": "",
			"session_token": ""
		}
	var should_login := should_auto_login or GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "auth/session/auto_login_on_register", false)
	if not should_login:
		return {
			"success": true,
			"error_code": register_response.error_code,
			"account_id": register_response.account_id,
			"username": register_response.username,
			"session_token": "",
			"created_timestamp_utc": register_response.created_timestamp_utc
		}
	var target_account := _find_account_by_id(register_response.account_id, account_store)
	if target_account == null:
		return {
			"success": false,
			"error_code": GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/errors/account_not_found", "ERR_ACCOUNT_NOT_FOUND"),
			"account_id": register_response.account_id,
			"username": register_response.username,
			"session_token": ""
		}
	var auth_result := authenticate_local(request.username, request.password_plain, target_account, request.device_fingerprint)
	if AccountRepository.get_instance().has_account(target_account.account_id):
		AccountRepository.get_instance().save_account(target_account)
	return {
		"success": bool(auth_result.get("success", false)),
		"error_code": String(auth_result.get("code", "OK")),
		"account_id": target_account.account_id,
		"username": target_account.username,
		"session_token": String(auth_result.get("token", "")),
		"created_timestamp_utc": target_account.created_timestamp_utc,
		"last_login_timestamp_utc": target_account.last_login_timestamp_utc,
		"auto_enter_gateway": bool(auth_result.get("auto_enter_gateway", true))
	}

## 吊销全部仍处于激活态的会话并擦除掩码凭据（保留 revoked 审计墓碑供 validate_token 识别 TOKEN_REVOKED）
static func revoke_all_active_sessions() -> int:
	var revoked_count := 0
	for key in _sessions.keys():
		var session: Dictionary = _sessions[key]
		if not bool(session.get("revoked", false)):
			session["revoked"] = true
			session["token_masked"] = PackedByteArray()
			_sessions[key] = session
			revoked_count += 1
	return revoked_count

## 清空全部会话（登出/重置场景）
static func clear_sessions() -> void:
	if not _sessions.is_empty():
		_sessions.clear()

## 绑定设备指纹（单机隔离强校验，后续鉴权强校验匹配）
static func bind_device_fingerprint(account: AccountProfile, fingerprint: String) -> Dictionary:
	if account == null or fingerprint.is_empty():
		return {"success": false, "error_code": "INVALID_FINGERPRINT"}
	account.local_device_fingerprint = fingerprint
	return {"success": true, "fingerprint": fingerprint}
