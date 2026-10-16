# ==============================================================================
# 模块归属: 集成测试流水线 (Tests · 自动化测试底座)
# 文件路径: res://tests/integration/pipelines/test_world_archive_and_anti_bridge_pipeline.gd
# 架构定位: Integration Test Pipeline / Security & World Archive Harness
# 跨域依赖: 上游: world_gateway, world_state | 下游: EventBus | 配置: config/domains/world_gateway/core.json
# 职责说明: 验证单机世界档案独立落盘与自愈、角色死亡世界连续性、模式探针诊断、防越权守卫与全量内存洗脱
# 设计依据: 业务域第一性原理与气密级防越权安全验收契约
# ==============================================================================

class_name TestWorldArchiveAndAntiBridgePipeline
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_world_archive_multi_instance_and_recovery())
	results.append(test_character_demise_and_chronicle_monotonicity())
	results.append(test_mode_readiness_probe_diagnostics())
	results.append(test_anti_bridge_hot_swap_blocking())
	results.append(test_anti_bridge_slot_poisoning_blocking())
	results.append(test_anti_bridge_network_mute_violation())
	results.append(test_gateway_memory_scrubbing_and_session_reset())

	var all_passed := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_passed = false

	return {
		"domain": "World Archive & Anti-Bridge Security Pipeline",
		"all_passed": all_passed,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"results": results
	}

## TC-WAB-01: 单机世界多档案独立创建、时空推进与原子落盘自愈
static func test_world_archive_multi_instance_and_recovery() -> Dictionary:
	var repo := WorldArchiveRepository.get_instance()
	var sandbox_dir := "user://test_sandbox_wab_01/"
	repo.set_custom_root_dir(sandbox_dir)
	repo.set_custom_catalog_path(sandbox_dir + "world_catalog.json")
	repo.load_all()

	# 1. 独立创建两份单机世界档案
	var res_w1: Dictionary = repo.create_world("WORLD_SP_ALPHA", "卡拉尔·黎明界", 1001)
	var res_w2: Dictionary = repo.create_world("WORLD_SP_BETA", "卡拉尔·暮色界", 2002)
	var create_ok: bool = bool(res_w1.get("success", false)) and bool(res_w2.get("success", false)) \
		and repo.has_world("WORLD_SP_ALPHA") and repo.has_world("WORLD_SP_BETA")

	# 2. 独立时空推进断言（ALPHA 前进 25 tick，BETA 保持 0 tick）
	var inst1: WorldInstance = repo.load_world("WORLD_SP_ALPHA")
	var inst2: WorldInstance = repo.load_world("WORLD_SP_BETA")
	var load_ok: bool = inst1 != null and inst2 != null

	if inst1 != null:
		inst1.advance_world_time(25)
		repo.save_world(inst1)

	var reloaded_w1: WorldInstance = repo.load_world("WORLD_SP_ALPHA")
	var reloaded_w2: WorldInstance = repo.load_world("WORLD_SP_BETA")
	var advance_ok: bool = reloaded_w1 != null and reloaded_w2 != null \
		and int(reloaded_w1.world_time.get("tick", 0)) == 25 \
		and int(reloaded_w2.world_time.get("tick", 0)) == 0

	# 3. 原子落盘自愈断言（删除主档，利用 .bak 备份文件原子自愈水化）
	var state_file := repo.get_world_dir("WORLD_SP_ALPHA") + "world_state.json"
	var bak_file := state_file + ".bak"
	var bak_exists: bool = FileAccess.file_exists(bak_file)
	if FileAccess.file_exists(state_file):
		DirAccess.remove_absolute(state_file)

	var healed_inst: WorldInstance = repo.load_world("WORLD_SP_ALPHA")
	var heal_ok: bool = bak_exists and healed_inst != null and int(healed_inst.world_time.get("tick", 0)) == 25

	# 清理沙箱测试数据
	repo.delete_world("WORLD_SP_ALPHA")
	repo.delete_world("WORLD_SP_BETA")
	WorldArchiveRepository.reset_for_tests()

	var passed: bool = create_ok and load_ok and advance_ok and heal_ok
	return {
		"test": "TC-WAB-01: 单机世界多档案独立创建、时空推进与原子落盘自愈",
		"passed": passed
	}

