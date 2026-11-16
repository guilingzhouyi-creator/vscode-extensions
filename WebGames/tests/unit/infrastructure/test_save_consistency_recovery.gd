# ==============================================================================
# 单元测试：数据一致性、脏标记增量与异常恢复全量矩阵
# 文件路径: res://tests/unit/infrastructure/test_save_consistency_recovery.gd
# 职责: 验证物品背包技能联动一致性、高频域增量保存、缺失字段默认值恢复、
#       空壳档阻断与原子损坏恢复（TC-SV-12~16, TC-SV-28~34, TC-SV-37~38）。
# ==============================================================================
class_name TestSaveConsistencyRecovery extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_inventory_item_reference_integrity())
	results.append(test_item_definition_fallback_rebuild())
	results.append(test_skill_state_persistence_without_template())
	results.append(test_save_domain_acyclic_dependencies())
	results.append(test_high_frequency_domain_dirty_save())
	results.append(test_missing_field_use_default())
	results.append(test_type_mismatch_coerce_or_drop())
	results.append(test_unknown_domain_warn_and_skip())
	results.append(test_isolated_domain_corruption_recovery())
	results.append(test_atomic_write_interruption_preserves_original())
	results.append(test_empty_save_blocked_guard())
	results.append(test_hot_reload_retry_after_failure())
	results.append(test_orphan_tmp_cleanup())
	results.append(test_auto_restore_on_corrupt_primary())
	results.append(test_atomic_writer_backup_rotation_and_restore())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "物品背包技能数据一致性与异常容灾恢复",
		"all_passed": all_passed,
		"results": results
	}

## TC-SV-12: 背包物品引用完整性往返（Inv-SV-3）
static func test_inventory_item_reference_integrity() -> Dictionary:
	var inv := WearableInventoryAggregate.new()
	inv.owner_account_id = "hero_consistency_test"

	var item := ItemEntity.new()
	item.item_id = "test_blade_1"
	item.item_uid = "uid_blade_test_001"
	item.category = ItemEntity.CATEGORY_WEAPON_BLADE
	inv.storage_items.append(item)

	var snap := inv.serialize()
	var restored := WearableInventoryAggregate.deserialize(snap)

	var has_storage: bool = (restored.storage_items.size() == 1)
	var restored_item: Variant = restored.storage_items[0] if has_storage else null
	var uid_matches: bool = (restored_item is ItemEntity and (restored_item as ItemEntity).item_uid == "uid_blade_test_001")

	var passed: bool = has_storage and uid_matches
	return {
		"test": "TC-SV-12: 背包与持有物品实例引用完整性往返断言",
		"passed": passed,
		"has_storage": has_storage,
		"uid_matches": uid_matches
	}

## TC-SV-13: 物品定义缺失兜底重建（Inv-SV-3）
static func test_item_definition_fallback_rebuild() -> Dictionary:
	# 构造缺省定义字段的物品字典载荷
	var sparse_data := {
		"item_id": "legacy_item_missing_attrs",
		"item_uid": "uid_sparse_123"
	}
	var rebuilt := ItemEntity.deserialize(sparse_data)
	var has_uid := (rebuilt.item_uid == "uid_sparse_123")
	# 默认质量/体积从 item_defaults 兜底恢复
	var mass_valid := (rebuilt.mass_kg > 0.0)

	var passed := has_uid and mass_valid
	return {
		"test": "TC-SV-13: 缺失配置定义的持有物品实例兜底重建断言",
		"passed": passed,
		"mass_valid": mass_valid
	}

## TC-SV-14: 技能状态持久化（AST 纯净持久化，Inv-SV-3）
static func test_skill_state_persistence_without_template() -> Dictionary:
	var ast := SkillSubgraphAST.new()
	ast.signature_hash = "sig_hash_consistency"
	var ser := ast.serialize()

	# 验证不含庞大的静态模板文案
	var no_template_leak := not ser.has("template_description")
	var has_sig := ser.has("signature_hash")

	var passed := no_template_leak and has_sig
	return {
		"test": "TC-SV-14: 技能状态持久化仅存结构快照与哈希防冗余断言",
		"passed": passed
	}

