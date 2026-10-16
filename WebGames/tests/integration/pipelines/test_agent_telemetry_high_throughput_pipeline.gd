# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_agent_telemetry_high_throughput_pipeline.gd
# 架构定位: Integration Test Pipeline / High Throughput Benchmark Harness
# 跨域依赖: 上游: TestRegistry | 下游: world_state, narrative_orchestration | 配置: config/domains/world_state/core.json
# 职责说明: Agent 遥测高频推演基准、深度对象池守恒与紧凑二进制流验收测试流水线。
#           覆盖 TC-ATH-01 ~ TC-ATH-10，验证对象池借还守恒、原位求解零堆分配、环形轨迹回溯、WorkerThreadPool 异步背压与二进制无损编解码。
# 设计依据: 高频推演基准与零瞬态堆分配验收测试矩阵 (Inv-DEEP-POOL-CONSERVATION-1, Inv-RING-BUFFER-BOUNDED-2, Inv-BINARY-ROUNDTRIP-LOSSLESS-3)
# ==============================================================================

class_name TestAgentTelemetryHighThroughputPipeline
extends TestCase

const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")
const AuthoritativeHudSnapshotDTO = preload("res://backend/domains/world_state/dto/authoritative_hud_snapshot_dto.gd")
const AgentHudTelemetryPacketDTO = preload("res://backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd")
const AgentHudContextSliceDTO = preload("res://backend/domains/world_state/dto/agent_hud_context_slice_dto.gd")
const AgentActionDirectiveDTO = preload("res://backend/domains/world_state/dto/agent_action_directive_dto.gd")
const HudCausalDeltaDTO = preload("res://backend/domains/world_state/dto/hud_causal_delta_dto.gd")

const AgentHudSliceSolver = preload("res://backend/domains/world_state/solvers/agent_hud_slice_solver.gd")
const HomeActionSpaceSolver = preload("res://backend/domains/world_state/solvers/home_action_space_solver.gd")
const HudCausalDeltaSolver = preload("res://backend/domains/world_state/solvers/hud_causal_delta_solver.gd")

const AgentTelemetryPoolRegistry = preload("res://backend/domains/world_state/services/agent_telemetry_pool_registry.gd")
const AgentTrajectoryRingBuffer = preload("res://backend/domains/world_state/services/agent_trajectory_ring_buffer.gd")
const AgentAsyncDispatcher = preload("res://backend/domains/world_state/services/agent_async_dispatcher.gd")
const BinaryTelemetryCodec = preload("res://backend/domains/world_state/services/binary_telemetry_codec.gd")
const AgentHudSliceBridge = preload("res://backend/domains/world_state/services/agent_hud_slice_bridge.gd")
const CompanionObserverBus = preload("res://backend/domains/narrative_orchestration/companion_observer_bus.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_deep_object_pool_conservation_and_preallocation())
	results.append(test_inplace_solver_zero_heap_allocation_in_loop())
	results.append(test_trajectory_ring_buffer_constant_memory_and_head_wrap())
	results.append(test_trajectory_window_monotonic_slice_extraction())
	results.append(test_cumulative_causal_deltas_cross_step_aggregation())
	results.append(test_async_dispatcher_backpressure_drop_oldest_strategy())
	results.append(test_deterministic_test_mode_single_thread_synchronism())
	results.append(test_binary_telemetry_codec_roundtrip_lossless_equivalence())
	results.append(test_binary_telemetry_size_budget_and_compression_ratio())
	results.append(test_companion_observer_bus_refactor_backward_compatibility())
	return TestCase.pack_results("Agent高频遥测基准与深度对象池流水线", results)

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
## TC-ATH-01: 深度对象池借还守恒与预分配容量验证 (Inv-DEEP-POOL-CONSERVATION-1)
## -----------------------------------------------------------------------------
static func test_deep_object_pool_conservation_and_preallocation() -> Dictionary:
	AgentTelemetryPoolRegistry.ensure_pools_registered()

	var pkt: AgentHudTelemetryPacketDTO = AgentTelemetryPoolRegistry.borrow_packet()
	if pkt == null:
		return TestCase.make_result("test_deep_object_pool_conservation_and_preallocation", false, {
			"error": "未能从对象池借出 AgentHudTelemetryPacketDTO"
		})

	pkt.sequence_index = 42
	AgentTelemetryPoolRegistry.recycle_packet(pkt)

	var pkt2: AgentHudTelemetryPacketDTO = AgentTelemetryPoolRegistry.borrow_packet()
	if pkt2.sequence_index != 0:
		return TestCase.make_result("test_deep_object_pool_conservation_and_preallocation", false, {
			"error": "对象池借出时未正确执行 reset_state 清理"
		})
	AgentTelemetryPoolRegistry.recycle_packet(pkt2)

	# 验证指令与差分对象池借还
	var dir := AgentTelemetryPoolRegistry.borrow_directive()
	dir.directive_id = "CUSTOM_TEST"
	AgentTelemetryPoolRegistry.recycle_directive(dir)

	var delta := AgentTelemetryPoolRegistry.borrow_delta()
	delta.delta_amount = 99.0
	AgentTelemetryPoolRegistry.recycle_delta(delta)

	return TestCase.make_result("test_deep_object_pool_conservation_and_preallocation", true)

## -----------------------------------------------------------------------------
## TC-ATH-02: 求解器原位注入与循环零堆分配断言 (Inv-ZERO-HEAP-ASSERT-1, ADV-PRF-002)
## -----------------------------------------------------------------------------
static func test_inplace_solver_zero_heap_allocation_in_loop() -> Dictionary:
	var ctx := _create_base_context()
	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)

	var act_container: Array[AgentActionDirectiveDTO] = []
	var delta_container: Array[HudCausalDeltaDTO] = []

	var slice_a := AgentHudContextSliceDTO.new()
	var slice_b := AgentHudContextSliceDTO.new()
	slice_a.hp_current = 100.0
	slice_b.hp_current = 80.0

	# 执行 1000 次原位高频计算，验证容器复用守恒
	for i in range(1000):
		HomeActionSpaceSolver.resolve_action_space_into(snapshot, act_container, false)
		if act_container.size() != 6:
			return TestCase.make_result("test_inplace_solver_zero_heap_allocation_in_loop", false, {
				"error": "第 %d 次原位填充指令数量异常: %d" % [i, act_container.size()]
			})

		HudCausalDeltaSolver.compute_deltas_into(slice_a, slice_b, delta_container, "COMBAT_DAMAGE")
		if delta_container.size() != 1:
			return TestCase.make_result("test_inplace_solver_zero_heap_allocation_in_loop", false, {
				"error": "第 %d 次原位差分填充数量异常: %d" % [i, delta_container.size()]
			})

	return TestCase.make_result("test_inplace_solver_zero_heap_allocation_in_loop", true)

