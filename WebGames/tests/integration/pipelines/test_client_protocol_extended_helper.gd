# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_client_protocol_extended_helper.gd
# 架构定位: Integration Test Harness Helper
# 依赖与触发: 由 TestClientProtocolSpaceAndBoundaryPipeline 调度执行
# 职责说明: 承载 11 环保留交互接口端到端全链路串联与 HudEventBridge 常驻信道解包验证。
# 退出语义与设计依据: 客户端交互协议空间规约 (TC-PROTO-11 ~ TC-PROTO-12)
# ==============================================================================

## TestClientProtocolExtendedHelper：客户端协议空间扩展联调与 HUD 事件桥接测试助手
class_name TestClientProtocolExtendedHelper
extends RefCounted

const ServiceContainer = preload("res://frontend/domain_boundary/service_container.gd")
const ServiceLocator = preload("res://frontend/domain_boundary/service_locator.gd")
const HudEventBridge = preload("res://frontend/systems/hud_event_bridge.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const GameBootstrap = preload("res://backend/infrastructure/game_bootstrap.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/game_lifecycle_model.gd")
const MainHUDView = preload("res://frontend/views/main_hud/main_hud_view.gd")
const NavManager = preload("res://frontend/navigation/nav_manager.gd")
const AppLifecycleFSM = preload("res://frontend/app/app_lifecycle_fsm.gd")

## 串联验证账号注册、网关准入、权威创角与序章完结主链路
static func chain_entry_to_prologue(container: ServiceContainer, ctx: Dictionary) -> bool:
	var reg := {}
	container.auth().register_async("p128_chain_u11", "SecretPass128#11", func(r: Dictionary): reg.merge(r))
	var login := {}
	container.auth().login_async("p128_chain_u11", "SecretPass128#11", func(r: Dictionary): login.merge(r))
	ctx["account_id"] = String(login.get("account_id", reg.get("account_id", "")))
	ctx["token"] = String(login.get("token", ""))
	if not bool(login.get("success", false)) or not WorldSessionRuntimeService.has_authenticated_session():
		return false

	var enter_gw := {}
	var probe := {}
	var list_w := {}
	var sel_w := {}
	container.world().enter_gateway_async(ctx["account_id"], ctx["token"], func(r: Dictionary): enter_gw.merge(r))
	container.world().probe_modes_async(ctx["account_id"], ctx["token"], func(r: Dictionary): probe.merge(r))
	container.world().list_worlds_async(ctx["account_id"], ctx["token"], func(r: Dictionary): list_w.merge(r))
	container.world().select_or_create_world_async(ctx["account_id"], ctx["token"], ctx["world_id"], WorldGatewayModel.GameMode.SINGLE_PLAYER, func(r: Dictionary): sel_w.merge(r))
	if not (bool(enter_gw.get("success", false)) and bool(probe.get("success", false)) and bool(list_w.get("success", false)) and bool(sel_w.get("success", false))):
		return false

	var ui_snap := {}
	var roll := {}
	var created := {}
	container.character().get_creation_ui_snapshot_async(ctx["account_id"], ctx["token"], func(r: Dictionary): ui_snap.merge(r))
	container.character().roll_destiny_preview_async(ctx["account_id"], ctx["token"], {"name": "ElevenChainHero", "world_id": ctx["world_id"], "request_seed": 20261114}, func(r: Dictionary): roll.merge(r))
	container.character().create_character_async(ctx["account_id"], ctx["token"], {"name": "ElevenChainHero", "slot_index": 1, "world_id": ctx["world_id"], "race": "HUMAN"}, func(r: Dictionary): created.merge(r))
	ctx["character_id"] = String((created.get("data", {}) as Dictionary).get("character_id", ""))
	if not (bool(ui_snap.get("success", false)) and bool(roll.get("success", false)) and bool(created.get("success", false))) or String(ctx["character_id"]).is_empty():
		return false

	var p_start := {}
	var p_state := {}
	var p_adv := {}
	var p_done := {}
	container.prologue().start_prologue_async(ctx["account_id"], ctx["token"], {}, func(r: Dictionary): p_start.merge(r))
	container.prologue().get_prologue_state_async(ctx["account_id"], ctx["token"], func(r: Dictionary): p_state.merge(r))
	container.prologue().advance_prologue_async(ctx["account_id"], ctx["token"], "LOOK_AROUND", {}, func(r: Dictionary): p_adv.merge(r))
	container.prologue().complete_prologue_async(ctx["account_id"], ctx["token"], "cs_prologue_awakening", false, func(r: Dictionary): p_done.merge(r))
	return bool(p_start.get("success", false)) and bool(p_state.get("success", false)) and bool(p_adv.get("success", false)) and bool(p_done.get("success", false)) and WorldSessionRuntimeService.has_active_world()

## 串联验证常驻 HUD 同步、ESC 菜单交互与音画设置写回链路
static func chain_hud_esc_settings(container: ServiceContainer, ctx: Dictionary) -> bool:
	var pull := {}
	var tick := {}
	var act := {}
	container.hud_sync().pull_authoritative_snapshot_async(ctx["account_id"], ctx["token"], ctx["character_id"], func(r: Dictionary): pull.merge(r))
	container.hud_sync().tick_world_clock_async(ctx["account_id"], ctx["token"], ctx["character_id"], {"clock_hours_delta": 2, "hp_delta": -10.0}, func(r: Dictionary): tick.merge(r))
	container.hud_sync().dispatch_hud_directive_async(ctx["account_id"], ctx["token"], ctx["character_id"], "INSPECT_INVENTORY_SLOT", {}, func(r: Dictionary): act.merge(r))
	var pull_snap: Dictionary = (pull.get("data", {}) as Dictionary).get("hud_snapshot", {})
	var routes := NavManager.get_reserved_chain_routes()
	if not (bool(pull.get("success", false)) and float(pull_snap.get("hp_max", 0.0)) > 0.0 and bool(tick.get("success", false)) and bool(act.get("success", false)) and routes.has("world_gateway")):
		return false

	var menu := {}
	var paused := {}
	var saved := {}
	var applied := {}
	var settings := {}
	var resumed := {}
	container.esc_menu().get_menu_state_async(func(r: Dictionary): menu.merge(r))
	container.esc_menu().pause_game_async(func(r: Dictionary): paused.merge(r))
	container.esc_menu().request_save_async("SLOT_01", false, func(r: Dictionary): saved.merge(r))
	container.esc_menu().apply_settings_async({"render": {"vsync_mode": "DISABLED"}}, func(r: Dictionary): applied.merge(r))
	container.game_settings().get_settings_async(ctx["account_id"], ctx["token"], func(r: Dictionary): settings.merge(r))
	container.esc_menu().resume_game_async(func(r: Dictionary): resumed.merge(r))
	var render_cfg: Dictionary = ((settings.get("data", {}) as Dictionary).get("settings", {}) as Dictionary).get("render", {})
	return bool(menu.get("success", false)) and bool((paused.get("data", {}) as Dictionary).get("is_paused", false)) and bool(saved.get("success", false)) and bool(applied.get("success", false)) and str(render_cfg.get("vsync_mode", "")) == "DISABLED" and not bool((resumed.get("data", {}) as Dictionary).get("is_paused", true))

## 串联验证退回网关、切模重入、登出清槽与安全优雅停机链路
static func chain_exit_switch_logout_quit(container: ServiceContainer, ctx: Dictionary) -> bool:
	var exit_gw := {}
	container.esc_menu().exit_to_gateway_async(func(r: Dictionary): exit_gw.merge(r), true, false)
	if not bool(exit_gw.get("success", false)) or WorldSessionRuntimeService.has_active_world():
		return false

	var sw := {}
	var attach := {}
	var reenter := {}
	container.world().switch_gateway_mode_async(ctx["account_id"], ctx["token"], WorldGatewayModel.GameMode.SINGLE_PLAYER, func(r: Dictionary): sw.merge(r), {"world_id": ctx["world_id"], "slot_id": "SLOT_01"})
	container.world().attach_ready_character_async(ctx["account_id"], ctx["token"], ctx["character_id"], func(r: Dictionary): attach.merge(r))
	container.world().enter_world_async(ctx["account_id"], ctx["token"], ctx["world_id"], false, func(r: Dictionary): reenter.merge(r))
	if not (bool(sw.get("success", false)) and bool(attach.get("success", false)) and bool(reenter.get("success", false)) and WorldSessionRuntimeService.has_active_world()):
		return false

	var logout := {}
	container.lifecycle().logout_to_menu_async(ctx["account_id"], ctx["token"], "SLOT_01", true, func(r: Dictionary): logout.merge(r))
	if not bool(logout.get("success", false)) or WorldSessionRuntimeService.has_authenticated_session() or not GameBootstrap.is_assembled():
		return false

	var home := {}
	container.auth().get_account_home_async("", "", func(r: Dictionary): home.merge(r))
	var vm: Dictionary = home.get("view_model", {})
	if not bool(home.get("success", false)) or bool(vm.get("session_active", true)) or (vm.get("known_accounts", []) as Array).is_empty():
		return false

	var quit := {}
	container.lifecycle().request_graceful_shutdown_async("", "", {"save_before_quit": false, "exit_reason": GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT}, func(r: Dictionary): quit.merge(r))
	return bool(quit.get("success", false)) and not GameBootstrap.is_assembled()

## TC-PROTO-11: RealServiceContainer 全 11 环保留交互接口端到端无缝串联验证
static func test_proto_11_full_eleven_link_reserved_interfaces_chain(setup_fn: Callable, teardown_fn: Callable) -> Dictionary:
	setup_fn.call()
	ServiceLocator.set_mode("real")
	var container := ServiceLocator.get_instance()
	var ctx := {"world_id": "WORLD_P128_11"}
	var ok_front := chain_entry_to_prologue(container, ctx)
	var ok_mid := chain_hud_esc_settings(container, ctx) if ok_front else false
	var ok_tail := chain_exit_switch_logout_quit(container, ctx) if ok_mid else false
	var ok_fsm := int(AppLifecycleFSM.AppState.WORLD_GATEWAY) >= 0
	teardown_fn.call()
	var passed := ok_front and ok_mid and ok_tail and ok_fsm
	return TestCase.make_result("TC-PROTO-11: RealServiceContainer全11环保留交互接口端到端无缝串联验证", passed, {
		"ok_front": ok_front, "ok_mid": ok_mid, "ok_tail": ok_tail, "ok_fsm": ok_fsm
	})

## TC-PROTO-12: HudEventBridge 常驻信道订阅、HP/时钟解包渲染与容器通道解耦验证
static func test_proto_12_hud_event_bridge_stat_and_clock_unwrap(setup_fn: Callable, teardown_fn: Callable, bootstrap_fn: Callable) -> Dictionary:
	setup_fn.call()
	var env_ctx: Dictionary = bootstrap_fn.call("p128_user_12", "SecretPass128#12", "WORLD_P128_12", "HudBridgeHero")
	var acc_id := String(env_ctx["account_id"])
	var token := String(env_ctx["token"])
	var char_id := String(env_ctx["character_id"])
	var container := ServiceLocator.get_instance()

	var hud_view := MainHUDView.new()
	var bridge := HudEventBridge.get_instance()
	bridge.attach_hud(hud_view)

	var bus_events := {"clock": 0}
	var sub_tokens := container.hud_sync().subscribe_hud_channels({
		"on_clock_advanced": func(_pkt): bus_events["clock"] = int(bus_events["clock"]) + 1
	})
	var tick := {}
	container.hud_sync().tick_world_clock_async(acc_id, token, char_id, {"hp_delta": -15.0, "clock_hours_delta": 3}, func(r: Dictionary): tick.merge(r))
	var hp_dropped: bool = hud_view.stat_hp_current < 90.0
	var clock_ok: bool = not str(hud_view.snapshot.get("clock_display", "")).is_empty()
	var channel_ok: bool = int(bus_events.get("clock", 0)) >= 1

	container.hud_sync().unsubscribe_hud_channels(sub_tokens)
	container.hud_sync().tick_world_clock_async(acc_id, token, char_id, {"clock_hours_delta": 1}, func(_r): pass)
	var no_leak: bool = int(bus_events.get("clock", 0)) == 1

	bridge.detach_hud()
	hud_view.free()
	teardown_fn.call()
	var passed: bool = bool(tick.get("success", false)) and hp_dropped and clock_ok and channel_ok and no_leak
	return TestCase.make_result("TC-PROTO-12: HudEventBridge常驻信道订阅与HP时钟解包渲染验证", passed, {
		"hp_dropped": hp_dropped, "clock_ok": clock_ok, "channel_ok": channel_ok, "no_leak": no_leak
	})
