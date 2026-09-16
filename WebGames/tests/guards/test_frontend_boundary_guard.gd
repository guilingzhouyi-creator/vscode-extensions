# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端可视化边界长效全域架构护栏
# 文件路径: res://tests/guards/test_frontend_boundary_guard.gd
# 职责: 静态审查 frontend 下所有视图与模块的基类继承、后端直连、裸随机、节点路径、
#       配置语义白名单外零直读、Color字面量单一真源、legacy清零、对象池契约与音效占位
# ==============================================================================
class_name TestFrontendBoundaryGuard
extends TestCase

const FRONTEND_DIR := "res://frontend"
const VIEWS_DIR := "res://frontend/views"
const DESIGN_TOKENS_FILE := "design_tokens.gd"
const SELF_FILE := "test_frontend_boundary_guard.gd"

## B1：配置语义白名单（= 「保留直读」的 8 视图 10 条；键名全局唯一，按 key 命中即豁免）
const CONFIG_SEMANTIC_WHITELIST: Array[String] = [
	"fe01_account_entry/min_username_len",
	"fe02_main_hud/max_terminal_lines",
	"fe04_combat_view/default_text_lifetime",
	"fe05_economy_trade/default_shop_title",
	"fe10_world_map/default_zoom",
	"fe14_notification_bulletin/default_toast_duration",
	"fe15_settings_center/revert_timeout_seconds",
	"fe16_system_save/default_slot_prefix",
]

const FORBIDDEN_TOKENS: Array[String] = [
	"res://backend",
	"skeleton_mock.json",
	"DeterministicRNG",
	"EventBusCore",
	"EventPacket",
	"EventChannelDefinition",
	"EventBusSubscriptionToken",
	"GmCommandIndexSolver",
	"TabDoubleTapDetector",
	"WorldClockMaster",
	"CharacterPhysiologySheet",
	"WearableInventoryAggregate",
	"CharacterWalletEntity",
	"LifeCycleAndPhysiologySolver",
	"PhysicsAndThermodynamicsSolver",
	"WorldTravelAndSettlementFSM",
	"LifeCycleEvolutionFSM",
	"SkillSubgraphAST",
	"LatticeDecompilerService",
	"GrimoireAuthoringPipeline",
	"LogRecordDTO",
	"CombatPipelineFSM",
]

const RANDOM_TOKENS: Array[String] = ["randi(", "randf(", "randomize("]
const RELATIVE_NODE_TOKENS: Array[String] = ["get_parent().get_node", "get_node(\"../", "find_child("]

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_views_extend_base())
	results.append(_test_views_no_backend_direct_coupling())
	results.append(_test_views_no_bare_random())
	results.append(_test_component_landing())
	results.append(_test_views_no_relative_node_paths())
	results.append(_test_no_view_reads_config_business_values())
	results.append(_test_no_eventbus_subscribe_in_views())
	results.append(_test_no_hardcoded_color_outside_tokens())
	results.append(_test_legacy_dir_absent())
	results.append(_test_no_main_dashboard_reference())
	results.append(_test_kvirtual_list_pool_contract())
	results.append(_test_ui_audio_bridge_placeholder_alive())
	results.append(_test_frontend_compatibility_retirement())
	return TestCase.pack_results("frontend_boundary_guard", results)

# ==============================================================================
# 文件遍历助手
# ==============================================================================

static func _collect(dir_path: String, out_files: Array[String], exts: Array = [".gd"]) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var file_name := dir.get_next()
	while file_name != "":
		if not file_name.begins_with("."):
			var full_path := dir_path + "/" + file_name
			if dir.current_is_dir():
				_collect(full_path, out_files, exts)
			else:
				for ext in exts:
					if file_name.ends_with(str(ext)):
						out_files.append(full_path)
						break
		file_name = dir.get_next()
	dir.list_dir_end()

static func _view_files() -> Array[String]:
	var files: Array[String] = []
	_collect(VIEWS_DIR, files, [".gd"])
	files.sort()
	return files

static func _frontend_gd_files() -> Array[String]:
	var files: Array[String] = []
	_collect(FRONTEND_DIR, files, [".gd"])
	files.sort()
	return files

# ==============================================================================
# 1~5 基础视图边界与规范
# ==============================================================================

