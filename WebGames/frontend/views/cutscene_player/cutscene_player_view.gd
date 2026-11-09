# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 全屏媒体播放视口 (Media Presentation))
# 文件路径: res://frontend/views/cutscene_player/cutscene_player_view.gd
# 架构定位: Fullscreen Hardware-Accelerated Video Player & Text Placeholder View Component
# 依赖与触发: 上游: CutscenePresenter | 下游: VideoStreamPlayer, DesignTokens
# 职责说明: 提供全屏硬件加速 CG 视频播放与无艺术资源时的文字占位演播（Text Placeholder）；
#           负责黑屏淡入淡出、高精度字幕叠加、时间码倒计时与长按跳过互锁反馈；
#           严格遵循单向快照注入 (apply_snapshot)，零内部业务逻辑与零硬编码文案。
# 退出语义与设计依据: 表现层快照单向绑定与防误触跳过互锁规约 (Inv-VIEW-INJECTION-1 / Inv-SKIP-INTERLOCK-2)
# ==============================================================================

## CutscenePlayerView：全屏硬件加速 CG 视频播放与通用占位视口
class_name CutscenePlayerView
extends Control

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

signal playback_finished()
signal skip_requested()

var _video_player: VideoStreamPlayer = null
var _backdrop_rect: ColorRect = null
var _fade_rect: ColorRect = null
var _subtitle_label: Label = null
var _skip_prompt_box: HBoxContainer = null
var _skip_tip_label: Label = null
var _skip_progress_bar: ProgressBar = null

# 占位/文字演出节点
var _placeholder_container: VBoxContainer = null
var _placeholder_badge: Label = null
var _placeholder_title_label: Label = null
var _placeholder_text_label: Label = null
var _placeholder_timer_label: Label = null
var _placeholder_progress_bar: ProgressBar = null

var _current_request: Dictionary = {}
var _is_skippable: bool = true
var _is_holding_skip: bool = false
var _hold_time: float = 0.0
var _hold_threshold: float = 0.3

var _is_placeholder_mode: bool = false
var _placeholder_elapsed: float = 0.0
var _placeholder_duration: float = 3.0

# ==============================================================================
# 一、节点装配与视口初始化
# ==============================================================================

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP # 阻断下层点击

	# 1. 底层纯黑背景
	_backdrop_rect = ColorRect.new()
	_backdrop_rect.name = "BackdropRect"
	_backdrop_rect.color = Color(0, 0, 0, 1)
	_backdrop_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_backdrop_rect)

	# 2. 硬件加速视频播放器
	_video_player = VideoStreamPlayer.new()
	_video_player.name = "VideoStreamPlayer"
	_video_player.expand = true
	_video_player.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_video_player.finished.connect(_on_video_player_finished)
	add_child(_video_player)

	# 3. 文字占位演出容器（无艺术视频时居中展示）
	_setup_placeholder_ui()

	# 4. 底部字幕浮层
	_subtitle_label = Label.new()
	_subtitle_label.name = "SubtitleLabel"
	_subtitle_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_subtitle_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_subtitle_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_subtitle_label.add_theme_font_size_override("font_size", 22)
	_subtitle_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	_subtitle_label.add_theme_constant_override("outline_size", 4)
	_subtitle_label.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_subtitle_label.offset_bottom = -40
	_subtitle_label.offset_top = -120
	add_child(_subtitle_label)

	# 5. 右上角跳过提示与进度环
	_setup_skip_ui()

	# 6. 最顶层黑屏淡入淡出遮罩
	_fade_rect = ColorRect.new()
	_fade_rect.name = "FadeOverlayRect"
	_fade_rect.color = Color(0, 0, 0, 1)
	_fade_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_fade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_fade_rect)

