# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_auth_service.gd
# 架构定位: Domain Boundary Adapter / Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: AuthService,
#           AccountRepository, AccountSlotBindingSolver
# 职责说明: 实现 IAuthService 接口，封装后端真实 AuthService、AccountRepository
#           与 AccountSlotBindingSolver，为前端表现层提供穿透后端的异步能力。
# 退出语义与设计依据: 业务领域第一性原理 / 前端无业务逻辑契约 / 领域边界穿透架构
# ==============================================================================

## RealAuthService：直连后端认证、账号仓与角色槽位绑定的真实边界服务实现
class_name RealAuthService
extends IAuthService

const ERROR_CODE_I18N_MAP: Dictionary = {
    "ERR_INVALID_CREDENTIALS": "ui.fe01.login.error_invalid",
    "ERR_INVALID_USERNAME_LENGTH": "ui.fe01.register.error_short",
    "ERR_ACCOUNT_ALREADY_EXISTS": "ui.fe01.register.error_already_exists",
    "ERR_ACCOUNT_NOT_FOUND": "ui.fe01.login.error_not_found",
    "ERR_DEVICE_MISMATCH": "ui.fe01.login.error_device",
    "ERR_EMPTY_USERNAME": "ui.fe01.login.error_empty",
    "ERR_NAME_EMPTY": "ui.fe01.char_create.error_empty_name",
    "ERR_BIND_FAILED": "ui.fe01.char_create.error_bind_failed",
    "SLOT_OCCUPIED": "ui.fe01.char_create.error_slot_occupied",
    "NO_AVAILABLE_SLOT": "ui.fe01.char_create.error_no_slot",
    "INVALID_SLOT": "ui.fe01.char_create.error_invalid_slot",
    "INVALID_ACCOUNT": "ui.fe01.login.error_not_found",
    "INVALID_CONTEXT": "ui.fe01.char_create.error_bind_failed",
    "ERR_NO_BASE_CONTENT_MOD": "ui.fe01.char_create.error_no_base_mod",
}

## 异步登录契约实现（经统一协议分发并同步激活 Gateway + SessionRuntime）
func login_async(username: String, password_plain: String, result_callback: Callable) -> void:
    var trimmed_username: String = username.strip_edges()
    if trimmed_username.is_empty():
        _emit_error_callback(result_callback, "ERR_EMPTY_USERNAME")
        return

    var service_response := RealProtocolBridge.dispatch_human("account", "LOGIN_LOCAL", {
        "username": trimmed_username,
        "password_plain": password_plain
    }, "", "")
    if not service_response.success:
        _emit_error_callback(result_callback, service_response.error_code)
        return

    var account_id := str(service_response.data.get("account_id", ""))
    var repository := AccountRepository.get_instance()
    if not repository.is_loaded():
        repository.load_all()
    var account_profile: AccountProfile = repository.find_by_id(account_id)
    var slots: Array = AccountSlotBindingSolver.to_frontend_character_slots(account_profile) if account_profile != null else []

    if result_callback.is_valid():
        result_callback.call({
            "success": true,
            "account_id": account_id,
            "username": str(service_response.data.get("username", trimmed_username)),
            "token": str(service_response.data.get("session_token", "")),
            "character_slots": slots,
            "world_state_ref": str(service_response.data.get("world_state_ref", ""))
        })

