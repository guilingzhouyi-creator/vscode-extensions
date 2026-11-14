# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 媒体与全域CG动画 (Media & Cutscene))
# 文件路径: res://backend/infrastructure/media/cutscene_orchestrator.gd
# 架构定位: Playback Lifecycle Orchestrator / Headless FSM Coordinator
# 依赖与触发: 上游: NarrativeDag, QuestCausality, CutsceneHookRegistry | 下游: CutsceneAsyncLoader, EventBusCore, Presenter
# 职责说明: 编排 CG 视频播放全生命周期状态跃迁（缓冲、解码、文字演播、字幕同步、跳过、完结）；
#           向全域广播强类型事件（cutscene.started / finished / skipped），
#           并协调恢复被挂起的剧情主流程，支持主线程一键调用与无头自动化测试的确定性步进仿真。
# 退出语义与设计依据: 状态机单向流转与可重入安全编排规约 (Inv-REENTRANT-DTO-3)
# ==============================================================================

## CutsceneOrchestrator：CG 视频播放调度与状态机编排引擎
class_name CutsceneOrchestrator
extends RefCounted

const CutsceneRequestDTOClass = preload("res://backend/infrastructure/media/dto/cutscene_request_dto.gd")
const CutscenePlaybackStateDTOClass = preload("res://backend/infrastructure/media/dto/cutscene_playback_state_dto.gd")
const CutsceneManifestDTOClass = preload("res://backend/infrastructure/media/dto/cutscene_manifest_dto.gd")
const CutsceneAsyncLoaderClass = preload("res://backend/infrastructure/media/cutscene_async_loader.gd")
const CutsceneHookRegistryClass = preload("res://backend/infrastructure/media/cutscene_hook_registry.gd")
const EventBusCoreClass = preload("res://backend/infrastructure/event_bus/event_bus_core.gd")
const AssetPathResolverClass = preload("res://backend/infrastructure/resource_governance/asset_path_resolver.gd")

static var _instance: CutsceneOrchestrator = null

var _current_state: CutscenePlaybackStateDTO = null
var _active_request: CutsceneRequestDTO = null

# ==============================================================================
# 一、单例与状态初始化
# ==============================================================================

## 获取过场播放编排器进程级单例
static func get_instance() -> CutsceneOrchestrator:
	if _instance == null:
		_instance = CutsceneOrchestrator.new()
	return _instance

func _init() -> void:
	_current_state = CutscenePlaybackStateDTOClass.new()
	_current_state.state = CutscenePlaybackStateDTOClass.PlaybackState.IDLE

## 获取当前过场播放实时状态快照 DTO
func get_playback_state() -> CutscenePlaybackStateDTO:
	return _current_state

## 查询当前是否处于过场缓冲或播放进行中
func is_playing() -> bool:
	return _current_state.state == CutscenePlaybackStateDTOClass.PlaybackState.PLAYING \
		or _current_state.state == CutscenePlaybackStateDTOClass.PlaybackState.BUFFERING

# ==============================================================================
# 二、主线程核心播放调度 API
# ==============================================================================

## 通过 CG 语义标识符快速播放（主线程一键调用入口，形参 <= 5）
func play_by_id(cutscene_id: String, override_parameters: Dictionary = {}) -> Dictionary:
	var registry := CutsceneHookRegistryClass.get_instance()
	var request := registry.resolve_request(cutscene_id, override_parameters)
	if request == null:
		return {"success": false, "error_code": "RESOLVE_FAILED"}
	return play_cutscene(request)

## 通过通用字典解析并播放（纯通用解析入口，支持 MOD/网络/动态配置派发）
func parse_and_play(payload: Dictionary) -> Dictionary:
	var request := CutsceneRequestDTOClass.from_dict(payload)
	return play_cutscene(request)

## 启动播放流程（支持参数化请求信封与文字演播优雅降级）
func play_cutscene(request: CutsceneRequestDTO) -> Dictionary:
	if request == null or request.cutscene_id.is_empty():
		return {"success": false, "error_code": "INVALID_REQUEST"}

	if is_playing():
		return {"success": false, "error_code": "CUTSCENE_ALREADY_PLAYING"}

	# 拷贝请求信封后再用 manifest 补全，避免修改调用方持有的原始 DTO 实例
	_active_request = request.duplicate_request()

	_enrich_request_from_manifest(_active_request)

	if not _active_request.video_path.is_empty():
		_active_request.video_path = AssetPathResolverClass.resolve_unified_uri(_active_request.video_path)

	var has_physical_asset: bool = not _active_request.video_path.is_empty() and AssetPathResolverClass.asset_exists(_active_request.video_path)
	if not has_physical_asset:
		_active_request.is_placeholder = true

	var effective_duration: float = _active_request.duration_sec if _active_request.duration_sec > 0.0 else 3.0
	_prepare_playback_state(_active_request, effective_duration)

	_trigger_resource_buffering(_active_request, has_physical_asset)

	_broadcast_playback_started(_active_request, effective_duration)

	return {
		"success": true,
		"cutscene_id": _active_request.cutscene_id,
		"state": _current_state.state,
		"is_placeholder": _active_request.is_placeholder,
		"duration_sec": effective_duration
	}

func _enrich_request_from_manifest(request: CutsceneRequestDTO) -> void:
	var registry := CutsceneHookRegistryClass.get_instance()
	var manifest: CutsceneManifestDTO = registry.get_manifest(request.cutscene_id)
	if manifest == null:
		return

	if request.video_path.is_empty() and not manifest.video_resource_path.is_empty():
		request.video_path = AssetPathResolverClass.resolve_unified_uri(manifest.video_resource_path, manifest.mod_id)
	if request.placeholder_title.is_empty():
		request.placeholder_title = manifest.placeholder_title if not manifest.placeholder_title.is_empty() else manifest.title_key
	if request.placeholder_text.is_empty():
		request.placeholder_text = manifest.placeholder_text
	if request.duration_sec <= 0.0 or is_equal_approx(request.duration_sec, 3.0):
		if manifest.duration_sec > 0.0:
			request.duration_sec = manifest.duration_sec
	if manifest.is_placeholder:
		request.is_placeholder = true

