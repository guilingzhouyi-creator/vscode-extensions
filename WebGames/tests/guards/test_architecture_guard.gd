# ==============================================================================
# 单元测试：架构护栏 (Architecture Guard)
# 文件路径: res://tests/guards/test_architecture_guard.gd
# 职责: 以 config/infrastructure/domains.json 为唯一事实来源，校验「领域目录 / 配置表 /
#       测试注册 / 确定性约定 / 文档计数 / 配置键存在性」六方一致。新增领域若漏建配置
#       表、漏注册测试套件、漏同步文档计数，或代码读取了表里不存在的键，本套件会立即
#       变红，杜绝静默通过。
#
# 设计约束（务必遵守）:
#   1. 所有期望值均从磁盘推导，禁止写死领域总数 / 断言总数等易变数字。
#   2. 断言失败时输出完整违规清单，便于一次定位全部缺口。
# ==============================================================================
class_name TestArchitectureGuardDomain extends RefCounted

## 领域清单文件与根键
const MANIFEST_FILE: String = "res://config/infrastructure/domains.json"
const MANIFEST_ROOT_KEY: String = "domains"

## 领域源码根目录 / 后端根目录（确定性扫描范围）
const DOMAINS_DIR: String = "res://backend/domains"
const BACKEND_DIR: String = "res://backend"

## 配置表根目录（表名 <层>.<名> -> res://config/<层>/<名>.json）
const CONFIG_ROOT: String = "res://config/"

## 测试注册表文件与待校验的函数签名
const REGISTRY_FILE: String = "res://tests/test_registry.gd"
const REGISTRY_FUNC_SIGNATURE: String = "static func get_all_test_classes"

## 横切测试套件清单（非业务领域，不计入清单，属于全局规范或专项验收套件）
const CROSS_CUTTING_SUITES: Array[String] = [
	"res://tests/guards/test_configuration_guard.gd",
	"res://tests/guards/test_architecture_guard.gd",
	"res://tests/guards/test_frontend_boundary_guard.gd",
	"res://tests/unit/infrastructure/test_item_quality.gd",
	"res://tests/unit/infrastructure/test_magic_tier.gd",
	"res://tests/unit/infrastructure/test_name_registry.gd",
	"res://tests/unit/infrastructure/test_item_description.gd",
	"res://tests/unit/infrastructure/test_event_probability.gd",
	"res://tests/unit/infrastructure/test_event_description.gd",
	"res://tests/unit/infrastructure/test_copywriting.gd",
	"res://tests/unit/infrastructure/test_cdc.gd",
	"res://tests/unit/infrastructure/test_task_world_event.gd",
	"res://tests/unit/infrastructure/test_cdkey_eligibility.gd",
	"res://tests/unit/infrastructure/test_rule_scope.gd",
	"res://tests/unit/infrastructure/test_flow_orchestration.gd",
	"res://tests/unit/infrastructure/test_dynamic_economy.gd",
	"res://tests/integration/pipelines/test_contract_registry_pipeline.gd",
	"res://tests/integration/pipelines/test_game_lifecycle_pipeline.gd",
	"res://tests/integration/pipelines/test_performance_and_scalability_pipeline.gd",
	"res://tests/integration/pipelines/test_combat_dual_random_and_timeline_pipeline.gd",
	"res://tests/integration/pipelines/test_log_error_base_pipeline.gd",
	"res://tests/integration/pipelines/test_structured_log_pipeline.gd",
	"res://tests/unit/infrastructure/test_save_domain_contracts.gd",
	"res://tests/unit/infrastructure/test_save_migration_engine.gd",
	"res://tests/unit/infrastructure/test_editor_hot_reload.gd",
	"res://tests/unit/infrastructure/test_save_consistency_recovery.gd",
	"res://tests/unit/infrastructure/test_resource_lifecycle_governance.gd",
	"res://tests/unit/infrastructure/test_bounded_cache_and_idempotency.gd",
	"res://tests/guards/test_backend_robustness_guard.gd",
	"res://tests/unit/infrastructure/test_unified_logger_service.gd",
	"res://tests/integration/pipelines/test_combat_tertiary_timeline_pipeline.gd",
	"res://tests/integration/pipelines/test_item_attribute_affix_system_pipeline.gd",
	"res://tests/integration/pipelines/test_character_creation_and_opening_pipeline.gd",
	"res://tests/integration/pipelines/test_prologue_core_and_placeholder_pipeline.gd",
	"res://tests/integration/pipelines/test_narrative_dag_orchestration_pipeline.gd",
	"res://tests/integration/pipelines/test_game_loop_fsm_pipeline.gd",
	"res://tests/integration/pipelines/test_event_bus2_zero_gc_pipeline.gd",
	"res://tests/integration/pipelines/test_session_lifecycle_and_hud_sync_pipeline.gd",
	"res://tests/integration/pipelines/test_version_governance_pipeline.gd"
]