## 异步注册契约实现（经统一协议分发，支持可选自动登录并返回会话令牌）
func register_async(username: String, password_plain: String, result_callback: Callable, auto_login: bool = false) -> void:
    var trimmed_username: String = username.strip_edges()
    var service_response := RealProtocolBridge.dispatch_human("account", "REGISTER_ACCOUNT", {
        "username": trimmed_username,
        "password_plain": password_plain,
        "auto_login": auto_login
    }, "", "")
    if not service_response.success:
        _emit_error_callback(result_callback, service_response.error_code)
        return

    var reply_payload: Dictionary = {
        "success": true,
        "account_id": str(service_response.data.get("account_id", "")),
        "username": str(service_response.data.get("username", trimmed_username)),
        "created_timestamp_utc": int(service_response.data.get("created_timestamp_utc", 0))
    }
    var session_token := str(service_response.data.get("session_token", service_response.data.get("token", "")))
    if auto_login or not session_token.is_empty():
        var account_id := str(reply_payload.get("account_id", ""))
        var repository := AccountRepository.get_instance()
        if not repository.is_loaded():
            repository.load_all()
        var account_profile: AccountProfile = repository.find_by_id(account_id)
        var slots: Array = AccountSlotBindingSolver.to_frontend_character_slots(account_profile) if account_profile != null else []
        var world_reference := str(service_response.data.get("world_state_ref", ""))
        if world_reference.is_empty() and account_profile != null and "world_state_ref" in account_profile:
            world_reference = str(account_profile.world_state_ref)
        reply_payload["token"] = session_token
        reply_payload["character_slots"] = slots
        reply_payload["world_state_ref"] = world_reference

    if result_callback.is_valid():
        result_callback.call(reply_payload)

## 异步游客免密快捷登录契约实现（对齐 LOGIN_GUEST）
func login_guest_async(device_fingerprint: String = "", result_callback: Callable = Callable()) -> void:
    var service_response := RealProtocolBridge.dispatch_human("account", "LOGIN_GUEST", {
        "device_fingerprint": device_fingerprint
    }, "", "")
    if not result_callback.is_valid():
        return
    if not service_response.success:
        _emit_error_callback(result_callback, service_response.error_code)
        return
    result_callback.call({
        "success": true,
        "account_id": str(service_response.data.get("account_id", "")),
        "username": str(service_response.data.get("username", "")),
        "token": str(service_response.data.get("session_token", "")),
        "is_guest_mode": true,
        "world_state_ref": str(service_response.data.get("world_state_ref", ""))
    })

## 异步清除指定角色槽位契约实现（对齐 CLEAR_SLOT）
func clear_slot_async(account_id: String, token: String, slot_id: String, result_callback: Callable = Callable()) -> void:
    RealProtocolBridge.dispatch_and_reply("account", "CLEAR_SLOT", {"account_id": account_id, "slot_id": slot_id}, account_id, token, result_callback)

## 获取服务器列表契约实现（配置驱动）
func get_servers_async(result_callback: Callable) -> void:
    var servers: Array = GameConfig.get_array("frontend.views", "fe01_account_entry/default_servers", [])
    if result_callback.is_valid():
        result_callback.call({
            "success": true,
            "servers": servers.duplicate(true)
        })

## 获取指定账号的角色槽位列表（优先经统一协议检索）
func get_characters_async(account_id: String, result_callback: Callable) -> void:
    var protocol_outcome := RealProtocolBridge.dispatch_flat("account", "LIST_CHARACTERS", {"account_id": account_id})
    var slots: Array = protocol_outcome.get("characters", []) if protocol_outcome.get("characters") is Array else []
    if not bool(protocol_outcome.get("success", false)):
        var repository := AccountRepository.get_instance()
        if not repository.is_loaded():
            repository.load_all()
        var account_profile: AccountProfile = repository.find_by_id(account_id)
        if account_profile != null:
            slots = AccountSlotBindingSolver.to_frontend_character_slots(account_profile)

    if result_callback.is_valid():
        result_callback.call({
            "success": true,
            "characters": slots
        })

