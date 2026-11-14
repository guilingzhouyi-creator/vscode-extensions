# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 媒体与全域CG动画 (Media & Cutscene))
# 文件路径: res://backend/infrastructure/media/cutscene_hook_registry.gd
# 架构定位: Hook Rule Routing & Config-Driven Interceptor Engine
# 依赖与触发: 上游: GameConfig, EventBusCore | 下游: CutsceneRequestDTO, CutsceneManifestDTO
# 职责说明: 提供全域剧情、任务与生命周期 CG 播放 Hook 规则动态匹配与参数解算；
#           负责将松耦合事件转化为强类型参数化请求信封，杜绝任何业务逻辑内的硬编码；
#           管理播放记录与防重复放映判定（play_once_per_save）；
#           对齐通用解析契约，兼顾无艺术资源下的文字回退描述与参数覆盖。
# 退出语义与设计依据: 零硬编码配置驱动与事件拦截器拓扑契约 (Inv-ZERO-HARDCODE-1)
# ==============================================================================

## CutsceneHookRegistry：全域 CG 播放 Hook 路由拦截注册表
class_name CutsceneHookRegistry
extends RefCounted

const CutsceneRequestDTOClass = preload("res://backend/infrastructure/media/dto/cutscene_request_dto.gd")
const CutsceneManifestDTOClass = preload("res://backend/infrastructure/media/dto/cutscene_manifest_dto.gd")
const AssetPathResolverClass = preload("res://backend/infrastructure/resource_governance/asset_path_resolver.gd")

# ==============================================================================
# 一、触发类型常量
# ==============================================================================

const TRIGGER_NARRATIVE_NODE_PRE: String = "NARRATIVE_NODE_PRE"
const TRIGGER_NARRATIVE_NODE_POST: String = "NARRATIVE_NODE_POST"
const TRIGGER_QUEST_STAGE_REACHED: String = "QUEST_STAGE_REACHED"
const TRIGGER_LIFECYCLE_STAGE_ENTERED: String = "LIFECYCLE_STAGE_ENTERED"
const TRIGGER_CUSTOM_EVENT: String = "CUSTOM_EVENT"

static var _instance: CutsceneHookRegistry = null

var _manifests: Dictionary = {} # cutscene_id -> CutsceneManifestDTO
var _hooks: Array[Dictionary] = [] # 规则列表
var _narrative_hooks_index: Dictionary = {} # "pre/post|dag_id|node_id" -> hook_dict
var _quest_hooks_index: Dictionary = {} # "quest_id|stage_id" -> hook_dict
var _lifecycle_hooks_index: Dictionary = {} # stage_id -> hook_dict
var _viewed_records: Dictionary = {} # cutscene_id -> bool

# ==============================================================================
# 二、单例与初始化
# ==============================================================================

## 获取过场 Hook 注册表进程级单例
static func get_instance() -> CutsceneHookRegistry:
	if _instance == null:
		_instance = CutsceneHookRegistry.new()
	return _instance

## 从 GameConfig 静态加载全域资产与 Hook 规则表
func initialize_from_config() -> void:
	_manifests.clear()
	_clear_hook_indices()

	# 1. 载入资产清单
	var registry_map: Dictionary = GameConfig.get_dict("infrastructure.cutscene_registry", "cutscenes", {})
	for cutscene_id in registry_map.keys():
		var manifest_entry: Dictionary = registry_map[cutscene_id]
		_manifests[str(cutscene_id)] = _build_manifest_dto(str(cutscene_id), manifest_entry)

	# 2. 载入 Hook 规则
	var hooks_array: Array = GameConfig.get_array("infrastructure.cutscene_hooks", "hooks", [])
	for hook_entry in hooks_array:
		if hook_entry is Dictionary:
			_append_and_index_hook(hook_entry as Dictionary)

func _build_manifest_dto(cutscene_id: String, manifest_entry: Dictionary) -> CutsceneManifestDTO:
	var manifest := CutsceneManifestDTOClass.new()
	manifest.cutscene_id = cutscene_id
	manifest.title_key = str(manifest_entry.get("title_key", ""))
	manifest.video_resource_path = str(manifest_entry.get("video_resource_path", ""))
	manifest.duration_sec = float(manifest_entry.get("duration_sec", 3.0))
	manifest.default_audio_bus = str(manifest_entry.get("default_audio_bus", "BGM"))
	manifest.default_volume_linear = float(manifest_entry.get("default_volume_linear", 1.0))
	manifest.subtitles_track_id = str(manifest_entry.get("subtitles_track_id", ""))
	manifest.default_skippable = bool(manifest_entry.get("default_skippable", true))
	manifest.is_placeholder = bool(manifest_entry.get("is_placeholder", false))
	manifest.placeholder_title = str(manifest_entry.get("placeholder_title", ""))
	manifest.placeholder_text = str(manifest_entry.get("placeholder_text", ""))

	var raw_tags: Variant = manifest_entry.get("tags", [])
	if raw_tags is Array:
		for raw_tag in (raw_tags as Array):
			manifest.tags.append(str(raw_tag))
	return manifest

