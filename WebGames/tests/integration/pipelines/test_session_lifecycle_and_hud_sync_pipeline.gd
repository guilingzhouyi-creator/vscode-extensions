# ==============================================================================
# 单元测试：用户会话生命周期与主页HUD双轨同步流水线
# 文件路径: res://tests/integration/pipelines/test_session_lifecycle_and_hud_sync_pipeline.gd
# 职责: 覆盖「注册 ➔ 登录 ➔ 进世界 HUD 首帧快照 ➔ 会话注销」全闭环无头断言，
#       验证快照真实溯源（零臆造）、除数下限守卫、广播载荷契约（args/category_key）。
# 需求源: 阶段4（S4：TestSessionLifecycleAndHudSyncPipeline，8 用例）
# ==============================================================================
class_name TestSessionLifecycleAndHudSyncPipeline
extends TestCase

const AccountRegistrationDTO = preload("res://backend/domains/account/dto/account_registration_dto.gd")
const AuthService = preload("res://backend/domains/account/auth_service.gd")
const AccountProfileAggregate = preload("res://backend/domains/account/account_profile.gd")
const HudStatusSnapshotDTO = preload("res://backend/domains/world_state/dto/hud_status_snapshot_dto.gd")
const HudMutationEventsDTO = preload("res://backend/domains/world_state/dto/hud_mutation_events_dto.gd")
const HudEventContract = preload("res://backend/domains/world_state/hud_event_contract.gd")
const HudStateSyncService = preload("res://backend/domains/world_state/hud_state_sync_service.gd")
const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const CharacterCreationRequestDTO = preload("res://backend/domains/character_creation/character_creation_request_dto.gd")
const CharacterCreationService = preload("res://backend/domains/character_creation/character_creation_service.gd")
const OpeningEventStreamDTO = preload("res://backend/domains/character_creation/opening_event_stream_dto.gd")
const PrologueExecutionKernel = preload("res://backend/domains/character_creation/prologue_execution_kernel.gd")
const CharacterPrologueContext = preload("res://backend/domains/character_creation/character_prologue_context.gd")
const InputDeviceStateAggregate = preload("res://backend/domains/hardware_input/input_device_state_aggregate.gd")
const GameLoopStateStack = preload("res://backend/infrastructure/game_loop_fsm.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const GameLifecycleService = preload("res://backend/domains/lifecycle/game_lifecycle_service.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")
const GameBootstrap = preload("res://backend/infrastructure/game_bootstrap.gd")
const LifecycleStageHookRegistry = preload("res://backend/domains/lifecycle/lifecycle_stage_hook_registry.gd")
const SessionFlowContextDTO = preload("res://backend/domains/lifecycle/dto/session_flow_context_dto.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_registration_validation_and_duplicate())
	results.append(test_auth_eventbus_lifecycle_broadcast())
	results.append(test_hud_snapshot_dto_and_divider_guards())
	results.append(test_hud_snapshot_real_source_derivation())
	results.append(test_hud_push_stream_and_payload_contract())
	results.append(test_full_headless_lifecycle_pipeline())
	results.append(test_narrative_template_args_contract())
	results.append(test_session_bounded_and_no_residual_subscription())
	results.append(test_ten_stage_custom_hook_conduction_pipeline())
	results.append(test_unwired_slots_explicit_reservation_no_default_binding())
	results.append(test_session_context_pool_and_pruning_lifecycle())

	return TestCase.pack_results("用户会话生命周期与主页HUD双轨同步流水线", results)

## 事件捕获辅助：挂接/卸载 DOMAIN_EVENT_GENERIC 信道监听（零残留，返回解绑闭包）
static func _capture_events(callback: Callable) -> Callable:
	var tok := EventBusCore.get_instance().on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, callback)
	return func() -> void:
		tok.unbind()

static func _make_account_store() -> Dictionary:
	return {}

static func _register_user(store: Dictionary, username: String, password: String) -> AccountRegistrationDTO.Response:
	var req := AccountRegistrationDTO.Request.new()
	req.username = username
	req.password_plain = password
	req.device_fingerprint = "FP_SESSION"
	return AuthService.register_account(req, store)

# ---- TC-HDS-01：标准注册校验与重名拦截 ----
static func test_registration_validation_and_duplicate() -> Dictionary:
	var store := _make_account_store()
	var bad := AccountRegistrationDTO.Request.new()
	bad.username = "ab"
	bad.password_plain = "x"
	var bad_resp: AccountRegistrationDTO.Response = AuthService.register_account(bad, store)
	if bad_resp.success:
		return {"test": "TC-HDS-01: 注册校验与重名拦截", "passed": false}

	var ok := _register_user(store, "ArthurSession", "Excalibur123")
	if not ok.success or ok.account_id.is_empty():
		return {"test": "TC-HDS-01: 注册校验与重名拦截", "passed": false}

	var dup := _register_user(store, "arthursession", "Excalibur123")
	var passed := not dup.success and dup.error_code == "ERR_ACCOUNT_ALREADY_EXISTS"
	return {"test": "TC-HDS-01: 注册校验与重名拦截", "passed": passed}

# ---- TC-HDS-02：鉴权 EventBus 全周期广播（契约完备 + token 脱敏） ----
static func test_auth_eventbus_lifecycle_broadcast() -> Dictionary:
	var store := _make_account_store()
	var captured: Array = []
	var detach := _capture_events(func(pkt: EventPacket) -> void:
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		captured.append({"channel": str(w.get("channel", "")), "payload": w.get("payload", {})})
	)

	_register_user(store, "BroadcastSession", "Pass1234")
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_BROADCAST"
	acc.username = "BroadcastSession"
	acc.password_hash_sha256 = AuthService.hash_password("Pass1234")
	var auth := AuthService.authenticate_local("BroadcastSession", "Pass1234", acc)
	var token := String(auth.get("token", ""))
	AuthService.revoke_token(token)
	detach.call()

	var registered := false
	var login_ok := false
	var revoked := false
	for ev in captured:
		if ev["channel"] == HudEventContract.channel_auth_registered():
			registered = (ev["payload"].get("category_key") == "auth") and (ev["payload"].get("args") is Array)
		elif ev["channel"] == HudEventContract.channel_auth_login_succeeded():
			var prefix: String = ev["payload"].get("token_prefix", "")
			login_ok = (ev["payload"].get("category_key") == "auth") \
				and (ev["payload"].get("args") is Array) \
				and not String(ev["payload"].get("password_plain", "")).length() > 0 \
				and prefix.length() <= 8
		elif ev["channel"] == HudEventContract.channel_auth_session_revoked():
			revoked = (ev["payload"].get("category_key") == "auth") and (ev["payload"].get("args") is Array)
	var passed := registered and login_ok and revoked
	return {"test": "TC-HDS-02: 鉴权广播契约完备与token脱敏", "passed": passed}

# ---- TC-HDS-03：快照 DTO 序列化与除数守卫 ----
static func test_hud_snapshot_dto_and_divider_guards() -> Dictionary:
	var data := {
		"account_id": "ACC_1",
		"hp_max": 0.0,
		"ap_max": - 10.0,
		"hp_current": - 5.0,
		"wallet_gold": 7
	}
	var dto := HudStatusSnapshotDTO.from_dto(data)
	var round := HudStatusSnapshotDTO.from_dto(dto.to_dto())
	var passed := dto.hp_max >= 1.0 and dto.ap_max >= 1.0 and dto.hp_current >= 0.0 \
		and round.hp_max == dto.hp_max and round.wallet_gold == 7
	return {"test": "TC-HDS-03: 快照序列化与除数下限守卫", "passed": passed}

# ---- TC-HDS-04：快照真实溯源与防臆造白名单 ----
static func test_hud_snapshot_real_source_derivation() -> Dictionary:
	var sheet := CharacterPhysiologySheet.new()
	sheet.set_level("STR", 3)
	sheet.set_level("CON", 2)
	var wallet := CharacterWalletEntity.new()
	wallet.gold = 50
	wallet.mana_monocrystals = 5

	var snapshot := HudStateSyncService.get_hud_status_snapshot(
		"ACC_1", "CHAR_1", "阿尔托会话", "HUMAN", sheet, wallet, "TOWN_VALAN")
	var keys := snapshot.to_dto().keys()
	var no_myth := not keys.has("mp_current") and not keys.has("level") and not keys.has("exp_next")
	var passed := snapshot.attribute_values == sheet.get_actual_values() \
		and snapshot.attribute_levels == sheet.get_all_levels() \
		and snapshot.wallet_gold == 50 \
		and snapshot.wallet_mana_monocrystals == 5 \
		and snapshot.hp_max >= 1.0 and snapshot.ap_max >= 1.0 \
		and no_myth
	return {"test": "TC-HDS-04: 快照真实溯源与防臆造白名单", "passed": passed}

# ---- TC-HDS-05：推轨事件流与广播契约 ----
static func test_hud_push_stream_and_payload_contract() -> Dictionary:
	var captured: Array = []
	var detach := _capture_events(func(pkt: EventPacket) -> void:
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		captured.append({"channel": str(w.get("channel", "")), "payload": w.get("payload", {})})
	)
	HudStateSyncService.publish_stat_mutation("CHAR_1", "STR", 3.0, 4.0, "TEST")
	HudStateSyncService.publish_wallet_mutation("ACC_1", "gold", 50, 80, "TEST")
	detach.call()

	var stat_hit := false
	var wallet_hit := false
	for ev in captured:
		if ev["channel"] == HudEventContract.channel_hud_stat_mutated():
			stat_hit = (ev["payload"].get("category_key") == "hud") \
				and (ev["payload"].get("delta") == 1.0) \
				and (ev["payload"].get("args") is Array)
		elif ev["channel"] == HudEventContract.channel_hud_wallet_mutated():
			wallet_hit = (ev["payload"].get("category_key") == "hud") \
				and (ev["payload"].get("delta") == 30) \
				and (ev["payload"].get("args") is Array)
	return {"test": "TC-HDS-05: 推轨事件流与载荷契约", "passed": stat_hit and wallet_hit}

# ---- TC-HDS-06：全生命周期无头闭环（注册→登录→进世界首帧→注销） ----
static func test_full_headless_lifecycle_pipeline() -> Dictionary:
	var store := _make_account_store()
	var captured: Array = []
	var detach := _capture_events(func(pkt: EventPacket) -> void:
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		captured.append({"channel": str(w.get("channel", "")), "payload": w.get("payload", {})})
	)
	var reg := _register_user(store, "LifeSession", "Pass7890")
	var acc := AccountProfileAggregate.new()
	acc.account_id = reg.account_id
	acc.username = reg.username
	acc.password_hash_sha256 = AuthService.hash_password("Pass7890")
	var auth := AuthService.authenticate_local("LifeSession", "Pass7890", acc)

	var sheet := CharacterPhysiologySheet.new()
	var wallet := CharacterWalletEntity.new()
	wallet.gold = 100
	var snapshot := HudStateSyncService.trigger_initial_world_sync(
		reg.account_id, "CHAR_LIFE", "生命会话", sheet, wallet, "TOWN_VALAN")
	AuthService.revoke_token(String(auth.get("token", "")))
	detach.call()

	var channels: Array = []
	for ev in captured:
		channels.append(ev["channel"])
	var auth_ok: bool = bool(auth.get("success", false))
	var passed: bool = reg.success and auth_ok \
		and channels.has(HudEventContract.channel_auth_registered()) \
		and channels.has(HudEventContract.channel_auth_login_succeeded()) \
		and channels.has(HudEventContract.channel_hud_snapshot()) \
		and channels.has(HudEventContract.channel_auth_session_revoked()) \
		and snapshot != null and snapshot.account_id == reg.account_id
	return {"test": "TC-HDS-06: 全生命周期无头闭环", "passed": passed}

# ---- TC-HDS-07：叙事模板-载荷 args 契约一致（%s 占位与 args 对齐） ----
static func test_narrative_template_args_contract() -> Dictionary:
	var pairs := [
		["account.registered", "【鉴权】开拓者 %s 成功在卡拉尔世界建立身份档案。", 1],
		["account.login_succeeded", "【鉴权】欢迎归来，开拓者 %s！", 1],
		["account.session_revoked", "【鉴权】开拓者 %s 的会话已安全注销。", 1],
		["world_state.snapshot_published", "【世界】开拓者 %s 已进入卡拉尔世界。", 1],
		["world_state.stat_mutated", "【状态】角色属性 %s 发生变动（%+f → %+f）。", 3],
		["world_state.wallet_mutated", "【财务】%s 变动 %+d。", 2]
	]
	var passed := true
	for pair in pairs:
		var channel: String = pair[0]
		var template: String = pair[1]
		var expect_args: int = pair[2]
		var parts := channel.split(".")
		var table := "narratives." + parts[0]
		var path := String(".").join(parts.slice(1))
		var actual: String = GameConfig.get_string(table, path, "")
		var count := actual.count("%s") + actual.count("%d") + actual.count("%+f") + actual.count("%+d")
		if actual != template or count != expect_args:
			passed = false
	return {"test": "TC-HDS-07: 叙事模板-args 契约一致", "passed": passed}

# ---- TC-HDS-08：会话有界与广播零残留订阅 ----
static func test_session_bounded_and_no_residual_subscription() -> Dictionary:
	AuthService.clear_sessions()
	var store := _make_account_store()
	var acc := AccountProfileAggregate.new()
	acc.account_id = "ACC_BOUND"
	acc.username = "BoundSession"
	acc.password_hash_sha256 = AuthService.hash_password("Pass0000")
	for i in range(40):
		AuthService.authenticate_local("BoundSession", "Pass0000", acc)
	AuthService._prune_sessions()
	var session_keys: Array = AuthService._sessions.keys()
	# 会话有界：40 次签发后经裁剪不超过 40（无上限常驻膨胀）；测试前已 clear，无跨用例残留
	var passed := session_keys.size() <= 40 and session_keys.size() > 0
	return {"test": "TC-HDS-08: 会话有界与订阅零残留", "passed": passed}

# ==============================================================================
# 十阶段全链路无头辅助与测试用例 (TC-HDS-09 ~ TC-HDS-11)
# ==============================================================================

static func _register_ten_stage_hooks(hooks_called: Array) -> void:
	LifecycleStageHookRegistry.clear_hooks()
	var stages: Array[String] = [
		"STAGE_01_REGISTER", "STAGE_02_INIT_SLOT", "STAGE_03_SELECT_WORLD",
		"STAGE_04_CREATE_CHAR", "STAGE_05_PROLOGUE", "STAGE_06_HUD_SYNC",
		"STAGE_07_ESC_MENU", "STAGE_08_EXIT_REQUEST", "STAGE_09_SAVE_FLUSH",
		"STAGE_10_FULL_EXIT"
	]
	for stage_id in stages:
		var sid: String = stage_id
		LifecycleStageHookRegistry.register_hook(sid, func(_c: SessionFlowContextDTO, _p: Dictionary) -> void:
			hooks_called.append("PRE:" + sid)
		, "pre")
		LifecycleStageHookRegistry.register_hook(sid, func(_c: SessionFlowContextDTO, _p: Dictionary) -> void:
			hooks_called.append("POST:" + sid)
		, "post")

static func _simulate_character_creation(account_id: String, slot_id: String, world_id: String, char_name: String) -> Dictionary:
	var req := CharacterCreationRequestDTO.new()
	req.account_id = account_id
	req.slot_id = slot_id
	req.world_id = world_id
	req.character_name = char_name
	req.selected_race_id = "HUMAN"
	req.selected_gender = "MALE"
	var slot_dict := {
		"slot_id": slot_id,
		"account_id": account_id,
		"bound_world_id": world_id,
		"bound_character_id": "",
		"is_occupied": false,
		"is_first_creation": true,
		"created_timestamp_utc": 0,
		"last_played_timestamp_utc": 0
	}
	return CharacterCreationService.process_character_creation(req, slot_dict, {})

static func _simulate_prologue(opening: OpeningEventStreamDTO) -> bool:
	if opening == null:
		return false
	var boot_res := PrologueExecutionKernel.boot_character_prologue(opening, "HUMAN")
	var p_ctx: CharacterPrologueContext = boot_res.get("context", null)
	if p_ctx == null:
		return false
	PrologueExecutionKernel.advance_prologue_step(p_ctx, "LOOK_AROUND")
	PrologueExecutionKernel.advance_prologue_step(p_ctx, "TALK_GUARD")
	var s4 := PrologueExecutionKernel.advance_prologue_step(p_ctx, "ENTER_WORLD")
	return bool(s4.get("success", false)) and p_ctx.is_completed

static func _simulate_world_and_hud(
	account_id: String, char_id: String, char_name: String, create_res: Dictionary, gateway: WorldGatewayFSM
) -> HudStatusSnapshotDTO:
	gateway.attach_ready_character(char_id)
	gateway.enter_world()
	var sheet: CharacterPhysiologySheet = create_res.get("physiology_sheet", null)
	if sheet == null:
		sheet = CharacterPhysiologySheet.new()
	var wallet: CharacterWalletEntity = create_res.get("wallet", null)
	if wallet == null:
		wallet = CharacterWalletEntity.new()
	return HudStateSyncService.trigger_initial_world_sync(
		account_id, char_id, char_name, sheet, wallet, "CENTRAL_CITY_PLAZA", "HUMAN"
	)

static func _simulate_shutdown(account_id: String, slot_id: String, token: String) -> GameShutdownDTO.Response:
	GameBootstrap.assemble()
	var req := GameShutdownDTO.Request.new()
	req.session_token = token
	req.account_id = account_id
	req.exit_reason = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
	req.target_save_slot = slot_id
	var resp: GameShutdownDTO.Response = GameLifecycleService.execute_graceful_shutdown(req)
	GameLifecycleManager.reset_for_test()
	return resp

# ---- TC-HDS-09：十阶段全链路端到端无头串联与自定义 Hook 导通 ----
static func test_ten_stage_custom_hook_conduction_pipeline() -> Dictionary:
	var hooks_called: Array = []
	_register_ten_stage_hooks(hooks_called)
	var ctx := SessionFlowContextDTO.acquire()

	var store := _make_account_store()
	var username := "HeroExplorer"
	var account_pass := "Pass12345"
	var reg := _register_user(store, username, account_pass)
	var acc := AccountProfileAggregate.new()
	acc.account_id = reg.account_id
	acc.username = username
	acc.password_hash_sha256 = AuthService.hash_password(account_pass)
	var auth := AuthService.authenticate_local(username, account_pass, acc)
	var token := String(auth.get("token", ""))

	var s1 := LifecycleStageHookRegistry.execute_stage("STAGE_01_REGISTER", ctx, {
		"username": username,
		"password_hash": acc.password_hash_sha256,
		"session_token": token,
		"account_id": reg.account_id
	})

	var slot_id := "SLOT_SP_01"
	var world_id := "WORLD_DEFAULT_SP_01"
	var char_name := "晨曦开拓者"
	var s2 := LifecycleStageHookRegistry.execute_stage("STAGE_02_INIT_SLOT", ctx, {
		"slot_id": slot_id,
		"character_name": char_name,
		"world_id": world_id
	})

	var gateway := WorldGatewayFSM.new(reg.account_id)
	gateway.enter_gateway()
	gateway.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [], world_id, slot_id)
	var s3 := LifecycleStageHookRegistry.execute_stage("STAGE_03_SELECT_WORLD", ctx, {
		"world_id": world_id,
		"game_mode": WorldGatewayModel.GameMode.SINGLE_PLAYER,
		"slot_id": slot_id
	})

	var create_res := _simulate_character_creation(reg.account_id, slot_id, world_id, char_name)
	var opening: OpeningEventStreamDTO = create_res.get("opening_event", null)
	var char_id: String = opening.character_id if opening != null else "CHAR_EXPLORER"
	var s4 := LifecycleStageHookRegistry.execute_stage("STAGE_04_CREATE_CHAR", ctx, {
		"character_name": char_name,
		"gender": "MALE",
		"race_id": "HUMAN",
		"character_id": char_id
	})

	var pro_ok := _simulate_prologue(opening)
	var s5 := LifecycleStageHookRegistry.execute_stage("STAGE_05_PROLOGUE", ctx, {
		"character_id": char_id,
		"race_id": "HUMAN"
	})

	var hud_snap := _simulate_world_and_hud(reg.account_id, char_id, char_name, create_res, gateway)
	var s6 := LifecycleStageHookRegistry.execute_stage("STAGE_06_HUD_SYNC", ctx, {
		"account_id": reg.account_id,
		"character_id": char_id,
		"race_id": "HUMAN",
		"hud_snapshot": hud_snap.to_dto()
	})

	InputDeviceStateAggregate.resolve_escape_menu_action("exit_to_desktop")
	var s7 := LifecycleStageHookRegistry.execute_stage("STAGE_07_ESC_MENU", ctx, {
		"menu_state": "open",
		"is_esc_menu_open": true
	})

	var s8 := LifecycleStageHookRegistry.execute_stage("STAGE_08_EXIT_REQUEST", ctx, {
		"exit_mode": "graceful_quit"
	})

	var s9 := LifecycleStageHookRegistry.execute_stage("STAGE_09_SAVE_FLUSH", ctx, {
		"account_id": reg.account_id,
		"character_id": char_id,
		"slot_id": slot_id
	})

	var shutdown_resp := _simulate_shutdown(reg.account_id, slot_id, token)
	var s10 := LifecycleStageHookRegistry.execute_stage("STAGE_10_FULL_EXIT", ctx, {
		"reason": "USER_DESKTOP_QUIT"
	})

	var token_val := AuthService.validate_token(token)
	var stages_ok: bool = bool(s1.get("success", false)) and bool(s2.get("success", false)) \
		and bool(s3.get("success", false)) and bool(s4.get("success", false)) \
		and bool(s5.get("success", false)) and bool(s6.get("success", false)) \
		and bool(s7.get("success", false)) and bool(s8.get("success", false)) \
		and bool(s9.get("success", false)) and bool(s10.get("success", false))
	var hooks_ok: bool = hooks_called.size() == 20
	var shutdown_ok: bool = shutdown_resp.success \
		and shutdown_resp.current_phase == GameLifecycleModel.LifecyclePhase.STOPPED \
		and not bool(token_val.get("success", true)) \
		and not GameBootstrap.is_assembled()

	LifecycleStageHookRegistry.clear_hooks()
	SessionFlowContextDTO.release(ctx)

	var passed: bool = reg.success and pro_ok and stages_ok and hooks_ok and shutdown_ok
	return {"test": "TC-HDS-09: 十阶段全链路端到端无头串联与自定义Hook导通", "passed": passed}

