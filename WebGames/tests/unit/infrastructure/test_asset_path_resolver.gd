# ==============================================================================
# 模块归属: 单元测试层 (Unit · 资源治理与寻址 (Resource Governance))
# 文件路径: res://tests/unit/infrastructure/test_asset_path_resolver.gd
# 架构定位: Asset Path Resolution & Environment Governance Test Suite
# 依赖与触发: 上游: TestRegistry | 下游: AssetPathResolver
# 职责说明: 验证全域艺术资源寻址、官方资产分类路径、MOD 三级级联发现与沙盒隔离；
#           验证统一 URI 协议解析（official://, mod://, res://, user://）；
#           验证工程版与发行版运行环境判定与测试隔离覆写机制；
#           验证防路径穿越（Anti-Path Traversal）与标识符清洗等刚性安全防线。
# 退出语义与设计依据: 三级级联安全路径隔离与双模式环境规约 (Inv-MOD-RELPATH-1 / Inv-PATH-TRAVERSAL-GUARD)
# ==============================================================================

class_name TestAssetPathResolver
extends RefCounted

# ==============================================================================
# 一、测试套件总入口
# ==============================================================================

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_build_mode_evaluation_and_test_override())
	results.append(test_official_asset_path_resolution())
	results.append(test_mod_asset_three_tier_cascade())
	results.append(test_unified_uri_scheme_parsing())
	results.append(test_sandbox_security_and_anti_traversal())
	results.append(test_versioned_kmod_precedence_and_strict_traversal())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break

	AssetPathResolver.reset_for_tests()

	return {
		"domain": "艺术资源寻址与环境裁决治理",
		"all_passed": all_passed,
		"results": results
	}

# ==============================================================================
# 二、核心测试场景 (TC-APR-01 ~ TC-APR-05)
# ==============================================================================

## TC-APR-01: 运行环境裁决与测试隔离覆写
static func test_build_mode_evaluation_and_test_override() -> Dictionary:
	AssetPathResolver.reset_for_tests()
	var default_mode := AssetPathResolver.get_current_build_mode()
	var default_valid: bool = (default_mode == AssetPathResolver.ENV_ENGINEERING or default_mode == AssetPathResolver.ENV_RELEASE)

	# 1. 模拟正式发行版
	AssetPathResolver.set_test_environment_override(AssetPathResolver.ENV_RELEASE)
	var release_ok: bool = AssetPathResolver.is_release_build() and (not AssetPathResolver.is_engineering_build())

	# 2. 模拟工程开发版
	AssetPathResolver.set_test_environment_override(AssetPathResolver.ENV_ENGINEERING)
	var engineering_ok: bool = AssetPathResolver.is_engineering_build() and (not AssetPathResolver.is_release_build())

	# 3. 重置测试状态
	AssetPathResolver.reset_for_tests()
	var reset_ok: bool = (AssetPathResolver.get_current_build_mode() == default_mode)

	var passed: bool = default_valid and release_ok and engineering_ok and reset_ok
	return {
		"test": "TC-APR-01: 运行环境裁决与测试隔离覆写",
		"passed": passed,
		"detail": "default=%s, release_ok=%s, eng_ok=%s, reset_ok=%s" % [default_mode, release_ok, engineering_ok, reset_ok]
	}

## TC-APR-02: 官方艺术资产分类路径标准化解析
static func test_official_asset_path_resolution() -> Dictionary:
	# 1. CG 视频路径解析
	var cutscene_path := AssetPathResolver.resolve_official_cutscene_path("prologue_awakening.ogv")
	var cs_ok: bool = (cutscene_path == "res://assets/media/cutscenes/prologue_awakening.ogv")

	# 2. 音频资产路径解析
	var audio_path := AssetPathResolver.resolve_official_audio_path("bgm", "theme_main.ogg")
	var audio_ok: bool = (audio_path == "res://assets/audio/bgm/theme_main.ogg")

	# 3. 容错剥离斜杠与冗余前缀
	var clean_path := AssetPathResolver.resolve_official_asset_path("/textures/ui/", "/button_start.png")
	var clean_ok: bool = (clean_path == "res://assets/textures/ui/button_start.png")

	var prefix_strip := AssetPathResolver.resolve_official_asset_path("assets/media/cutscenes", "assets/intro.ogv")
	var prefix_ok: bool = (prefix_strip == "res://assets/media/cutscenes/intro.ogv")

	var passed: bool = cs_ok and audio_ok and clean_ok and prefix_ok
	return {
		"test": "TC-APR-02: 官方艺术资产分类路径标准化解析",
		"passed": passed,
		"detail": "cs_ok=%s, audio_ok=%s, clean_ok=%s, prefix_ok=%s" % [cs_ok, audio_ok, clean_ok, prefix_ok]
	}

