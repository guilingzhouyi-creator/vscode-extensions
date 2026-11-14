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
# 设计依据: Phase 130 阶段4验收矩阵 (TC-WLD-01 ~ TC-WLD-04, DOD-P130-0402)
# ==============================================================================

## TestWorldModLockReentryAndDrift：世界档案 MOD 锁重入复原、缺失漂移拦截与安全降级测试套件
class_name TestWorldModLockReentryAndDrift
extends TestCase

const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const SaveLoadRoutingSolver = preload("res://backend/domains/world_gateway/save_load_routing_solver.gd")
const WorldModAffinityManager = preload("res://backend/domains/narrative_orchestration/world_mod_affinity_manager.gd")
const WorldCharacterCreationOrchestrator = preload("res://backend/domains/character_creation/world_character_creation_orchestrator.gd")
const AuthoritativeCharacterCreationRequestDTO = preload("res://backend/domains/character_creation/dto/authoritative_character_creation_request_dto.gd")
const WorldArchiveRepository = preload("res://backend/domains/world_state/world_archive_repository.gd")
const WorldInstance = preload("res://backend/domains/world_state/world_instance.gd")
const AccountProfile = preload("res://backend/domains/account/account_profile.gd")
const SaveSlotDTO = preload("res://backend/domains/account/save_slot_dto.gd")
const TestFullChainBackendHelper = preload("res://tests/integration/pipelines/test_full_chain_backend_helper.gd")
const WorldModLockTestHelper = preload("res://tests/support/world_mod_lock_test_helper.gd")
const WorldGatewayViewScript = preload("res://frontend/views/world_gateway/world_gateway_view.gd")
const WorldGatewayRenderHelper = preload("res://frontend/views/world_gateway/world_gateway_render_helper.gd")
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
	WorldModLockTestHelper.cleanup_world_lock_sandbox()
	TestFullChainBackendHelper.teardown_env()
	return TestCase.pack_results("Phase 130 世界档案 MOD 锁重入复原与漂移阻断验收流水线", results)

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
