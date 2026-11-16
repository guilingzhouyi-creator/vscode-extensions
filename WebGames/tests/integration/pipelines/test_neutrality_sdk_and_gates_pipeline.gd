# ==============================================================================
# 模块归属: 测试体系 (Tests · Integration Pipelines)
# 文件路径: res://tests/integration/pipelines/test_neutrality_sdk_and_gates_pipeline.gd
# 架构定位: Integration Test Pipeline / Phase 133 Neutrality, Real Services & Gates Pipeline
# 依赖与触发: 上游: TestRegistry | 下游: ServiceLocator, RealServiceContainer,
#           ItemRegistrySolver, ModPackageDiscoverySolver, ModPrecheckAndAdaptationSolver,
#           GameConfig, NavManager, UIIntermediary
# 职责说明: 端到端验证 Phase 133 全领域 21 项真实服务无模拟回退、多命名空间物品格式、
#           基座配置去卡拉尔中性化与 views.json 视图段完整性、total_conversion_sample
#           与 official_kalar 哈希自洽、以及前端单例 teardown 零孤立节点泄漏。
# 设计依据: Phase 133 阶段4验收矩阵 (DOD-P133-01 ~ DOD-P133-04)
# ==============================================================================

## TestNeutralitySdkAndGatesPipeline：全领域真实服务、基座中性化与门禁闭环流水线
class_name TestNeutralitySdkAndGatesPipeline
extends TestCase

const AppLifecycleFSM = preload("res://frontend/app/app_lifecycle_fsm.gd")
const ContextMenuManager = preload("res://frontend/ui_infrastructure/context_menu_manager.gd")
const DialogManager = preload("res://frontend/ui_infrastructure/dialog_manager.gd")
const DrawerManager = preload("res://frontend/ui_infrastructure/drawer_manager.gd")
const FocusInputManager = preload("res://frontend/ui_infrastructure/focus_input_manager.gd")
const ItemRegistrySolver = preload("res://backend/domains/item_namespace_registry/item_registry_solver.gd")
const ModalManager = preload("res://frontend/ui_infrastructure/modal_manager.gd")
const ModPackageDiscoverySolver = preload("res://backend/domains/narrative_orchestration/mod_package_discovery_solver.gd")
const ModPrecheckAndAdaptationSolver = preload("res://backend/domains/character_creation/mod_precheck_and_adaptation_solver.gd")
const NavManager = preload("res://frontend/navigation/nav_manager.gd")
const RealServiceContainer = preload("res://frontend/domain_boundary/services/real_service_container.gd")
const RedDotTreeManager = preload("res://frontend/ui_infrastructure/red_dot_tree_manager.gd")
const ServiceLocator = preload("res://frontend/domain_boundary/service_locator.gd")
const TestFullChainBackendHelper = preload("res://tests/integration/pipelines/test_full_chain_backend_helper.gd")
const ThemeManager = preload("res://frontend/theme/theme_manager.gd")
const TooltipManager = preload("res://frontend/ui_infrastructure/tooltip_manager.gd")
const UIAudioBridge = preload("res://frontend/ui_infrastructure/ui_audio_bridge.gd")
const UIIntermediary = preload("res://frontend/i18n/ui_intermediary.gd")
const UITextResolver = preload("res://frontend/i18n/ui_text_resolver.gd")

const FORBIDDEN_LORE_TOKENS: Array[String] = ["瓦尔兰", "阿尔托莉雅", "卡拉尔"]
const EXPECTED_SERVICE_KEYS: Array[String] = [
	"auth", "world", "character", "esc_menu", "prologue", "hud_sync", "lifecycle", "game_settings",
	"version", "combat", "chat_command", "crafting", "economy", "gacha", "grimoire",
	"guild", "mail", "misc_edge", "quest", "save", "snapshot_data"
]


## 执行 Phase 133 全链路回归流水线
static func run_all_tests() -> Dictionary:
	_reset_phase_state()
	var results: Array[Dictionary] = []
	results.append(test_dod_p133_01_real_service_container_coverage())
	results.append(test_dod_p133_02_base_neutrality_and_multi_namespace())
	results.append(test_dod_p133_03_sdk_samples_and_official_digest())
	results.append(test_dod_p133_04_singleton_teardown_zero_leaks())
	_reset_phase_state()
	return TestCase.pack_results("Phase 133 全领域真实服务、去卡拉尔中性化与门禁闭环流水线", results)


