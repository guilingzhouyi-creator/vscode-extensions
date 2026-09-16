# ==============================================================================
# 单元测试：领域 14 账户身份与多存档槽位管理 (Account Domain Tests)
# 文件路径: res://tests/unit/domains/test_account.gd
# ==============================================================================
class_name TestAccountDomain extends RefCounted

const AccountProfileAggregate = preload("res://backend/domains/account/account_profile.gd")
const AuthService = preload("res://backend/domains/account/auth_service.gd")
const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_guest_account_creation())
	results.append(test_save_slot_isolation())
	results.append(test_local_auth_authentication())
	results.append(test_slot_binding_and_next_available())
	results.append(test_device_fingerprint_mismatch())
	results.append(test_character_creation_in_slot())
	results.append(test_entitlements_round_trip())
	results.append(test_entitlements_seal_tamper())
	# Phase 43 N10 新增：会话有界化（TC-P43-S4-06，过期优先清理）
	results.append(test_session_cap_pruning())
	# R-02（TC-ACC-09）：盐重铸三态
	results.append(test_salt_rehash_migration())

	var all_passed: bool = true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return {"domain": "Domain 14: 账户身份与多存档槽位", "all_passed": all_passed, "results": results}

static func test_guest_account_creation() -> Dictionary:
	var acc := AuthService.create_guest_account("DEVICE_TEST_FP")
	var passed: bool = acc.is_guest_mode and (acc.local_device_fingerprint == "DEVICE_TEST_FP")
	return {"test": "TC-ACC-01: 游客离线账户创建与设备指纹绑定", "passed": passed}

static func test_save_slot_isolation() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	var slot1 := SaveSlotSummaryDTO.new()
	slot1.slot_id = "SLOT_01"
	slot1.character_name = "战士艾伦"
	slot1.is_permadeath_mode = false

	var slot2 := SaveSlotSummaryDTO.new()
	slot2.slot_id = "SLOT_02"
	slot2.character_name = "法师甘道夫"
	slot2.is_permadeath_mode = true

	acc.add_slot_summary(slot1)
	acc.add_slot_summary(slot2)

	var passed: bool = (acc.get_summary_by_slot("SLOT_01").character_name == "战士艾伦") and acc.get_summary_by_slot("SLOT_02").is_permadeath_mode
	return {"test": "TC-ACC-02: 多角色插槽元数据独立隔离与死斗标记", "passed": passed}

static func test_local_auth_authentication() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_001"
	acc.username = "Arthur"
	acc.password_hash_sha256 = AuthService.hash_password("Excalibur123")

	var auth_ok := AuthService.authenticate_local("Arthur", "Excalibur123", acc)
	var auth_fail := AuthService.authenticate_local("Arthur", "WrongPass", acc)
	var passed: bool = auth_ok.success and (not auth_fail.success) and (auth_ok.token != "")
	return {"test": "TC-ACC-03: 本地加盐哈希鉴权与会话Token签发", "passed": passed}

static func test_slot_binding_and_next_available() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	var dto1 := SaveSlotSummaryDTO.new()
	dto1.character_name = "游侠A"
	var res1 := acc.bind_character_to_slot("SLOT_01", dto1)
	var next_id := acc.get_next_available_slot_id()
	var occupied := acc.is_slot_occupied("SLOT_01")
	var empty_check := acc.get_summary_by_slot("") == null
	var passed: bool = res1.success and next_id == "SLOT_02" and occupied and empty_check and acc.active_slot_id == "SLOT_01"
	return {"test": "TC-ACC-04: 槽位绑定幂等与空槽推算", "passed": passed}

static func test_device_fingerprint_mismatch() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_002"
	acc.username = "Lancelot"
	acc.password_hash_sha256 = AuthService.hash_password("Camelot123")
	acc.local_device_fingerprint = "FP_A"
	var ok_same := AuthService.authenticate_local("Lancelot", "Camelot123", acc, "FP_A")
	var fail_diff := AuthService.authenticate_local("Lancelot", "Camelot123", acc, "FP_B")
	var ttl_ok := AuthService.is_token_valid(int(Time.get_unix_time_from_system()) - 100)
	var ttl_expired := not AuthService.is_token_valid(int(Time.get_unix_time_from_system()) - 90000)
	var passed: bool = ok_same.success and not fail_diff.success and ttl_ok and ttl_expired
	return {"test": "TC-ACC-05: 设备指纹强校验与Token时效", "passed": passed}

static func test_entitlements_round_trip() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_ROUND"
	acc.entitlements.append("TIER_PREMIUM")
	acc.entitlements.append("SEASON_2026")
	var restored := AccountProfileAggregate.deserialize(acc.serialize())
	var passed: bool = restored != null \
		and restored.entitlements.has("TIER_PREMIUM") \
		and restored.entitlements.has("SEASON_2026") \
		and restored.entitlements.size() == 2
	return {"test": "TC-ACC-07: entitlements 非空序列化往返（类型化数组兼容）", "passed": passed}