## 唯一允许出现全局随机字面调用的实现文件（内部为配置驱动的 LCG）
const RNG_IMPL_FILE: String = "deterministic_rng.gd"

## 禁用的 Godot 全局随机函数（依赖引擎内部状态，结果不可复现）
const FORBIDDEN_RANDOM_CALLS: Array[String] = ["randf", "randi", "randomize"]

## 标识符合法字符：用于判定随机调用是否为实例方法调用（rng.randf()）而非裸调用
const IDENT_CHARS: String = "._0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

## 配置键引用扫描：GameConfig.<getter>("表名", "键路径", ...) 的双字面量形式。
## 只匹配两个参数都是字符串字面量的调用——任一侧是变量/拼接表达式时静态不可推导，
## 正则天然不命中（拼接常量前缀如 "rates/" + metal 会命中前半段，由 _is_dynamic_key 剔除）。
const CONFIG_CALL_RE: String = "GameConfig\\.(?:get_string|get_int|get_float|get_bool|get_dict|get_array|get_value|has)\\s*\\(\\s*\"([^\"]+)\"\\s*,\\s*\"([^\"]*)\""

## 文档领域计数的校验位置：匹配到的每个数字都必须等于清单条目数
const DOC_FILES: Array[String] = ["res://README.md", "res://config/README.md"]
const DOMAIN_COUNT_PATTERNS: Array[String] = [
	"后端\\s*(\\d+)\\s*个业务领域",
	"#\\s*(\\d+)\\s*个业务领域",
	"覆盖\\s*(\\d+)\\s*领域",
	"\\|\\s*领域数\\s*\\|\\s*(\\d+)\\s*\\|",
	"领域总数\\s*[:：]\\s*(\\d+)"
]


static func run_all_tests() -> Dictionary:
	var manifest := _load_manifest()
	var results := []
	results.append(test_domain_dir_matches_manifest(manifest))
	results.append(test_config_tables_exist(manifest))
	results.append(test_registration_complete(manifest))
	results.append(test_no_global_random_calls())
	results.append(test_doc_domain_count(manifest))
	results.append(test_config_keys_exist(manifest))
	results.append(test_compatibility_retirement_backend_clean())
	results.append(test_account_slot_binding_solver_no_infra_path())
	results.append(test_account_slot_binding_solver_no_gameloop_stack())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return {
		"domain": "Domain %d: 架构护栏与领域清单一致性" % (manifest.size() + CROSS_CUTTING_SUITES.size()),
		"all_passed": all_passed,
		"results": results
	}


