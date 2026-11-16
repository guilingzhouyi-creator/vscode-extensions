# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_full_chain_backend_protocol_and_lifecycle_pipeline.gd
# 架构定位: Integration Test Pipeline / Full-Chain Acceptance Harness
# 依赖与触发: 上游: TestRegistry | 下游: account, world_gateway, character_creation,
#           world_state, lifecycle, persistence_protocol
# 职责说明: 全 11 环前后端交互协议数据流与后端流转无头集成验收流水线，
#           涵盖端到端正向流转、EventBus双载荷与分流、序章交接精度、HUD常驻与节流、
#           ESC防残缺覆盖、活跃世界禁切网关、令牌脱敏注销、诚实停机失败及对称解体守恒。
# 退出语义与设计依据: 全流程数据流交互契约规约 (TC-CHAIN-01 ~ TC-CHAIN-10, ADV-PRF-002)
# ==============================================================================

class_name TestFullChainBackendProtocolAndLifecyclePipeline
extends TestCase

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_chain_01_full_eleven_link_backend_protocol_e2e())
	results.append(test_chain_02_event_packet_dual_payload_and_channel_isolation())
	results.append(test_chain_03_prologue_handoff_l3_attrs_and_location_continuity())
	results.append(test_chain_04_resident_hud_dirty_throttling_and_source_parity())
	results.append(test_chain_05_esc_exit_blocks_three_field_stub_overwrite())
	results.append(test_chain_06_active_world_blocks_hot_swap_and_exit_refreshes_probe())
	results.append(test_chain_07_session_token_vault_masking_and_logout_revocation())
	results.append(test_chain_08_honest_shutdown_failure_vs_force_quit_degradation())
	results.append(test_chain_09_double_cycle_bootstrap_teardown_symmetry())
	results.append(test_chain_10_protocol_pool_and_deterministic_high_freq_conservation())
	_teardown_env()
	return TestCase.pack_results("全流程前后端交互协议与后端联调验收流水线", results)

static func _setup_env() -> void:
	TestFullChainBackendHelper.setup_env()

static func _teardown_env() -> void:
	TestFullChainBackendHelper.teardown_env()

static func _dispatch(domain: String, action_type: String, payload: Dictionary = {}, token: String = "", account_id: String = "", character_id: String = "") -> UnifiedResponseEnvelopeDTO:
	return TestFullChainBackendHelper.dispatch(domain, action_type, payload, token, account_id, character_id)

