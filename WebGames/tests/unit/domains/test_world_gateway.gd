# ==============================================================================
# 单元测试：世界栏网关、单联机模式隔离与五层状态流转测试套件
# 文件路径: res://tests/unit/domains/test_world_gateway.gd
# 职责: 验证 Phase 47 世界栏统一网关、单联机模式隔离、档位路由与灰度联动
# ==============================================================================
class_name TestWorldGatewayAndModeIsolation
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_gateway_unified_entrance())
	results.append(test_mode_state_isolation_guard())
	results.append(test_single_player_single_slot_world_routing())
	results.append(test_five_tier_state_orthogonality())
	results.append(test_canary_rollout_integration())
	results.append(test_fsm_invalid_transition_blocking())
	results.append(test_review_fix_closure())

	var all_passed := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_passed = false

	return {
		"domain": "World Gateway & Mode Isolation (Phase 47)",
		"all_passed": all_passed,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"results": results
	}

## 1. 登录后直达 World Gateway 统一入口，禁止直入世界
static func test_gateway_unified_entrance() -> Dictionary:
	var fsm := WorldGatewayFSM.new("ACC_TEST_001")
	# 初始状态未进入网关，尝试直接进入世界必须被拦截
	var bypass_res := fsm.enter_world()
	var bypass_blocked: bool = (not bypass_res.get("success", false)) and (bypass_res.get("error_code", "") == "DIRECT_WORLD_BYPASS_BLOCKED")

	# 正确调用 enter_gateway 后跃迁至 GATEWAY_ENTERED
	var enter_res := fsm.enter_gateway()
	var enter_ok: bool = enter_res.get("success", false) and (fsm.context.current_phase == WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED)

	var passed = bypass_blocked and enter_ok
	return {
		"test": "TC-GW-01: 登录后直达 World Gateway 统一入口，禁止直入具体世界",
		"passed": passed
	}

## 2. 单机与联机状态严格正交隔离，拦截跨模式脏写
static func test_mode_state_isolation_guard() -> Dictionary:
	var ctx := WorldGatewayContextDTO.new()
	ctx.account_id = "ACC_TEST_002"
	ctx.selected_mode = WorldGatewayModel.GameMode.SINGLE_PLAYER
	ctx.selected_world_id = "WORLD_DEFAULT_SP_01"
	ctx.selected_slot_id = "SLOT_SP_01"

	# 1. 跨模式写入拦截：单机会话尝试向联机模式写
	var cross_mode_res := StateMutationIsolationGuard.validate_mutation_permission(
		ctx, WorldGatewayModel.GameMode.MULTIPLAYER, "WORLD_DEFAULT_SP_01", "SLOT_SP_01"
	)
	var cross_blocked: bool = (not cross_mode_res.get("allowed", true)) and (cross_mode_res.get("error_code", "") == "GUARD_ERR_CROSS_MODE_MUTATION")

	# 2. 世界不匹配拦截
	var world_mismatch_res := StateMutationIsolationGuard.validate_mutation_permission(
		ctx, WorldGatewayModel.GameMode.SINGLE_PLAYER, "WORLD_OTHER_SP_99", "SLOT_SP_01"
	)
	var world_blocked: bool = (not world_mismatch_res.get("allowed", true)) and (world_mismatch_res.get("error_code", "") == "GUARD_ERR_WORLD_MISMATCH")

	# 3. 档位不匹配拦截
	var slot_mismatch_res := StateMutationIsolationGuard.validate_mutation_permission(
		ctx, WorldGatewayModel.GameMode.SINGLE_PLAYER, "WORLD_DEFAULT_SP_01", "SLOT_OTHER_99"
	)
	var slot_blocked: bool = (not slot_mismatch_res.get("allowed", true)) and (slot_mismatch_res.get("error_code", "") == "GUARD_ERR_SLOT_MISMATCH")

	# 4. 合法一致写入放行
	var valid_res := StateMutationIsolationGuard.validate_mutation_permission(
		ctx, WorldGatewayModel.GameMode.SINGLE_PLAYER, "WORLD_DEFAULT_SP_01", "SLOT_SP_01"
	)
	var valid_ok: bool = valid_res.get("allowed", false) and (valid_res.get("error_code", "") == "")

	var passed = cross_blocked and world_blocked and slot_blocked and valid_ok
	return {
		"test": "TC-GW-02: 单机与联机状态严格正交隔离，拦截跨模式跨世界跨档位写入",
		"passed": passed
	}

