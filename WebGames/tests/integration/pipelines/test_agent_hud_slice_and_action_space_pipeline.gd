# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_agent_hud_slice_and_action_space_pipeline.gd
# 架构定位: Integration Test Pipeline / Acceptance Harness
# 跨域依赖: 上游: TestRegistry | 下游: world_state, narrative_orchestration | 配置: config/domains/world_state/core.json
# 职责说明: 主页 HUD 面向 Agent 结构化切片流与动态行动空间无头集成测试流水线。
#           覆盖 TC-AHS-01 ~ TC-AHS-11，验证四段式标准包拓扑、因果差分贯穿、对象池守恒、专属动作通道与人类优先抢占只读租约。
# 设计依据: 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎验收测试矩阵规约与卡拉尔架构解耦契约
# ==============================================================================

class_name TestAgentHudSliceAndActionSpacePipeline
extends TestCase

const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")
const AuthoritativeHudSnapshotDTO = preload("res://backend/domains/world_state/dto/authoritative_hud_snapshot_dto.gd")
const ModeFeatureManifestDTO = preload("res://backend/domains/world_state/dto/mode_feature_manifest_dto.gd")
const WorldCalendarEnvironmentDTO = preload("res://backend/domains/world_state/dto/world_calendar_environment_dto.gd")
const ActiveQuestTrackerDTO = preload("res://backend/domains/world_state/dto/active_quest_tracker_dto.gd")

const AgentHudTelemetryPacketDTO = preload("res://backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd")
const AgentHudContextSliceDTO = preload("res://backend/domains/world_state/dto/agent_hud_context_slice_dto.gd")
const AgentActionDirectiveDTO = preload("res://backend/domains/world_state/dto/agent_action_directive_dto.gd")
const AgentActionPacketDTO = preload("res://backend/domains/world_state/dto/agent_action_packet_dto.gd")
const HudCausalDeltaDTO = preload("res://backend/domains/world_state/dto/hud_causal_delta_dto.gd")
const HudUiNoticeDTO = preload("res://backend/domains/world_state/dto/hud_ui_notice_dto.gd")