func _prepare_playback_state(request: CutsceneRequestDTO, duration: float) -> void:
	_current_state.cutscene_id = request.cutscene_id
	_current_state.current_time_sec = 0.0
	_current_state.total_duration_sec = duration
	_current_state.progress_ratio = 0.0
	_current_state.active_subtitle_text = ""
	_current_state.error_message = ""

	if request.play_once_per_save:
		CutsceneHookRegistryClass.get_instance().mark_cutscene_viewed(request.cutscene_id)

func _trigger_resource_buffering(request: CutsceneRequestDTO, has_physical_asset: bool) -> void:
	var loader := CutsceneAsyncLoaderClass.get_instance()
	if has_physical_asset and not loader.is_resource_ready(request.video_path):
		_current_state.state = CutscenePlaybackStateDTOClass.PlaybackState.BUFFERING
		loader.request_load(request.video_path, request.preload_priority, func(_loaded_resource: Resource):
			if _current_state.state == CutscenePlaybackStateDTOClass.PlaybackState.BUFFERING:
				_current_state.state = CutscenePlaybackStateDTOClass.PlaybackState.PLAYING
		)
	else:
		_current_state.state = CutscenePlaybackStateDTOClass.PlaybackState.PLAYING

func _broadcast_playback_started(request: CutsceneRequestDTO, duration: float) -> void:
	_notify_event("cutscene.started", {
		"cutscene_id": request.cutscene_id,
		"video_path": request.video_path,
		"is_placeholder": request.is_placeholder,
		"placeholder_title": request.placeholder_title if not request.placeholder_title.is_empty() else request.cutscene_id,
		"placeholder_text": request.placeholder_text,
		"duration_sec": duration,
		"skip_prompt_text": request.skip_prompt_text,
		"skippable": request.skippable,
		"skip_hold_duration_sec": request.skip_hold_duration_sec,
		"audio_bus": request.audio_bus,
		"volume_linear": request.volume_linear,
		"fade_in_sec": request.fade_in_sec,
		"fade_out_sec": request.fade_out_sec,
		"auto_pause_world": request.auto_pause_world,
		"hide_hud": request.hide_hud
	})

# ==============================================================================
# 三、进度推进与生命周期结束处理
# ==============================================================================

## 推进更新播放进度（由前端表现层或无头测试时钟驱动）
func update_playback_progress(current_time: float, total_duration: float, subtitle_text: String = "") -> void:
	if _current_state.state != CutscenePlaybackStateDTOClass.PlaybackState.PLAYING:
		return

	_current_state.current_time_sec = current_time
	_current_state.total_duration_sec = total_duration
	_current_state.progress_ratio = (current_time / maxf(0.001, total_duration)) if total_duration > 0.0 else 0.0
	_current_state.active_subtitle_text = subtitle_text

	_notify_event("cutscene.playback_progress", {
		"cutscene_id": _current_state.cutscene_id,
		"current_time": current_time,
		"progress": _current_state.progress_ratio,
		"subtitle": subtitle_text
	})

## 正常自然播放完结
func finish_cutscene() -> void:
	if not is_playing():
		return

	_current_state.state = CutscenePlaybackStateDTOClass.PlaybackState.FINISHED
	var completed_request := _active_request

	_notify_event("cutscene.finished", {
		"cutscene_id": _current_state.cutscene_id,
		"context_payload": completed_request.context_payload if completed_request != null else {}
	})

	# 触发业务完成回调
	if completed_request != null and completed_request.on_completed.is_valid():
		completed_request.on_completed.call()

	_cleanup_active()

## 玩家主动触发跳过
func skip_cutscene() -> bool:
	if not is_playing() or _active_request == null:
		return false

	if not _active_request.skippable:
		return false

	_current_state.state = CutscenePlaybackStateDTOClass.PlaybackState.SKIPPED
	var skipped_request := _active_request

	_notify_event("cutscene.skipped", {
		"cutscene_id": _current_state.cutscene_id,
		"skip_time": _current_state.current_time_sec,
		"context_payload": skipped_request.context_payload
	})

	# 优先触发专属跳过回调，若无则回退调用 on_completed 保证业务流程不悬挂
	if skipped_request.on_skipped.is_valid():
		skipped_request.on_skipped.call()
	elif skipped_request.on_completed.is_valid():
		skipped_request.on_completed.call()

	_cleanup_active()
	return true

## 确定性时间步进仿真（供无头单元测试调度）
func step_simulation(delta_seconds: float) -> void:
	if _current_state.state != CutscenePlaybackStateDTOClass.PlaybackState.PLAYING:
		return

	var new_time: float = _current_state.current_time_sec + delta_seconds
	var duration: float = maxf(0.1, _current_state.total_duration_sec)
	if new_time >= duration:
		finish_cutscene()
	else:
		update_playback_progress(new_time, duration, _current_state.active_subtitle_text)

func _cleanup_active() -> void:
	_active_request = null
	_current_state.state = CutscenePlaybackStateDTOClass.PlaybackState.IDLE

func _notify_event(event_name: String, payload: Dictionary) -> void:
	var bus: EventBusCore = EventBusCoreClass.get_instance()
	if bus != null:
		bus.emit_domain_event(event_name, payload)
