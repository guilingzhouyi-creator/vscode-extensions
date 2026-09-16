# ==============================================================================
# 单元测试：领域 6 本地持久化与IPC同步 (Persistence & Protocol Tests)
# 文件路径: res://tests/unit/domains/test_persistence_protocol.gd
# ==============================================================================
class_name TestPersistenceDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_save_load_roundtrip_integrity())
	results.append(test_client_prediction_reconciliation())
	results.append(test_tampered_data_json_rejected())
	results.append(test_parallel_data_field_ignored())
	results.append(test_path_traversal_save_name_rejected())
	results.append(test_atomic_write_produces_backup())
	results.append(test_save_assembler_manifest_order_roundtrip())
	results.append(test_save_version_migration_guard())
	# Phase 56 L6 新增：损坏备份恢复预检 + 版本方向闸门
	results.append(test_restore_backup_rejects_corrupt())
	results.append(test_load_version_direction_gate())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 06: 本地持久化与IPC通信", "all_passed": all_passed, "results": results }

static func test_save_load_roundtrip_integrity() -> Dictionary:
	var payload := {
		"data": {
			"player_name": "阿尔托莉雅",
			"gold": 9999,
			"level": 50
		}
	}
	var save_res = SaveManager.save_game("test_persistence_unit", payload)
	var load_res = SaveManager.load_game("test_persistence_unit")

	var passed = save_res.success and load_res.success and (load_res.data.get("player_name", "") == "阿尔托莉雅")
	return { "test": "TC-PERS-01: .kalar_save 存档原子读写与哈希防篡改", "passed": passed, "sha256": save_res.get("sha256", "") }

## 回归守护：改写被签名的 data_json 必须被 SHA-256 校验拒绝
static func test_tampered_data_json_rejected() -> Dictionary:
	var name_a := "test_persist_tamper"
	var save_res = SaveManager.save_game(name_a, { "data": { "gold": 100 } })
	if not save_res.get("success", false):
		return { "test": "TC-PERS-03: 篡改存档数据触发完整性拒绝", "passed": false, "reason": "save failed" }

	var path := SaveManager._save_dir() + name_a + SaveManager._save_extension()
	var file := FileAccess.open(path, FileAccess.READ)
	if not file:
		return { "test": "TC-PERS-03: 篡改存档数据触发完整性拒绝", "passed": false, "reason": "cannot reopen" }
	var content := file.get_as_text()
	file.close()

	var json := JSON.new()
	json.parse(content)
	var env: Dictionary = json.get_data()
	env["data_json"] = JSON.stringify({ "gold": 999999999 })

	var wf := FileAccess.open(path, FileAccess.WRITE)
	wf.store_string(JSON.stringify(env, "\t"))
	wf.close()

	var load_res = SaveManager.load_game(name_a)
	var passed = (not load_res.get("success", true))
	return { "test": "TC-PERS-03: 篡改存档数据触发完整性拒绝", "passed": passed, "error": load_res.get("error", "") }

## 回归守护：信封中平行写入的 "data" 字段必须被忽略（防校验绕过）
static func test_parallel_data_field_ignored() -> Dictionary:
	var name_b := "test_persist_bypass"
	var save_res = SaveManager.save_game(name_b, { "data": { "gold": 100 } })
	if not save_res.get("success", false):
		return { "test": "TC-PERS-04: 平行 data 字段不得绕过校验", "passed": false, "reason": "save failed" }

	var path := SaveManager._save_dir() + name_b + SaveManager._save_extension()
	var file := FileAccess.open(path, FileAccess.READ)
	if not file:
		return { "test": "TC-PERS-04: 平行 data 字段不得绕过校验", "passed": false, "reason": "cannot reopen" }
	var content := file.get_as_text()
	file.close()

	var json := JSON.new()
	json.parse(content)
	var env: Dictionary = json.get_data()
	env["data"] = { "gold": 999999999 }          # 注入伪造数据，signature 与 data_json 均未改动

	var wf := FileAccess.open(path, FileAccess.WRITE)
	wf.store_string(JSON.stringify(env, "\t"))
	wf.close()

	var load_res = SaveManager.load_game(name_b)
	var loaded_gold: int = int(load_res.get("data", {}).get("gold", -1))
	var passed = load_res.get("success", false) and loaded_gold == 100
	return { "test": "TC-PERS-04: 平行 data 字段不得绕过校验", "passed": passed, "gold": loaded_gold }