const AgentHudSliceSolver = preload("res://backend/domains/world_state/solvers/agent_hud_slice_solver.gd")
const HomeActionSpaceSolver = preload("res://backend/domains/world_state/solvers/home_action_space_solver.gd")
const HudCausalDeltaSolver = preload("res://backend/domains/world_state/solvers/hud_causal_delta_solver.gd")
const AgentActionExecutionSolver = preload("res://backend/domains/world_state/solvers/agent_action_execution_solver.gd")
const AgentActionChannel = preload("res://backend/domains/world_state/services/agent_action_channel.gd")
const AgentHudSliceBridge = preload("res://backend/domains/world_state/services/agent_hud_slice_bridge.gd")
const CompanionObserverBus = preload("res://backend/domains/narrative_orchestration/companion_observer_bus.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_standard_telemetry_packet_topology_and_size())
	results.append(test_envelope_monotonic_sequence_and_timestamp())
	results.append(test_potential_allocation_action_space_pruning())
	results.append(test_ap_and_rest_action_space_pruning())
	results.append(test_single_player_and_multiplayer_action_adaptation())
	results.append(test_causal_deltas_precise_tracking())
	results.append(test_object_pool_reuse_and_reset_conservation())
	results.append(test_end_to_end_llm_packet_by_packet_decision_loop())
	results.append(test_ui_notices_structural_slicing_and_actions())
	results.append(test_dedicated_action_channel_dispatch_and_guard())
	results.append(test_human_preemption_and_agent_read_only_fallback())
	return TestCase.pack_results("主页HUD面向Agent标准数据包与动态行动空间流水线", results)

static func _setup_environment() -> Dictionary:
	CompanionObserverBus.reset_for_tests()
	AuthoritativeHudSyncService.clear_human_interacting_override()
	var bridge := AgentHudSliceBridge.new()
	bridge.set_context(_create_base_context())
	return {
		"bridge": bridge,
		"action_channel": AgentActionChannel
	}

static func _teardown_environment(env: Dictionary = {}) -> void:
	if env.has("bridge") and env["bridge"] != null:
		env["bridge"].reset_state()
	AuthoritativeHudSyncService.clear_human_interacting_override()
	CompanionObserverBus.reset_for_tests()

static func _create_base_context() -> Dictionary:
	return {
		"account_id": "ACC_HERO_001",
		"character_id": "CHAR_SABER_001",
		"character_name": "阿尔托莉雅",
		"race_id": "HUMAN",
		"level": 10,
		"hp_max": 200.0,
		"hp_current": 160.0,
		"mp_max": 100.0,
		"mp_current": 80.0,
		"ap_max": 10.0,
		"ap_current": 8.0,
		"wallet_gold": 1500,
		"wallet_mana_monocrystals": 12,
		"ledger_nonce": 24,
		"unallocated_potential_points": 3,
		"attribute_values": {"STR": 20.0, "AGI": 15.0, "INT": 12.0, "STA": 18.0},
		"title_rank_key": "KNIGHT",
		"calendar_years": 2,
		"calendar_months": 5,
		"calendar_days": 12,
		"travel_hours": 8,
		"unread_mail_count": 2,
		"game_mode": 0
	}

## -----------------------------------------------------------------------------
## TC-AHS-01: 标准遥测数据包四段式结构与体积极限验证 (Inv-PACKET-TOPOLOGY-PURITY-3)
## -----------------------------------------------------------------------------
static func test_standard_telemetry_packet_topology_and_size() -> Dictionary:
	var ctx := _create_base_context()
	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)
	var packet := AgentHudSliceSolver.assemble_telemetry_packet(snapshot, null, 1, "INITIAL_SYNC")

	var dto: Dictionary = packet.to_dto()
	var has_envelope: bool = dto.has("envelope") and dto["envelope"].has("control_lease")
	var has_observation: bool = dto.has("observation") and not dto["observation"].is_empty()
	var has_causal_deltas: bool = dto.has("causal_deltas") and (dto["causal_deltas"] is Array)
	var has_action_space: bool = dto.has("action_space") and (dto["action_space"] is Array)

	if not (has_envelope and has_observation and has_causal_deltas and has_action_space):
		return TestCase.make_result("test_standard_telemetry_packet_topology_and_size", false, {
			"error": "顶层四段式结构不完备"
		})

	var json_str := JSON.stringify(dto)
	var byte_size := json_str.length()
	if byte_size > 2048:
		return TestCase.make_result("test_standard_telemetry_packet_topology_and_size", false, {
			"error": "序列化体积超过 2KB 限制: %d bytes" % byte_size
		})

	if json_str.contains("<color>") or json_str.contains("<b>"):
		return TestCase.make_result("test_standard_telemetry_packet_topology_and_size", false, {
			"error": "数据包中检测到非法表现层渲染标签"
		})

	return TestCase.make_result("test_standard_telemetry_packet_topology_and_size", true)

## -----------------------------------------------------------------------------
## TC-AHS-02: 时序信封单调递增性与物理时间戳验证 (Inv-MONOTONIC-SEQUENCE-4)
## -----------------------------------------------------------------------------
static func test_envelope_monotonic_sequence_and_timestamp() -> Dictionary:
	var ctx := _create_base_context()
	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)

	for seq in range(1, 6):
		var packet := AgentHudSliceSolver.assemble_telemetry_packet(snapshot, null, seq, "STEP_%d" % seq)
		if packet.sequence_index != seq:
			return TestCase.make_result("test_envelope_monotonic_sequence_and_timestamp", false, {
				"error": "序号未单调匹配: expected %d, got %d" % [seq, packet.sequence_index]
			})
		if packet.timestamp_ms <= 0:
			return TestCase.make_result("test_envelope_monotonic_sequence_and_timestamp", false, {
				"error": "时间戳异常: %d" % packet.timestamp_ms
			})
		if not packet.packet_id.begins_with("pkt_home_"):
			return TestCase.make_result("test_envelope_monotonic_sequence_and_timestamp", false, {
				"error": "packet_id 前缀规范错误: %s" % packet.packet_id
			})

	return TestCase.make_result("test_envelope_monotonic_sequence_and_timestamp", true)