## TC-WAB-02: 角色死亡后世界状态连续性与历史片段只增断言
static func test_character_demise_and_chronicle_monotonicity() -> Dictionary:
	var repo := WorldArchiveRepository.get_instance()
	var sandbox_dir := "user://test_sandbox_wab_02/"
	repo.set_custom_root_dir(sandbox_dir)
	repo.set_custom_catalog_path(sandbox_dir + "world_catalog.json")
	repo.load_all()

	repo.create_world("WORLD_CONTINUITY_01", "因果连续界", 3003)
	var inst: WorldInstance = repo.load_world("WORLD_CONTINUITY_01")
	var init_ok: bool = inst != null

	# 1. 推进初始世界时间并记录角色冒险历史
	if inst != null:
		inst.advance_world_time(40)
		inst.append_history_fragment({"event": "hero_entered", "character_id": "CHAR_VALIANT", "day": inst.world_time.get("day", 1)})
		repo.save_world(inst)

	var tick_before_death: int = int(inst.world_time.get("tick", 0)) if inst != null else 0

	# 2. 模拟角色死亡：世界时钟单调推进，追加消亡历史片段
	if inst != null:
		inst.advance_world_time(10)
		inst.append_history_fragment({"event": "hero_demise", "character_id": "CHAR_VALIANT", "tick": inst.world_time.get("tick", 0)})
		repo.save_world(inst)

	# 3. 重新加载世界档案：验证时间连续单调递增，历史编年史只增不改
	var reloaded: WorldInstance = repo.load_world("WORLD_CONTINUITY_01")
	var continuity_ok: bool = reloaded != null \
		and int(reloaded.world_time.get("tick", 0)) == tick_before_death + 10 \
		and reloaded.history_fragments.size() == 2 \
		and str(reloaded.history_fragments[0].get("event", "")) == "hero_entered" \
		and str(reloaded.history_fragments[1].get("event", "")) == "hero_demise"

	# 清理沙箱
	repo.delete_world("WORLD_CONTINUITY_01")
	WorldArchiveRepository.reset_for_tests()

	var passed: bool = init_ok and continuity_ok
	return {
		"test": "TC-WAB-02: 角色死亡后世界状态连续性与历史片段只增断言",
		"passed": passed
	}

## TC-WAB-03: 模式探针诊断能力与单机磁盘/联机灰度健康报告断言
static func test_mode_readiness_probe_diagnostics() -> Dictionary:
	# 1. 单机本地存储环境就绪诊断
	var sp_report: ModeReadinessReportDTO = ModeReadinessProbe.probe_single_player_environment()
	var sp_ok: bool = sp_report != null \
		and sp_report.mode == WorldGatewayModel.GameMode.SINGLE_PLAYER \
		and sp_report.is_ready \
		and sp_report.status_code == "READY" \
		and sp_report.capabilities.has("local_storage")

	# 2. 联机模式白名单放行诊断（MP_TESTER_01 在 core.json 白名单内）
	var mp_whitelisted: ModeReadinessReportDTO = ModeReadinessProbe.probe_multiplayer_environment("MP_TESTER_01")
	var mp_wl_ok: bool = mp_whitelisted != null \
		and mp_whitelisted.mode == WorldGatewayModel.GameMode.MULTIPLAYER \
		and mp_whitelisted.is_ready \
		and mp_whitelisted.status_code == "READY" \
		and mp_whitelisted.latency_ms > 0

	# 3. 联机模式非白名单拦截诊断
	var mp_regular: ModeReadinessReportDTO = ModeReadinessProbe.probe_multiplayer_environment("REGULAR_USER_99")
	var mp_reg_ok: bool = mp_regular != null \
		and mp_regular.mode == WorldGatewayModel.GameMode.MULTIPLAYER \
		and not mp_regular.is_ready \
		and mp_regular.status_code == "FEATURE_DISABLED"

	# 4. 全域并行探测
	var all_reports: Dictionary = ModeReadinessProbe.probe_all_modes("MP_TESTER_01")
	var all_ok: bool = all_reports.has("single_player") and all_reports.has("multiplayer")

	# 5. 联机只读扩展桩检查
	var realms := RemoteRealmDirectoryProvider.list_realms("MP_TESTER_01")
	var realms_ok: bool = not realms.is_empty() and realms[0].has("realm_id") and realms[0].has("ping_ms")

	var passed: bool = sp_ok and mp_wl_ok and mp_reg_ok and all_ok and realms_ok
	return {
		"test": "TC-WAB-03: 模式探针诊断能力与单机磁盘/联机灰度健康报告断言",
		"passed": passed
	}

