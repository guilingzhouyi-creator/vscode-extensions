# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_auth_service.gd
# 架构定位: Domain Boundary Mock / Simulated Auth Service
# 依赖与触发: 上游: MockServiceContainer, 账号认证视图 | 下游: MockBaseService, MockDataCatalog
# 职责说明: 提供模拟认证与账号流程服务，支持登录、注册、选服、创角及免密快捷游客登录。
# 退出语义与设计依据: 无后端联机环境隔离测试与用例间状态复位契约
# ==============================================================================

## MockAuthService：前端认证、选服与角色槽位模拟服务
class_name MockAuthService
extends IAuthService

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS
var _mock_characters: Array = []

## 复位模拟角色集与延迟配置到基线，供测试 teardown 与用例隔离，杜绝脏角色与延迟参数跨用例残留
func reset_instance() -> void:
	simulate_delay_ms = MockBaseService.DEFAULT_SIMULATE_DELAY_MS
	var base_data := MockDataCatalog.get_domain_data("account")
	_mock_characters = (base_data.get("character_slots", []) as Array).duplicate(true)

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms
	var base_data := MockDataCatalog.get_domain_data("account")
	_mock_characters = (base_data.get("character_slots", []) as Array).duplicate(true)

## 模拟异步账号密码登录校验并返回模拟令牌
func login_async(username: String, password_plain: String, callback: Callable) -> void:
	if username.is_empty():
		MockBaseService.delayed_call(callback, { "success": false, "error_code": "ERR_EMPTY_USERNAME", "message": "用户名不能为空" }, simulate_delay_ms)
		return
	if password_plain == "wrong":
		MockBaseService.delayed_call(callback, { "success": false, "error_code": "ERR_INVALID_CREDENTIALS", "message": "密码错误" }, simulate_delay_ms)
		return

	MockBaseService.delayed_call(callback, {
		"success": true,
		"account_id": "ACC_MOCK_1001",
		"username": username,
		"token": "MOCK_TOKEN_eyJhbGciOiJIUzI1NiJ9"
	}, simulate_delay_ms)

## 模拟异步新账号注册请求
func register_async(username: String, password_plain: String, callback: Callable) -> void:
	if username.is_empty() or password_plain.is_empty():
		MockBaseService.delayed_call(callback, { "success": false, "error_code": "ERR_PARAM_INVALID", "message": "账号或密码不能为空" }, simulate_delay_ms)
		return
	MockBaseService.delayed_call(callback, {
		"success": true,
		"account_id": "ACC_MOCK_NEW",
		"username": username
	}, simulate_delay_ms)

## 模拟异步拉取区服列表快照
func get_servers_async(callback: Callable) -> void:
	var base_data := MockDataCatalog.get_domain_data("account")
	var servers: Array = base_data.get("default_servers", [])
	MockBaseService.delayed_call(callback, { "success": true, "servers": servers.duplicate(true) }, simulate_delay_ms)

## 模拟异步查询账号下角色槽位列表
func get_characters_async(account_id: String, callback: Callable) -> void:
	MockBaseService.delayed_call(callback, { "success": true, "characters": _mock_characters.duplicate(true) }, simulate_delay_ms)

## 模拟异步创建角色并写入首个空闲槽位
func create_character_async(account_id: String, request_data: Dictionary, callback: Callable) -> void:
	var char_name: String = str(request_data.get("name", "")).strip_edges()
	if char_name.is_empty():
		MockBaseService.delayed_call(callback, { "success": false, "error_code": "ERR_NAME_EMPTY", "message": "角色名不能为空" }, simulate_delay_ms)
		return

	var new_slot := {
		# 槽位 ID 采用两位定宽补零，避免槽位数 >= 10 时破坏 SLOT_01 格式约定
		"slot_id": "SLOT_%02d" % (_mock_characters.size() + 1),
		"name": char_name,
		"race": str(request_data.get("race", "HUMAN")),
		"class": "Novice",
		"level": 1,
		"town": "VALAN_CAPITAL",
		"empty": false
	}

	# 替换首个空槽位；若无空槽位则追加到列表末尾
	var placed := false
	for slot_index in range(_mock_characters.size()):
		if _mock_characters[slot_index].get("empty", false):
			_mock_characters[slot_index] = new_slot
			placed = true
			break
	if not placed:
		_mock_characters.append(new_slot)

	MockBaseService.delayed_call(callback, { "success": true, "character": new_slot }, simulate_delay_ms)

## 六维资质骰点：确定性 8~18 生成（规则归边界层，视图只消费结果）
func roll_attribute_spread() -> Dictionary:
	return IAuthService.build_preview_attribute_spread()

## 模拟异步触发创角六维资质预览骰点
func roll_attributes_async(callback: Callable) -> void:
	MockBaseService.delayed_call(callback, roll_attribute_spread(), simulate_delay_ms)

## 模拟异步吊销会话令牌
func revoke_token(token: String, callback: Callable = Callable()) -> void:
	if callback.is_valid():
		MockBaseService.delayed_call(callback, { "success": true, "token": token }, simulate_delay_ms)

## 模拟异步退出当前登录账号
func logout_async(account_id: String, token: String, callback: Callable = Callable()) -> void:
	if callback.is_valid():
		MockBaseService.delayed_call(callback, { "success": true, "account_id": account_id }, simulate_delay_ms)

## 模拟异步游客免密快捷登录
func login_guest_async(_device_fingerprint: String = "", callback: Callable = Callable()) -> void:
	if callback.is_valid():
		MockBaseService.delayed_call(callback, {
			"success": true,
			"account_id": "ACC_GUEST_MOCK",
			"username": "ROGUE_MOCK",
			"token": "MOCK_GUEST_TOKEN",
			"is_guest_mode": true
		}, simulate_delay_ms)

## 模拟异步清空指定角色槽位
func clear_slot_async(_account_id: String, _token: String, slot_id: String, callback: Callable = Callable()) -> void:
	if callback.is_valid():
		MockBaseService.delayed_call(callback, {"success": true, "data": {"slot_id": slot_id}}, simulate_delay_ms)

## 模拟异步拉取账号首页展示视图模型
func get_account_home_async(account_id: String, token: String, callback: Callable = Callable(), _locale: String = "") -> void:
	var base_data := MockDataCatalog.get_domain_data("account")
	if callback.is_valid():
		MockBaseService.delayed_call(callback, {
			"success": true,
			"account_id": account_id,
			"view_model": base_data.duplicate(true)
		}, simulate_delay_ms)