## TC-SV-15: 域依赖单向无环性（Inv-SV-1）
static func test_save_domain_acyclic_dependencies() -> Dictionary:
	var manifest: Array = GameConfig.get_array("infrastructure.domains", "domains", [])
	var deps: Dictionary = {}
	for entry in manifest:
		var d_id := String(entry.get("id", ""))
		deps[d_id] = entry.get("depends_on", [])

	# 全图三色 DFS 环路检测（0=未访, 1=访问中/栈内, 2=已完成），任何 depends_on 环路即判定失败
	var color: Dictionary = {}
	var has_cycle := _detect_dependency_cycle(deps, color)
	return {
		"test": "TC-SV-15: 存档数据域依赖拓扑单向无环约束断言",
		"passed": not deps.is_empty() and not has_cycle
	}

static func _detect_dependency_cycle(deps: Dictionary, color: Dictionary) -> bool:
	for node_id in deps.keys():
		if int(color.get(node_id, 0)) == 0:
			if _dfs_has_cycle(String(node_id), deps, color):
				return true
	return false

static func _dfs_has_cycle(node_id: String, deps: Dictionary, color: Dictionary) -> bool:
	color[node_id] = 1
	var neighbors: Array = deps.get(node_id, []) if deps.get(node_id, []) is Array else []
	for nxt in neighbors:
		var nxt_id := String(nxt)
		var state := int(color.get(nxt_id, 0))
		if state == 1:
			return true
		if state == 0 and deps.has(nxt_id) and _dfs_has_cycle(nxt_id, deps, color):
			return true
	color[node_id] = 2
	return false

## TC-SV-16: 高频域增量保存（Inv-SV-10）
static func test_high_frequency_domain_dirty_save() -> Dictionary:
	SaveDataAccessLayer.reset_for_tests()
	var test_inv := WearableInventoryAggregate.new()
	test_inv.owner_account_id = "hero_dirty_test"
	SaveDataAccessLayer.register_provider("inventory", test_inv)

	# 标记 inventory 为脏
	SaveDataAccessLayer.mark_dirty("inventory")
	var is_d := SaveDataAccessLayer.is_dirty("inventory")

	# 执行增量刷新写盘
	var flush_res := SaveDataAccessLayer.flush_dirty("test_dirty_flush_slot")
	var success := bool(flush_res.get("success", false))
	var written: int = int(flush_res.get("written", 0))
	var cleared := not SaveDataAccessLayer.is_dirty("inventory")

	var passed := is_d and success and written == 1 and cleared
	return {
		"test": "TC-SV-16: 高频数据域脏标记增量持久化与清空机制断言",
		"passed": passed,
		"written": written,
		"cleared": cleared
	}

## TC-SV-28: 缺失字段 use_default 策略（Inv-SV-11）
static func test_missing_field_use_default() -> Dictionary:
	var raw_save := { "inventory": { "equipped_payloads": {} } }
	var val_res := SaveValidationService.validate_domains(raw_save)
	var is_valid := bool(val_res.get("is_valid", false))
	var sanitized: Dictionary = val_res.get("sanitized", {})

	# 缺失的域按策略补充空字典或默认占位
	var passed := is_valid and sanitized.has("inventory")
	return {
		"test": "TC-SV-28: 存档缺失字段/数据域按配置使用默认值恢复断言",
		"passed": passed
	}

## TC-SV-29: 类型不符安全强转或丢弃（Inv-SV-11）
static func test_type_mismatch_coerce_or_drop() -> Dictionary:
	var raw := {
		"account": "corrupted_string_not_dict"
	}
	var val_res := SaveValidationService.validate_domains(raw)
	var sanitized: Dictionary = val_res.get("sanitized", {})
	# 强转/丢弃为安全字典
	var account_safe: bool = sanitized.get("account", null) is Dictionary

	var passed := account_safe
	return {
		"test": "TC-SV-29: 存档类型不符依据 coerce_or_drop 策略安全降级断言",
		"passed": passed
	}