## DOD-P133-01: ServiceLocator real 模式全 21 项域服务无模拟回退并可执行真实调用
static func test_dod_p133_01_real_service_container_coverage() -> Dictionary:
	_reset_phase_state()
	ServiceLocator.set_mode("real")
	var service_container := ServiceLocator.get_instance()
	var non_mock_failures: Array[String] = []
	for service_key in EXPECTED_SERVICE_KEYS:
		var service_instance: Variant = service_container.get_service(service_key)
		if service_instance == null:
			non_mock_failures.append("%s:null" % service_key)
			continue
		var script_object: Script = service_instance.get_script() as Script
		var script_path: String = script_object.resource_path if script_object != null else ""
		if script_path.contains("/mocks/") or not script_path.contains("/services/real_"):
			non_mock_failures.append("%s:%s" % [service_key, script_path])

	var sample_calls_passed := _exercise_real_domain_services(service_container)
	var passed := ServiceLocator.get_mode() == "real" \
		and service_container is RealServiceContainer \
		and non_mock_failures.is_empty() \
		and sample_calls_passed
	_reset_phase_state()
	return TestCase.make_result("DOD-P133-01: real 模式全 21 项域服务零 Mock 回退与真实调用贯通", passed, {
		"non_mock_failures": non_mock_failures,
		"sample_calls_passed": sample_calls_passed
	})


## 验证新增真实适配器核心方法可直接响应且不依赖 Mock 目录
static func _exercise_real_domain_services(service_container: ServiceContainer) -> bool:
	var version_holder: Dictionary = {}
	service_container.version().check_version_async(func(reply_payload: Dictionary) -> void:
		version_holder.merge(reply_payload, true)
	)
	var combat_holder: Dictionary = {}
	service_container.combat().get_combat_snapshot_async("BOSS_P133_PROBE", func(reply_payload: Dictionary) -> void:
		combat_holder.merge(reply_payload, true)
	)
	var craft_preview := service_container.crafting().preview_enhance_rate(5)
	var total_copper := service_container.economy().calculate_total_copper(1, 2, 3)
	var gacha_rules := service_container.gacha().get_rules()
	var grimoire_income := service_container.grimoire().estimate_authoring_income(0)
	var guild_admin_allowed := service_container.guild().can_manage("LEADER")
	var mail_capacity := service_container.mail().get_max_capacity()
	var rename_fee := service_container.misc_edge().get_name_type_fee(0)
	var quest_transition := service_container.quest().transition_status({"status": "AVAILABLE"}, "accept")
	var replay_speeds := service_container.save().get_replay_speeds()
	var command_session := service_container.chat_command().create_session()
	var world_map_snapshot := service_container.snapshot_data().load_snapshot("world_map")

	return not str(version_holder.get("version", "")).is_empty() \
		and bool(combat_holder.get("success", false)) \
		and not craft_preview.is_empty() \
		and total_copper > 0 \
		and not gacha_rules.is_empty() \
		and not grimoire_income.is_empty() \
		and guild_admin_allowed \
		and mail_capacity > 0 \
		and rename_fee >= 0 \
		and bool(quest_transition.get("success", false)) \
		and not replay_speeds.is_empty() \
		and command_session != null \
		and world_map_snapshot.has("landmarks")


