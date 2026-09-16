# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 认证服务抽象契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_auth_service.gd
# 职责: 规范账号认证、选服与角色列表接口，隔离底层网络/后端实现
# ==============================================================================
class_name IAuthService
extends RefCounted

## 异步登录契约 (callback: func(result: Dictionary) -> void)
func login_async(username: String, password_plain: String, callback: Callable) -> void:
	printerr("IAuthService.login_async: 纯虚函数必须由子类实现")

## 异步注册契约 (对齐 P71 AccountRegistrationDTO)
func register_async(username: String, password_plain: String, callback: Callable) -> void:
	printerr("IAuthService.register_async: 纯虚函数必须由子类实现")

## 获取服务器列表契约
func get_servers_async(callback: Callable) -> void:
	printerr("IAuthService.get_servers_async: 纯虚函数必须由子类实现")

## 获取角色槽位列表契约
func get_characters_async(account_id: String, callback: Callable) -> void:
	printerr("IAuthService.get_characters_async: 纯虚函数必须由子类实现")

## 创角请求契约
func create_character_async(account_id: String, req_data: Dictionary, callback: Callable) -> void:
	printerr("IAuthService.create_character_async: 纯虚函数必须由子类实现")

## 六维资质骰点契约（返回 {success: true, attrs: {STR/AGI/CON/INT/WIS/CHA}}）
func roll_attribute_spread() -> Dictionary:
	printerr("IAuthService.roll_attribute_spread: 纯虚函数必须由子类实现")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}