## TC-CHAIN-01: 全 11 环纯协议端到端流转（无需前端视图即可独立跑通）
static func test_chain_01_full_eleven_link_backend_protocol_e2e() -> Dictionary:
	_setup_env()

	# 1. 注册并自动登录
	var r_reg := _dispatch("account", "REGISTER_ACCOUNT", {
		"username": "chain_hero_e2e",
		"password_plain": "SecretPass999",
		"device_fingerprint": "FP_CHAIN_01",
		"auto_login": true
	})
	var acc_id := String(r_reg.data.get("account_id", ""))
	var token := String(r_reg.data.get("session_token", ""))
	var ok_1: bool = r_reg.success and not acc_id.is_empty() and not token.is_empty()

	# 2. 进入网关并选择单机世界档案
	var r_gw := _dispatch("world_gateway", "ENTER_GATEWAY", {}, token, acc_id)
	var r_sel := _dispatch("world_gateway", "SELECT_OR_CREATE_WORLD", {
		"target_mode": WorldGatewayModel.GameMode.SINGLE_PLAYER,
		"world_id": "WORLD_CHAIN_E2E",
		"world_name": "Kalar_Chain_World",
		"slot_id": "SLOT_99",
		"create_if_missing": true
	}, token, acc_id)
	var ok_2: bool = r_gw.success and not (r_gw.data.get("probe_reports", {}) as Dictionary).is_empty() and r_sel.success

	# 3. 权威创角（自动派生属性与开局事件流，启动序章）
	var r_char := _dispatch("character_creation", "CREATE_AUTHORITATIVE_CHARACTER", {
		"world_id": "WORLD_CHAIN_E2E",
		"slot_id": "SLOT_99",
		"slot_index": 99,
		"character_name": "ValenChain",
		"request_seed": 778899
	}, token, acc_id)
	var char_id := String(r_char.data.get("character_id", ""))
	var ok_3: bool = r_char.success and not char_id.is_empty() and bool(r_char.data.get("prologue_started", false))

	# 4. 序章推进 + 无头 CG 触发与完结交接至探索态
	var r_adv := _dispatch("prologue", "ADVANCE_PROLOGUE", {"choice_id": "NEXT"}, token, acc_id, char_id)
	var r_done := _dispatch("prologue", "COMPLETE_PROLOGUE", {"cutscene_id": "cs_prologue_awakening"}, token, acc_id, char_id)
	var init_snap: Dictionary = r_done.data.get("initial_hud_snapshot", {})
	var receipt := PrologueCutscenePort.get_last_receipt()
	var ok_4: bool = r_adv.success and r_done.success and bool(r_done.data.get("completed", false)) \
		and String(init_snap.get("character_id", "")) == char_id \
		and bool(receipt.get("executed", false)) and String(receipt.get("cutscene_id", "")) == "cs_prologue_awakening"

	# 5. 主页 HUD 常驻拉取 + 世界时钟推进同步
	var r_hud := _dispatch("world_state", "PULL_HUD_SNAPSHOT", {}, token, acc_id, char_id)
	var r_tick := _dispatch("world_state", "TICK_WORLD_CLOCK", {"clock_hours_delta": 6, "wallet_gold_delta": 120}, token, acc_id, char_id)
	var pulled_snap: Dictionary = r_hud.data.get("hud_snapshot", {})
	var ticked_snap: Dictionary = r_tick.data.get("hud_snapshot", {})
	var ok_5: bool = r_hud.success and bool(r_hud.data.get("world_active", false)) \
		and String(pulled_snap.get("character_id", "")) == char_id \
		and int(ticked_snap.get("wallet_gold", 0)) == int(pulled_snap.get("wallet_gold", 0)) + 120

	# 6 & 7. ESC 菜单状态 + 安全存档 + 退出世界返回网关
	var r_esc_state := _dispatch("world_state", "ESC_GET_MENU_STATE", {}, token, acc_id, char_id)
	var r_esc_save := _dispatch("world_state", "ESC_SAVE_GAME", {"slot_id": "SLOT_99"}, token, acc_id, char_id)
	var r_exit_world := _dispatch("world_state", "ESC_EXIT_TO_GATEWAY", {"slot_id": "SLOT_99", "auto_save": true}, token, acc_id, char_id)
	var ok_6_7: bool = r_esc_state.success and bool(r_esc_state.data.get("can_save", false)) \
		and r_esc_save.success and r_exit_world.success and not WorldSessionRuntimeService.has_active_world()

	# 8. 退出世界后合规切换运行网关模式
	var r_switch := _dispatch("world_gateway", "SWITCH_GATEWAY_MODE", {
		"target_mode": WorldGatewayModel.GameMode.SINGLE_PLAYER,
		"world_id": "WORLD_CHAIN_E2E",
		"slot_id": "SLOT_99"
	}, token, acc_id)
	var ok_8: bool = r_switch.success

	# 9 & 10. 退出账号并获取账号首页脱敏模型
	var r_logout := _dispatch("account", "LOGOUT_ACCOUNT", {}, token, acc_id)
	var r_home := _dispatch("account", "GET_ACCOUNT_HOME_VIEW_MODEL", {}, "", "")
	var ok_9_10: bool = r_logout.success and r_home.success and not bool(r_home.data.get("session_active", true)) \
		and int(r_home.data.get("known_account_count", 0)) >= 1

	# 11. 退出游戏与生命周期停机（未在世界中，skip save_before_quit 验证纯停机）
	var r_quit := _dispatch("lifecycle", "REQUEST_GRACEFUL_SHUTDOWN", {"save_before_quit": false}, "", "")
	var ok_11: bool = r_quit.success and not GameBootstrap.is_assembled()

	_teardown_env()
	var passed: bool = ok_1 and ok_2 and ok_3 and ok_4 and ok_5 and ok_6_7 and ok_8 and ok_9_10 and ok_11
	return TestCase.make_result("TC-CHAIN-01: 全 11 环纯协议端到端流转", passed, {
		"ok_1": ok_1, "ok_2": ok_2, "ok_3": ok_3, "ok_4": ok_4,
		"ok_5": ok_5, "ok_6_7": ok_6_7, "ok_8": ok_8, "ok_9_10": ok_9_10, "ok_11": ok_11
	})

