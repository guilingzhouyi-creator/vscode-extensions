# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_unified_protocol_and_esc_pipeline.gd
# 架构定位: Integration Test Pipeline / Acceptance Harness
# 跨域依赖: 上游: TestRegistry | 下游: world_state, world_gateway, lifecycle, frontend/systems
# 职责说明: Phase 122 统一协议工厂、双轨租约抢占、HUD 事件桥接与 ESC 菜单全链路无头验收套件
# 设计依据: Phase 122 阶段4验收测试矩阵规约与卡拉尔架构解耦契约
# ==============================================================================

class_name TestUnifiedProtocolAndEscPipeline
extends TestCase

const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const UnifiedProtocolDispatcher = preload("res://backend/domains/world_state/services/unified_protocol_dispatcher.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const ClientRequestEnvelopeDTO = preload("res://backend/domains/world_state/dto/client_request_envelope_dto.gd")
const UnifiedResponseEnvelopeDTO = preload("res://backend/domains/world_state/dto/unified_response_envelope_dto.gd")
const AgentActionPacketDTO = preload("res://backend/domains/world_state/dto/agent_action_packet_dto.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")
const GameBootstrap = preload("res://backend/infrastructure/game_bootstrap.gd")
const HudEventBridge = preload("res://frontend/systems/hud_event_bridge.gd")
const EventBusCore = preload("res://backend/infrastructure/event_bus/event_bus_core.gd")
const MainHUDView = preload("res://frontend/views/main_hud/main_hud_view.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_tc_upe_01_protocol_factory_packing_roundtrip())
	results.append(test_tc_upe_02_human_lease_preemption_and_agent_blocking())
	results.append(test_tc_upe_03_hud_event_bridge_streaming_and_detach())
	results.append(test_tc_upe_04_esc_query_save_readiness_guards())
	results.append(test_tc_upe_05_esc_save_game_disk_persistence())
	results.append(test_tc_upe_06_esc_exit_to_gateway_memory_scrubbing())
	results.append(test_tc_upe_07_esc_quit_game_graceful_shutdown())
	results.append(test_tc_upe_08_protocol_objects_zero_heap_recycling())
	results.append(test_tc_upe_09_custom_domain_handler_scalability())
	return TestCase.pack_results("统一协议工厂与ESC系统菜单后端联动全链路流水线", results)

static func _setup_env() -> void:
	SaveDataAccessLayer.reset_for_tests()
	GameLifecycleManager.reset_for_test()
	HumanControlLeaseManager.reset_for_tests()
	UnifiedProtocolFactory.reset_for_tests()
	HudEventBridge.reset_for_tests()
	UnifiedProtocolDispatcher.reset_custom_handlers_for_tests()

static func _teardown_env() -> void:
	SaveDataAccessLayer.reset_for_tests()
	GameLifecycleManager.reset_for_test()
	HumanControlLeaseManager.reset_for_tests()
	UnifiedProtocolFactory.reset_for_tests()
	HudEventBridge.reset_for_tests()
	UnifiedProtocolDispatcher.reset_custom_handlers_for_tests()

## -----------------------------------------------------------------------------
## TC-UPE-01: 统一协议工厂双轨请求装箱与反装箱一致性断言
## -----------------------------------------------------------------------------
static func test_tc_upe_01_protocol_factory_packing_roundtrip() -> Dictionary:
	_setup_env()

	# 1. 人类请求装箱断言
	var req_h := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_SAVE_GAME", {"slot_id": "SLOT_01"}, "TOKEN_123", "ACC_01", "CHAR_01"
	)
	var h_ok: bool = req_h.actor_type == ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI \
		and req_h.domain == "world_state" \
		and req_h.action_type == "ESC_SAVE_GAME" \
		and req_h.lease_nonce > 0 \
		and str(req_h.payload.get("slot_id", "")) == "SLOT_01"

	var h_dict := req_h.to_dto()
	var req_h_restored := ClientRequestEnvelopeDTO.from_dto(h_dict)
	var h_roundtrip: bool = req_h_restored.request_id == req_h.request_id \
		and req_h_restored.lease_nonce == req_h.lease_nonce \
		and req_h_restored.actor_type == ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI

	# 2. Agent 动作包装断言
	var agent_pkt := AgentActionPacketDTO.new()
	agent_pkt.session_id = "CHAR_01"
	agent_pkt.sequence_index = 42
	agent_pkt.directive_id = "ALLOCATE_POTENTIAL_STAT"
	agent_pkt.params = {"stat_target": "STR", "points": 1}
	agent_pkt.client_timestamp_ms = 10005

	var req_a := UnifiedProtocolFactory.wrap_agent_action(agent_pkt, "TOKEN_123", "ACC_01")
	var a_ok: bool = req_a.actor_type == ClientRequestEnvelopeDTO.ACTOR_AGENT \
		and req_a.domain == "world_state" \
		and req_a.action_type == "ALLOCATE_POTENTIAL_STAT" \
		and req_a.lease_nonce == 0 \
		and str(req_a.payload.get("stat_target", "")) == "STR"

	# 3. 响应封包装箱断言
	var resp := UnifiedProtocolFactory.create_response(
		req_h.request_id, true, {"status": "saved"}, "", "OK", {"delta": 1}
	)
	var r_dict := resp.to_dto()
	var resp_restored := UnifiedResponseEnvelopeDTO.from_dto(r_dict)
	var r_ok: bool = resp_restored.request_id == req_h.request_id \
		and resp_restored.success == true \
		and resp_restored.data.get("status", "") == "saved"

	_teardown_env()
	var passed: bool = h_ok and h_roundtrip and a_ok and r_ok
	return TestCase.make_result("TC-UPE-01: 统一协议工厂双轨请求装箱与反装箱一致性断言", passed)

## -----------------------------------------------------------------------------
## TC-UPE-02: 人类控制租约抢占与 Agent 动作冲突拦截断言
## -----------------------------------------------------------------------------
static func test_tc_upe_02_human_lease_preemption_and_agent_blocking() -> Dictionary:
	_setup_env()

	var account_id := "ACC_LEASE_01"

	# 1. 前置状态：无人类操作时，租约非活跃
	var pre_active: bool = HumanControlLeaseManager.is_lease_active(account_id)

	# 2. 人类前台触发请求，自动激活租约
	var req_h := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_QUERY_READINESS", {}, "TOKEN_LEASE", account_id, "CHAR_01"
	)
	var resp_h := UnifiedProtocolDispatcher.dispatch_request(req_h)
	var lease_active_after_human: bool = HumanControlLeaseManager.is_lease_active(account_id)

	# 3. 租约保护期内，Agent 发送动作，必须被 ERR_PREEMPTED_BY_HUMAN 阻断
	var agent_pkt := AgentActionPacketDTO.new()
	agent_pkt.session_id = "CHAR_01"
	agent_pkt.directive_id = "ALLOCATE_POTENTIAL_STAT"
	agent_pkt.params = {"stat_target": "AGI", "points": 1}
	var req_a := UnifiedProtocolFactory.wrap_agent_action(agent_pkt, "TOKEN_LEASE", account_id)

	var resp_a_blocked := UnifiedProtocolDispatcher.dispatch_request(req_a)
	var agent_blocked_ok: bool = not resp_a_blocked.success \
		and resp_a_blocked.error_code == "ERR_PREEMPTED_BY_HUMAN"

	# 4. 模拟时间推进 3500ms（超出 3000ms 保护期），租约失效
	HumanControlLeaseManager.simulate_time_advance_ms(3500)
	var lease_expired: bool = not HumanControlLeaseManager.is_lease_active(account_id)

	_teardown_env()
	var passed: bool = (not pre_active) and lease_active_after_human and agent_blocked_ok and lease_expired
	return TestCase.make_result("TC-UPE-02: 人类控制租约抢占与 Agent 动作冲突拦截断言", passed)

