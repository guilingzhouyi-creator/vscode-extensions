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

static func get_instance() -> CutsceneHookRegistry:
	if _instance == null:
		_instance = CutsceneHookRegistry.new()
	return _instance

## 从 GameConfig 静态加载全域资产与 Hook 规则表
func initialize_from_config() -> void:
	_manifests.clear()
	_clear_hook_indices()

	# 1. 载入资产清单
	var reg_data: Dictionary = GameConfig.get_dict("infrastructure.cutscene_registry", "cutscenes", {})
	for cs_id in reg_data.keys():
		var item: Dictionary = reg_data[cs_id]
		_manifests[str(cs_id)] = _build_manifest_dto(str(cs_id), item)

	# 2. 载入 Hook 规则
	var hooks_arr: Array = GameConfig.get_array("infrastructure.cutscene_hooks", "hooks", [])
	for h in hooks_arr:
		if h is Dictionary:
			_append_and_index_hook(h as Dictionary)

func _build_manifest_dto(cs_id: String, item: Dictionary) -> CutsceneManifestDTO:
	var m := CutsceneManifestDTOClass.new()
	m.cutscene_id = cs_id
	m.title_key = str(item.get("title_key", ""))
	m.video_resource_path = str(item.get("video_resource_path", ""))
	m.duration_sec = float(item.get("duration_sec", 3.0))
	m.default_audio_bus = str(item.get("default_audio_bus", "BGM"))
	m.default_volume_linear = float(item.get("default_volume_linear", 1.0))
	m.subtitles_track_id = str(item.get("subtitles_track_id", ""))
	m.default_skippable = bool(item.get("default_skippable", true))
	m.is_placeholder = bool(item.get("is_placeholder", false))
	m.placeholder_title = str(item.get("placeholder_title", ""))
	m.placeholder_text = str(item.get("placeholder_text", ""))

	var raw_tags: Variant = item.get("tags", [])
	if raw_tags is Array:
		for t in (raw_tags as Array):
			m.tags.append(str(t))
	return m

func _append_and_index_hook(raw_hook: Dictionary) -> void:
	var copied := raw_hook.duplicate(true)
	_hooks.append(copied)
	_index_hook(copied)

# ==============================================================================
# 三、动态注册与重载接口 (支持 MOD 开发者热扩展)
# ==============================================================================

func register_manifest(manifest: CutsceneManifestDTO) -> void:
	if manifest != null and not manifest.cutscene_id.is_empty():
		_manifests[manifest.cutscene_id] = manifest

func get_manifest(cutscene_id: String) -> CutsceneManifestDTO:
	return _manifests.get(cutscene_id, null)

func register_hook(hook_dict: Dictionary) -> void:
	if not hook_dict.is_empty():
		var copied := hook_dict.duplicate(true)
		_hooks.append(copied)
		_index_hook(copied)

func clear_for_tests() -> void:
	_manifests.clear()
	_clear_hook_indices()
	_viewed_records.clear()

func _clear_hook_indices() -> void:
	_hooks.clear()
	_narrative_hooks_index.clear()
	_quest_hooks_index.clear()
	_lifecycle_hooks_index.clear()

func _index_hook(hook_dict: Dictionary) -> void:
	var trigger_type: String = str(hook_dict.get("trigger_type", ""))
	var raw_filter: Variant = hook_dict.get("target_filter", null)
	if not (raw_filter is Dictionary):
		return
	var filter: Dictionary = raw_filter as Dictionary
	match trigger_type:
		TRIGGER_NARRATIVE_NODE_PRE, TRIGGER_NARRATIVE_NODE_POST:
			var key := "%s|%s|%s" % [trigger_type, str(filter.get("dag_id", "")), str(filter.get("node_id", ""))]
			if not _narrative_hooks_index.has(key):
				_narrative_hooks_index[key] = hook_dict
		TRIGGER_QUEST_STAGE_REACHED:
			var q_key := "%s|%s" % [str(filter.get("quest_id", "")), str(filter.get("stage_id", ""))]
			if not _quest_hooks_index.has(q_key):
				_quest_hooks_index[q_key] = hook_dict
		TRIGGER_LIFECYCLE_STAGE_ENTERED:
			var l_key := str(filter.get("stage_id", ""))
			if not _lifecycle_hooks_index.has(l_key):
				_lifecycle_hooks_index[l_key] = hook_dict

# ==============================================================================
# 四、Hook 规则匹配与参数解算
# ==============================================================================

