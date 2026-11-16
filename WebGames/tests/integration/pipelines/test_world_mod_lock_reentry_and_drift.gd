# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_world_mod_lock_reentry_and_drift.gd
# 架构定位: Integration Test Pipeline / World MOD Lock Lifecycle & Drift Detection
# 依赖与触发: 上游: TestRegistry | 下游: WorldCharacterCreationOrchestrator,
#           WorldModAffinityManager, SaveLoadRoutingSolver, WorldGatewayFSM,
#           WorldArchiveRepository, WorldGatewayView
# 职责说明: 验证单机世界建档固化 world_mod_lock.json 后卸载叠层重进自动恢复、
#           缺失关键 MOD 阻断、摘要/版本漂移检测拦截、安全降级记录 MOD_DETACHED 与
#           网关档案诊断面板渲染。
# 设计依据: 阶段验收矩阵 (TC-WLD-01 ~ TC-WLD-04, DOD-P130-0402)
# ==============================================================================

## TestWorldModLockReentryAndDrift：世界档案 MOD 锁重入复原、缺失漂移拦截与安全降级测试套件
class_name TestWorldModLockReentryAndDrift
extends TestCase

const WorldGatewayViewScript = preload("res://frontend/views/world_gateway/world_gateway_view.gd")
const WORLD_GATEWAY_SCENE = preload("res://frontend/views/world_gateway/world_gateway_view.tscn")

const LOCKED_WORLD_ID: String = WorldModLockTestHelper.LOCKED_WORLD_ID

## 执行世界档案 MOD 锁与漂移拦截测试
static func run_all_tests() -> Dictionary:
	WorldModLockTestHelper.cleanup_world_lock_sandbox()
	TestFullChainBackendHelper.setup_env()
	var results: Array[Dictionary] = []
	results.append(test_world_mod_lock_reentry_restores_overlay())
	results.append(test_missing_critical_locked_mod_blocked())
	results.append(test_digest_and_version_drift_detected_and_blocked())
	results.append(test_safe_degrade_records_fragment_and_ui_diagnostics())
	results.append(test_phase131_lock_sha256_fail_closed_and_strict_reconcile())
	WorldModLockTestHelper.cleanup_world_lock_sandbox()
	TestFullChainBackendHelper.teardown_env()
	return TestCase.pack_results("世界档案 MOD 锁重入复原与漂移阻断验收流水线", results)

## TC-WLD-01: 创角前置固化锁后完全卸载叠层，重入网关与二次载入自动复原 Tier3 与清单
static func test_world_mod_lock_reentry_restores_overlay() -> Dictionary:
	var seeded := WorldModLockTestHelper.seed_locked_world_and_character()
	var lock_mgr := WorldModAffinityManager.new()
	var saved_lock := lock_mgr.load_world_mod_lock(LOCKED_WORLD_ID)
	var lock_written: bool = bool(saved_lock.get("exists", false)) \
		and not (saved_lock.get("locked_packs", []) as Array).is_empty()

	TestCase.unmount_mod_overlay_for_test()
	var clean_before_reentry := not GameConfig.has_active_mod_overlay()

	var reentry_fsm := WorldGatewayFSM.new("ACC_WLD_LOCK")
	reentry_fsm.enter_gateway()
	var char_id := str(seeded.get("character_id", ""))
	var slot_stub := [{"slot_id": "SLOT_01", "is_first_creation": false, "bound_character_id": char_id}]
	reentry_fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, slot_stub, LOCKED_WORLD_ID, "SLOT_01")
	reentry_fsm.attach_ready_character(char_id)
	var enter_res := reentry_fsm.enter_world("", false)
	var override_items: Array = GameConfig.get_array("items.mod_overrides", "items", [])
	var has_mithril_sword := false
	for item_entry in override_items:
		if item_entry is Dictionary and str((item_entry as Dictionary).get("canonical_id", "")) == "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD":
			has_mithril_sword = true
			break
	var overlay_restored := GameConfig.has_active_mod_overlay() and has_mithril_sword

	TestCase.unmount_mod_overlay_for_test()
	var acc := AccountProfile.new()
	acc.account_id = "ACC_WLD_LOCK"
	acc.bind_world_slot(LOCKED_WORLD_ID, "SLOT_01")
	var dto := SaveSlotDTO.new()
	dto.slot_id = "SLOT_01"
	dto.world_id = LOCKED_WORLD_ID
	dto.character_name = "LocksmithHero"
	dto.prologue_completed = false
	var sec_res := SaveLoadRoutingSolver.execute_secondary_load({
		"account": acc,
		"slot": dto,
		"target_world_id": LOCKED_WORLD_ID,
		"allow_default_fallback": false
	})

	reentry_fsm.logout()
	var ok: bool = bool(seeded.get("created", false)) and lock_written and clean_before_reentry \
		and bool(enter_res.get("success", false)) and overlay_restored and bool(sec_res.get("success", false))
	return make_result("TC-WLD-01: 世界 MOD 锁前置固化、归零后重入与二次载入自动复原", ok, {
		"lock_written": lock_written,
		"overlay_restored": overlay_restored,
		"secondary_ok": sec_res.get("success", false)
	})