## TC-APR-03: MOD 艺术资产三级发现级联与沙盒寻址
static func test_mod_asset_three_tier_cascade() -> Dictionary:
	AssetPathResolver.reset_for_tests()

	# 1. 工程版级联验证 (包含 Tier 0: res://mods/)
	AssetPathResolver.set_test_environment_override(AssetPathResolver.ENV_ENGINEERING)
	var eng_roots := AssetPathResolver.get_mod_discovery_roots()
	var eng_has_tier0: bool = eng_roots.has(AssetPathResolver.ROOT_MODS_TIER0_DEV)
	var eng_has_tier2: bool = eng_roots.has(AssetPathResolver.ROOT_MODS_TIER2_USER_SANDBOX)

	# 2. 发行版级联验证 (排除 Tier 0，严格限制在可执行同级与用户沙盒)
	AssetPathResolver.set_test_environment_override(AssetPathResolver.ENV_RELEASE)
	var rel_roots := AssetPathResolver.get_mod_discovery_roots()
	var rel_excludes_tier0: bool = not rel_roots.has(AssetPathResolver.ROOT_MODS_TIER0_DEV)
	var rel_has_tier2: bool = rel_roots.has(AssetPathResolver.ROOT_MODS_TIER2_USER_SANDBOX)

	# 3. 模拟测试根目录覆写
	var mock_roots: Array[String] = ["user://mock_tier0/", "user://mock_tier1/"]
	AssetPathResolver.set_test_roots_override(mock_roots)
	var mocked := AssetPathResolver.get_mod_discovery_roots()
	var mock_ok: bool = (mocked.size() == 2 and mocked[0] == "user://mock_tier0/")

	# 4. 未命中物理文件时的安全沙盒回退路径
	AssetPathResolver.reset_for_tests()
	AssetPathResolver.set_test_environment_override(AssetPathResolver.ENV_RELEASE)
	var fallback_path := AssetPathResolver.resolve_mod_asset_path("custom_pack", "media/cutscenes/ending.ogv")
	var fallback_ok: bool = (fallback_path == "user://mods/custom_pack/assets/media/cutscenes/ending.ogv")

	AssetPathResolver.reset_for_tests()

	var passed: bool = eng_has_tier0 and eng_has_tier2 and rel_excludes_tier0 and rel_has_tier2 and mock_ok and fallback_ok
	return {
		"test": "TC-APR-03: MOD 艺术资产三级发现级联与沙盒寻址",
		"passed": passed,
		"detail": "eng_t0=%s, rel_no_t0=%s, mock_ok=%s, fallback_ok=%s" % [eng_has_tier0, rel_excludes_tier0, mock_ok, fallback_ok]
	}

