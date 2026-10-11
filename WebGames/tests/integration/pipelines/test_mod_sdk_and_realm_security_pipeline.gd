# ==============================================================================
# 模块归属: 集成测试流水线 (Tests · 自动化测试底座)
# 文件路径: res://tests/integration/pipelines/test_mod_sdk_and_realm_security_pipeline.gd
# 架构定位: Integration Test Pipeline / Mod SDK & Realm Security Harness
# 跨域依赖: 上游: TestRegistry | 下游: AntiBridgeGuard, WorldGatewayFSM, GameModeRoutingSolver | 配置: config/domains/world_gateway/core.json
# 职责说明: 自动化全链路测试 MOD 开发者 SDK 同步与联机域安全净化、跨模式防毒化与状态对称释放
# 设计依据: 业务领域第一性原理与气密级防越权安全验收契约
# ==============================================================================

class_name TestModSdkAndRealmSecurityPipeline
extends TestCase

## 统一测试套件主入口
static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_single_player_third_party_mods_allowed())
	results.append(test_multiplayer_third_party_mods_blocked())
	results.append(test_slot_mode_poisoning_blocked())
	results.append(test_multiplayer_purge_and_fallback_to_vanilla())
	results.append(test_multiplayer_official_vanilla_allowed())
	results.append(test_gateway_exit_symmetric_cleanup())

	return pack_results("MOD SDK & Realm Security Pipeline", results)

## TC-MSS-01: 单机模式下全量加载第三方 MOD 正常放行
static func test_single_player_third_party_mods_allowed() -> Dictionary:
	var mods: Array = [
		{"pack_id": "custom_expansion_story", "is_vanilla": false, "version": "1.0.0"},
		{"pack_id": "overpowered_relics", "is_vanilla": false, "version": "2.0.0"}
	]

	# 1. 直接通过安全守卫裁定单机放行
	var guard_res := AntiBridgeGuard.validate_mod_realm_discipline(
		WorldGatewayModel.GameMode.SINGLE_PLAYER,
		mods
	)
	var guard_allowed: bool = bool(guard_res.get("allowed", false)) \
		and str(guard_res.get("error_code", "")).is_empty()

	# 2. 网关状态机载入第三方 MOD 选定单机模式
	var fsm := WorldGatewayFSM.new("ACC_MSS_SP_01")
	fsm.enter_gateway()
	fsm.set_active_mods(mods)

	var select_res := fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
	var fsm_ok: bool = bool(select_res.get("success", false)) \
		and fsm.context.selected_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER \
		and fsm.get_active_mods().size() == 2

	# 对称重置
	fsm.exit_to_gateway()

	var passed: bool = guard_allowed and fsm_ok
	return make_result("TC-MSS-01: 单机模式下全量加载第三方 MOD 正常放行", passed, {
		"guard_allowed": guard_allowed,
		"fsm_ok": fsm_ok
	})

