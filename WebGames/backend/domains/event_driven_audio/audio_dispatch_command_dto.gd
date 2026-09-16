# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/event_driven_audio/audio_dispatch_command_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/event_driven_audio.json | 信号: EventBus 领域广播
# 职责说明: 封装四轨总线类型、音量/音高微调、空间坐标与声学衰减参数的调度命令； 命令默认值由 config/domains/event_driven_audio.json 的 command_defaults 段驱动。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name AudioDispatchCommandDTO
extends RefCounted

# ==============================================================================
# 一、默认常量与总线轨枚举
# ==============================================================================

## 默认最大可听半径（米；command_defaults/max_audible_distance 缺省兜底）
const DEFAULT_MAX_AUDIBLE_DISTANCE: float = 20.0
## 默认音量缩放（1.0 = 原音量）
const DEFAULT_VOLUME_SCALE: float = 1.0
## 默认音高缩放（1.0 = 原音高）
const DEFAULT_PITCH_SCALE: float = 1.0
## 默认交叉淡入淡出时长（秒；0 = 无淡入淡出）
const DEFAULT_FADE_DURATION: float = 0.0

## 四轨音频总线（BGM 背景音乐 / BGS 背景音效 / SE 音效 / ME 音乐事件）
enum AudioBusTrack { BGM, BGS, SE, ME }

# ==============================================================================
# 二、命令字段（config/domains/event_driven_audio.json 驱动）
# ==============================================================================

## 音效 ID（如 "sfx_sword_slash_heavy"，并发限流计数键）
var sound_id: String = ""                   # 如 "sfx_sword_slash_heavy"
## 目标总线轨（默认 SE 音效）
var bus_track: AudioBusTrack = AudioBusTrack.SE
## 音量缩放（0.0 ~ 1.0，配置缺省 DEFAULT_VOLUME_SCALE）
var volume_scale: float = GameConfig.get_float("domains.event_driven_audio", "command_defaults/volume_scale", DEFAULT_VOLUME_SCALE)               # 0.0 ~ 1.0
## 音高微调（防机械单调，配置缺省 DEFAULT_PITCH_SCALE）
var pitch_scale: float = GameConfig.get_float("domains.event_driven_audio", "command_defaults/pitch_scale", DEFAULT_PITCH_SCALE)                # 音高微调 (防机械单调)
## 是否具备空间衰减（false = 非空间音，恒可听）
var is_spatial: bool = false                # 是否具备空间衰减
## 空间音源坐标（is_spatial 为 true 时生效）
var source_pos: Vector2 = Vector2.ZERO      # 空间音源坐标
## 最大可听半径（米；超过即禁播防爆音）
var max_audible_distance: float = GameConfig.get_float("domains.event_driven_audio", "command_defaults/max_audible_distance", DEFAULT_MAX_AUDIBLE_DISTANCE)      # 最大可听半径 (米)
## 交叉淡入淡出时长（秒）
var fade_duration_seconds: float = GameConfig.get_float("domains.event_driven_audio", "command_defaults/fade_duration_seconds", DEFAULT_FADE_DURATION)      # 交叉淡入淡出时长

# ==============================================================================
# 三、构造
# ==============================================================================

## 音频调度命令构造（ID/总线轨/音量/音高/空间坐标/可听半径）
func _init(
	p_id: String = "",
	p_track: AudioBusTrack = AudioBusTrack.SE,
	p_vol: float = DEFAULT_VOLUME_SCALE,
	p_pitch: float = DEFAULT_PITCH_SCALE,
	p_spatial: bool = false,
	p_pos: Vector2 = Vector2.ZERO,
	p_max_dist: float = DEFAULT_MAX_AUDIBLE_DISTANCE
) -> void:
	sound_id = p_id
	bus_track = p_track
	volume_scale = p_vol
	pitch_scale = p_pitch
	is_spatial = p_spatial
	source_pos = p_pos
	max_audible_distance = p_max_dist
