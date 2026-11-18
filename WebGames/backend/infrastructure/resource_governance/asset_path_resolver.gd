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
const ASSET_CATEGORY_SEGMENTS: Array[String] = [
	"textures", "media", "audio", "models", "fonts", "subtitles", "shaders", "icons", "ui", "cutscenes"
]

static var _instance: AssetPathResolver = null
static var _override_environment_for_test: String = ""
static var _override_roots_for_test: Array[String] = []
static var _active_official_mod_id: String = ""

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
	_active_official_mod_id = ""
	_instance = null

## 设定当前挂载的官方基础 MOD 标识（清空时传递空字符串）
static func set_active_official_mod_id(pack_id: String) -> void:
	_active_official_mod_id = sanitize_identifier(pack_id)

## 获取当前激活的官方基础 MOD 标识
static func get_active_official_mod_id() -> String:
	return _active_official_mod_id

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

## 解析官方艺术资产物理路径（优先检索已激活的官方基础 MOD，缺失时回退至引擎内置基础设施资产根）
static func resolve_official_asset_path(category: String, relative_subpath: String) -> String:
	var clean_category := category.strip_edges().trim_prefix("/").trim_suffix("/")
	var clean_subpath := relative_subpath.strip_edges().trim_prefix("/")

	if clean_category.begins_with("assets/"):
		clean_category = clean_category.trim_prefix("assets/")
	if clean_subpath.begins_with("assets/"):
		clean_subpath = clean_subpath.trim_prefix("assets/")

	var joined_subpath := clean_subpath if clean_category.is_empty() else clean_category.path_join(clean_subpath)
	if not _active_official_mod_id.is_empty():
		var mod_candidate := resolve_mod_asset_path(_active_official_mod_id, joined_subpath)
		if asset_exists(mod_candidate):
			return mod_candidate
	return ROOT_OFFICIAL_ASSETS.path_join(joined_subpath)

## 快捷解析官方 CG 视频资产物理路径
static func resolve_official_cutscene_path(video_filename: String) -> String:
	return resolve_official_asset_path(CATEGORY_MEDIA_CUTSCENES, video_filename)

## 快捷解析官方音频资产物理路径
static func resolve_official_audio_path(audio_category: String, audio_filename: String) -> String:
	return resolve_official_asset_path("audio".path_join(audio_category), audio_filename)

# ==============================================================================
# 四、MOD 艺术资产三级级联与沙盒寻址
# ==============================================================================

## 统一读取多级 MOD 发现根路径（严格对齐 domains.narrative_orchestration#mod_discovery 配置与工程/发行模式隔离）
static func get_mod_discovery_roots() -> Array[String]:
	if not _override_roots_for_test.is_empty():
		return _override_roots_for_test.duplicate()

	var discovery_table: Dictionary = GameConfig.get_dict("domains.narrative_orchestration", "mod_discovery", {})
	var packages_root := String(discovery_table.get("packages_root", ROOT_MODS_TIER0_DEV)).strip_edges()
	if packages_root.is_empty():
		packages_root = ROOT_MODS_TIER0_DEV
	var install_rel := String(discovery_table.get("mods_install_rel", ROOT_MODS_TIER1_STANDALONE)).strip_edges()
	if install_rel.is_empty():
		install_rel = ROOT_MODS_TIER1_STANDALONE
	var user_sandbox := String(discovery_table.get("mods_user_sandbox", ROOT_MODS_TIER2_USER_SANDBOX)).strip_edges()
	if user_sandbox.is_empty():
		user_sandbox = ROOT_MODS_TIER2_USER_SANDBOX

	var roots: Array[String] = []
	if is_engineering_build():
		# 工程版：开发/测试模组目录
		roots.append(packages_root)

	# 发行版或独立运行：可执行文件同级 mods/
	var executable_directory := OS.get_executable_path().get_base_dir()
	var install_root := install_rel if (install_rel.begins_with(SCHEME_RES) or install_rel.begins_with(SCHEME_USER)) else executable_directory.path_join(install_rel)
	roots.append(install_root)

	# 用户安全数据沙盒目录（最高运行时覆盖优先级，支持创意工坊与动态下载）
	roots.append(user_sandbox)
	return roots

