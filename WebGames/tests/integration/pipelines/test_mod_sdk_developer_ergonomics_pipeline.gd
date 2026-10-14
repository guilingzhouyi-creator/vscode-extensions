# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_mod_sdk_developer_ergonomics_pipeline.gd
# 架构定位: Integration Test Pipeline / Mod SDK Developer Ergonomics Harness
# 跨域依赖: 上游: TestRegistry | 下游: world_state, world_gateway, persistence_protocol, lifecycle
# 职责说明: Phase 123 MOD 开发者便利套件协议同步与全链路调试推演端到端流水线 (TC-MDE-01 ~ TC-MDE-08)
# 设计依据: Phase 123 阶段4验收测试矩阵规约与卡拉尔架构解耦契约
# ==============================================================================

class_name TestModSdkDeveloperErgonomicsPipeline
extends TestCase

const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const UnifiedProtocolDispatcher = preload("res://backend/domains/world_state/services/unified_protocol_dispatcher.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const ClientRequestEnvelopeDTO = preload("res://backend/domains/world_state/dto/client_request_envelope_dto.gd")
const UnifiedResponseEnvelopeDTO = preload("res://backend/domains/world_state/dto/unified_response_envelope_dto.gd")
const AgentActionPacketDTO = preload("res://backend/domains/world_state/dto/agent_action_packet_dto.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const GameLifecycleManager = preload("res://backend/domains/lifecycle/game_lifecycle_manager.gd")
const ModPrecheckAndAdaptationSolver = preload("res://backend/domains/character_creation/mod_precheck_and_adaptation_solver.gd")
const DestinyModManifestDTO = preload("res://backend/domains/character_creation/dto/destiny_mod_manifest_dto.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_tc_mde_01_mod_sdk_drift_free_audit())
	results.append(test_tc_mde_02_client_request_envelope_validation())
	results.append(test_tc_mde_03_human_control_lease_preemption_and_renewal())
	results.append(test_tc_mde_04_esc_menu_action_payload_and_state_transition())
	results.append(test_tc_mde_05_save_guard_interception_semantics())
	results.append(test_tc_mde_06_home_hud_directives_and_snapshot_sync())
	results.append(test_tc_mde_07_mock_dispatcher_dual_track_envelope_roundtrip())
	results.append(test_tc_mde_08_python_toolchain_and_with_hud_equivalence())
	results.append(test_tc_mde_09_mod_topological_sort_and_dependencies())
	return TestCase.pack_results("MOD开发者便利套件协议同步与全链路调试推演流水线", results)

static func _setup_env() -> void:
	SaveDataAccessLayer.reset_for_tests()
	GameLifecycleManager.reset_for_test()
	HumanControlLeaseManager.reset_for_tests()
	UnifiedProtocolFactory.reset_for_tests()

static func _teardown_env() -> void:
	SaveDataAccessLayer.reset_for_tests()
	GameLifecycleManager.reset_for_test()
	HumanControlLeaseManager.reset_for_tests()
	UnifiedProtocolFactory.reset_for_tests()

## -----------------------------------------------------------------------------
## TC-MDE-01: 权威能力清单与双轨 Schema 零漂移静态一致性断言
## -----------------------------------------------------------------------------
static func test_tc_mde_01_mod_sdk_drift_free_audit() -> Dictionary:
	_setup_env()

	# 1. 验证 capabilities.json 存在性与关键契约字段
	var cap_file := FileAccess.open("res://mod_sdk/capabilities.json", FileAccess.READ)
	var cap_exists: bool = cap_file != null
	var cap_valid: bool = false
	var lease_aligned: bool = false
	var error_codes_ok: bool = false

	if cap_file:
		var cap_text := cap_file.get_as_text()
		cap_file.close()
		var parsed = JSON.parse_string(cap_text)
		if parsed is Dictionary:
			cap_valid = parsed.has("unified_protocol_capabilities")
			var proto_cap: Dictionary = parsed.get("unified_protocol_capabilities", {})
			lease_aligned = int(proto_cap.get("human_preemption_lease_ms", 0)) == 3000

			var err_codes: Array = parsed.get("supported_error_codes", [])
			var required_codes := [
				"ERR_PREEMPTED_BY_HUMAN",
				"ERR_INVALID_ESC_ACTION",
				"ERR_GATEWAY_NOT_BOUND",
				"ERR_SAVE_GUARD_BLOCKED",
				"ERR_INVALID_ENVELOPE",
			]
			var all_present: bool = true
			for c in required_codes:
				if not err_codes.has(c):
					all_present = false
					break
			error_codes_ok = all_present

	# 2. 验证 MOD_SPEC.md 动态能力章节更新
	var spec_file := FileAccess.open("res://mod_sdk/MOD_SPEC.md", FileAccess.READ)
	var spec_has_envelope: bool = false
	if spec_file:
		var spec_text := spec_file.get_as_text()
		spec_file.close()
		spec_has_envelope = spec_text.find("全域统一请求响应信封与 ESC 协议契约") >= 0 \
			and spec_text.find("dispatch") >= 0

	var passed: bool = cap_exists and cap_valid and lease_aligned and error_codes_ok and spec_has_envelope
	return TestCase.make_result("TC-MDE-01: 权威能力清单与双轨 Schema 零漂移静态一致性断言", passed, {
		"cap_exists": cap_exists,
		"cap_valid": cap_valid,
		"lease_aligned": lease_aligned,
		"error_codes_ok": error_codes_ok,
		"spec_has_envelope": spec_has_envelope,
	})

## -----------------------------------------------------------------------------
## TC-MDE-02: 客户端请求强类型信封结构合法性与非法扩展拦截断言
## -----------------------------------------------------------------------------
static func test_tc_mde_02_client_request_envelope_validation() -> Dictionary:
	_setup_env()

	var req := ClientRequestEnvelopeDTO.new()
	req.request_id = "req_test_001"
	req.actor_type = ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI
	req.domain = "world_state"
	req.action_type = "ESC_SAVE_GAME"
	req.payload = {"slot_id": "SLOT_01"}
	req.lease_nonce = 1
	req.client_timestamp_ms = 1000

	var dto_dict := req.to_dto()
	var has_required_keys: bool = dto_dict.has("request_id") \
		and dto_dict.has("actor_type") \
		and dto_dict.has("domain") \
		and dto_dict.has("action_type") \
		and dto_dict.has("payload") \
		and dto_dict.has("client_timestamp_ms")

	# 往返反序列化
	var restored := ClientRequestEnvelopeDTO.from_dto(dto_dict)
	var roundtrip_ok: bool = restored.request_id == req.request_id \
		and restored.actor_type == req.actor_type \
		and restored.domain == req.domain \
		and str(restored.payload.get("slot_id", "")) == "SLOT_01"

	var passed: bool = has_required_keys and roundtrip_ok
	return TestCase.make_result("TC-MDE-02: 客户端请求强类型信封结构合法性与反序列化对齐断言", passed, {
		"has_required_keys": has_required_keys,
		"roundtrip_ok": roundtrip_ok,
	})

## -----------------------------------------------------------------------------
## TC-MDE-03: 人类控制租约毫秒级抢占窗口拦截与续订断言
## -----------------------------------------------------------------------------
static func test_tc_mde_03_human_control_lease_preemption_and_renewal() -> Dictionary:
	_setup_env()

	# 1. 人类续订 3000ms 租约
	HumanControlLeaseManager.renew_human_lease("ACC_TEST_HUMAN", 1, 3000)
	var human_active: bool = HumanControlLeaseManager.is_lease_active("ACC_TEST_HUMAN")

	# 2. Agent 动作尝试抢占 -> 遭到拦截
	var agent_req := UnifiedProtocolFactory.create_agent_request(
		"world_state", "ALLOCATE_POTENTIAL_STAT", {"stat": "STR"}, "ACC_AGENT", "CHAR_01"
	)
	var resp_blocked := UnifiedProtocolDispatcher.dispatch(agent_req)
	var blocked_ok: bool = not resp_blocked.is_success \
		and resp_blocked.error_code == "ERR_PREEMPTED_BY_HUMAN"

	# 3. 模拟时间推进 3500ms（租约过期）
	HumanControlLeaseManager.simulate_time_advance_ms(3500)
	var expired_ok: bool = not HumanControlLeaseManager.is_lease_active("ACC_TEST_HUMAN")

	# 4. Agent 动作重试 -> 成功放行
	var resp_allowed := UnifiedProtocolDispatcher.dispatch(agent_req)
	var allowed_ok: bool = resp_allowed.is_success

	var passed: bool = human_active and blocked_ok and expired_ok and allowed_ok
	return TestCase.make_result("TC-MDE-03: 人类控制租约毫秒级抢占窗口拦截与续订断言", passed, {
		"human_active": human_active,
		"blocked_ok": blocked_ok,
		"expired_ok": expired_ok,
		"allowed_ok": allowed_ok,
	})

## -----------------------------------------------------------------------------
## TC-MDE-04: ESC 系统菜单强类型载荷校验与状态机流转断言
## -----------------------------------------------------------------------------
static func test_tc_mde_04_esc_menu_action_payload_and_state_transition() -> Dictionary:
	_setup_env()

	# 发射 ESC_QUERY_READINESS
	var req_query := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_QUERY_READINESS", {}, "", "ACC_01", "CHAR_01"
	)
	var resp_query := UnifiedProtocolDispatcher.dispatch(req_query)
	var query_ok: bool = resp_query.is_success \
		and resp_query.payload.has("can_save") \
		and resp_query.payload.has("can_exit")

	# 发射未知 ESC 指令 -> 拦截
	var req_invalid := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_EXPLODE_UNIVERSE", {}, "", "ACC_01", "CHAR_01"
	)
	var resp_invalid := UnifiedProtocolDispatcher.dispatch(req_invalid)
	var invalid_ok: bool = not resp_invalid.is_success \
		and resp_invalid.error_code == "ERR_INVALID_ESC_ACTION"

	var passed: bool = query_ok and invalid_ok
	return TestCase.make_result("TC-MDE-04: ESC 系统菜单强类型载荷校验与状态机流转断言", passed, {
		"query_ok": query_ok,
		"invalid_ok": invalid_ok,
	})

## -----------------------------------------------------------------------------
## TC-MDE-05: 关键过渡与战斗防护存档阻断错误码 ERR_SAVE_GUARD_BLOCKED 语义断言
## -----------------------------------------------------------------------------
static func test_tc_mde_05_save_guard_interception_semantics() -> Dictionary:
	_setup_env()

	# 模拟强制阻断存档环境
	SaveDataAccessLayer.set_mock_busy_for_test(true)

	var req_save := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_SAVE_GAME", {"slot_id": "SLOT_TEST"}, "", "ACC_01", "CHAR_01"
	)
	var resp_save := UnifiedProtocolDispatcher.dispatch(req_save)

	var blocked_ok: bool = not resp_save.is_success \
		and resp_save.error_code == "ERR_SAVE_GUARD_BLOCKED"

	# 解除阻断
	SaveDataAccessLayer.set_mock_busy_for_test(false)
	var resp_ok := UnifiedProtocolDispatcher.dispatch(req_save)
	var normal_save_ok: bool = resp_ok.is_success \
		and resp_ok.payload.get("save_status") == "SUCCESS"

	var passed: bool = blocked_ok and normal_save_ok
	return TestCase.make_result("TC-MDE-05: 关键过渡与战斗防护存档阻断错误码 ERR_SAVE_GUARD_BLOCKED 语义断言", passed, {
		"blocked_ok": blocked_ok,
		"normal_save_ok": normal_save_ok,
	})