## DOD-P133-02: 无 MOD 基座去卡拉尔专有名词检查、views.json 补齐与多命名空间物品格式
static func test_dod_p133_02_base_neutrality_and_multi_namespace() -> Dictionary:
	_reset_phase_state()
	var service_mode := GameConfig.get_string("frontend.ui", "service_mode", "")
	var player_name := GameConfig.get_string("frontend.ui", "player/name", "")
	var servers_list := GameConfig.get_array("frontend.views", "fe01_account_entry/default_servers", [])
	var gateway_cooldown := GameConfig.get_int("frontend.views", "world_gateway/switch_mode_cooldown_ms", 0)
	var workbench_cooldown := GameConfig.get_int("frontend.views", "mod_workbench/toggle_pack_cooldown_ms", 0)
	var prologue_cooldown := GameConfig.get_int("frontend.views", "prologue/choice_cooldown_ms", 0)
	var server_list_neutral := _servers_neutral(servers_list)
	var static_neutrality_issues := _scan_base_neutrality_issues()
	var base_neutral := _contains_none_forbidden(player_name) and server_list_neutral and static_neutrality_issues.is_empty()
	var views_complete := gateway_cooldown == 200 and workbench_cooldown == 120 and prologue_cooldown == 150

	var namespace_checks := ItemRegistrySolver.validate_canonical_id_format("KALAR:EQUIP:WEAPON_BLADE:SWORD_01") \
		and ItemRegistrySolver.validate_canonical_id_format("CYBER:EQUIP:BLADE:KATANA_01") \
		and ItemRegistrySolver.validate_canonical_id_format("NEXUS:ITEM:CORE:RELIC_01") \
		and not ItemRegistrySolver.validate_canonical_id_format("lowercase:EQUIP:BLADE:SWORD_01") \
		and not ItemRegistrySolver.validate_canonical_id_format("SHORT:TAG") \
		and not ItemRegistrySolver.validate_canonical_id_format("NEXUS:ITEM::RELIC_01") \
		and not ItemRegistrySolver.validate_canonical_id_format(" NEXUS:ITEM:CORE:RELIC_01")

	var passed := service_mode == "real" and base_neutral and views_complete and namespace_checks
	return TestCase.make_result("DOD-P133-02: 基座配置去卡拉尔中性化、views.json 契约段与多命名空间校验", passed, {
		"service_mode": service_mode,
		"base_neutral": base_neutral,
		"static_neutrality_issues": static_neutrality_issues,
		"views_complete": views_complete,
		"namespace_checks": namespace_checks
	})


## 全量扫描基座 config/narratives/*、项目元数据与 backend/frontend 中不得出现禁忌剧情词与 official_kalar
static func _scan_base_neutrality_issues() -> Array[String]:
	var issues: Array[String] = []
	var config_dirs: Array[String] = ["res://config/narratives", "res://config/infrastructure"]
	for dir_path in config_dirs:
		var dir := DirAccess.open(dir_path)
		if dir == null:
			continue
		dir.list_dir_begin()
		var fname: String = dir.get_next()
		while not fname.is_empty():
			if not dir.current_is_dir() and fname.ends_with(".json"):
				var full_path: String = dir_path.path_join(fname)
				var raw: String = FileAccess.get_file_as_string(full_path)
				if not _contains_none_forbidden(raw):
					issues.append("config_lore:" + full_path)
			fname = dir.get_next()
		dir.list_dir_end()

	if FileAccess.file_exists("res://project.godot"):
		var proj: String = FileAccess.get_file_as_string("res://project.godot")
		if proj.contains("KalarWorldEngine") or not _contains_none_forbidden(proj):
			issues.append("project_godot_not_neutral")

	var code_roots: Array[String] = ["res://backend", "res://frontend"]
	for code_root in code_roots:
		var files := _collect_gd_files_recursive(code_root)
		for gd_path in files:
			var code: String = FileAccess.get_file_as_string(gd_path)
			if code.contains("\"official_kalar\""):
				issues.append("hardcoded_official_kalar:" + gd_path)
	return issues


static func _collect_gd_files_recursive(root_dir: String) -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(root_dir)
	if dir == null:
		return out
	dir.list_dir_begin()
	var item: String = dir.get_next()
	while not item.is_empty():
		if not item.begins_with("."):
			var full: String = root_dir.path_join(item)
			if dir.current_is_dir():
				out.append_array(_collect_gd_files_recursive(full))
			elif item.ends_with(".gd"):
				out.append(full)
		item = dir.get_next()
	dir.list_dir_end()
	return out


static func _contains_none_forbidden(source_text: String) -> bool:
	for forbidden_token in FORBIDDEN_LORE_TOKENS:
		if source_text.contains(forbidden_token):
			return false
	return true