## -----------------------------------------------------------------------------
## TC-AHS-03: 潜能加点行动空间动态裁决验证
## -----------------------------------------------------------------------------
static func test_potential_allocation_action_space_pruning() -> Dictionary:
	var ctx := _create_base_context()
	ctx["unallocated_potential_points"] = 5
	var snap1 := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)
	var actions1 := HomeActionSpaceSolver.resolve_action_space(snap1, false)

	var alloc_act1: AgentActionDirectiveDTO = null
	for a in actions1:
		if a.directive_id == "ALLOCATE_POTENTIAL_STAT":
			alloc_act1 = a
			break

	if alloc_act1 == null or not alloc_act1.is_executable:
		return TestCase.make_result("test_potential_allocation_action_space_pruning", false, {
			"error": "潜能点 > 0 时加点指令应可用"
		})

	ctx["unallocated_potential_points"] = 0
	var snap2 := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)
	var actions2 := HomeActionSpaceSolver.resolve_action_space(snap2, false)

	var alloc_act2: AgentActionDirectiveDTO = null
	for a in actions2:
		if a.directive_id == "ALLOCATE_POTENTIAL_STAT":
			alloc_act2 = a
			break

	if alloc_act2 == null or alloc_act2.is_executable or alloc_act2.blocked_reason != "ERR_NO_POTENTIAL_POINTS":
		return TestCase.make_result("test_potential_allocation_action_space_pruning", false, {
			"error": "潜能点耗尽时加点指令未被正确阻断置灰"
		})

	return TestCase.make_result("test_potential_allocation_action_space_pruning", true)

## -----------------------------------------------------------------------------
## TC-AHS-04: AP 体能与历法推进动态裁决验证
## -----------------------------------------------------------------------------
static func test_ap_and_rest_action_space_pruning() -> Dictionary:
	var ctx := _create_base_context()
	ctx["ap_current"] = 5.0
	var snap1 := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)
	var actions1 := HomeActionSpaceSolver.resolve_action_space(snap1, false)

	var rest_act1: AgentActionDirectiveDTO = null
	for a in actions1:
		if a.directive_id == "REST_AND_ADVANCE_TIME":
			rest_act1 = a
			break

	if rest_act1 == null or not rest_act1.is_executable:
		return TestCase.make_result("test_ap_and_rest_action_space_pruning", false, {
			"error": "AP >= 2.0 时宿屋休息指令应可用"
		})

	ctx["ap_current"] = 1.0
	var snap2 := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)
	var actions2 := HomeActionSpaceSolver.resolve_action_space(snap2, false)

	var rest_act2: AgentActionDirectiveDTO = null
	for a in actions2:
		if a.directive_id == "REST_AND_ADVANCE_TIME":
			rest_act2 = a
			break

	if rest_act2 == null or rest_act2.is_executable or rest_act2.blocked_reason != "ERR_INSUFFICIENT_AP":
		return TestCase.make_result("test_ap_and_rest_action_space_pruning", false, {
			"error": "AP < 2.0 时宿屋休息指令未被正确阻断"
		})

	return TestCase.make_result("test_ap_and_rest_action_space_pruning", true)

## -----------------------------------------------------------------------------
## TC-AHS-05: 单机/联机模式行动空间自适应验证
## -----------------------------------------------------------------------------
static func test_single_player_and_multiplayer_action_adaptation() -> Dictionary:
	var ctx_sp := _create_base_context()
	ctx_sp["game_mode"] = 0
	var snap_sp := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx_sp)
	var slice_sp := AgentHudSliceSolver.solve_slice(snap_sp)

	if slice_sp.game_mode != "SINGLE_PLAYER" or slice_sp.is_multiplayer_ready:
		return TestCase.make_result("test_single_player_and_multiplayer_action_adaptation", false, {
			"error": "单机模式切片标识错误"
		})

	var ctx_mp := _create_base_context()
	ctx_mp["game_mode"] = 1
	var snap_mp := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx_mp)
	var slice_mp := AgentHudSliceSolver.solve_slice(snap_mp)

	if slice_mp.game_mode != "MULTIPLAYER" or not slice_mp.is_multiplayer_ready:
		return TestCase.make_result("test_single_player_and_multiplayer_action_adaptation", false, {
			"error": "联机模式切片标识错误"
		})

	return TestCase.make_result("test_single_player_and_multiplayer_action_adaptation", true)