## TC-CHAIN-02: EventPacket 双载荷兼容 + 专用信道分流隔离 + 零残留注销
static func test_chain_02_event_packet_dual_payload_and_channel_isolation() -> Dictionary:
	_setup_env()

	var snap_hits: Array[Dictionary] = []
	var wallet_hits: Array[Dictionary] = []
	var stat_hits: Array[Dictionary] = []
	var clock_hits: Array[Dictionary] = []
	var prologue_hits: Array[int] = [0]
	var world_hits: Array[int] = [0]

	var on_snap := func(pkt: EventPacket) -> void:
		snap_hits.append(EventPacket.extract_payload_dict(pkt))
		if pkt.payload_data is Dictionary and pkt.payload_dto != null:
			snap_hits.append({"dual_ok": true})
	var on_wallet := func(pkt: EventPacket) -> void:
		var wallet_data: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		wallet_hits.append(wallet_data)
	var on_prologue := func(_pkt: Variant) -> void:
		prologue_hits[0] += 1
	var on_world := func(_pkt: Variant) -> void:
		world_hits[0] += 1
	var on_stat := func(pkt: EventPacket) -> void:
		stat_hits.append(EventPacket.extract_payload_dict(pkt))
	var on_clock := func(pkt: EventPacket) -> void:
		clock_hits.append(EventPacket.extract_payload_dict(pkt))

	var tokens := AuthoritativeHudSyncService.subscribe_hud_channels(
		on_snap, on_wallet, on_prologue, on_world, on_stat, on_clock
	)

	var snap := AuthoritativeHudSyncService.get_authoritative_snapshot({
		"account_id": "ACC_SIG", "character_id": "CHAR_SIG", "character_name": "SigHero"
	})
	AuthoritativeHudSyncService.publish_hud_snapshot(snap)
	AuthoritativeHudSyncService.publish_stat_mutation("CHAR_SIG", "STR", 10.0, 12.0, "TRAIN")
	AuthoritativeHudSyncService.publish_wallet_mutation("ACC_SIG", "gold", 100, 350, "QUEST")
	AuthoritativeHudSyncService.publish_clock_tick(WorldCalendarEnvironmentResolver.resolve_environment(1, 2, 3, 8, 1))

	# 广播无关通用事件（不应误触发 on_prologue 与 on_world_entered）
	EventBusCore.get_instance().emit_domain_event("account.login_succeeded", {"account_id": "ACC_SIG"})
	EventBusCore.get_instance().emit_domain_event("prologue.step_advanced", {"step": 1})
	EventBusCore.get_instance().emit_domain_event("world_gateway.world_entered", {"world_id": "WORLD_01"})

	AuthoritativeHudSyncService.unsubscribe_hud_channels(tokens)
	# 注销后不再接收后续推送
	AuthoritativeHudSyncService.publish_wallet_mutation("ACC_SIG", "gold", 350, 500, "AFTER_UNSUB")

	var dual_ok: bool = snap_hits.size() == 2 and bool(snap_hits[1].get("dual_ok", false))
	var wallet_ok: bool = wallet_hits.size() == 1 and int(wallet_hits[0].get("current_gold", 0)) == 350 and int(wallet_hits[0].get("new_amount", 0)) == 350
	var split_ok: bool = stat_hits.size() == 1 and clock_hits.size() == 1 and prologue_hits[0] == 1 and world_hits[0] == 1

	_teardown_env()
	return TestCase.make_result("TC-CHAIN-02: EventPacket双载荷兼容与四信道精准分流隔离", dual_ok and wallet_ok and split_ok)