## 匹配剧情 DAG 节点前置/后置 Hook (O(1) 哈希索引检索)
func match_narrative_hook(dag_id: String, node_id: String, is_pre: bool) -> CutsceneRequestDTO:
	var expected_type: String = TRIGGER_NARRATIVE_NODE_PRE if is_pre else TRIGGER_NARRATIVE_NODE_POST
	var key := "%s|%s|%s" % [expected_type, dag_id, node_id]
	var h: Variant = _narrative_hooks_index.get(key, null)
	return _assemble_request_from_hook(h as Dictionary) if h is Dictionary else null

## 匹配任务阶段达成 Hook (O(1) 哈希索引检索)
func match_quest_hook(quest_id: String, stage_id: String) -> CutsceneRequestDTO:
	var q_key := "%s|%s" % [quest_id, stage_id]
	var h: Variant = _quest_hooks_index.get(q_key, null)
	return _assemble_request_from_hook(h as Dictionary) if h is Dictionary else null

## 匹配生命周期阶段 Hook (O(1) 哈希索引检索)
func match_lifecycle_hook(stage_id: String) -> CutsceneRequestDTO:
	var h: Variant = _lifecycle_hooks_index.get(stage_id, null)
	return _assemble_request_from_hook(h as Dictionary) if h is Dictionary else null

## 基于 cutscene_id 构造参数化调用信封（支持外部显式覆盖参数）
func resolve_request(cutscene_id: String, override_params: Dictionary = {}) -> CutsceneRequestDTO:
	var req := CutsceneRequestDTOClass.new()
	req.cutscene_id = cutscene_id

	var manifest: CutsceneManifestDTO = _manifests.get(cutscene_id, null)
	if manifest != null:
		req.video_path = AssetPathResolverClass.resolve_unified_uri(manifest.video_resource_path, manifest.mod_id)
		req.subtitles_track_id = manifest.subtitles_track_id
		req.audio_bus = manifest.default_audio_bus
		req.volume_linear = manifest.default_volume_linear
		req.skippable = manifest.default_skippable
		req.duration_sec = manifest.duration_sec
		req.is_placeholder = manifest.is_placeholder
		req.placeholder_title = manifest.placeholder_title if not manifest.placeholder_title.is_empty() else manifest.title_key
		req.placeholder_text = manifest.placeholder_text

	# 应用覆盖参数
	if override_params.has("video_path"):
		req.video_path = AssetPathResolverClass.resolve_unified_uri(str(override_params["video_path"]))
	if override_params.has("skippable"):
		req.skippable = bool(override_params["skippable"])
	if override_params.has("skip_hold_duration_sec"):
		req.skip_hold_duration_sec = float(override_params["skip_hold_duration_sec"])
	if override_params.has("subtitles_track_id"):
		req.subtitles_track_id = str(override_params["subtitles_track_id"])
	if override_params.has("audio_bus"):
		req.audio_bus = str(override_params["audio_bus"])
	if override_params.has("volume_linear"):
		req.volume_linear = float(override_params["volume_linear"])
	if override_params.has("fade_in_sec"):
		req.fade_in_sec = float(override_params["fade_in_sec"])
	if override_params.has("fade_out_sec"):
		req.fade_out_sec = float(override_params["fade_out_sec"])
	if override_params.has("auto_pause_world"):
		req.auto_pause_world = bool(override_params["auto_pause_world"])
	if override_params.has("hide_hud"):
		req.hide_hud = bool(override_params["hide_hud"])
	if override_params.has("play_once_per_save"):
		req.play_once_per_save = bool(override_params["play_once_per_save"])
	if override_params.has("duration_sec"):
		req.duration_sec = float(override_params["duration_sec"])
	if override_params.has("is_placeholder"):
		req.is_placeholder = bool(override_params["is_placeholder"])
	if override_params.has("placeholder_title"):
		req.placeholder_title = str(override_params["placeholder_title"])
	if override_params.has("placeholder_text"):
		req.placeholder_text = str(override_params["placeholder_text"])
	if override_params.has("skip_prompt_text"):
		req.skip_prompt_text = str(override_params["skip_prompt_text"])

	return req

func _assemble_request_from_hook(hook_dict: Dictionary) -> CutsceneRequestDTO:
	var cs_id: String = str(hook_dict.get("cutscene_id", ""))
	var overrides: Dictionary = hook_dict.get("override_params", {})

	# 防重复播放判定
	var play_once: bool = bool(overrides.get("play_once_per_save", false))
	if play_once and is_cutscene_viewed(cs_id):
		return null

	return resolve_request(cs_id, overrides)

# ==============================================================================
# 五、播放记录与状态守卫
# ==============================================================================

func mark_cutscene_viewed(cutscene_id: String) -> void:
	if not cutscene_id.is_empty():
		_viewed_records[cutscene_id] = true

func is_cutscene_viewed(cutscene_id: String) -> bool:
	return _viewed_records.get(cutscene_id, false)
