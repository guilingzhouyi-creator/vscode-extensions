# ==============================================================================
# 模块归属: 性能基准层 (Benchmarks · 前后端通信与无头数据处理基线)
# 文件路径: res://benchmarks/bench_runtime_comms.gd
# 架构定位: Frontend-Backend Protocol & Headless Pipeline Benchmark Suite
# 依赖与触发: 触发方: bench_runner.gd | 上游: UnifiedProtocolDispatcher, HudEventBridge, AgentHudSliceBridge, HeadlessSpatialHashGrid3D, BinaryConfigReader | 下游: BenchHarness
# 职责说明: 量化前后端统一协议往返、HUD 快照增量同步、无头 Agent 遥测流水线、空间哈希裁剪与 .kdat 二进制解码吞吐基线。
# 退出语义与设计依据: 返回 { category, metrics } 标准基准字典 | 依据: 前后端通信与无头数据处理客观基线契约
# ==============================================================================

## BenchRuntimeComms：前后端跨端通信与后端无头数据处理吞吐基准套件
class_name BenchRuntimeComms extends RefCounted

static var _last_callback_payload: Dictionary = {}
static var _spatial_hit_count: int = 0

## 执行前后端通信与无头数据处理基准测试并返回分类度量集合
static func run_benchmarks() -> Array:
	var benchmark_categories: Array = []
	GameConfig.ensure_loaded()
	benchmark_categories.append(_run_frontend_backend_benchmarks())
	benchmark_categories.append(_run_headless_processing_benchmarks())
	return benchmark_categories

static func _run_frontend_backend_benchmarks() -> Dictionary:
	var metrics: Array = []
	var setup_context: Dictionary = _setup_protocol_bench_session()
	var account_id: String = str(setup_context["account_id"])
	var session_token: String = str(setup_context["session_token"])
	var character_id: String = str(setup_context["character_id"])
	var bridge: HudEventBridge = setup_context["bridge"] as HudEventBridge
	var hud_view: MainHUDView = setup_context["hud_view"] as MainHUDView

	var pull_envelope := UnifiedProtocolFactory.create_human_request(
		"world_state", "PULL_HUD_SNAPSHOT", {}, session_token, account_id, character_id
	)
	metrics.append(BenchHarness.measure(
		"FE-BE.dispatch PULL_HUD_SNAPSHOT", 5_000,
		func() -> void:
			UnifiedProtocolDispatcher.dispatch_request(pull_envelope)
	))

	metrics.append(BenchHarness.measure(
		"FE-BE.bridge dispatch_flat 战斗快照", 5_000,
		func() -> void:
			RealProtocolBridge.dispatch_flat("combat", "GET_COMBAT_SNAPSHOT", {"target_id": "BOSS_BENCH_01"})
	))

	var mutation_payload: Dictionary = {"hp_delta": -1.0, "wallet_gold_delta": 5, "cause": "BENCH_TICK"}
	metrics.append(BenchHarness.measure(
		"FE-BE.apply_mutation_and_sync 强推同步", 2_000,
		func() -> void:
			WorldSessionRuntimeService.apply_mutation_and_sync(mutation_payload, -1, true)
	))

	var stat_bus := EventBusCore.get_instance()
	var stat_dto := HudMutationEventsDTO.StatMutation.new()
	stat_dto.character_id = character_id
	stat_dto.stat_name = "HP"
	stat_dto.old_value = 95.0
	stat_dto.new_value = 94.0
	stat_dto.delta = -1.0
	metrics.append(BenchHarness.measure(
		"FE-BE.hud_bridge 增量事件直投刷新", 5_000,
		func() -> void:
			var packet := stat_bus.borrow_packet(EventChannelDefinition.HUD_STAT_MUTATED, EventCategoryMask.CORE_STATE)
			packet.payload_dto = stat_dto
			stat_bus.dispatch_now(packet)
			stat_bus.recycle_packet(packet)
	))

	var reply_callable := Callable(BenchRuntimeComms, "_on_protocol_reply")
	metrics.append(BenchHarness.measure(
		"FE-BE.real_hud_sync 端到端异步回调", 2_000,
		func() -> void:
			RealProtocolBridge.dispatch_and_reply(
				"world_state", "PULL_HUD_SNAPSHOT", {}, account_id, session_token, reply_callable, "data", {}, character_id
			)
	))

	bridge.detach_hud()
	if is_instance_valid(hud_view):
		hud_view.free()
	_teardown_protocol_bench_session()
	return {"category": "前后端通信链路 (FE-BE Protocol & HUD Sync)", "metrics": metrics}