## TC-MSS-02: 联机模式加载第三方 MOD 坚决拦截 (SECURITY_ERR_MULTIPLAYER_MOD_POISONING)
static func test_multiplayer_third_party_mods_blocked() -> Dictionary:
	var poison_mods: Array = [
		{"pack_id": "hacked_stats_booster", "is_vanilla": false}
	]

	# 1. 守卫直接拦截判定
	var guard_res := AntiBridgeGuard.validate_mod_realm_discipline(
		WorldGatewayModel.GameMode.MULTIPLAYER,
		poison_mods
	)
	var guard_blocked: bool = not bool(guard_res.get("allowed", true)) \
		and str(guard_res.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING

	# 2. 网关状态机拦截选定联机模式
	var fsm := WorldGatewayFSM.new("ACC_MSS_MP_02")
	fsm.enter_gateway()
	fsm.set_active_mods(poison_mods)

	var select_res := fsm.select_mode(WorldGatewayModel.GameMode.MULTIPLAYER, {}, [])
	var select_blocked: bool = not bool(select_res.get("success", false)) \
		and str(select_res.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING \
		and fsm.context.selected_mode != WorldGatewayModel.GameMode.MULTIPLAYER

	# 3. 模拟强行进入世界拦截
	fsm.context.current_phase = WorldGatewayModel.GatewayPhase.WORLD_ENTRY_PERMITTED
	fsm.context.selected_mode = WorldGatewayModel.GameMode.MULTIPLAYER
	var enter_res := fsm.enter_world("WORLD_MP_TEST", false)
	var enter_blocked: bool = not bool(enter_res.get("success", false)) \
		and str(enter_res.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING \
		and fsm.context.current_phase != WorldGatewayModel.GatewayPhase.IN_WORLD

	fsm.exit_to_gateway()

	var passed: bool = guard_blocked and select_blocked and enter_blocked
	return make_result("TC-MSS-02: 联机模式加载第三方 MOD 坚决拦截", passed, {
		"guard_blocked": guard_blocked,
		"select_blocked": select_blocked,
		"enter_blocked": enter_blocked
	})

## TC-MSS-03: 带 MOD 单机槽位跨界渗透联机拦截 (SECURITY_ERR_SLOT_MODE_POISONING)
static func test_slot_mode_poisoning_blocked() -> Dictionary:
	# 1. 守卫直接亲和性拦截单机模式槽位渗透至联机
	var direct_res := AntiBridgeGuard.validate_slot_mode_affinity(
		WorldGatewayModel.GameMode.SINGLE_PLAYER,
		WorldGatewayModel.GameMode.MULTIPLAYER,
		[{"pack_id": "mod_sp_story"}]
	)
	var direct_blocked: bool = not bool(direct_res.get("allowed", true)) \
		and str(direct_res.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_SLOT_MODE_POISONING

	# 2. 路由解算器拦截带单机界域特征的槽位
	var sp_slot := SaveSlotStateDTO.new()
	sp_slot.slot_id = "SLOT_SP_MSS_01"
	sp_slot.bound_world_id = "WORLD_DEFAULT_SP_01"

	var route_res := GameModeRoutingSolver.resolve_mode_entry(
		"ACC_MSS_ROUTER_01",
		WorldGatewayModel.GameMode.MULTIPLAYER,
		{},
		[sp_slot],
		{},
		"",
		"SLOT_SP_MSS_01"
	)
	var solver_blocked: bool = not route_res.success \
		and route_res.error_code == AntiBridgeGuard.SECURITY_ERR_SLOT_MODE_POISONING

	var passed: bool = direct_blocked and solver_blocked
	return make_result("TC-MSS-03: 带 MOD 单机槽位跨界渗透联机拦截", passed, {
		"direct_blocked": direct_blocked,
		"solver_blocked": solver_blocked
	})

## TC-MSS-04: 联机模式切入时本地 MOD 强制净化卸载与内存洗脱
static func test_multiplayer_purge_and_fallback_to_vanilla() -> Dictionary:
	var fsm := WorldGatewayFSM.new("ACC_MSS_PURGE_01")
	fsm.enter_gateway()

	var mixed_mods: Array = [
		{"pack_id": "vanilla_base", "is_vanilla": true},
		{"pack_id": "third_party_addon", "is_vanilla": false},
		"official_core_content"
	]
	fsm.set_active_mods(mixed_mods)

	# 执行联机强制净化
	fsm.purge_and_fallback_to_vanilla()
	var retained := fsm.get_active_mods()

	var count_ok: bool = retained.size() == 2
	var has_vanilla_base: bool = false
	var has_official_core: bool = false
	var has_third_party: bool = false

	for m in retained:
		if m is Dictionary and str((m as Dictionary).get("pack_id", "")) == "vanilla_base":
			has_vanilla_base = true
		elif m is String and (m as String) == "official_core_content":
			has_official_core = true
		elif m is Dictionary and str((m as Dictionary).get("pack_id", "")) == "third_party_addon":
			has_third_party = true

	var purge_ok: bool = count_ok and has_vanilla_base and has_official_core and not has_third_party

	# 净化后符合联机安全纪律
	var check_after := AntiBridgeGuard.validate_mod_realm_discipline(
		WorldGatewayModel.GameMode.MULTIPLAYER,
		retained
	)
	var discipline_pass: bool = bool(check_after.get("allowed", false))

	fsm.exit_to_gateway()

	var passed: bool = purge_ok and discipline_pass
	return make_result("TC-MSS-04: 联机模式切入时本地 MOD 强制净化卸载与内存洗脱", passed, {
		"purge_ok": purge_ok,
		"discipline_pass": discipline_pass
	})

## TC-MSS-05: 官方 Vanilla 原生包在联机模式下的安全放行
static func test_multiplayer_official_vanilla_allowed() -> Dictionary:
	var vanilla_mods: Array = [
		{"pack_id": "vanilla_core", "is_vanilla": true},
		{"pack_id": "official_expansion", "is_official": true},
		"vanilla_assets",
		"core_vanilla"
	]

	# 1. 整体校验放行
	var discipline_res := AntiBridgeGuard.validate_mod_realm_discipline(
		WorldGatewayModel.GameMode.MULTIPLAYER,
		vanilla_mods
	)
	var discipline_ok: bool = bool(discipline_res.get("allowed", false)) \
		and str(discipline_res.get("error_code", "")).is_empty()

	# 2. 单项判别器断言
	var v1_ok: bool = AntiBridgeGuard.is_vanilla_pack("vanilla")
	var v2_ok: bool = AntiBridgeGuard.is_vanilla_pack("vanilla_combat")
	var v3_ok: bool = AntiBridgeGuard.is_vanilla_pack("official_lore")
	var v4_ok: bool = AntiBridgeGuard.is_vanilla_pack({"pack_id": "vanilla_mesh"})
	var inv_ok: bool = not AntiBridgeGuard.is_vanilla_pack("unauthorized_cheat_mod")

	var classifier_ok: bool = v1_ok and v2_ok and v3_ok and v4_ok and inv_ok

	var passed: bool = discipline_ok and classifier_ok
	return make_result("TC-MSS-05: 官方 Vanilla 原生包在联机模式下的安全放行", passed, {
		"discipline_ok": discipline_ok,
		"classifier_ok": classifier_ok
	})

## TC-MSS-06: 网关退出后模式重置与状态对称释放
static func test_gateway_exit_symmetric_cleanup() -> Dictionary:
	var fsm := WorldGatewayFSM.new("ACC_MSS_EXIT_01")
	fsm.enter_gateway()
	fsm.set_active_mods([{"pack_id": "temp_mod", "is_vanilla": false}])

	# 选择单机模式并模拟状态填充
	fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
	fsm.context.selected_world_id = "WORLD_EXIT_TEST"
	fsm.context.selected_slot_id = "SLOT_EXIT_TEST"
	fsm.context.active_character_id = "CHAR_EXIT_TEST"

	var before_reset: bool = fsm.context.selected_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER \
		and not fsm.get_active_mods().is_empty()

	# 执行退出与内存洗脱
	var exit_res := fsm.exit_to_gateway()
	var exit_ok: bool = bool(exit_res.get("success", false))

	var mode_reset: bool = fsm.context.selected_mode == WorldGatewayModel.GameMode.UNSELECTED
	var world_reset: bool = fsm.context.selected_world_id.is_empty()
	var slot_reset: bool = fsm.context.selected_slot_id.is_empty()
	var char_reset: bool = fsm.context.active_character_id.is_empty()
	var mods_cleared: bool = fsm.get_active_mods().is_empty()
	var phase_reset: bool = fsm.context.current_phase == WorldGatewayModel.GatewayPhase.GATEWAY_ENTERED

	var passed: bool = before_reset and exit_ok and mode_reset and world_reset \
		and slot_reset and char_reset and mods_cleared and phase_reset

	return make_result("TC-MSS-06: 网关退出后模式重置与状态对称释放", passed, {
		"before_reset": before_reset,
		"exit_ok": exit_ok,
		"mode_reset": mode_reset,
		"mods_cleared": mods_cleared,
		"phase_reset": phase_reset
	})
