# ==============================================================================
# 单元测试：配置层护栏 (Configuration Sanity Guard)
# 文件路径: res://tests/guards/test_configuration_guard.gd
# 职责: 校验「除数型 / 边界型」配置处于合法值域。配置驱动不等于放弃边界校验——
#       这些键会被用作除数、模数或分桶基数，若被热重载或人为改成 0 / 负值，
#       会在运行期产生整数模零崩溃、inf/NaN 污染或静默的语义错误。
# ==============================================================================
class_name TestConfigurationGuard extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_divisor_configs_positive())
	results.append(test_rate_configs_positive())
	results.append(test_gacha_probability_bounds())
	results.append(test_required_tables_present())
	results.append(test_reload_version_monotonic())
	# 批量读等价 + 路径分段缓存
	results.append(test_get_many_equivalence())
	# FifoBudget 最旧先出单次裁剪
	results.append(test_fifo_budget_trim_oldest())
	# 中性基座非空展示默认值 + 新补齐前端/基础设施键合法性
	results.append(test_neutral_display_defaults_and_extended_keys())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 43: 配置层护栏与值域校验", "all_passed": all_passed, "results": results }

## 用作除数 / 模数 / 分桶基数的配置必须为正
static func test_divisor_configs_positive() -> Dictionary:
	var specs := [
		["domains.deterministic", "lcg/modulus", 1000],
		["domains.feature_toggle_canary", "canary/bucket_size", 100],
		["infrastructure.clock", "hours_per_day", 24],
		["infrastructure.clock", "days_per_month", 30],
		["infrastructure.clock", "months_per_year", 12],
		["domains.potential", "point_cost/tier_size", 10.0],
		["domains.deterministic", "lcg/mask", 2147483647],
		["frontend.views", "fe08_mail_system/max_mailbox_capacity", 100],
		["frontend.views", "fe15_settings_center/revert_timeout_seconds", 15.0],
		["frontend.views", "fe02_main_hud/max_terminal_lines", 100],
	]
	var bad := []
	for spec in specs:
		var table: String = spec[0]
		var path: String = spec[1]
		var fallback = spec[2]
		var val: float = GameConfig.get_float(table, path, float(fallback))
		if val <= 0.0:
			bad.append("%s/%s=%f" % [table, path, val])
	return {
		"test": "TC-CFG-01: 除数型配置必须为正值", "passed": bad.is_empty(), "violations": bad
	}

## 货币汇率必须为正，否则钱包结算会产生 inf/NaN
static func test_rate_configs_positive() -> Dictionary:
	var metals := ["gold", "silver", "copper", "platinum"]
	var bad := []
	for m in metals:
		var rate: int = GameConfig.get_int("domains.currency", "rates/" + m, 0)
		if rate <= 0:
			bad.append(m + "=" + str(rate))
	return {
		"test": "TC-CFG-02: 货币层级汇率必须为正", "passed": bad.is_empty(), "violations": bad
	}

## 抽卡概率与保底阈值必须落在 [0,1] / 正整数域
static func test_gacha_probability_bounds() -> Dictionary:
	var base5 := GameConfig.get_float("domains.gacha", "rates/base_5star", 0.006)
	var base4 := GameConfig.get_float("domains.gacha", "rates/base_4star", 0.051)
	var soft := GameConfig.get_int("domains.gacha", "pity/soft_threshold", 70)
	var hard := GameConfig.get_int("domains.gacha", "pity/hard_threshold", 90)
	var passed := base5 >= 0.0 and base5 <= 1.0 and base4 >= 0.0 and base4 <= 1.0 \
		and soft > 0 and hard > 0 and soft < hard
	return {
		"test": "TC-CFG-03: 抽卡概率与保底阈值单调性", "passed": passed,
		"base5": base5, "soft": soft, "hard": hard
	}

## GameConfig 自报的必需表缺失数必须为 0
static func test_required_tables_present() -> Dictionary:
	var report := GameConfig.describe()
	var missing: Array = report.get("missing_required", [])
	return {
		"test": "TC-CFG-04: 必需配置表零缺失", "passed": missing.is_empty(),
		"count": report.get("count", 0), "missing": missing
	}

## 热重载原子发布——版本单调递增且必需表保持零缺失
static func test_reload_version_monotonic() -> Dictionary:
	var before := GameConfig.describe()
	var version_before: int = GameConfig.config_reload_version()
	var res := GameConfig.reload_config()
	var ok_publish: bool = res.get("success", false)
	var after := GameConfig.describe()
	var missing: Array = after.get("missing_required", [])
	var version_after: int = int(res.get("version", -1))
	# reload 成功路径已发布：必需表零缺失 + 表数不缩水 + 热重载版本严格递增
	var passed: bool = ok_publish and missing.is_empty() \
		and int(after.get("count", 0)) >= int(before.get("count", 0)) \
		and (version_after > version_before)
	return {
		"test": "TC-CFG-05: 配置热重载原子发布（版本单调/必需表零缺失/无半更新）",
		"passed": passed,
		"version": version_after, "missing": missing
	}

## get_many 批量读与逐键 get_value 逐位等价
## （含数值/嵌套路径/缺失键不出现；单次 ensure_loaded 后热路径取参通道）
static func test_get_many_equivalence() -> Dictionary:
	var paths := PackedStringArray([
		"participant_defaults/hp", "participant_defaults/ap", "kinetic/energy_coef",
		"interrupt_verbs/0", "nonexistent/deep/path"
	])
	var many: Dictionary = GameConfig.get_many("domains.combat", paths)
	var equal := true
	for p in paths:
		var single: Variant = GameConfig.get_value("domains.combat", p, null)
		if single == null:
			if many.has(p):
				equal = false
				break
		elif not many.has(p) or many[p] != single:
			equal = false
			break
	# 缺失键不入结果（语义：不抛错、调用方自带默认回退）
	var no_leak: bool = not many.has("nonexistent/deep/path")
	# 类型化宽松转换与逐键一致（int 键经 get_int 读取等价）
	var int_ok: bool = int(many.get("participant_defaults/ap", -1)) == GameConfig.get_int("domains.combat", "participant_defaults/ap", -1)
	var passed: bool = equal and no_leak and int_ok and many.size() == 4
	return {"test": "TC-CFG-06: get_many 批量读与逐键等价（缺失键零泄漏）", "passed": passed}

