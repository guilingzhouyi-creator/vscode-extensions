# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/game_settings/game_settings_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/game_settings.json | 信号: EventBus 领域广播
# 职责说明: 管理音频分轨混音、视效与 UI 缩放、多端渲染管线与画质参数
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name GameSettingsAggregate
extends RefCounted

# 1. 音频总线设置组 (线性音量 0.0 ~ 1.0)
var audio_settings: Dictionary = {
	"master_volume": GameConfig.get_float("domains.game_settings", "defaults/audio/master_volume", 1.0),
	"bgm_volume": GameConfig.get_float("domains.game_settings", "defaults/audio/bgm_volume", 0.8),
	"sfx_volume": GameConfig.get_float("domains.game_settings", "defaults/audio/sfx_volume", 0.9),
	"ui_volume": GameConfig.get_float("domains.game_settings", "defaults/audio/ui_volume", 0.8),
	"ambience_volume": GameConfig.get_float("domains.game_settings", "defaults/audio/ambience_volume", 0.7),
	"is_master_muted": GameConfig.get_bool("domains.game_settings", "defaults/audio/is_master_muted", false)
}

# 2. 界面与视效设置组
var ui_visual_settings: Dictionary = {
	"ui_scale": GameConfig.get_float("domains.game_settings", "defaults/ui_visual/ui_scale", 1.0),
	"language": GameConfig.get_string("domains.game_settings", "defaults/ui_visual/language", "zh_CN"),
	"show_damage_numbers": GameConfig.get_bool("domains.game_settings", "defaults/ui_visual/show_damage_numbers", true),
	"damage_text_scale": GameConfig.get_float("domains.game_settings", "defaults/ui_visual/damage_text_scale", 1.0),
	"screen_shake_intensity": GameConfig.get_float("domains.game_settings", "defaults/ui_visual/screen_shake_intensity", 1.0)
}

# 3. 渲染管线与画质设置组
var render_settings: Dictionary = {
	"window_mode": GameConfig.get_string("domains.game_settings", "defaults/render/window_mode", "EXCLUSIVE_FULLSCREEN"),
	"resolution_width": GameConfig.get_int("domains.game_settings", "defaults/render/resolution_width", 1920),
	"resolution_height": GameConfig.get_int("domains.game_settings", "defaults/render/resolution_height", 1080),
	"vsync_mode": GameConfig.get_string("domains.game_settings", "defaults/render/vsync_mode", "ENABLED"),
	"target_fps_cap": GameConfig.get_int("domains.game_settings", "defaults/render/target_fps_cap", 60),
	"msaa_level": GameConfig.get_string("domains.game_settings", "defaults/render/msaa_level", "MSAA_4X"),
	"shadow_quality": GameConfig.get_string("domains.game_settings", "defaults/render/shadow_quality", "HIGH"),
	"glow_bloom_enabled": GameConfig.get_bool("domains.game_settings", "defaults/render/glow_bloom_enabled", true),
	"particle_density": GameConfig.get_float("domains.game_settings", "defaults/render/particle_density", 1.0)
}

## 序列化三组设置（深拷贝防外部突变）
func serialize() -> Dictionary:
	return {
		"audio": audio_settings.duplicate(true),
		"ui_visual": ui_visual_settings.duplicate(true),
		"render": render_settings.duplicate(true)
	}

## 反序列化：子段类型守卫（Inv-DF-3）逐段安全合并（损坏段回退默认并告警）
func deserialize(data: Dictionary) -> void:
	# L5（Phase 56）：子段类型守卫（Inv-DF-3）——损坏文件（audio 等非 Dictionary）
	# 不再 typed 赋值崩溃，回退当前默认段并告警；合法段逐键覆盖
	_merge_section(data.get("audio"), audio_settings, "audio")
	_merge_section(data.get("ui_visual"), ui_visual_settings, "ui_visual")
	_merge_section(data.get("render"), render_settings, "render")

## 单段安全合并：raw 为 Dictionary 则逐键覆盖目标；为 null（缺键）忽略；其余类型告警回退
func _merge_section(raw: Variant, target: Dictionary, section: String) -> void:
	if raw is Dictionary:
		for k in raw:
			target[k] = raw[k]
	elif raw != null:
		push_warning("game_settings: 段 '%s' 损坏（期望 Dictionary，实测 %s），已保留默认值" % [section, type_string(typeof(raw))])
