# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 媒体与全域CG动画 (Media & Cutscene))
# 文件路径: res://backend/infrastructure/media/dto/cutscene_request_dto.gd
# 架构定位: Infrastructure Data Transfer Object (DTO) / Invocation Envelope
# 依赖与触发: 上游: CutsceneHookRegistry, NarrativeDag, QuestCausality | 下游: CutsceneOrchestrator, CutscenePlayerView
# 职责说明: 封装跨域播放视频/CG的强类型请求信封；承载跳过阈值、音量、音频总线、淡入淡出、字幕轨及回调；
#           彻底解耦剧情与媒体实现，杜绝任何剧情脚本内的物理路径与播放器硬编码；
#           天然支持早期无艺术资源下的文字演播回退（Text Presentation Fallback）与主线程通用调度。
# 退出语义与设计依据: 业务领域第一性原理与参数化请求信封契约 (Inv-REENTRANT-DTO-3)
# ==============================================================================

## CutsceneRequestDTO：CG 与视频播放参数化调用信封模型
class_name CutsceneRequestDTO
extends RefCounted

# ==============================================================================
# 一、核心属性字段定义
# ==============================================================================

## 唯一 CG/视频语义标识符（对应配置表注册项，如 "cs_act1_awakening"）
var cutscene_id: String = ""

## 资源物理路径（若为空或无物理文件则自动回退至文字演播）
var video_path: String = ""

## 是否处于文字回退演播状态（默认 false，若物理文件不存在可自动激活）
var is_placeholder: bool = false

## 演播回退演示标题（如 "序幕觉醒" 或配置文案键）
var placeholder_title: String = ""

## 演播回退剧本文本（无真实艺术视频时的文字演播内容）
var placeholder_text: String = ""

## 演示播放总时长（秒；文字演播或无文件时自动按此时长倒计时完结）
var duration_sec: float = 3.0

## 跳过提示文案（如 "[ESC / Space] 跳过"；留空则由视口动态格式化）
var skip_prompt_text: String = ""

## 是否允许玩家主动跳过
var skippable: bool = true

## 跳过确认阈值（如需长按 0.3s 或连续确认防误触；0.0 为秒跳）
var skip_hold_duration_sec: float = 0.3

## 绑定的字幕轨语言键（通过 i18n 统一文案中心解析，如 "cutscene.act1_awakening.subtitles"）
var subtitles_track_id: String = ""

## 输出音频总线轨道（"Master", "BGM", "Cutscene" 等）
var audio_bus: String = "BGM"

## 目标音量线性比率（0.0 ~ 1.0）
var volume_linear: float = 1.0

## 黑屏淡入过渡耗时（秒）
var fade_in_sec: float = 0.5

## 黑屏淡出恢复耗时（秒）
var fade_out_sec: float = 0.5

## 播放期间是否自动挂起世界循环与物理模拟
var auto_pause_world: bool = true

## 播放期间是否自动隐藏主界面 HUD
var hide_hud: bool = true

## 是否仅在首档/首次遇到时播放（若为 true 且已有存盘记录则自动静默放行）
var play_once_per_save: bool = false

## 预加载优先级（0=CRITICAL, 1=HIGH, 2=NORMAL）
var preload_priority: int = 1

## 播放完成后的业务回调（Callable）
var on_completed: Callable = Callable()

## 玩家主动跳过时的专属回调（Callable）
var on_skipped: Callable = Callable()

## 透传业务上下文载荷（保持无状态与可重入）
var context_payload: Dictionary = {}

# ==============================================================================
# 二、序列化与深拷贝接口
# ==============================================================================

## 序列化为纯数据字典
func to_dict() -> Dictionary:
	return {
		"cutscene_id": cutscene_id,
		"video_path": video_path,
		"is_placeholder": is_placeholder,
		"placeholder_title": placeholder_title,
		"placeholder_text": placeholder_text,
		"duration_sec": duration_sec,
		"skip_prompt_text": skip_prompt_text,
		"skippable": skippable,
		"skip_hold_duration_sec": skip_hold_duration_sec,
		"subtitles_track_id": subtitles_track_id,
		"audio_bus": audio_bus,
		"volume_linear": volume_linear,
		"fade_in_sec": fade_in_sec,
		"fade_out_sec": fade_out_sec,
		"auto_pause_world": auto_pause_world,
		"hide_hud": hide_hud,
		"play_once_per_save": play_once_per_save,
		"preload_priority": preload_priority,
		"context_payload": context_payload.duplicate(true)
	}

## 从字典还原装配 DTO 实例
static func from_dict(data: Dictionary) -> CutsceneRequestDTO:
	var request_dto := CutsceneRequestDTO.new()
	if data.is_empty():
		return request_dto

	request_dto.cutscene_id = str(data.get("cutscene_id", ""))
	request_dto.video_path = str(data.get("video_path", ""))
	request_dto.is_placeholder = bool(data.get("is_placeholder", false))
	request_dto.placeholder_title = str(data.get("placeholder_title", ""))
	request_dto.placeholder_text = str(data.get("placeholder_text", ""))
	request_dto.duration_sec = float(data.get("duration_sec", 3.0))
	request_dto.skip_prompt_text = str(data.get("skip_prompt_text", ""))
	request_dto.skippable = bool(data.get("skippable", true))
	request_dto.skip_hold_duration_sec = float(data.get("skip_hold_duration_sec", 0.3))
	request_dto.subtitles_track_id = str(data.get("subtitles_track_id", ""))
	request_dto.audio_bus = str(data.get("audio_bus", "BGM"))
	request_dto.volume_linear = float(data.get("volume_linear", 1.0))
	request_dto.fade_in_sec = float(data.get("fade_in_sec", 0.5))
	request_dto.fade_out_sec = float(data.get("fade_out_sec", 0.5))
	request_dto.auto_pause_world = bool(data.get("auto_pause_world", true))
	request_dto.hide_hud = bool(data.get("hide_hud", true))
	request_dto.play_once_per_save = bool(data.get("play_once_per_save", false))
	request_dto.preload_priority = int(data.get("preload_priority", 1))

	var raw_context: Variant = data.get("context_payload", {})
	if raw_context is Dictionary:
		request_dto.context_payload = (raw_context as Dictionary).duplicate(true)

	return request_dto

## 深拷贝当前请求实例
func duplicate_request() -> CutsceneRequestDTO:
	var duplicated_request := CutsceneRequestDTO.from_dict(to_dict())
	duplicated_request.on_completed = on_completed
	duplicated_request.on_skipped = on_skipped
	return duplicated_request