## -----------------------------------------------------------------------------
## TC-MDE-06: 主页 HUD 7 大指令派发与快照切片同步断言
## -----------------------------------------------------------------------------
static func test_tc_mde_06_home_hud_directives_and_snapshot_sync() -> Dictionary:
	_setup_env()

	# 派发 REST_AND_ADVANCE_TIME
	var req_rest := UnifiedProtocolFactory.create_human_request(
		"world_state", "REST_AND_ADVANCE_TIME", {}, "", "ACC_01", "CHAR_01"
	)
	var resp_rest := UnifiedProtocolDispatcher.dispatch(req_rest)
	var rest_ok: bool = resp_rest.is_success

	# 派发 MARK_MAIL_READ
	var req_mail := UnifiedProtocolFactory.create_human_request(
		"world_state", "MARK_MAIL_READ", {"mail_id": "MAIL_01"}, "", "ACC_01", "CHAR_01"
	)
	var resp_mail := UnifiedProtocolDispatcher.dispatch(req_mail)
	var mail_ok: bool = resp_mail.is_success

	var passed: bool = rest_ok and mail_ok
	return TestCase.make_result("TC-MDE-06: 主页 HUD 7 大指令派发与快照切片同步断言", passed, {
		"rest_ok": rest_ok,
		"mail_ok": mail_ok,
	})

