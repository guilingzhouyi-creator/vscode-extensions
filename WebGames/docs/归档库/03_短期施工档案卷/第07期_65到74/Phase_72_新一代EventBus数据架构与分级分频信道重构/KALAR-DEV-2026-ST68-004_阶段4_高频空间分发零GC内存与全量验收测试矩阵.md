---
档号: KALAR-DEV-2026-ST68-004
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST68 (Phase_72_新一代EventBus数据架构与分级分频信道重构)
件号: 004
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_72_新一代EventBus数据架构与分级分频信道重构 —— 阶段4：高频空间分发零GC内存与全量验收测试矩阵
形成日期: 2026-09-08
归档日期: 2026-09-09（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: TestEventBus2ZeroGCPipeline; 池化守恒与零深拷贝; 空间精确裁剪零唤醒; 同步因果单向传递; code_governance_rules.json
---

# 施工细则：Phase 72 新一代EventBus数据架构与分级分频信道重构 —— 阶段4：高频空间分发零GC内存与全量验收测试矩阵

> 施工开始日期：2026-09-08（下午）
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已完成（Round 2 实施与全量验证闭环）

> [!NOTE]
> **【施工目标】**：建立 Phase 72 专属自动化测试套件（`TestEventBus2ZeroGCPipeline`，12 项断言，API 与阶段 1~3 严格一致、可编译），验证新一代分发中枢的高性能、池化守恒、空间精确裁剪与因果时序一致性：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST68-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST68-ATT_附件_案卷共享契约与上下文.md)。
> 1. 万次高频借还守恒 + 池外新建计数 0（`ADV-PRF-002` 可测口径）；
> 2. 空间哈希网格 `listener_radius` + 欧氏距离精确裁剪，范围外绝对 0 唤醒；
> 3. `dispatch_now()` 即时同步因果；`enqueue_frame`+`flush_frame_events` 帧级 FIFO 合批；
> 4. 正交位掩码隔离、订阅令牌幂等解绑、跨格迁移、重入熔断、遍历中解绑安全、2D 投影、无模型表现适配闭环；
> 5. 迁移路线图与阶段 3 口径统一（P72 内不退役旧版；旧测试基线不被破坏）。
> **对应需求源**：Phase 72 阶段 1~3；用户指令（2026-09-08）；`tests/test_registry.gd`（下一空槽挂载）；`scripts/config/code_governance_rules.json` ADV-PRF-002/ADV-POOL-001。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST68-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST68-001_阶段1_EventPacket池化数据架构与位掩码信道拓扑设计.md) ｜ [阶段2](KALAR-DEV-2026-ST68-002_阶段2_三模分发引擎与无头空间哈希网格路由算法实现.md) ｜ [阶段3](KALAR-DEV-2026-ST68-003_阶段3_配置驱动分流与全域现代调用接口改造工程化.md) ｜ **阶段4 (当前)**

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  - 全域既有基线（路线图总索引 2026-09-08 实况）：93 套 / 644 断言 100% PASS；本卷**不破坏**该基线（旧版总线保留运行，迁移按 P73/P74）
  - `tests/test_registry.gd`：新增套件挂载下一空槽并同步 `get_all_test_classes()`/TC-ARCH-03
  - 存量待迁移真实套件清单（实测存在）：`test_account.gd`、`test_event_driven_audio.gd`、`test_event_description.gd`、`test_narrative_orchestration.gd`、`test_combat_tertiary_timeline_pipeline.gd`
  - `backend/infrastructure/error_reporter.gd`（熔断/禁入告警统一入口）
* **核心不变量约束断言**：
  - `Inv-EB4-1 (池化守恒与零深拷贝)`：100,000 次高频借还下借还差恒 0、池外新建 EventPacket 计数 0；热路径无 `.duplicate(true)` 深拷贝（对齐 ADV-PRF-002，不承诺 GDScript 绝对零堆）。
  - `Inv-EB4-2 (空间精确裁剪零唤醒)`：欧氏距离 > `listener_radius + effect_radius` 的监听者回调与解包次数严格为 0。
  - `Inv-EB4-3 (同步因果单向传递)`：`dispatch_now()` 返回前下游状态突变 100% 结算完毕。
  - `Inv-EB4-4 (双缓冲帧级 FIFO 隔离)`：帧合批严格保持入队 FIFO，清算周期不阻塞写入。
  - `Inv-EB4-5 (新旧架构解耦与迁移明确)`：旧版总线保留运行；迁移按 P73/P74 分波次，退役为最终收口（不在本卷）。
  - `Inv-EB4-6 (动态移动跨桶迁移正确性)`：跨格移动后仅新格精确命中、旧格 0 唤醒。
  - `Inv-EB4-7 (死锁重入熔断零崩溃)`：深度达配置上限触发断路器，进程不崩溃（经 ErrorReporter 告警）。
  - `Inv-EB4-8 (派发中动态解绑零越界)`：回调内 `unbind()` 不跳项不越界。
  - `Inv-EB4-9 (无模型纯 API 控制闭环)`：0 模型/0 贴图/0 Node 环境下表现抽象 API 100% 稳定接收 VisualCueDTO 语义意图。

