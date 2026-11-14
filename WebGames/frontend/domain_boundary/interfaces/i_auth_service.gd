# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_auth_service.gd
# 架构定位: Domain Boundary Interface / Auth Service Contract
# 依赖与触发: 上游: Frontend Views, ServiceContainer | 下游: RealAuthService, MockAuthService
# 职责说明: 规范账号认证、选服、角色列表与免密快捷登录接口，隔离底层网络与后端实现。
# 退出语义与设计依据: 前端无业务逻辑契约与领域边界服务解耦规范
# ==============================================================================

## IAuthService：前端认证、账号与创角预浏览服务抽象接口
class_name IAuthService
extends RefCounted

const PREVIEW_ATTR_KEYS: Array[String] = ["STR", "AGI", "CON", "INT", "WIS", "CHA"]
const PREVIEW_ATTR_MIN: int = 8
const PREVIEW_ATTR_MAX: int = 18

## 生成标准前端创角六维预览资质点（8~18 确定性采样，前后端边界单源复用）
static func build_preview_attribute_spread() -> Dictionary:
	var rng: DeterministicRNG = DeterministicRNG.global()
	var attrs: Dictionary = {}
	for attribute_key in PREVIEW_ATTR_KEYS:
		attrs[attribute_key] = rng.randi_range(PREVIEW_ATTR_MIN, PREVIEW_ATTR_MAX)
	return {
		"success": true,
		"attrs": attrs
	}

## 异步登录契约 (callback: func(result: Dictionary) -> void)
func login_async(username: String, password_plain: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.login_async: pure virtual method must be implemented by subclass")

## 异步注册契约 (对齐 AccountRegistrationDTO)
func register_async(username: String, password_plain: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.register_async: pure virtual method must be implemented by subclass")

## 获取服务器列表契约
func get_servers_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.get_servers_async: pure virtual method must be implemented by subclass")

## 获取角色槽位列表契约
func get_characters_async(account_id: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.get_characters_async: pure virtual method must be implemented by subclass")

## 创角请求契约
func create_character_async(account_id: String, request_data: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.create_character_async: pure virtual method must be implemented by subclass")

## 六维资质骰点契约（返回 {success: true, attrs: {STR/AGI/CON/INT/WIS/CHA}}）
func roll_attribute_spread() -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IAuthService.roll_attribute_spread: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 异步资质骰点契约（对齐 ROLL_CHARACTER_PREVIEW 动作）
func roll_attributes_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.roll_attributes_async: pure virtual method must be implemented by subclass")

## 异步注销/吊销令牌契约 (callback: func(result: Dictionary) -> void)
func revoke_token(token: String, callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.revoke_token: pure virtual method must be implemented by subclass")

## 异步退出账号契约 (对齐 LOGOUT_ACCOUNT)
func logout_async(account_id: String, token: String, callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.logout_async: pure virtual method must be implemented by subclass")

## 异步游客免密快捷登录契约 (对齐 LOGIN_GUEST)
func login_guest_async(_device_fingerprint: String = "", callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.login_guest_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步清除指定角色槽位契约 (对齐 CLEAR_SLOT)
func clear_slot_async(_account_id: String, _token: String, _slot_id: String, callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.clear_slot_async: pure virtual method must be implemented by subclass")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步拉取账号首页视图模型契约 (对齐 GET_ACCOUNT_HOME_VIEW_MODEL)
func get_account_home_async(account_id: String, token: String, callback: Callable = Callable(), _locale: String = "") -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.get_account_home_async: pure virtual method must be implemented by subclass")
