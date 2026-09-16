# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端错误域与 Mock 夹具验收套件
# 文件路径: res://tests/unit/frontend/test_frontend_error_domain.gd
# 职责: 验收错误码同域 ERR_*、槽位两位定宽、Mock 夹具可证伪与单例可重置
# ==============================================================================
class_name TestFrontendErrorDomain
extends TestCase

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_error_code_domain_unified())
	results.append(_test_slot_id_two_digit())
	results.append(_test_mock_catalog_falsifiable())
	results.append(_test_singleton_reset())
	return TestCase.pack_results("frontend_error_domain", results)

## R-12：mock 侧错误码前缀同域 ERR_*（经 0ms 同步回调注入，反例可证伪）
static func _test_error_code_domain_unified() -> Dictionary:
	var auth := MockAuthService.new(0)
	var login_sink: Array = []
	auth.login_async("", "", func(r: Dictionary) -> void: login_sink.append(r))
	var code_login := ""
	if not login_sink.is_empty():
		code_login = str((login_sink[0] as Dictionary).get("error_code", ""))
	var name_sink: Array = []
	auth.create_character_async("acc", {"name": ""}, func(r: Dictionary) -> void: name_sink.append(r))
	var code_name := ""
	if not name_sink.is_empty():
		code_name = str((name_sink[0] as Dictionary).get("error_code", ""))
	var ok := TestCase.assert_true(code_login.begins_with("ERR_"), "登录错误码前缀 ERR_: %s" % code_login)
	ok = ok and TestCase.assert_true(code_name.begins_with("ERR_"), "角色名错误码前缀 ERR_: %s" % code_name)
	return TestCase.make_result("error_code_domain_unified", ok, {"login_code": code_login, "name_code": code_name})

## R-11：槽位 ID 两位定宽（槽位 ≥10 不破 SLOT_01 格式）
static func _test_slot_id_two_digit() -> Dictionary:
	var auth := MockAuthService.new(0)
	for i in range(10):
		auth.create_character_async("acc_%d" % i, {"name": "Hero%d" % i}, func(_r: Dictionary) -> void: pass)
	var re := RegEx.new()
	re.compile("^SLOT_[0-9]{2,}$")
	var offenders: Array[String] = []
	for c in auth._mock_characters:
		var sid := str((c as Dictionary).get("slot_id", ""))
		if re.search(sid) == null:
			offenders.append(sid)
	var ok := TestCase.assert_eq(offenders.size(), 0, "槽位 ID 两位定宽: %s" % str(offenders))
	return TestCase.make_result("slot_id_two_digit", ok, {"offenders": offenders})

## R-25：未登记域 / EMPTY 夹具返回空，使「非空」断言恢复可证伪；真实域仍完整
static func _test_mock_catalog_falsifiable() -> Dictionary:
	var unknown := MockDataCatalog.get_domain_data("__unregistered__")
	var ok := TestCase.assert_true(unknown.is_empty(), "未登记域返回空, 非空断言可证伪")
	var empty_fx := MockDataCatalog.get_domain_data("empty_sample")
	ok = ok and TestCase.assert_true(empty_fx.is_empty(), "EMPTY 夹具可证伪")
	var extreme_fx := MockDataCatalog.get_domain_data("extreme_sample")
	ok = ok and TestCase.assert_gt(extreme_fx.size(), 0, "极值夹具非空")
	ok = ok and TestCase.assert_has_key(extreme_fx, "amount", "极值夹具含边界键")
	var account := MockDataCatalog.get_domain_data("account")
	ok = ok and TestCase.assert_gt(account.size(), 0, "真实域仍返回完整数据集")
	return TestCase.make_result("mock_catalog_falsifiable", ok)

## R-26：Mock 单例 / 角色集可重置，用例零残留
static func _test_singleton_reset() -> Dictionary:
	var first := MockServiceContainer.get_instance()
	var ok := TestCase.assert_not_null(first, "容器单例可构造")
	var auth := MockAuthService.new(0)
	auth.create_character_async("acc", {"name": "HeroA"}, func(_r: Dictionary) -> void: pass)
	auth.create_character_async("acc", {"name": "HeroB"}, func(_r: Dictionary) -> void: pass)
	var grown := auth._mock_characters.size()
	auth.reset_instance()
	ok = ok and TestCase.assert_eq(grown, 4, "构造期角色集已扩充至 4")
	ok = ok and TestCase.assert_eq(auth._mock_characters.size(), 3, "MockAuthService.reset_instance 复位至基线 3")
	MockServiceContainer.reset_instance()
	ok = ok and TestCase.assert_null(MockServiceContainer._instance, "MockServiceContainer 单例已重置")
	return TestCase.make_result("singleton_reset", ok)