# ------------------------------------------------------------------------------
# TC-ARCH-01: 领域目录集合与清单 id 集合双向一致（含 depends_on 引用完整性）
# ------------------------------------------------------------------------------
static func test_domain_dir_matches_manifest(manifest: Array) -> Dictionary:
	var violations: Array[String] = []
	if manifest.is_empty():
		violations.append("领域清单为空或解析失败: " + MANIFEST_FILE)
		return _result("TC-ARCH-01: 领域目录集合与清单 id 集合双向一致", violations)

	var disk_ids := _list_domain_dirs()
	if disk_ids.is_empty():
		violations.append("未扫描到任何领域目录: " + DOMAINS_DIR)

	var manifest_ids: Array[String] = []
	var duplicates: Array[String] = []
	for entry in manifest:
		var id := _entry_str(entry, "id")
		if id.is_empty():
			violations.append("清单存在缺失 id 的条目")
			continue
		if manifest_ids.has(id):
			duplicates.append(id)
		else:
			manifest_ids.append(id)
	manifest_ids.sort()

	# 反向差集：磁盘有、清单无 -> 新增领域未登记
	for id in disk_ids:
		if not manifest_ids.has(id):
			violations.append("目录存在但清单未登记: backend/domains/%s" % id)
	# 正向差集：清单有、磁盘无 -> 领域已删除但清单未清理
	for id in manifest_ids:
		if not disk_ids.has(id):
			violations.append("清单已登记但目录缺失: backend/domains/%s" % id)
	# 清单自洽：id 唯一 + depends_on 引用完整
	for dup in duplicates:
		violations.append("清单 id 重复: " + dup)
	for entry in manifest:
		var owner := _entry_str(entry, "id")
		for dep in _entry_array(entry, "depends_on"):
			if not manifest_ids.has(dep):
				violations.append("depends_on 引用未登记领域: %s -> %s" % [owner, dep])

	return _result("TC-ARCH-01: 领域目录集合与清单 id 集合双向一致", violations)


# ------------------------------------------------------------------------------
# TC-ARCH-02: 清单声明的配置表/文案表存在，且代码引用的 domains.* 字面量均有落地表
# ------------------------------------------------------------------------------
static func test_config_tables_exist(manifest: Array) -> Dictionary:
	var violations: Array[String] = []
	if manifest.is_empty():
		violations.append("领域清单为空或解析失败: " + MANIFEST_FILE)
		return _result("TC-ARCH-02: 配置表与文案表齐备且代码字面量全部落地", violations)

	for entry in manifest:
		var id := _entry_str(entry, "id")
		var config_table := _entry_str(entry, "config")
		var narrative_table := _entry_str(entry, "narrative")

		if config_table.is_empty():
			violations.append("%s: 清单缺少 config 表名" % id)
		elif not _table_file_exists(config_table):
			violations.append("%s: 配置表缺失 %s -> %s" % [id, config_table, _table_path(config_table)])

		if narrative_table.is_empty():
			violations.append("%s: 清单缺少 narrative 表名" % id)
		elif not _table_file_exists(narrative_table):
			violations.append("%s: 文案表缺失 %s -> %s" % [id, narrative_table, _table_path(narrative_table)])

		# 扫描本领域全部 .gd，抽取 "domains.<x>" 字面量并断言对应表存在
		for table in _scan_domain_config_literals(id):
			if not _table_file_exists(table):
				violations.append("%s: 代码引用了不存在的配置表 %s -> %s" % [id, table, _table_path(table)])

	return _result("TC-ARCH-02: 配置表与文案表齐备且代码字面量全部落地", violations)


# ------------------------------------------------------------------------------
# TC-ARCH-03: 测试文件存在、已在注册表 preload、已进 get_all_test_classes()，总数自洽
# ------------------------------------------------------------------------------
static func test_registration_complete(manifest: Array) -> Dictionary:
	var violations: Array[String] = []
	if manifest.is_empty():
		violations.append("领域清单为空或解析失败: " + MANIFEST_FILE)
		return _result("TC-ARCH-03: 测试套件注册完整且注册表条目数自洽", violations)

	var registry_text := FileAccess.get_file_as_string(REGISTRY_FILE)
	if registry_text.is_empty():
		violations.append("无法读取测试注册表: " + REGISTRY_FILE)

	var body_start := registry_text.find(REGISTRY_FUNC_SIGNATURE)
	if body_start < 0:
		violations.append("注册表未找到函数: %s (%s)" % [REGISTRY_FUNC_SIGNATURE, REGISTRY_FILE])
	var registry_body := registry_text.substr(body_start) if body_start >= 0 else ""

	for entry in manifest:
		var id := _entry_str(entry, "id")
		var test_path := _entry_str(entry, "test")
		var symbol := _entry_str(entry, "test_symbol")

		if test_path.is_empty() or symbol.is_empty():
			violations.append("%s: 清单缺少 test 或 test_symbol" % id)
			continue
		if not FileAccess.file_exists(test_path):
			violations.append("%s: 测试文件缺失: %s" % [id, test_path])
			continue
		if registry_text.find("preload(\"%s\")" % test_path) < 0:
			violations.append("%s: 测试文件未在注册表 preload: %s" % [id, test_path])
		if body_start >= 0 and not _contains_symbol(registry_body, symbol):
			violations.append("%s: 测试符号 %s 未出现在 get_all_test_classes()" % [id, symbol])

	# 校验横切测试套件在注册表中全部 preload 登记
	for cc_path in CROSS_CUTTING_SUITES:
		if registry_text.find("preload(\"%s\")" % cc_path) < 0:
			violations.append("横切测试套件未在注册表 preload: %s" % cc_path)

	var cross_cutting_cnt := CROSS_CUTTING_SUITES.size()
	var expected := manifest.size() + cross_cutting_cnt
	var actual := TestRegistry.get_all_test_classes().size()
	if actual != expected:
		violations.append("注册表条目数不匹配: 期望 %d（清单 %d + 横切 %d），实际 %d" % [
			expected, manifest.size(), cross_cutting_cnt, actual
		])

	return _result("TC-ARCH-03: 测试套件注册完整且注册表条目数自洽", violations)


