# ==============================================================================
# 模块归属: 前端系统层 (Frontend · CG视频与演出事件桥接中枢)
# 文件路径: res://frontend/systems/cutscene_event_bridge.gd
# 架构定位: Presentation Bridge / Cutscene EventBus Consumer Adapter
# 依赖与触发: 上游: EventBusCore, CutsceneOrchestrator | 下游: CutscenePlayerView
# 职责说明: 单源监听全域 CG 与视频演出事件信道，将总线事件转换为前端视口渲染调用；
#           负责宿主视口挂载、动态实例化装配、字幕快照透传与玩家跳过/完结反向调度；
#           保持待命零接线架构（Standby Un-wired），杜绝侵入式硬编码，供主线程及前端表现层按需消费。
# 退出语义与设计依据: 单源订阅、表现层解耦与幂等挂卸载契约 (Inv-VIEW-INJECTION-1)
# ==============================================================================

## CutsceneEventBridge：前端 CG 演出事件总线消费桥接器
class_name CutsceneEventBridge
extends RefCounted

const CutscenePlayerViewClass = preload("res://frontend/views/cutscene_player/cutscene_player_view.gd")

signal presentation_started(cutscene_id: String, is_placeholder: bool)
signal presentation_progress(current_time: float, progress: float, subtitle: String)
signal presentation_finished(cutscene_id: String)
signal presentation_skipped(cutscene_id: String)

static var _instance: CutsceneEventBridge = null

var _view_ref: WeakRef = null
var _host_ref: WeakRef = null
var _dynamic_view: CutscenePlayerView = null
var _is_attached: bool = false
var _bus_tokens: Array = []
var _current_cutscene_id: String = ""
var _is_placeholder_active: bool = false

# ==============================================================================
# 一、单例与生命周期管理
# ==============================================================================

## 获取全局唯一前端演出事件消费桥接器单例
static func get_instance() -> CutsceneEventBridge:
	if _instance == null:
		_instance = CutsceneEventBridge.new()
	return _instance

## 测试环境隔离复用
static func reset_for_tests() -> void:
	if _instance != null:
		_instance.detach_all()
		_instance = null

## 查询当前是否挂载有效视口或宿主节点
func is_attached() -> bool:
	if not _is_attached:
		return false
	var has_view: bool = _view_ref != null and _view_ref.get_ref() != null
	var has_host: bool = _host_ref != null and _host_ref.get_ref() != null
	return has_view or has_host

## 查询当前是否处于演播消费中
func is_consuming() -> bool:
	return not _current_cutscene_id.is_empty()

## 获取当前活跃的 CG 语义标识符
func get_active_cutscene_id() -> String:
	return _current_cutscene_id

## 获取当前正在呈现的视口控件实体
func get_active_view() -> CutscenePlayerView:
	if _view_ref != null and _view_ref.get_ref() != null:
		return _view_ref.get_ref() as CutscenePlayerView
	return _dynamic_view

# ==============================================================================
# 二、视口挂载与待命契约（零接线）
# ==============================================================================

## 静态绑定已有视口实例（幂等）
func attach_view(view: CutscenePlayerView) -> void:
	if view == null:
		return
	if _is_attached and _view_ref != null and _view_ref.get_ref() == view:
		return
	detach_all()

	_view_ref = weakref(view)
	_is_attached = true
	_connect_view_signals(view)
	_setup_bus_subscriptions()

## 挂载 UI 根/弹窗宿主容器（由总线事件驱动动态装配视口）
func attach_host(host_container: Control) -> void:
	if host_container == null:
		return
	if _is_attached and _host_ref != null and _host_ref.get_ref() == host_container:
		return
	detach_all()

	_host_ref = weakref(host_container)
	_is_attached = true
	_setup_bus_subscriptions()

## 解绑视口与宿主，注销总线监听（幂等·防泄漏）
func detach_all() -> void:
	for tok in _bus_tokens:
		if tok != null and tok.has_method("unbind"):
			tok.unbind()
	_bus_tokens.clear()

	_disconnect_active_view()
	_cleanup_dynamic_view()

	_view_ref = null
	_host_ref = null
	_is_attached = false
	_current_cutscene_id = ""
	_is_placeholder_active = false

func _connect_view_signals(view: CutscenePlayerView) -> void:
	if view == null:
		return
	if not view.playback_finished.is_connected(_on_view_playback_finished):
		view.playback_finished.connect(_on_view_playback_finished)
	if not view.skip_requested.is_connected(_on_view_skip_requested):
		view.skip_requested.connect(_on_view_skip_requested)

