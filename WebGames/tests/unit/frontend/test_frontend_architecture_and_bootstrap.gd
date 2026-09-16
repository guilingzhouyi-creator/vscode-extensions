# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端架构与导航测试套件 (Phase 77)
# 文件路径: res://tests/unit/frontend/test_frontend_architecture_and_bootstrap.gd
# 职责: 验证 AppRoot 6 层视口层级拓扑、NavManager 分层导航栈、ViewRouter 兼容代理
# ==============================================================================
class_name TestFrontendArchitectureAndBootstrap
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_app_root_viewport_layers())
	results.append(_test_nav_manager_stack_and_history())
	results.append(_test_view_router_compatibility_adapter())
	results.append(_test_toast_and_loading_dispatch())

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
	return { "test": test_name, "passed": passed }

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

	nav.pop_screen()
	var d3 := nav.get_stack_depth()

	var passed := (d1 == 1 and d2 == 2 and d3 == 1)

	dummy_root.free()
	nav.free()
	return { "test": test_name, "passed": passed }

## 3. 验证 ViewRouter 兼容代理穿透
static func _test_view_router_compatibility_adapter() -> Dictionary:
	var test_name := "test_view_router_compatibility_adapter"
	var vr := ViewRouter.get_instance()
	var has_account := vr.has_view("account_entry")
	var has_hud := vr.has_view("main_hud")
	var has_invalid := vr.has_view("non_existing_view_xyz")

	var passed := (has_account and has_hud and not has_invalid)
	return { "test": test_name, "passed": passed }

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
	return { "test": test_name, "passed": passed }