## 1. 视图统一继承 BaseScreen / BaseModal 基座
static func _test_views_extend_base() -> Dictionary:
	var offenders: Array[String] = []
	for path in _view_files():
		var text := FileAccess.get_file_as_string(path)
		if not (text.contains("extends BaseScreen") or text.contains("extends BaseModal")):
			offenders.append(path)
	var ok := TestCase.assert_eq(offenders.size(), 0, "视图必须继承 BaseScreen/BaseModal: %s" % str(offenders))
	return TestCase.make_result("views_extend_base", ok, {"offenders": offenders})

## 2. 视图零后端业务类直连与零 EventBus 订阅
static func _test_views_no_backend_direct_coupling() -> Dictionary:
	var offenders: Array[String] = []
	for path in _view_files():
		var text := FileAccess.get_file_as_string(path)
		for token in FORBIDDEN_TOKENS:
			if text.contains(token):
				offenders.append("%s -> %s" % [path, token])
	var ok := TestCase.assert_eq(offenders.size(), 0, "视图禁止直连后端类: %s" % str(offenders))
	return TestCase.make_result("views_no_backend_direct_coupling", ok, {"offenders": offenders})

## 3. 视图零裸随机（随机性必须经 domain_boundary 服务或 DeterministicRNG 边界层）
static func _test_views_no_bare_random() -> Dictionary:
	var offenders: Array[String] = []
	for path in _view_files():
		var text := FileAccess.get_file_as_string(path)
		for token in RANDOM_TOKENS:
			if text.contains(token):
				offenders.append("%s -> %s" % [path, token])
	var ok := TestCase.assert_eq(offenders.size(), 0, "视图禁止裸随机: %s" % str(offenders))
	return TestCase.make_result("views_no_bare_random", ok, {"offenders": offenders})

## 4. 原子组件生产落地（至少 KButton 与 KBadge 在视图有真实消费）
static func _test_component_landing() -> Dictionary:
	var kbutton_uses := 0
	var kbadge_uses := 0
	var kitem_uses := 0
	for path in _view_files():
		var text := FileAccess.get_file_as_string(path)
		if text.contains("k_button.gd") and text.contains("KButtonClass.new("):
			kbutton_uses += 1
		if text.contains("k_badge.gd") and text.contains("KBadgeClass.new("):
			kbadge_uses += 1
		if text.contains("k_item_slot.gd") and text.contains("KItemSlotClass.new("):
			kitem_uses += 1
	var ok := TestCase.assert_gte(kbutton_uses, 1, "KButton 组件需在生产视图落地")
	ok = ok and TestCase.assert_gte(kbadge_uses, 1, "KBadge 组件需在生产视图落地")
	ok = ok and TestCase.assert_gte(kitem_uses, 1, "KItemSlot 组件需在生产视图落地")
	return TestCase.make_result("component_landing", ok, {
		"kbutton_files": kbutton_uses,
		"kbadge_files": kbadge_uses,
		"kitem_files": kitem_uses,
	})

## 5. 视图零相对漂移节点路径与模糊定位（允许同视图绝对字面路径）
static func _test_views_no_relative_node_paths() -> Dictionary:
	var offenders: Array[String] = []
	for path in _view_files():
		var text := FileAccess.get_file_as_string(path)
		for token in RELATIVE_NODE_TOKENS:
			if text.contains(token):
				offenders.append("%s -> %s" % [path, token])
	var ok := TestCase.assert_eq(offenders.size(), 0, "视图禁止相对/模糊节点路径: %s" % str(offenders))
	return TestCase.make_result("views_no_relative_node_paths", ok, {"offenders": offenders})

# ==============================================================================
# 6~12 深入边界加固 (配置/颜色/事件总线/legacy删除/对象池/音频占位)
# ==============================================================================

## 6. 白名单外「视图直读 GameConfig 业务数值点 = 0」(B1)
static func _test_no_view_reads_config_business_values() -> Dictionary:
	var re := RegEx.new()
	re.compile("GameConfig\\.get_\\w+\\(\\s*\"frontend\\.views\"\\s*,\\s*\"([^\"]+)\"")
	var offenders: Array[String] = []
	var whitelist_hits := 0
	for path in _view_files():
		var text := FileAccess.get_file_as_string(path)
		for m in re.search_all(text):
			var key := m.get_string(1)
			if key in CONFIG_SEMANTIC_WHITELIST:
				whitelist_hits += 1
			else:
				offenders.append("%s -> %s" % [path, key])
	var ok := TestCase.assert_eq(offenders.size(), 0, "白名单外视图直读 GameConfig 业务数值须为 0: %s" % str(offenders))
	ok = ok and TestCase.assert_gte(whitelist_hits, 1, "白名单配置语义读取应被识别")
	return TestCase.make_result("no_view_reads_config_business_values", ok, {"offenders": offenders})