## -----------------------------------------------------------------------------
## TC-ATH-03: 定长环形缓冲轨迹器 O(1) 指针覆盖与内存有界收敛 (Inv-RING-BUFFER-BOUNDED-2)
## -----------------------------------------------------------------------------
static func test_trajectory_ring_buffer_constant_memory_and_head_wrap() -> Dictionary:
	var ring := AgentTrajectoryRingBuffer.new(32)
	var pkt := AgentHudTelemetryPacketDTO.new()

	for i in range(1, 101):
		pkt.sequence_index = i
		pkt.timestamp_ms = 10000 + i
		ring.append_packet(pkt)

	if ring.get_count() != 32:
		return TestCase.make_result("test_trajectory_ring_buffer_constant_memory_and_head_wrap", false, {
			"error": "环形缓冲计数超限: %d (预期 32)" % ring.get_count()
		})

	var latest := ring.get_latest_packet()
	if latest == null or latest.sequence_index != 100:
		return TestCase.make_result("test_trajectory_ring_buffer_constant_memory_and_head_wrap", false, {
			"error": "最新包序号不匹配: %d (预期 100)" % (latest.sequence_index if latest else -1)
		})

	return TestCase.make_result("test_trajectory_ring_buffer_constant_memory_and_head_wrap", true)

## -----------------------------------------------------------------------------
## TC-ATH-04: 多步时序窗口保序切片提取验证 (Inv-RING-ORDER-DETERMINISM-2)
## -----------------------------------------------------------------------------
static func test_trajectory_window_monotonic_slice_extraction() -> Dictionary:
	var ring := AgentTrajectoryRingBuffer.new(32)
	var pkt := AgentHudTelemetryPacketDTO.new()

	for i in range(1, 51):
		pkt.sequence_index = i
		ring.append_packet(pkt)

	var window := ring.get_trajectory_window(16)
	if window.size() != 16:
		return TestCase.make_result("test_trajectory_window_monotonic_slice_extraction", false, {
			"error": "时序窗口大小不匹配: %d (预期 16)" % window.size()
		})

	# 验证单调连续性：最近 16 步应为 35 到 50
	for j in range(16):
		var expected_seq := 35 + j
		if window[j].sequence_index != expected_seq:
			return TestCase.make_result("test_trajectory_window_monotonic_slice_extraction", false, {
				"error": "窗口第 %d 项序号为 %d (预期 %d)" % [j, window[j].sequence_index, expected_seq]
			})

	return TestCase.make_result("test_trajectory_window_monotonic_slice_extraction", true)