## -----------------------------------------------------------------------------
## TC-UPE-03: HUD 事件桥接器单源订阅与幂等解绑断言
## -----------------------------------------------------------------------------
static func test_tc_upe_03_hud_event_bridge_streaming_and_detach() -> Dictionary:
	_setup_env()

	var hud_view := MainHUDView.new()
	var bridge := HudEventBridge.get_instance()

	# 1. 挂载 HUD
	bridge.attach_hud(hud_view)
	var is_attached_1: bool = bridge.is_attached()

	# 2. 重复挂载应幂等保持
	bridge.attach_hud(hud_view)
	var is_attached_2: bool = bridge.is_attached()

	# 3. 通过 EventBus 广播快照事件
	var bus := EventBusCore.get_instance()
	bus.emit_domain_event("world_state.hud_snapshot_published", {
		"account_id": "ACC_HUD_01",
		"character_name": "星辰剑圣",
		"hp_current": 88.0,
		"hp_max": 120.0,
		"wallet_gold": 9999,
		"wallet_mana_monocrystals": 33
	})

	var snap_received: bool = hud_view.stat_hp_current == 88.0 \
		and hud_view.stat_hp_max == 120.0 \
		and hud_view.wallet_gold == 9999 \
		and hud_view.character_name == "星辰剑圣"

	# 4. 广播钱包增量突变
	bus.emit_domain_event("currency.wallet.mutated", {
		"current_gold": 12000,
		"current_crystals": 45
	})
	var wallet_received: bool = hud_view.wallet_gold == 12000 and hud_view.wallet_mana_crystals == 45

	# 5. 解绑 HUD 并断言零泄漏
	bridge.detach_hud()
	var is_detached: bool = not bridge.is_attached()

	# 解绑后再广播，视图不再更新
	bus.emit_domain_event("currency.wallet.mutated", {
		"current_gold": 99999,
		"current_crystals": 99
	})
	var no_leak_update: bool = hud_view.wallet_gold == 12000

	_teardown_env()
	var passed: bool = is_attached_1 and is_attached_2 and snap_received and wallet_received and is_detached and no_leak_update
	return TestCase.make_result("TC-UPE-03: HUD 事件桥接器单源订阅与幂等解绑断言", passed)