# ------------------------------------------------------------------------------
# TC-ARCH-04: 业务代码禁止裸调用 Godot 全局 randf()/randi()/randomize()
# ------------------------------------------------------------------------------
static func test_no_global_random_calls() -> Dictionary:
	var violations: Array[String] = []
	var scanned := 0
	for file_path in _collect_gd_files(BACKEND_DIR):
		if file_path.get_file() == RNG_IMPL_FILE:
			continue
		scanned += 1
		var source := FileAccess.get_file_as_string(file_path)
		for fn_name in _find_bare_random_calls(source):
			violations.append("%s: 禁用全局随机调用 %s()，请改用 DeterministicRNG" % [file_path, fn_name])
	if scanned == 0:
		violations.append("未扫描到任何后端脚本: " + BACKEND_DIR)

	return _result("TC-ARCH-04: 业务代码零全局随机调用（确定性约定）", violations)


# ------------------------------------------------------------------------------
# TC-ARCH-05: README 中的领域计数与清单条目数一致
# ------------------------------------------------------------------------------
static func test_doc_domain_count(manifest: Array) -> Dictionary:
	var violations: Array[String] = []
	if manifest.is_empty():
		violations.append("领域清单为空或解析失败: " + MANIFEST_FILE)
		return _result("TC-ARCH-05: 文档领域计数与清单条目数一致", violations)

	var expected := manifest.size()
	for doc in DOC_FILES:
		if not FileAccess.file_exists(doc):
			violations.append("文档缺失: " + doc)
			continue
		var text := FileAccess.get_file_as_string(doc)
		var matched := 0
		for pattern in DOMAIN_COUNT_PATTERNS:
			var re := RegEx.create_from_string(pattern)
			for m in re.search_all(text):
				matched += 1
				var found := m.get_string(1).to_int()
				if found != expected:
					violations.append("%s: 领域计数 %d 与清单条目数 %d 不一致（片段「%s」）" % [
						doc, found, expected, m.get_string(0).strip_edges()
					])
		if matched == 0:
			violations.append("%s: 未找到任何领域计数标记，文档已与清单脱钩" % doc)

	return _result("TC-ARCH-05: 文档领域计数与清单条目数一致", violations)