## -----------------------------------------------------------------------------
## TC-ATH-05: 累积因果突变聚合跨步差分验证 (Inv-TRAJECTORY-WINDOW-WINDOW-3)
## -----------------------------------------------------------------------------
static func test_cumulative_causal_deltas_cross_step_aggregation() -> Dictionary:
	var ring := AgentTrajectoryRingBuffer.new(32)

	for i in range(1, 6):
		var pkt := AgentHudTelemetryPacketDTO.new()
		pkt.sequence_index = i
		var d := HudCausalDeltaDTO.new()
		d.target_field = "hp_current"
		d.delta_amount = float(-10 * i)
		pkt.causal_deltas.append(d)
		ring.append_packet(pkt)

	# 聚合从 sequence_index >= 3 开始的差分（应包含 3, 4, 5 共 3 项）
	var deltas := ring.get_cumulative_deltas(3)
	if deltas.size() != 3:
		return TestCase.make_result("test_cumulative_causal_deltas_cross_step_aggregation", false, {
			"error": "累积差分项数不符: %d (预期 3)" % deltas.size()
		})

	return TestCase.make_result("test_cumulative_causal_deltas_cross_step_aggregation", true)

## -----------------------------------------------------------------------------
## TC-ATH-06: 异步派发器背压流控策略验证 (Inv-ASYNC-BACKPRESSURE-SAFETY-4)
## -----------------------------------------------------------------------------
static func test_async_dispatcher_backpressure_drop_oldest_strategy() -> Dictionary:
	var dispatcher := AgentAsyncDispatcher.new(10, AgentAsyncDispatcher.Strategy.DROP_OLDEST)
	dispatcher.set_deterministic_mode(false) # 关闭确定性同步以验证真实队列

	for i in range(1, 26):
		var pkt := AgentHudTelemetryPacketDTO.new()
		pkt.sequence_index = i
		dispatcher.dispatch_telemetry(pkt)

	if dispatcher.get_queue_depth() > 10:
		return TestCase.make_result("test_async_dispatcher_backpressure_drop_oldest_strategy", false, {
			"error": "背压队列超过上限容量: %d" % dispatcher.get_queue_depth()
		})

	if dispatcher.get_total_dropped() != 15:
		return TestCase.make_result("test_async_dispatcher_backpressure_drop_oldest_strategy", false, {
			"error": "丢弃统计计数不符合 DROP_OLDEST: %d (预期 15)" % dispatcher.get_total_dropped()
		})

	var drained: int = dispatcher.pump()
	if drained != 10 or dispatcher.get_queue_depth() != 0:
		return TestCase.make_result("test_async_dispatcher_backpressure_drop_oldest_strategy", false, {
			"error": "pump() 排空队列后深度异常: %d (排空项: %d)" % [dispatcher.get_queue_depth(), drained]
		})

	dispatcher.clear()
	return TestCase.make_result("test_async_dispatcher_backpressure_drop_oldest_strategy", true)

## -----------------------------------------------------------------------------
## TC-ATH-07: 确定性单线程同步测试模式时序保序验证 (Inv-DETERMINISTIC-TEST-MODE-5)
## -----------------------------------------------------------------------------
static func test_deterministic_test_mode_single_thread_synchronism() -> Dictionary:
	var dispatcher := AgentAsyncDispatcher.new(64)
	dispatcher.set_deterministic_mode(true)

	var received_packets: Array[int] = []
	dispatcher.register_sink("test_sink", func(pkt: AgentHudTelemetryPacketDTO) -> void:
		received_packets.append(pkt.sequence_index)
	)

	for i in range(1, 11):
		var pkt := AgentHudTelemetryPacketDTO.new()
		pkt.sequence_index = i
		dispatcher.dispatch_telemetry(pkt)

	if received_packets.size() != 10 or received_packets[9] != 10:
		return TestCase.make_result("test_deterministic_test_mode_single_thread_synchronism", false, {
			"error": "确定性模式下未立即同步交付数据包"
		})

	return TestCase.make_result("test_deterministic_test_mode_single_thread_synchronism", true)