## 回归守护：路径穿越型存档名必须被拒绝
static func test_path_traversal_save_name_rejected() -> Dictionary:
	var evil_names := ["../../evil", "..\\..\\evil", "a/../b", "sub/dir"]
	var all_rejected := true
	for n in evil_names:
		if SaveManager.is_valid_save_name(n):
			all_rejected = false
		var res = SaveManager.save_game(n, { "data": {} })
		if res.get("success", false):
			all_rejected = false
	return { "test": "TC-PERS-05: 路径穿越存档名被拒绝", "passed": all_rejected }

## 回归守护：原子写必须生成 .bak 备份且不残留 .tmp
static func test_atomic_write_produces_backup() -> Dictionary:
	var name_c := "test_persist_atomic"
	var first = SaveManager.save_game(name_c, { "data": { "round": 1 } })
	if not first.get("success", false):
		return { "test": "TC-PERS-06: 原子写生成备份并可回滚", "passed": false, "reason": "first save failed" }
	var second = SaveManager.save_game(name_c, { "data": { "round": 2 } })
	if not second.get("success", false):
		return { "test": "TC-PERS-06: 原子写生成备份并可回滚", "passed": false, "reason": "second save failed" }

	var dir := SaveManager._save_dir()
	var ext := SaveManager._save_extension()
	var has_backup := FileAccess.file_exists(dir + name_c + ext + SaveManager._backup_suffix())
	var no_tmp := not FileAccess.file_exists(dir + name_c + ext + SaveManager._tmp_suffix())
	var loaded = SaveManager.load_game(name_c)
	var cur_round: int = int(loaded.get("data", {}).get("round", -1))

	var restored = SaveManager.restore_backup(name_c)
	var after = SaveManager.load_game(name_c)
	var restored_round: int = int(after.get("data", {}).get("round", -1))

	var passed = has_backup and no_tmp and cur_round == 2 and restored.get("success", false) and restored_round == 1
	return {
		"test": "TC-PERS-06: 原子写生成备份并可回滚", "passed": passed,
		"has_backup": has_backup, "no_tmp": no_tmp, "cur_round": cur_round, "restored_round": restored_round
	}

## 回归守护：存档组装器按清单顺序组装 payload.data，并经 SaveManager 端到端落盘回灌
static func test_save_assembler_manifest_order_roundtrip() -> Dictionary:
	var banner := GachaBannerAggregate.new()
	banner.current_pity_count = 77
	banner.total_lifetime_pulls = 1234
	var item := ItemEntity.new()
	item.item_id = "ASM_TEST_ITEM"
	item.template_id = "ASM_TEST_ITEM"
	item.mass_kg = 3.5

	var built := GameSaveAssembler.build_save_payload({ "gacha_wish": banner, "inventory": item })

	# data 键序必须是 domains.json 领域顺序的子序列（SHA-256 字节稳定前提）
	var manifest_ids: Array = []
	for e in GameConfig.get_array("infrastructure.domains", "domains", []):
		manifest_ids.append(String(e.get("id", "")))
	var ordered := true
	var scan := 0
	for k in built.data.keys():
		while scan < manifest_ids.size() and manifest_ids[scan] != k:
			scan += 1
		if scan == manifest_ids.size():
			ordered = false
			break
		scan += 1

	var save_res = SaveManager.save_game("test_assembler_roundtrip", { "data": built.data })
	var load_res = SaveManager.load_game("test_assembler_roundtrip")
	var restored_res := {}
	if load_res.get("success", false):
		restored_res = GameSaveAssembler.apply_save_data(load_res.data, {
			"gacha_wish": Callable(GachaBannerAggregate, "deserialize"),
			"inventory": Callable(ItemEntity, "deserialize")
		})

	var rb: Variant = restored_res.get("restored", {}).get("gacha_wish", null)
	var ri: Variant = restored_res.get("restored", {}).get("inventory", null)
	var passed = built.saved.size() == 2 and built.skipped.is_empty() and ordered \
		and save_res.get("success", false) and load_res.get("success", false) and load_res.get("verified", false) \
		and rb != null and ri != null \
		and rb.current_pity_count == 77 and rb.total_lifetime_pulls == 1234 \
		and ri.item_id == "ASM_TEST_ITEM" and ri.mass_kg == 3.5
	return {
		"test": "TC-PERS-07: 存档组装器清单序组装与端到端回灌", "passed": passed,
		"saved": built.saved, "ordered": ordered
	}

## 回归守护：同版/legacy 档直接兼容；未知旧版无迁移链则明确拒绝；登记迁移链后可逐版迁移
static func test_save_version_migration_guard() -> Dictionary:
	var current := GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0")
	var same_version := GameSaveAssembler.migrate_save_data({ "gold": 1 }, current)
	var unknown_old := GameSaveAssembler.migrate_save_data({ "gold": 1 }, "0.0.1-test")
	GameSaveAssembler.register_migration("0.0.1-test", current, Callable(TestPersistenceDomain, "_fake_migrate"))
	var migrated := GameSaveAssembler.migrate_save_data({ "gold": 1 }, "0.0.1-test")
	var passed = same_version.compatible and not unknown_old.compatible \
		and migrated.compatible and migrated.data.get("migrated", false) and migrated.data.get("gold", 0) == 1
	return {
		"test": "TC-PERS-08: 存档版本兼容校验与链式迁移", "passed": passed,
		"current": current, "unknown_error": unknown_old.get("error", "")
	}

