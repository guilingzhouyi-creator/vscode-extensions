# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_account_registration_and_real_reload_pipeline.gd
# 架构定位: Integration Test Pipeline / Real Auth & Slot Reload Harness
# 依赖与触发: 上游: TestRegistry | 下游: AccountEntryView, RealAuthService,
#           AccountRepository, AccountSlotBindingSolver
# 职责说明: 注册页后端校验、原子持久化落盘与二次重载插槽恢复全流程验收流水线。
#           覆盖注册表单边界校验、磁盘文件落盘与哈希脱敏、大小写不敏感重名拦截、
#           登出后二次重载插槽快照恢复以及引擎冷启动物理重载一致性断言。
# 退出语义与设计依据: 注册与持久化恢复规约与卡拉尔世界引擎前后端解耦规范
# ==============================================================================

## TestAccountRegistrationAndRealReloadPipeline：注册页后端校验、原子持久化落盘与二次重载插槽恢复全流程验收流水线。
class_name TestAccountRegistrationAndRealReloadPipeline
extends TestCase

const TEST_ACCOUNTS_DIR: String = "user://test_reload_accounts"
const TEST_ACCOUNTS_PATH: String = TEST_ACCOUNTS_DIR + "/account_registry.json"

## 执行本测试套件全量用例并返回聚合结果字典
static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_arr_01_registration_form_boundary_validation())
	results.append(test_arr_02_registration_physical_persistence_on_disk())
	results.append(test_arr_03_case_insensitive_duplicate_rejection())
	results.append(test_arr_04_secondary_reload_and_slot_snapshot_reinjection())
	results.append(test_arr_05_cold_boot_physical_restoration_from_disk())
	results.append(test_arr_06_creation_response_matches_slot_export())
	_teardown_env()
	return TestCase.pack_results("注册后端校验、持久化与二次重载流水线", results)

static func _setup_env() -> void:
	_teardown_env()
	GameConfig.ensure_loaded()
	ServiceLocator.reset()
	ServiceLocator.set_mode("real")
	AccountRepository.get_instance().set_custom_registry_path(TEST_ACCOUNTS_PATH)

static func _teardown_env() -> void:
	ServiceLocator.reset()
	AuthService.clear_sessions()
	AccountRepository.reset_for_tests()
	_remove_test_dir_recursive(TEST_ACCOUNTS_DIR)

static func _remove_test_dir_recursive(dir_path: String) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		return
	var d := DirAccess.open(dir_path)
	if d == null:
		return
	d.list_dir_begin()
	var fn := d.get_next()
	while not fn.is_empty():
		if fn != "." and fn != "..":
			var sub := dir_path.path_join(fn)
			if d.current_is_dir():
				_remove_test_dir_recursive(sub)
			else:
				DirAccess.remove_absolute(sub)
		fn = d.get_next()
	d.list_dir_end()
	DirAccess.remove_absolute(dir_path)