func _setup_placeholder_ui() -> void:
	_placeholder_container = VBoxContainer.new()
	_placeholder_container.name = "PlaceholderContainer"
	_placeholder_container.alignment = BoxContainer.ALIGNMENT_CENTER
	_placeholder_container.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_placeholder_container.custom_minimum_size = Vector2(600, 240)
	_placeholder_container.visible = false

	_placeholder_badge = Label.new()
	_placeholder_badge.name = "PlaceholderBadge"
	_placeholder_badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_placeholder_badge.text = "[CG Placeholder]"
	_placeholder_badge.add_theme_font_size_override("font_size", 14)
	_placeholder_badge.add_theme_color_override("font_color", Color(1, 0.8, 0.2, 0.9))
	_placeholder_container.add_child(_placeholder_badge)

	_placeholder_title_label = Label.new()
	_placeholder_title_label.name = "PlaceholderTitle"
	_placeholder_title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_placeholder_title_label.add_theme_font_size_override("font_size", 24)
	_placeholder_title_label.add_theme_color_override("font_color", Color(1, 1, 1, 1))
	_placeholder_container.add_child(_placeholder_title_label)

	_placeholder_text_label = Label.new()
	_placeholder_text_label.name = "PlaceholderText"
	_placeholder_text_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_placeholder_text_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_placeholder_text_label.add_theme_font_size_override("font_size", 16)
	_placeholder_text_label.add_theme_color_override("font_color", Color(0.8, 0.8, 0.8, 0.8))
	_placeholder_container.add_child(_placeholder_text_label)

	_placeholder_timer_label = Label.new()
	_placeholder_timer_label.name = "PlaceholderTimer"
	_placeholder_timer_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_placeholder_timer_label.add_theme_font_size_override("font_size", 14)
	_placeholder_timer_label.add_theme_color_override("font_color", Color(0.6, 0.6, 0.6, 0.8))
	_placeholder_container.add_child(_placeholder_timer_label)

	_placeholder_progress_bar = ProgressBar.new()
	_placeholder_progress_bar.name = "PlaceholderProgress"
	_placeholder_progress_bar.custom_minimum_size = Vector2(400, 6)
	_placeholder_progress_bar.max_value = 1.0
	_placeholder_progress_bar.show_percentage = false
	_placeholder_container.add_child(_placeholder_progress_bar)

	add_child(_placeholder_container)

func _setup_skip_ui() -> void:
	_skip_prompt_box = HBoxContainer.new()
	_skip_prompt_box.name = "SkipPromptBox"
	_skip_prompt_box.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_skip_prompt_box.offset_left = -220
	_skip_prompt_box.offset_top = 24
	_skip_prompt_box.offset_right = -24
	_skip_prompt_box.offset_bottom = 60
	_skip_prompt_box.mouse_filter = Control.MOUSE_FILTER_IGNORE

	_skip_tip_label = Label.new()
	_skip_tip_label.name = "SkipTipLabel"
	_skip_tip_label.text = "[ESC / Space]"
	_skip_tip_label.add_theme_font_size_override("font_size", 14)
	_skip_tip_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.7))
	_skip_prompt_box.add_child(_skip_tip_label)

	_skip_progress_bar = ProgressBar.new()
	_skip_progress_bar.name = "SkipProgressBar"
	_skip_progress_bar.custom_minimum_size = Vector2(80, 8)
	_skip_progress_bar.max_value = 1.0
	_skip_progress_bar.value = 0.0
	_skip_progress_bar.show_percentage = false
	_skip_prompt_box.add_child(_skip_progress_bar)

	add_child(_skip_prompt_box)

# ==============================================================================
# 二、播放控制与流式呈现
# ==============================================================================

## 启动播放指定的视频流或文字占位演播
func play_stream(stream: Resource, req: Variant = null) -> void:
	if req is Dictionary:
		_current_request = (req as Dictionary).duplicate()
	elif req != null and req.has_method("to_dict"):
		_current_request = req.to_dict()
	else:
		_current_request = {}

	_is_skippable = bool(_current_request.get("skippable", true))
	_hold_threshold = float(_current_request.get("skip_hold_duration_sec", 0.3))
	_skip_prompt_box.visible = _is_skippable
	_skip_progress_bar.value = 0.0
	_is_holding_skip = false
	_hold_time = 0.0

	var custom_tip: String = str(_current_request.get("skip_prompt_text", ""))
	_skip_tip_label.text = custom_tip if not custom_tip.is_empty() else "[ESC / Space]"

	var audio_bus: String = str(_current_request.get("audio_bus", "BGM"))
	var volume_linear: float = float(_current_request.get("volume_linear", 1.0))
	var fade_in_sec: float = float(_current_request.get("fade_in_sec", 0.5))
	var duration_val: float = float(_current_request.get("duration_sec", 3.0))

	if stream != null and stream is VideoStream:
		_is_placeholder_mode = false
		_placeholder_container.visible = false
		_video_player.visible = true
		_video_player.stream = stream as VideoStream
		_video_player.bus = StringName(audio_bus)
		_video_player.volume_db = linear_to_db(volume_linear)
		_video_player.play()
	else:
		# 无物理视频艺术资源或明确标记占位：激活文字/占位演出模式
		_is_placeholder_mode = true
		_placeholder_elapsed = 0.0
		_placeholder_duration = duration_val if duration_val > 0.0 else 3.0
		_video_player.visible = false
		_placeholder_container.visible = true

		var title_text: String = str(_current_request.get("placeholder_title", _current_request.get("cutscene_id", "")))
		var body_text: String = str(_current_request.get("placeholder_text", ""))
		_placeholder_title_label.text = title_text
		_placeholder_text_label.text = body_text
		_placeholder_timer_label.text = "%.1fs / %.1fs" % [0.0, _placeholder_duration]
		_placeholder_progress_bar.value = 0.0

	visible = true
	_fade_in(fade_in_sec)

