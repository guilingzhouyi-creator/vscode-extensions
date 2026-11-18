# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端架构与导航测试套件
# 文件路径: res://tests/unit/frontend/test_frontend_architecture_and_bootstrap.gd
# 职责: 验证 AppRoot 6 层视口层级拓扑、NavManager 分层导航栈与注册表查询
# ==============================================================================
class_name TestFrontendArchitectureAndBootstrap
extends RefCounted

const FeMountHelper = preload("res://tests/unit/frontend/fe_mount_test_helper.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_app_root_viewport_layers())
	results.append(_test_nav_manager_stack_and_history())
	results.append(_test_nav_manager_screen_registry())
	results.append(_test_toast_and_loading_dispatch())
	results.append(_test_mounted_real_mod_workbench_lifecycle())
	results.append(_test_mounted_real_cutscene_player_and_bridge())

	var all_passed := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_passed = false

	return {
		"domain": "frontend_architecture_bootstrap",
		"total": results.size(),
		"passed": passed_cnt,
		"all_passed": all_passed,
		"results": results
	}

## 1. 验证 AppRoot 6 层 CanvasLayer 拓扑
static func _test_app_root_viewport_layers() -> Dictionary:
	var test_name := "test_app_root_viewport_layers"
	var root := AppRoot.new()
	root.name = "TestAppRoot"

	var bg_layer := CanvasLayer.new()
	bg_layer.name = "BackgroundLayer"
	bg_layer.layer = NavTypes.LayerLevel.BACKGROUND
	root.add_child(bg_layer)

	var screen_layer := CanvasLayer.new()
	screen_layer.name = "ScreenLayer"
	screen_layer.layer = NavTypes.LayerLevel.SCREEN
	var screen_container := Control.new()
	screen_container.name = "ScreenContainer"
	screen_layer.add_child(screen_container)
	root.add_child(screen_layer)

	var hud_layer := CanvasLayer.new()
	hud_layer.name = "HUDLayer"
	hud_layer.layer = NavTypes.LayerLevel.HUD
	root.add_child(hud_layer)

	var modal_layer := CanvasLayer.new()
	modal_layer.name = "ModalLayer"
	modal_layer.layer = NavTypes.LayerLevel.MODAL
	root.add_child(modal_layer)

	var overlay_layer := CanvasLayer.new()
	overlay_layer.name = "OverlayLayer"
	overlay_layer.layer = NavTypes.LayerLevel.OVERLAY
	var toast_layer := ToastLayer.new()
	toast_layer.name = "ToastLayer"
	overlay_layer.add_child(toast_layer)
	var loading_overlay := LoadingOverlay.new()
	loading_overlay.name = "LoadingOverlay"
	overlay_layer.add_child(loading_overlay)
	root.add_child(overlay_layer)

	var debug_layer := CanvasLayer.new()
	debug_layer.name = "DebugLayer"
	debug_layer.layer = NavTypes.LayerLevel.DEBUG
	root.add_child(debug_layer)

	var passed := (bg_layer.layer == -10 and screen_layer.layer == 0 and hud_layer.layer == 10 and modal_layer.layer == 50 and overlay_layer.layer == 80 and debug_layer.layer == 100)

	root.free()
	return {"test": test_name, "passed": passed}

## 2. 验证 NavManager 历史栈深度与跳转
static func _test_nav_manager_stack_and_history() -> Dictionary:
	var test_name := "test_nav_manager_stack_and_history"
	var nav := NavManager.new()

	var dummy_root := AppRoot.new()
	var screen_layer := CanvasLayer.new()
	screen_layer.name = "ScreenLayer"
	var container := Control.new()
	container.name = "ScreenContainer"
	screen_layer.add_child(container)
	dummy_root.add_child(screen_layer)
	dummy_root.screen_container = container
	nav.bind_root(dummy_root)

	# 注册假 Screen
	nav.register_screen("page_a", "res://frontend/views/main_hud/main_hud_view.tscn")
	nav.register_screen("page_b", "res://frontend/views/combat_view/combat_view.tscn")

	nav.push_screen("page_a")
	var d1 := nav.get_stack_depth()

	nav.push_screen("page_b")
	var d2 := nav.get_stack_depth()

	nav.pop_screen(NavTypes.TransitionType.NONE)
	var d3 := nav.get_stack_depth()

	var passed := (d1 == 1 and d2 == 2 and d3 == 1)

	dummy_root.free()
	nav.free()
	return {"test": test_name, "passed": passed}

## 3. 验证 NavManager 屏幕注册表查询能力
static func _test_nav_manager_screen_registry() -> Dictionary:
	var test_name := "test_nav_manager_screen_registry"
	var nav := NavManager.get_instance()
	var has_account := nav.has_screen("account_entry")
	var has_hud := nav.has_screen("main_hud")
	var has_invalid := nav.has_screen("non_existing_view_xyz")

	var passed := (has_account and has_hud and not has_invalid)
	return {"test": test_name, "passed": passed}

## 4. 验证 Toast 与 Loading 调度（节点挂入场景树，保证 Tween 有树环境）
static func _test_toast_and_loading_dispatch() -> Dictionary:
	var test_name := "test_toast_and_loading_dispatch"
	var tree_root := (Engine.get_main_loop() as SceneTree).root

	var toast := ToastLayer.new()
	tree_root.add_child(toast)
	toast.show_toast("测试成功消息", NavTypes.ToastLevel.SUCCESS, 0.1)
	var child_count := toast.get_child_count()

	var loading := LoadingOverlay.new()
	tree_root.add_child(loading)
	loading.show_loading("加载资源中...")
	var is_visible := loading.visible
	loading.hide_loading()
	var is_hidden := not loading.visible

	var passed := (child_count >= 1 and is_visible and is_hidden)
	toast.free()
	loading.free()
	return {"test": test_name, "passed": passed}

## 5. 验证 ModWorkbenchScreen 在 real 模式下的创建 / .kmod 打包 / 安装 / 自定义目录与手排序保持流程
static func _test_mounted_real_mod_workbench_lifecycle() -> Dictionary:
	var backend_helper := load("res://tests/integration/pipelines/test_full_chain_backend_helper.gd")
	backend_helper.setup_env()
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var test_root := "user://tmp_e2e_mod_workbench/"
	var install_root := "user://tmp_e2e_mod_install/"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(test_root))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(install_root))

	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/mod_workbench/mod_workbench_screen.tscn", "real")
	var passed := bool(mount_handle.get("ok", false))
	var auth_service := ServiceLocator.get_instance().auth()
	var auth_ctx := {"account_id": "", "token": "", "gateway_ok": false}
	if auth_service != null:
		auth_service.register_async("e2e_wb_tester", "Pass_2026_OK", func(_reg: Dictionary) -> void: pass)
		auth_service.login_async("e2e_wb_tester", "Pass_2026_OK", func(login_reply: Dictionary) -> void:
			auth_ctx["account_id"] = str(login_reply.get("account_id", ""))
			auth_ctx["token"] = str(login_reply.get("token", ""))
		)
	var account_id := str(auth_ctx.get("account_id", ""))
	var session_token := str(auth_ctx.get("token", ""))
	ServiceLocator.get_instance().world().enter_gateway_async(account_id, session_token, func(reply: Dictionary) -> void:
		auth_ctx["gateway_ok"] = bool(reply.get("success", false))
	)
	var gateway_ok := bool(auth_ctx.get("gateway_ok", false))

	var screen: ModWorkbenchScreen = mount_handle.get("view", null) as ModWorkbenchScreen
	if screen != null:
		screen.current_account_id = account_id
		screen.current_session_token = session_token
		var tabs := screen._get_tabs()
		var created := tabs.create_mod_pack({
			"pack_id": "e2e_wb_addon",
			"display_name": "E2E Workbench Addon",
			"pack_profile": "CONTENT_ADDON",
			"target_root": test_root
		})
		var created_path := str((created.get("data", {}) as Dictionary).get("root_path", ""))
		var kmod_target := test_root.path_join("e2e_wb_addon.kmod")
		var packed := tabs.pack_focused_mod_kmod(created_path, kmod_target)
		var installed := tabs.install_mod_from_input(kmod_target, install_root)
		screen.custom_scan_roots = ["res://mods/", install_root]
		tabs.refresh_installed_packs()
		screen.selected_pack_ids = ["official_kalar", "e2e_wb_addon"]
		var addon_idx: int = -1
		for idx in range(screen.installed_packs.size()):
			var pack_item: Variant = screen.installed_packs[idx]
			if pack_item is Dictionary and str((pack_item as Dictionary).get("pack_id", "")) == "e2e_wb_addon":
				addon_idx = idx
				break
		if addon_idx >= 0:
			screen.focused_pack_index = addon_idx
			tabs.move_focused_pack(-1)
		var move_ok: bool = (addon_idx >= 0) and (screen.selected_pack_ids == ["e2e_wb_addon", "official_kalar"])
		var precheck_reply := tabs.commit_selection_and_precheck()
		var enabled_ids: Array = (precheck_reply.get("data", {}) as Dictionary).get("enabled_pack_ids", [])
		var order_ok: bool = move_ok and ("e2e_wb_addon" in enabled_ids) and ("official_kalar" in enabled_ids)
		var step_ok: bool = gateway_ok and screen.is_mounted_in_tree() and bool(created.get("success", false)) and bool(packed.get("success", false)) and bool(installed.get("success", false)) and bool(precheck_reply.get("success", false)) and FileAccess.file_exists(kmod_target) and order_ok
		if not step_ok:
			push_warning("E2E MW fail: gw=%s created=%s packed=%s installed=%s pre=%s move=%s ids=%s" % [str(gateway_ok), str(created), str(packed), str(installed), str(precheck_reply), str(move_ok), str(enabled_ids)])
		passed = passed and step_ok
	FeMountHelper.unmount_scene(mount_handle)
	_remove_dir_recursive_for_test(test_root)
	_remove_dir_recursive_for_test(install_root)
	backend_helper.teardown_env()
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {"test": "test_mounted_real_mod_workbench_lifecycle", "passed": passed and (orphan_after <= orphan_before)}