## FifoBudget.trim_oldest 最旧先出单次裁剪——
## 溢出裁最旧、未溢出零操作、max<0 无界、返回擦除数
static func test_fifo_budget_trim_oldest() -> Dictionary:
	var container := {"a": 1, "b": 2, "c": 3, "d": 4, "e": 5}
	# 溢出 3：裁最旧 3 个（a/b/c 按插入序），留 d/e
	var removed: int = FifoBudget.trim_oldest(container, 2)
	var cap_ok: bool = removed == 3 and container.size() == 2 \
		and container.has("d") and container.has("e") and not container.has("a")
	# 未溢出：零操作零擦除
	var untouched := {"x": 1, "y": 2}
	var noop: int = FifoBudget.trim_oldest(untouched, 10)
	var noop_ok: bool = noop == 0 and untouched.size() == 2
	# 无界（max < 0）：零操作
	var unbounded := {"p": 1, "q": 2}
	var unbounded_rm: int = FifoBudget.trim_oldest(unbounded, -1)
	var unbounded_ok: bool = unbounded_rm == 0 and unbounded.size() == 2
	var passed: bool = cap_ok and noop_ok and unbounded_ok
	return {"test": "TC-CFG-07: FifoBudget 最旧先出单次裁剪（溢出裁/未溢出零操作/无界）", "passed": passed}


## 中性基座非空展示默认值、零 MOD 失败拦截保留空 ID 与基础设施/前端新键校验
static func test_neutral_display_defaults_and_extended_keys() -> Dictionary:
	var violations: Array[String] = []
	var forbidden := ["卡拉尔", "瓦尔兰", "阿尔托莉雅"]
	var non_empty_specs := [
		["domains.gacha", "banner_defaults/banner_id"],
		["domains.gacha", "banner_defaults/banner_title"],
		["domains.gacha", "banner_defaults/fallback_title"],
		["domains.equipment", "loadout_defaults/loadout_name"],
		["domains.equipment", "loadout_defaults/fallback_name"],
		["domains.chat_command", "item_defaults/custom_name"],
		["domains.lattice", "ast_defaults/skill_name"],
		["domains.lattice", "ast_defaults/deserialize_skill_name"],
		["domains.lattice", "manuscript_defaults/custom_name"],
		["domains.monster", "body_part_defaults/part_name"],
		["domains.monster", "species_defaults/species_name"],
		["domains.npc", "defaults/personal_name"],
		["domains.quest", "quest_defaults/quest_title"],
		["domains.sovereignty", "nation_defaults/canonical_nation_name"],
		["domains.world", "town_defaults/town_name"],
		["domains.world_boss", "entity_defaults/boss_title"],
		["domains.world_boss", "entity_defaults/species_name"],
		["domains.account", "save_slot/defaults/current_location_name"],
		["infrastructure.persistence", "engine"],
	]
	for spec in non_empty_specs:
		var val := GameConfig.get_string(spec[0], spec[1], "").strip_edges()
		if val.is_empty():
			violations.append("展示默认键不可为空: %s/%s" % [spec[0], spec[1]])
			continue
		for tok in forbidden:
			if val.contains(tok):
				violations.append("基座展示键含禁用设定词(%s): %s/%s=%s" % [tok, spec[0], spec[1], val])

	if GameConfig.get_float("domains.combat", "player_defaults/hp_max", 0.0) <= 0.0:
		violations.append("domains.combat/player_defaults/hp_max 必须 > 0")
	if GameConfig.get_float("domains.combat", "damage_defaults/base_skill_damage", 0.0) <= 0.0:
		violations.append("domains.combat/damage_defaults/base_skill_damage 必须 > 0")
	if GameConfig.get_float("domains.economy", "shop/sell_back_ratio", 0.0) <= 0.0:
		violations.append("domains.economy/shop/sell_back_ratio 必须 > 0")
	if GameConfig.get_int("domains.gacha", "pity/four_star_threshold", 0) <= 0:
		violations.append("domains.gacha/pity/four_star_threshold 必须 > 0")
	var reg_fees := GameConfig.get_array("domains.identity_disguise", "registry_fees", [])
	if reg_fees.is_empty():
		violations.append("domains.identity_disguise/registry_fees 不可为空")
	var replay_speeds := GameConfig.get_array("domains.deterministic", "replay_defaults/speed_presets", [])
	if replay_speeds.is_empty():
		violations.append("domains.deterministic/replay_defaults/speed_presets 不可为空")

	# 零 MOD fail-closed 必需保留空字符串的创角与世界路由 ID 不可被虚假填充
	var fail_closed_empty := [
		["domains.world", "node_defaults/town_id"],
		["domains.world_gateway", "single_player/default_world_id"],
		["domains.character_creation", "defaults/default_race_id"],
	]
	for spec in fail_closed_empty:
		if not GameConfig.get_string(spec[0], spec[1], "__MISSING__").is_empty():
			violations.append("fail-closed 标识键应保持为空: %s/%s" % [spec[0], spec[1]])

	return {
		"test": "TC-CFG-08: 中性基座展示默认值与新补齐静态配置键合法性",
		"passed": violations.is_empty(),
		"violations": violations,
	}
