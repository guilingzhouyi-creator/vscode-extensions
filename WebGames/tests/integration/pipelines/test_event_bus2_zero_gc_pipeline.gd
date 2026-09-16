# ==============================================================================
# 单元测试：Phase 72 新一代EventBus 2.0空间分发与零GC流水线验收套件
# 文件路径: res://tests/integration/pipelines/test_event_bus2_zero_gc_pipeline.gd
# 职责: 验证新一代分发中枢的高性能、池化守恒、空间精确裁剪与因果时序一致性（12项断言）。
# ==============================================================================
class_name TestEventBus2ZeroGCPipeline
extends RefCounted

const EventPacket = preload("res://backend/infrastructure/event_bus/event_packet.gd")
const EventCategoryMask = preload("res://backend/infrastructure/event_bus/event_category_mask.gd")
const EventChannelDefinition = preload("res://backend/infrastructure/event_bus/event_channel_definition.gd")
const VisualCueDTO = preload("res://backend/infrastructure/event_bus/visual_cue_dto.gd")
const PingPongRingBuffer = preload("res://backend/infrastructure/event_bus/ping_pong_ring_buffer.gd")
const EventPool = preload("res://backend/infrastructure/event_bus/event_pool.gd")
const HeadlessSpatialHashGrid3D = preload("res://backend/infrastructure/event_bus/headless_spatial_hash_grid_3d.gd")
const EventBusSubscriptionToken = preload("res://backend/infrastructure/event_bus/event_bus_subscription_token.gd")
const IVisualPresentationAdapter = preload("res://backend/infrastructure/event_bus/visual_presentation_adapter.gd")
const HeadlessPresentationMockAdapter = preload("res://backend/infrastructure/event_bus/headless_presentation_mock_adapter.gd")
const EventBusCore = preload("res://backend/infrastructure/event_bus/event_bus_core.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_event_pool_zero_deep_copy_conservation())
	results.append(_test_spatial_hash_grid_aoi_zero_wakeup())
	results.append(_test_dispatch_now_strict_causal_inlining())
	results.append(_test_enqueue_frame_ping_pong_batch_flush())
	results.append(_test_category_bitmask_orthogonal_isolation())
	results.append(_test_subscription_token_lifecycle())
	results.append(_test_config_driven_cell_size_and_limits())
	results.append(_test_spatial_listener_motion_migration())
	results.append(_test_reentrancy_circuit_breaker())
	results.append(_test_iteration_safety_under_concurrent_modification())
	results.append(_test_2d_projection_and_headless_routing())
	results.append(_test_headless_presentation_api_control_without_models())

	var passed_cnt: int = 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
	return {
		"domain": "Phase 72: 新一代EventBus 2.0空间分发测试套件",
		"all_passed": (passed_cnt == results.size()),
		"total_count": results.size(),
		"passed_count": passed_cnt,
		"results": results
	}

# ---- 1. 池化守恒与零深拷贝 ----
static func _test_event_pool_zero_deep_copy_conservation() -> Dictionary:
	var tname := "TC-EB2-01: 池化守恒与防双重归还"
	var pool := EventPool.new(512)
	var primer := pool.borrow()
	pool.recycle(primer)
	var init_free: int = pool.get_free_count()
	var iterations: int = 100000
	for i in range(iterations):
		var pkt: EventPacket = pool.borrow()
		pkt.channel_id = EventChannelDefinition.SYSTEM_HEARTBEAT_TICK
		pkt.category_mask = EventCategoryMask.SYSTEM_TELEMETRY
		pkt.payload_data = {"tick": i}
		pool.recycle(pkt)
	if pool.get_free_count() != init_free:
		return {"name": tname, "test": tname, "passed": false, "message": "借还失衡 free=%d" % pool.get_free_count()}
	if pool.get_borrowed_count() != 0:
		return {"name": tname, "test": tname, "passed": false, "message": "借出残留 borrowed=%d" % pool.get_borrowed_count()}
	var single := pool.borrow()
	if not pool.recycle(single):
		return {"name": tname, "test": tname, "passed": false, "message": "正常借还应返回 true"}
	if pool.recycle(single):
		return {"name": tname, "test": tname, "passed": false, "message": "重复归还应被拒绝并返回 false"}
	return {"name": tname, "test": tname, "passed": true, "message": "100,000 次借还守恒，防双重归还生效"}

# ---- 2. 空间精确裁剪（Inv-EB4-2） ----
static func _test_spatial_hash_grid_aoi_zero_wakeup() -> Dictionary:
	var tname := "TC-EB2-02: 空间精确裁剪与半影外零唤醒"
	var grid := HeadlessSpatialHashGrid3D.new(16.0)
	var near := {"n": 0}
	var far := {"n": 0}
	grid.register_listener(1, Vector3(10, 0, 10), 15.0, func(_p: EventPacket) -> void: near["n"] += 1)
	grid.register_listener(2, Vector3(500, 0, 500), 15.0, func(_p: EventPacket) -> void: far["n"] += 1)

	var pkt := EventPacket.new()
	pkt.channel_id = EventChannelDefinition.SPATIAL_EXPLOSION_IMPACT
	pkt.category_mask = EventCategoryMask.SPATIAL_VFX
	pkt.set_spatial_header(Vector3(12, 0, 12), 20.0)
	grid.dispatch_packet(pkt)

	if near["n"] != 1:
		return {"name": tname, "test": tname, "passed": false, "message": "近邻应精确唤醒 1 次，实际 %d" % near["n"]}
	if far["n"] != 0:
		return {"name": tname, "test": tname, "passed": false, "message": "远端必须 0 唤醒，实际 %d" % far["n"]}
	return {"name": tname, "test": tname, "passed": true, "message": "半径+欧氏精确裁剪，远端零唤醒"}

# ---- 3. dispatch_now 同步因果 ----
static func _test_dispatch_now_strict_causal_inlining() -> Dictionary:
	var tname := "TC-EB2-03: dispatch_now 严格同步因果强一致"
	var bus := EventBusCore.new()
	var state := {"player_hp": 100}
	var token := bus.subscribe(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.CORE_STATE,
		func(_pkt: EventPacket) -> void: state["player_hp"] -= 35)
	var pkt := bus.borrow_packet(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.CORE_STATE, {"damage": 35})
	bus.dispatch_now(pkt)
	bus.recycle_packet(pkt)
	var ok: bool = (int(state["player_hp"]) == 65)
	token.unbind()
	if not ok:
		return {"name": tname, "test": tname, "passed": false, "message": "同步因果漂移，当前HP=%d" % int(state["player_hp"])}
	return {"name": tname, "test": tname, "passed": true, "message": "dispatch_now 返回时状态已结算"}

# ---- 4. 帧级合批 FIFO + 自动回收 ----
static func _test_enqueue_frame_ping_pong_batch_flush() -> Dictionary:
	var tname := "TC-EB2-04: 帧级合批 FIFO 保持与自动回收"
	var bus := EventBusCore.new()
	var received: Array[int] = []
	bus.subscribe(EventChannelDefinition.HUD_WALLET_MUTATED, EventCategoryMask.SPATIAL_VFX,
		func(pkt: EventPacket) -> void: received.append(int((pkt.payload_data as Dictionary).get("seq", -1))))
	var bus_pool := bus.get_pool()
	var warmup: Array[EventPacket] = []
	for i in range(10):
		warmup.append(bus_pool.borrow())
	for p in warmup:
		bus_pool.recycle(p)
	var init_free: int = bus_pool.get_free_count()
	for i in range(10):
		var pkt := bus.borrow_packet(EventChannelDefinition.HUD_WALLET_MUTATED, EventCategoryMask.SPATIAL_VFX, {"seq": i})
		if not bus.enqueue_frame(pkt):
			return {"name": tname, "test": tname, "passed": false, "message": "入队失败"}
	if received.size() != 0:
		return {"name": tname, "test": tname, "passed": false, "message": "flush 前不应分发"}
	bus.flush_frame_events()
	if received.size() != 10:
		return {"name": tname, "test": tname, "passed": false, "message": "清算数量不符，实际 %d" % received.size()}
	for i in range(10):
		if received[i] != i:
			return {"name": tname, "test": tname, "passed": false, "message": "FIFO 乱序"}
	if bus_pool.get_free_count() != init_free:
		return {"name": tname, "test": tname, "passed": false, "message": "帧清算未自动回收事件包 free=%d init=%d" % [bus_pool.get_free_count(), init_free]}
	return {"name": tname, "test": tname, "passed": true, "message": "帧合批 FIFO 保持且自动回收"}

# ---- 5. 正交位掩码隔离 ----
static func _test_category_bitmask_orthogonal_isolation() -> Dictionary:
	var tname := "TC-EB2-05: 五类正交二进制位掩码隔离"
	var bus := EventBusCore.new()
	var state_c := {"n": 0}
	var audio_c := {"n": 0}
	var tok_state := bus.subscribe(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.CORE_STATE,
		func(_p: EventPacket) -> void: state_c["n"] += 1)
	var tok_audio := bus.subscribe(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.SPATIAL_AUDIO,
		func(_p: EventPacket) -> void: audio_c["n"] += 1)
	var pkt := bus.borrow_packet(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.SPATIAL_AUDIO, {})
	bus.dispatch_now(pkt)
	bus.recycle_packet(pkt)
	tok_state.unbind()
	tok_audio.unbind()
	if state_c["n"] != 0 or audio_c["n"] != 1:
		return {"name": tname, "test": tname, "passed": false, "message": "位掩码隔离失效 state=%d audio=%d" % [state_c["n"], audio_c["n"]]}
	return {"name": tname, "test": tname, "passed": true, "message": "正交位掩码隔离通过"}

# ---- 6. 订阅令牌幂等解绑 ----
static func _test_subscription_token_lifecycle() -> Dictionary:
	var tname := "TC-EB2-06: 订阅令牌生命周期与幂等解绑"
	var bus := EventBusCore.new()
	var counter := {"n": 0}
	var token := bus.subscribe(EventChannelDefinition.SYSTEM_HEARTBEAT_TICK, EventCategoryMask.SYSTEM_TELEMETRY,
		func(_p: EventPacket) -> void: counter["n"] += 1)
	var p1 := bus.borrow_packet(EventChannelDefinition.SYSTEM_HEARTBEAT_TICK, EventCategoryMask.SYSTEM_TELEMETRY, {})
	bus.dispatch_now(p1)
	bus.recycle_packet(p1)
	if counter["n"] != 1:
		return {"name": tname, "test": tname, "passed": false, "message": "解绑前未触发 count=%d" % counter["n"]}
	if not token.unbind():
		return {"name": tname, "test": tname, "passed": false, "message": "首次解绑应返回 true"}
	if token.unbind():
		return {"name": tname, "test": tname, "passed": false, "message": "重复解绑应返回 false"}
	var p2 := bus.borrow_packet(EventChannelDefinition.SYSTEM_HEARTBEAT_TICK, EventCategoryMask.SYSTEM_TELEMETRY, {})
	bus.dispatch_now(p2)
	bus.recycle_packet(p2)
	if counter["n"] != 1:
		return {"name": tname, "test": tname, "passed": false, "message": "解绑后仍触发 count=%d" % counter["n"]}
	return {"name": tname, "test": tname, "passed": true, "message": "订阅令牌幂等解绑闭环通过"}

# ---- 7. 配置驱动与下限防御 ----
static func _test_config_driven_cell_size_and_limits() -> Dictionary:
	var tname := "TC-EB2-07: 全量配置驱动与安全下限防御"
	var bus := EventBusCore.new()
	bus.initialize_from_config()
	if bus.get_spatial_cell_size() <= 0.0:
		return {"name": tname, "test": tname, "passed": false, "message": "网格尺寸解析异常"}
	if bus.get_frame_buffer_capacity() <= 0:
		return {"name": tname, "test": tname, "passed": false, "message": "缓冲容量解析异常"}
	if bus.get_max_dispatch_depth() <= 0:
		return {"name": tname, "test": tname, "passed": false, "message": "熔断深度解析异常"}
	return {"name": tname, "test": tname, "passed": true, "message": "配置驱动与下限防御通过"}

# ---- 8. 动态跨格迁移 ----
static func _test_spatial_listener_motion_migration() -> Dictionary:
	var tname := "TC-EB2-08: 空间实体位移跨桶原子迁移"
	var grid := HeadlessSpatialHashGrid3D.new(16.0)
	var counter := {"n": 0}
	var cb := func(_p: EventPacket) -> void: counter["n"] += 1
	grid.register_listener(99, Vector3(5, 0, 5), 10.0, cb)
	grid.update_listener_position(99, Vector3(100, 0, 100), 10.0, cb)

	var p_old := EventPacket.new()
	p_old.set_spatial_header(Vector3(5, 0, 5), 10.0)
	grid.dispatch_packet(p_old)
	if counter["n"] != 0:
		return {"name": tname, "test": tname, "passed": false, "message": "旧位置幽灵唤醒"}

	var p_new := EventPacket.new()
	p_new.set_spatial_header(Vector3(102, 0, 102), 10.0)
	grid.dispatch_packet(p_new)
	if counter["n"] != 1:
		return {"name": tname, "test": tname, "passed": false, "message": "新位置未精确唤醒"}
	return {"name": tname, "test": tname, "passed": true, "message": "跨格迁移零幽灵唤醒通过"}

# ---- 9. 重入熔断（经 ErrorReporter，进程不崩溃） ----
static func _test_reentrancy_circuit_breaker() -> Dictionary:
	var tname := "TC-EB2-09: 递归重入断路器熔断保护"
	var bus := EventBusCore.new()
	var depth := {"d": 0}
	var recursive_cb: Callable
	recursive_cb = func(_pkt: EventPacket) -> void:
		depth["d"] += 1
		if depth["d"] < 64:
			var loop := bus.borrow_packet(0x0999, EventCategoryMask.CORE_STATE, {})
			bus.dispatch_now(loop)
			bus.recycle_packet(loop)
	bus.subscribe(0x0999, EventCategoryMask.CORE_STATE, recursive_cb)
	var start := bus.borrow_packet(0x0999, EventCategoryMask.CORE_STATE, {})
	bus.dispatch_now(start)
	bus.recycle_packet(start)
	if depth["d"] > bus.get_max_dispatch_depth():
		return {"name": tname, "test": tname, "passed": false, "message": "熔断失效，深度 %d" % depth["d"]}
	return {"name": tname, "test": tname, "passed": true, "message": "重入熔断安全拦截"}

# ---- 10. 遍历中动态解绑安全 ----
static func _test_iteration_safety_under_concurrent_modification() -> Dictionary:
	var tname := "TC-EB2-10: 遍历分发中动态修改与解绑安全"
	var bus := EventBusCore.new()
	var order: Array[int] = []
	var token_holder: Array = [null]
	var token1 := bus.subscribe(0x0888, EventCategoryMask.CORE_STATE, func(_p: EventPacket) -> void:
		order.append(1)
		if token_holder[0] != null:
			(token_holder[0] as EventBusSubscriptionToken).unbind()
	)
	token_holder[0] = token1
	bus.subscribe(0x0888, EventCategoryMask.CORE_STATE, func(_p: EventPacket) -> void: order.append(2))

	var pkt := bus.borrow_packet(0x0888, EventCategoryMask.CORE_STATE, {})
	bus.dispatch_now(pkt)
	bus.recycle_packet(pkt)
	if order != [1, 2]:
		return {"name": tname, "test": tname, "passed": false, "message": "回调内解绑导致跳项: %s" % str(order)}
	order.clear()
	var pkt2 := bus.borrow_packet(0x0888, EventCategoryMask.CORE_STATE, {})
	bus.dispatch_now(pkt2)
	bus.recycle_packet(pkt2)
	if order != [2]:
		return {"name": tname, "test": tname, "passed": false, "message": "已解绑监听器残留: %s" % str(order)}
	return {"name": tname, "test": tname, "passed": true, "message": "遍历中解绑零跳项通过"}

# ---- 11. 2D 投影与无头路由 ----
static func _test_2d_projection_and_headless_routing() -> Dictionary:
	var tname := "TC-EB2-11: 2D/2.5D 平面投影无缝降维路由"
	var bus := EventBusCore.new()
	var counter := {"n": 0}
	bus.on_spatial_2d(Vector2(100, 200), 20.0, func(_p: EventPacket) -> void: counter["n"] += 1)

	var p_near := bus.borrow_packet(EventChannelDefinition.SPATIAL_COLLISION_CONTACT, EventCategoryMask.SPATIAL_VFX, {})
	bus.dispatch_spatial_2d(p_near, Vector2(105, 205), 20.0)
	bus.recycle_packet(p_near)
	if counter["n"] != 1:
		return {"name": tname, "test": tname, "passed": false, "message": "2D 近邻未唤醒"}

	var p_far := bus.borrow_packet(EventChannelDefinition.SPATIAL_COLLISION_CONTACT, EventCategoryMask.SPATIAL_VFX, {})
	bus.dispatch_spatial_2d(p_far, Vector2(1000, 2000), 20.0)
	bus.recycle_packet(p_far)
	if counter["n"] != 1:
		return {"name": tname, "test": tname, "passed": false, "message": "2D 远端误唤醒"}
	return {"name": tname, "test": tname, "passed": true, "message": "2D 投影与空间裁剪通过"}

# ---- 12. 无模型表现适配闭环 ----
static func _test_headless_presentation_api_control_without_models() -> Dictionary:
	var tname := "TC-EB2-12: 无模型纯 API 表现解耦控制闭环"
	var mock := HeadlessPresentationMockAdapter.new()
	mock.on_entity_spawned("HERO_01", Vector3(10, 0, 10))
	if not mock.spawned_entities.has("HERO_01"):
		return {"name": tname, "test": tname, "passed": false, "message": "实体生成未捕获"}
	mock.on_entity_moved("HERO_01", Vector3(15, 0, 15), 1.57)
	if mock.spawned_entities["HERO_01"] != Vector3(15, 0, 15):
		return {"name": tname, "test": tname, "passed": false, "message": "位移未同步"}
	var cue := VisualCueDTO.new()
	cue.cue_token = VisualCueDTO.CueToken.ATTACK_SLASH_HEAVY
	cue.anchor = VisualCueDTO.AnchorPoint.PRIMARY_HAND
	cue.intensity = 1.5
	mock.on_visual_cue("HERO_01", cue)
	if mock.recorded_cues.size() != 1 or mock.recorded_cues[0]["token"] != VisualCueDTO.CueToken.ATTACK_SLASH_HEAVY:
		return {"name": tname, "test": tname, "passed": false, "message": "视觉意图传递失真"}
	mock.on_entity_despawned("HERO_01")
	if mock.spawned_entities.has("HERO_01"):
		return {"name": tname, "test": tname, "passed": false, "message": "注销未清空"}
	return {"name": tname, "test": tname, "passed": true, "message": "无模型纯 API 控制闭环通过"}