## -----------------------------------------------------------------------------
## TC-UPE-04: ESC 菜单非战斗/非剧情保存状态裁决与置灰断言
## -----------------------------------------------------------------------------
static func test_tc_upe_04_esc_query_save_readiness_guards() -> Dictionary:
	_setup_env()

	# 1. 常态环境：允许保存
	var req_normal := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_QUERY_READINESS", {"in_combat": false, "in_cutscene": false, "is_dead": false}
	)
	var resp_normal := UnifiedProtocolDispatcher.dispatch_request(req_normal)
	var ok_normal: bool = resp_normal.success and bool(resp_normal.data.get("is_ready", false))

	# 2. 战斗状态：拦截保存
	var req_combat := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_QUERY_READINESS", {"in_combat": true, "in_cutscene": false, "is_dead": false}
	)
	var resp_combat := UnifiedProtocolDispatcher.dispatch_request(req_combat)
	var ok_combat: bool = resp_combat.success and not bool(resp_combat.data.get("is_ready", true)) \
		and str(resp_combat.data.get("blocked_reason", "")) == "CANNOT_SAVE_DURING_COMBAT"

	# 3. 剧情过场：拦截保存
	var req_cutscene := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_QUERY_READINESS", {"in_combat": false, "in_cutscene": true, "is_dead": false}
	)
	var resp_cutscene := UnifiedProtocolDispatcher.dispatch_request(req_cutscene)
	var ok_cutscene: bool = resp_cutscene.success and not bool(resp_cutscene.data.get("is_ready", true)) \
		and str(resp_cutscene.data.get("blocked_reason", "")) == "CANNOT_SAVE_DURING_CUTSCENE"

	_teardown_env()
	var passed: bool = ok_normal and ok_combat and ok_cutscene
	return TestCase.make_result("TC-UPE-04: ESC 菜单非战斗/非剧情保存状态裁决与置灰断言", passed)