## 解析指定 MOD 内部艺术资源的物理路径（user > install > dev 高覆盖优先 + .kmod 版本匹配 + 严格防穿越）
static func resolve_mod_asset_path(mod_id: String, relative_asset_path: String) -> String:
	var clean_mod_id := sanitize_identifier(mod_id)
	var safe_relative_path := sanitize_sandbox_path_strict(relative_asset_path)
	if clean_mod_id.is_empty() or clean_mod_id != mod_id.strip_edges() or safe_relative_path.is_empty():
		return ""
	if safe_relative_path.begins_with(PREFIX_ASSETS):
		safe_relative_path = safe_relative_path.trim_prefix(PREFIX_ASSETS)
	if safe_relative_path.is_empty():
		return ""

	var inner_asset_rel := DIR_ASSETS.path_join(safe_relative_path)
	var candidate_roots := get_mod_discovery_roots()
	# 按 user -> install -> dev 倒序检索，确保用户沙盒与安装目录高优先级覆盖开发基准包
	for root_cursor in range(candidate_roots.size() - 1, -1, -1):
		var root_directory := candidate_roots[root_cursor]
		var target_path := root_directory.path_join(clean_mod_id).path_join(inner_asset_rel)
		if ResourceLoader.exists(target_path) or FileAccess.file_exists(target_path):
			return target_path
		var narrative_path := root_directory.path_join("narratives").path_join(clean_mod_id).path_join(inner_asset_rel)
		if ResourceLoader.exists(narrative_path) or FileAccess.file_exists(narrative_path):
			return narrative_path
		var matched_kmod := _find_matching_kmod_in_root(root_directory, clean_mod_id, inner_asset_rel)
		if not matched_kmod.is_empty():
			return matched_kmod + "!/" + inner_asset_rel

	# 若三级级联均未探测到物理文件，返回首选沙盒物理路径（供资源探测或新建装配）
	if is_engineering_build():
		return ROOT_MODS_TIER0_DEV.path_join(clean_mod_id).path_join(inner_asset_rel)
	return ROOT_MODS_TIER2_USER_SANDBOX.path_join(clean_mod_id).path_join(inner_asset_rel)

static func _find_matching_kmod_in_root(root_directory: String, clean_mod_id: String, inner_asset_rel: String) -> String:
	var exact_kmod := root_directory.path_join(clean_mod_id + ".kmod")
	if FileAccess.file_exists(exact_kmod) and _kmod_has_asset(exact_kmod, inner_asset_rel):
		return exact_kmod
	var scan_handle := DirAccess.open(root_directory)
	if scan_handle == null:
		return ""
	var candidates: Array[String] = []
	scan_handle.list_dir_begin()
	var entry := scan_handle.get_next()
	while not entry.is_empty():
		if not scan_handle.current_is_dir() and entry.ends_with(".kmod"):
			if entry.begins_with(clean_mod_id + "_") or entry == clean_mod_id + ".kmod":
				candidates.append(root_directory.path_join(entry))
			elif _kmod_declares_pack_id(root_directory.path_join(entry), clean_mod_id):
				candidates.append(root_directory.path_join(entry))
		entry = scan_handle.get_next()
	scan_handle.list_dir_end()
	candidates.sort()
	for candidate_cursor in range(candidates.size() - 1, -1, -1):
		var archive_path := candidates[candidate_cursor]
		if _kmod_has_asset(archive_path, inner_asset_rel):
			return archive_path
	return ""

static func _kmod_declares_pack_id(kmod_path: String, expected_pack_id: String) -> bool:
	var reader := ZIPReader.new()
	if reader.open(kmod_path) != OK:
		return false
	var declared_id := ""
	if reader.file_exists("manifest.kdat"):
		var decoded: Variant = BinaryConfigReader.load_kdat_buffer(reader.read_file("manifest.kdat"))
		if decoded is Dictionary:
			var manifest := decoded as Dictionary
			declared_id = String(manifest.get("pack_id", manifest.get("bundle_id", ""))).strip_edges()
	reader.close()
	return declared_id == expected_pack_id

static func _has_installed_mod_named(mod_id_candidate: String) -> bool:
	var clean_id := sanitize_identifier(mod_id_candidate)
	if clean_id.is_empty() or clean_id != mod_id_candidate.strip_edges():
		return false
	for root_folder in get_mod_discovery_roots():
		if DirAccess.open(root_folder.path_join(clean_id)) != null:
			return true
		if FileAccess.file_exists(root_folder.path_join(clean_id + ".kmod")):
			return true
		if not _find_matching_kmod_in_root(root_folder, clean_id, "manifest.kdat").is_empty():
			return true
	return false

static func _kmod_has_asset(kmod_path: String, inner_rel_path: String) -> bool:
	var reader := ZIPReader.new()
	if reader.open(kmod_path) != OK:
		return false
	var exists := reader.file_exists(inner_rel_path)
	reader.close()
	return exists

