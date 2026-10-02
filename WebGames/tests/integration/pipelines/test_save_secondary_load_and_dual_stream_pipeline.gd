# ==============================================================================
# 单元测试：存档二次载入与复合鉴权双轨分流全链路流水线
# 文件路径: res://tests/integration/pipelines/test_save_secondary_load_and_dual_stream_pipeline.gd
# 职责: 覆盖「复合鉴权自动注册/登录 ➔ 多世界槽位占位符防御 ➔ 边界A/B双轨判定与分流 ➔
#       世界主页HUD汇聚同步 ➔ ESC呼出菜单 ➔ 优雅停机安全反装配」全生命周期无头断言。
# 需求源: 路线图短期施工区存档二次载入与复合鉴权双轨分流规范
# ==============================================================================
class_name TestSaveSecondaryLoadAndDualStreamPipeline
extends TestCase

const AccountCompositeAuthDTO = preload("res://backend/domains/account/dto/account_composite_auth_dto.gd")
const AuthService = preload("res://backend/domains/account/auth_service.gd")
const AccountProfileAggregate = preload("res://backend/domains/account/account_profile.gd")
const SaveSlotSummaryDTO = preload("res://backend/domains/account/save_slot_dto.gd")
const SaveLoadRoutingSolver = preload("res://backend/domains/world_gateway/save_load_routing_solver.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const CharacterPhysiologySheet = preload("res://backend/domains/lifecycle_physiology/physiology_entities.gd")
const CharacterWalletEntity = preload("res://backend/domains/currency_economy/currency_entities.gd")
const HudStatusSnapshotDTO = preload("res://backend/domains/world_state/dto/hud_status_snapshot_dto.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const GameBootstrap = preload("res://backend/infrastructure/game_bootstrap.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_composite_auth_auto_registration_and_login())
	results.append(test_multi_world_slot_placeholder_defense())
	results.append(test_boundary_a_prologue_replay_stream())
	results.append(test_boundary_b_mature_save_direct_restore())
	results.append(test_converged_hud_state_synchronization())
	results.append(test_esc_menu_and_graceful_shutdown_teardown())
	results.append(test_dto_serialization_and_reset_state())

	return TestCase.pack_results("存档二次载入与复合鉴权双轨分流全链路流水线", results)

static func _make_test_account_store() -> Dictionary:
	return {}

# ---- TC-SLD-01: 复合鉴权自动注册与登录双模流转 ----
static func test_composite_auth_auto_registration_and_login() -> Dictionary:
	var store := _make_test_account_store()
	var username := "AdventurerAlpha"
	var password := "SecurePass_2026"

	# 1. 自动注册模式 (MODE_AUTO)
	var auto_req := AccountCompositeAuthDTO.Request.new(username, password, AccountCompositeAuthDTO.MODE_AUTO, "FP_DEV_01")
	var auto_resp := AuthService.composite_authenticate(auto_req, store)

	assert_true(auto_resp.success, "TC-SLD-01A: 首次复合鉴权应自动完成注册并成功返回")
	assert_true(auto_resp.is_new_registration, "TC-SLD-01B: 应标识为新注册用户")
	assert_false(auto_resp.session_token.is_empty(), "TC-SLD-01C: 应签发有效 SessionToken")
	assert_eq(auto_resp.username, username, "TC-SLD-01D: 用户名应一致")
	assert_true(store.has(auto_resp.account_id), "TC-SLD-01E: 账号应持久化至账号存储")

	# 2. 已有账号再次鉴权（同一接口自动转为登录）
	var login_req := AccountCompositeAuthDTO.Request.new(username, password, AccountCompositeAuthDTO.MODE_AUTO, "FP_DEV_01")
	var login_resp := AuthService.composite_authenticate(login_req, store)

	assert_true(login_resp.success, "TC-SLD-01F: 已有用户再次鉴权应成功登录")
	assert_false(login_resp.is_new_registration, "TC-SLD-01G: 已有用户不应标记为新注册")
	assert_eq(login_resp.account_id, auto_resp.account_id, "TC-SLD-01H: 账号ID应保持一致")

	# 3. 错误密码拦截
	var wrong_req := AccountCompositeAuthDTO.Request.new(username, "WrongPassword", AccountCompositeAuthDTO.MODE_AUTO, "FP_DEV_01")
	var wrong_resp := AuthService.composite_authenticate(wrong_req, store)
	assert_false(wrong_resp.success, "TC-SLD-01I: 错误口令应被拦截")

	# 4. 纯登录模式对未注册用户阻断
	var login_only_req := AccountCompositeAuthDTO.Request.new("NonExistentUser", "AnyPass", AccountCompositeAuthDTO.MODE_LOGIN_ONLY)
	var login_only_resp := AuthService.composite_authenticate(login_only_req, store)
	assert_false(login_only_resp.success, "TC-SLD-01J: 纯登录模式未注册账号应报错")
	assert_eq(login_only_resp.error_code, "ERR_ACCOUNT_NOT_FOUND", "TC-SLD-01K: 应返回 ERR_ACCOUNT_NOT_FOUND")

	return {"test": "TC-SLD-01: 复合鉴权自动注册与登录双模流转", "passed": true}

# ---- TC-SLD-02: 多世界槽位占位符防御校验 ----
static func test_multi_world_slot_placeholder_defense() -> Dictionary:
	var account := AccountProfileAggregate.new()
	account.account_id = "ACC_TEST_WORLD_01"

	# 默认单人世界槽位
	assert_eq(account.get_active_world_slot(), AccountProfileAggregate.WORLD_DEFAULT_SP_01, "TC-SLD-02A: 默认活跃世界应为 WORLD_DEFAULT_SP_01")

	# 未绑定世界槽位判定
	assert_true(account.is_world_slot_placeholder("WORLD_RESERVED_SP_02"), "TC-SLD-02B: 预留槽位应判定为占位符")
	assert_true(account.is_world_slot_placeholder("WORLD_NON_EXISTENT"), "TC-SLD-02C: 未登记世界应判定为占位符")

	# 占位符校验拒绝与回退
	var strict_val := SaveLoadRoutingSolver.validate_world_slot(account, "WORLD_RESERVED_SP_02", false)
	assert_false(strict_val.success, "TC-SLD-02D: 非回退模式访问占位符世界应阻断")
	assert_eq(strict_val.error_code, "UNBOUND_WORLD_SLOT", "TC-SLD-02E: 错误码应为 UNBOUND_WORLD_SLOT")

	var fallback_val := SaveLoadRoutingSolver.validate_world_slot(account, "WORLD_RESERVED_SP_02", true)
	assert_true(fallback_val.success, "TC-SLD-02F: 启用回退时应安全降级至默认世界")
	assert_eq(fallback_val.world_id, AccountProfileAggregate.WORLD_DEFAULT_SP_01, "TC-SLD-02G: 降级目标应为默认世界")

	return {"test": "TC-SLD-02: 多世界槽位占位符防御校验", "passed": true}

# ---- TC-SLD-03: 边界 A 判定与序章重放重初始化流 ----
static func test_boundary_a_prologue_replay_stream() -> Dictionary:
	var account := AccountProfileAggregate.new()
	account.account_id = "ACC_BOUNDARY_A"

	# 首次建档后直接退出（未完成序章，play_time == 0）
	var slot := SaveSlotSummaryDTO.new()
	slot.slot_id = "SLOT_01"
	slot.character_name = "NoviceRunner"
	slot.prologue_completed = false
	slot.play_time_seconds = 0
	account.add_slot_summary(slot)

	# 判定分流求解
	var path := SaveLoadRoutingSolver.evaluate_entry_path(slot)
	assert_eq(path, SaveLoadRoutingSolver.ENTRY_PATH_PROLOGUE_REPLAY, "TC-SLD-03A: 边界A应判定为序章重放流")

	# 执行二次载入流转
	var ctx := {
		"account": account,
		"slot": slot,
		"target_world_id": AccountProfileAggregate.WORLD_DEFAULT_SP_01,
		"allow_default_fallback": true
	}
	var res := SaveLoadRoutingSolver.execute_secondary_load(ctx)

	assert_true(res.success, "TC-SLD-03B: 边界A流转应执行成功")
	assert_eq(res.entry_path, SaveLoadRoutingSolver.ENTRY_PATH_PROLOGUE_REPLAY, "TC-SLD-03C: 应返回序章重放路径")
	assert_true(res.replayed, "TC-SLD-03D: 应标记已重放序章")
	assert_not_null(res.prologue_context, "TC-SLD-03E: 应生成序章执行上下文")
	assert_not_null(res.event_packet, "TC-SLD-03F: 应派发首步事件包")
	assert_false(slot.prologue_completed, "TC-SLD-03G: 档位序章完成态应保持未完成以便重新体验")

	return {"test": "TC-SLD-03: 边界 A 判定与序章重放重初始化流", "passed": true}

# ---- TC-SLD-04: 边界 B 判定与成熟物理存档反装配直载流 ----
static func test_boundary_b_mature_save_direct_restore() -> Dictionary:
	var account := AccountProfileAggregate.new()
	account.account_id = "ACC_BOUNDARY_B"

	# 已玩一段时间的成熟存档（序章已完成，play_time > 0）
	var slot := SaveSlotSummaryDTO.new()
	slot.slot_id = "SLOT_TEST_MATURE_01"
	slot.character_name = "VeteranHero"
	slot.prologue_completed = true
	slot.play_time_seconds = 7200
	account.add_slot_summary(slot)

	# 判定分流求解
	var path := SaveLoadRoutingSolver.evaluate_entry_path(slot)
	assert_eq(path, SaveLoadRoutingSolver.ENTRY_PATH_DIRECT_RESTORE, "TC-SLD-04A: 边界B应判定为成熟存档直载流")

	# 模拟物理存档落盘
	var save_payload := {
		"version": 1,
		"data": {
			"character_info": {"name": "VeteranHero", "level": 25},
			"wallet": {"gold": 8888, "crystals": 12}
		}
	}
	SaveDataAccessLayer.save_game(slot.slot_id, save_payload)

	# 执行二次载入流转
	var ctx := {
		"account": account,
		"slot": slot,
		"target_world_id": AccountProfileAggregate.WORLD_DEFAULT_SP_01,
		"allow_default_fallback": true
	}
	var res := SaveLoadRoutingSolver.execute_secondary_load(ctx)

	assert_true(res.success, "TC-SLD-04B: 边界B直载流转应成功")
	assert_eq(res.entry_path, SaveLoadRoutingSolver.ENTRY_PATH_DIRECT_RESTORE, "TC-SLD-04C: 应返回直载路径")
	assert_false(res.replayed, "TC-SLD-04D: 绝对严禁重放序章")
	assert_true(res.physical_save_loaded, "TC-SLD-04E: 应成功读取并反装配物理存档")

	return {"test": "TC-SLD-04: 边界 B 判定与成熟物理存档反装配直载流", "passed": true}

# ---- TC-SLD-05: 汇聚进入主页 HUD 状态快照同步 ----
static func test_converged_hud_state_synchronization() -> Dictionary:
	var account := AccountProfileAggregate.new()
	account.account_id = "ACC_HUD_SYNC"

	var slot := SaveSlotSummaryDTO.new()
	slot.slot_id = "SLOT_HUD_01"
	slot.character_name = "SyncChampion"
	slot.current_location_name = "中洲·圣城大殿"

	var physiology = CharacterPhysiologySheet.new()
	physiology.race_id = "ELF"

	var wallet = CharacterWalletEntity.new()
	wallet.gold = 3500
	wallet.mana_monocrystals = 50

	var snapshot: HudStatusSnapshotDTO = SaveLoadRoutingSolver.synchronize_hud_entry(account, slot, physiology, wallet)

	assert_not_null(snapshot, "TC-SLD-05A: HUD快照不应为空")
	assert_eq(snapshot.character_name, "SyncChampion", "TC-SLD-05B: 快照角色名应一致")
	assert_eq(snapshot.race_id, "ELF", "TC-SLD-05C: 快照种族应真实还原自生理表")
	assert_eq(snapshot.wallet_gold, 3500, "TC-SLD-05D: 金币数量应精准映射")
	assert_eq(snapshot.wallet_mana_monocrystals, 50, "TC-SLD-05E: 魔单晶应精准映射")
	assert_eq(snapshot.current_location_id, "中洲·圣城大殿", "TC-SLD-05F: 空间位置应真实同步")

	return {"test": "TC-SLD-05: 汇聚进入主页 HUD 状态快照同步", "passed": true}

# ---- TC-SLD-06: ESC 呼出菜单与优雅停机反装配 ----
static func test_esc_menu_and_graceful_shutdown_teardown() -> Dictionary:
	# 1. 验证 ESC 菜单选项配置
	var options := SaveLoadRoutingSolver.get_esc_menu_options()
	assert_eq(options.size(), 4, "TC-SLD-06A: ESC 菜单应包含4项核心动作")
	var actions: Array[String] = []
	for opt in options:
		actions.append(String(opt.get("action", "")))
	assert_true(actions.has("RESUME"), "TC-SLD-06B: 菜单应包含继续冒险")
	assert_true(actions.has("SETTINGS"), "TC-SLD-06C: 菜单应包含系统设置")
	assert_true(actions.has("SAVE"), "TC-SLD-06D: 菜单应包含保存进度")
	assert_true(actions.has("EXIT"), "TC-SLD-06E: 菜单应包含退出游戏")

	# 2. 准备生命周期状态机并执行退出
	GameLifecycleManager.reset_for_test()
	GameBootstrap.assemble()
	var fsm = GameLifecycleManager.get_instance()
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.BOOT_INITIALIZING)
	fsm.transition_to(GameLifecycleModel.LifecyclePhase.RUNNING)

	var shutdown_resp := SaveLoadRoutingSolver.execute_esc_exit("SLOT_ESC_01")
	assert_true(shutdown_resp.success, "TC-SLD-06F: ESC退出应顺利完成安全停机")
	assert_eq(shutdown_resp.error_code, "OK", "TC-SLD-06G: 停机错误码应为 OK")
	assert_eq(fsm.get_current_phase(), GameLifecycleModel.LifecyclePhase.STOPPED, "TC-SLD-06H: 状态机应进入 STOPPED 终态")

	GameLifecycleManager.reset_for_test()
	return {"test": "TC-SLD-06: ESC 呼出菜单与优雅停机反装配", "passed": true}

# ---- TC-SLD-07: DTO 序列化双向无损与对象池复位 ----
static func test_dto_serialization_and_reset_state() -> Dictionary:
	# 1. AccountCompositeAuthDTO Request 往返与复位
	var req := AccountCompositeAuthDTO.Request.new("HeroOne", "Plain123", AccountCompositeAuthDTO.MODE_LOGIN_ONLY, "FP_99")
	var req_dict := req.to_dto()
	assert_eq(req_dict.get("username", ""), "HeroOne", "TC-SLD-07A: Request 序列化字段应正确")
	req.reset_state()
	assert_eq(req.username, "", "TC-SLD-07B: reset_state 后用户名应清空")

	# 2. AccountCompositeAuthDTO Response 往返与复位
	var resp := AccountCompositeAuthDTO.Response.new()
	resp.success = true
	resp.username = "HeroOne"
	resp.session_token = "TOK_ABC_123"
	var resp_dict := resp.to_dto()
	var restored_resp := AccountCompositeAuthDTO.Response.from_dto(resp_dict)
	assert_true(restored_resp.success, "TC-SLD-07C: Response 反序列化成功状态应保持")
	assert_eq(restored_resp.session_token, "TOK_ABC_123", "TC-SLD-07D: Token 应保持一致")
	resp.reset_state()
	assert_false(resp.success, "TC-SLD-07E: reset_state 后 success 应重置为 false")

	# 3. SaveSlotSummaryDTO 往返与复位
	var slot := SaveSlotSummaryDTO.new()
	slot.slot_id = "SLOT_DTO_01"
	slot.character_name = "SlotTraveler"
	slot.prologue_completed = true
	slot.world_slot_status = "OCCUPIED"
	slot.world_id = "WORLD_DEFAULT_SP_01"

	var slot_dict := slot.serialize()
	var restored_slot := SaveSlotSummaryDTO.deserialize(slot_dict)
	assert_true(restored_slot.prologue_completed, "TC-SLD-07F: prologue_completed 序列化往返应无损")
	assert_eq(restored_slot.world_slot_status, "OCCUPIED", "TC-SLD-07G: world_slot_status 应无损")
	assert_eq(restored_slot.world_id, "WORLD_DEFAULT_SP_01", "TC-SLD-07H: world_id 应无损")

	slot.reset_state()
	assert_false(slot.prologue_completed, "TC-SLD-07I: reset_state 后 prologue_completed 应恢复默认 false")

	return {"test": "TC-SLD-07: DTO 序列化双向无损与对象池复位", "passed": true}
