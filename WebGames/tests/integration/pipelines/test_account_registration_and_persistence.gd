# ==============================================================================
# 模块归属: 测试框架层 (Tests · 集成测试流水线 (Integration Pipelines))
# 文件路径: res://tests/integration/pipelines/test_account_registration_and_persistence.gd
# 架构定位: Integration Pipeline Test Suite
# 跨域依赖: 上游: AuthService, AccountRepository | 下游: TestCase, AccountProfileAggregate
# 职责说明: 覆盖账号标准注册物理落盘、冷启动恢复自愈、大小写不敏感查重拦截、复合鉴权自动注册并持久化、历史空盐重铸在持久化仓储中的原子更新以及账号删除与双层索引清理全生命周期断言。
# 设计依据: 业务域第一性原理 / 账号物理仓储与持久化落盘引擎规范
# ==============================================================================

class_name TestAccountRegistrationAndPersistence
extends TestCase


static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_tc_arp_01_registration_and_persistence_roundtrip())
	results.append(test_tc_arp_02_memory_reset_and_cold_boot_restore())
	results.append(test_tc_arp_03_duplicate_rejection_and_case_insensitive())
	results.append(test_tc_arp_04_composite_auth_auto_registration())
	results.append(test_tc_arp_05_legacy_salt_rehash_atomic_persistence())
	results.append(test_tc_arp_06_account_deletion_and_index_cleanup())

	_teardown_all_test_artifacts()
	return TestCase.pack_results("账号注册与物理持久化流水线", results)

static func _teardown_all_test_artifacts() -> void:
	var repo := AccountRepository.get_instance()
	var test_usernames: Array[String] = [
		"PersistHero01",
		"ColdBootHero",
		"CaseHero",
		"AutoCompositeHero",
		"LegacyUser05",
		"UserToDelete06"
	]
	for uname in test_usernames:
		var acc := repo.find_by_username(uname)
		if acc != null:
			repo.delete_account(acc.account_id)
	var legacy_acc := repo.find_by_id("ACC_LEGACY_05")
	if legacy_acc != null:
		repo.delete_account(legacy_acc.account_id)
	AccountRepository.reset_for_tests()

## TC-ARP-01: 账号标准注册与物理落盘加载一致性断言
static func test_tc_arp_01_registration_and_persistence_roundtrip() -> Dictionary:
	var repo := AccountRepository.get_instance()
	var uname := "PersistHero01"
	var pass := "ValidPass123"

	var existing := repo.find_by_username(uname)
	if existing != null:
		repo.delete_account(existing.account_id)

	var req := AccountRegistrationDTO.Request.new()
	req.username = uname
	req.password_plain = pass
	req.device_fingerprint = "FP_ARP_01"

	var resp := AuthService.register_account(req)
	if not resp.success or resp.account_id.is_empty():
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "register_account failed"})

	if not repo.has_account(resp.account_id):
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "repo missing account_id"})

	if not repo.has_username(uname):
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "repo missing username"})

	var cached := repo.find_by_id(resp.account_id)
	if cached == null or cached.username != uname:
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "cached aggregate mismatch"})

	var expected_hash := AuthService.hash_password(pass)
	if cached.password_hash_sha256 != expected_hash:
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "hash mismatch"})

	var shard_path := repo.get_account_shard_path(resp.account_id)
	if not FileAccess.file_exists(shard_path):
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "shard file missing on disk"})

	var reg_path := repo.get_registry_file_path()
	if not FileAccess.file_exists(reg_path):
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "registry file missing on disk"})

	var f := FileAccess.open(shard_path, FileAccess.READ)
	if f == null:
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "cannot open shard file"})
	var shard_text := f.get_as_text()
	f.close()

	var json := JSON.new()
	if json.parse(shard_text) != OK:
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "shard json parse failed"})

	var raw_data: Variant = json.get_data()
	var shard_dict: Dictionary = raw_data if raw_data is Dictionary else {}
	if shard_dict.get("account_id", "") != resp.account_id or shard_dict.get("username", "") != uname:
		return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", false, {"reason": "shard json data mismatch"})

	return TestCase.make_result("TC-ARP-01: 账号标准注册与物理落盘加载一致性断言", true)