## TC-WLD-02: 缺失关键锁定 MOD 时网关诊断识别缺包且严禁进界
static func test_missing_critical_locked_mod_blocked() -> Dictionary:
	var lock_mgr := WorldModAffinityManager.new()
	lock_mgr.save_world_mod_lock(LOCKED_WORLD_ID, [
		{"pack_id": "official_kalar", "version": "1.0.0"},
		{"pack_id": "missing_critical_mod_xyz", "version": "1.2.0"}
	])
	var installed := ModPackageDiscoverySolver.scan_installed_full_mod_packages()
	var diag := lock_mgr.diagnose_world_mods(LOCKED_WORLD_ID, installed)
	var diag_ok: bool = bool(diag.get("has_lock_file", false)) \
		and (diag.get("missing_packs", []) as Array).has("missing_critical_mod_xyz") \
		and not bool(diag.get("is_clean", true))

	var fsm := WorldGatewayFSM.new("ACC_WLD_MISS")
	fsm.enter_gateway()
	fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [], LOCKED_WORLD_ID, "SLOT_01")
	fsm.attach_ready_character("CHAR_MISS_TEST")
	var enter_res := fsm.enter_world("", false)
	var fsm_blocked: bool = not bool(enter_res.get("success", true)) \
		and str(enter_res.get("error_code", "")) == "ERR_MISSING_CRITICAL_MOD"

	var acc := AccountProfile.new()
	acc.account_id = "ACC_WLD_MISS"
	acc.bind_world_slot(LOCKED_WORLD_ID, "SLOT_01")
	var dto := SaveSlotDTO.new()
	dto.slot_id = "SLOT_01"
	dto.world_id = LOCKED_WORLD_ID
	dto.character_name = "MissTester"
	var sec_res := SaveLoadRoutingSolver.execute_secondary_load({
		"account": acc,
		"slot": dto,
		"target_world_id": LOCKED_WORLD_ID
	})
	var sec_blocked: bool = not bool(sec_res.get("success", true)) \
		and str(sec_res.get("error_code", "")) == "ERR_MISSING_CRITICAL_MOD"

	return make_result("TC-WLD-02: 缺失关键锁定 MOD 阻断进界与二次载入 ERR_MISSING_CRITICAL_MOD", diag_ok and fsm_blocked and sec_blocked, {
		"enter_err": enter_res.get("error_code", ""),
		"sec_err": sec_res.get("error_code", "")
	})

