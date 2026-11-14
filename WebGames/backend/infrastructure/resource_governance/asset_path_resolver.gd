# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 资源治理与寻址 (Resource Governance))
# 文件路径: res://backend/infrastructure/resource_governance/asset_path_resolver.gd
# 架构定位: Asset Path Resolution & Build Environment Governor
# 依赖与触发: 上游: GameBootstrap, CutsceneAsyncLoader, ModPackageDiscovery | 下游: FileAccess, DirAccess, OS
# 职责说明: 提供全域艺术资源（官方资产与 MOD 资产）的标准目录拓扑寻址与 URI 协议解析；
#           严格区分工程版（Engineering Dev Build）与正式发行版（Release Build）的读盘策略；
#           防御外部 MOD 路径穿越攻击（Anti-Path Traversal），为全域加载系统提供单一真源路径。
# 退出语义与设计依据: 三级级联安全路径隔离与双通道环境规约 (Inv-MOD-RELPATH-1 / Inv-PATH-TRAVERSAL-GUARD)
# ==============================================================================

## AssetPathResolver：全域艺术资源标准化寻址与环境裁决中枢
class_name AssetPathResolver
extends RefCounted

# ==============================================================================
# 一、环境枚举与标准目录常量定义
# ==============================================================================

## 运行环境标识：工程开发版（编辑器调试、无头单测、松散文件、备用回退优先）
const ENV_ENGINEERING: String = "engineering"

## 运行环境标识：正式发行版（独立二进制、PCK封包、沙盒安全、强校验）
const ENV_RELEASE: String = "release"

## 官方内置艺术资源根路径 (Official Asset Root)
const ROOT_OFFICIAL_ASSETS: String = "res://assets/"

## Tier 0: 工程版内置/测试模组根路径
const ROOT_MODS_TIER0_DEV: String = "res://mods/"

## Tier 1: 发行版可执行程序同级模组根路径
const ROOT_MODS_TIER1_STANDALONE: String = "mods/"

## Tier 2: 发行版用户持久化数据沙盒模组根路径
const ROOT_MODS_TIER2_USER_SANDBOX: String = "user://mods/"

## 官方艺术资产一级分类目录标准
const CATEGORY_MEDIA_CUTSCENES: String = "media/cutscenes"
const CATEGORY_AUDIO_BGM: String = "audio/bgm"
const CATEGORY_AUDIO_SFX: String = "audio/sfx"
const CATEGORY_AUDIO_VOICE: String = "audio/voice"
const CATEGORY_TEXTURES_UI: String = "textures/ui"
const CATEGORY_TEXTURES_CHARACTERS: String = "textures/characters"
const CATEGORY_TEXTURES_ITEMS: String = "textures/items"
const CATEGORY_MODELS: String = "models"
const CATEGORY_FONTS: String = "fonts"

## 统一 URI 协议头与资产子目录常量
const SCHEME_OFFICIAL: String = "official://"
const SCHEME_MOD: String = "mod://"
const SCHEME_RES: String = "res://"
const SCHEME_USER: String = "user://"
const DIR_ASSETS: String = "assets"
const PREFIX_ASSETS: String = "assets/"

static var _instance: AssetPathResolver = null
static var _override_environment_for_test: String = ""
static var _override_roots_for_test: Array[String] = []

# ==============================================================================
# 二、单例与环境模式判定
# ==============================================================================

## 获取全局唯一资产寻址中枢单例
static func get_instance() -> AssetPathResolver:
	if _instance == null:
		_instance = AssetPathResolver.new()
	return _instance

## 测试环境模拟指定运行模式（隔离测试）
static func set_test_environment_override(environment_mode: String) -> void:
	_override_environment_for_test = environment_mode

## 测试环境模拟指定 MOD 根目录级联列表（隔离测试）
static func set_test_roots_override(roots: Array[String]) -> void:
	_override_roots_for_test = roots.duplicate()

## 重置测试环境覆写
static func reset_for_tests() -> void:
	_override_environment_for_test = ""
	_override_roots_for_test.clear()
	_instance = null

## 评估当前运行环境（工程版 vs 发行版）
static func get_current_build_mode() -> String:
	if not _override_environment_for_test.is_empty():
		return _override_environment_for_test

	# 编辑器环境或测试环境均归为工程版
	if OS.has_feature("editor") or OS.has_feature("test"):
		return ENV_ENGINEERING

	# 独立打包且带有 release 特性标记为正式发行版
	if OS.has_feature("standalone") or OS.has_feature("release"):
		return ENV_RELEASE

	return ENV_ENGINEERING

