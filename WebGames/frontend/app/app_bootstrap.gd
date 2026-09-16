# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端核心: 应用骨架装配器
# 文件路径: res://frontend/app/app_bootstrap.gd
# 职责: 应用启动装配：初始化导航器、Mock 服务容器、全局主题并推入默认入口视图
# ==============================================================================
class_name AppBootstrap
extends RefCounted

const ModalManager = preload("res://frontend/ui_infrastructure/modal_manager.gd")
const TooltipManager = preload("res://frontend/ui_infrastructure/tooltip_manager.gd")
const DrawerManager = preload("res://frontend/ui_infrastructure/drawer_manager.gd")
const ContextMenuManager = preload("res://frontend/ui_infrastructure/context_menu_manager.gd")
const AppLifecycleFSM = preload("res://frontend/app/app_lifecycle_fsm.gd")

## 引导幂等守卫（R-27：重复引导不再重跑生命周期与默认入口压栈）
static var _bootstrapped: bool = false

## 应用骨架装配（幂等：重复调用仅幂等重绑导航根与 UI 基础设施，不重跑生命周期/入口压栈）
static func bootstrap(app_root: AppRoot) -> void:
	# 1. 绑定分层导航器（幂等重绑）
	var nav := NavManager.get_instance()
	nav.bind_root(app_root)

	# 2. 初始化 UI 基础设施管理器（幂等重绑）
	if app_root != null:
		ModalManager.get_instance().bind_layer(app_root.modal_layer, app_root.modal_container)
		TooltipManager.get_instance().bind_layer(app_root.overlay_layer, app_root.overlay_container)
		DrawerManager.get_instance().bind_layer(app_root.modal_layer, app_root.modal_container)
		ContextMenuManager.get_instance().bind_layer(app_root.overlay_layer, app_root.overlay_container)

	# R-27：已完成一次完整引导则仅保留上述幂等重绑，跳过生命周期驱动与入口压栈
	if _bootstrapped:
		return
	_bootstrapped = true

	# 3. 初始化 Mock 服务容器并驱动应用生命周期状态机（版本握手 → 鉴权入口）
	var services := MockServiceContainer.get_instance()
	_drive_lifecycle_boot(services)

	# 4. 应用全局主题
	var theme_mgr := ThemeManager.get_instance()
	if app_root != null:
		app_root.theme = theme_mgr.theme

	# 5. 推入默认入口视图（账号入口）
	nav.push_screen("account_entry")

## 启动态推进：BOOT → INITIALIZING →（版本握手）→ AUTHENTICATING
static func _drive_lifecycle_boot(services: MockServiceContainer) -> void:
	var lifecycle := AppLifecycleFSM.get_instance()
	lifecycle.transition_to(AppLifecycleFSM.AppState.INITIALIZING)
	var version_service := services.version()
	if version_service == null:
		lifecycle.transition_to(AppLifecycleFSM.AppState.ERROR)
		return
	version_service.check_version_async(func(result: Dictionary) -> void:
		if bool(result.get("compatible", false)):
			lifecycle.transition_to(AppLifecycleFSM.AppState.AUTHENTICATING)
		else:
			lifecycle.transition_to(AppLifecycleFSM.AppState.ERROR)
	)