## TC-WAB-04: 防越权守卫拦截跨模式热切换 (Anti-Hot-Swap)
static func test_anti_bridge_hot_swap_blocking() -> Dictionary:
	var fsm := WorldGatewayFSM.new("ACC_HOTSWAP_01")
	fsm.enter_gateway()

	# 1. 正常选择单机模式
	var sel_sp: Dictionary = fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
	var sp_ok: bool = bool(sel_sp.get("success", false)) and fsm.context.selected_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER

	# 2. 未退网关洗脱，直接热切换至联机模式：必须被防越权守卫拦截
	var hot_swap_res: Dictionary = fsm.select_mode(WorldGatewayModel.GameMode.MULTIPLAYER, {}, [])
	var hot_swap_blocked: bool = not bool(hot_swap_res.get("success", false)) \
		and str(hot_swap_res.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_CROSS_MODE_HOT_SWAP

	# 3. 直接调用 AntiBridgeGuard 静态防护接口
	var direct_guard := AntiBridgeGuard.validate_mode_transition(
		WorldGatewayModel.GatewayPhase.MODE_SELECTED,
		WorldGatewayModel.GatewayPhase.MODE_SELECTED,
		WorldGatewayModel.GameMode.SINGLE_PLAYER,
		WorldGatewayModel.GameMode.MULTIPLAYER
	)
	var direct_blocked: bool = not bool(direct_guard.get("allowed", true)) \
		and str(direct_guard.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_CROSS_MODE_HOT_SWAP

	var passed: bool = sp_ok and hot_swap_blocked and direct_blocked
	return {
		"test": "TC-WAB-04: 防越权守卫拦截跨模式热切换 (Anti-Hot-Swap)",
		"passed": passed
	}

## TC-WAB-05: 防越权守卫拦截单机槽位跨界渗透联机 (Anti-Slot-Poisoning)
static func test_anti_bridge_slot_poisoning_blocking() -> Dictionary:
	# 1. 直接校验亲和性阻断
	var aff_res := AntiBridgeGuard.validate_slot_mode_affinity(
		WorldGatewayModel.GameMode.SINGLE_PLAYER,
		WorldGatewayModel.GameMode.MULTIPLAYER
	)
	var aff_blocked: bool = not bool(aff_res.get("allowed", true)) \
		and str(aff_res.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_SLOT_MODE_POISONING

	# 2. 路由解算器拦截单机槽位渗透联机
	var sp_slot := SaveSlotStateDTO.new()
	sp_slot.slot_id = "SLOT_SP_01"
	sp_slot.bound_world_id = "WORLD_DEFAULT_SP_01"
	var route_res := GameModeRoutingSolver.resolve_mode_entry(
		"MP_TESTER_01",
		WorldGatewayModel.GameMode.MULTIPLAYER,
		{},
		[sp_slot],
		{},
		"",
		"SLOT_SP_01"
	)
	var solver_blocked: bool = not route_res.success \
		and route_res.error_code == AntiBridgeGuard.SECURITY_ERR_SLOT_MODE_POISONING

	var passed: bool = aff_blocked and solver_blocked
	return {
		"test": "TC-WAB-05: 防越权守卫拦截单机槽位跨界渗透联机 (Anti-Slot-Poisoning)",
		"passed": passed
	}

## TC-WAB-06: 防越权守卫拦截单机模式下的联机信道广播 (Network Mute)
static func test_anti_bridge_network_mute_violation() -> Dictionary:
	# 1. 单机模式下尝试广播远程信道被拦截
	var res1 := AntiBridgeGuard.validate_network_channel_discipline(WorldGatewayModel.GameMode.SINGLE_PLAYER, "network.packet_in")
	var res2 := AntiBridgeGuard.validate_network_channel_discipline(WorldGatewayModel.GameMode.SINGLE_PLAYER, "mp.player_sync")
	var res3 := AntiBridgeGuard.validate_network_channel_discipline(WorldGatewayModel.GameMode.SINGLE_PLAYER, "realm.broadcast")

	var r1_blocked: bool = not bool(res1.get("allowed", true)) and str(res1.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_NETWORK_MUTE_VIOLATION
	var r2_blocked: bool = not bool(res2.get("allowed", true)) and str(res2.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_NETWORK_MUTE_VIOLATION
	var r3_blocked: bool = not bool(res3.get("allowed", true)) and str(res3.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_NETWORK_MUTE_VIOLATION

	# 2. 单机合法领域信道放行
	var ok1 := AntiBridgeGuard.validate_network_channel_discipline(WorldGatewayModel.GameMode.SINGLE_PLAYER, "world.time_advanced")
	var ok2 := AntiBridgeGuard.validate_network_channel_discipline(WorldGatewayModel.GameMode.SINGLE_PLAYER, "world_gateway.entered")
	var legal_ok: bool = bool(ok1.get("allowed", false)) and bool(ok2.get("allowed", false))

	var passed: bool = r1_blocked and r2_blocked and r3_blocked and legal_ok
	return {
		"test": "TC-WAB-06: 防越权守卫拦截单机模式下的联机信道广播 (Network Mute)",
		"passed": passed
	}

## TC-WAB-07: 网关 exit_to_gateway 内存全量洗脱与会话重置隔离
static func test_gateway_memory_scrubbing_and_session_reset() -> Dictionary:
	var fsm := WorldGatewayFSM.new("ACC_SCRUB_01")
	fsm.enter_gateway()
	fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
	fsm.attach_ready_character("CHAR_SCRUB_HERO")

	var pre_scrub_ok: bool = fsm.context.selected_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER \
		and not fsm.context.active_character_id.is_empty() \
		and not fsm.context.selected_world_id.is_empty()

	# 触发内存全量洗脱
	var scrub_res: Dictionary = fsm.exit_to_gateway()
	var scrub_ok: bool = bool(scrub_res.get("success", false)) \
		and fsm.context.current_phase == WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED \
		and fsm.context.selected_mode == WorldGatewayModel.GameMode.UNSELECTED \
		and fsm.context.selected_slot_id.is_empty() \
		and fsm.context.selected_world_id.is_empty() \
		and fsm.context.active_character_id.is_empty()

	# 洗脱重置后，模式已回归 UNSELECTED，此时重新选择其他模式不再受热切换阻断
	var flags := GameModeRoutingSolver.load_default_canary_flags()
	var reselect_res: Dictionary = fsm.select_mode(WorldGatewayModel.GameMode.MULTIPLAYER, flags, [])
	var reselect_allowed_or_routed: bool = str(reselect_res.get("error_code", "")) != AntiBridgeGuard.SECURITY_ERR_CROSS_MODE_HOT_SWAP

	var passed: bool = pre_scrub_ok and scrub_ok and reselect_allowed_or_routed
	return {
		"test": "TC-WAB-07: 网关 exit_to_gateway 内存全量洗脱与会话重置隔离",
		"passed": passed
	}