## 从松散目录或 .kmod!/assets/... 虚路径流式读取二进制资产字节流
static func read_mod_asset_bytes(uri_or_path: String, fallback_mod_id: String = "") -> PackedByteArray:
	var kmod_direct_sep := uri_or_path.find(".kmod!/")
	var resolved := ""
	if kmod_direct_sep != -1 and (uri_or_path.begins_with(SCHEME_RES) or uri_or_path.begins_with(SCHEME_USER)):
		resolved = sanitize_sandbox_path_strict(uri_or_path)
	else:
		resolved = resolve_unified_uri(uri_or_path, fallback_mod_id)
	if resolved.is_empty():
		return PackedByteArray()
	var kmod_sep := resolved.find(".kmod!/")
	if kmod_sep != -1:
		var kmod_file := resolved.substr(0, kmod_sep + 5)
		var inner_path := resolved.substr(kmod_sep + 7)
		if sanitize_sandbox_path_strict(inner_path).is_empty():
			return PackedByteArray()
		var reader := ZIPReader.new()
		if reader.open(kmod_file) != OK:
			return PackedByteArray()
		var asset_bytes := reader.read_file(inner_path) if reader.file_exists(inner_path) else PackedByteArray()
		reader.close()
		return asset_bytes
	if FileAccess.file_exists(resolved):
		return FileAccess.get_file_as_bytes(resolved)
	return PackedByteArray()

# ==============================================================================
# 五、通用 URI 协议解析引擎 (Unified URI Scheme)
# ==============================================================================

## 解析任意格式的统一资源定位符（支持 official://, mod://, res://, user://；对越界向量 Fail-Closed 返回空串）
static func resolve_unified_uri(uri_or_path: String, fallback_mod_id: String = "") -> String:
	var trimmed := uri_or_path.strip_edges()
	if trimmed.is_empty():
		return ""

	# 1. 官方资产协议：official://... 优先查已激活官方 MOD 包，否则映射 res://assets/...
	if trimmed.begins_with(SCHEME_OFFICIAL):
		var relative_subpath := sanitize_sandbox_path_strict(trimmed.trim_prefix(SCHEME_OFFICIAL))
		if relative_subpath.is_empty():
			return ""
		return resolve_official_asset_path("", relative_subpath)

	# 2. 模组资产协议：mod://my_mod/assets/video.ogv 或 mod://assets/video.ogv 或 mod://textures/a.png (需 fallback_mod_id)
	if trimmed.begins_with(SCHEME_MOD):
		return _resolve_mod_scheme_uri(trimmed, fallback_mod_id)

	# 3. Godot 虚拟文件系统原生路径：res:// 或 user:// 执行严格穿越与空字节检测
	if trimmed.begins_with(SCHEME_RES) or trimmed.begins_with(SCHEME_USER):
		return sanitize_sandbox_path_strict(trimmed)

	# 4. 无协议纯相对路径：若提供了 fallback_mod_id 则解析为 MOD 资产，否则作为官方资产相对路径
	if not fallback_mod_id.is_empty():
		return resolve_mod_asset_path(fallback_mod_id, trimmed)
	var clean_relative_path := sanitize_sandbox_path_strict(trimmed)
	if clean_relative_path.is_empty():
		return ""
	if clean_relative_path.begins_with(PREFIX_ASSETS):
		clean_relative_path = clean_relative_path.trim_prefix(PREFIX_ASSETS)
	return ROOT_OFFICIAL_ASSETS.path_join(clean_relative_path)

static func _resolve_mod_scheme_uri(uri: String, fallback_mod_id: String) -> String:
	var after_scheme := uri.trim_prefix(SCHEME_MOD)
	if after_scheme.begins_with("//") or after_scheme.begins_with("\\\\"):
		return ""
	var raw_path := sanitize_sandbox_path_strict(after_scheme.trim_prefix("/"))
	if raw_path.is_empty():
		return ""
	var slash_index := raw_path.find("/")

	if slash_index > 0:
		var first_segment := raw_path.substr(0, slash_index)
		var rest_path := raw_path.substr(slash_index + 1)
		if first_segment == DIR_ASSETS and not fallback_mod_id.is_empty():
			return resolve_mod_asset_path(fallback_mod_id, rest_path)
		if ASSET_CATEGORY_SEGMENTS.has(first_segment) and not fallback_mod_id.is_empty() and not _has_installed_mod_named(first_segment):
			return resolve_mod_asset_path(fallback_mod_id, raw_path)
		if rest_path.begins_with(PREFIX_ASSETS):
			rest_path = rest_path.trim_prefix(PREFIX_ASSETS)
		return resolve_mod_asset_path(first_segment, rest_path)

	if not fallback_mod_id.is_empty():
		return resolve_mod_asset_path(fallback_mod_id, raw_path)
	return ""

# ==============================================================================
# 六、沙盒安全护栏（防路径穿越与非法字符）
# ==============================================================================