## TC-WLD-03: 磁盘 MOD 版本或 SHA-256 摘要发生漂移时诊断检出并拒绝进界
static func test_digest_and_version_drift_detected_and_blocked() -> Dictionary:
	var lock_mgr := WorldModAffinityManager.new()
	lock_mgr.save_world_mod_lock(LOCKED_WORLD_ID, [
		{"pack_id": "official_kalar", "version": "0.0.1-legacy", "content_sha256": "00000000deadbeef"}
	])
	var installed := ModPackageDiscoverySolver.scan_installed_full_mod_packages()
	var diag := lock_mgr.diagnose_world_mods(LOCKED_WORLD_ID, installed)
	var drift_ok: bool = not (diag.get("digest_drifts", []) as Array).is_empty() \
		and not (diag.get("version_drifts", []) as Array).is_empty() \
		and not bool(diag.get("is_clean", true))

	var fsm := WorldGatewayFSM.new("ACC_WLD_DRIFT")
	fsm.enter_gateway()
	fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [], LOCKED_WORLD_ID, "SLOT_01")
	fsm.attach_ready_character("CHAR_DRIFT_TEST")
	var enter_res := fsm.enter_world("", false)
	var blocked_ok: bool = not bool(enter_res.get("success", true)) \
		and str(enter_res.get("error_code", "")) == "MOD_ERR_REALM_DIGEST_MISMATCH"

	return make_result("TC-WLD-03: MOD SHA-256 摘要与版本漂移阻断进界", drift_ok and blocked_ok, {
		"enter_err": enter_res.get("error_code", "")
	})

## TC-WLD-04: 允许安全降级写入 MOD_DETACHED 历史片段并在网关视图呈现锁定诊断
static func test_safe_degrade_records_fragment_and_ui_diagnostics() -> Dictionary:
	TestCase.mount_official_kalar_for_test()
	var world := WorldInstance.new(LOCKED_WORLD_ID)
	WorldArchiveRepository.get_instance().save_world(world)
	var lock_mgr := WorldModAffinityManager.new()
	lock_mgr.save_world_mod_lock(LOCKED_WORLD_ID, [
		{"pack_id": "official_kalar", "version": "1.0.0"},
		{"pack_id": "detached_optional_addon", "version": "1.0.0"}
	])

	var fsm := WorldGatewayFSM.new("ACC_WLD_DEGRADE")
	fsm.enter_gateway()
	fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [], LOCKED_WORLD_ID, "SLOT_01")
	fsm.attach_ready_character("CHAR_DEGRADE_HERO")
	var degrade_res := fsm.enter_world("", true)

	var has_detached_fragment := WorldModLockTestHelper.has_detached_fragment(LOCKED_WORLD_ID)

	var view: WorldGatewayViewScript = WORLD_GATEWAY_SCENE.instantiate() as WorldGatewayViewScript
	var tree_root := (Engine.get_main_loop() as SceneTree).root
	tree_root.add_child(view)
	if not view.is_node_ready():
		view.notification(Node.NOTIFICATION_READY)
	view.selected_world_id = LOCKED_WORLD_ID
	view.last_world_diagnostics = {
		"status": "DEGRADED",
		"locked_mods": ["official_kalar", "detached_optional_addon"],
		"missing_mods": ["detached_optional_addon"],
		"digest_mismatches": []
	}
	WorldGatewayRenderHelper.render_world_diagnostics(view)
	var ui_diag_ok: bool = view.world_detail_rich_label != null \
		and view.world_detail_rich_label.text.contains("DEGRADED")
	view.free()
	fsm.logout()

	var ok: bool = bool(degrade_res.get("success", false)) and has_detached_fragment and ui_diag_ok
	return make_result("TC-WLD-04: 安全降级记录 MOD_DETACHED 片段与网关诊断面板渲染", ok, {
		"degrade_ok": degrade_res.get("success", false),
		"has_detached_fragment": has_detached_fragment,
		"ui_diag_ok": ui_diag_ok
	})