## TC-SV-30: 未知数据域 warn_and_skip 策略（Inv-SV-11）
static func test_unknown_domain_warn_and_skip() -> Dictionary:
	var raw := {
		"inventory": {},
		"unknown_alien_domain_99": { "bad_data": true }
	}
	var val_res := SaveValidationService.validate_domains(raw)
	var sanitized: Dictionary = val_res.get("sanitized", {})
	var unknown_stripped := not sanitized.has("unknown_alien_domain_99")
	var inventory_kept := sanitized.has("inventory")

	var passed := unknown_stripped and inventory_kept
	return {
		"test": "TC-SV-30: 未知数据域依据 warn_and_skip 策略安全跳过断言",
		"passed": passed,
		"unknown_stripped": unknown_stripped
	}

## TC-SV-31: 损坏域隔离恢复（Inv-SV-7）
static func test_isolated_domain_corruption_recovery() -> Dictionary:
	var raw := {
		"account": { "id": "acc_ok" },
		"corrupted_domain": 99999
	}
	var val_res := SaveValidationService.validate_domains(raw)
	var sanitized: Dictionary = val_res.get("sanitized", {})
	var account_dict: Dictionary = sanitized.get("account", {})
	var account_intact: bool = (account_dict.get("id", "") == "acc_ok")

	var passed: bool = account_intact
	return {
		"test": "TC-SV-31: 单域数据损坏隔离且其余正常域无损恢复断言",
		"passed": passed
	}

## TC-SV-32: 原子写中断保护原档（SaveManager 契约保持）
static func test_atomic_write_interruption_preserves_original() -> Dictionary:
	var slot := "test_atomic_preserve_slot"
	var payload := { "data": { "round": 1 } }
	var res1 := SaveDataAccessLayer.save_game(slot, payload)
	if not bool(res1.get("success", false)):
		return { "test": "TC-SV-32: 原子写中断原档保护", "passed": false, "reason": "first_save_failed" }

	# 读取当前文件路径并确认存在
	var file_path := SaveManager._save_dir() + slot + SaveManager._save_extension()
	var exists_before := FileAccess.file_exists(file_path)

	# 尝试传入非法超长名或路径穿越名称
	var bad_res := SaveDataAccessLayer.save_game("../bad_slot_traversal", payload)
	var bad_blocked := not bool(bad_res.get("success", false))

	# 验证原有正档未受破坏
	var exists_after := FileAccess.file_exists(file_path)
	var load_res := SaveDataAccessLayer.load_game(slot)
	var data_ok := (int(load_res.get("data", {}).get("round", 0)) == 1)

	var passed := exists_before and bad_blocked and exists_after and data_ok
	return {
		"test": "TC-SV-32: 非法写入或中断不破坏已有合法正档断言",
		"passed": passed,
		"bad_blocked": bad_blocked,
		"data_ok": data_ok
	}

## TC-SV-33: 审查 L2 空壳档阻断（providers 全空拒绝写盘）
static func test_empty_save_blocked_guard() -> Dictionary:
	SaveDataAccessLayer.reset_for_tests()
	# 在没有注册任何 provider 的情况下尝试保存
	var result := SaveDataAccessLayer.save_game("test_empty_slot", {})
	var success := bool(result.get("success", false))
	var error_code := String(result.get("error_code", ""))

	# 预期：空壳档被阻断，返回 EMPTY_SAVE_BLOCKED
	var passed := not success and error_code == "EMPTY_SAVE_BLOCKED"
	return {
		"test": "TC-SV-33: providers 全空时显式阻断写盘（EMPTY_SAVE_BLOCKED）断言",
		"passed": passed,
		"error_code": error_code
	}