static func _hex_nibble_value(byte_code: int) -> int:
	if byte_code >= 48 and byte_code <= 57:
		return byte_code - 48
	if byte_code >= 65 and byte_code <= 70:
		return byte_code - 55
	if byte_code >= 97 and byte_code <= 102:
		return byte_code - 87
	return -1

static func _percent_decode_once_checked(raw_text: String) -> Dictionary:
	var source_bytes := raw_text.to_utf8_buffer()
	var decoded_bytes := PackedByteArray()
	var total_bytes := source_bytes.size()
	var byte_cursor := 0
	while byte_cursor < total_bytes:
		var current_byte := source_bytes[byte_cursor]
		if current_byte == 0:
			return {"unsafe": true, "decoded": ""}
		if current_byte == 37 and byte_cursor + 2 < total_bytes:
			var high_nibble := _hex_nibble_value(source_bytes[byte_cursor + 1])
			var low_nibble := _hex_nibble_value(source_bytes[byte_cursor + 2])
			if high_nibble >= 0 and low_nibble >= 0:
				var decoded_byte := (high_nibble << 4) | low_nibble
				if decoded_byte == 0:
					return {"unsafe": true, "decoded": ""}
				decoded_bytes.append(decoded_byte)
				byte_cursor += 3
				continue
		decoded_bytes.append(current_byte)
		byte_cursor += 1
	return {"unsafe": false, "decoded": decoded_bytes.get_string_from_utf8()}

static func _decode_and_check_unsafe_payload(raw_path: String) -> Dictionary:
	var candidate := raw_path
	for _pass in range(3):
		var lower := candidate.to_lower()
		if candidate.to_utf8_buffer().has(0) or lower.contains("%00"):
			return {"unsafe": true, "decoded": ""}
		for forbidden_control in ["\r", "\n", "\t"]:
			if candidate.contains(forbidden_control):
				return {"unsafe": true, "decoded": ""}
		var step_output := _percent_decode_once_checked(candidate)
		if bool(step_output.get("unsafe", false)):
			return {"unsafe": true, "decoded": ""}
		var next_decoded := String(step_output.get("decoded", ""))
		if next_decoded == candidate:
			break
		candidate = next_decoded
	var normalized := candidate.replace("\\", "/").strip_edges()
	return {"unsafe": false, "decoded": normalized}

## 严格沙盒路径防线 (Fail-Closed)：任意穿越(..)、编码穿越(%2e%2e)、空字节(%00/0x00)、盘符注入或 UNC 前缀一律返回空串 ""
static func sanitize_sandbox_path_strict(raw_path: String) -> String:
	var decoded_info := _decode_and_check_unsafe_payload(raw_path)
	if bool(decoded_info.get("unsafe", true)):
		return ""
	var clean := String(decoded_info.get("decoded", ""))
	if clean.is_empty() or clean.begins_with("//"):
		return ""
	var prefix := ""
	if clean.begins_with(SCHEME_RES):
		prefix = SCHEME_RES
		clean = clean.substr(SCHEME_RES.length())
	elif clean.begins_with(SCHEME_USER):
		prefix = SCHEME_USER
		clean = clean.substr(SCHEME_USER.length())
	if clean.contains(":"):
		return ""
	var segments := clean.split("/")
	var safe_segments: Array[String] = []
	for segment in segments:
		var clean_segment := segment.strip_edges()
		if clean_segment.is_empty():
			continue
		if clean_segment == "." or clean_segment == "..":
			return ""
		safe_segments.append(clean_segment)
	if safe_segments.is_empty():
		return ""
	return prefix + "/".join(safe_segments)

## 安全清洗子路径，先剥离空字节与解码编码载体再过滤 ".."、驱动器盘符等路径穿越模式
static func sanitize_sandbox_path(raw_path: String) -> String:
	var decoded_info := _decode_and_check_unsafe_payload(raw_path)
	if bool(decoded_info.get("unsafe", false)):
		return ""
	var clean := String(decoded_info.get("decoded", ""))
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

## 资产物理存在性探测（兼容 Godot 虚拟文件系统、外部物理文件与 .kmod!/ 归档内嵌资产）
static func asset_exists(canonical_path: String) -> bool:
	if canonical_path.is_empty():
		return false
	var kmod_sep := canonical_path.find(".kmod!/")
	if kmod_sep != -1:
		var kmod_file := canonical_path.substr(0, kmod_sep + 5)
		var inner_path := canonical_path.substr(kmod_sep + 7)
		if sanitize_sandbox_path_strict(inner_path).is_empty():
			return false
		if FileAccess.file_exists(kmod_file):
			return _kmod_has_asset(kmod_file, inner_path)
		return false
	if ResourceLoader.exists(canonical_path):
		return true
	if FileAccess.file_exists(canonical_path):
		return true
	return false
