# ==============================================================================
# 模块归属: 集成测试层 (Integration · Agent交互试玩与伴侣观察总线流水线)
# 文件路径: res://tests/integration/pipelines/test_agent_interactive_session_and_companion_pipeline.gd
# 架构定位: Integration Test Suite / End-to-End Pipeline Harness
# 跨域依赖: 上游: TestRegistry | 下游: AgentPlaythroughSession, CompanionObserverBus, CompanionBlackboxRecorder, ModWorkbenchView | 配置: config/domains/*.json | 信号: CompanionObserverBus
# 职责说明: 全链路验证长程交互式Agent推演会话生命周期、单步分支选择与突变结算、决策快照回滚与状态恢复、非侵入式伴侣观察总线广播与有界队列、现场黑匣子诊断转储及前端工坊轻量占位契约。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约 (Phase 117 阶段4)
# ==============================================================================

class_name TestAgentInteractiveSessionAndCompanionPipeline
extends TestCase

# ==============================================================================
# 一、测试套件总入口与环境重置
# ==============================================================================

## 执行全量流水线测试 (TC-AIS-01 ~ TC-AIS-06)
static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_interactive_session_init_and_observation())
	results.append(test_single_step_choice_and_causal_mutations())
	results.append(test_history_stack_and_deterministic_rollback())
	results.append(test_companion_observer_bus_broadcast_and_bounded_capacity())
	results.append(test_companion_blackbox_recorder_diagnostic_dump())
	results.append(test_frontend_workbench_view_stub_contract())

	return pack_results("Agent Interactive Session & Companion Pipeline", results)

## 装配纯净隔离沙箱
static func _setup_environment() -> void:
	WorldArchiveRepository.reset_for_tests()
	AccountRepository.reset_for_tests()
	SaveDataAccessLayer.reset_for_tests()
	RuntimeModeGate.reset_for_tests()
	CompanionObserverBus.reset_for_tests()

## 对称清理沙箱
static func _teardown_environment() -> void:
	WorldArchiveRepository.reset_for_tests()
	AccountRepository.reset_for_tests()
	SaveDataAccessLayer.reset_for_tests()
	RuntimeModeGate.reset_for_tests()
	CompanionObserverBus.reset_for_tests()

# ==============================================================================
# 二、核心测试场景 (TC-AIS-01 ~ TC-AIS-06)
# ==============================================================================

## TC-AIS-01: 交互式会话初始化与首步观察契约
static func test_interactive_session_init_and_observation() -> Dictionary:
	_setup_environment()
	var session := AgentPlaythroughSession.new()
	var config: Dictionary = {
		"mod_dirs": ["res://mod_sdk/templates/starter_story"],
		"enabled_pack_ids": ["*"],
		"character_name": "交互测试员",
		"race_id": "HUMAN",
		"origin_id": "STARTER_ASTRAL_INITIATE",
		"seed": 1337
	}
	var obs: Dictionary = session.start_session(config)
	var session_ok: bool = not session.session_id.is_empty() \
		and session.step_index == 0 \
		and not session.is_terminal \
		and session.history_stack.size() == 1

	var obs_ok: bool = str(obs.get("current_node_id", "")) == "NODE_STARTER_AWAKEN" \
		and not str(obs.get("hydrated_text", "")).is_empty() \
		and not (obs.get("available_choices", []) as Array).is_empty() \
		and not bool(obs.get("is_terminal", true))

	_teardown_environment()
	var passed: bool = session_ok and obs_ok
	return make_result("TC-AIS-01: 交互式会话初始化与首步观察契约", passed, {
		"session_ok": session_ok,
		"obs_ok": obs_ok
	})

## TC-AIS-02: 单步分支选择与多轮因果突变结算
static func test_single_step_choice_and_causal_mutations() -> Dictionary:
	_setup_environment()
	var session := AgentPlaythroughSession.new()
	var config: Dictionary = {
		"mod_dirs": ["res://mod_sdk/templates/starter_story"],
		"character_name": "阿尔温",
		"race_id": "HUMAN",
		"origin_id": "STARTER_ASTRAL_INITIATE"
	}
	session.start_session(config)

	var step1_obs: Dictionary = session.step({"action_type": "CHOOSE", "choice_id": "NODE_STARTER_EXPLORE"})
	var step1_ok: bool = session.step_index == 1 \
		and str(step1_obs.get("current_node_id", "")) == "NODE_STARTER_EXPLORE" \
		and not bool(step1_obs.get("is_terminal", true))

	var step2_obs: Dictionary = session.step({"action_type": "CHOOSE", "choice_id": "NODE_STARTER_DEPART"})
	var step2_ok: bool = session.step_index == 2 \
		and str(step2_obs.get("current_node_id", "")) == "NODE_STARTER_DEPART" \
		and bool(step2_obs.get("is_terminal", false)) \
		and session.is_terminal

	var transcript: Dictionary = session.get_summary_transcript()
	var transcript_ok: bool = bool(transcript.get("is_success", false)) \
		and (transcript.get("transcript_steps", []) as Array).size() >= 2

	_teardown_environment()
	var passed: bool = step1_ok and step2_ok and transcript_ok
	return make_result("TC-AIS-02: 单步分支选择与多轮因果突变结算", passed, {
		"step1_ok": step1_ok,
		"step2_ok": step2_ok,
		"transcript_ok": transcript_ok
	})