# ------------------------------------------------------------------------------
# TC-ARCH-06: 代码读取的「表 + 键路径」必须在配置表中真实存在
#   TC-ARCH-02 只做文件级拦截（表在不在）；本断言补上键级拦截（键在不在）。
#   没有它时，删掉某个键会让 GameConfig 静默回退到代码默认值——若默认值与表值
#   恰好一致，业务行为不变、测试全绿，配置驱动形同虚设。
# ------------------------------------------------------------------------------
static func test_config_keys_exist(manifest: Array) -> Dictionary:
	var violations: Array[String] = []
	if manifest.is_empty():
		violations.append("领域清单为空或解析失败: " + MANIFEST_FILE)
		return _result("TC-ARCH-06: 代码读取的配置键在表中真实存在", violations)

	var re := RegEx.create_from_string(CONFIG_CALL_RE)
	var checked := 0
	var skipped := 0
	for entry in manifest:
		var domain_id := _entry_str(entry, "id")
		for file_path in _collect_gd_files(DOMAINS_DIR.path_join(domain_id)):
			var source := _strip_comments(FileAccess.get_file_as_string(file_path))
			for m in re.search_all(source):
				var table := m.get_string(1)
				var key := m.get_string(2)
				if _is_dynamic_key(key):
					skipped += 1
					continue
				checked += 1
				var line := _line_of_offset(source, m.get_start())
				var keys: Variant = _table_keys(table)
				if not keys is Dictionary:
					_append_unique(violations, "%s: 配置表缺失或解析失败 %s -> %s（引用处 %s:%d）" % [
						domain_id, table, _table_path(table), file_path, line
					])
					continue
				var key_set := keys as Dictionary
				if not key_set.has(key):
					_append_unique(violations, "%s: 表 %s 缺少键 %s（引用处 %s:%d）" % [
						domain_id, table, key, file_path, line
					])
	if checked == 0:
		violations.append("未扫描到任何静态配置键引用: " + DOMAINS_DIR)

	return _result("TC-ARCH-06: 代码读取的配置键在表中真实存在", violations)


# ------------------------------------------------------------------------------
# TC-ARCH-07: 兼容层退役护栏断言（后端旧表/别名/直发/双路径/死配置彻底清零，Phase 83）
# ------------------------------------------------------------------------------
static func test_compatibility_retirement_backend_clean() -> Dictionary:
	var violations: Array[String] = []

	# 1. 断言旧文案表物理不存在 (R-03)
	if FileAccess.file_exists("res://config/descriptions/items.json"):
		violations.append("config/descriptions/items.json 必须彻底删除")
	if FileAccess.file_exists("res://config/narratives/events.json"):
		violations.append("config/narratives/events.json 必须彻底删除")

	# 2. 断言行动卡别名文件物理不存在 (R-06)
	if FileAccess.file_exists("res://backend/domains/magic_system/action_card_definition.gd"):
		violations.append("backend/domains/magic_system/action_card_definition.gd 必须彻底删除")

	# 3. 断言 domains.json 零 legacy_test_path 死字段残留 (R-07)
	var domains_json_str := FileAccess.get_file_as_string(MANIFEST_FILE)
	if domains_json_str.contains("legacy_test_path"):
		violations.append("domains.json 严禁残留 legacy_test_path 字段")

	# 4. 断言 backend/ 全域零旧路径符号引用 (R-03, R-04, R-06)
	#    经 _strip_comments 去注释后扫描——注释中的历史词形（如头注释提及旧别名）不是真实引用，
	#    与本文件既有字面量扫描同一剥离单源，杜绝子串误报脆弱点。
	var backend_files := _collect_gd_files(BACKEND_DIR)
	for file_path in backend_files:
		var content := _strip_comments(FileAccess.get_file_as_string(file_path))
		if content.contains("dispatch_rewards_direct"):
			violations.append("%s: 含有 dispatch_rewards_direct 残留引用" % file_path)
		if content.contains("ActionCardDefinition"):
			violations.append("%s: 含有 ActionCardDefinition 残留引用" % file_path)
		if content.contains("_legacy_fallback"):
			violations.append("%s: 含有 _legacy_fallback 残留引用" % file_path)

	# 5. 断言魔法基线解析器 registry 参数必填（去 = null，R-05；签名断言同样去注释后匹配）
	var tier_resolver := _strip_comments(FileAccess.get_file_as_string("res://backend/domains/item_namespace_registry/magic_ability_tier_resolver.gd"))
	if tier_resolver.contains("infer_tier_candidates(rank: int, registry: MagicTierRegistry = null)"):
		violations.append("magic_ability_tier_resolver.gd: infer_tier_candidates 必须移除 = null")
	var band_resolver := _strip_comments(FileAccess.get_file_as_string("res://backend/domains/item_namespace_registry/magic_rank_band_resolver.gd"))
	if band_resolver.contains("rank_to_band(rank: int, registry: MagicTierRegistry = null)"):
		violations.append("magic_rank_band_resolver.gd: rank_to_band 必须移除 = null")

	return _result("TC-ARCH-07: 兼容层退役护栏断言（后端旧表/别名/直发/双路径/死配置彻底清零）", violations)


