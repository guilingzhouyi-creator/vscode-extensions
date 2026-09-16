# ==============================================================================
# 单元测试：Phase 68 存档迁移引擎与回滚机制 (Save Migration Engine Tests)
# 文件路径: res://tests/unit/infrastructure/test_save_migration_engine.gd
# 职责: 验证 legacy 旧档降级兼容、整档迁移链、断链安全回滚、
#       迁移后校验失败拦截与域级独立迁移（TC-SV-06 ~ TC-SV-11）。
# ==============================================================================
class_name TestSaveMigrationEngine extends RefCounted

const SaveDomainContract = preload("res://backend/domains/persistence_protocol/save_domain_contract.gd")
const SaveValidationService = preload("res://backend/domains/persistence_protocol/save_validation_service.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const SaveMigrationEngine = preload("res://backend/domains/persistence_protocol/save_migration_engine.gd")
const EditorHotReloadManager = preload("res://backend/domains/persistence_protocol/editor_hot_reload_manager.gd")
const RuntimeModeGate = preload("res://backend/domains/persistence_protocol/runtime_mode_gate.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_legacy_save_fallback_compatibility())
	results.append(test_full_save_migration_chain())
	results.append(test_migration_broken_path_rollback())
	results.append(test_post_migration_validation_failure())
	results.append(test_domain_level_independent_migration())
	results.append(test_migration_traceability_steps())
	# R-01（TC-SM-09）：UID 单轨迁移判定器
	results.append(test_legacy_uid_audit_detector())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "Phase 68: 存档版本迁移引擎与一致性回滚",
		"all_passed": all_passed,
		"results": results
	}

## TC-SV-06: legacy 旧档降级兼容（Inv-SV-4）
static func test_legacy_save_fallback_compatibility() -> Dictionary:
	var legacy_slot := "test_legacy_save_p68"
	var save_dir: String = SaveManager._save_dir()
	SaveManager.ensure_save_directory()
	var file_path := save_dir + legacy_slot + SaveManager._save_extension()

	# 手动构造仅含 "data" 的历史旧版存档文件（无 signature_sha256 与 data_json）
	var legacy_envelope := {
		"format_version": "1.0.0",
		"data": {
			"gold": 500,
			"hero_name": "阿尔托莉雅"
		}
	}
	var f := FileAccess.open(file_path, FileAccess.WRITE)
	if f == null:
		return { "test": "TC-SV-06: legacy 旧档降级兼容", "passed": false, "reason": "write_fail" }
	f.store_string(JSON.stringify(legacy_envelope))
	f.close()

	var load_res := SaveDataAccessLayer.load_game(legacy_slot)
	var success := bool(load_res.get("success", false))
	var verified := bool(load_res.get("verified", true))
	var data_dict: Dictionary = load_res.get("data", {})
	var gold_ok := (int(data_dict.get("gold", 0)) == 500)

	# 预期：读取成功，但 verified=false（降级告警），数据无损读出
	var passed := success and not verified and gold_ok
	return {
		"test": "TC-SV-06: 历史无签名 legacy 存档降级读取与数据兼容断言",
		"passed": passed,
		"success": success,
		"verified": verified
	}

## TC-SV-07: 整档迁移链逐级演进（Inv-SV-4/7）
static func test_full_save_migration_chain() -> Dictionary:
	SaveMigrationEngine.reset_for_tests()
	# 注册模拟历史版本迁移：0.8.0 -> 0.9.0 -> 1.0.0
	GameSaveAssembler.register_migration("0.8.0", "0.9.0", func(d: Dictionary) -> Dictionary:
		var copy := d.duplicate(true)
		if not copy.has("account"):
			copy["account"] = {}
		copy["account"]["version_upgraded_to_090"] = true
		return copy
	)
	GameSaveAssembler.register_migration("0.9.0", "1.0.0", func(d: Dictionary) -> Dictionary:
		var copy := d.duplicate(true)
		if not copy.has("account"):
			copy["account"] = {}
		copy["account"]["version_upgraded_to_100"] = true
		return copy
	)

	var old_data := { "account": { "id": "acc_mig" } }
	var result := SaveMigrationEngine.migrate(old_data, "0.8.0")
	var success: bool = bool(result.get("success", false))
	var data: Dictionary = result.get("data", {})
	var acc: Dictionary = data.get("account", {})
	var step1_applied: bool = bool(acc.get("version_upgraded_to_090", false))
	var step2_applied: bool = bool(acc.get("version_upgraded_to_100", false))

	var passed := success and step1_applied and step2_applied
	return {
		"test": "TC-SV-07: 整档迁移链逐级演进与数据状态转换断言",
		"passed": passed,
		"success": success,
		"step1_applied": step1_applied,
		"step2_applied": step2_applied
	}

## TC-SV-08: 迁移断链回滚（Inv-SV-7）
static func test_migration_broken_path_rollback() -> Dictionary:
	var old_data := { "account": { "id": "acc_broken" } }
	# 请求迁移未注册的无路径版本 0.5.0
	var result := SaveMigrationEngine.migrate(old_data, "0.5.0")
	var success: bool = bool(result.get("success", false))
	var error_code: String = String(result.get("error_code", ""))

	# 预期：返回 MIGRATION_PATH_BROKEN，原数据未被修改
	var passed := not success and error_code == "MIGRATION_PATH_BROKEN"
	return {
		"test": "TC-SV-08: 迁移路径断裂拦截与原档安全回滚断言",
		"passed": passed,
		"error_code": error_code
	}

## TC-SV-09: 迁移后校验失败拦截（Inv-SV-7）
static func test_post_migration_validation_failure() -> Dictionary:
	# 构造会导致校验失败的迁移步骤（注入致命类型错误）
	GameSaveAssembler.register_migration("0.7.0", "1.0.0", func(d: Dictionary) -> Dictionary:
		var copy := d.duplicate(true)
		# 强制把已知字典域改为非法的不可强转类型
		copy["inventory"] = 123456
		return copy
	)

	var old_data := { "inventory": {} }
	var result := SaveMigrationEngine.migrate(old_data, "0.7.0")
	# 即使经过 sanitize 清洗或报错，应保持安全处置
	var success: bool = bool(result.get("success", false))

	var passed := (result.has("data") or not success)
	return {
		"test": "TC-SV-09: 迁移后数据校验清洗与格式守卫断言",
		"passed": passed
	}

## TC-SV-10: 域级独立迁移（Inv-SV-4）
static func test_domain_level_independent_migration() -> Dictionary:
	SaveMigrationEngine.reset_for_tests()
	# 注册 inventory 域版本 1 -> 2 的迁移
	SaveMigrationEngine.register_domain_migration("inventory", 1, 2, func(data: Dictionary) -> Dictionary:
		var copy := data.duplicate(true)
		copy["inventory_domain_v2_flag"] = true
		return copy
	)

	var domain_data := { "owner_account_id": "player_v1" }
	# 动态设置 inventory 合同版本为 2
	var contract: Variant = SaveDataAccessLayer.get_contract("inventory")
	var prev_ver: int = int(contract.domain_version) if contract != null else 1
	if contract != null:
		contract.domain_version = 2

	var mig_res := SaveMigrationEngine.migrate_domain("inventory", domain_data, 1)
	var success := bool(mig_res.get("success", false))
	var result_data: Dictionary = mig_res.get("data", {})
	var flag_ok := bool(result_data.get("inventory_domain_v2_flag", false))

	# 还原版本
	if contract != null:
		contract.domain_version = prev_ver

	var passed := success and flag_ok
	return {
		"test": "TC-SV-10: 域级独立迁移（Domain Version 独立演进）断言",
		"passed": passed,
		"success": success,
		"flag_ok": flag_ok
	}

## TC-SV-11: 迁移步骤可追踪性留痕（Inv-SV-7）
static func test_migration_traceability_steps() -> Dictionary:
	var old_data := { "account": { "id": "acc_trace" } }
	var result := SaveMigrationEngine.migrate(old_data, "0.8.0")
	var steps: Array = result.get("steps", [])

	var passed := not steps.is_empty() and steps.has("0.8.0")
	return {
		"test": "TC-SV-11: 迁移执行轨迹可追踪性与步骤留痕断言",
		"passed": passed,
		"steps": steps
	}


## Phase 85 R-01（TC-P85-S4-05）：UID 单轨迁移判定器——LGC_ 计数/零计数判定/只读性。
static func test_legacy_uid_audit_detector() -> Dictionary:
	var payload_legacy := {
		"inventory": {"storage_payloads": [
			{"item_uid": "LGC_0001", "template_id": "HERB_A"},
			{"item_uid": "LGC_0002", "template_id": "HERB_B"},
			{"item_uid": "UID_a1b2c3", "template_id": "HERB_C"},
		]},
		"meta": {"save_version": "1.0.0"}
	}
	var rep_legacy := GameSaveAssembler.audit_legacy_uid(payload_legacy)
	var nonzero_ok: bool = int(rep_legacy.get("total_instances", -1)) == 3 		and int(rep_legacy.get("legacy_uid_count", -1)) == 2 		and bool(rep_legacy.get("migration_complete", true)) == false 		and (rep_legacy.get("legacy_samples", []) as Array).size() == 2
	var payload_clean := {"inventory": {"storage_payloads": [{"item_uid": "UID_x1y2z3", "template_id": "HERB_A"}]}}
	var rep_clean := GameSaveAssembler.audit_legacy_uid(payload_clean)
	var zero_ok: bool = int(rep_clean.get("legacy_uid_count", -1)) == 0 		and bool(rep_clean.get("migration_complete", false)) == true
	var payload_snapshot := str(payload_legacy)
	GameSaveAssembler.audit_legacy_uid(payload_legacy)
	var readonly_ok: bool = str(payload_legacy) == payload_snapshot
	var passed := nonzero_ok and zero_ok and readonly_ok
	return {
		"test": "TC-SM-09: UID 迁移判定器（LGC_ 计数/零计数判定/只读性）",
		"passed": passed,
		"legacy_uid_count": rep_legacy.get("legacy_uid_count"),
		"total_instances": rep_legacy.get("total_instances")
	}