## TC-AIS-03: 会话历史快照栈与确定性回滚恢复
static func test_history_stack_and_deterministic_rollback() -> Dictionary:
	_setup_environment()
	var session := AgentPlaythroughSession.new()
	var config: Dictionary = {
		"mod_dirs": ["res://mod_sdk/templates/starter_story"],
		"character_name": "回滚测试员",
		"race_id": "HUMAN",
		"origin_id": "STARTER_ASTRAL_INITIATE"
	}
	session.start_session(config)

	session.step({"action_type": "CHOOSE", "choice_id": "NODE_STARTER_EXPLORE"})
	var advanced_node: String = str(session.get_current_observation().get("current_node_id", ""))
	var advanced_stack_size: int = session.history_stack.size()

	var rollback_obs: Dictionary = session.rollback()
	var rollback_node: String = str(rollback_obs.get("current_node_id", ""))
	var rollback_ok: bool = rollback_node == "NODE_STARTER_AWAKEN" \
		and session.history_stack.size() == 1 \
		and advanced_node == "NODE_STARTER_EXPLORE" \
		and advanced_stack_size == 2

	_teardown_environment()
	var passed: bool = rollback_ok
	return make_result("TC-AIS-03: 会话历史快照栈与确定性回滚恢复", passed, {
		"rollback_ok": rollback_ok,
		"rollback_node": rollback_node
	})

## TC-AIS-04: 非侵入式伴侣观察总线广播与有界队列
static func test_companion_observer_bus_broadcast_and_bounded_capacity() -> Dictionary:
	CompanionObserverBus.reset_for_tests()
	var bus := CompanionObserverBus.get_instance()
	var received_events: Array[Dictionary] = []

	var observer_cb := func(ev_type: String, payload: Dictionary) -> void:
		received_events.append({"type": ev_type, "payload": payload})

	bus.register_observer(observer_cb)

	for i in range(5):
		bus.broadcast_event("test_event", {"seq": i})

	var dispatch_ok: bool = received_events.size() == 5

	bus.unregister_observer(observer_cb)
	for i in range(50):
		bus.broadcast_event("overflow_event", {"seq": i})

	var tail: Array[Dictionary] = bus.get_recent_events(8)
	var tail_ok: bool = tail.size() == 8
	var cap_ok: bool = bus._ring_buffer.size() <= CompanionObserverBus.MAX_CAPACITY

	CompanionObserverBus.reset_for_tests()
	var passed: bool = dispatch_ok and tail_ok and cap_ok
	return make_result("TC-AIS-04: 非侵入式伴侣观察总线广播与有界队列", passed, {
		"dispatch_ok": dispatch_ok,
		"tail_ok": tail_ok,
		"cap_ok": cap_ok
	})

## TC-AIS-05: 现场黑匣子转储生成与故障现场自愈
static func test_companion_blackbox_recorder_diagnostic_dump() -> Dictionary:
	CompanionObserverBus.reset_for_tests()
	var bus := CompanionObserverBus.get_instance()
	bus.broadcast_event("prologue_started", {"session_id": "DUMP_TEST_SESS"})
	bus.broadcast_event("node_entered", {"node_id": "NODE_FAULT_TARGET"})

	var dump: Dictionary = CompanionBlackboxRecorder.create_diagnostic_dump(
		"ERR_UNKNOWN_PLACEHOLDER",
		"starter_story",
		"NODE_FAULT_TARGET",
		{"faulty_token": "{NON_EXISTENT_VAR}"}
	)

	var dump_ok: bool = not str(dump.get("dump_id", "")).is_empty() \
		and str(dump.get("error_code", "")) == "ERR_UNKNOWN_PLACEHOLDER" \
		and str(dump.get("failing_pack_id", "")) == "starter_story" \
		and str(dump.get("failing_node_id", "")) == "NODE_FAULT_TARGET" \
		and not (dump.get("recent_event_tail", []) as Array).is_empty()

	CompanionObserverBus.reset_for_tests()
	var passed: bool = dump_ok
	return make_result("TC-AIS-05: 现场黑匣子转储生成与故障现场自愈", passed, {
		"dump_ok": dump_ok
	})

## TC-AIS-06: 前端工坊占位接口完整性与零异常验证
static func test_frontend_workbench_view_stub_contract() -> Dictionary:
	var view := ModWorkbenchView.new()
	var initial_state: Dictionary = view.get_workbench_state()
	var init_ok: bool = not bool(initial_state.get("is_bound", true))

	var session := AgentPlaythroughSession.new()
	session.session_id = "WB_STUB_SESS_01"
	session.step_index = 3
	view.bind_session(session)

	var bound_state: Dictionary = view.get_workbench_state()
	var bound_ok: bool = bool(bound_state.get("is_bound", false)) \
		and str(bound_state.get("session_id", "")) == "WB_STUB_SESS_01" \
		and int(bound_state.get("current_step", 0)) == 3

	view.apply_snapshot({"current_node_id": "NODE_STUB_TARGET"})
	var snap_state: Dictionary = view.get_workbench_state()
	var snap_ok: bool = str(snap_state.get("active_node_id", "")) == "NODE_STUB_TARGET"

	view.free()
	var passed: bool = init_ok and bound_ok and snap_ok
	return make_result("TC-AIS-06: 前端工坊占位接口完整性与零异常验证", passed, {
		"init_ok": init_ok,
		"bound_ok": bound_ok,
		"snap_ok": snap_ok
	})