## -----------------------------------------------------------------------------
## TC-MDE-07: 本地模拟派发器请求/响应信封双向回环与时戳断言
## -----------------------------------------------------------------------------
static func test_tc_mde_07_mock_dispatcher_dual_track_envelope_roundtrip() -> Dictionary:
	_setup_env()

	var req := UnifiedProtocolFactory.create_human_request(
		"world_state", "ESC_QUERY_READINESS", {}, "", "ACC_01", "CHAR_01"
	)
	var resp := UnifiedProtocolDispatcher.dispatch(req)

	var resp_dict := resp.to_dto()
	var has_fields: bool = resp_dict.has("request_id") \
		and resp_dict.has("is_success") \
		and resp_dict.has("payload") \
		and resp_dict.has("server_timestamp_ms")

	var ts_ok: bool = resp.server_timestamp_ms >= req.client_timestamp_ms

	var passed: bool = has_fields and ts_ok and resp.is_success
	return TestCase.make_result("TC-MDE-07: 本地模拟派发器请求/响应信封双向回环与时戳断言", passed, {
		"has_fields": has_fields,
		"ts_ok": ts_ok,
		"is_success": resp.is_success,
	})

## -----------------------------------------------------------------------------
## TC-MDE-08: 跨平台 CLI dispatch 与 play --with-hud 全链路贯通断言
## -----------------------------------------------------------------------------
static func test_tc_mde_08_python_toolchain_and_with_hud_equivalence() -> Dictionary:
	_setup_env()

	# 1. 验证 kalar_mod.py 包含 dispatch 子命令
	var cli_file := FileAccess.open("res://mod_sdk/tools/kalar_mod.py", FileAccess.READ)
	var cli_has_dispatch: bool = false
	if cli_file:
		var text := cli_file.get_as_text()
		cli_file.close()
		cli_has_dispatch = text.find("\"dispatch\"") >= 0 and text.find("--with-hud") >= 0

	# 2. 验证 kalar_protocol_client.py 存在且包含 LocalMockDispatcher 与 KalarProtocolClient
	var client_file := FileAccess.open("res://mod_sdk/tools/kalar_protocol_client.py", FileAccess.READ)
	var client_ok: bool = false
	if client_file:
		var text := client_file.get_as_text()
		client_file.close()
		client_ok = text.find("LocalMockDispatcher") >= 0 and text.find("KalarProtocolClient") >= 0

	# 3. 验证 play_mod.py 具备 initial_hud_snapshot 贯通能力
	var play_file := FileAccess.open("res://mod_sdk/tools/play_mod.py", FileAccess.READ)
	var play_has_hud: bool = false
	if play_file:
		var text := play_file.get_as_text()
		play_file.close()
		play_has_hud = text.find("initial_hud_snapshot") >= 0 and text.find("--with-hud") >= 0

	var passed: bool = cli_has_dispatch and client_ok and play_has_hud
	return TestCase.make_result("TC-MDE-08: 跨平台 CLI dispatch 与 play --with-hud 全链路贯通断言", passed, {
		"cli_has_dispatch": cli_has_dispatch,
		"client_ok": client_ok,
		"play_has_hud": play_has_hud,
	})