# ------------------------------------------------------------------------------
# TC-ARCH-08A: 业务领域解耦护栏：账号槽位解算器严禁包含基础设施层预加载路径
# ------------------------------------------------------------------------------
static func test_account_slot_binding_solver_no_infra_path() -> Dictionary:
	var violations: Array[String] = []
	var solver_path := "res://backend/domains/account/account_slot_binding_solver.gd"
	if not FileAccess.file_exists(solver_path):
		violations.append("目标文件不存在: " + solver_path)
		return _result("TC-ARCH-08A: 账号槽位解算器严禁包含基础设施层预加载路径", violations)
	var content := _strip_comments(FileAccess.get_file_as_string(solver_path))
	if content.contains("res://backend/infrastructure/"):
		violations.append("account_slot_binding_solver.gd 严禁包含 res://backend/infrastructure/ 依赖")
	return _result("TC-ARCH-08A: 账号槽位解算器严禁包含基础设施层预加载路径", violations)


# ------------------------------------------------------------------------------
# TC-ARCH-08B: 业务领域解耦护栏：账号槽位解算器严禁引用 GameLoopStateStack
# ------------------------------------------------------------------------------
static func test_account_slot_binding_solver_no_gameloop_stack() -> Dictionary:
	var violations: Array[String] = []
	var solver_path := "res://backend/domains/account/account_slot_binding_solver.gd"
	if not FileAccess.file_exists(solver_path):
		violations.append("目标文件不存在: " + solver_path)
		return _result("TC-ARCH-08B: 账号槽位解算器严禁引用 GameLoopStateStack", violations)
	var content := _strip_comments(FileAccess.get_file_as_string(solver_path))
	if _contains_symbol(content, "GameLoopStateStack"):
		violations.append("account_slot_binding_solver.gd 严禁引用 GameLoopStateStack 符号")
	return _result("TC-ARCH-08B: 账号槽位解算器严禁引用 GameLoopStateStack", violations)


# ------------------------------------------------------------------------------
# 内部实现
# ------------------------------------------------------------------------------

## 去重追加：同一缺口只报一次，避免同一处问题在多行引用时刷屏
static func _append_unique(violations: Array[String], msg: String) -> void:
	if not violations.has(msg):
		violations.append(msg)


## 字符偏移 -> 行号（1 基），用于把违规定位到具体代码行
static func _line_of_offset(source: String, offset: int) -> int:
	return source.substr(0, clampi(offset, 0, source.length())).count("\n") + 1


## 键路径是否动态拼接（静态不可推导，必须跳过以免误报）：
##   空路径        -> 取表根，合法但不参与键校验
##   结尾 "/"      -> "rates/" + metal 之类的常量前缀拼接
##   含 "+" / "%"  -> 字符串拼接或格式化占位
static func _is_dynamic_key(key: String) -> bool:
	if key.is_empty():
		return true
	if key.ends_with("/"):
		return true
	if key.find("+") >= 0 or key.find("%") >= 0:
		return true
	return false


## 配置表的扁平化键集合缓存：<表名, Dictionary(键路径 -> true)>。
## 值为 null 表示表文件不存在或 JSON 解析失败（区别于「表存在但键缺失」）。
static var _table_key_cache: Dictionary = {}


## 取表的全部键路径（含中间层级与数组下标）；表缺失/解析失败时返回 null
static func _table_keys(table_name: String) -> Variant:
	if _table_key_cache.has(table_name):
		return _table_key_cache[table_name]
	var keys: Variant = null
	if _table_file_exists(table_name):
		var json := JSON.new()
		if json.parse(FileAccess.get_file_as_string(_table_path(table_name))) == OK:
			var flat := {}
			_flatten_keys(json.get_data(), "", flat)
			keys = flat
	_table_key_cache[table_name] = keys
	return keys