## -----------------------------------------------------------------------------
## TC-AHS-06: 单步因果差分精准溯源计算验证 (Inv-DELTA-INITIATOR-PROPAGATION-8)
## -----------------------------------------------------------------------------
static func test_causal_deltas_precise_tracking() -> Dictionary:
	var prev_slice := AgentHudContextSliceDTO.new()
	prev_slice.hp_current = 50.0
	prev_slice.wallet_gold = 200
	prev_slice.day_phase_key = "DAWN"

	var next_slice := AgentHudContextSliceDTO.new()
	next_slice.hp_current = 100.0
	next_slice.wallet_gold = 150
	next_slice.day_phase_key = "NOON"

	var deltas := HudCausalDeltaSolver.compute_deltas(
		prev_slice, next_slice, "REST_ACTION", "AGENT_ACTION_CHANNEL", "HEALED_AT_INN"
	)

	if deltas.size() != 3:
		return TestCase.make_result("test_causal_deltas_precise_tracking", false, {
			"error": "提取到的差分数量不符: %d (expected 3)" % deltas.size()
		})

	var hp_delta: HudCausalDeltaDTO = null
	var gold_delta: HudCausalDeltaDTO = null
	var phase_delta: HudCausalDeltaDTO = null

	for d in deltas:
		if d.target_field == "hp_current":
			hp_delta = d
		elif d.target_field == "wallet_gold":
			gold_delta = d
		elif d.target_field == "day_phase_key":
			phase_delta = d

	if hp_delta == null or not is_equal_approx(hp_delta.delta_amount, 50.0) or hp_delta.initiator != "AGENT_ACTION_CHANNEL":
		return TestCase.make_result("test_causal_deltas_precise_tracking", false, {
			"error": "HP 差分字段或发起者未正确匹配"
		})

	if gold_delta == null or not is_equal_approx(gold_delta.delta_amount, -50.0):
		return TestCase.make_result("test_causal_deltas_precise_tracking", false, {
			"error": "Gold 差分计算错误"
		})

	if phase_delta == null or str(phase_delta.current_value) != "NOON":
		return TestCase.make_result("test_causal_deltas_precise_tracking", false, {
			"error": "Calendar phase 差分计算错误"
		})

	return TestCase.make_result("test_causal_deltas_precise_tracking", true)

## -----------------------------------------------------------------------------
## TC-AHS-07: 对象池复用与 reset_state 守恒验证 (Inv-ZERO-HEAP-ASSERT-5)
## -----------------------------------------------------------------------------
static func test_object_pool_reuse_and_reset_conservation() -> Dictionary:
	var ctx := _create_base_context()
	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)
	var packet_pool_instance := AgentHudTelemetryPacketDTO.new()

	for i in range(1, 1001):
		AgentHudSliceSolver.assemble_telemetry_packet(
			snapshot, null, i, "ITER_%d" % i, false, "SYSTEM_TICK_SIMULATION", packet_pool_instance
		)
		if packet_pool_instance.sequence_index != i:
			return TestCase.make_result("test_object_pool_reuse_and_reset_conservation", false, {
				"error": "第 %d 次复用状态紊乱" % i
			})

	packet_pool_instance.reset_state()
	if packet_pool_instance.sequence_index != 0 or not packet_pool_instance.action_space.is_empty():
		return TestCase.make_result("test_object_pool_reuse_and_reset_conservation", false, {
			"error": "reset_state 未能彻底重置对象池实例"
		})

	return TestCase.make_result("test_object_pool_reuse_and_reset_conservation", true)