## TC-SV-34: 热更新失败恢复重试
static func test_hot_reload_retry_after_failure() -> Dictionary:
	EditorHotReloadManager.reset_for_tests()
	RuntimeModeGate.set_mode(RuntimeModeGate.Mode.SINGLE_PLAYER)

	# 首次拒绝
	EditorHotReloadManager.set_domain_scope("game_settings", false, false, "domains.game_settings")
	var res1 := EditorHotReloadManager.apply_hot_reload({ "domains.game_settings": "hash_1" })
	var res1_results: Dictionary = res1.get("results", {})
	var res1_gs: Dictionary = res1_results.get("game_settings", {})
	var skipped1: bool = (res1_gs.get("status", "") == "skipped")

	# 修正白名单后重试
	EditorHotReloadManager.set_domain_scope("game_settings", true, false, "domains.game_settings")
	var res2 := EditorHotReloadManager.apply_hot_reload({ "domains.game_settings": "hash_1" })
	var res2_results: Dictionary = res2.get("results", {})
	var res2_gs: Dictionary = res2_results.get("game_settings", {})
	var reloaded2: bool = (res2_gs.get("status", "") == "reloaded")

	var passed: bool = skipped1 and reloaded2
	return {
		"test": "TC-SV-34: 热更新失败安全阻断与策略修正后重试成功断言",
		"passed": passed
	}

## TC-SV-37: 孤儿临时文件启动清理（存档韧性）
## 背景：原子写流程在被外部中断（进程被杀/崩溃）时会在 rename 前遗留 *{tmp_suffix} 文件，
## 既不参与校验也不被任何流程回收；本用例断言启动入口按配置将其回收。
static func test_orphan_tmp_cleanup() -> Dictionary:
	var slot := "test_orphan_tmp_resilience"
	SaveManager.ensure_save_directory()
	var tmp_path := SaveManager._save_dir() + slot + SaveManager._save_extension() + SaveManager._tmp_suffix()

	var f := FileAccess.open(tmp_path, FileAccess.WRITE)
	if f == null:
		return { "test": "TC-SV-37: 孤儿 .tmp 启动回收", "passed": false, "reason": "cannot_create_orphan_tmp" }
	f.store_string("{ orphan tmp from interrupted atomic write")
	f.flush()
	f.close()
	var existed_before := FileAccess.file_exists(tmp_path)

	# 触发启动清理入口
	SaveManager.ensure_save_directory()
	var cleaned_after := not FileAccess.file_exists(tmp_path)

	var passed: bool = existed_before and cleaned_after
	return {
		"test": "TC-SV-37: 中断原子写遗留的孤儿 .tmp 由启动清理回收断言",
		"passed": passed,
		"existed_before": existed_before,
		"cleaned_after": cleaned_after
	}

## TC-SV-38: 正档损坏时按配置自动从 .bak 恢复并重读（存档韧性）
## 背景：restore_backup 此前仅有测试调用，生产 load 路径缺自动恢复——坏档即不可自愈。
## 本用例断言：正档校验失败 → 自动恢复 .bak → 重读成功，并携带 auto_restored 留痕；
## 恢复内容必须为 .bak 对应的上一代正档（非当前坏档）。
static func test_auto_restore_on_corrupt_primary() -> Dictionary:
	var slot := "test_auto_restore_resilience"
	SaveManager.ensure_save_directory()
	# 连续两次写入：第二次会把第一次的正档备份为 .bak
	var r1 := SaveManager.save_game(slot, { "data": { "round": 1 } })
	var r2 := SaveManager.save_game(slot, { "data": { "round": 2 } })
	if not (bool(r1.get("success", false)) and bool(r2.get("success", false))):
		return { "test": "TC-SV-38: 正档损坏自动恢复", "passed": false, "reason": "seed_save_failed" }

	var file_path := SaveManager._save_dir() + slot + SaveManager._save_extension()
	var backup_path := file_path + SaveManager._backup_suffix()
	if not FileAccess.file_exists(backup_path):
		return { "test": "TC-SV-38: 正档损坏自动恢复", "passed": false, "reason": "backup_not_created" }

	# 破坏正档（.bak 保持合法）
	var cf := FileAccess.open(file_path, FileAccess.WRITE)
	if cf == null:
		return { "test": "TC-SV-38: 正档损坏自动恢复", "passed": false, "reason": "cannot_corrupt_primary" }
	cf.store_string("{ corrupted envelope")
	cf.flush()
	cf.close()

	var res := SaveManager.load_game(slot)
	var success: bool = bool(res.get("success", false))
	var auto_restored: bool = bool(res.get("auto_restored", false))
	var recovered_round: int = int(res.get("data", {}).get("round", -1))

	# 恢复内容应为上一代正档（round == 1），而非被破坏的当前档
	var passed: bool = success and auto_restored and recovered_round == 1
	return {
		"test": "TC-SV-38: 正档损坏时自动从 .bak 恢复并重读（auto_restored 留痕）断言",
		"passed": passed,
		"success": success,
		"auto_restored": auto_restored,
		"recovered_round": recovered_round
	}