static func _run_headless_processing_benchmarks() -> Dictionary:
	var metrics: Array = []
	var slice_bridge := AgentHudSliceBridge.new()
	slice_bridge.set_context({
		"account_id": "BENCH_ACC",
		"character_id": "BENCH_CHAR",
		"character_name": "BenchAgent",
		"hp_current": 80.0,
		"hp_max": 100.0,
		"ap_current": 8.0,
		"ap_max": 10.0,
		"wallet_gold": 500,
		"attribute_values": {"STR": 14, "AGI": 12, "INT": 10, "STA": 11}
	})
	metrics.append(BenchHarness.measure(
		"Headless.agent_step_and_publish 遥测步进", 2_000,
		func() -> void:
			slice_bridge.step_and_publish("BENCH_STEP")
	))

	var sample_packet := slice_bridge.step_and_publish("BENCH_SAMPLE")
	var encoded_bytes: PackedByteArray = BinaryTelemetryCodec.encode_to_bytes(sample_packet)
	var decode_target := AgentHudTelemetryPacketDTO.new()
	metrics.append(BenchHarness.measure(
		"Headless.binary_telemetry 编码+复用解码", 10_000,
		func() -> void:
			var packet_bytes := BinaryTelemetryCodec.encode_to_bytes(sample_packet)
			BinaryTelemetryCodec.decode_from_bytes(packet_bytes, decode_target)
	))
	var _byte_check := encoded_bytes.size()

	var small_grid := HeadlessSpatialHashGrid3D.new(16.0, 256.0)
	var spatial_callback := Callable(BenchRuntimeComms, "_on_spatial_hit")
	for listener_index in range(16):
		small_grid.register_listener(
			listener_index + 1,
			Vector3(float(listener_index) * 8.0, 0.0, float(listener_index % 4) * 8.0),
			12.0,
			spatial_callback
		)
	var spatial_packet := EventPacket.new()
	spatial_packet.channel_id = EventChannelDefinition.DOMAIN_EVENT_GENERIC
	metrics.append(BenchHarness.measure(
		"Headless.spatial_grid 稀疏派发(N=16,R=256)", 200,
		func() -> void:
			small_grid.dispatch_spatial(Vector3(32.0, 0.0, 8.0), 256.0, spatial_packet)
	))

	var dense_grid := HeadlessSpatialHashGrid3D.new(16.0, 256.0)
	for dense_index in range(128):
		@warning_ignore("integer_division")
		var row_coordinate := dense_index / 16
		dense_grid.register_listener(
			dense_index + 1,
			Vector3(float(dense_index % 16) * 10.0, 0.0, float(row_coordinate) * 10.0),
			10.0,
			spatial_callback
		)
	metrics.append(BenchHarness.measure(
		"Headless.spatial_grid 稠密派发(N=128,R=64)", 1_000,
		func() -> void:
			dense_grid.dispatch_spatial(Vector3(40.0, 0.0, 40.0), 64.0, spatial_packet)
	))

	var sample_kdat_buffer: PackedByteArray = _build_sample_kdat_buffer()
	metrics.append(BenchHarness.measure(
		"Headless.kdat_decode_crc32 二进制表解码", 1_000,
		func() -> void:
			BinaryConfigReader.load_kdat_buffer(sample_kdat_buffer)
	))
	var crc_sample_bytes := PackedByteArray()
	crc_sample_bytes.resize(65536)
	metrics.append(BenchHarness.measure(
		"Headless.crc32_64kb 数据流校验", 200,
		func() -> void:
			BinaryConfigReader.compute_crc32(crc_sample_bytes)
	))

	small_grid.clear()
	dense_grid.clear()
	slice_bridge.reset_state()
	CompanionObserverBus.reset_for_tests()
	return {"category": "无头数据处理与算法 (Headless Processing)", "metrics": metrics}

static func _setup_protocol_bench_session() -> Dictionary:
	_teardown_protocol_bench_session()
	var account_store: Dictionary = {}
	var register_request := AccountRegistrationDTO.Request.new()
	register_request.username = "bench_fe_be_user"
	register_request.password_plain = "BenchPass#2026"
	var auth_result: Dictionary = AuthService.register_and_login(register_request, true, account_store)
	var account_id: String = str(auth_result.get("account_id", ""))
	var session_token: String = str(auth_result.get("session_token", ""))
	var character_id: String = "BENCH_HERO_01"
	WorldSessionRuntimeService.activate_authenticated_session(account_id, session_token)
	WorldSessionRuntimeService.activate_world_session({
		"account_id": account_id,
		"world_id": "WORLD_BENCH_01",
		"character_id": character_id,
		"character_name": "BenchHero",
		"hp_current": 100.0,
		"hp_max": 100.0,
		"mp_current": 50.0,
		"mp_max": 50.0,
		"ap_current": 10.0,
		"ap_max": 10.0,
		"wallet_gold": 1000,
		"attribute_values": {"STR": 12, "AGI": 10}
	}, false)
	var hud_view := MainHUDView.new()
	var bridge := HudEventBridge.get_instance()
	bridge.attach_hud(hud_view)
	return {
		"account_id": account_id,
		"session_token": session_token,
		"character_id": character_id,
		"hud_view": hud_view,
		"bridge": bridge
	}

static func _teardown_protocol_bench_session() -> void:
	HudEventBridge.reset_for_tests()
	WorldSessionRuntimeService.reset_for_tests()
	HumanControlLeaseManager.reset_for_tests()
	UnifiedProtocolFactory.reset_for_tests()
	AuthService.clear_sessions()
	CompanionObserverBus.reset_for_tests()

static func _on_protocol_reply(payload: Dictionary) -> void:
	_last_callback_payload = payload

static func _on_spatial_hit(_packet: EventPacket) -> void:
	_spatial_hit_count += 1

static func _build_sample_kdat_buffer() -> PackedByteArray:
	var table_data: Dictionary = GameConfig.get_table("infrastructure.event_bus_config", {})
	var writer_payload: PackedByteArray = BinaryConfigWriter.encode_kdat_buffer(
		table_data, true, KDataHeaderDTO.PAYLOAD_SINGLE_TABLE, false
	)
	return writer_payload
