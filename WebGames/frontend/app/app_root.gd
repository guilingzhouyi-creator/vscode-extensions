# ==============================================================================
# 模块归属: 前端核心层 (Frontend · Application Scene Root)
# 文件路径: res://frontend/app/app_root.gd
# 架构定位: Scene Tree Root Controller & Desktop Quit Interceptor
# 依赖与触发: 上游: project.godot 主入口场景 | 下游: AppBootstrap, GameLifecycleService, NavManager
# 职责说明: 挂载于 project.godot 入口场景，管理 6 层 CanvasLayer 视口容器并拦截桌面窗口关闭以执行优雅存盘停机。
# 退出语义与设计依据: 主场景根节点分层隔离与窗口关闭优雅停机契约
# ==============================================================================

## AppRoot：应用主场景根控制器与 6 层视口容器宿主
class_name AppRoot
extends Control

const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/game_lifecycle_model.gd")
const GameLifecycleService = preload("res://backend/domains/lifecycle/game_lifecycle_service.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")

@onready var background_layer: CanvasLayer = $BackgroundLayer
@onready var screen_layer: CanvasLayer = $ScreenLayer
@onready var hud_layer: CanvasLayer = $HUDLayer
@onready var modal_layer: CanvasLayer = $ModalLayer
@onready var overlay_layer: CanvasLayer = $OverlayLayer
@onready var debug_layer: CanvasLayer = $DebugLayer

@onready var screen_container: Control = $ScreenLayer/ScreenContainer
@onready var modal_container: Control = $ModalLayer/ModalContainer
@onready var overlay_container: Control = $OverlayLayer/OverlayContainer
@onready var toast_layer: ToastLayer = $OverlayLayer/ToastLayer
@onready var loading_overlay: LoadingOverlay = $OverlayLayer/LoadingOverlay

func _ready() -> void:
	# 禁用引擎自动直接退出，确保窗口关闭时先经领域层完成会话存盘与控制租约释放
	if get_tree() != null:
		get_tree().set_auto_accept_quit(false)
	AppBootstrap.bootstrap(self)

func _notification(notification_type: int) -> void:
	if notification_type == NOTIFICATION_WM_CLOSE_REQUEST:
		_handle_desktop_close_request()

func _handle_desktop_close_request() -> void:
	var shutdown_request := GameShutdownDTO.Request.new()
	shutdown_request.exit_reason = GameLifecycleModel.ExitReason.WINDOW_CLOSE_REQUEST
	shutdown_request.session_token = WorldSessionRuntimeService.get_active_session_token()
	shutdown_request.account_id = WorldSessionRuntimeService.get_active_account_id()
	shutdown_request.target_save_slot = WorldSessionRuntimeService.get_active_slot_id()
	shutdown_request.save_before_quit = not shutdown_request.target_save_slot.is_empty()
	GameLifecycleService.execute_graceful_shutdown(shutdown_request)
	HumanControlLeaseManager.release_lease()
	NavManager.get_instance().clear_stack()
	AppLifecycleFSM.get_instance().reset()
	if get_tree() != null:
		get_tree().quit()
