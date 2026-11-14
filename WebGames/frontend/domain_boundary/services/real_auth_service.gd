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

const AccountSlotCreationDTO = preload("res://backend/domains/account/dto/account_slot_creation_dto.gd")
const AccountRepository = preload("res://backend/domains/account/account_repository.gd")
const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const RealProtocolBridge = preload("res://frontend/domain_boundary/services/real_protocol_bridge.gd")

const ERROR_CODE_I18N_MAP: Dictionary = {
    "ERR_INVALID_CREDENTIALS": "ui.fe01.login.error_invalid",
    "ERR_INVALID_USERNAME_LENGTH": "ui.fe01.register.error_short",
    "ERR_ACCOUNT_ALREADY_EXISTS": "ui.fe01.register.error_already_exists",
    "ERR_ACCOUNT_NOT_FOUND": "ui.fe01.login.error_not_found",
    "ERR_DEVICE_MISMATCH": "ui.fe01.login.error_device",
    "ERR_EMPTY_USERNAME": "ui.fe01.login.error_empty",
    "ERR_NAME_EMPTY": "ui.fe01.char_create.error_empty_name",
    "ERR_BIND_FAILED": "ui.fe01.char_create.error_bind_failed",
}

## 异步登录契约实现（经统一协议分发并同步激活 Gateway + SessionRuntime）
func login_async(username: String, password_plain: String, callback: Callable) -> void:
    var user_clean: String = username.strip_edges()
    if user_clean.is_empty():
        _emit_error_callback(callback, "ERR_EMPTY_USERNAME")
        return

    var response := RealProtocolBridge.dispatch_human("account", "LOGIN_LOCAL", {
        "username": user_clean,
        "password_plain": password_plain
    }, "", "")
    if not response.success:
        _emit_error_callback(callback, response.error_code)
        return

    var account_id := str(response.data.get("account_id", ""))
    var repository := AccountRepository.get_instance()
    if not repository.is_loaded():
        repository.load_all()
    var account_profile: AccountProfile = repository.find_by_id(account_id)
    var slots: Array = AccountSlotBindingSolver.to_frontend_character_slots(account_profile) if account_profile != null else []

    if callback.is_valid():
        callback.call({
            "success": true,
            "account_id": account_id,
            "username": str(response.data.get("username", user_clean)),
            "token": str(response.data.get("session_token", "")),
            "character_slots": slots,
            "world_state_ref": str(response.data.get("world_state_ref", ""))
        })

## 异步注册契约实现（经统一协议分发）
func register_async(username: String, password_plain: String, callback: Callable) -> void:
    var user_clean: String = username.strip_edges()
    var response := RealProtocolBridge.dispatch_human("account", "REGISTER_ACCOUNT", {
        "username": user_clean,
        "password_plain": password_plain
    }, "", "")
    if not response.success:
        _emit_error_callback(callback, response.error_code)
        return

    if callback.is_valid():
        callback.call({
            "success": true,
            "account_id": str(response.data.get("account_id", "")),
            "username": str(response.data.get("username", user_clean)),
            "created_timestamp_utc": int(response.data.get("created_timestamp_utc", 0))
        })

## 异步游客免密快捷登录契约实现（对齐 LOGIN_GUEST）
func login_guest_async(device_fingerprint: String = "", callback: Callable = Callable()) -> void:
    var response := RealProtocolBridge.dispatch_human("account", "LOGIN_GUEST", {
        "device_fingerprint": device_fingerprint
    }, "", "")
    if not callback.is_valid():
        return
    if not response.success:
        _emit_error_callback(callback, response.error_code)
        return
    callback.call({
        "success": true,
        "account_id": str(response.data.get("account_id", "")),
        "username": str(response.data.get("username", "")),
        "token": str(response.data.get("session_token", "")),
        "is_guest_mode": true,
        "world_state_ref": str(response.data.get("world_state_ref", ""))
    })

## 异步清除指定角色槽位契约实现（对齐 CLEAR_SLOT）
func clear_slot_async(account_id: String, token: String, slot_id: String, callback: Callable = Callable()) -> void:
    RealProtocolBridge.dispatch_and_reply("account", "CLEAR_SLOT", {"account_id": account_id, "slot_id": slot_id}, account_id, token, callback)

## 获取服务器列表契约实现（配置驱动）
func get_servers_async(callback: Callable) -> void:
    var servers: Array = GameConfig.get_array("frontend.views", "fe01_account_entry/default_servers", [])
    if callback.is_valid():
        callback.call({
            "success": true,
            "servers": servers.duplicate(true)
        })