## TC-WLD-05 (P0 安全基线): 真实 SHA-256 固化、摘要漂移无条件禁降级 Fail-Closed 与有锁严格收敛
static func test_phase131_lock_sha256_fail_closed_and_strict_reconcile() -> Dictionary:
	WorldModLockTestHelper.cleanup_world_lock_sandbox()
	var seeded := WorldModLockTestHelper.seed_locked_world_and_character()
	var lock_mgr := WorldModAffinityManager.new()
	var saved_lock := lock_mgr.load_world_mod_lock(LOCKED_WORLD_ID)
	var locked_packs: Array = saved_lock.get("locked_packs", [])
	var sha_ok: bool = not locked_packs.is_empty()
	for entry in locked_packs:
		if entry is Dictionary:
			var digest := str((entry as Dictionary).get("content_sha256", "")).strip_edges()
			if digest.length() != 64:
				sha_ok = false

	# 1. 带锁世界先污染 adapted_mod_manifest 为额外 addon 后重入，仍须严格收敛回 locked_pack_ids
	var reconcile_fsm := WorldGatewayFSM.new("ACC_WLD_LOCK")
	reconcile_fsm.enter_gateway()
	var char_id := str(seeded.get("character_id", ""))
	var slot_stub := [{"slot_id": "SLOT_01", "is_first_creation": false, "bound_character_id": char_id}]
	reconcile_fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, slot_stub, LOCKED_WORLD_ID, "SLOT_01")
	reconcile_fsm.adapted_mod_manifest = {"enabled_pack_ids": ["official_kalar", "rogue_unapproved_addon"]}
	reconcile_fsm.set_active_mods([
		{"pack_id": "official_kalar"},
		{"pack_id": "rogue_unapproved_addon"}
	])
	reconcile_fsm.attach_ready_character(char_id)
	var reconcile_enter := reconcile_fsm.enter_world("", false)
	var mounted_ids: Array = reconcile_fsm.adapted_mod_manifest.get("enabled_pack_ids", []) if reconcile_fsm.adapted_mod_manifest is Dictionary else []
	var strict_reconciled: bool = bool(reconcile_enter.get("success", false)) and mounted_ids == ["official_kalar"]
	reconcile_fsm.logout()

	# 2. 摘要漂移下即使传入 allow_safe_degrade = true 或走二次读档，均须无条件 Fail-Closed
	lock_mgr.save_world_mod_lock(LOCKED_WORLD_ID, [
		{"pack_id": "official_kalar", "version": "1.0.0", "content_sha256": "deadbeef00000000000000000000000000000000000000000000000000000000"}
	])
	var installed := ModPackageDiscoverySolver.scan_installed_full_mod_packages()
	var bind_degrade := lock_mgr.verify_and_bind_world_mods(LOCKED_WORLD_ID, installed, true)
	var bind_blocked: bool = not bool(bind_degrade.get("success", true)) \
		and str(bind_degrade.get("error", "")) == "MOD_ERR_REALM_DIGEST_MISMATCH"

	var drift_fsm := WorldGatewayFSM.new("ACC_WLD_DRIFT_FC")
	drift_fsm.enter_gateway()
	drift_fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, slot_stub, LOCKED_WORLD_ID, "SLOT_01")
	drift_fsm.attach_ready_character(char_id)
	var enter_degrade := drift_fsm.enter_world("", true)
	var enter_blocked: bool = not bool(enter_degrade.get("success", true)) \
		and str(enter_degrade.get("error_code", "")) == "MOD_ERR_REALM_DIGEST_MISMATCH"
	drift_fsm.logout()

	var acc := AccountProfile.new()
	acc.account_id = "ACC_WLD_DRIFT_FC"
	acc.bind_world_slot(LOCKED_WORLD_ID, "SLOT_01")
	var dto := SaveSlotDTO.new()
	dto.slot_id = "SLOT_01"
	dto.world_id = LOCKED_WORLD_ID
	dto.character_name = "LocksmithHero"
	var sec_res := SaveLoadRoutingSolver.execute_secondary_load({
		"account": acc,
		"slot": dto,
		"target_world_id": LOCKED_WORLD_ID
	})
	var sec_blocked: bool = not bool(sec_res.get("success", true)) \
		and str(sec_res.get("error_code", "")) == "MOD_ERR_REALM_DIGEST_MISMATCH"

	var ok: bool = bool(seeded.get("created", false)) and sha_ok and strict_reconciled \
		and bind_blocked and enter_blocked and sec_blocked
	return make_result("TC-WLD-05: 锁文件64位SHA-256固化、摘要篡改禁降级 Fail-Closed 与有锁严格重校", ok, {
		"sha_ok": sha_ok,
		"strict_reconciled": strict_reconciled,
		"bind_blocked": bind_blocked,
		"enter_blocked": enter_blocked,
		"sec_blocked": sec_blocked
	})