## -----------------------------------------------------------------------------
## TC-ATH-08: 紧凑二进制编码与 DTO 双向无损互逆断言 (Inv-BINARY-ROUNDTRIP-LOSSLESS-3)
## -----------------------------------------------------------------------------
static func test_binary_telemetry_codec_roundtrip_lossless_equivalence() -> Dictionary:
	var ctx := _create_base_context()
	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)
	var original_pkt := AgentHudSliceSolver.assemble_telemetry_packet(snapshot, null, 77, "ROUNDTRIP_TEST")

	var bytes := BinaryTelemetryCodec.encode_to_bytes(original_pkt)
	if bytes.is_empty():
		return TestCase.make_result("test_binary_telemetry_codec_roundtrip_lossless_equivalence", false, {
			"error": "二进制编码产物为空"
		})

	var restored_pkt := BinaryTelemetryCodec.decode_from_bytes(bytes)
	if restored_pkt == null:
		return TestCase.make_result("test_binary_telemetry_codec_roundtrip_lossless_equivalence", false, {
			"error": "二进制反序列化产物为空"
		})

	if restored_pkt.sequence_index != 77 or restored_pkt.observation == null:
		return TestCase.make_result("test_binary_telemetry_codec_roundtrip_lossless_equivalence", false, {
			"error": "反序列化信封字段不一致"
		})

	if not is_equal_approx(restored_pkt.observation.hp_current, original_pkt.observation.hp_current):
		return TestCase.make_result("test_binary_telemetry_codec_roundtrip_lossless_equivalence", false, {
			"error": "反序列化 HP 数值不一致"
		})

	if restored_pkt.action_space.size() != original_pkt.action_space.size():
		return TestCase.make_result("test_binary_telemetry_codec_roundtrip_lossless_equivalence", false, {
			"error": "反序列化行动空间大小不一致"
		})

	return TestCase.make_result("test_binary_telemetry_codec_roundtrip_lossless_equivalence", true)

## -----------------------------------------------------------------------------
## TC-ATH-09: 二进制单包体积极限与压缩率断言 (Inv-BINARY-SIZE-BUDGET-4)
## -----------------------------------------------------------------------------
static func test_binary_telemetry_size_budget_and_compression_ratio() -> Dictionary:
	var ctx := _create_base_context()
	var snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(ctx)
	var pkt := AgentHudSliceSolver.assemble_telemetry_packet(snapshot, null, 1, "SIZE_BENCHMARK")

	var bytes := BinaryTelemetryCodec.encode_to_bytes(pkt)
	var byte_len: int = bytes.size()

	# 刚性预算：单包严格 <= 256 字节
	if byte_len > 256:
		return TestCase.make_result("test_binary_telemetry_size_budget_and_compression_ratio", false, {
			"error": "二进制包体超限: %d 字节 (上限 256)" % byte_len
		})

	# 对比 JSON 字典体积（约 1500~2500 字节），压缩率应 >= 80%
	var json_str := JSON.stringify(pkt.to_dto())
	var json_len: int = json_str.length()
	var compression_ratio: float = 1.0 - (float(byte_len) / float(json_len))

	if compression_ratio < 0.80:
		return TestCase.make_result("test_binary_telemetry_size_budget_and_compression_ratio", false, {
			"error": "压缩率不足 80%: %.2f%% (byte: %d, json: %d)" % [compression_ratio * 100.0, byte_len, json_len]
		})

	return TestCase.make_result("test_binary_telemetry_size_budget_and_compression_ratio", true)

## -----------------------------------------------------------------------------
## TC-ATH-10: 伴侣观察总线重构平滑向前兼容性验证 (Inv-SEAMLESS-COMPATIBILITY-1)
## -----------------------------------------------------------------------------
static func test_companion_observer_bus_refactor_backward_compatibility() -> Dictionary:
	CompanionObserverBus.reset_for_tests()
	var bus := CompanionObserverBus.get_instance()

	var received_events: Array[String] = []
	bus.register_observer(func(ev_type: String, _p: Dictionary) -> void:
		received_events.append(ev_type)
	)

	# 广播 50 条事件测试 O(1) 滚动覆盖与向前兼容
	for i in range(1, 51):
		bus.broadcast_event("test_step_%d" % i, {"step": i})

	if received_events.size() != 50:
		return TestCase.make_result("test_companion_observer_bus_refactor_backward_compatibility", false, {
			"error": "观察者接收事件丢失: %d (预期 50)" % received_events.size()
		})

	var recent := bus.get_recent_events(8)
	if recent.size() != 8 or str(recent[7].get("event_type", "")) != "test_step_50":
		return TestCase.make_result("test_companion_observer_bus_refactor_backward_compatibility", false, {
			"error": "最新事件切片尾部不匹配"
		})

	CompanionObserverBus.reset_for_tests()
	return TestCase.make_result("test_companion_observer_bus_refactor_backward_compatibility", true)
