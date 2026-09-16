# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/game_settings/settings_apply_driver.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/game_settings.json | 信号: EventBus 领域广播
# 职责说明: 校验音画配置合法性、即时热应用参数、提供 15 秒黑屏安全回滚机制
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name SettingsApplyDriver
extends RefCounted

var is_pending_confirm: bool = false
var pending_revert_timer: float = 0.0
var backup_settings_snapshot: Dictionary = {}

## 合法性校验与清洗：音量/UI 缩放钳制 + 分辨率低于下限回退安全分辨率
func validate_and_sanitize(settings: GameSettingsAggregate) -> bool:
	# 1. 音量限制（边界由 config/domains/game_settings.json 的 audio.* 驱动）
	for k in settings.audio_settings:
		if k != "is_master_muted":
			settings.audio_settings[k] = clampf(settings.audio_settings[k], _audio_min(), _audio_max())

	# 2. UI 缩放限制（边界由 ui.min_scale / ui.max_scale 驱动）
	settings.ui_visual_settings["ui_scale"] = clampf(
		settings.ui_visual_settings.get("ui_scale", _ui_default_scale()), _ui_min_scale(), _ui_max_scale()
	)

	# 3. 分辨率合法性：低于下限则回退到安全分辨率
	var w = settings.render_settings.get("resolution_width", _default_width())
	var h = settings.render_settings.get("resolution_height", _default_height())
	if w < _min_width() or h < _min_height():
		settings.render_settings["resolution_width"] = _fallback_width()
		settings.render_settings["resolution_height"] = _fallback_height()

	return true

## 应用分辨率并启动回滚守护：备份快照 + 置待确认态与超时计时
func apply_resolution_with_revert_guard(
	settings: GameSettingsAggregate,
	new_w: int,
	new_h: int,
	new_mode: String
) -> void:
	backup_settings_snapshot = settings.serialize()
	settings.render_settings["resolution_width"] = new_w
	settings.render_settings["resolution_height"] = new_h
	settings.render_settings["window_mode"] = new_mode

	is_pending_confirm = true
	pending_revert_timer = _revert_timeout_seconds()

## 确认应用成功：清除待确认态与备份快照
func confirm_settings_applied() -> void:
	is_pending_confirm = false
	backup_settings_snapshot.clear()

## 回滚计时推进：负 delta 拒绝（防时间倒退拖延），超时未确认执行安全回滚并返回 true
func tick_revert_timer(delta: float, settings: GameSettingsAggregate) -> bool:
	if not is_pending_confirm:
		return false

	# 契约（Phase 31 S3）：回滚计时器只接受非负 delta（负 delta 拒绝，防时间倒退拖延回滚）
	if delta < 0.0:
		return false
	pending_revert_timer -= delta
	if pending_revert_timer <= 0.0:
		# 超时未确认，执行安全回滚
		settings.deserialize(backup_settings_snapshot)
		is_pending_confirm = false
		backup_settings_snapshot.clear()
		return true # 触发了回滚
	return false

# ==============================================================================
# 配置读取（全部阈值由 config/domains/game_settings.json 驱动）
# ==============================================================================

static func _revert_timeout_seconds() -> float:
	return GameConfig.get_float("domains.game_settings", "apply/revert_timeout_seconds", 15.0)

## 音量下限（audio/min_volume 配置，默认 0）
static func _audio_min() -> float:
	return GameConfig.get_float("domains.game_settings", "audio/min_volume", 0.0)

## 音量上限（audio/max_volume 配置，默认 1）
static func _audio_max() -> float:
	return GameConfig.get_float("domains.game_settings", "audio/max_volume", 1.0)

## UI 缩放下限（ui/min_scale 配置，默认 0.75）
static func _ui_min_scale() -> float:
	return GameConfig.get_float("domains.game_settings", "ui/min_scale", 0.75)

## UI 缩放上限（ui/max_scale 配置，默认 2.0）
static func _ui_max_scale() -> float:
	return GameConfig.get_float("domains.game_settings", "ui/max_scale", 2.0)

## UI 默认缩放（ui/default_scale 配置，默认 1.0）
static func _ui_default_scale() -> float:
	return GameConfig.get_float("domains.game_settings", "ui/default_scale", 1.0)

## 默认分辨率宽（render/default_width 配置，默认 1920）
static func _default_width() -> int:
	return GameConfig.get_int("domains.game_settings", "render/default_width", 1920)

## 默认分辨率高（render/default_height 配置，默认 1080）
static func _default_height() -> int:
	return GameConfig.get_int("domains.game_settings", "render/default_height", 1080)

## 分辨率下限宽（render/min_width 配置，默认 640）
static func _min_width() -> int:
	return GameConfig.get_int("domains.game_settings", "render/min_width", 640)

## 分辨率下限高（render/min_height 配置，默认 480）
static func _min_height() -> int:
	return GameConfig.get_int("domains.game_settings", "render/min_height", 480)

## 安全回退分辨率宽（render/fallback_width 配置，默认 1280）
static func _fallback_width() -> int:
	return GameConfig.get_int("domains.game_settings", "render/fallback_width", 1280)

## 安全回退分辨率高（render/fallback_height 配置，默认 720）
static func _fallback_height() -> int:
	return GameConfig.get_int("domains.game_settings", "render/fallback_height", 720)