## 判定当前是否为工程开发版（宽松容错、文字模拟演播、明文扫盘）
static func is_engineering_build() -> bool:
	return get_current_build_mode() == ENV_ENGINEERING

## 判定当前是否为正式发行版（强校验、沙盒隔离、单包融合）
static func is_release_build() -> bool:
	return get_current_build_mode() == ENV_RELEASE

# ==============================================================================
# 三、官方艺术资产标准化寻址
# ==============================================================================

## 解析官方艺术资产物理路径（形参 <= 5）
static func resolve_official_asset_path(category: String, relative_subpath: String) -> String:
	var clean_category := category.strip_edges().trim_prefix("/").trim_suffix("/")
	var clean_subpath := relative_subpath.strip_edges().trim_prefix("/")

	if clean_category.begins_with("assets/"):
		clean_category = clean_category.trim_prefix("assets/")
	if clean_subpath.begins_with("assets/"):
		clean_subpath = clean_subpath.trim_prefix("assets/")

	if clean_category.is_empty():
		return ROOT_OFFICIAL_ASSETS.path_join(clean_subpath)
	return ROOT_OFFICIAL_ASSETS.path_join(clean_category).path_join(clean_subpath)

## 快捷解析官方 CG 视频资产物理路径
static func resolve_official_cutscene_path(video_filename: String) -> String:
	return resolve_official_asset_path(CATEGORY_MEDIA_CUTSCENES, video_filename)

## 快捷解析官方音频资产物理路径
static func resolve_official_audio_path(audio_category: String, audio_filename: String) -> String:
	return resolve_official_asset_path("audio".path_join(audio_category), audio_filename)

# ==============================================================================
# 四、MOD 艺术资产三级级联与沙盒寻址
# ==============================================================================

## 获取当前运行环境下有效的 MOD 发现根目录列表（有序级联：Tier 0 -> Tier 1 -> Tier 2）
static func get_mod_discovery_roots() -> Array[String]:
	if not _override_roots_for_test.is_empty():
		return _override_roots_for_test.duplicate()

	var roots: Array[String] = []

	if is_engineering_build():
		# 工程版：优先检索工程内开发/测试模组目录
		roots.append(ROOT_MODS_TIER0_DEV)

	# 发行版或独立运行：检索可执行文件同级 mods/
	var executable_directory := OS.get_executable_path().get_base_dir()
	roots.append(executable_directory.path_join(ROOT_MODS_TIER1_STANDALONE))

	# 用户安全数据沙盒目录（全环境默认回退，支持创意工坊与动态下载）
	roots.append(ROOT_MODS_TIER2_USER_SANDBOX)
	return roots

## 解析指定 MOD 内部艺术资源的物理路径（支持三级级联探测与防路径穿越）
static func resolve_mod_asset_path(mod_id: String, relative_asset_path: String) -> String:
	var clean_mod_id := sanitize_identifier(mod_id)
	var safe_relative_path := sanitize_sandbox_path(relative_asset_path)

	if clean_mod_id.is_empty() or safe_relative_path.is_empty():
		return ""

	var candidate_roots := get_mod_discovery_roots()
	for root_directory in candidate_roots:
		var target_path := root_directory.path_join(clean_mod_id).path_join(DIR_ASSETS).path_join(safe_relative_path)
		if asset_exists(target_path):
			return target_path
		# 兼容剧情模组专用子目录 (mods/narratives/<mod_id>/assets/...)
		var narrative_path := root_directory.path_join("narratives").path_join(clean_mod_id).path_join(DIR_ASSETS).path_join(safe_relative_path)
		if asset_exists(narrative_path):
			return narrative_path

	# 若三级级联均未探测到物理文件，返回首选沙盒物理路径（供资源探测或新建装配）
	if is_engineering_build():
		return ROOT_MODS_TIER0_DEV.path_join(clean_mod_id).path_join(DIR_ASSETS).path_join(safe_relative_path)
	return ROOT_MODS_TIER2_USER_SANDBOX.path_join(clean_mod_id).path_join(DIR_ASSETS).path_join(safe_relative_path)

# ==============================================================================
# 五、通用 URI 协议解析引擎 (Unified URI Scheme)
# ==============================================================================

