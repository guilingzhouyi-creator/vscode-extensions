# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/event_driven_audio/audio_bus_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/event_driven_audio.json | 信号: EventBus 领域广播
# 职责说明: 监听全域战斗/剧情事件，限制同类音频并发播放路数（Polyphony Limiter）， 按总线轨映射音量并委托 SpatialAudioSolver 做空间声学求值； 并发上限/总线轨映射/默认音量由 config/domains/event_driven_audio.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AudioBusPipeline：Business Pipeline / Transaction Safe Orchestrator
class_name AudioBusPipeline
extends RefCounted

# ==============================================================================
# 一、并发水位释放与资源 URI 解析
# ==============================================================================

## 解析音效资源统一 URI（优先显式路径，其次读取 domains.event_driven_audio/sound_registry）
static func resolve_mod_audio_uri(sound_id: String, explicit_uri: String = "") -> String:
	var candidate := explicit_uri.strip_edges()
	if candidate.is_empty() and not sound_id.is_empty():
		var sound_registry: Dictionary = GameConfig.get_dict("domains.event_driven_audio", "sound_registry", {})
		var registry_entry: Variant = sound_registry.get(sound_id, "")
		if registry_entry is Dictionary:
			var sound_entry_mapping := registry_entry as Dictionary
			candidate = str(sound_entry_mapping.get("uri", sound_entry_mapping.get("path", ""))).strip_edges()
		elif registry_entry is String:
			candidate = str(registry_entry).strip_edges()
	return candidate

## 并发水位显式释放路径（Inv-ON-4）：与 dispatch 的 +1 计数配对——
## 播放宿主在音频自然结束/截停时经生命周期事件回传调用；归零删键（防 0 值堆积）、永不 < 0。
static func release_sound_instance(active_sound_counts: Dictionary, sound_id: String) -> void:
	if sound_id.is_empty():
		return
	var current: int = active_sound_counts.get(sound_id, 0)
	if current <= 1:
		active_sound_counts.erase(sound_id)
	else:
		active_sound_counts[sound_id] = current - 1

# ==============================================================================
# 二、音频事件分发（并发限流 + 总线映射 + 空间求值）
# ==============================================================================

## 音频调度命令分发：并发限流 → 总线轨映射音量 → 空间声学求值 → 计数 +1。
## 契约：同类并发达上限返回 CONCURRENCY_LIMIT_REACHED（不计数）；超出可听半径返回
##       OUT_OF_AUDIBLE_RANGE；成功返回 { dispatched, sound_id, bus_track, volume, pan }。
## 性能：常量级判定，无循环；active_sound_counts 为调用方持有字典。
static func dispatch_sound_event(
	active_sound_counts: Dictionary,
	command: AudioDispatchCommandDTO,
	listener_position: Vector2,
	bus_volumes: Dictionary,
	max_concurrency_per_sound: int = -1
) -> Dictionary:
	var configured_max_concurrency := GameConfig.get_int("domains.event_driven_audio", "concurrency/max_per_sound", 4)
	var max_concurrency := max_concurrency_per_sound if max_concurrency_per_sound >= 0 else configured_max_concurrency
	var current_playing: Variant = active_sound_counts.get(command.sound_id, 0)
	if current_playing >= max_concurrency:
		return {
			"dispatched": false,
			"reason": "CONCURRENCY_LIMIT_REACHED"
		}

	var bus_key := GameConfig.get_string("domains.event_driven_audio", "bus/default", "SE")
	var tracks: Dictionary = GameConfig.get_dict("domains.event_driven_audio", "bus/tracks", {})
	match command.bus_track:
		AudioDispatchCommandDTO.AudioBusTrack.BGM: bus_key = tracks.get("BGM", "BGM")
		AudioDispatchCommandDTO.AudioBusTrack.BGS: bus_key = tracks.get("BGS", "BGS")
		AudioDispatchCommandDTO.AudioBusTrack.ME: bus_key = tracks.get("ME", "ME")

	var track_master_volume: float = bus_volumes.get(bus_key, 1.0)
	var evaluation_result: Variant = SpatialAudioSolver.evaluate_spatial_audio(command, listener_position, track_master_volume)

	if evaluation_result.play:
		active_sound_counts[command.sound_id] = current_playing + 1
		return {
			"dispatched": true,
			"sound_id": command.sound_id,
			"bus_track": bus_key,
			"volume": evaluation_result.effective_volume,
			"pan": evaluation_result.pan
		}

	return { "dispatched": false, "reason": "OUT_OF_AUDIBLE_RANGE" }