## TC-APR-04: 统一 URI 协议头泛化解析
static func test_unified_uri_scheme_parsing() -> Dictionary:
	AssetPathResolver.reset_for_tests()
	AssetPathResolver.set_test_environment_override(AssetPathResolver.ENV_ENGINEERING)

	# 1. 官方协议 official://
	var off_uri := AssetPathResolver.resolve_unified_uri("official://media/cutscenes/prologue.ogv")
	var off_ok: bool = (off_uri == "res://assets/media/cutscenes/prologue.ogv")

	# 2. 模组协议 mod://<mod_id>/assets/...
	var mod_uri1 := AssetPathResolver.resolve_unified_uri("mod://story_pack/assets/media/cutscenes/chapter2.ogv")
	var mod1_ok: bool = (mod_uri1 == "res://mods/story_pack/assets/media/cutscenes/chapter2.ogv")

	# 3. 模组协议 mod://<mod_id>/... (不显式带 assets)
	var mod_uri2 := AssetPathResolver.resolve_unified_uri("mod://story_pack/media/cutscenes/chapter2.ogv")
	var mod2_ok: bool = (mod_uri2 == "res://mods/story_pack/assets/media/cutscenes/chapter2.ogv")

	# 4. 原生虚拟路径 res:// 与 user:// 直接安全清洗保留
	var res_uri := AssetPathResolver.resolve_unified_uri("res://assets/textures/ui/icon.png")
	var res_ok: bool = (res_uri == "res://assets/textures/ui/icon.png")

	var user_uri := AssetPathResolver.resolve_unified_uri("user://mods/my_pack/assets/custom.png")
	var user_ok: bool = (user_uri == "user://mods/my_pack/assets/custom.png")

	# 5. 纯相对路径官方回退与指定 fallback_mod_id
	var bare_off := AssetPathResolver.resolve_unified_uri("textures/items/sword.png")
	var bare_off_ok: bool = (bare_off == "res://assets/textures/items/sword.png")

	var bare_mod := AssetPathResolver.resolve_unified_uri("textures/items/sword.png", "dlc_pack")
	var bare_mod_ok: bool = (bare_mod == "res://mods/dlc_pack/assets/textures/items/sword.png")

	AssetPathResolver.reset_for_tests()

	var passed: bool = off_ok and mod1_ok and mod2_ok and res_ok and user_ok and bare_off_ok and bare_mod_ok
	return {
		"test": "TC-APR-04: 统一 URI 协议头泛化解析",
		"passed": passed,
		"detail": "off_ok=%s, mod1_ok=%s, mod2_ok=%s, res_ok=%s, user_ok=%s, bare_off_ok=%s, bare_mod_ok=%s" % [
			off_ok, mod1_ok, mod2_ok, res_ok, user_ok, bare_off_ok, bare_mod_ok
		]
	}

## TC-APR-05: 沙盒安全护栏与防路径穿越
static func test_sandbox_security_and_anti_traversal() -> Dictionary:
	# 1. 防相对越级向上一级跃迁 ".."
	var dirty_path := "../../etc/passwd"
	var safe_path := AssetPathResolver.sanitize_sandbox_path(dirty_path)
	var traversal_ok: bool = (safe_path == "etc/passwd") and (not safe_path.contains(".."))

	# 2. res:// 协议内的越级向上一级清洗
	var dirty_res := "res://assets/../../secret_key.txt"
	var safe_res := AssetPathResolver.sanitize_sandbox_path(dirty_res)
	var res_ok: bool = (safe_res == "res://assets/secret_key.txt")

	# 3. 盘符注入拦截
	var win_drive: String = String.chr(67) + ":"
	var win_path := win_drive + "/Windows/System32/calc.exe"
	var safe_win := AssetPathResolver.sanitize_sandbox_path(win_path)
	var win_ok: bool = (not safe_win.contains(":")) and (safe_win == "Windows/System32/calc.exe")

	# 4. 反斜杠标准化为正斜杠
	var backslash_path := "media\\cutscenes\\intro.ogv"
	var safe_bs := AssetPathResolver.sanitize_sandbox_path(backslash_path)
	var bs_ok: bool = (safe_bs == "media/cutscenes/intro.ogv")

	# 5. 标识符非法字符剔除
	var dirty_id := "evil_pack$#@!/escape"
	var safe_id := AssetPathResolver.sanitize_identifier(dirty_id)
	var id_ok: bool = (safe_id == "evil_packescape")

	var passed: bool = traversal_ok and res_ok and win_ok and bs_ok and id_ok
	return {
		"test": "TC-APR-05: 沙盒安全护栏与防路径穿越",
		"passed": passed,
		"detail": "traversal_ok=%s, res_ok=%s, win_ok=%s, bs_ok=%s, id_ok=%s" % [traversal_ok, res_ok, win_ok, bs_ok, id_ok]
	}