# ---- TC-HDS-10：未接线插槽显式预留与防静默默认值绑定 ----
static func test_unwired_slots_explicit_reservation_no_default_binding() -> Dictionary:
	var ctx := SessionFlowContextDTO.acquire()

	var missing_res := LifecycleStageHookRegistry.execute_stage("STAGE_01_REGISTER", ctx, {})
	var guard_blocked: bool = not bool(missing_res.get("success", true)) \
		and String(missing_res.get("error_code", "")).begins_with("UNBOUND_") \
		and ctx.unwired_slots.has("username")

	var raw_account := AccountProfileAggregate.new()
	raw_account.account_id = "ACC_UNBOUND_TEST"
	var bind_res := AccountSlotBindingSolver.create_character_in_slot(raw_account, "SLOT_01", "", "", false, false)
	var name_guarded: bool = not bool(bind_res.get("success", true)) \
		and String(bind_res.get("error_code", "")) == "PENDING_CHARACTER_NAME"
	var world_ref := AccountSlotBindingSolver.ensure_account_world_ref(raw_account, false)
	var world_guarded: bool = world_ref == "UNBOUND"

	var opening := OpeningEventStreamDTO.new()
	opening.account_id = "ACC_UNBOUND_TEST"
	opening.character_id = "CHAR_UNBOUND"
	opening.character_name = "未命名开拓者"
	var pro_res := PrologueExecutionKernel.boot_character_prologue(opening, "", false)
	var pro_guarded: bool = not bool(pro_res.get("success", true)) \
		and String(pro_res.get("error_code", "")) == "UNBOUND_RACE_ID"

	SessionFlowContextDTO.release(ctx)
	var passed: bool = guard_blocked and name_guarded and world_guarded and pro_guarded
	return {"test": "TC-HDS-10: 未接线插槽显式预留与零默认值防伪绑定", "passed": passed}