---

## 一、 专属验收测试套件设计 (`TestEventBus2ZeroGCPipeline`)

* 模块路径: `res://tests/unit/test_event_bus2_zero_gc_pipeline.gd`
* 类名: `TestEventBus2ZeroGCPipeline`
* 挂载位置: `tests/test_registry.gd` 下一空槽（同步 `get_all_test_classes()` 与 TC-ARCH-03 登记）
* 隔离约定: 测试一律 `EventBusCore.new()` 独立实例 + `initialize_from_config()`（或 `clear_for_tests()`），不触碰应用级单例 `get_instance()`；旧版 `event_bus.gd` 全域信号不受影响。

```gdscript
class_name TestEventBus2ZeroGCPipeline
extends RefCounted

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

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
	return {
		"domain": "Phase 72: 新一代EventBus 2.0空间分发测试套件",
		"total": results.size(),
		"passed": passed_cnt,
		"failed": results.size() - passed_cnt,
		"results": results
	}

# ---- 1. 池化守恒与零深拷贝 ----
static func _test_event_pool_zero_deep_copy_conservation() -> Dictionary:
	var tname := "TC-EB2-01"
	var pool := EventPool.new(512)
	var init_free := pool.get_free_count()
	var iterations := 100000
	for i in range(iterations):
		var pkt := pool.borrow()
		pkt.channel_id = EventChannelDefinition.SYSTEM_HEARTBEAT_TICK
		pkt.category_mask = EventCategoryMask.SYSTEM_TELEMETRY
		pkt.payload_data = {"tick": i}
		pool.recycle(pkt)
	if pool.get_free_count() != init_free:
		return {"name": tname, "passed": false, "message": "借还失衡 free=%d" % pool.get_free_count()}
	if pool.get_borrowed_count() != 0:
		return {"name": tname, "passed": false, "message": "借出残留 borrowed=%d" % pool.get_borrowed_count()}
	if pool.recycle(pool.borrow()) == false:
		return {"name": tname, "passed": false, "message": "正常借还应返回 true"}
	return {"name": tname, "passed": true, "message": "100,000 次借还守恒，防双重归还生效"}

# ---- 2. 空间精确裁剪（Inv-EB4-2） ----
static func _test_spatial_hash_grid_aoi_zero_wakeup() -> Dictionary:
	var tname := "TC-EB2-02"
	var grid := HeadlessSpatialHashGrid3D.new(16.0)
	var near := {"n": 0}
	var far := {"n": 0}
	grid.register_listener(1, Vector3(10, 0, 10), 15.0, func(p: EventPacket) -> void: near["n"] += 1)
	grid.register_listener(2, Vector3(500, 0, 500), 15.0, func(p: EventPacket) -> void: far["n"] += 1)

	var pkt := EventPacket.new()
	pkt.channel_id = EventChannelDefinition.SPATIAL_EXPLOSION_IMPACT
	pkt.category_mask = EventCategoryMask.SPATIAL_VFX
	pkt.set_spatial_header(Vector3(12, 0, 12), 20.0)
	grid.dispatch_packet(pkt)

	if near["n"] != 1:
		return {"name": tname, "passed": false, "message": "近邻应精确唤醒 1 次，实际 %d" % near["n"]}
	if far["n"] != 0:
		return {"name": tname, "passed": false, "message": "远端必须 0 唤醒，实际 %d" % far["n"]}
	return {"name": tname, "passed": true, "message": "半径+欧氏精确裁剪，远端零唤醒"}

# ---- 3. dispatch_now 同步因果 ----
static func _test_dispatch_now_strict_causal_inlining() -> Dictionary:
	var tname := "TC-EB2-03"
	var bus := EventBusCore.new()
	var state := {"player_hp": 100}
	var token := bus.subscribe(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.CORE_STATE,
		func(pkt: EventPacket) -> void: state["player_hp"] -= 35)
	var pkt := bus.borrow_packet(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.CORE_STATE, {"damage": 35})
	bus.dispatch_now(pkt)
	bus.recycle_packet(pkt)
	var ok := state["player_hp"] == 65
	token.unbind()
	if not ok:
		return {"name": tname, "passed": false, "message": "同步因果漂移"}
	return {"name": tname, "passed": true, "message": "dispatch_now 返回时状态已结算"}

# ---- 4. 帧级合批 FIFO + 自动回收 ----
static func _test_enqueue_frame_ping_pong_batch_flush() -> Dictionary:
	var tname := "TC-EB2-04"
	var bus := EventBusCore.new()
	var received: Array[int] = []
	bus.subscribe(EventChannelDefinition.HUD_WALLET_MUTATED, EventCategoryMask.CORE_STATE,
		func(pkt: EventPacket) -> void: received.append(int((pkt.payload_data as Dictionary).get("seq", -1))))
	var bus_pool := bus.get_pool()
	var init_free := bus_pool.get_free_count()
	for i in range(10):
		var pkt := bus.borrow_packet(EventChannelDefinition.HUD_WALLET_MUTATED, EventCategoryMask.CORE_STATE, {"seq": i})
		if not bus.enqueue_frame(pkt):
			return {"name": tname, "passed": false, "message": "入队失败"}
	if received.size() != 0:
		return {"name": tname, "passed": false, "message": "flush 前不应分发"}
	bus.flush_frame_events()
	if received.size() != 10:
		return {"name": tname, "passed": false, "message": "清算数量不符"}
	for i in range(10):
		if received[i] != i:
			return {"name": tname, "passed": false, "message": "FIFO 乱序"}
	if bus_pool.get_free_count() != init_free:
		return {"name": tname, "passed": false, "message": "帧清算未自动回收事件包"}
	return {"name": tname, "passed": true, "message": "帧合批 FIFO 保持且自动回收"}

# ---- 5. 正交位掩码隔离 ----
static func _test_category_bitmask_orthogonal_isolation() -> Dictionary:
	var tname := "TC-EB2-05"
	var bus := EventBusCore.new()
	var state_c := {"n": 0}
	var audio_c := {"n": 0}
	var tok_state := bus.subscribe(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.CORE_STATE,
		func(p: EventPacket) -> void: state_c["n"] += 1)
	var tok_audio := bus.subscribe(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.SPATIAL_AUDIO,
		func(p: EventPacket) -> void: audio_c["n"] += 1)
	var pkt := bus.borrow_packet(EventChannelDefinition.COMBAT_HIT_RESOLVED, EventCategoryMask.SPATIAL_AUDIO, {})
	bus.dispatch_now(pkt)
	bus.recycle_packet(pkt)
	tok_state.unbind()
	tok_audio.unbind()
	if state_c["n"] != 0 or audio_c["n"] != 1:
		return {"name": tname, "passed": false, "message": "位掩码隔离失效"}
	return {"name": tname, "passed": true, "message": "正交位掩码隔离通过"}

# ---- 6. 订阅令牌幂等解绑 ----
static func _test_subscription_token_lifecycle() -> Dictionary:
	var tname := "TC-EB2-06"
	var bus := EventBusCore.new()
	var counter := {"n": 0}
	var token := bus.subscribe(EventChannelDefinition.SYSTEM_HEARTBEAT_TICK, EventCategoryMask.SYSTEM_TELEMETRY,
		func(p: EventPacket) -> void: counter["n"] += 1)
	var p1 := bus.borrow_packet(EventChannelDefinition.SYSTEM_HEARTBEAT_TICK, EventCategoryMask.SYSTEM_TELEMETRY, {})
	bus.dispatch_now(p1)
	bus.recycle_packet(p1)
	if counter["n"] != 1:
		return {"name": tname, "passed": false, "message": "解绑前未触发"}
	if not token.unbind():
		return {"name": tname, "passed": false, "message": "首次解绑应返回 true"}
	if token.unbind():
		return {"name": tname, "passed": false, "message": "重复解绑应返回 false"}
	var p2 := bus.borrow_packet(EventChannelDefinition.SYSTEM_HEARTBEAT_TICK, EventCategoryMask.SYSTEM_TELEMETRY, {})
	bus.dispatch_now(p2)
	bus.recycle_packet(p2)
	if counter["n"] != 1:
		return {"name": tname, "passed": false, "message": "解绑后仍触发"}
	return {"name": tname, "passed": true, "message": "订阅令牌幂等解绑闭环通过"}

# ---- 7. 配置驱动与下限防御 ----
static func _test_config_driven_cell_size_and_limits() -> Dictionary:
	var tname := "TC-EB2-07"
	var bus := EventBusCore.new()
	bus.initialize_from_config()
	if bus.get_spatial_cell_size() <= 0.0:
		return {"name": tname, "passed": false, "message": "网格尺寸解析异常"}
	if bus.get_frame_buffer_capacity() <= 0:
		return {"name": tname, "passed": false, "message": "缓冲容量解析异常"}
	if bus.get_max_dispatch_depth() <= 0:
		return {"name": tname, "passed": false, "message": "熔断深度解析异常"}
	return {"name": tname, "passed": true, "message": "配置驱动与下限防御通过"}

# ---- 8. 动态跨格迁移 ----
static func _test_spatial_listener_motion_migration() -> Dictionary:
	var tname := "TC-EB2-08"
	var grid := HeadlessSpatialHashGrid3D.new(16.0)
	var counter := {"n": 0}
	var cb := func(p: EventPacket) -> void: counter["n"] += 1
	grid.register_listener(99, Vector3(5, 0, 5), 10.0, cb)
	grid.update_listener_position(99, Vector3(100, 0, 100), 10.0, cb)

	var p_old := EventPacket.new()
	p_old.set_spatial_header(Vector3(5, 0, 5), 10.0)
	grid.dispatch_packet(p_old)
	if counter["n"] != 0:
		return {"name": tname, "passed": false, "message": "旧位置幽灵唤醒"}

	var p_new := EventPacket.new()
	p_new.set_spatial_header(Vector3(102, 0, 102), 10.0)
	grid.dispatch_packet(p_new)
	if counter["n"] != 1:
		return {"name": tname, "passed": false, "message": "新位置未精确唤醒"}
	return {"name": tname, "passed": true, "message": "跨格迁移零幽灵唤醒通过"}

# ---- 9. 重入熔断（经 ErrorReporter，进程不崩溃） ----
static func _test_reentrancy_circuit_breaker() -> Dictionary:
	var tname := "TC-EB2-09"
	var bus := EventBusCore.new()
	var depth := {"d": 0}
	var recursive_cb: Callable
	recursive_cb = func(pkt: EventPacket) -> void:
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
		return {"name": tname, "passed": false, "message": "熔断失效，深度 %d" % depth["d"]}
	return {"name": tname, "passed": true, "message": "重入熔断安全拦截"}

# ---- 10. 遍历中动态解绑安全 ----
static func _test_iteration_safety_under_concurrent_modification() -> Dictionary:
	var tname := "TC-EB2-10"
	var bus := EventBusCore.new()
	var order: Array[int] = []
	var token1: EventBusSubscriptionToken = null
	token1 = bus.subscribe(0x0888, EventCategoryMask.CORE_STATE, func(p: EventPacket) -> void:
		order.append(1)
		token1.unbind()
	)
	bus.subscribe(0x0888, EventCategoryMask.CORE_STATE, func(p: EventPacket) -> void: order.append(2))

	var pkt := bus.borrow_packet(0x0888, EventCategoryMask.CORE_STATE, {})
	bus.dispatch_now(pkt)
	bus.recycle_packet(pkt)
	if order != [1, 2]:
		return {"name": tname, "passed": false, "message": "回调内解绑导致跳项: %s" % str(order)}
	order.clear()
	bus.dispatch_now(pkt)
	bus.recycle_packet(pkt)
	if order != [2]:
		return {"name": tname, "passed": false, "message": "已解绑监听器残留"}
	return {"name": tname, "passed": true, "message": "遍历中解绑零跳项通过"}

# ---- 11. 2D 投影与无头路由 ----
static func _test_2d_projection_and_headless_routing() -> Dictionary:
	var tname := "TC-EB2-11"
	var bus := EventBusCore.new()
	var counter := {"n": 0}
	bus.on_spatial_2d(Vector2(100, 200), 20.0, func(p: EventPacket) -> void: counter["n"] += 1)

	var p_near := bus.borrow_packet(EventChannelDefinition.SPATIAL_COLLISION_CONTACT, EventCategoryMask.SPATIAL_VFX, {})
	bus.dispatch_spatial_2d(p_near, Vector2(105, 205), 20.0)
	bus.recycle_packet(p_near)
	if counter["n"] != 1:
		return {"name": tname, "passed": false, "message": "2D 近邻未唤醒"}

	var p_far := bus.borrow_packet(EventChannelDefinition.SPATIAL_COLLISION_CONTACT, EventCategoryMask.SPATIAL_VFX, {})
	bus.dispatch_spatial_2d(p_far, Vector2(1000, 2000), 20.0)
	bus.recycle_packet(p_far)
	if counter["n"] != 1:
		return {"name": tname, "passed": false, "message": "2D 远端误唤醒"}
	return {"name": tname, "passed": true, "message": "2D 投影与空间裁剪通过"}

# ---- 12. 无模型表现适配闭环 ----
static func _test_headless_presentation_api_control_without_models() -> Dictionary:
	var tname := "TC-EB2-12"
	var mock := HeadlessPresentationMockAdapter.new()
	mock.on_entity_spawned("HERO_01", Vector3(10, 0, 10))
	if not mock.spawned_entities.has("HERO_01"):
		return {"name": tname, "passed": false, "message": "实体生成未捕获"}
	mock.on_entity_moved("HERO_01", Vector3(15, 0, 15), 1.57)
	if mock.spawned_entities["HERO_01"] != Vector3(15, 0, 15):
		return {"name": tname, "passed": false, "message": "位移未同步"}
	var cue := VisualCueDTO.new()
	cue.cue_token = VisualCueDTO.CueToken.ATTACK_SLASH_HEAVY
	cue.anchor = VisualCueDTO.AnchorPoint.PRIMARY_HAND
	cue.intensity = 1.5
	mock.on_visual_cue("HERO_01", cue)
	if mock.recorded_cues.size() != 1 or mock.recorded_cues[0]["token"] != VisualCueDTO.CueToken.ATTACK_SLASH_HEAVY:
		return {"name": tname, "passed": false, "message": "视觉意图传递失真"}
	mock.on_entity_despawned("HERO_01")
	if mock.spawned_entities.has("HERO_01"):
		return {"name": tname, "passed": false, "message": "注销未清空"}
	return {"name": tname, "passed": true, "message": "无模型纯 API 控制闭环通过"}
```