static func _servers_neutral(servers_list: Array) -> bool:
	if servers_list.is_empty():
		return false
	for server_entry in servers_list:
		if server_entry is Dictionary:
			var server_name := str((server_entry as Dictionary).get("name", ""))
			if not _contains_none_forbidden(server_name):
				return false
	return true


## DOD-P133-03: total_conversion_sample 全包发现预检通过，且 official_kalar 内容哈希自洽
static func test_dod_p133_03_sdk_samples_and_official_digest() -> Dictionary:
	_reset_phase_state()
	var sample_payload := ModPackageDiscoverySolver.load_full_mod_package_from_dir("res://mod_sdk/templates/total_conversion_sample")
	var sample_precheck := ModPrecheckAndAdaptationSolver.precheck_single_mod(sample_payload)
	var sample_dag_graphs: Dictionary = sample_payload.get("dag_graphs", {}) as Dictionary
	var sample_ok := str(sample_payload.get("pack_id", "")) == "sample_total_conversion" \
		and sample_dag_graphs.has("DAG_TC_PROLOGUE") \
		and bool(sample_precheck.get("valid", false)) \
		and bool(sample_precheck.get("is_compliant", false))

	var official_payload := ModPackageDiscoverySolver.load_full_mod_package_from_dir("res://mods/official_kalar")
	var declared_digest := str(official_payload.get("declared_content_sha256", "")).strip_edges().to_lower()
	var computed_digest := ModPackageDiscoverySolver.compute_package_content_sha256("res://mods/official_kalar").strip_edges().to_lower()
	var official_ok := str(official_payload.get("pack_id", "")) == "official_kalar" \
		and declared_digest.length() == 64 \
		and declared_digest == computed_digest

	var passed := sample_ok and official_ok
	return TestCase.make_result("DOD-P133-03: total_conversion_sample 预检通过与 official_kalar 哈希自洽", passed, {
		"sample_ok": sample_ok,
		"official_ok": official_ok,
		"declared_digest": declared_digest,
		"computed_digest": computed_digest
	})


## DOD-P133-04: 实例化并复位前端 11 个单例及服务边界后，孤立节点增量为 0
static func test_dod_p133_04_singleton_teardown_zero_leaks() -> Dictionary:
	_reset_phase_state()
	var orphan_before := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	var modal_mgr := ModalManager.get_instance()
	var dialog_mgr := DialogManager.get_instance()
	var drawer_mgr := DrawerManager.get_instance()
	var context_mgr := ContextMenuManager.get_instance()
	var tooltip_mgr := TooltipManager.get_instance()
	var focus_mgr := FocusInputManager.get_instance()
	var reddot_mgr := RedDotTreeManager.get_instance()
	var audio_bridge := UIAudioBridge.get_instance()
	var theme_mgr := ThemeManager.get_instance()
	var lifecycle_fsm := AppLifecycleFSM.get_instance()
	var instantiated_all := modal_mgr != null and dialog_mgr != null and drawer_mgr != null \
		and context_mgr != null and tooltip_mgr != null and focus_mgr != null \
		and reddot_mgr != null and audio_bridge != null and theme_mgr != null \
		and lifecycle_fsm != null

	_reset_phase_state()
	var orphan_delta := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)) - orphan_before
	var passed := instantiated_all and orphan_delta == 0
	return TestCase.make_result("DOD-P133-04: 前端 11 项 UI 单例 teardown 彻底复位且孤立节点增量为 0", passed, {
		"instantiated_all": instantiated_all,
		"orphan_delta": orphan_delta
	})


static func _reset_phase_state() -> void:
	ModalManager.reset_instance()
	DialogManager.reset_instance()
	DrawerManager.reset_instance()
	ContextMenuManager.reset_instance()
	TooltipManager.reset_instance()
	FocusInputManager.reset_instance()
	RedDotTreeManager.reset_instance()
	UIAudioBridge.reset_instance()
	ThemeManager.reset_instance()
	AppLifecycleFSM.reset_instance()
	NavManager.reset_instance()
	ServiceLocator.clear_active_gateway()
	ServiceLocator.reset()
	RealServiceContainer.reset_instance()
	UIIntermediary.teardown_for_tests()
	UITextResolver.reset_instance()
	TestCase.unmount_mod_overlay_for_test()
	TestFullChainBackendHelper.teardown_env()
