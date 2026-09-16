# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/hardware_input/tab_double_tap_detector.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/hardware_input.json | 信号: EventBus 领域广播
# 职责说明: 硬件级监测 Tab 键连按节奏，区分「单击 / 双击」（双击窗口期可配置）， 供聊天命令智能补全联动使用；窗口期由 config/domains/hardware_input.json 的 tab_double_tap/window_ms 驱动。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name TabDoubleTapDetector
extends RefCounted

const TAB_KEY_CODE: String = "Key_Tab"

var _last_tab_timestamp_ms: int = -1

## 喂入一次按键事件，返回组合判定：
##   { is_tab, is_single_tap, is_double_tap }
## - 非 Tab 键：重置连按状态（中断节奏）并返回 is_tab=false；
## - Tab 键：与上次 Tab 间隔 ≤ 窗口期 -> 双击；否则记为首次单击。
func feed_key_press(key_code: String, timestamp_msec: int) -> Dictionary:
	if key_code != TAB_KEY_CODE:
		_last_tab_timestamp_ms = -1
		return { "is_tab": false, "is_single_tap": false, "is_double_tap": false }

	var window_ms: int = GameConfig.get_int("domains.hardware_input", "tab_double_tap/window_ms", 300)
	if _last_tab_timestamp_ms >= 0 and (timestamp_msec - _last_tab_timestamp_ms) <= window_ms:
		_last_tab_timestamp_ms = -1
		return { "is_tab": true, "is_single_tap": false, "is_double_tap": true }

	_last_tab_timestamp_ms = timestamp_msec
	return { "is_tab": true, "is_single_tap": true, "is_double_tap": false }

## 重置连按状态（切换输入框/失焦等场景调用）
func reset() -> void:
	_last_tab_timestamp_ms = -1