## 递归摊平：前缀路径本身也算一个合法键（get_dict(t, "cdkeys") 取的就是中间节点）
static func _flatten_keys(data: Variant, prefix: String, out: Dictionary) -> void:
	if prefix != "":
		out[prefix] = true
	if data is Dictionary:
		var d := data as Dictionary
		for k in d:
			_flatten_keys(d[k], _join_key_path(prefix, String(k)), out)
	elif data is Array:
		var a := data as Array
		for i in a.size():
			_flatten_keys(a[i], _join_key_path(prefix, str(i)), out)


static func _join_key_path(prefix: String, segment: String) -> String:
	return (prefix + "/" + segment) if prefix != "" else segment

## 统一结果包装：违规清单为空即通过，并附带违规明细便于排障
static func _result(test_name: String, violations: Array) -> Dictionary:
	return { "test": test_name, "passed": violations.is_empty(), "violations": violations }


## 从磁盘加载领域清单（直读 JSON，不依赖 GameConfig，避免护栏自身被配置层故障遮蔽）
static func _load_manifest() -> Array:
	if not FileAccess.file_exists(MANIFEST_FILE):
		push_warning("TestArchitectureGuard: 领域清单不存在: %s" % MANIFEST_FILE)
		return []
	var json := JSON.new()
	var err := json.parse(FileAccess.get_file_as_string(MANIFEST_FILE))
	if err != OK:
		push_warning("TestArchitectureGuard: 领域清单解析失败: %s (行 %d)" % [
			json.get_error_message(), json.get_error_line()
		])
		return []
	var data: Variant = json.get_data()
	if not data is Dictionary:
		push_warning("TestArchitectureGuard: 领域清单顶层必须是 JSON 对象")
		return []
	var list: Variant = (data as Dictionary).get(MANIFEST_ROOT_KEY, [])
	if not list is Array:
		push_warning("TestArchitectureGuard: 领域清单 %s 键必须是数组" % MANIFEST_ROOT_KEY)
		return []
	return list as Array


## 读取清单条目的字符串字段
static func _entry_str(entry: Variant, key: String) -> String:
	if not entry is Dictionary:
		return ""
	return String((entry as Dictionary).get(key, ""))


## 读取清单条目的字符串数组字段
static func _entry_array(entry: Variant, key: String) -> Array[String]:
	var out: Array[String] = []
	if not entry is Dictionary:
		return out
	var raw: Variant = (entry as Dictionary).get(key, [])
	if raw is Array:
		for item in raw as Array:
			out.append(String(item))
	return out


## 列出 backend/domains/ 下的全部目录名（headless 下 DirAccess 可用）
static func _list_domain_dirs() -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(DOMAINS_DIR)
	if dir == null:
		push_warning("TestArchitectureGuard: 无法打开领域目录: %s" % DOMAINS_DIR)
		return out
	for sub in dir.get_directories():
		var s := String(sub)
		if s == "contract_registry" or s == "lifecycle" or s == "version_governance":
			continue # 基础设施目录豁免（与 domains.json _meta.infra_dirs_exempt 真源一致）：契约注册表、生命周期治理与版本治理为全域基础设施目录，非单一业务领域
		out.append(s)
	out.sort()
	return out


## 递归收集目录下全部 .gd 脚本
static func _collect_gd_files(root: String) -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(root)
	if dir == null:
		return out
	for file_name in dir.get_files():
		if String(file_name).ends_with(".gd"):
			out.append(root.path_join(String(file_name)))
	for sub in dir.get_directories():
		out.append_array(_collect_gd_files(root.path_join(String(sub))))
	return out


## 表名 -> 配置文件路径：<层>.<名> -> res://config/<层>/<名>.json
static func _table_path(table_name: String) -> String:
	var parts := table_name.split(".")
	if parts.size() >= 2:
		return CONFIG_ROOT + parts[0] + "/" + parts[1] + ".json"
	return CONFIG_ROOT + table_name + ".json"


## 表文件是否存在
static func _table_file_exists(table_name: String) -> bool:
	return FileAccess.file_exists(_table_path(table_name))