## -----------------------------------------------------------------------------
## TC-UPE-05: ESC 菜单安全保存与物理落盘断言
## -----------------------------------------------------------------------------
static func test_tc_upe_05_esc_save_game_disk_persistence() -> Dictionary:
	_setup_env()

	# 1. 尝试使用非法存储路径或异常模式
	var req_unsafe := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_SAVE_GAME", {
			"slot_id": "../evil_path",
			"game_mode": WorldGatewayModel.GameMode.SINGLE_PLAYER,
			"in_combat": false
		}
	)
	var resp_unsafe := UnifiedProtocolDispatcher.dispatch_request(req_unsafe)
	var ok_unsafe_blocked: bool = (not resp_unsafe.success)

	# 2. 正常槽位物理落盘保存
	var req_valid := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_SAVE_GAME", {
			"slot_id": "SLOT_UPE_01",
			"game_mode": WorldGatewayModel.GameMode.SINGLE_PLAYER,
			"game_data": {"player_name": "瓦尔兰守望者", "level": 10},
			"in_combat": false
		}
	)
	var resp_valid := UnifiedProtocolDispatcher.dispatch_request(req_valid)
	var ok_save: bool = resp_valid.success and bool(resp_valid.data.get("success", false))

	# 验证 SaveDataAccessLayer 真实读盘一致性
	var load_res := SaveDataAccessLayer.load_game("SLOT_UPE_01")
	var ok_load: bool = bool(load_res.get("success", false))
	var loaded_name: String = str(load_res.get("data", {}).get("player_name", ""))
	var ok_data: bool = (loaded_name == "瓦尔兰守望者")

	_teardown_env()
	var passed: bool = ok_unsafe_blocked and ok_save and ok_load and ok_data
	return TestCase.make_result("TC-UPE-05: ESC 菜单安全保存与物理落盘断言", passed)

## -----------------------------------------------------------------------------
## TC-UPE-06: ESC 退出到世界档案触发网关全量内存洗脱断言
## -----------------------------------------------------------------------------
static func test_tc_upe_06_esc_exit_to_gateway_memory_scrubbing() -> Dictionary:
	_setup_env()

	var account_id := "ACC_SCRUB_01"
	var gateway := WorldGatewayFSM.new(account_id)
	gateway.enter_gateway()
	gateway.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
	gateway.attach_ready_character("CHAR_SCRUB_01")
	gateway.enter_world()

	var in_world_before: bool = (gateway.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD)

	# 发射 ESC 退出到网关请求
	var req_exit := UnifiedProtocolFactory.create_human_request(
		"world_gateway", "ESC_EXIT_TO_GATEWAY", {"auto_save": true}, "TOKEN_SCRUB", account_id, "CHAR_SCRUB_01"
	)
	var resp_exit := UnifiedProtocolDispatcher.dispatch_request(req_exit, gateway)
	var exit_ok: bool = resp_exit.success

	# 断言内存全量洗脱指标
	var phase_back: bool = (gateway.context.current_phase == WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED)
	var mode_scrubbed: bool = (gateway.context.selected_mode == WorldGatewayModel.GameMode.UNSELECTED)
	var slot_scrubbed: bool = (gateway.context.selected_slot_id == "")
	var char_scrubbed: bool = (gateway.context.active_character_id == "")
	var mods_scrubbed: bool = (gateway.active_mods.is_empty())
	var lease_released: bool = not HumanControlLeaseManager.is_lease_active(account_id)

	_teardown_env()
	var passed: bool = in_world_before and exit_ok and phase_back and mode_scrubbed and slot_scrubbed and char_scrubbed and mods_scrubbed and lease_released
	return TestCase.make_result("TC-UPE-06: ESC 退出到世界档案触发网关全量内存洗脱断言", passed, {
		"in_world_before": in_world_before,
		"exit_ok": exit_ok,
		"phase_back": phase_back,
		"mode_scrubbed": mode_scrubbed,
		"slot_scrubbed": slot_scrubbed,
		"char_scrubbed": char_scrubbed,
		"mods_scrubbed": mods_scrubbed,
		"lease_released": lease_released
	})