## 停止播放并淡出退出
func stop_and_dismiss(fade_out_sec: float = 0.5) -> void:
	_is_placeholder_mode = false
	_fade_out(fade_out_sec, func():
		if _video_player != null and _video_player.is_playing():
			_video_player.stop()
		visible = false
	)

func _fade_in(duration: float) -> void:
	if _fade_rect == null:
		return
	_fade_rect.color.a = 1.0
	var tween := create_tween()
	tween.tween_property(_fade_rect, "color:a", 0.0, maxf(0.1, duration))

func _fade_out(duration: float, on_finished: Callable = Callable()) -> void:
	if _fade_rect == null:
		if on_finished.is_valid():
			on_finished.call()
		return
	var tween := create_tween()
	tween.tween_property(_fade_rect, "color:a", 1.0, maxf(0.1, duration))
	if on_finished.is_valid():
		tween.finished.connect(on_finished)

func _on_video_player_finished() -> void:
	playback_finished.emit()

# ==============================================================================
# 三、快照驱动与跳过输入互锁
# ==============================================================================

## 单向快照注入（更新字幕与进度）
func apply_snapshot(state: Variant) -> void:
	if state == null:
		return
	var subtitle_text := ""
	if state is Dictionary:
		var state_dict := state as Dictionary
		subtitle_text = str(state_dict.get("active_subtitle_text", state_dict.get("subtitle", "")))
	elif "active_subtitle_text" in state:
		subtitle_text = str(state.active_subtitle_text)
	elif "subtitle" in state:
		subtitle_text = str(state.subtitle)

	if _subtitle_label != null:
		_subtitle_label.text = subtitle_text

func _process(delta: float) -> void:
	if not visible:
		return

	# 文字占位演出计时驱动（无物理视频时自动推进并触发完结）
	if _is_placeholder_mode:
		_placeholder_elapsed += delta
		_placeholder_timer_label.text = "%.1fs / %.1fs" % [_placeholder_elapsed, _placeholder_duration]
		_placeholder_progress_bar.value = clampf(_placeholder_elapsed / maxf(0.01, _placeholder_duration), 0.0, 1.0)
		if _placeholder_elapsed >= _placeholder_duration:
			_is_placeholder_mode = false
			playback_finished.emit()

	# 长按跳过进度计算
	if _is_holding_skip:
		_hold_time += delta
		var ratio: float = clampf(_hold_time / maxf(0.01, _hold_threshold), 0.0, 1.0)
		_skip_progress_bar.value = ratio
		if _hold_time >= _hold_threshold:
			_is_holding_skip = false
			_hold_time = 0.0
			_skip_progress_bar.value = 0.0
			_is_placeholder_mode = false
			skip_requested.emit()
	else:
		if _hold_time > 0.0:
			_hold_time = maxf(0.0, _hold_time - delta * 2.0)
			_skip_progress_bar.value = _hold_time / maxf(0.01, _hold_threshold)

func _gui_input(event: InputEvent) -> void:
	if not _is_skippable:
		return

	if event is InputEventKey:
		var key_event := event as InputEventKey
		if key_event.keycode == KEY_ESCAPE or key_event.keycode == KEY_SPACE:
			if key_event.pressed:
				_is_holding_skip = true
			else:
				_is_holding_skip = false