## 扫描某领域目录下全部 .gd，抽取 "domains.<x>" 字符串字面量（去重、排序）
## 只剥离注释、保留字符串内容：注释里的历史表名/废弃示例不是真实引用，若连同源码
## 一起扫描会产生误报；而字符串内的字面量可能是动态表名拼接，必须保留。
static func _scan_domain_config_literals(domain_id: String) -> Array[String]:
	var out: Array[String] = []
	var re := RegEx.create_from_string("\"(domains\\.[A-Za-z0-9_]+)\"")
	for file_path in _collect_gd_files(DOMAINS_DIR.path_join(domain_id)):
		var source := _strip_comments(FileAccess.get_file_as_string(file_path))
		for m in re.search_all(source):
			var table := m.get_string(1)
			if not out.has(table):
				out.append(table)
	out.sort()
	return out


## 在文本中按标识符边界查找符号（避免 TestXxx 被更长符号误命中）
static func _contains_symbol(text: String, symbol: String) -> bool:
	var re := RegEx.create_from_string("\\b%s\\b" % symbol)
	return re.search(text) != null


## 查出源码中的裸随机调用（已剔除注释与字符串，排除实例方法调用）
static func _find_bare_random_calls(source: String) -> Array[String]:
	var code := _strip_non_code(source)
	var hits: Array[String] = []
	for fn_name in FORBIDDEN_RANDOM_CALLS:
		var re := RegEx.create_from_string("\\b%s\\s*\\(" % fn_name)
		for m in re.search_all(code):
			var start: int = m.get_start()
			if start > 0 and IDENT_CHARS.find(code.substr(start - 1, 1)) >= 0:
				continue  # rng.randf() / my_randf() 之类，非全局裸调用
			if not hits.has(fn_name):
				hits.append(fn_name)
	return hits


## 将注释与字符串内容替换为空格（保持字节长度与换行位置不变，便于按原文偏移定位）。
## 逐字节扫描以正确处理 UTF-8 中文与转义字符；GDScript 三引号文档串不在后端出现。
static func _strip_non_code(source: String) -> String:
	return _strip_by_mode(source, true)


## 仅剥离注释、保留字符串内容。用于「字面量引用扫描」类校验——注释属于人写给人看
## 的说明，不应被当作代码事实；字符串则可能是动态表名，必须参与扫描。
static func _strip_comments(source: String) -> String:
	return _strip_by_mode(source, false)


## 统一的注释/字符串剥离器。
## 字符串边界【始终】跟踪——否则 "a # b" 里的 # 会被误判为注释起点，造成漏检；
## blank_strings 仅决定字符串内容是否被清空：
##   true  -> 注释与字符串一并清空（用于随机调用扫描，按原文偏移定位）
##   false -> 只清空注释，保留字符串内容（用于字面量引用扫描）
static func _strip_by_mode(source: String, blank_strings: bool) -> String:
	var buf := source.to_utf8_buffer()
	var n := buf.size()
	var i := 0
	var in_line_comment := false
	var in_string := false
	var delim := 0
	while i < n:
		var b: int = buf[i]
		if in_line_comment:
			if b == 0x0A:  # \n
				in_line_comment = false
			else:
				buf[i] = 0x20
			i += 1
			continue
		if in_string:
			if b == 0x5C:  # 反斜杠转义：连跳两个字节
				if i + 1 < n:
					if blank_strings:
						buf[i] = 0x20
						buf[i + 1] = 0x20
					i += 2
				else:
					if blank_strings:
						buf[i] = 0x20
					i += 1
				continue
			if b == delim:
				in_string = false
				if blank_strings:
					buf[i] = 0x20
			elif b != 0x0A and blank_strings:
				buf[i] = 0x20
			i += 1
			continue
		if b == 0x23:  # '#' 行注释
			in_line_comment = true
			buf[i] = 0x20
			i += 1
			continue
		if b == 0x22 or b == 0x27:  # '"' 或 "'" 字符串
			in_string = true
			delim = b
			if blank_strings:
				buf[i] = 0x20
			i += 1
			continue
		i += 1
	return buf.get_string_from_utf8()