## TC-ARP-02: 内存仓储重置与冷启动后磁盘加载自愈（模拟重启恢复）
static func test_tc_arp_02_memory_reset_and_cold_boot_restore() -> Dictionary:
	var repo := AccountRepository.get_instance()
	var uname := "ColdBootHero"
	var pass := "ColdPass456"

	var existing := repo.find_by_username(uname)
	if existing != null:
		repo.delete_account(existing.account_id)

	var req := AccountRegistrationDTO.Request.new()
	req.username = uname
	req.password_plain = pass
	var reg_resp := AuthService.register_account(req)
	if not reg_resp.success:
		return TestCase.make_result("TC-ARP-02: 内存仓储重置与冷启动后磁盘加载自愈（模拟重启恢复）", false, {"reason": "registration failed"})

	var original_id := reg_resp.account_id
	var original_hash := AuthService.hash_password(pass)

	# 模拟冷启动重置：清空内存缓存与单例
	AccountRepository.reset_for_tests()
	var cold_repo := AccountRepository.get_instance()
	if cold_repo.get_account_count() != 0:
		return TestCase.make_result("TC-ARP-02: 内存仓储重置与冷启动后磁盘加载自愈（模拟重启恢复）", false, {"reason": "reset failed"})

	var load_res: Dictionary = cold_repo.load_all()
	if not bool(load_res.get("success", false)):
		return TestCase.make_result("TC-ARP-02: 内存仓储重置与冷启动后磁盘加载自愈（模拟重启恢复）", false, {"reason": "load_all failed"})

	if not cold_repo.has_account(original_id):
		return TestCase.make_result("TC-ARP-02: 内存仓储重置与冷启动后磁盘加载自愈（模拟重启恢复）", false, {"reason": "account not restored"})

	var restored := cold_repo.find_by_id(original_id)
	if restored == null or restored.username != uname:
		return TestCase.make_result("TC-ARP-02: 内存仓储重置与冷启动后磁盘加载自愈（模拟重启恢复）", false, {"reason": "restored username mismatch"})

	if restored.password_hash_sha256 != original_hash or restored.salt_version != 1:
		return TestCase.make_result("TC-ARP-02: 内存仓储重置与冷启动后磁盘加载自愈（模拟重启恢复）", false, {"reason": "restored credentials mismatch"})

	return TestCase.make_result("TC-ARP-02: 内存仓储重置与冷启动后磁盘加载自愈（模拟重启恢复）", true)

## TC-ARP-03: 重名冲突拦截与不区分大小写检索
static func test_tc_arp_03_duplicate_rejection_and_case_insensitive() -> Dictionary:
	var repo := AccountRepository.get_instance()
	var uname := "CaseHero"
	var pass := "Pass12345"

	var existing := repo.find_by_username(uname)
	if existing != null:
		repo.delete_account(existing.account_id)

	var req := AccountRegistrationDTO.Request.new()
	req.username = uname
	req.password_plain = pass
	var reg_resp := AuthService.register_account(req)
	if not reg_resp.success:
		return TestCase.make_result("TC-ARP-03: 重名冲突拦截与不区分大小写检索", false, {"reason": "initial registration failed"})

	# 小写重名注册拦截
	var req_lower := AccountRegistrationDTO.Request.new()
	req_lower.username = "casehero"
	req_lower.password_plain = "OtherPass1"
	var resp_lower := AuthService.register_account(req_lower)
	if resp_lower.success or resp_lower.error_code != "ERR_ACCOUNT_ALREADY_EXISTS":
		return TestCase.make_result("TC-ARP-03: 重名冲突拦截与不区分大小写检索", false, {"reason": "lowercase duplicate not rejected"})

	# 大写重名注册拦截
	var req_upper := AccountRegistrationDTO.Request.new()
	req_upper.username = "CASEHERO"
	req_upper.password_plain = "OtherPass2"
	var resp_upper := AuthService.register_account(req_upper)
	if resp_upper.success or resp_upper.error_code != "ERR_ACCOUNT_ALREADY_EXISTS":
		return TestCase.make_result("TC-ARP-03: 重名冲突拦截与不区分大小写检索", false, {"reason": "uppercase duplicate not rejected"})

	# 仓储大小写不敏感检索
	if not repo.has_username("casehero") or not repo.has_username("CASEHERO"):
		return TestCase.make_result("TC-ARP-03: 重名冲突拦截与不区分大小写检索", false, {"reason": "has_username case sensitivity error"})

	var found_lower := repo.find_by_username("casehero")
	var found_upper := repo.find_by_username("CASEHERO")
	if found_lower == null or found_upper == null or found_lower.account_id != reg_resp.account_id:
		return TestCase.make_result("TC-ARP-03: 重名冲突拦截与不区分大小写检索", false, {"reason": "find_by_username case mismatch"})

	return TestCase.make_result("TC-ARP-03: 重名冲突拦截与不区分大小写检索", true)