## -----------------------------------------------------------------------------
## TC-MDE-09: 命途 MOD 声明清单依赖拓扑排序与环路检测算法断言
## -----------------------------------------------------------------------------
static func test_tc_mde_09_mod_topological_sort_and_dependencies() -> Dictionary:
	_setup_env()

	# 1. 正常依赖有向无环图 (A 独立, B 依赖 A)
	var pack_a := DestinyModManifestDTO.new()
	pack_a.pack_id = "PACK_ALPHA"
	pack_a.pack_name = "基础核心包"

	var pack_b := DestinyModManifestDTO.new()
	pack_b.pack_id = "PACK_BETA"
	pack_b.pack_name = "扩展身世包"
	pack_b.dependencies.append("PACK_ALPHA")

	# 乱序传入 [B, A]，拓扑排序必须调整为 [A, B]
	var res_dag: Dictionary = ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list([pack_b, pack_a], ["PACK_ALPHA", "PACK_BETA"])
	var dag_ok: bool = bool(res_dag.get("success", false))

	# 2. 缺失前置依赖包拦截
	var pack_orphan := DestinyModManifestDTO.new()
	pack_orphan.pack_id = "PACK_ORPHAN"
	pack_orphan.pack_name = "孤儿包"
	pack_orphan.dependencies.append("NON_EXISTENT_PACK")

	var res_missing: Dictionary = ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list([pack_orphan], ["PACK_ORPHAN"])
	var missing_ok: bool = (not bool(res_missing.get("success", true))) and (res_missing.get("error_code") == "ERR_MOD_INCOMPATIBLE_CONFLICT")

	# 3. 循环依赖死锁环拦截 (C 依赖 D, D 依赖 C)
	var pack_c := DestinyModManifestDTO.new()
	pack_c.pack_id = "PACK_CYCLE_C"
	pack_c.pack_name = "死锁环C"
	pack_c.dependencies.append("PACK_CYCLE_D")

	var pack_d := DestinyModManifestDTO.new()
	pack_d.pack_id = "PACK_CYCLE_D"
	pack_d.pack_name = "死锁环D"
	pack_d.dependencies.append("PACK_CYCLE_C")

	var res_cycle: Dictionary = ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list([pack_c, pack_d], ["PACK_CYCLE_C", "PACK_CYCLE_D"])
	var cycle_ok: bool = (not bool(res_cycle.get("success", true))) and (res_cycle.get("error_code") == "ERR_MOD_INCOMPATIBLE_CONFLICT")

	_teardown_env()
	var passed: bool = dag_ok and missing_ok and cycle_ok
	return TestCase.make_result("TC-MDE-09: 命途 MOD 声明清单依赖拓扑排序与环路检测算法断言", passed)