## TC-ARR-01: 注册表单边界与校验拦截
static func test_arr_01_registration_form_boundary_validation() -> Dictionary:
	_setup_env()
	var view := AccountEntryView.new()
	view.switch_state(AccountEntryView.EntryState.REGISTER)

	# 1. 空用户名拦截
	var res_empty: Dictionary = view.submit_register("", "valid_pass_123")
	var ok_empty: bool = not bool(res_empty.get("success", false)) and str(res_empty.get("error_code", "")) == "ERR_USERNAME_TOO_SHORT"

	# 2. 纯空格用户名拦截
	var res_space: Dictionary = view.submit_register("   ", "valid_pass_123")
	var ok_space: bool = not bool(res_space.get("success", false)) and str(res_space.get("error_code", "")) == "ERR_USERNAME_TOO_SHORT"

	# 3. 长度小于3字符拦截
	var res_short: Dictionary = view.submit_register("ab", "valid_pass_123")
	var err_data: Dictionary = res_short.get("error_data", {})
	var ok_short: bool = not bool(res_short.get("success", false)) and str(res_short.get("error_code", "")) == "ERR_USERNAME_TOO_SHORT" and int(err_data.get("min", 0)) == 3

	# 4. 长度超过24字符拦截 (AuthService 后端拦截)
	var long_name := "A".repeat(25)
	var res_long: Dictionary = view.submit_register(long_name, "valid_pass_123")
	var ok_long: bool = not bool(res_long.get("success", false)) and str(res_long.get("error_code", "")) == "ERR_INVALID_USERNAME_LENGTH"

	# 5. 合法用户名放行并跃迁至创角
	var res_valid: Dictionary = view.submit_register("ValidUser01", "valid_pass_123")
	var ok_valid: bool = bool(res_valid.get("success", false)) \
		and view.current_state == AccountEntryView.EntryState.CHARACTER_CREATE \
		and not view.current_account_id.is_empty()

	view.free()
	_teardown_env()

	var passed: bool = ok_empty and ok_space and ok_short and ok_long and ok_valid
	return TestCase.make_result("TC-ARR-01: 注册表单边界与长度校验拦截", passed, {
		"ok_empty": ok_empty,
		"ok_space": ok_space,
		"ok_short": ok_short,
		"ok_long": ok_long,
		"ok_valid": ok_valid
	})

## TC-ARR-02: 注册原子性与物理持久化落地
static func test_arr_02_registration_physical_persistence_on_disk() -> Dictionary:
	_setup_env()
	var view := AccountEntryView.new()
	view.switch_state(AccountEntryView.EntryState.REGISTER)

	var uname := "PersistMaster"
	var pwd := "SecurePass999"
	var res: Dictionary = view.submit_register(uname, pwd)
	var acc_id := str(res.get("account_id", ""))

	var reg_path := TEST_ACCOUNTS_PATH
	var shard_path := TEST_ACCOUNTS_DIR.path_join("%s.json" % acc_id)

	var reg_exists: bool = FileAccess.file_exists(reg_path)
	var shard_exists: bool = FileAccess.file_exists(shard_path)

	var json_valid: bool = false
	var no_plain_pass: bool = false
	var hash_correct: bool = false
	if shard_exists:
		var f := FileAccess.open(shard_path, FileAccess.READ)
		if f != null:
			var txt := f.get_as_text()
			f.close()
			var parsed = JSON.parse_string(txt)
			if parsed is Dictionary:
				json_valid = str(parsed.get("username", "")) == uname
				var stored_hash: String = str(parsed.get("password_hash_sha256", ""))
				no_plain_pass = not txt.contains(pwd) and not parsed.has("password_plain")
				hash_correct = not stored_hash.is_empty() and stored_hash == AuthService.hash_password(pwd)

	view.free()
	_teardown_env()

	var passed: bool = bool(res.get("success", false)) and reg_exists and shard_exists and json_valid and no_plain_pass and hash_correct
	return TestCase.make_result("TC-ARR-02: 注册原子性与物理文件持久化落地", passed, {
		"reg_exists": reg_exists,
		"shard_exists": shard_exists,
		"json_valid": json_valid,
		"no_plain_pass": no_plain_pass,
		"hash_correct": hash_correct
	})