## TC-ARP-04: 复合鉴权自动注册并持久化
static func test_tc_arp_04_composite_auth_auto_registration() -> Dictionary:
	var repo := AccountRepository.get_instance()
	var uname := "AutoCompositeHero"
	var pass := "AutoPass789"

	var existing := repo.find_by_username(uname)
	if existing != null:
		repo.delete_account(existing.account_id)

	var comp_req := AccountCompositeAuthDTO.Request.new()
	comp_req.username = uname
	comp_req.password_plain = pass
	comp_req.action_mode = AccountCompositeAuthDTO.MODE_AUTO

	var comp_resp := AuthService.composite_authenticate(comp_req)
	if not comp_resp.success or not comp_resp.is_new_registration:
		return TestCase.make_result("TC-ARP-04: 复合鉴权自动注册并持久化", false, {"reason": "composite registration failed"})

	if comp_resp.session_token.is_empty():
		return TestCase.make_result("TC-ARP-04: 复合鉴权自动注册并持久化", false, {"reason": "session token is empty"})

	if not repo.has_account(comp_resp.account_id) or not repo.has_username(uname):
		return TestCase.make_result("TC-ARP-04: 复合鉴权自动注册并持久化", false, {"reason": "repository missing auto registered account"})

	var shard_path := repo.get_account_shard_path(comp_resp.account_id)
	if not FileAccess.file_exists(shard_path):
		return TestCase.make_result("TC-ARP-04: 复合鉴权自动注册并持久化", false, {"reason": "auto registered shard missing"})

	# 纯登录二次验证
	var login_req := AccountCompositeAuthDTO.Request.new()
	login_req.username = uname
	login_req.password_plain = pass
	login_req.action_mode = AccountCompositeAuthDTO.MODE_LOGIN_ONLY
	var login_resp := AuthService.composite_authenticate(login_req)
	if not login_resp.success or login_resp.is_new_registration or login_resp.account_id != comp_resp.account_id:
		return TestCase.make_result("TC-ARP-04: 复合鉴权自动注册并持久化", false, {"reason": "subsequent login failed"})

	return TestCase.make_result("TC-ARP-04: 复合鉴权自动注册并持久化", true)