## TC-APR-06: 版本化 .kmod 寻址、user > install 优先覆盖及严格编码穿越拦截
static func test_versioned_kmod_precedence_and_strict_traversal() -> Dictionary:
	var install_root := "user://test_apr06_install"
	var user_root := "user://test_apr06_user"
	_apr06_cleanup_dir(install_root)
	_apr06_cleanup_dir(user_root)
	_apr06_write_kmod(install_root.path_join("mod_versioned_sample_1.0.0.kmod"), "mod_versioned_sample", "1.0.0", "assets/textures/banner.txt", "INSTALL_V1".to_utf8_buffer())
	_apr06_write_kmod(user_root.path_join("mod_versioned_sample_2.0.0.kmod"), "mod_versioned_sample", "2.0.0", "assets/textures/banner.txt", "USER_V2".to_utf8_buffer())

	AssetPathResolver.set_test_roots_override([install_root, user_root])
	var resolved_kmod := AssetPathResolver.resolve_mod_asset_path("mod_versioned_sample", "textures/banner.txt")
	var exists_ok := AssetPathResolver.asset_exists(resolved_kmod) and not AssetPathResolver.asset_exists(user_root.path_join("mod_versioned_sample_2.0.0.kmod!/assets/textures/missing.txt"))
	var payload_ok := AssetPathResolver.read_mod_asset_bytes("mod://textures/banner.txt", "mod_versioned_sample").get_string_from_utf8() == "USER_V2"
	var precedence_ok := resolved_kmod.begins_with(user_root)

	var pct_dot := AssetPathResolver.resolve_unified_uri("mod://mod_versioned_sample/%2e%2e/secret.txt")
	var double_pct := AssetPathResolver.sanitize_sandbox_path_strict("textures/%252e%252e/secret.txt")
	var nul_block := AssetPathResolver.resolve_mod_asset_path("mod_versioned_sample", "textures/a%00.png")
	var strict_guard_ok := pct_dot.is_empty() and double_pct.is_empty() and nul_block.is_empty()

	AssetPathResolver.reset_for_tests()
	_apr06_cleanup_dir(install_root)
	_apr06_cleanup_dir(user_root)

	var passed := precedence_ok and exists_ok and payload_ok and strict_guard_ok
	return {
		"test": "TC-APR-06: 版本化 .kmod 优先覆写、归档存在性与编码穿越严格阻断",
		"passed": passed,
		"detail": "precedence_ok=%s, exists_ok=%s, payload_ok=%s, strict_guard_ok=%s, pct='%s', double='%s', nul='%s'" % [
			precedence_ok, exists_ok, payload_ok, strict_guard_ok, pct_dot, double_pct, nul_block
		]
	}


static func _apr06_write_kmod(kmod_path: String, pack_id: String, ver: String, asset_entry: String, asset_bytes: PackedByteArray) -> void:
	DirAccess.make_dir_recursive_absolute(kmod_path.get_base_dir())
	var packer := ZIPPacker.new()
	if packer.open(kmod_path) != OK:
		return
	packer.start_file("pack.json")
	packer.write_file(JSON.stringify({"pack_id": pack_id, "version": ver}).to_utf8_buffer())
	packer.close_file()
	packer.start_file(asset_entry)
	packer.write_file(asset_bytes)
	packer.close_file()
	packer.close()


static func _apr06_cleanup_dir(dir_path: String) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		return
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var item := dir.get_next()
	while not item.is_empty():
		var current := item
		var is_subdir := dir.current_is_dir()
		item = dir.get_next()
		if current == "." or current == "..":
			continue
		var sub_path := dir_path.path_join(current)
		if is_subdir:
			_apr06_cleanup_dir(sub_path)
		else:
			DirAccess.remove_absolute(sub_path)
	dir.list_dir_end()
	DirAccess.remove_absolute(dir_path)