## TC-ARR-03: 大小写不敏感重名拦截与国际化 key 映射
static func test_arr_03_case_insensitive_duplicate_rejection() -> Dictionary:
	_setup_env()
	var view := AccountEntryView.new()
	view.switch_state(AccountEntryView.EntryState.REGISTER)

	# 首次注册
	var res1: Dictionary = view.submit_register("CaseKnight", "pass_first_123")
	var ok1: bool = bool(res1.get("success", false))

	# 尝试相同小写全名注册
	var res_lower: Dictionary = view.submit_register("caseknight", "pass_second_456")
	var ok_lower: bool = not bool(res_lower.get("success", false)) \
		and str(res_lower.get("error_code", "")) == "ERR_ACCOUNT_ALREADY_EXISTS" \
		and str(res_lower.get("message", "")) == "ui.fe01.register.error_already_exists"

	# 尝试相同大写全名注册
	var res_upper: Dictionary = view.submit_register("CASEKNIGHT", "pass_third_789")
	var ok_upper: bool = not bool(res_upper.get("success", false)) \
		and str(res_upper.get("error_code", "")) == "ERR_ACCOUNT_ALREADY_EXISTS" \
		and str(res_upper.get("message", "")) == "ui.fe01.register.error_already_exists"

	view.free()
	_teardown_env()

	var passed: bool = ok1 and ok_lower and ok_upper
	return TestCase.make_result("TC-ARR-03: 大小写不敏感重名拦截与国际化映射", passed, {
		"ok1": ok1,
		"ok_lower": ok_lower,
		"ok_upper": ok_upper
	})

## TC-ARR-04: 二次重载与角色槽位快照恢复
static func test_arr_04_secondary_reload_and_slot_snapshot_reinjection() -> Dictionary:
	_setup_env()
	var view := AccountEntryView.new()
	view.switch_state(AccountEntryView.EntryState.REGISTER)

	# 1. 注册新账号
	var res_reg: Dictionary = view.submit_register("ReloadHero", "secret123")
	var ok_reg: bool = bool(res_reg.get("success", false))

	# 2. 真实创角落盘
	var create_res: Dictionary = view.create_character("HeroSlayer", "ELF")
	var ok_create: bool = bool(create_res.get("success", false)) \
		and view.character_slots.size() >= 3 \
		and str(view.character_slots[0].get("name", "")) == "HeroSlayer"

	# 3. 注销账号登录态
	var logout_res: Dictionary = view.logout_account()
	var ok_logout: bool = bool(logout_res.get("success", false)) \
		and view.current_session_token.is_empty() \
		and view.current_account_id.is_empty() \
		and view.character_slots.is_empty() \
		and view.current_state == AccountEntryView.EntryState.LOGIN

	# 4. 二次登录（验证二次重载槽位恢复）
	var login_res: Dictionary = view.submit_login("ReloadHero", "secret123")
	var ok_login: bool = bool(login_res.get("success", false)) \
		and view.current_state == AccountEntryView.EntryState.CHARACTER_SELECT

	# 5. 断言恢复的槽位快照
	var slots := view.character_slots
	var ok_slots: bool = slots.size() >= 3
	var ok_slot_0: bool = false
	var ok_slot_1_empty: bool = false
	var ok_slot_2_empty: bool = false

	if ok_slots:
		var s0: Dictionary = slots[0]
		ok_slot_0 = str(s0.get("name", "")) == "HeroSlayer" \
			and str(s0.get("race", "")) == "ELF" \
			and not bool(s0.get("empty", true))
		var s1: Dictionary = slots[1]
		ok_slot_1_empty = bool(s1.get("empty", false))
		var s2: Dictionary = slots[2]
		ok_slot_2_empty = bool(s2.get("empty", false))

	view.free()
	_teardown_env()

	var passed: bool = ok_reg and ok_create and ok_logout and ok_login and ok_slots and ok_slot_0 and ok_slot_1_empty and ok_slot_2_empty
	return TestCase.make_result("TC-ARR-04: 二次重载与角色槽位快照自动恢复", passed, {
		"ok_reg": ok_reg,
		"ok_create": ok_create,
		"ok_logout": ok_logout,
		"ok_login": ok_login,
		"ok_slot_0": ok_slot_0,
		"ok_slot_1_empty": ok_slot_1_empty,
		"ok_slot_2_empty": ok_slot_2_empty
	})