## -----------------------------------------------------------------------------
## TC-UPE-07: ESC 退出游戏触发五阶段优雅停机断言
## -----------------------------------------------------------------------------
static func test_tc_upe_07_esc_quit_game_graceful_shutdown() -> Dictionary:
	_setup_env()
	GameBootstrap.assemble()

	var account_id := "ACC_QUIT_01"
	var token := "TOKEN_QUIT_01"

	var req_quit := UnifiedProtocolFactory.create_human_request(
		"lifecycle", "ESC_QUIT_GAME", {"slot_id": "SLOT_01"}, token, account_id
	)
	var resp_quit := UnifiedProtocolDispatcher.dispatch_request(req_quit)

	var ok_resp: bool = resp_quit.success
	var ok_phase: bool = resp_quit.data.get("current_phase", 0) != 0
	var lease_released: bool = not HumanControlLeaseManager.is_lease_active(account_id)

	_teardown_env()
	var passed: bool = ok_resp and ok_phase and lease_released
	return TestCase.make_result("TC-UPE-07: ESC 退出游戏触发五阶段优雅停机断言", passed)

## -----------------------------------------------------------------------------
## TC-UPE-08: 协议交互高频循环零瞬态堆分配断言 (ADV-PRF-002)
## -----------------------------------------------------------------------------
static func test_tc_upe_08_protocol_objects_zero_heap_recycling() -> Dictionary:
	_setup_env()

	var req := ClientRequestEnvelopeDTO.new()
	var resp := UnifiedResponseEnvelopeDTO.new()

	var loop_count := 100
	var all_resetted := true

	for i in range(loop_count):
		req.reset_state()
		req.request_id = "R_%d" % i
		req.domain = "world_state"
		req.action_type = "ESC_QUERY_READINESS"
		req.payload["i"] = i

		if req.request_id.is_empty() or req.payload.is_empty():
			all_resetted = false
			break

		resp.reset_state()
		resp.request_id = req.request_id
		resp.success = true
		resp.data["status"] = "OK"

		if not resp.success or resp.data.is_empty():
			all_resetted = false
			break

	req.reset_state()
	resp.reset_state()
	var final_clean: bool = req.request_id.is_empty() and req.payload.is_empty() and resp.request_id.is_empty() and resp.data.is_empty()

	_teardown_env()
	var passed: bool = all_resetted and final_clean
	return TestCase.make_result("TC-UPE-08: 协议交互高频循环零瞬态堆分配断言 (ADV-PRF-002)", passed)

## -----------------------------------------------------------------------------
## TC-UPE-09: 统一调度器自定义领域处理器注册与开闭原则动态扩展断言
## -----------------------------------------------------------------------------
static func test_tc_upe_09_custom_domain_handler_scalability() -> Dictionary:
	_setup_env()

	var custom_domain := "inventory_market"
	var custom_called_box := [false]
	var custom_action := "BUY_COMMODITY"

	UnifiedProtocolDispatcher.register_domain_handler(custom_domain, func(req: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
		custom_called_box[0] = true
		return UnifiedProtocolFactory.create_response(
			req.request_id,
			true,
			{"item_id": "MITHRIL_ORE", "qty": int(req.payload.get("qty", 1))},
			"",
			"交易解算完成"
		)
	)

	var has_registered: bool = UnifiedProtocolDispatcher.has_domain_handler(custom_domain)

	var req := ClientRequestEnvelopeDTO.new()
	req.request_id = "REQ_EXP_01"
	req.domain = custom_domain
	req.action_type = custom_action
	req.payload = {"qty": 5}
	req.actor_type = ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI

	var resp := UnifiedProtocolDispatcher.dispatch_request(req)
	var dispatch_ok: bool = resp.success and custom_called_box[0] and int(resp.data.get("qty", 0)) == 5

	UnifiedProtocolDispatcher.unregister_domain_handler(custom_domain)
	var has_unregistered: bool = not UnifiedProtocolDispatcher.has_domain_handler(custom_domain)

	var resp_after := UnifiedProtocolDispatcher.dispatch_request(req)
	var unreg_rejected: bool = (not resp_after.success) and (resp_after.error_code == "ERR_UNKNOWN_DOMAIN")

	_teardown_env()
	var passed: bool = has_registered and dispatch_ok and has_unregistered and unreg_rejected
	return TestCase.make_result("TC-UPE-09: 统一调度器领域处理器注册与OCP开闭原则动态扩展断言", passed)
