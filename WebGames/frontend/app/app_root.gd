# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端核心: 应用根控制器
# 文件路径: res://frontend/app/app_root.gd
# 职责: 挂载于 project.godot 入口场景，管理 6 层 CanvasLayer 视口与全局容器锚点
# ==============================================================================
class_name AppRoot
extends Control

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
	AppBootstrap.bootstrap(self)
