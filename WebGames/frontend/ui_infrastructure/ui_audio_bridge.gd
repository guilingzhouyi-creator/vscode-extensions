# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - UI基础设施: 全局UI音效路由桥接器
# 文件路径: res://frontend/ui_infrastructure/ui_audio_bridge.gd
# 职责: 统一解耦 UI 交互动作与底层音频播放器，避免组件侵入式寻找音频节点
# ==============================================================================
class_name UIAudioBridge
extends RefCounted

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

static var _instance: UIAudioBridge
static func get_instance() -> UIAudioBridge:
	if _instance == null:
		_instance = load("res://frontend/ui_infrastructure/ui_audio_bridge.gd").new()
	return _instance

func play_hover(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.HOVER, volume_db)

func play_click(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.CLICK, volume_db)

func play_success(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.SUCCESS, volume_db)

func play_warn(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.WARN, volume_db)

func play_error(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.ERROR, volume_db)

func play_modal_open(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.MODAL_OPEN, volume_db)

func play_modal_close(volume_db: float = 0.0) -> void:
	play_sfx.emit(UISfxType.MODAL_CLOSE, volume_db)
