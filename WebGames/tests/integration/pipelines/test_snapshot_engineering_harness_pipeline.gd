# ==============================================================================
# 单元测试：快照测试工程模式与全域数据流插桩全链路流水线
# 文件路径: res://tests/integration/pipelines/test_snapshot_engineering_harness_pipeline.gd
# 职责: 覆盖快照 DTO 往返、环境守卫熔断、典型快照目录、链式 Builder 构造、
#       全域状态水化灌溉、HUD 状态就绪、现场冻结抓取与对称清理反装配全生命周期。
# 需求源: 路线图短期施工区快照测试工程模式与数据插桩流水线规范
# ==============================================================================
class_name TestSnapshotEngineeringHarnessPipeline
extends TestCase

const TestSnapshotBundleDTO = preload("res://dev_harness/snapshot_mode/dto/test_snapshot_bundle_dto.gd")
const SnapshotEnvironmentGuard = preload("res://dev_harness/snapshot_mode/snapshot_environment_guard.gd")
const SnapshotCatalog = preload("res://dev_harness/snapshot_mode/snapshot_catalog.gd")
const TestSnapshotBuilder = preload("res://dev_harness/snapshot_mode/test_snapshot_builder.gd")
const SnapshotInjectionSolver = preload("res://dev_harness/snapshot_mode/snapshot_injection_solver.gd")
const SnapshotCaptureTool = preload("res://dev_harness/snapshot_mode/snapshot_capture_tool.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")
const CharacterPhysiologySheet = preload("res://backend/domains/lifecycle_physiology/physiology_entities.gd")
const CharacterWalletEntity = preload("res://backend/domains/currency_economy/currency_entities.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_snapshot_dto_round_trip_and_reset())
	results.append(test_environment_guard_blocking_and_permission())
	results.append(test_predefined_catalog_fixtures())
	results.append(test_fluent_snapshot_builder())
	results.append(test_snapshot_injection_hydration_and_hud_sync())
	results.append(test_runtime_state_capture_and_rehydration())
	results.append(test_teardown_isolation_and_no_residual())

	return TestCase.pack_results("快照测试工程模式与全域数据流插桩流水线", results)

# ---- TC-SEH-01: 快照 DTO 序列化往返自洽性与 reset_state 复位 ----
static func test_snapshot_dto_round_trip_and_reset() -> Dictionary:
	var snap := TestSnapshotBundleDTO.new()
	snap.snapshot_id = "SNAP_VERIFY_01"
	snap.account_id = "ACC_TEST_01"
	snap.username = "HeroTester"
	snap.character_name = "HeroTester"
	snap.race_id = "ELF"
	snap.level = 10
	snap.wallet_data = {"gold": 9999, "mana_monocrystals": 42}
	snap.physiology_data = {"current_hp": 88, "max_hp": 100}
	snap.inventory_items = [{"item_uid": "ITEM_TEST_01", "count": 2}]

	var dict_data := snap.to_dict()
	var restored := TestSnapshotBundleDTO.from_dict(dict_data)

	assert_eq(restored.snapshot_id, "SNAP_VERIFY_01", "TC-SEH-01A: 快照 ID 应一致")
	assert_eq(restored.race_id, "ELF", "TC-SEH-01B: 种族应无损恢复")
	assert_eq(int(restored.wallet_data.get("gold", 0)), 9999, "TC-SEH-01C: 金币应一致")
	assert_eq(int(restored.wallet_data.get("mana_monocrystals", 0)), 42, "TC-SEH-01D: 魔单晶应一致")
	assert_eq(restored.inventory_items.size(), 1, "TC-SEH-01E: 物品列表长度应一致")

	snap.reset_state()
	assert_eq(snap.snapshot_id, "", "TC-SEH-01F: reset_state 后 ID 应清空")
	assert_eq(snap.character_name, "", "TC-SEH-01G: 角色名应清空")
	assert_eq(snap.inventory_items.size(), 0, "TC-SEH-01H: 物品列表应清空")

	return {"test": "TC-SEH-01: 快照 DTO 序列化往返自洽性与 reset_state 复位", "passed": true}

# ---- TC-SEH-02: 环境守卫 Debug 放行与非 Debug 熔断阻断 ----
static func test_environment_guard_blocking_and_permission() -> Dictionary:
	# 1. 默认环境放行验证
	assert_true(SnapshotEnvironmentGuard.is_injection_permitted(), "TC-SEH-02A: 测试运行期应允许注入")

	# 2. 模拟生产非 Debug 环境下的熔断拦截
	SnapshotEnvironmentGuard.set_test_override(true, false)
	var check_blocked := SnapshotEnvironmentGuard.validate_injection_environment()
	assert_false(bool(check_blocked.get("permitted", true)), "TC-SEH-02B: 非调试环境应被绝对拦截")
	assert_eq(String(check_blocked.get("error_code", "")), SnapshotEnvironmentGuard.ERROR_TEST_MODE_DISABLED, "TC-SEH-02C: 应返回 ERR_TEST_MODE_DISABLED")

	# 3. 拦截状态下调用注入求解器直接阻断
	var snap := SnapshotCatalog.fixture_novice_spawned()
	var inject_res := SnapshotInjectionSolver.inject_and_hydrate(snap)
	assert_false(bool(inject_res.get("success", true)), "TC-SEH-02D: 生产非调试环境注入求解器应直接拒绝")

	# 4. 恢复环境
	SnapshotEnvironmentGuard.reset_for_test()
	assert_true(SnapshotEnvironmentGuard.is_injection_permitted(), "TC-SEH-02E: 复位后应恢复正常")

	return {"test": "TC-SEH-02: 环境守卫 Debug 放行与非 Debug 熔断阻断", "passed": true}

# ---- TC-SEH-03: 预置快照库四模版完整性与数据契约断言 ----
static func test_predefined_catalog_fixtures() -> Dictionary:
	var novice := SnapshotCatalog.fixture_novice_spawned()
	assert_eq(novice.snapshot_id, "FIXTURE_NOVICE_SPAWNED", "TC-SEH-03A: 初生态快照 ID 正确")
	assert_eq(novice.level, 1, "TC-SEH-03B: 初生态等级应为 1")
	assert_gt(novice.inventory_items.size(), 0, "TC-SEH-03C: 初生态应携带新手装备")

	var mid := SnapshotCatalog.fixture_mid_explorer()
	assert_eq(mid.snapshot_id, "FIXTURE_MID_EXPLORER", "TC-SEH-03D: 进阶态快照 ID 正确")
	assert_eq(mid.race_id, "ELF", "TC-SEH-03E: 进阶态种族应为 ELF")
	assert_eq(mid.level, 25, "TC-SEH-03F: 进阶态等级应为 25")

	var late := SnapshotCatalog.fixture_late_hero()
	assert_eq(late.snapshot_id, "FIXTURE_LATE_HERO", "TC-SEH-03G: 终局态快照 ID 正确")
	assert_eq(late.level, 60, "TC-SEH-03H: 终局态等级应为 60")
	assert_gt(int(late.wallet_data.get("gold", 0)), 50000, "TC-SEH-03I: 终局态金币应充沛")

	var crit := SnapshotCatalog.fixture_combat_critical()
	assert_eq(crit.snapshot_id, "FIXTURE_COMBAT_CRITICAL", "TC-SEH-03J: 极限战斗态快照 ID 正确")
	assert_lte(float(crit.physiology_data.get("current_hp", 100)), 10.0, "TC-SEH-03K: 极限态血量应极低")

	return {"test": "TC-SEH-03: 预置快照库四模版完整性与数据契约断言", "passed": true}

# ---- TC-SEH-04: 链式 Builder 动态构造与目标字段自洽 ----
static func test_fluent_snapshot_builder() -> Dictionary:
	var snap: TestSnapshotBundleDTO = TestSnapshotBuilder.create("SNAP_CUSTOM_FORGE") \
		.with_account("ACC_BUILDER_01", "CustomCrafter") \
		.with_character("MasterSmith", "DWARF", "MALE", 35) \
		.with_hp(500, 500) \
		.with_mp(200, 200) \
		.with_wallet(15000, 30) \
		.with_item({"item_uid": "HAMMER_ANVIL_01", "template_id": "forging_hammer", "tier": "EPIC"}) \
		.at_location("DWARVEN_IRON_FORGE", 128.5, 256.0) \
		.at_stage("STAGE_06_HUD_SYNC") \
		.with_domain_extension("workshop", {"forge_level": 5}) \
		.build()

	assert_eq(snap.snapshot_id, "SNAP_CUSTOM_FORGE", "TC-SEH-04A: Builder 产出 ID 应一致")
	assert_eq(snap.character_name, "MasterSmith", "TC-SEH-04B: 角色名应一致")
	assert_eq(snap.race_id, "DWARF", "TC-SEH-04C: 种族应为 DWARF")
	assert_eq(snap.level, 35, "TC-SEH-04D: 等级应为 35")
	assert_eq(int(snap.wallet_data.get("gold", 0)), 15000, "TC-SEH-04E: 金币数量应精准映射")
	assert_eq(int(snap.wallet_data.get("mana_monocrystals", 0)), 30, "TC-SEH-04F: 魔单晶应精准映射")
	assert_eq(snap.location_name, "DWARVEN_IRON_FORGE", "TC-SEH-04G: 空间位置应一致")
	assert_true(snap.domain_extensions.has("workshop"), "TC-SEH-04H: 领域扩展应保留")

	return {"test": "TC-SEH-04: 链式 Builder 动态构造与目标字段自洽", "passed": true}

# ---- TC-SEH-05: 全域快照注入水化与 HUD 首帧同步直达 ----
static func test_snapshot_injection_hydration_and_hud_sync() -> Dictionary:
	var snap := SnapshotCatalog.fixture_mid_explorer()
	var res := SnapshotInjectionSolver.inject_and_hydrate(snap, "STAGE_06_HUD_SYNC")

	assert_true(bool(res.get("success", false)), "TC-SEH-05A: 快照注入应成功")
	assert_eq(String(res.get("error_code", "")), "OK", "TC-SEH-05B: 错误码应为 OK")

	var ctx = res.get("session_context", null)
	assert_not_null(ctx, "TC-SEH-05C: 会话上下文不应为空")
	assert_eq(ctx.character_name, "SylphExplorer", "TC-SEH-05D: 会话角色名应一致")
	assert_eq(ctx.race_id, "ELF", "TC-SEH-05E: 种族应为 ELF")
	assert_eq(ctx.current_stage_index, 6, "TC-SEH-05F: 阶段序号应直接定位至 6")

	var hud_snapshot = res.get("hud_snapshot", null)
	assert_not_null(hud_snapshot, "TC-SEH-05G: HUD快照不应为空")
	assert_eq(hud_snapshot.character_name, "SylphExplorer", "TC-SEH-05H: HUD角色名应一致")
	assert_eq(hud_snapshot.wallet_gold, 5000, "TC-SEH-05I: HUD金币数应真实水化自快照")

	var fsm = GameLifecycleManager.get_instance()
	assert_eq(fsm.get_current_phase(), GameLifecycleModel.LifecyclePhase.RUNNING, "TC-SEH-05J: 状态机应已激活进入 RUNNING")

	SnapshotInjectionSolver.teardown_snapshot(ctx)
	return {"test": "TC-SEH-05: 全域快照注入水化与 HUD 首帧同步直达", "passed": true}

# ---- TC-SEH-06: 运行时现场状态抓取与二次注入复原闭环 ----
static func test_runtime_state_capture_and_rehydration() -> Dictionary:
	# 1. 注入初始快照
	var init_snap := SnapshotCatalog.fixture_novice_spawned()
	var inject_res := SnapshotInjectionSolver.inject_and_hydrate(init_snap)
	var ctx = inject_res.get("session_context", null)

	# 2. 模拟运行时状态变化（通过钱包对象直接改变货币）
	var wallet: CharacterWalletEntity = inject_res.get("wallet_entity", null)
	if wallet != null:
		wallet.gold = 7777

	# 3. 现场一键冻结捕获
	var captured_snap := SnapshotCaptureTool.capture_current_state("CHECKPOINT_DYNAMIC_01", "运行时现场捕获快照")
	assert_eq(captured_snap.snapshot_id, "CHECKPOINT_DYNAMIC_01", "TC-SEH-06A: 捕获快照 ID 正确")

	# 4. 导出为 JSON 字符串验证
	var json_str := SnapshotCaptureTool.capture_to_json_string("CHECKPOINT_DYNAMIC_01")
	assert_true(json_str.contains("CHECKPOINT_DYNAMIC_01"), "TC-SEH-06B: JSON 串应包含快照 ID")

	# 5. 清理后二次反向注入还原
	SnapshotInjectionSolver.teardown_snapshot(ctx)
	var second_inject := SnapshotInjectionSolver.inject_and_hydrate(captured_snap)
	assert_true(bool(second_inject.get("success", false)), "TC-SEH-06C: 现场捕获快照应能无损二次注入")

	var second_ctx = second_inject.get("session_context", null)
	SnapshotInjectionSolver.teardown_snapshot(second_ctx)
	return {"test": "TC-SEH-06: 运行时现场状态抓取与二次注入复原闭环", "passed": true}

# ---- TC-SEH-07: 测试执行后对称清理与状态机反装配零残留 ----
static func test_teardown_isolation_and_no_residual() -> Dictionary:
	var snap := SnapshotCatalog.fixture_combat_critical()
	var res := SnapshotInjectionSolver.inject_and_hydrate(snap)
	var ctx = res.get("session_context", null)

	# 执行清理
	SnapshotInjectionSolver.teardown_snapshot(ctx)

	var fsm = GameLifecycleManager.get_instance()
	assert_eq(fsm.get_current_phase(), GameLifecycleModel.LifecyclePhase.UNINITIALIZED, "TC-SEH-07A: 状态机应完全复位为 UNINITIALIZED")

	return {"test": "TC-SEH-07: 测试执行后对称清理与状态机反装配零残留", "passed": true}
