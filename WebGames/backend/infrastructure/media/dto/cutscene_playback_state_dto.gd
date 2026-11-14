# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 媒体与全域CG动画 (Media & Cutscene))
# 文件路径: res://backend/infrastructure/media/dto/cutscene_playback_state_dto.gd
# 架构定位: Infrastructure Data Transfer Object (DTO) / Playback State Snapshot
# 依赖与触发: 上游: CutsceneOrchestrator | 下游: CutscenePlayerView, CutscenePresenter
# 职责说明: 表达 CG 视频播放器运行时的实时状态快照，供表现层单向注入并解耦轮询；
#           涵盖加载、缓冲、播放中、暂停、跳过与完结全生命周期状态及时间轴进度。
# 退出语义与设计依据: 状态机单向投影与零瞬态分配快照规约 (Inv-VIEW-INJECTION-1)
# ==============================================================================

## CutscenePlaybackStateDTO：视频播放实时状态快照模型
class_name CutscenePlaybackStateDTO
extends RefCounted

# ==============================================================================
# 一、播放状态枚举定义
# ==============================================================================

enum PlaybackState {
	IDLE = 0,        ## 空闲未激活
	PRELOADING = 1,  ## 正在后台流式预加载
	BUFFERING = 2,   ## 前台就绪缓冲态（展示黑屏/微弱等待）
	PLAYING = 3,     ## 正在解码播放
	PAUSED = 4,      ## 已暂停
	FINISHED = 5,    ## 自然播放完结
	SKIPPED = 6,     ## 玩家主动跳过
	FAILED = 7       ## 异常失败退出
}

# ==============================================================================
# 二、核心状态属性
# ==============================================================================

var state: int = PlaybackState.IDLE
var cutscene_id: String = ""
var current_time_sec: float = 0.0
var total_duration_sec: float = 0.0
var progress_ratio: float = 0.0
var active_subtitle_text: String = ""
var error_message: String = ""

# ==============================================================================
# 三、序列化与装配
# ==============================================================================

## 序列化为实时播放状态字典快照
func to_dict() -> Dictionary:
	return {
		"state": state,
		"cutscene_id": cutscene_id,
		"current_time_sec": current_time_sec,
		"total_duration_sec": total_duration_sec,
		"progress_ratio": progress_ratio,
		"active_subtitle_text": active_subtitle_text,
		"error_message": error_message
	}

## 从输入字典安全反序列化并装配播放状态快照 DTO
static func from_dict(data: Dictionary) -> CutscenePlaybackStateDTO:
	var snapshot := CutscenePlaybackStateDTO.new()
	if data.is_empty():
		return snapshot

	snapshot.state = int(data.get("state", PlaybackState.IDLE))
	snapshot.cutscene_id = str(data.get("cutscene_id", ""))
	snapshot.current_time_sec = float(data.get("current_time_sec", 0.0))
	snapshot.total_duration_sec = float(data.get("total_duration_sec", 0.0))
	snapshot.progress_ratio = float(data.get("progress_ratio", 0.0))
	snapshot.active_subtitle_text = str(data.get("active_subtitle_text", ""))
	snapshot.error_message = str(data.get("error_message", ""))
	return snapshot