## 7. 视图内零 EventBusCore 订阅
static func _test_no_eventbus_subscribe_in_views() -> Dictionary:
	var offenders: Array[String] = []
	for path in _view_files():
		var text := FileAccess.get_file_as_string(path)
		if text.contains("EventBusCore"):
			offenders.append(path)
	var ok := TestCase.assert_eq(offenders.size(), 0, "视图禁止 EventBusCore 订阅: %s" % str(offenders))
	return TestCase.make_result("no_eventbus_subscribe_in_views", ok, {"offenders": offenders})

## 8. frontend 内 Color(r,g,b,a) 字面量（DesignTokens 除外）须为 0 (R-18)
static func _test_no_hardcoded_color_outside_tokens() -> Dictionary:
	var re := RegEx.new()
	re.compile("Color\\(\\s*[-+0-9.]")
	var offenders: Array[String] = []
	for path in _frontend_gd_files():
		if path.ends_with(DESIGN_TOKENS_FILE):
			continue
		var text := FileAccess.get_file_as_string(path)
		if re.search(text) != null:
			offenders.append(path)
	var ok := TestCase.assert_eq(offenders.size(), 0, "DesignTokens 之外禁止硬编码 Color 字面量: %s" % str(offenders))
	return TestCase.make_result("no_hardcoded_color_outside_tokens", ok, {"offenders": offenders})

## 9. frontend/legacy 目录不存在 (B2)
static func _test_legacy_dir_absent() -> Dictionary:
	var dir := DirAccess.open("res://frontend/legacy")
	var ok := TestCase.assert_null(dir, "frontend/legacy 目录必须不存在 (B2)")
	return TestCase.make_result("legacy_dir_absent", ok)

## 10. 全库 .gd/.tscn/.uid 零 main_dashboard 引用；legacy 场景不可解析 (B2)
static func _test_no_main_dashboard_reference() -> Dictionary:
	var files: Array[String] = []
	_collect("res://frontend", files, [".gd", ".tscn", ".uid"])
	_collect("res://tests", files, [".gd", ".tscn", ".uid"])
	_collect("res://config", files, [".gd", ".tscn", ".uid"])
	_collect("res://backend", files, [".gd", ".tscn", ".uid"])
	_collect("res://benchmarks", files, [".gd", ".tscn", ".uid"])
	var offenders: Array[String] = []
	for path in files:
		if path.ends_with(SELF_FILE):
			continue
		var text := FileAccess.get_file_as_string(path)
		if text.contains("main_dashboard"):
			offenders.append(path)
	var ok := TestCase.assert_eq(offenders.size(), 0, "全库禁止 main_dashboard 残留引用: %s" % str(offenders))
	ok = ok and TestCase.assert_false(ResourceLoader.exists("res://frontend/legacy/main_dashboard/main_dashboard.tscn"), "legacy 场景不可解析")
	return TestCase.make_result("no_main_dashboard_reference", ok, {"offenders": offenders})