func _append_and_index_hook(raw_hook: Dictionary) -> void:
	var copied := raw_hook.duplicate(true)
	_hooks.append(copied)
	_index_hook(copied)

# ==============================================================================
# 三、动态注册与重载接口 (支持 MOD 开发者热扩展)
# ==============================================================================

## 动态注册或覆写过场动画静态清单条目
func register_manifest(manifest: CutsceneManifestDTO) -> void:
	if manifest != null and not manifest.cutscene_id.is_empty():
		_manifests[manifest.cutscene_id] = manifest

## 按过场标识查询已注册的静态清单条目
func get_manifest(cutscene_id: String) -> CutsceneManifestDTO:
	return _manifests.get(cutscene_id, null)

## 动态注册并索引一条过场触发 Hook 规则
func register_hook(hook_entry: Dictionary) -> void:
	if not hook_entry.is_empty():
		var copied := hook_entry.duplicate(true)
		_hooks.append(copied)
		_index_hook(copied)

## 清空静态清单、Hook 索引与已观看记录（供测试隔离重置）
func clear_for_tests() -> void:
	_manifests.clear()
	_clear_hook_indices()
	_viewed_records.clear()

func _clear_hook_indices() -> void:
	_hooks.clear()
	_narrative_hooks_index.clear()
	_quest_hooks_index.clear()
	_lifecycle_hooks_index.clear()

func _index_hook(hook_entry: Dictionary) -> void:
	var trigger_type: String = str(hook_entry.get("trigger_type", ""))
	var raw_filter: Variant = hook_entry.get("target_filter", null)
	if not (raw_filter is Dictionary):
		return
	var target_filter: Dictionary = raw_filter as Dictionary
	match trigger_type:
		TRIGGER_NARRATIVE_NODE_PRE, TRIGGER_NARRATIVE_NODE_POST:
			var narrative_key := "%s|%s|%s" % [trigger_type, str(target_filter.get("dag_id", "")), str(target_filter.get("node_id", ""))]
			if not _narrative_hooks_index.has(narrative_key):
				_narrative_hooks_index[narrative_key] = hook_entry
		TRIGGER_QUEST_STAGE_REACHED:
			var quest_key := "%s|%s" % [str(target_filter.get("quest_id", "")), str(target_filter.get("stage_id", ""))]
			if not _quest_hooks_index.has(quest_key):
				_quest_hooks_index[quest_key] = hook_entry
		TRIGGER_LIFECYCLE_STAGE_ENTERED:
			var lifecycle_key := str(target_filter.get("stage_id", ""))
			if not _lifecycle_hooks_index.has(lifecycle_key):
				_lifecycle_hooks_index[lifecycle_key] = hook_entry

# ==============================================================================
# 四、Hook 规则匹配与参数解算
# ==============================================================================

## 匹配剧情 DAG 节点前置/后置 Hook (O(1) 哈希索引检索)
func match_narrative_hook(dag_id: String, node_id: String, is_pre: bool) -> CutsceneRequestDTO:
	var expected_type: String = TRIGGER_NARRATIVE_NODE_PRE if is_pre else TRIGGER_NARRATIVE_NODE_POST
	var narrative_key := "%s|%s|%s" % [expected_type, dag_id, node_id]
	var hook_entry: Variant = _narrative_hooks_index.get(narrative_key, null)
	return _assemble_request_from_hook(hook_entry as Dictionary) if hook_entry is Dictionary else null

## 匹配任务阶段达成 Hook (O(1) 哈希索引检索)
func match_quest_hook(quest_id: String, stage_id: String) -> CutsceneRequestDTO:
	var quest_key := "%s|%s" % [quest_id, stage_id]
	var hook_entry: Variant = _quest_hooks_index.get(quest_key, null)
	return _assemble_request_from_hook(hook_entry as Dictionary) if hook_entry is Dictionary else null