## -----------------------------------------------------------------------------
## TC-AHS-08: 端到端 LLM 逐包解读与决策闭环模拟验证
## -----------------------------------------------------------------------------
static func test_end_to_end_llm_packet_by_packet_decision_loop() -> Dictionary:
	var ctx := _create_base_context()
	ctx["unallocated_potential_points"] = 2
	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)

	# 1. 下发 Step 1 遥测数据包
	var pkt1 := AgentHudSliceSolver.assemble_telemetry_packet(snapshot, null, 1, "STEP_1_OBSERVE")

	# 2. 模拟 LLM 解读行动空间并决策：选择加点 STR
	var chosen_action: AgentActionDirectiveDTO = null
	for d in pkt1.action_space:
		if d.directive_id == "ALLOCATE_POTENTIAL_STAT" and d.is_executable:
			chosen_action = d
			break

	if chosen_action == null:
		return TestCase.make_result("test_end_to_end_llm_packet_by_packet_decision_loop", false, {
			"error": "LLM 未能在行动空间中检索到可执行指令"
		})

	# 3. 构造上行动作包并通过专属动作通道派发
	var act_pkt := AgentActionPacketDTO.new()
	act_pkt.directive_id = chosen_action.directive_id
	act_pkt.params = {"stat_target": "STR", "points": 1}
	act_pkt.sequence_index = pkt1.sequence_index

	var res := AgentActionChannel.dispatch_action(act_pkt, ctx)
	if not bool(res.get("success", false)):
		return TestCase.make_result("test_end_to_end_llm_packet_by_packet_decision_loop", false, {
			"error": "动作通道派发执行失败: %s" % str(res.get("error_code"))
		})

	# 4. 验证返回的下一遥测包序号与状态突变
	var next_pkt_dict: Dictionary = res.get("next_packet", {})
	var env: Dictionary = next_pkt_dict.get("envelope", {})
	if int(env.get("sequence_index", 0)) != 2:
		return TestCase.make_result("test_end_to_end_llm_packet_by_packet_decision_loop", false, {
			"error": "次序索引未递增至 2"
		})

	return TestCase.make_result("test_end_to_end_llm_packet_by_packet_decision_loop", true)

## -----------------------------------------------------------------------------
## TC-AHS-09: UI 消息通知与模态对话框结构化切片装箱验证 (Inv-UI-NOTICE-SLICING-6)
## -----------------------------------------------------------------------------
static func test_ui_notices_structural_slicing_and_actions() -> Dictionary:
	var env := _setup_environment()
	var bridge: AgentHudSliceBridge = env["bridge"]

	# 模拟 UI 发出引导通知与模态对话框
	var test_notice := HudUiNoticeDTO.new()
	test_notice.notice_id = "notice_rest_recommendation_001"
	test_notice.category = "RECOMMENDATION"
	test_notice.priority = 2
	test_notice.message_text = "AP 体能偏低，建议返回宿屋休息恢复。"
	test_notice.actions = ["REST_AND_ADVANCE_TIME", "DISMISS_UI_NOTICE"]

	bridge.inject_ui_notice(test_notice)
	var packet: AgentHudTelemetryPacketDTO = bridge.step_and_publish("TEST_INJECT_NOTICE")

	if packet.observation == null or packet.observation.ui_notices.is_empty():
		_teardown_environment(env)
		return TestCase.make_result("test_ui_notices_structural_slicing_and_actions", false, {
			"error": "未能在切片中捕获注入的 UI 通知"
		})

	var first_notice: HudUiNoticeDTO = packet.observation.ui_notices[0]
	if first_notice.notice_id != "notice_rest_recommendation_001":
		_teardown_environment(env)
		return TestCase.make_result("test_ui_notices_structural_slicing_and_actions", false, {
			"error": "捕获的 notice_id 不匹配: %s" % first_notice.notice_id
		})

	if first_notice.message_text.contains("<color>") or first_notice.message_text.contains("<b>"):
		_teardown_environment(env)
		return TestCase.make_result("test_ui_notices_structural_slicing_and_actions", false, {
			"error": "UI 通知包含表现层富文本标记"
		})

	if first_notice.actions.size() != 2 or not first_notice.actions.has("REST_AND_ADVANCE_TIME"):
		_teardown_environment(env)
		return TestCase.make_result("test_ui_notices_structural_slicing_and_actions", false, {
			"error": "actions 指令集未完整保留"
		})

	_teardown_environment(env)
	return TestCase.make_result("test_ui_notices_structural_slicing_and_actions", true)