## TC-ARR-05: 物理冷启动重载数据自洽性
static func test_arr_05_cold_boot_physical_restoration_from_disk() -> Dictionary:
	_setup_env()
	var view := AccountEntryView.new()
	view.switch_state(AccountEntryView.EntryState.REGISTER)

	# 注册并创角
	view.submit_register("ColdHero", "cold_pass_321")
	view.create_character("FrostMage", "ELF")
	view.free()

	# 模拟冷启动：内存完全抹除
	ServiceLocator.reset()
	AccountRepository.reset_for_tests()

	# 重新实例化仓储并从物理磁盘加载
	var repo := AccountRepository.get_instance()
	repo.set_custom_registry_path(TEST_ACCOUNTS_PATH)
	var load_res: Dictionary = repo.load_all()
	var load_count: int = int(load_res.get("count", 0))

	var acc := repo.find_by_username("ColdHero")
	var ok_acc: bool = (acc != null) and (acc.username == "ColdHero")
	var ok_slots: bool = false
	if ok_acc:
		var frontend_slots: Array = AccountSlotBindingSolver.to_frontend_character_slots(acc)
		if frontend_slots.size() >= 3:
			var s0: Dictionary = frontend_slots[0]
			ok_slots = str(s0.get("name", "")) == "FrostMage" and not bool(s0.get("empty", true))

	_teardown_env()

	var passed: bool = (load_count >= 1) and ok_acc and ok_slots
	return TestCase.make_result("TC-ARR-05: 物理冷启动重载数据100%还原自洽性", passed, {
		"load_count": load_count,
		"ok_acc": ok_acc,
		"ok_slots": ok_slots
	})

## TC-ARR-06: RealAuthService 创角返回字典与槽位导出单源一致 + 六维预览资质边界断言
static func test_arr_06_creation_response_matches_slot_export() -> Dictionary:
	_setup_env()
	var auth_svc: Variant = ServiceLocator.get_instance().auth()
	var reg_res: Dictionary = {}
	auth_svc.register_async("SchemaParityHero", "ParityPass123", func(r: Dictionary) -> void: reg_res.merge(r, true), true)
	var acc_id: String = str(reg_res.get("account_id", ""))

	var create_res: Dictionary = {}
	auth_svc.create_character_async(acc_id, {"name": "ValenParity", "race": "ELF"}, func(r: Dictionary) -> void: create_res.merge(r, true))
	var created_char: Dictionary = create_res.get("character", {})

	var chars_res: Dictionary = {}
	auth_svc.get_characters_async(acc_id, func(r: Dictionary) -> void: chars_res.merge(r, true))
	var slots: Array = chars_res.get("characters", [])
	var exported_slot: Dictionary = slots[0] if not slots.is_empty() else {}

	var ok_parity: bool = bool(create_res.get("success", false)) \
		and not created_char.is_empty() \
		and str(created_char.get("slot_id", "")) == str(exported_slot.get("slot_id", "")) \
		and str(created_char.get("name", "")) == str(exported_slot.get("name", "")) \
		and str(created_char.get("race", "")) == str(exported_slot.get("race", "")) \
		and str(created_char.get("class", "")) == str(exported_slot.get("class", "")) \
		and int(created_char.get("level", -1)) == int(exported_slot.get("level", -2)) \
		and str(created_char.get("town", "")) == str(exported_slot.get("town", "")) \
		and bool(created_char.get("empty", true)) == false

	var roll_res: Dictionary = auth_svc.roll_attribute_spread()
	var attrs: Dictionary = roll_res.get("attrs", {})
	var ok_attrs: bool = bool(roll_res.get("success", false)) and attrs.size() == 6
	for attr_key in ["STR", "AGI", "CON", "INT", "WIS", "CHA"]:
		var val: int = int(attrs.get(attr_key, 0))
		if val < 8 or val > 18:
			ok_attrs = false

	_teardown_env()
	var passed: bool = ok_parity and ok_attrs
	return TestCase.make_result("TC-ARR-06: 创角返回值与槽位导出单源一致及六维预览资质断言", passed, {
		"ok_parity": ok_parity,
		"ok_attrs": ok_attrs
	})