## TC-CHAIN-03: 序章交接 L3 属性与出生点无损透传至探索态 HUD
static func test_chain_03_prologue_handoff_l3_attrs_and_location_continuity() -> Dictionary:
	_setup_env()

	var gateway := WorldGatewayFSM.new("ACC_HANDOFF_01")
	gateway.enter_gateway()
	gateway.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [{"slot_id": "SLOT_H_01", "is_first_creation": true}], "WORLD_DEFAULT_SP_01", "SLOT_H_01")
	gateway.attach_ready_character("CHAR_H_01")

	var handoff := PrologueHandoffDTO.new()
	handoff.account_id = "ACC_HANDOFF_01"
	handoff.character_id = "CHAR_H_01"
	handoff.character_name = "Lancelot"
	handoff.race_id = "ELF"
	handoff.initial_gold = 320
	handoff.assigned_start_location_id = "SILVER_CITADEL"
	handoff.allocated_attributes = {"STR": 18.5, "INT": 24.0}

	var res := gateway.handoff_prologue_to_world_exploration(handoff)
	var snap: AuthoritativeHudSnapshotDTO = res.get("snapshot", null)
	var pulled := WorldSessionRuntimeService.pull_authoritative_hud_snapshot()

	var attrs_ok: bool = snap != null and is_equal_approx(float(snap.attribute_values.get("INT", 0.0)), 24.0)
	var loc_ok: bool = snap != null and snap.current_location_id == "SILVER_CITADEL" and pulled.current_location_id == "SILVER_CITADEL"
	var gold_ok: bool = snap != null and snap.wallet_gold == 320 and pulled.wallet_gold == 320

	_teardown_env()
	return TestCase.make_result("TC-CHAIN-03: 序章交接L3属性与出生点无损透传至探索态HUD", attrs_ok and loc_ok and gold_ok)

## TC-CHAIN-04: 主页 HUD 常驻后端服务真实溯源与脏标节流推送
static func test_chain_04_resident_hud_dirty_throttling_and_source_parity() -> Dictionary:
	_setup_env()

	var captured_snaps: Array[int] = [0]
	var on_snap := func(_pkt: Variant) -> void:
		captured_snaps[0] += 1
	var tok := EventBusCore.get_instance().on_channel(EventChannelDefinition.HUD_STATUS_SNAPSHOT, on_snap)

	WorldSessionRuntimeService.activate_world_session({
		"account_id": "ACC_HUD_LIVE",
		"world_id": "W_LIVE",
		"slot_id": "SLOT_LIVE",
		"character_id": "CHAR_LIVE",
		"character_name": "Kael",
		"wallet_gold": 100,
		"unallocated_potential_points": 2,
		"unread_mail_count": 0
	}, true, 1000)

	# 在同一节流窗口内连续触发多次突变（间隔 < 50ms 配置窗口）：全量快照应被节流合并
	var snaps_after_init := captured_snaps[0]
	for i in range(5):
		WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": 10}, 1000 + i * 5, false)
	var snaps_during_throttle := captured_snaps[0] - snaps_after_init

	# 超过 50ms 节流窗口后刷新
	WorldSessionRuntimeService.flush_hud_sync_if_dirty(1100, false)
	var snaps_after_window := captured_snaps[0] - snaps_after_init

	var pulled := WorldSessionRuntimeService.pull_authoritative_hud_snapshot()
	# 验证无硬编码假值（5 / 1），严格与真实会话一致
	var parity_ok: bool = pulled.unallocated_potential_points == 2 and pulled.unread_mail_count == 0 and pulled.wallet_gold == 150
	var throttle_ok: bool = snaps_after_init == 1 and snaps_during_throttle == 0 and snaps_after_window == 1

	tok.unbind()
	_teardown_env()
	return TestCase.make_result("TC-CHAIN-04: 主页HUD常驻服务真实溯源与脏标节流", parity_ok and throttle_ok)