## TC-SV-39: AtomicFileWriter 多代备份轮转、孤儿临时文件回收与恢复契约
static func test_atomic_writer_backup_rotation_and_restore() -> Dictionary:
	var base_dir: String = "user://test_atomic_writer_unit"
	var target_path: String = base_dir + "/state.json"
	var tmp_path: String = target_path + ".tmp"
	var bak0: String = target_path + ".bak"
	var bak1: String = target_path + ".bak.1"
	var bak2: String = target_path + ".bak.2"
	var opts: Dictionary = {"create_backup": true, "backup_retention": 3, "backup_fail_policy": "abort"}

	var w1: Dictionary = AtomicFileWriter.write_text_atomic(target_path, "{\"v\":1}", opts)
	var w2: Dictionary = AtomicFileWriter.write_text_atomic(target_path, "{\"v\":2}", opts)
	var w3: Dictionary = AtomicFileWriter.write_text_atomic(target_path, "{\"v\":3}", opts)
	var writes_ok: bool = bool(w1.get("success", false)) and bool(w2.get("success", false)) and bool(w3.get("success", false))

	var primary_txt: String = _read_text_or_empty(target_path)
	var bak0_txt: String = _read_text_or_empty(bak0)
	var bak1_txt: String = _read_text_or_empty(bak1)
	var rotation_ok: bool = primary_txt == "{\"v\":3}" and bak0_txt == "{\"v\":2}" and bak1_txt == "{\"v\":1}" and not FileAccess.file_exists(bak2)

	var orphan_f: FileAccess = FileAccess.open(tmp_path, FileAccess.WRITE)
	if orphan_f != null:
		orphan_f.store_string("orphan")
		orphan_f.flush()
		orphan_f.close()
	var cleaned_cnt: int = AtomicFileWriter.cleanup_orphan_tmp_files(base_dir)
	var restore_ok: bool = AtomicFileWriter.restore_from_backup(target_path, bak0) and _read_text_or_empty(target_path) == "{\"v\":2}"

	for p in [target_path, tmp_path, bak0, bak1, bak2]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(p)
	if DirAccess.dir_exists_absolute(base_dir):
		DirAccess.remove_absolute(base_dir)

	var passed: bool = writes_ok and rotation_ok and cleaned_cnt == 1 and restore_ok
	return {
		"test": "TC-SV-39: AtomicFileWriter 多代备份轮转、孤儿清理与恢复契约断言",
		"passed": passed,
		"writes_ok": writes_ok,
		"rotation_ok": rotation_ok,
		"cleaned_cnt": cleaned_cnt,
		"restore_ok": restore_ok
	}

static func _read_text_or_empty(file_path: String) -> String:
	if not FileAccess.file_exists(file_path):
		return ""
	var f: FileAccess = FileAccess.open(file_path, FileAccess.READ)
	if f == null:
		return ""
	var content: String = f.get_as_text()
	f.close()
	return content