## -----------------------------------------------------------------------------
## TC-AHS-10: 专属动作通道零硬件冲突与越界熔断验证 (Inv-ACTION-CHANNEL-ZERO-CONFLICT-5)
## -----------------------------------------------------------------------------
static func test_dedicated_action_channel_dispatch_and_guard() -> Dictionary:
	var env := _setup_environment()
	var ctx := _create_base_context()
	ctx["unallocated_potential_points"] = 2

	# 1. 验证合法指令成功直投
	var valid_act := AgentActionPacketDTO.new()
	valid_act.directive_id = "ALLOCATE_POTENTIAL_STAT"
	valid_act.params = {"stat_target": "AGI", "points": 1}
	var res1 := AgentActionChannel.dispatch_action(valid_act, ctx)

	if not bool(res1.get("success", false)):
		_teardown_environment(env)
		return TestCase.make_result("test_dedicated_action_channel_dispatch_and_guard", false, {
			"error": "合法加点指令未能正常执行"
		})

	# 2. 验证伪造越界指令被即时阻断
	var forged_act := AgentActionPacketDTO.new()
	forged_act.directive_id = "ILLEGAL_ADMIN_KILL"
	var res2 := AgentActionChannel.dispatch_action(forged_act, ctx)

	if bool(res2.get("success", false)) or str(res2.get("error_code")) != "ERR_UNKNOWN_OR_UNEXPOSED_DIRECTIVE":
		_teardown_environment(env)
		return TestCase.make_result("test_dedicated_action_channel_dispatch_and_guard", false, {
			"error": "伪造指令未被正确阻断: %s" % str(res2.get("error_code"))
		})

	# 3. 验证前置条件不满足指令被阻断
	var blocked_ctx := _create_base_context()
	blocked_ctx["unallocated_potential_points"] = 0
	var empty_alloc := AgentActionPacketDTO.new()
	empty_alloc.directive_id = "ALLOCATE_POTENTIAL_STAT"
	empty_alloc.params = {"stat_target": "STR", "points": 1}
	var res3 := AgentActionChannel.dispatch_action(empty_alloc, blocked_ctx)

	if bool(res3.get("success", false)) or str(res3.get("error_code")) != "ERR_NO_POTENTIAL_POINTS":
		_teardown_environment(env)
		return TestCase.make_result("test_dedicated_action_channel_dispatch_and_guard", false, {
			"error": "点数不足未被正确阻断: %s" % str(res3.get("error_code"))
		})

	_teardown_environment(env)
	return TestCase.make_result("test_dedicated_action_channel_dispatch_and_guard", true)

## -----------------------------------------------------------------------------
## TC-AHS-11: 人类前台操作抢占与 Agent 行动空间强制退化只读验证 (Inv-PREEMPTION-READ-ONLY-ORACLE-8)
## -----------------------------------------------------------------------------
static func test_human_preemption_and_agent_read_only_fallback() -> Dictionary:
	var env := _setup_environment()
	var bridge: AgentHudSliceBridge = env["bridge"]
	var channel = env["action_channel"]

	# 1. 模拟人类前台触发 UI 交互独占（激活人类租约）
	bridge.set_human_interacting(true)
	var packet: AgentHudTelemetryPacketDTO = bridge.step_and_publish("TEST_HUMAN_PREEMPTION")

	# 2. 断言控制权降级为只读
	if packet.human_interaction_state != "ACTIVE" or packet.agent_control_mode != "READ_ONLY_OBSERVER" or not packet.preempted_by_human or packet.is_writable:
		_teardown_environment(env)
		return TestCase.make_result("test_human_preemption_and_agent_read_only_fallback", false, {
			"error": "人类抢占态下信封控制租约未能正确定位为只读"
		})

	# 3. 断言行动空间全量指令置灰
	for d in packet.action_space:
		if d.is_executable or d.blocked_reason != "ERR_PREEMPTED_BY_HUMAN":
			_teardown_environment(env)
			return TestCase.make_result("test_human_preemption_and_agent_read_only_fallback", false, {
				"error": "人类操作期间指令未被强制置灰: %s" % d.directive_id
			})

	# 4. 断言专属动作通道物理拒绝 Agent 提交上行动作
	var act := AgentActionPacketDTO.new()
	act.directive_id = "ALLOCATE_POTENTIAL_STAT"
	act.params = {"stat_target": "STR", "points": 1}
	var res: Dictionary = channel.dispatch_action(act, bridge.get_context())

	_teardown_environment(env)

	if bool(res.get("success", false)) or str(res.get("error_code")) != "ERR_PREEMPTED_BY_HUMAN":
		return TestCase.make_result("test_human_preemption_and_agent_read_only_fallback", false, {
			"error": "人类租约活动期间动作通道未物理阻断: %s" % str(res.get("error_code"))
		})

	return TestCase.make_result("test_human_preemption_and_agent_read_only_fallback", true)

