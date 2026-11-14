# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 媒体与全域CG动画 (Media & Cutscene))
# 文件路径: res://backend/infrastructure/media/dto/cutscene_manifest_dto.gd
# 架构定位: Infrastructure Data Transfer Object (DTO) / Media Manifest
# 依赖与触发: 上游: GameConfig, CutsceneRegistry | 下游: CutsceneHookRegistry, CutsceneOrchestrator
# 职责说明: 描述单个 CG 视频资产静态元数据规格（路径、时长、默认音轨、字幕映射及文字演播信息）；
#           对齐配置驱动规范，为 MOD 扩展与全域无硬编码调用提供资产清单真源；
#           天然兼容艺术资源尚未就位时的文字演播与演示描述。
# 退出语义与设计依据: 业务领域第一性原理与媒体资产元数据清单规约 (Inv-ZERO-HARDCODE-1)
# ==============================================================================

## CutsceneManifestDTO：视频与 CG 资产静态清单模型
class_name CutsceneManifestDTO
extends RefCounted

# ==============================================================================
# 一、核心属性字段
# ==============================================================================

var cutscene_id: String = ""
var mod_id: String = ""
var title_key: String = ""
var video_resource_path: String = ""
var duration_sec: float = 3.0
var default_audio_bus: String = "BGM"
var default_volume_linear: float = 1.0
var subtitles_track_id: String = ""
var default_skippable: bool = true
var is_placeholder: bool = false
var placeholder_title: String = ""
var placeholder_text: String = ""
var tags: Array[String] = []

# ==============================================================================
# 二、序列化与装配
# ==============================================================================

## 序列化为纯字典结构
func to_dict() -> Dictionary:
	return {
		"cutscene_id": cutscene_id,
		"mod_id": mod_id,
		"title_key": title_key,
		"video_resource_path": video_resource_path,
		"duration_sec": duration_sec,
		"default_audio_bus": default_audio_bus,
		"default_volume_linear": default_volume_linear,
		"subtitles_track_id": subtitles_track_id,
		"default_skippable": default_skippable,
		"is_placeholder": is_placeholder,
		"placeholder_title": placeholder_title,
		"placeholder_text": placeholder_text,
		"tags": tags.duplicate()
	}

## 从输入字典安全反序列化并装配过场清单 DTO
static func from_dict(data: Dictionary) -> CutsceneManifestDTO:
	var manifest := CutsceneManifestDTO.new()
	if data.is_empty():
		return manifest

	manifest.cutscene_id = str(data.get("cutscene_id", ""))
	manifest.mod_id = str(data.get("mod_id", ""))
	manifest.title_key = str(data.get("title_key", ""))
	manifest.video_resource_path = str(data.get("video_resource_path", ""))
	manifest.duration_sec = float(data.get("duration_sec", 3.0))
	manifest.default_audio_bus = str(data.get("default_audio_bus", "BGM"))
	manifest.default_volume_linear = float(data.get("default_volume_linear", 1.0))
	manifest.subtitles_track_id = str(data.get("subtitles_track_id", ""))
	manifest.default_skippable = bool(data.get("default_skippable", true))
	manifest.is_placeholder = bool(data.get("is_placeholder", false))
	manifest.placeholder_title = str(data.get("placeholder_title", ""))
	manifest.placeholder_text = str(data.get("placeholder_text", ""))

	manifest.tags.clear()
	var raw_tags: Variant = data.get("tags", [])
	if raw_tags is Array:
		for raw_tag in (raw_tags as Array):
			manifest.tags.append(str(raw_tag))

	return manifest
