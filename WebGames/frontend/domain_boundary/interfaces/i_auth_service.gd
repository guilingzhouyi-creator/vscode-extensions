# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 认证服务抽象契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_auth_service.gd
# 职责: 规范账号认证、选服与角色列表接口，隔离底层网络/后端实现
# ==============================================================================
class_name IAuthService
extends RefCounted

const PREVIEW_ATTR_KEYS: Array[String] = ["STR", "AGI", "CON", "INT", "WIS", "CHA"]
const PREVIEW_ATTR_MIN: int = 8
const PREVIEW_ATTR_MAX: int = 18

## 生成标准前端创角六维预览资质点（8~18 确定性采样，前后端边界单源复用）
static func build_preview_attribute_spread() -> Dictionary:
	var rng: DeterministicRNG = DeterministicRNG.global()
	var attrs: Dictionary = {}
	for attr_key in PREVIEW_ATTR_KEYS:
		attrs[attr_key] = rng.randi_range(PREVIEW_ATTR_MIN, PREVIEW_ATTR_MAX)
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
func create_character_async(account_id: String, req_data: Dictionary, callback: Callable) -> void:
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

## 异步拉取账号首页视图模型契约 (对齐 GET_ACCOUNT_HOME_VIEW_MODEL)
func get_account_home_async(account_id: String, token: String, callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "IAuthService.get_account_home_async: pure virtual method must be implemented by subclass")