## 3. 单机单档单世界标准路由与未来多档多世界模型兼容
static func test_single_player_single_slot_world_routing() -> Dictionary:
	var raw_catalog: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})
	var worlds: Dictionary = {}
	for wid in raw_catalog.keys():
		worlds[wid] = WorldInstanceDTO.from_dto(raw_catalog[wid], wid)

	# 1. 账号初次开档（无档位）：自动派生首档，标识 is_first_creation == true
	var empty_slots: Array = []
	var res1 := GameModeRoutingSolver.resolve_mode_entry(
		"ACC_NEWBIE_01", WorldGatewayModel.GameMode.SINGLE_PLAYER, worlds, empty_slots, {}
	)
	var auto_slot_ok: bool = res1.success and (res1.available_slots.size() == 1)
	var primary_slot: SaveSlotStateDTO = res1.available_slots[0]
	var slot_init_ok: bool = (primary_slot.slot_id == "SLOT_SP_01") and primary_slot.is_first_creation and res1.requires_character_creation
	var world_ok: bool = (res1.resolved_world != null) and (res1.resolved_world.world_id == "WORLD_DEFAULT_SP_01")

	# 2. 账号已有档位且已建角色
	var existing_slot := SaveSlotStateDTO.new()
	existing_slot.slot_id = "SLOT_SP_01"
	existing_slot.bound_world_id = "WORLD_DEFAULT_SP_01"
	existing_slot.bound_character_id = "CHAR_HERO_007"
	existing_slot.is_occupied = true
	existing_slot.is_first_creation = false

	var res2 := GameModeRoutingSolver.resolve_mode_entry(
		"ACC_VETERAN_01", WorldGatewayModel.GameMode.SINGLE_PLAYER, worlds, [existing_slot], {}
	)
	var veteran_ok: bool = res2.success and (not res2.requires_character_creation) and (res2.available_slots.size() == 1)

	var passed = auto_slot_ok and slot_init_ok and world_ok and veteran_ok
	return {
		"test": "TC-GW-03: 单机单档单世界标准路由与首档自动初始化判定",
		"passed": passed
	}

## 4. 五层状态正交性不变量断言（身份/档位/世界/角色/联机）
static func test_five_tier_state_orthogonality() -> Dictionary:
	var acc_id := "ACC_ORTHO_001"
	var slot_id := "SLOT_SP_01"
	var world_id := "WORLD_DEFAULT_SP_01"
	var char_id := "CHAR_TEST_888"

	var slot_dto := SaveSlotStateDTO.new()
	slot_dto.account_id = acc_id
	slot_dto.slot_id = slot_id
	slot_dto.bound_world_id = world_id
	slot_dto.bound_character_id = char_id

	var world_dto := WorldInstanceDTO.new()
	world_dto.world_id = world_id
	world_dto.mode = WorldGatewayModel.GameMode.SINGLE_PLAYER

	var ctx_dto := WorldGatewayContextDTO.new()
	ctx_dto.account_id = acc_id
	ctx_dto.selected_mode = WorldGatewayModel.GameMode.SINGLE_PLAYER
	ctx_dto.selected_world_id = world_id
	ctx_dto.selected_slot_id = slot_id
	ctx_dto.active_character_id = char_id

	# 断言各层实体字段正交解耦，序列化与反序列化无缝映射
	var slot_dict := slot_dto.to_dto()
	var slot_restored := SaveSlotStateDTO.from_dto(slot_dict)
	var slot_eq: bool = (slot_restored.slot_id == slot_id) and (slot_restored.bound_world_id == world_id) and (slot_restored.bound_character_id == char_id)

	var world_dict := world_dto.to_dto()
	var world_restored := WorldInstanceDTO.from_dto(world_dict)
	var world_eq: bool = (world_restored.world_id == world_id) and (world_restored.mode == WorldGatewayModel.GameMode.SINGLE_PLAYER)

	var ctx_dict := ctx_dto.to_dto()
	var ctx_eq: bool = (ctx_dict.get("account_id", "") == acc_id) and (ctx_dict.get("active_character_id", "") == char_id)

	var passed = slot_eq and world_eq and ctx_eq
	return {
		"test": "TC-GW-04: 五层状态正交性不变量与序列化往返自洽性",
		"passed": passed
	}