## TC-CHAIN-05: ESC 退回网关严禁以 3 字段空壳覆盖既有真实存档
static func test_chain_05_esc_exit_blocks_three_field_stub_overwrite() -> Dictionary:
	_setup_env()

	var slot_id := "SLOT_GUARD_05"
	var real_save_data := {
		"account": {"account_id": "ACC_GUARD_05", "character": "Arthur"},
		"world_navigation": {"world_id": "W_GUARD", "day": 12},
		"inventory": {"items": ["EXCALIBUR"]}
	}
	var init_save := SaveDataAccessLayer.save_game(slot_id, real_save_data)
	var init_ok: bool = bool(init_save.get("success", false))

	var gateway := WorldGatewayFSM.new("ACC_GUARD_05")
	gateway.enter_gateway()
	gateway.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [{"slot_id": slot_id, "is_first_creation": false, "bound_character_id": "CHAR_G5"}], "WORLD_DEFAULT_SP_01", slot_id)
	gateway.enter_world()
	# 模拟意外丢失全部提供者（仅网关上下文仍绑定真实 slot_id）
	WorldSessionRuntimeService.deactivate_world_session()
	SaveDataAccessLayer.reset_for_tests()

	var bad_req := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_EXIT_TO_GATEWAY", {"slot_id": slot_id, "auto_save": true}, "", "ACC_GUARD_05", "CHAR_G5"
	)
	var bad_resp := EscMenuBackendService.handle_esc_action(bad_req, gateway)
	var stub_blocked: bool = (not bad_resp.success) and bad_resp.error_code == "ERR_INCOMPLETE_SAVE_BLOCKED"

	# 验证磁盘原完整档案毫发无损（绝不被 {slot_id, account_id, saved_at} 覆写）
	var reload := SaveDataAccessLayer.load_game(slot_id)
	var reloaded_data: Dictionary = reload.get("data", {})
	var intact_ok: bool = bool(reload.get("success", false)) and reloaded_data.has("inventory") and reloaded_data.has("account")

	_teardown_env()
	return TestCase.make_result("TC-CHAIN-05: ESC退回网关严禁3字段空壳覆盖真实存档", init_ok and stub_blocked and intact_ok)

## TC-CHAIN-06: 活跃世界严禁热切换网关模式，退出世界后同步模式闸门并刷新探针
static func test_chain_06_active_world_blocks_hot_swap_and_exit_refreshes_probe() -> Dictionary:
	_setup_env()

	var r_reg := _dispatch("account", "REGISTER_ACCOUNT", {
		"username": "chain_switch_user",
		"password_plain": "SwitchPass123",
		"device_fingerprint": "FP_SW",
		"auto_login": true
	})
	var acc_id := String(r_reg.data.get("account_id", ""))
	var token := String(r_reg.data.get("session_token", ""))
	_dispatch("world_gateway", "ENTER_GATEWAY", {}, token, acc_id)
	_dispatch("world_gateway", "SELECT_OR_CREATE_WORLD", {
		"target_mode": WorldGatewayModel.GameMode.SINGLE_PLAYER,
		"world_id": "WORLD_CHAIN_SW",
		"slot_id": "SLOT_SW_01"
	}, token, acc_id)

	var gateway := WorldSessionRuntimeService.get_gateway() as WorldGatewayFSM
	gateway.attach_ready_character("CHAR_SW_01")
	gateway.enter_world()

	# 活跃世界内强行热切换模式 -> 必须拦截
	var hot_resp := _dispatch("world_gateway", "SWITCH_GATEWAY_MODE", {
		"target_mode": WorldGatewayModel.GameMode.MULTIPLAYER
	}, token, acc_id)
	var hot_blocked: bool = (not hot_resp.success) and hot_resp.error_code == "ERR_HOT_SWAP_BLOCKED_IN_ACTIVE_WORLD"

	# 退出世界返回网关 -> RuntimeModeGate 恢复 SINGLE_PLAYER 且探针报告已刷新
	RuntimeModeGate.set_mode(RuntimeModeGate.Mode.ONLINE)
	var exit_resp := _dispatch("world_gateway", "EXIT_WORLD_TO_GATEWAY", {"auto_save": false}, token, acc_id)
	var probe_refreshed: bool = not (exit_resp.data.get("probe_reports", {}) as Dictionary).is_empty()
	var gate_reset: bool = RuntimeModeGate.is_single_player()

	# 退出后合规重选单机网关模式
	var sw_resp := _dispatch("world_gateway", "SWITCH_GATEWAY_MODE", {
		"target_mode": WorldGatewayModel.GameMode.SINGLE_PLAYER,
		"world_id": "WORLD_CHAIN_SW",
		"slot_id": "SLOT_SW_01"
	}, token, acc_id)

	_teardown_env()
	return TestCase.make_result("TC-CHAIN-06: 活跃态禁切网关与退世界模式闸门及探针刷新", hot_blocked and exit_resp.success and probe_refreshed and gate_reset and sw_resp.success)