static func test_entitlements_seal_tamper() -> Dictionary:
	# P39 清单 6：密封密钥经环境供给——测试显式注入受控测试密钥（缺钥即失败关闭）
	OS.set_environment("KALAR_ENTITLEMENT_KEY", "test-seal-key-v1")
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_SEAL"
	acc.entitlements.append("TIER_PREMIUM")
	var saved := acc.serialize()
	# 篡改存档：追加未授权资格 → 密封重算不符 → 权限回退空（fail-safe）
	saved["entitlements"] = ["TIER_PREMIUM", "EVIL_GRANT"]
	var restored := AccountProfileAggregate.deserialize(saved)
	var passed: bool = restored != null and restored.entitlements.is_empty()
	return {"test": "TC-ACC-08: entitlements 存档密封防篡改（改档即回退空）", "passed": passed}

static func test_character_creation_in_slot() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_003"
	var res := AccountSlotBindingSolver.create_character_in_slot(acc, "SLOT_01", "阿尔托莉雅", "见习冒险者", false)
	var quick := AccountSlotBindingSolver.quick_create_in_next_slot(acc, "莫德雷德")
	var clear := AccountSlotBindingSolver.clear_slot(acc, "SLOT_01")
	var passed: bool = res.success and quick.success and quick.slot_id == "SLOT_02" and clear.success and not acc.is_slot_occupied("SLOT_01")
	return {"test": "TC-ACC-06: 创建角色第一步槽位落盘与快建/清理", "passed": passed}

## Phase 43 N10（TC-P43-S4-06）：会话有界化——签发超 session/max_entries 会话后
## 容器尺寸 ≤ 上限；过期条目先于有效条目被清理（过期优先裁剪语义）。
static func test_session_cap_pruning() -> Dictionary:
	AuthService.clear_sessions()
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_CAP"
	acc.username = "CapUser"
	acc.password_hash_sha256 = AuthService.hash_password("CapPass123")
	var max_entries := maxi(1, GameConfig.get_int("infrastructure.admin", "session/max_entries", 1000))
	# 注入 max_entries + 5 条会话（签发路径自动触发 _prune_sessions）
	var last_token := ""
	for i in range(max_entries + 5):
		var res := AuthService.authenticate_local("CapUser", "CapPass123", acc)
		if res.get("success", false):
			last_token = str(res.get("token", ""))
	var cap_ok: bool = AuthService._sessions.size() <= max_entries
	# 过期优先：将最新会话标记过期，再签发触发 prune → 过期条目被清、容器不涨
	var expired_ok := false
	if cap_ok and not last_token.is_empty():
		var key := last_token.sha256_text()
		if AuthService._sessions.has(key):
			AuthService._sessions[key]["expires_at"] = 1
			var size_before: int = AuthService._sessions.size()
			var trigger := AuthService.authenticate_local("CapUser", "CapPass123", acc)
			expired_ok = trigger.get("success", false) \
				and not AuthService._sessions.has(key) \
				and AuthService._sessions.size() <= max_entries \
				and AuthService._sessions.size() <= size_before
	var passed = cap_ok and expired_ok
	return {
		"test": "TC-P43-S4-06: 会话有界化（≤max_entries，过期条目优先清理）",
		"passed": passed,
		"max_entries": max_entries,
		"size": AuthService._sessions.size()
	}


## Phase 85 R-02（TC-P85-S4-03）：盐重铸三态——空盐档登录重铸/重铸后新盐校验/错口令拒绝。
static func test_salt_rehash_migration() -> Dictionary:
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_REHASH"
	acc.username = "RehashUser"
	acc.salt_version = 0
	acc.password_hash_sha256 = "RehashPass123".sha256_text()
	var r1 := AuthService.authenticate_local("RehashUser", "RehashPass123", acc)
	var rehashed_ok: bool = r1.get("success", false) 		and r1.get("rehashed", false) == true 		and acc.salt_version == 1 		and acc.password_hash_sha256 == AuthService.hash_password("RehashPass123")
	var r2 := AuthService.authenticate_local("RehashUser", "RehashPass123", acc)
	var new_salt_ok: bool = r2.get("success", false) and r2.get("rehashed", true) == false
	var bad_new: bool = not AuthService.authenticate_local("RehashUser", "WrongPass", acc).get("success", true)
	var legacy_acc := AccountProfileAggregate.new()
	legacy_acc.account_id = "ACC_REHASH_B"
	legacy_acc.username = "RehashUserB"
	legacy_acc.salt_version = 0
	legacy_acc.password_hash_sha256 = "RightPass".sha256_text()
	var bad_legacy: bool = not AuthService.authenticate_local("RehashUserB", "WrongPass", legacy_acc).get("success", true)
	var passed: bool = rehashed_ok and new_salt_ok and bad_new and bad_legacy
	return {
		"test": "TC-ACC-09: 盐重铸三态（空盐档重铸/新盐校验/错口令拒绝）",
		"passed": passed,
		"salt_version_after": acc.salt_version
	}