## 5. 灰度控制系统（Canary）分流与白名单开启/关闭阻断
static func test_canary_rollout_integration() -> Dictionary:
	var raw_catalog: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})
	var worlds: Dictionary = {}
	for wid in raw_catalog.keys():
		worlds[wid] = WorldInstanceDTO.from_dto(raw_catalog[wid])

	# 构造联机模式灰度旗标（仅限白名单 MP_TESTER_01）
	var mp_flag = FeatureToggleAggregate.FeatureFlagEntry.new(
		"FEATURE_MULTIPLAYER_GATEWAY",
		FeatureToggleAggregate.RolloutStrategy.WHITELIST_ONLY,
		0,
		["MP_TESTER_01"]
	)
	var canary_flags := { "FEATURE_MULTIPLAYER_GATEWAY": mp_flag }

	# 1. 非白名单账号选择联机模式：断言拦截
	var res_rejected := GameModeRoutingSolver.resolve_mode_entry(
		"REGULAR_USER_99", WorldGatewayModel.GameMode.MULTIPLAYER, worlds, [], canary_flags
	)
	var reject_ok: bool = (not res_rejected.success) and (res_rejected.error_code == "GATEWAY_ERR_MULTIPLAYER_DISABLED")

	# 2. 白名单账号选择联机模式：断言准许
	# 为联机创建临时联机世界实体
	var mp_world := WorldInstanceDTO.new()
	mp_world.world_id = "WORLD_CANARY_MP_01"
	mp_world.mode = WorldGatewayModel.GameMode.MULTIPLAYER
	worlds["WORLD_CANARY_MP_01"] = mp_world

	# 由于当前路由默认先走单机或可配置联机，若传入模式且在白名单内，守卫放行
	var res_whitelisted := CanaryRolloutSolver.is_feature_enabled_for_account(mp_flag, "MP_TESTER_01")

	var passed = reject_ok and res_whitelisted
	return {
		"test": "TC-GW-05: 灰度控制系统（Canary）分流与白名单阻断断言",
		"passed": passed
	}

## 6. 状态机非法跳转阻断与全流程流转闭环
static func test_fsm_invalid_transition_blocking() -> Dictionary:
	var fsm := WorldGatewayFSM.new("ACC_FULL_FLOW_01")

	# 1. 未选模式下直接 attach 角色，断言被阻断
	var invalid_attach := fsm.attach_ready_character("CHAR_EARLY_BIRD")
	var invalid_attach_ok: bool = not invalid_attach.get("success", false)

	# 2. 正常流转：进入网关
	var s1 := fsm.enter_gateway()
	var s1_ok: bool = s1.get("success", false) and (fsm.context.current_phase == WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED)

	# 3. 正常流转：选择单机模式
	var s2 := fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
	var s2_ok: bool = s2.get("success", false) and (fsm.context.current_phase == WorldGatewayModel.GatewayPhase.CHARACTER_PENDING)

	# 4. 挂载已创建完成的角色
	var s3 := fsm.attach_ready_character("CHAR_VALIANT_KNIGHT")
	var s3_ok: bool = s3.get("success", false) and (fsm.context.current_phase == WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED)

	# 5. 正式进入世界
	var s4 := fsm.enter_world()
	var s4_ok: bool = s4.get("success", false) and (fsm.context.current_phase == WorldGatewayModel.GatewayPhase.IN_WORLD)

	var passed = invalid_attach_ok and s1_ok and s2_ok and s3_ok and s4_ok
	return {
		"test": "TC-GW-06: 状态机非法跳转阻断与网关全生命周期闭环流转",
		"passed": passed
	}

