# ==============================================================================
# 模块归属: Frontend / UIInfrastructure
# 文件路径: res://frontend/ui_infrastructure/ui_audio_bridge.gd
# 架构定位: UI 基础设施音效信号桥接器，解耦交互控件事件与底层音频播放器
# 依赖与触发: 纯信号发布中枢，由 UI 组件调用触发并由音频系统统一订阅播放
# 职责说明: 统一解耦 UI 交互动作与底层音频播放器，避免组件侵入式寻找音频节点
# 退出语义与设计依据: 无状态单例通过信号单向广播音效请求；未绑定音频监听者时静默空发且无副作用
# ==============================================================================
## UIAudioBridge：全局 UI 音效路由桥接器，提供标准化的交互音效触发与 MOD 音频流异步解码接口
class_name UIAudioBridge
extends RefCounted

const AudioBusPipelineClass = preload("res://backend/domains/event_driven_audio/audio_bus_pipeline.gd")

enum UISfxType {
	HOVER,
	CLICK,
	SUCCESS,
	WARN,
	ERROR,
	MODAL_OPEN,
	MODAL_CLOSE
}

signal play_sfx(sfx_type: UISfxType, volume_db: float)
signal play_stream(sound_id: String, stream: AudioStream, bus_name: String, volume_db: float)

static var _instance: UIAudioBridge
## 获取全局 UI 音效桥接器单例
static func get_instance() -> UIAudioBridge:
	if _instance == null:
		_instance = UIAudioBridge.new()
	return _instance

## 重置全局 UI 音效桥接器静态单例
static func reset_instance() -> void:
	_instance = null

## 通过 CutsceneAsyncLoader 异步解码 MOD/本地音频流并触发 play_stream 信号
func play_mod_audio_async(
	sound_id: String,
	resource_path: String = "",
	bus_name: String = "SE",
	volume_db: float = 0.0
) -> int:
	return AudioBusPipelineClass.request_mod_audio_stream_async(
		sound_id,
		resource_path,
		func(loaded_resource: Resource) -> void:
			if loaded_resource is AudioStream:
				play_stream.emit(sound_id, loaded_resource as AudioStream, bus_name, volume_db),
		1
	)

## 触发悬停音效信号
func play_hover(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.HOVER, volume_db)

## 触发点击音效信号
func play_click(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.CLICK, volume_db)

## 触发操作成功音效信号
func play_success(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.SUCCESS, volume_db)

## 触发操作警告音效信号
func play_warn(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.WARN, volume_db)

## 触发操作错误音效信号
func play_error(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.ERROR, volume_db)

## 触发弹窗打开音效信号
func play_modal_open(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.MODAL_OPEN, volume_db)

## 触发弹窗关闭音效信号
func play_modal_close(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.MODAL_CLOSE, volume_db)