## TC-CHAIN-07: 会话令牌内存掩码托管、LOGOUT_ACCOUNT 吊销拦截与首页脱敏模型
static func test_chain_07_session_token_vault_masking_and_logout_revocation() -> Dictionary:
	_setup_env()

	var r_reg := _dispatch("account", "REGISTER_ACCOUNT", {
		"username": "chain_vault_user",
		"password_plain": "VaultPass123",
		"device_fingerprint": "FP_VAULT",
		"auto_login": true
	})
	var acc_id := String(r_reg.data.get("account_id", ""))
	var token := String(r_reg.data.get("session_token", ""))
	var meta := AuthService.get_session_masked_metadata(token)
	var masked_ok: bool = bool(meta.get("has_masked_token", false)) and not bool(meta.get("revoked", true))

	var r_logout := _dispatch("account", "LOGOUT_ACCOUNT", {}, token, acc_id)
	var after_meta := AuthService.get_session_masked_metadata(token)
	var wiped_ok: bool = bool(after_meta.get("revoked", false)) and not bool(after_meta.get("has_masked_token", true))

	# 注销后复用旧令牌发起网关操作 -> 必须被鉴权门禁拦截 ERR_UNAUTHORIZED
	var stale_resp := _dispatch("world_gateway", "ENTER_GATEWAY", {}, token, acc_id)
	var blocked_ok: bool = (not stale_resp.success) and stale_resp.error_code == "ERR_UNAUTHORIZED"

	# 账号首页查询不泄密
	var home_resp := _dispatch("account", "GET_ACCOUNT_HOME_VIEW_MODEL", {}, "", "")
	var known: Array = home_resp.data.get("known_accounts", [])
	var leak_free: bool = not known.is_empty() and not (known[0] as Dictionary).has("password_hash_sha256") and not (known[0] as Dictionary).has("token_masked")

	_teardown_env()
	return TestCase.make_result("TC-CHAIN-07: 令牌内存脱敏与注销拦截防复发", masked_ok and r_logout.success and wiped_ok and blocked_ok and leak_free)

## TC-CHAIN-08: 生命周期诚实停机失败（require_save_success=true）vs force_quit 降级
static func test_chain_08_honest_shutdown_failure_vs_force_quit_degradation() -> Dictionary:
	_setup_env()

	# 1. 要求存档必成且非强退，在无提供者的无效空档下请求停机 -> 必须失败并进入 STOP_FAILED
	var strict_req := GameShutdownDTO.Request.new()
	strict_req.target_save_slot = "SLOT_EMPTY_STRICT"
	strict_req.save_before_quit = true
	strict_req.require_save_success = true
	strict_req.force_quit = false
	var strict_resp := GameLifecycleService.execute_graceful_shutdown(strict_req)
	var strict_failed_honestly: bool = (not strict_resp.success) \
		and (not strict_resp.is_save_completed) \
		and strict_resp.failed_stage == "flush_saves" \
		and strict_resp.current_phase == GameLifecycleModel.LifecyclePhase.STOP_FAILED \
		and GameBootstrap.is_assembled()

	# 2. 复位生命周期后改用 force_quit = true -> 记入 degraded_resources 并允许完成清理
	GameLifecycleManager.reset_for_test()
	var force_req := GameShutdownDTO.Request.new()
	force_req.target_save_slot = "SLOT_EMPTY_FORCE"
	force_req.save_before_quit = true
	force_req.require_save_success = true
	force_req.force_quit = true
	var force_resp := GameLifecycleService.execute_graceful_shutdown(force_req)
	var force_degraded_ok: bool = force_resp.success \
		and (not force_resp.is_save_completed) \
		and force_resp.degraded_resources.has("flush_saves") \
		and force_resp.current_phase == GameLifecycleModel.LifecyclePhase.STOPPED \
		and (not GameBootstrap.is_assembled())

	_teardown_env()
	return TestCase.make_result("TC-CHAIN-08: 生命周期诚实停机失败与强退降级契约", strict_failed_honestly and force_degraded_ok)