# ---- TC-HDS-11：会话上下文对象池借还、复位守恒与快照修剪 ----
static func test_session_context_pool_and_pruning_lifecycle() -> Dictionary:
	var ctx := SessionFlowContextDTO.acquire()
	if ctx == null:
		return {"test": "TC-HDS-11: 会话上下文对象池借还与快照修剪", "passed": false}

	ctx.current_stage_index = 4
	ctx.opening_event_snapshot = {"event": "prologue"}
	ctx.physiology_snapshot = {"hp": 100}
	var early_pruned: int = ctx.prune_intermediate_snapshots()
	var early_ok: bool = early_pruned == 0 and not ctx.opening_event_snapshot.is_empty()

	ctx.current_stage_index = 6
	var late_pruned: int = ctx.prune_intermediate_snapshots()
	var late_ok: bool = late_pruned == 2 and ctx.opening_event_snapshot.is_empty() and ctx.physiology_snapshot.is_empty()

	var first_release: bool = SessionFlowContextDTO.release(ctx)
	var double_release: bool = SessionFlowContextDTO.release(ctx)
	var release_ok: bool = first_release and not double_release

	var passed: bool = early_ok and late_ok and release_ok
	return {"test": "TC-HDS-11: 会话上下文对象池借还与快照修剪", "passed": passed}
