# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 全屏媒体播放视口 (Media Presentation))
# 文件路径: res://frontend/presentation/common/cutscene_presenter.gd
# 架构定位: View Presenter / EventBus Boundary Mediator
# 依赖与触发: 上游: EventBus / Coordinator | 下游: CutscenePlayerView
# 职责说明: 作为 CG 视频播放视口与业务系统的表现层中介；
#           负责监听全域广播事件，调度资源实体并单向注入视口；
#           将视口完成与跳过信号反馈给编排回调以恢复上游剧情。
# 退出语义与设计依据: 表现层 MVP 架构解耦与依赖倒置契约 (Inv-VIEW-INJECTION-1)
# ==============================================================================

## CutscenePresenter：CG 播放表现层中介与生命周期桥接器
class_name CutscenePresenter
extends RefCounted

const CutscenePlayerViewClass = preload("res://frontend/views/cutscene_player/cutscene_player_view.gd")

var _player_view: CutscenePlayerView = null
var _current_request: Dictionary = {}
var _resource_provider: Callable = Callable()
var _on_finished_callback: Callable = Callable()
var _on_skip_callback: Callable = Callable()

## 绑定表现层视口实例
func bind_view(player_view: CutscenePlayerView) -> void:
	_player_view = player_view
	if _player_view != null:
		_player_view.playback_finished.connect(_on_view_playback_finished)
		_player_view.skip_requested.connect(_on_view_skip_requested)

## 解绑表现层视口实例并清理监听
func unbind_view() -> void:
	if _player_view != null:
		if _player_view.playback_finished.is_connected(_on_view_playback_finished):
			_player_view.playback_finished.disconnect(_on_view_playback_finished)
		if _player_view.skip_requested.is_connected(_on_view_skip_requested):
			_player_view.skip_requested.disconnect(_on_view_skip_requested)
		_player_view = null

## 注入外部编排回调与资源提供器（依赖倒置解耦契约）
func configure_orchestration(
	resource_provider: Callable,
	on_finished: Callable,
	on_skip: Callable
) -> void:
	_resource_provider = resource_provider
	_on_finished_callback = on_finished
	_on_skip_callback = on_skip

# ==============================================================================
# 领域事件消费入口
# ==============================================================================

## 响应全域 CG 播放启动事件
func handle_cutscene_started(cutscene_payload: Dictionary) -> void:
	_current_request = cutscene_payload.duplicate()
	var video_path := str(cutscene_payload.get("video_path", ""))
	var stream: Resource = null
	if not video_path.is_empty():
		if _resource_provider.is_valid():
			stream = _resource_provider.call(video_path)
		elif ResourceLoader.has_cached(video_path):
			stream = ResourceLoader.load(video_path)

	if _player_view != null:
		_player_view.play_stream(stream, _current_request)

## 响应全域 CG 进度更新事件
func handle_cutscene_progress(cutscene_payload: Dictionary) -> void:
	if _player_view != null:
		_player_view.apply_snapshot({
			"cutscene_id": str(cutscene_payload.get("cutscene_id", "")),
			"current_time_sec": float(cutscene_payload.get("current_time", 0.0)),
			"progress_ratio": float(cutscene_payload.get("progress", 0.0)),
			"active_subtitle_text": str(cutscene_payload.get("subtitle", ""))
		})

# ==============================================================================
# 视口事件反馈
# ==============================================================================

func _on_view_playback_finished() -> void:
	var fade_out_seconds: float = float(_current_request.get("fade_out_sec", 0.5))
	if _player_view != null:
		_player_view.stop_and_dismiss(fade_out_seconds)
	if _on_finished_callback.is_valid():
		_on_finished_callback.call()

func _on_view_skip_requested() -> void:
	var fade_out_seconds: float = float(_current_request.get("fade_out_sec", 0.5))
	if _player_view != null:
		_player_view.stop_and_dismiss(fade_out_seconds)
	if _on_skip_callback.is_valid():
		_on_skip_callback.call()