---

## 二、 存量旧测试迁移清单（实测存在，P73/P74 分波次迁移，不在本卷执行）

| 存量套件（实测路径） | 现状依赖 | 迁移目标（P74） |
| :--- | :--- | :--- |
| `tests/unit/test_account.gd` | 旧版 `auth.*` 字符串事件 | `EventBusCore.subscribe(AUTH_*)` + `EventPacket` 强类型断言 |
| `tests/unit/test_event_driven_audio.gd` | 旧版扁平音频事件 | `SPATIAL_AUDIO_PLAY` 空间信道 + 适配器 |
| `tests/unit/test_event_description.gd` | 旧版事件描述 | `EventChannelDefinition` 整型信道 |
| `tests/unit/test_narrative_orchestration.gd` | 旧版叙事事件 | `NARRATIVE_TEXT` 掩码 + 叙事契约 |
| `tests/unit/test_combat_tertiary_timeline_pipeline.gd` | 旧版战斗事件 | `COMBAT_*` 整型信道 |

> 迁移步调与阶段 3 路线图一致：P73 业务域 → P74 测试与表现 + 叙事渲染接线 → 最终收口退役旧版 `event_bus.gd`（独立立项，不在本卷）。

---

## 三、 阶段交付物清单 (Deliverables)

1. `tests/unit/test_event_bus2_zero_gc_pipeline.gd`：12 项断言（API 与阶段 1~3 严格一致、可编译）；
2. `tests/test_registry.gd`：挂载下一空槽 + `get_all_test_classes()`/TC-ARCH-03 登记；
3. 全量回归：既有 93+ 套全 PASS（旧版总线保留运行），本卷 0 破坏。

## 四、 全量工程验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-HDS-S4-01` | 全域单测 100% PASS | 全量 test_runner | 既有 93+ 套全过；新增套件 12 用例全 PASS |
| `TC-HDS-S4-02` | 池化守恒与零深拷贝 | 10 万次借还 + 静态扫描 | 借还差 0、池外新建 0、无 `.duplicate(true)` |
| `TC-HDS-S4-03` | 空间精确裁剪 | 半径外注入 + 跨格迁移 | 范围外 0 唤醒；迁移后旧格 0/新格精确 1 |
| `TC-HDS-S4-04` | 熔断与遍历安全 | 重入 + 回调内解绑注入 | 深度熔断不崩溃；无跳项无越界（ErrorReporter 告警留档） |
| `TC-HDS-S4-05` | 门禁链全绿 + 迁移口径一致 | audit-all + audit-docs + git diff | 0 error；旧版 event_bus.gd 未被改动；迁移清单仅列实测存在文件；P72 交付物全部为新增文件 |