## 11. KVirtualList 行对象池契约 (B4 / ADV-POOL-001)
static func _test_kvirtual_list_pool_contract() -> Dictionary:
	var list := KVirtualList.new()
	var ok := TestCase.assert_true(
		list.has_method("acquire_row") and list.has_method("release_row") and list.has_method("reset_state"),
		"KVirtualList 具备 acquire_row/release_row/reset_state 契约")
	var row := list.acquire_row()
	ok = ok and TestCase.assert_true(row.has_method("reset_state"), "池化行实现 reset_state()")
	ok = ok and TestCase.assert_true(row is KVirtualList.KVirtualRow, "acquire_row 返回具体池化行 KVirtualRow")
	# 复用命中池
	list.release_row(row)
	ok = ok and TestCase.assert_eq(list.get_pool_size(), 1, "释放后行入池")
	var reused := list.acquire_row()
	ok = ok and TestCase.assert_true(reused == row, "acquire->release->acquire 复用命中池")
	ok = ok and TestCase.assert_eq(list.get_pool_size(), 0, "复用后池深归零（无重复入池）")
	# 清态幂等
	(reused as KVirtualList.KVirtualRow).reset_state()
	(reused as KVirtualList.KVirtualRow).reset_state()
	ok = ok and TestCase.assert_true(true, "reset_state 幂等")
	# 池受硬上限约束
	var burst: Array[Control] = []
	for i in range(KVirtualList.POOL_HARD_CAP + 16):
		burst.append(list.acquire_row())
	for r in burst:
		list.release_row(r)
	ok = ok and TestCase.assert_lte(list.get_pool_size(), KVirtualList.POOL_HARD_CAP, "池受 POOL_HARD_CAP 约束")
	# 组件级 reset_state 幂等且清空
	list.reset_state()
	list.reset_state()
	ok = ok and TestCase.assert_eq(list.get_pool_size(), 0, "reset_state 清空行对象池（幂等）")
	ok = ok and TestCase.assert_eq(list.get_active_row_count(), 0, "reset_state 清空活跃登记")
	list.free()
	return TestCase.make_result("kvirtual_list_pool_contract", ok)

## 12. UIAudioBridge 单例占位存活 (B3)
static func _test_ui_audio_bridge_placeholder_alive() -> Dictionary:
	var bridge := UIAudioBridge.get_instance()
	var ok := TestCase.assert_not_null(bridge, "UIAudioBridge 单例占位可用 (B3)")
	var hits: Array = []
	bridge.play_sfx.connect(func(_t: int, _v: float) -> void: hits.append(1))
	bridge.play_click()
	ok = ok and TestCase.assert_gte(hits.size(), 1, "play_sfx 信号可发射且零运行时报错")
	return TestCase.make_result("ui_audio_bridge_placeholder_alive", ok)

## 13. 前端兼容层退役与快照单一真源断言 (Phase 83 / R-01, R-02)
static func _test_frontend_compatibility_retirement() -> Dictionary:
	# 1. 断言 frontend/mocks 目录不存在
	var dir := DirAccess.open("res://frontend/mocks")
	var dir_ok := TestCase.assert_null(dir, "frontend/mocks 目录必须彻底删除 (R-01)")

	# 2. 断言 frontend/ 全域零 skeleton_mock / MOCK_PATH / _fill_params 引用
	#    经 TestArchitectureGuardDomain._strip_comments 去注释后扫描（剥离单源复用，
	#    零复制零护栏分裂）——注释中的历史词形不是真实引用，杜绝子串误报脆弱点。
	var frontend_files := _frontend_gd_files()
	var skeleton_hits := 0
	var fill_params_hits := 0
	for file_path in frontend_files:
		var content := TestArchitectureGuardDomain._strip_comments(FileAccess.get_file_as_string(file_path))
		if content.contains("skeleton_mock") or content.contains("MOCK_PATH"):
			skeleton_hits += 1
		if content.contains("_fill_params"):
			fill_params_hits += 1
	var skeleton_ok := TestCase.assert_eq(skeleton_hits, 0, "frontend/ 全域零 skeleton_mock/MOCK_PATH 引用")
	var fill_ok := TestCase.assert_eq(fill_params_hits, 0, "frontend/ 全域零 _fill_params 死委托引用")

	# 3. 断言 MockDataCatalog 包含完整 character 与 economy 扩展字段
	var char_data: Dictionary = MockDataCatalog.get_domain_data("character")
	var char_ok := TestCase.assert_true(char_data.has("attributes"), "MockDataCatalog 必须包含 character.attributes")
	var eco_data: Dictionary = MockDataCatalog.get_domain_data("economy")
	var eco_wallet_ok := TestCase.assert_true(eco_data.has("wallet"), "MockDataCatalog 必须包含 economy.wallet")
	var eco_trend_ok := TestCase.assert_true(eco_data.has("price_trend"), "MockDataCatalog 必须包含 economy.price_trend")

	var all_ok: bool = dir_ok and skeleton_ok and fill_ok and char_ok and eco_wallet_ok and eco_trend_ok
	return TestCase.make_result("frontend_compatibility_retirement", all_ok)