## 测试专用迁移函数：标记数据已被迁移（不改原值）
static func _fake_migrate(d: Dictionary) -> Dictionary:
	d["migrated"] = true
	return d

static func test_client_prediction_reconciliation() -> Dictionary:
	var server_pkt := KalarSaveSchema.ServerEventPacket.new()
	server_pkt.server_frame_tick = 100
	server_pkt.acknowledged_sequence_number = 3
	server_pkt.authoritative_state = { "hp": 85.0, "ap": 2 }

	var unacked_cmds: Array = []
	for i in range(1, 6): # seq 1..5, acked <= 3, 剩余 4, 5 (2条)
		var cmd := KalarSaveSchema.ClientCommandPacket.new()
		cmd.sequence_number = i
		cmd.payload = { "verb": "SLASH" } # base_ap = -3
		unacked_cmds.append(cmd)

	var rec = PersistenceAndReconciliationSolver.reconcile_client_state(server_pkt, unacked_cmds)
	var passed = (rec.remaining_unacked_count == 2) and (rec.reconciled_ap == 2 + (-3 * 2)) # 2 - 6 = -4
	return { "test": "TC-PERS-02: 客户端指令预测与服务器权威帧调和重放", "passed": passed, "reconciled_ap": rec.reconciled_ap }

## L6（Phase 56）：restore_backup 恢复前可解析性预检——截断/损坏 .bak 拒绝覆盖正档（Inv-DF-4）
static func test_restore_backup_rejects_corrupt() -> Dictionary:
	var save_name := "P56_BAK_CORRUPT_DF4"
	var ext := GameConfig.get_string("infrastructure.persistence", "save_extension", ".kalar_save")
	var bak_suffix := GameConfig.get_string("infrastructure.persistence", "atomic_write/backup_suffix", ".bak")
	var dir := GameConfig.get_string("infrastructure.persistence", "save_dir", "user://saves/")
	var bak_path := dir + save_name + ext + bak_suffix

	SaveManager.save_game(save_name, { "data": { "hp": 1 } }) # 首存
	SaveManager.save_game(save_name, { "data": { "hp": 2 } }) # 次存生成 .bak
	# 用截断垃圾覆盖 .bak
	var w := FileAccess.open(bak_path, FileAccess.WRITE)
	w.store_string("{ \"data_json\": 截断未闭合")
	w.flush()
	w.close()

	var res = SaveManager.restore_backup(save_name)
	var corrupt_ok = (not res.success) and res.error_code == "BACKUP_CORRUPT"
	# 正档未被坏备份覆盖、仍可加载
	var still = SaveManager.load_game(save_name)
	var intact_ok = still.success and still.get("data", {}).get("hp", 0) == 2
	var passed = corrupt_ok and intact_ok
	return { "test": "TC-PERS-08: 恢复前预检拒坏备份（L6：损坏 .bak 不覆盖正档）", "passed": passed }

## L6（Phase 56）：load_game format_version 方向闸门——未来版本存档拒绝直通（VERSION_TOO_NEW）
static func test_load_version_direction_gate() -> Dictionary:
	var save_name := "P56_VERSION_GATE_DF4"
	var ext := GameConfig.get_string("infrastructure.persistence", "save_extension", ".kalar_save")
	var path := GameConfig.get_string("infrastructure.persistence", "save_dir", "user://saves/") + save_name + ext

	SaveManager.save_game(save_name, { "data": { "hp": 10 } })
	var f := FileAccess.open(path, FileAccess.READ)
	var content := f.get_as_text()
	f.close()
	var json := JSON.new()
	json.parse(content)
	var env: Dictionary = json.get_data()
	env["format_version"] = "99.0.0" # 未来版本（签名只覆盖 data_json，闸门在哈希校验前独立生效）
	var w := FileAccess.open(path, FileAccess.WRITE)
	w.store_string(JSON.stringify(env))
	w.flush()
	w.close()

	var res = SaveManager.load_game(save_name)
	var passed = (not res.success) and res.error_code == "VERSION_TOO_NEW"
	return { "test": "TC-PERS-09: 版本方向闸门（L6：未来版本存档 VERSION_TOO_NEW 拒绝）", "passed": passed }