## 7. 代码质量审查修复闭环（B1 官方事件入口 / S1 联机放行显式边界 / S2 context from_dto / S3 灰度默认装配）
static func test_review_fix_closure() -> Dictionary:
	# S3: 默认灰度装配（world_gateway.json canary_features 段被消费；未注入时不再空旗标）
	var default_flags := GameModeRoutingSolver.load_default_canary_flags()
	var s3_load_ok: bool = default_flags.has("FEATURE_MULTIPLAYER_GATEWAY") \
		and default_flags.has("FEATURE_MULTI_SLOT") \
		and default_flags.has("FEATURE_MULTI_WORLD")

	# S3 + S1: 未注入旗标时白名单账号走放行边界、非白名单被拦（配置驱动生效）
	var worlds: Dictionary = {}
	var raw_catalog: Dictionary = GameConfig.get_dict("domains.world_gateway", "worlds_catalog", {})
	for wid in raw_catalog.keys():
		worlds[wid] = WorldInstanceDTO.from_dto(raw_catalog[wid], wid)

	var res_regular := GameModeRoutingSolver.resolve_mode_entry(
		"REGULAR_USER_99", WorldGatewayModel.GameMode.MULTIPLAYER, worlds, [], {}
	)
	var s3_reject_ok: bool = (not res_regular.success) \
		and res_regular.error_code == "GATEWAY_ERR_MULTIPLAYER_DISABLED"

	var res_whitelisted := GameModeRoutingSolver.resolve_mode_entry(
		"MP_TESTER_01", WorldGatewayModel.GameMode.MULTIPLAYER, worlds, [], {}
	)
	var s1_pending_ok: bool = (not res_whitelisted.success) \
		and res_whitelisted.error_code == "GATEWAY_ERR_MULTIPLAYER_PENDING"

	# S2: 网关上下文 DTO 往返自洽
	var ctx := WorldGatewayContextDTO.new()
	ctx.account_id = "ACC_ROUND_TRIP_01"
	ctx.current_phase = WorldGatewayModel.GatewayPhase.CHARACTER_PENDING
	ctx.selected_mode = WorldGatewayModel.GameMode.SINGLE_PLAYER
	ctx.selected_slot_id = "SLOT_SP_01"
	ctx.selected_world_id = "WORLD_DEFAULT_SP_01"
	ctx.active_character_id = "CHAR_ROUND_01"
	ctx.is_first_time_creation = true
	var ctx_restored := WorldGatewayContextDTO.from_dto(ctx.to_dto())
	var s2_ok: bool = (ctx_restored.account_id == ctx.account_id) \
		and (ctx_restored.current_phase == ctx.current_phase) \
		and (ctx_restored.selected_slot_id == "SLOT_SP_01") \
		and (ctx_restored.active_character_id == "CHAR_ROUND_01") \
		and ctx_restored.is_first_time_creation

	# B1: FSM 事件经 EventBusCore.emit_domain_event 官方入口（DOMAIN_EVENT_GENERIC 信道仍可达）
	var fsm := WorldGatewayFSM.new("ACC_EVENT_ENTRY_01")
	var seen_channels: Array = []
	var bus = EventBusCore.get_instance()
	var cb := func(pkt: EventPacket) -> void:
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		seen_channels.append(str(w.get("channel", "")))
	var tok := bus.on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, cb)
	var enter_res := fsm.enter_gateway()
	tok.unbind()
	var b1_ok: bool = enter_res.get("success", false) and seen_channels.has("world_gateway.entered")

	var passed = s3_load_ok and s3_reject_ok and s1_pending_ok and s2_ok and b1_ok
	return {
		"test": "TC-GW-07: 审查修复闭环（灰度默认装配/联机放行显式边界/context 往返/官方事件入口）",
		"passed": passed
	}
