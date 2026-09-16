# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/event_driven_audio/audio_bus_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/event_driven_audio.json | 信号: EventBus 领域广播
# 职责说明: 监听全域战斗/剧情事件，限制同类音频并发播放路数（Polyphony Limiter）， 按总线轨映射音量并委托 SpatialAudioSolver 做空间声学求值； 并发上限/总线轨映射/默认音量由 config/domains/event_driven_audio.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name AudioBusPipeline
extends RefCounted

# ==============================================================================
# 一、并发水位释放（计数配对）
# ==============================================================================

## L9-a（Phase 53）并发水位显式释放路径（Inv-ON-4）：与 dispatch 的 +1 计数配对——
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
	cmd: AudioDispatchCommandDTO,
	listener_pos: Vector2,
	bus_volumes: Dictionary,
	max_concurrency_per_sound: int = -1
) -> Dictionary:
	var cfg_max := GameConfig.get_int("domains.event_driven_audio", "concurrency/max_per_sound", 4)
	var max_conc := max_concurrency_per_sound if max_concurrency_per_sound >= 0 else cfg_max
	var current_playing = active_sound_counts.get(cmd.sound_id, 0)
	if current_playing >= max_conc:
		return {
			"dispatched": false,
			"reason": "CONCURRENCY_LIMIT_REACHED"
		}

	var bus_key := GameConfig.get_string("domains.event_driven_audio", "bus/default", "SE")
	var tracks: Dictionary = GameConfig.get_dict("domains.event_driven_audio", "bus/tracks", {})
	match cmd.bus_track:
		AudioDispatchCommandDTO.AudioBusTrack.BGM: bus_key = tracks.get("BGM", "BGM")
		AudioDispatchCommandDTO.AudioBusTrack.BGS: bus_key = tracks.get("BGS", "BGS")
		AudioDispatchCommandDTO.AudioBusTrack.ME: bus_key = tracks.get("ME", "ME")

	var track_master_vol: float = bus_volumes.get(bus_key, 1.0)
	var eval_res = SpatialAudioSolver.evaluate_spatial_audio(cmd, listener_pos, track_master_vol)

	if eval_res.play:
		active_sound_counts[cmd.sound_id] = current_playing + 1
		return {
			"dispatched": true,
			"sound_id": cmd.sound_id,
			"bus_track": bus_key,
			"volume": eval_res.effective_volume,
			"pan": eval_res.pan
		}

	return { "dispatched": false, "reason": "OUT_OF_AUDIBLE_RANGE" }