## TC-ARP-05: 历史空盐重铸在持久化仓储中的原子更新
static func test_tc_arp_05_legacy_salt_rehash_atomic_persistence() -> Dictionary:
	var repo := AccountRepository.get_instance()
	var legacy_id := "ACC_LEGACY_05"
	var legacy_uname := "LegacyUser05"
	var legacy_pass := "LegacyPass05"

	var existing := repo.find_by_id(legacy_id)
	if existing != null:
		repo.delete_account(legacy_id)

	var legacy_acc := AccountProfileAggregate.new()
	legacy_acc.account_id = legacy_id
	legacy_acc.username = legacy_uname
	legacy_acc.password_hash_sha256 = legacy_pass.sha256_text()
	legacy_acc.salt_version = 0
	legacy_acc.is_guest_mode = false

	var save_res: Dictionary = repo.save_account(legacy_acc)
	if not bool(save_res.get("success", false)):
		return TestCase.make_result("TC-ARP-05: 历史空盐重铸在持久化仓储中的原子更新", false, {"reason": "legacy account save failed"})

	var auth_res: Dictionary = AuthService.authenticate_local(legacy_uname, legacy_pass, legacy_acc)
	if not bool(auth_res.get("success", false)) or not bool(auth_res.get("rehashed", false)):
		return TestCase.make_result("TC-ARP-05: 历史空盐重铸在持久化仓储中的原子更新", false, {"reason": "rehash authenticate failed"})

	if legacy_acc.salt_version != 1 or legacy_acc.password_hash_sha256 != AuthService.hash_password(legacy_pass):
		return TestCase.make_result("TC-ARP-05: 历史空盐重铸在持久化仓储中的原子更新", false, {"reason": "in-memory salt version not upgraded"})

	# 冷启动验证磁盘数据已被原子同步更新
	AccountRepository.reset_for_tests()
	var fresh_repo := AccountRepository.get_instance()
	fresh_repo.load_all()

	var disk_acc := fresh_repo.find_by_id(legacy_id)
	if disk_acc == null:
		return TestCase.make_result("TC-ARP-05: 历史空盐重铸在持久化仓储中的原子更新", false, {"reason": "legacy account missing after cold boot"})

	if disk_acc.salt_version != 1 or disk_acc.password_hash_sha256 != AuthService.hash_password(legacy_pass):
		return TestCase.make_result("TC-ARP-05: 历史空盐重铸在持久化仓储中的原子更新", false, {"reason": "disk salt version not upgraded"})

	return TestCase.make_result("TC-ARP-05: 历史空盐重铸在持久化仓储中的原子更新", true)

## TC-ARP-06: 账号删除与索引清理
static func test_tc_arp_06_account_deletion_and_index_cleanup() -> Dictionary:
	var repo := AccountRepository.get_instance()
	var uname := "UserToDelete06"
	var pass := "DelPass123"

	var existing := repo.find_by_username(uname)
	if existing != null:
		repo.delete_account(existing.account_id)

	var req := AccountRegistrationDTO.Request.new()
	req.username = uname
	req.password_plain = pass
	var reg_resp := AuthService.register_account(req)
	if not reg_resp.success:
		return TestCase.make_result("TC-ARP-06: 账号删除与索引清理", false, {"reason": "registration failed"})

	var acc_id := reg_resp.account_id
	var shard_path := repo.get_account_shard_path(acc_id)
	if not FileAccess.file_exists(shard_path):
		return TestCase.make_result("TC-ARP-06: 账号删除与索引清理", false, {"reason": "shard missing before delete"})

	var del_ok := repo.delete_account(acc_id)
	if not del_ok:
		return TestCase.make_result("TC-ARP-06: 账号删除与索引清理", false, {"reason": "delete_account returned false"})

	if repo.has_account(acc_id) or repo.has_username(uname):
		return TestCase.make_result("TC-ARP-06: 账号删除与索引清理", false, {"reason": "account still exists in cache"})

	if repo.find_by_id(acc_id) != null or repo.find_by_username(uname) != null:
		return TestCase.make_result("TC-ARP-06: 账号删除与索引清理", false, {"reason": "account still findable in cache"})

	if FileAccess.file_exists(shard_path):
		return TestCase.make_result("TC-ARP-06: 账号删除与索引清理", false, {"reason": "shard still exists on disk"})

	# 冷启动验证已彻底清除
	AccountRepository.reset_for_tests()
	var clean_repo := AccountRepository.get_instance()
	clean_repo.load_all()

	if clean_repo.has_account(acc_id) or clean_repo.has_username(uname):
		return TestCase.make_result("TC-ARP-06: 账号删除与索引清理", false, {"reason": "deleted account reappeared after reload"})

	return TestCase.make_result("TC-ARP-06: 账号删除与索引清理", true)