func _disconnect_active_view() -> void:
	var view: CutscenePlayerView = get_active_view()
	if view != null:
		if view.playback_finished.is_connected(_on_view_playback_finished):
			view.playback_finished.disconnect(_on_view_playback_finished)
		if view.skip_requested.is_connected(_on_view_skip_requested):
			view.skip_requested.disconnect(_on_view_skip_requested)

func _cleanup_dynamic_view() -> void:
	if _dynamic_view != null:
		if _dynamic_view.get_parent() != null:
			_dynamic_view.get_parent().remove_child(_dynamic_view)
		_dynamic_view.queue_free()
		_dynamic_view = null

# ==============================================================================
# 三、EventBus 订阅与事件分发消费
# ==============================================================================

func _setup_bus_subscriptions() -> void:
	if not _bus_tokens.is_empty():
		return

	var bus: EventBusCore = EventBusCore.get_instance()
	if bus == null:
		return

	var token := bus.on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, _on_domain_packet)
	_bus_tokens.append(token)

func _on_domain_packet(packet: Variant) -> void:
	var wrapper: Dictionary = packet.payload_data if packet != null and packet.get("payload_data") is Dictionary else {}
	var channel: String = str(wrapper.get("channel", ""))
	if not channel.begins_with("cutscene."):
		return

	var payload: Dictionary = wrapper.get("payload", {}) if wrapper.get("payload", {}) is Dictionary else wrapper

	match channel:
		"cutscene.started":
			_handle_cutscene_started(payload)
		"cutscene.playback_progress":
			_handle_cutscene_progress(payload)
		"cutscene.finished":
			_handle_cutscene_finished(payload)
		"cutscene.skipped":
			_handle_cutscene_skipped(payload)

# ==============================================================================
# 四、具体消费处理逻辑
# ==============================================================================

func _handle_cutscene_started(payload: Dictionary) -> void:
	_current_cutscene_id = str(payload.get("cutscene_id", ""))
	_is_placeholder_active = bool(payload.get("is_placeholder", false))

	var view := _resolve_or_create_view()
	if view == null:
		return

	var stream := _acquire_media_resource(str(payload.get("video_path", "")))
	view.play_stream(stream, payload)

	presentation_started.emit(_current_cutscene_id, _is_placeholder_active)

func _handle_cutscene_progress(payload: Dictionary) -> void:
	var view := get_active_view()
	if view == null:
		return

	var cur_time: float = float(payload.get("current_time", 0.0))
	var progress: float = float(payload.get("progress", 0.0))
	var subtitle: String = str(payload.get("subtitle", ""))

	view.apply_snapshot({
		"cutscene_id": _current_cutscene_id,
		"current_time_sec": cur_time,
		"progress_ratio": progress,
		"active_subtitle_text": subtitle
	})

	presentation_progress.emit(cur_time, progress, subtitle)

func _handle_cutscene_finished(payload: Dictionary) -> void:
	var view := get_active_view()
	var fade_out_sec: float = float(payload.get("fade_out_sec", 0.5))
	if view != null:
		view.stop_and_dismiss(fade_out_sec)

	var cs_id := _current_cutscene_id
	_current_cutscene_id = ""
	presentation_finished.emit(cs_id)

func _handle_cutscene_skipped(payload: Dictionary) -> void:
	var view := get_active_view()
	var fade_out_sec: float = float(payload.get("fade_out_sec", 0.5))
	if view != null:
		view.stop_and_dismiss(fade_out_sec)

	var cs_id := _current_cutscene_id
	_current_cutscene_id = ""
	presentation_skipped.emit(cs_id)

func _resolve_or_create_view() -> CutscenePlayerView:
	var view := get_active_view()
	if view != null:
		return view

	if _host_ref != null and _host_ref.get_ref() != null:
		var host: Control = _host_ref.get_ref() as Control
		_dynamic_view = CutscenePlayerViewClass.new()
		host.add_child(_dynamic_view)
		_connect_view_signals(_dynamic_view)
		return _dynamic_view

	return null

func _acquire_media_resource(path: String) -> Resource:
	if path.is_empty():
		return null
	var loader := CutsceneAsyncLoader.get_instance()
	if loader != null and loader.is_resource_ready(path):
		return loader.get_loaded_resource(path)
	if ResourceLoader.has_cached(path):
		return ResourceLoader.load(path)
	return null

# ==============================================================================
# 五、视口信号反向反馈闭环
# ==============================================================================

func _on_view_playback_finished() -> void:
	var orch := CutsceneOrchestrator.get_instance()
	if orch != null:
		orch.finish_cutscene()

func _on_view_skip_requested() -> void:
	var orch := CutsceneOrchestrator.get_instance()
	if orch != null:
		orch.skip_cutscene()