## TC-CHAIN-09: 双轮启动-会话-解体全系统对称零污染校验
static func test_chain_09_double_cycle_bootstrap_teardown_symmetry() -> Dictionary:
	_setup_env()

	# 第一轮运行并产生会话与世界状态
	WorldSessionRuntimeService.activate_world_session({
		"account_id": "ACC_CYCLE_1", "world_id": "WORLD_01", "slot_id": "SLOT_C1",
		"character_id": "CHAR_C1", "character_name": "CycleOne", "wallet_gold": 999
	}, false)
	HumanControlLeaseManager.renew_human_lease("ACC_CYCLE_1", 7)
	var td_res := GameBootstrap.teardown()
	var teared_list: Array = td_res.get("teared_down_subsystems", [])

	# 第二轮重装前校验全系统纯净初态
	var clean_after_td: bool = not GameBootstrap.is_assembled() \
		and not WorldSessionRuntimeService.has_active_world() \
		and not WorldSessionRuntimeService.has_authenticated_session() \
		and not HumanControlLeaseManager.is_lease_active() \
		and not PrologueCutscenePort.has_runner() \
		and PrologueCutscenePort.get_last_receipt().is_empty() \
		and teared_list.has("world_session_runtime") \
		and teared_list.has("save_data_access_layer")

	var reassemble := GameBootstrap.assemble()
	var second_cycle_clean: bool = bool(reassemble.get("success", false)) \
		and WorldSessionRuntimeService.get_active_slot_id().is_empty() \
		and PrologueCutscenePort.has_runner()

	_teardown_env()
	return TestCase.make_result("TC-CHAIN-09: 双轮启动与对称解体零残余污染校验", clean_after_td and second_cycle_clean)

## TC-CHAIN-10: 高频信封池化 ADV-PRF-002 借还严格守恒与确定性压测
static func test_chain_10_protocol_pool_and_deterministic_high_freq_conservation() -> Dictionary:
	_setup_env()

	var rng := DeterministicRNG.new(20261110)
	for i in range(1000):
		var req := UnifiedProtocolFactory.borrow_request_envelope()
		req.request_id = "REQ_POOL_%d" % i
		req.domain = "world_state"
		req.action_type = "PULL_HUD_SNAPSHOT"
		req.lease_nonce = rng.randi_range(1, 10000)
		var resp := UnifiedProtocolFactory.borrow_response_envelope()
		resp.request_id = req.request_id
		resp.success = true
		resp.data["seq"] = i
		UnifiedProtocolFactory.recycle_response_envelope(resp)
		UnifiedProtocolFactory.recycle_request_envelope(req)

	var stats := UnifiedProtocolFactory.get_pool_stats()
	var conserved: bool = int(stats.get("req_borrowed", -1)) == 0 \
		and int(stats.get("resp_borrowed", -1)) == 0 \
		and int(stats.get("req_pooled", 0)) > 0 \
		and int(stats.get("resp_pooled", 0)) > 0

	_teardown_env()
	return TestCase.make_result("TC-CHAIN-10: 高频信封池化ADV-PRF-002借还守恒与确定性压测", conserved, stats)