## 匹配生命周期阶段 Hook (O(1) 哈希索引检索)
func match_lifecycle_hook(stage_id: String) -> CutsceneRequestDTO:
	var hook_entry: Variant = _lifecycle_hooks_index.get(stage_id, null)
	return _assemble_request_from_hook(hook_entry as Dictionary) if hook_entry is Dictionary else null

## 基于 cutscene_id 构造参数化调用信封（支持外部显式覆盖参数）
func resolve_request(cutscene_id: String, override_parameters: Dictionary = {}) -> CutsceneRequestDTO:
	var request_dto := CutsceneRequestDTOClass.new()
	request_dto.cutscene_id = cutscene_id

	var manifest: CutsceneManifestDTO = _manifests.get(cutscene_id, null)
	if manifest != null:
		request_dto.video_path = AssetPathResolverClass.resolve_unified_uri(manifest.video_resource_path, manifest.mod_id)
		request_dto.subtitles_track_id = manifest.subtitles_track_id
		request_dto.audio_bus = manifest.default_audio_bus
		request_dto.volume_linear = manifest.default_volume_linear
		request_dto.skippable = manifest.default_skippable
		request_dto.duration_sec = manifest.duration_sec
		request_dto.is_placeholder = manifest.is_placeholder
		request_dto.placeholder_title = manifest.placeholder_title if not manifest.placeholder_title.is_empty() else manifest.title_key
		request_dto.placeholder_text = manifest.placeholder_text

	# 应用覆盖参数
	if override_parameters.has("video_path"):
		request_dto.video_path = AssetPathResolverClass.resolve_unified_uri(str(override_parameters["video_path"]))
	if override_parameters.has("skippable"):
		request_dto.skippable = bool(override_parameters["skippable"])
	if override_parameters.has("skip_hold_duration_sec"):
		request_dto.skip_hold_duration_sec = float(override_parameters["skip_hold_duration_sec"])
	if override_parameters.has("subtitles_track_id"):
		request_dto.subtitles_track_id = str(override_parameters["subtitles_track_id"])
	if override_parameters.has("audio_bus"):
		request_dto.audio_bus = str(override_parameters["audio_bus"])
	if override_parameters.has("volume_linear"):
		request_dto.volume_linear = float(override_parameters["volume_linear"])
	if override_parameters.has("fade_in_sec"):
		request_dto.fade_in_sec = float(override_parameters["fade_in_sec"])
	if override_parameters.has("fade_out_sec"):
		request_dto.fade_out_sec = float(override_parameters["fade_out_sec"])
	if override_parameters.has("auto_pause_world"):
		request_dto.auto_pause_world = bool(override_parameters["auto_pause_world"])
	if override_parameters.has("hide_hud"):
		request_dto.hide_hud = bool(override_parameters["hide_hud"])
	if override_parameters.has("play_once_per_save"):
		request_dto.play_once_per_save = bool(override_parameters["play_once_per_save"])
	if override_parameters.has("duration_sec"):
		request_dto.duration_sec = float(override_parameters["duration_sec"])
	if override_parameters.has("is_placeholder"):
		request_dto.is_placeholder = bool(override_parameters["is_placeholder"])
	if override_parameters.has("placeholder_title"):
		request_dto.placeholder_title = str(override_parameters["placeholder_title"])
	if override_parameters.has("placeholder_text"):
		request_dto.placeholder_text = str(override_parameters["placeholder_text"])
	if override_parameters.has("skip_prompt_text"):
		request_dto.skip_prompt_text = str(override_parameters["skip_prompt_text"])

	return request_dto

func _assemble_request_from_hook(hook_entry: Dictionary) -> CutsceneRequestDTO:
	var cutscene_id: String = str(hook_entry.get("cutscene_id", ""))
	var overrides: Dictionary = hook_entry.get("override_params", {})

	# 防重复播放判定
	var should_play_once: bool = bool(overrides.get("play_once_per_save", false))
	if should_play_once and is_cutscene_viewed(cutscene_id):
		return null

	return resolve_request(cutscene_id, overrides)

# ==============================================================================
# 五、播放记录与状态守卫
# ==============================================================================

## 标记指定过场动画在本存档会话内已播放（用于 play_once_per_save 去重）
func mark_cutscene_viewed(cutscene_id: String) -> void:
	if not cutscene_id.is_empty():
		_viewed_records[cutscene_id] = true

## 查询指定过场动画是否已标记为播放过
func is_cutscene_viewed(cutscene_id: String) -> bool:
	return _viewed_records.get(cutscene_id, false)
