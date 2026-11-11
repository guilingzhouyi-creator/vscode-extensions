# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_auth_service.gd
# 架构定位: Domain Boundary Adapter / Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: AuthService,
#           AccountRepository, AccountSlotBindingSolver
# 职责说明: 实现 IAuthService 接口，封装后端真实 AuthService、AccountRepository
#           与 AccountSlotBindingSolver，为前端表现层提供穿透后端的异步能力。
# 设计依据: 业务领域第一性原理 / 前端无业务逻辑契约 / 领域边界穿透架构
# ==============================================================================

class_name RealAuthService
extends IAuthService

const AccountRegistrationDTO = preload("res://backend/domains/account/dto/account_registration_dto.gd")
const AccountCompositeAuthDTO = preload("res://backend/domains/account/dto/account_composite_auth_dto.gd")
const AuthService = preload("res://backend/domains/account/auth_service.gd")
const AccountRepository = preload("res://backend/domains/account/account_repository.gd")
const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")
const CharacterProfile = preload("res://backend/domains/account/character_profile.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const UnifiedProtocolDispatcher = preload("res://backend/domains/world_state/services/unified_protocol_dispatcher.gd")

const ATTR_KEYS: Array[String] = ["STR", "AGI", "CON", "INT", "WIS", "CHA"]
const ATTR_ROLL_MIN: int = 8
const ATTR_ROLL_MAX: int = 18
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

## 异步登录契约实现
func login_async(username: String, password_plain: String, callback: Callable) -> void:
    var user_clean: String = username.strip_edges()
    if user_clean.is_empty():
        _emit_error_callback(callback, "ERR_EMPTY_USERNAME")
        return

    var req := AccountCompositeAuthDTO.Request.new()
    req.username = user_clean
    req.password_plain = password_plain
    req.action_mode = AccountCompositeAuthDTO.MODE_LOGIN_ONLY

    var resp: AccountCompositeAuthDTO.Response = AuthService.composite_authenticate(req)
    if not resp.success:
        _emit_error_callback(callback, resp.error_code)
        return

    var repo := AccountRepository.get_instance()
    var acc: AccountProfileAggregate = repo.find_by_id(resp.account_id)
    var slots: Array = []
    if acc != null:
        slots = AccountSlotBindingSolver.to_frontend_character_slots(acc)

    # 同步激活后端全链路会话运行时真源
    WorldSessionRuntimeService.activate_authenticated_session(resp.account_id, resp.session_token)

    if callback.is_valid():
        callback.call({
            "success": true,
            "account_id": resp.account_id,
            "username": resp.username,
            "token": resp.session_token,
            "character_slots": slots,
            "world_state_ref": resp.world_state_ref
        })

## 异步注册契约实现
func register_async(username: String, password_plain: String, callback: Callable) -> void:
    var user_clean: String = username.strip_edges()
    var req := AccountRegistrationDTO.Request.new()
    req.username = user_clean
    req.password_plain = password_plain

    var resp: AccountRegistrationDTO.Response = AuthService.register_account(req)
    if not resp.success:
        _emit_error_callback(callback, resp.error_code)
        return

    if callback.is_valid():
        callback.call({
            "success": true,
            "account_id": resp.account_id,
            "username": resp.username,
            "created_timestamp_utc": resp.created_timestamp_utc
        })

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
    var repo := AccountRepository.get_instance()
    if not repo.is_loaded():
        repo.load_all()
    var acc: AccountProfileAggregate = repo.find_by_id(account_id)
    var slots: Array = []
    if acc != null:
        slots = AccountSlotBindingSolver.to_frontend_character_slots(acc)

    if callback.is_valid():
        callback.call({
            "success": true,
            "characters": slots
        })

## 创建角色异步请求契约
func create_character_async(account_id: String, req_data: Dictionary, callback: Callable) -> void:
    var char_name: String = str(req_data.get("name", "")).strip_edges()
    if char_name.is_empty():
        _emit_error_callback(callback, "ERR_NAME_EMPTY")
        return

    var repo := AccountRepository.get_instance()
    if not repo.is_loaded():
        repo.load_all()
    var acc: AccountProfileAggregate = repo.find_by_id(account_id)
    if acc == null:
        _emit_error_callback(callback, "ERR_ACCOUNT_NOT_FOUND")
        return

    var slot_id: String = str(req_data.get("slot_id", ""))
    var title_prefix: String = str(req_data.get("title_prefix", ""))
    var is_permadeath: bool = bool(req_data.get("is_permadeath", false))

    var bind_res: Dictionary = AccountSlotBindingSolver.create_character_in_slot(
        acc,
        slot_id,
        char_name,
        title_prefix,
        is_permadeath,
        true,
        true
    )

    if not bool(bind_res.get("success", false)):
        var bind_err_code: String = str(bind_res.get("error_code", "ERR_BIND_FAILED"))
        _emit_error_callback(callback, bind_err_code, ERROR_CODE_I18N_MAP["ERR_BIND_FAILED"])
        return

    var bound_slot_id: String = str(bind_res.get("slot_id", ""))
    var summary: SaveSlotSummaryDTO = acc.get_summary_by_slot(bound_slot_id)
    if summary != null:
        if summary.character_profile == null:
            var cp := CharacterProfile.new()
            cp.character_id = UniqueIdGenerator.next_id("CHR_")
            cp.character_name = char_name
            summary.attach_character_profile(cp)
        var chosen_race: String = str(req_data.get("race", "HUMAN"))
        summary.character_profile.character_exclusive_progress["race"] = chosen_race
        repo.save_account(acc)

    var created_slot := {
        "slot_id": bind_res.get("slot_id", ""),
        "name": char_name,
        "race": str(req_data.get("race", "HUMAN")),
        "class": "Novice",
        "level": 1,
        "town": "VALAN_CAPITAL",
        "empty": false
    }

    if callback.is_valid():
        callback.call({
            "success": true,
            "character": created_slot
        })

## 六维资质骰点：确定性 8~18 生成
func roll_attribute_spread() -> Dictionary:
    var rng := DeterministicRNG.global()
    var attrs: Dictionary = {}
    for attr_key in ATTR_KEYS:
        attrs[attr_key] = rng.randi_range(ATTR_ROLL_MIN, ATTR_ROLL_MAX)
    return {
        "success": true,
        "attrs": attrs
    }

## 异步资质骰点契约实现（对齐 ROLL_CHARACTER_PREVIEW 动作）
func roll_attributes_async(callback: Callable) -> void:
    var req := UnifiedProtocolFactory.create_human_request(
        "character_creation",
        "ROLL_CHARACTER_PREVIEW",
        {}
    )
    var resp := UnifiedProtocolDispatcher.dispatch_request(req)
    if resp.success and resp.data is Dictionary:
        if callback.is_valid():
            callback.call(resp.data)
        return
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
    var req := UnifiedProtocolFactory.create_human_request(
        "account",
        "LOGOUT_ACCOUNT",
        payload,
        token,
        account_id
    )
    var resp := UnifiedProtocolDispatcher.dispatch_request(req)
    if resp.success:
        WorldSessionRuntimeService.revoke_account_session()
    if callback.is_valid():
        callback.call({
            "success": resp.success,
            "error_code": resp.error_code,
            "message": resp.error_message
        })

## 异步拉取账号首页视图模型契约实现
func get_account_home_async(account_id: String, token: String, callback: Callable = Callable()) -> void:
    var req := UnifiedProtocolFactory.create_human_request(
        "account",
        "GET_ACCOUNT_HOME_VIEW_MODEL",
        {"account_id": account_id},
        token,
        account_id
    )
    var resp := UnifiedProtocolDispatcher.dispatch_request(req)
    if not resp.success:
        if callback.is_valid():
            callback.call({
                "success": false,
                "error_code": resp.error_code,
                "message": resp.error_message
            })
        return
    if callback.is_valid():
        callback.call({
            "success": true,
            "view_model": resp.data
        })

func _emit_error_callback(callback: Callable, error_code: String, fallback_i18n_key: String = "") -> void:
    if not callback.is_valid():
        return
    var default_msg: String = fallback_i18n_key if not fallback_i18n_key.is_empty() else error_code
    callback.call({
        "success": false,
        "error_code": error_code,
        "message": str(ERROR_CODE_I18N_MAP.get(error_code, default_msg))
    })
