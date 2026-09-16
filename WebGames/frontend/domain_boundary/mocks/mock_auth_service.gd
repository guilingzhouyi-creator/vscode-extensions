# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟认证服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_auth_service.gd
# 职责: 模拟账号认证/选服/角色数据，支持登录全流程调用，经 MockBaseService 模拟 200ms 网络延迟
# ==============================================================================
class_name MockAuthService
extends IAuthService

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS
var _mock_characters: Array = []

## R-26：复位模拟角色集与延迟配置到基线，供测试 teardown / 用例隔离（杜绝脏角色与延迟参数跨用例残留）
func reset_instance() -> void:
	simulate_delay_ms = MockBaseService.DEFAULT_SIMULATE_DELAY_MS
	var base_data := MockDataCatalog.get_domain_data("account")
	_mock_characters = (base_data.get("character_slots", []) as Array).duplicate(true)

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms
	var base_data := MockDataCatalog.get_domain_data("account")
	_mock_characters = (base_data.get("character_slots", []) as Array).duplicate(true)

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

func register_async(username: String, password_plain: String, callback: Callable) -> void:
	if username.is_empty() or password_plain.is_empty():
		MockBaseService.delayed_call(callback, { "success": false, "error_code": "ERR_PARAM_INVALID", "message": "账号或密码不能为空" }, simulate_delay_ms)
		return
	MockBaseService.delayed_call(callback, {
		"success": true,
		"account_id": "ACC_MOCK_NEW",
		"username": username
	}, simulate_delay_ms)

func get_servers_async(callback: Callable) -> void:
	var base_data := MockDataCatalog.get_domain_data("account")
	var servers: Array = base_data.get("default_servers", [])
	MockBaseService.delayed_call(callback, { "success": true, "servers": servers.duplicate(true) }, simulate_delay_ms)

func get_characters_async(account_id: String, callback: Callable) -> void:
	MockBaseService.delayed_call(callback, { "success": true, "characters": _mock_characters.duplicate(true) }, simulate_delay_ms)

func create_character_async(account_id: String, req_data: Dictionary, callback: Callable) -> void:
	var char_name: String = str(req_data.get("name", "")).strip_edges()
	if char_name.is_empty():
		MockBaseService.delayed_call(callback, { "success": false, "error_code": "ERR_NAME_EMPTY", "message": "角色名不能为空" }, simulate_delay_ms)
		return

	var new_slot := {
		# R-11：槽位 ID 两位定宽补零，槽位 ≥10 时不再破 SLOT_01 格式
		"slot_id": "SLOT_%02d" % (_mock_characters.size() + 1),
		"name": char_name,
		"race": str(req_data.get("race", "HUMAN")),
		"class": "Novice",
		"level": 1,
		"town": "VALAN_CAPITAL",
		"empty": false
	}

	# 替换首个空槽位后追加
	var placed := false
	for i in range(_mock_characters.size()):
		if _mock_characters[i].get("empty", false):
			_mock_characters[i] = new_slot
			placed = true
			break
	if not placed:
		_mock_characters.append(new_slot)

	MockBaseService.delayed_call(callback, { "success": true, "character": new_slot }, simulate_delay_ms)

## 六维资质骰点：确定性 8~18 生成（规则归边界层，视图只消费结果）
func roll_attribute_spread() -> Dictionary:
	var rng := DeterministicRNG.global()
	return {
		"success": true,
		"attrs": {
			"STR": rng.randi_range(8, 18),
			"AGI": rng.randi_range(8, 18),
			"CON": rng.randi_range(8, 18),
			"INT": rng.randi_range(8, 18),
			"WIS": rng.randi_range(8, 18),
			"CHA": rng.randi_range(8, 18),
		}
	}