## 6. 验证 CutscenePlayerView 真场景挂载、NavManager 路由注册与 CutsceneEventBridge 预演驱动流程
static func _test_mounted_real_cutscene_player_and_bridge() -> Dictionary:
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var nav := NavManager.get_instance()
	var registered_ok := nav.has_screen("cutscene_player")
	var mount_handle := FeMountHelper.mount_scene("res://frontend/views/cutscene_player/cutscene_player_view.tscn", "real")
	var passed := registered_ok and bool(mount_handle.get("ok", false))
	var cutscene_view: CutscenePlayerView = mount_handle.get("view", null) as CutscenePlayerView
	var bridge := CutsceneEventBridge.get_instance()
	if cutscene_view != null:
		bridge.attach_host(mount_handle.get("host") as Control)
		bridge.attach_view(cutscene_view)
		bridge.trigger_cutscene_preview("cs_e2e_preview", "Preview", "E2E subtitle")
		passed = passed and cutscene_view.is_mounted_in_tree() and (bridge.get_active_cutscene_id() == "cs_e2e_preview")
		bridge.detach_all()
	FeMountHelper.unmount_scene(mount_handle)
	CutsceneEventBridge.reset_for_tests()
	var orphan_after := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	return {"test": "test_mounted_real_cutscene_player_and_bridge", "passed": passed and (orphan_after <= orphan_before)}

static func _remove_dir_recursive_for_test(dir_path: String) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		return
	var dir_handle := DirAccess.open(dir_path)
	if dir_handle == null:
		return
	dir_handle.list_dir_begin()
	var entry_name := dir_handle.get_next()
	while entry_name != "":
		if entry_name != "." and entry_name != "..":
			var child_path := dir_path.path_join(entry_name)
			if dir_handle.current_is_dir():
				_remove_dir_recursive_for_test(child_path)
			else:
				DirAccess.remove_absolute(child_path)
		entry_name = dir_handle.get_next()
	dir_handle.list_dir_end()
	DirAccess.remove_absolute(dir_path)