## 获取指定账号的角色槽位列表
func get_characters_async(account_id: String, callback: Callable) -> void:
    var repository := AccountRepository.get_instance()
    if not repository.is_loaded():
        repository.load_all()
    var account_profile: AccountProfile = repository.find_by_id(account_id)
    var slots: Array = []
    if account_profile != null:
        slots = AccountSlotBindingSolver.to_frontend_character_slots(account_profile)

    if callback.is_valid():
        callback.call({
            "success": true,
            "characters": slots
        })

## 创建角色异步请求契约
func create_character_async(account_id: String, request_data: Dictionary, callback: Callable) -> void:
    var char_name: String = str(request_data.get("name", "")).strip_edges()
    if char_name.is_empty():
        _emit_error_callback(callback, "ERR_NAME_EMPTY")
        return

    var repository := AccountRepository.get_instance()
    if not repository.is_loaded():
        repository.load_all()
    var account_profile: AccountProfile = repository.find_by_id(account_id)
    if account_profile == null:
        _emit_error_callback(callback, "ERR_ACCOUNT_NOT_FOUND")
        return

    var chosen_race: String = str(request_data.get("race", "HUMAN")).strip_edges()
    if chosen_race.is_empty():
        chosen_race = "HUMAN"
    var creation_context := AccountSlotCreationDTO.new({
        "account": account_profile,
        "slot_id": str(request_data.get("slot_id", "")),
        "character_name": char_name,
        "title_prefix": str(request_data.get("title_prefix", "")),
        "is_permadeath": bool(request_data.get("is_permadeath", false)),
        "allow_default_fallback": true,
        "provision_disk": true,
        "race": chosen_race
    })
    var bind_result: Dictionary = AccountSlotBindingSolver.create_character_in_slot_context(creation_context)

    if not bool(bind_result.get("success", false)):
        var bind_error_code: String = str(bind_result.get("error_code", "ERR_BIND_FAILED"))
        _emit_error_callback(callback, bind_error_code, ERROR_CODE_I18N_MAP["ERR_BIND_FAILED"])
        return

    var bound_slot_id: String = str(bind_result.get("slot_id", ""))
    var created_slot: Dictionary = AccountSlotBindingSolver.get_frontend_character_slot(account_profile, bound_slot_id)

    if callback.is_valid():
        callback.call({
            "success": true,
            "character": created_slot
        })

## 六维资质骰点：确定性 8~18 生成
func roll_attribute_spread() -> Dictionary:
    return IAuthService.build_preview_attribute_spread()

## 异步资质骰点契约实现
func roll_attributes_async(callback: Callable) -> void:
    if callback.is_valid():
        callback.call(roll_attribute_spread())

## 异步注销/吊销令牌契约实现（对齐 LOGOUT_ACCOUNT 动作）
func revoke_token(token: String, callback: Callable = Callable()) -> void:
    _dispatch_logout(
        WorldSessionRuntimeService.get_active_account_id(),
        token,
        {"session_token": token},
        callback
    )

## 异步退出账号契约实现
func logout_async(account_id: String, token: String, callback: Callable = Callable()) -> void:
    _dispatch_logout(
        account_id,
        token,
        {"account_id": account_id, "session_token": token},
        callback
    )

func _dispatch_logout(account_id: String, token: String, payload: Dictionary, callback: Callable) -> void:
    var response := RealProtocolBridge.dispatch_human("account", "LOGOUT_ACCOUNT", payload, account_id, token)
    if callback.is_valid():
        callback.call({
            "success": response.success,
            "error_code": response.error_code,
            "message": response.error_message,
            "data": response.data
        })

## 异步拉取账号首页视图模型契约实现
func get_account_home_async(account_id: String, token: String, callback: Callable = Callable(), locale: String = "") -> void:
    var payload := {"account_id": account_id}
    if not locale.is_empty():
        payload["locale"] = locale
    var response := RealProtocolBridge.dispatch_human("account", "GET_ACCOUNT_HOME_VIEW_MODEL", payload, account_id, token)
    if callback.is_valid():
        callback.call({
            "success": response.success,
            "error_code": response.error_code,
            "message": response.error_message,
            "view_model": response.data if response.success and response.data is Dictionary else {}
        })

func _emit_error_callback(callback: Callable, error_code: String, fallback_i18n_key: String = "") -> void:
    if not callback.is_valid():
        return
    var default_message: String = fallback_i18n_key if not fallback_i18n_key.is_empty() else error_code
    callback.call({
        "success": false,
        "error_code": error_code,
        "message": str(ERROR_CODE_I18N_MAP.get(error_code, default_message))
    })