## 创建角色异步请求契约
func create_character_async(account_id: String, request_payload: Dictionary, result_callback: Callable) -> void:
    var character_name: String = str(request_payload.get("name", "")).strip_edges()
    if character_name.is_empty():
        _emit_error_callback(result_callback, "ERR_NAME_EMPTY")
        return

    var repository := AccountRepository.get_instance()
    if not repository.is_loaded():
        repository.load_all()
    var account_profile: AccountProfile = repository.find_by_id(account_id)
    if account_profile == null:
        _emit_error_callback(result_callback, "ERR_ACCOUNT_NOT_FOUND")
        return

    var chosen_race: String = str(request_payload.get("race", "")).strip_edges()
    var creation_context := AccountSlotCreationDTO.new({
        "account": account_profile,
        "slot_id": str(request_payload.get("slot_id", "")),
        "character_name": character_name,
        "title_prefix": str(request_payload.get("title_prefix", "")),
        "is_permadeath": bool(request_payload.get("is_permadeath", false)),
        "provision_disk": true,
        "race": chosen_race
    })
    var bind_result: Dictionary = AccountSlotBindingSolver.create_character_in_slot_context(creation_context)

    if not bool(bind_result.get("success", false)):
        var bind_error_code: String = str(bind_result.get("error_code", "ERR_BIND_FAILED")).strip_edges()
        if bind_error_code.is_empty():
            bind_error_code = "ERR_BIND_FAILED"
        var mapped_fallback: String = str(ERROR_CODE_I18N_MAP.get(bind_error_code, bind_error_code))
        _emit_error_callback(result_callback, bind_error_code, mapped_fallback)
        return

    var bound_slot_id: String = str(bind_result.get("slot_id", ""))
    var created_slot: Dictionary = AccountSlotBindingSolver.get_frontend_character_slot(account_profile, bound_slot_id)

    if result_callback.is_valid():
        result_callback.call({
            "success": true,
            "character": created_slot
        })

## 六维资质骰点：确定性 8~18 生成
func roll_attribute_spread() -> Dictionary:
    return IAuthService.build_preview_attribute_spread()

## 异步资质骰点契约实现
func roll_attributes_async(result_callback: Callable) -> void:
    if result_callback.is_valid():
        result_callback.call(roll_attribute_spread())

## 异步注销/吊销令牌契约实现（对齐 LOGOUT_ACCOUNT 动作）
func revoke_token(token: String, result_callback: Callable = Callable()) -> void:
    _dispatch_logout(
        WorldSessionRuntimeService.get_active_account_id(),
        token,
        {"session_token": token},
        result_callback
    )

## 异步退出账号契约实现
func logout_async(account_id: String, token: String, result_callback: Callable = Callable()) -> void:
    _dispatch_logout(
        account_id,
        token,
        {"account_id": account_id, "session_token": token},
        result_callback
    )

func _dispatch_logout(account_id: String, token: String, request_payload: Dictionary, result_callback: Callable) -> void:
    var service_response := RealProtocolBridge.dispatch_human("account", "LOGOUT_ACCOUNT", request_payload, account_id, token)
    if result_callback.is_valid():
        result_callback.call({
            "success": service_response.success,
            "error_code": service_response.error_code,
            "message": service_response.error_message,
            "data": service_response.data
        })

## 异步拉取账号首页视图模型契约实现
func get_account_home_async(account_id: String, token: String, result_callback: Callable = Callable(), locale: String = "") -> void:
    var request_payload := {"account_id": account_id}
    if not locale.is_empty():
        request_payload["locale"] = locale
    var service_response := RealProtocolBridge.dispatch_human("account", "GET_ACCOUNT_HOME_VIEW_MODEL", request_payload, account_id, token)
    if result_callback.is_valid():
        result_callback.call({
            "success": service_response.success,
            "error_code": service_response.error_code,
            "message": service_response.error_message,
            "view_model": service_response.data if service_response.success and service_response.data is Dictionary else {}
        })

func _emit_error_callback(result_callback: Callable, error_code: String, fallback_i18n_key: String = "") -> void:
    if not result_callback.is_valid():
        return
    var default_message: String = fallback_i18n_key if not fallback_i18n_key.is_empty() else error_code
    result_callback.call({
        "success": false,
        "error_code": error_code,
        "message": str(ERROR_CODE_I18N_MAP.get(error_code, default_message))
    })