## 解析任意格式的统一资源定位符（支持 official://, mod://, res://, user://）
static func resolve_unified_uri(uri_or_path: String, fallback_mod_id: String = "") -> String:
	var trimmed := uri_or_path.strip_edges()
	if trimmed.is_empty():
		return ""

	# 1. 官方资产协议：official://media/cutscenes/intro.ogv -> res://assets/media/cutscenes/intro.ogv
	if trimmed.begins_with(SCHEME_OFFICIAL):
		var relative_subpath := trimmed.trim_prefix(SCHEME_OFFICIAL)
		return ROOT_OFFICIAL_ASSETS.path_join(sanitize_sandbox_path(relative_subpath))

	# 2. 模组资产协议：mod://my_mod/assets/video.ogv 或 mod://assets/video.ogv (需 fallback_mod_id)
	if trimmed.begins_with(SCHEME_MOD):
		return _resolve_mod_scheme_uri(trimmed, fallback_mod_id)

	# 3. Godot 虚拟文件系统原生路径：res:// 或 user:// 直接返回安全清洗结果
	if trimmed.begins_with(SCHEME_RES) or trimmed.begins_with(SCHEME_USER):
		return sanitize_sandbox_path(trimmed)

	# 4. 无协议纯相对路径：若提供了 fallback_mod_id 则解析为 MOD 资产，否则作为官方资产相对路径
	if not fallback_mod_id.is_empty():
		return resolve_mod_asset_path(fallback_mod_id, trimmed)
	var clean_relative_path := sanitize_sandbox_path(trimmed)
	if clean_relative_path.begins_with(PREFIX_ASSETS):
		clean_relative_path = clean_relative_path.trim_prefix(PREFIX_ASSETS)
	return ROOT_OFFICIAL_ASSETS.path_join(clean_relative_path)

static func _resolve_mod_scheme_uri(uri: String, fallback_mod_id: String) -> String:
	var raw_path := uri.trim_prefix(SCHEME_MOD).trim_prefix("/")
	var slash_index := raw_path.find("/")

	if slash_index > 0:
		var first_segment := raw_path.substr(0, slash_index)
		var rest_path := raw_path.substr(slash_index + 1)
		# 若第一段是 assets，说明格式为 mod://assets/path，借用 fallback_mod_id
		if first_segment == DIR_ASSETS and not fallback_mod_id.is_empty():
			return resolve_mod_asset_path(fallback_mod_id, rest_path)
		# 否则格式为 mod://<mod_id>/assets/path
		if rest_path.begins_with(PREFIX_ASSETS):
			rest_path = rest_path.trim_prefix(PREFIX_ASSETS)
		return resolve_mod_asset_path(first_segment, rest_path)

	if not fallback_mod_id.is_empty():
		return resolve_mod_asset_path(fallback_mod_id, raw_path)
	return ""

# ==============================================================================
# 六、沙盒安全护栏（防路径穿越与非法字符）
# ==============================================================================

## 安全清洗子路径，严格剥离 ".."、驱动器盘符等路径穿越模式
static func sanitize_sandbox_path(raw_path: String) -> String:
	var clean := raw_path.replace("\\", "/").strip_edges()
	var prefix := ""

	# 若原路径为 res:// 或 user://，分离协议头；否则拦截冒号（针对非 res:// 或 user:// 的绝对物理盘符如 C:/）
	if clean.begins_with(SCHEME_RES):
		prefix = SCHEME_RES
		clean = clean.substr(SCHEME_RES.length())
	elif clean.begins_with(SCHEME_USER):
		prefix = SCHEME_USER
		clean = clean.substr(SCHEME_USER.length())
	elif clean.contains(":"):
		clean = clean.split(":")[-1]

	var segments := clean.split("/")
	var safe_segments: Array[String] = []

	for segment in segments:
		var clean_segment := segment.strip_edges()
		if clean_segment.is_empty() or clean_segment == ".":
			continue
		if clean_segment == "..":
			# 刚性拒绝向上一级跃迁
			continue
		safe_segments.append(clean_segment)

	return prefix + "/".join(safe_segments)

## 规范化标识符字符集（仅允许英文字母、数字、下划线、短横线）
static func sanitize_identifier(raw_id: String) -> String:
	var clean := raw_id.strip_edges()
	var regex := RegEx.new()
	var _compile_error := regex.compile("[^a-zA-Z0-9_\\-]")
	return regex.sub(clean, "", true)

## 资产物理存在性探测（兼容 Godot 虚拟文件系统与外部物理文件）
static func asset_exists(canonical_path: String) -> bool:
	if canonical_path.is_empty():
		return false
	if ResourceLoader.exists(canonical_path):
		return true
	if FileAccess.file_exists(canonical_path):
		return true
	return false
